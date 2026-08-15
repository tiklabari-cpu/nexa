/**
 * Customers — the CRM surface.
 *
 * Reads require `customers:ro`, edits `customers:rw`, and banning its own
 * `customers.ban:rw`. The ban split is deliberate: it is the one action here
 * that denies a person service, and an agent who may correct a misspelled name
 * should not thereby be able to lock someone out.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { CustomerService } from '../services/customers/customer-service.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';

const listQuery = z.object({
  query: z.string().trim().max(320).optional(),
  segment: z.enum(['all', 'leads', 'recent', 'banned']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page_id: z.string().max(512).optional(),
});

/**
 * `null` clears a field, an absent key leaves it alone.
 *
 * `.optional()` on a nullable field is what makes that distinction survive
 * parsing — collapsing the two would mean any agent editing a phone number
 * silently wipes the name they did not send.
 */
const updateBody = z
  .object({
    name: z.string().trim().max(120).nullable().optional(),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: z.string().trim().max(40).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

const customerIdSchema = z.string().uuid();

// A map of definition id → value, where `null` clears a field. Validated
// against the field definitions (type + required) in the service.
const customFieldsBody = z.object({
  values: z.record(z.string().max(5000).nullable()),
});

export default async function customerDirectoryRoutes(app: FastifyInstance): Promise<void> {
  const customers = new CustomerService();
  const customFields = new CustomFieldService();

  app.get(
    '/customers',
    { config: { scopes: ['customers:ro', 'customers:rw'] } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);
      const tenant = request.tenant();

      const result = await request.withTenant((tx) =>
        customers.list(tx, tenant, {
          segment: query.segment,
          limit: query.limit,
          ...(query.query ? { query: query.query } : {}),
          ...(query.page_id ? { pageId: query.page_id } : {}),
        }),
      );

      return reply.send({
        items: result.items,
        total: result.total,
        ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
      });
    },
  );

  app.get<{ Params: { customerId: string } }>(
    '/customers/:customerId',
    { config: { scopes: ['customers:ro', 'customers:rw'] } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);
      const tenant = request.tenant();

      const customer = await request.withTenant((tx) => customers.get(tx, tenant, customerId));
      // Also the answer for a customer belonging to another tenant: RLS returns
      // nothing, and 404 keeps ids un-enumerable (NFR-S5).
      if (!customer) throw ApiError.notFound('Customer not found.');

      return reply.send(customer);
    },
  );

  app.patch<{ Params: { customerId: string } }>(
    '/customers/:customerId',
    { config: { scopes: ['customers:rw'] } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { id: customerId },
          select: { id: true },
        });
        if (!existing) throw ApiError.notFound('Customer not found.');

        await tx.customer.update({
          where: { id: customerId },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.phone !== undefined ? { phone: body.phone } : {}),
            // Recording an email is what makes someone a lead. Clearing it does
            // not un-make them one: they did give it to us, and quietly
            // rewriting that history would corrupt the lead reporting.
            ...(body.email !== undefined
              ? { email: body.email, ...(body.email ? { isLead: true } : {}) }
              : {}),
          },
        });

        return customers.get(tx, tenant, customerId);
      });

      return reply.send(updated);
    },
  );

  // Custom fields (FR-MOD-08.7.6): set this contact's values for the fields a
  // workspace has defined. Each is validated against its definition — a wrong
  // type, or a blank on a required field, is a 400. Returns the fresh detail,
  // whose `custom_fields` now carries the stored values (visible in the CRM).
  app.put<{ Params: { customerId: string } }>(
    '/customers/:customerId/custom-fields',
    { config: { scopes: ['customers:rw'] } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);
      const { values } = parse(customFieldsBody, request.body);
      const tenant = request.tenant();

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { id: customerId },
          select: { id: true },
        });
        if (!existing) throw ApiError.notFound('Customer not found.');

        await customFields.setValues(tx, tenant, 'contact', customerId, values);
        return customers.get(tx, tenant, customerId);
      });

      return reply.send(updated);
    },
  );

  app.post<{ Params: { customerId: string } }>(
    '/customers/:customerId/ban',
    { config: { scopes: ['customers.ban:rw'] } },
    async (request, reply) => {
      return reply.send(await setBanned(request, customers, true));
    },
  );

  app.delete<{ Params: { customerId: string } }>(
    '/customers/:customerId/ban',
    { config: { scopes: ['customers.ban:rw'] } },
    async (request, reply) => {
      return reply.send(await setBanned(request, customers, false));
    },
  );
}

async function setBanned(
  request: FastifyRequest<{ Params: { customerId: string } }>,
  customers: CustomerService,
  banned: boolean,
) {
  const customerId = parse(customerIdSchema, request.params.customerId);
  const tenant = request.tenant();

  return request.withTenant(async (tx) => {
    const existing = await tx.customer.findFirst({
      where: { id: customerId },
      select: { id: true, bannedAt: true },
    });
    if (!existing) throw ApiError.notFound('Customer not found.');

    // History is kept either way. A ban is a moderation decision, not an
    // erasure request, and deleting the conversations would also delete the
    // evidence the decision rested on.
    await tx.customer.update({
      where: { id: customerId },
      data: { bannedAt: banned ? new Date() : null },
    });

    // Only the transition is worth an entry: repeating a ban that already
    // holds (or lifting one already lifted) leaves no second line. No
    // metadata — the name, email, phone and free-text reason a moderator
    // might type never reach the append-only log.
    const wasBanned = existing.bannedAt !== null;
    if (wasBanned !== banned) {
      await writeAuditEntry(tx, request.auditContext(), {
        action: banned ? 'customer.banned' : 'customer.unbanned',
        target: `customer:${customerId}`,
      });
    }

    return customers.get(tx, tenant, customerId);
  });
}
