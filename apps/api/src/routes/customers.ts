/**
 * Customers — the CRM surface.
 *
 * Reads require `customers:ro`, edits `customers:rw`, and banning its own
 * `customers.ban:rw`. The ban split is deliberate: it is the one action here
 * that denies a person service, and an agent who may correct a misspelled name
 * should not thereby be able to lock someone out.
 *
 * Erasure (GDPR Art. 17 · NFR-C8) follows that split one step further with
 * `customers.erase:rw`, for the stronger version of the same reason: banning
 * can be lifted, and this cannot.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CUSTOMER_SORT_KEYS, DEFAULT_CUSTOMER_SORT_KEY, SORT_ORDERS } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { CustomerService } from '../services/customers/customer-service.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';
import { createGoalConversionRecorder } from '../services/goals/goal-triggers.js';
import { eraseCustomer } from '../services/retention/erasure.js';

/**
 * Not `z.coerce.boolean()`: that is `Boolean(value)`, and `Boolean('false')` is
 * `true`. A query string only ever carries text, so asking for "no tickets"
 * would silently return everyone who has one.
 */
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

const listQuery = z.object({
  query: z.string().trim().max(320).optional(),
  segment: z.enum(['all', 'leads', 'recent', 'banned']).default('all'),
  // Upper-cased here, once, rather than at every read: the stored column and
  // the filter panel's own client both follow the same convention
  // (`traffic-filters.ts`, `routing-service.ts`), which is what lets this stay
  // a plain `=` an index can serve instead of a case-insensitive scan.
  country_code: z
    .string()
    .trim()
    .length(2)
    .transform((value) => value.toUpperCase())
    .optional(),
  last_activity_from: z.string().regex(DATE_ONLY, 'must be YYYY-MM-DD').optional(),
  last_activity_to: z.string().regex(DATE_ONLY, 'must be YYYY-MM-DD').optional(),
  has_tickets: booleanQuery.optional(),
  // The database can order the whole collection by this set only — see
  // `CUSTOMER_SORT_KEYS` (`@nexa/types`) for why chats/tickets are absent.
  sort: z.enum(CUSTOMER_SORT_KEYS).default(DEFAULT_CUSTOMER_SORT_KEY),
  order: z.enum(SORT_ORDERS).default('desc'),
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
  // Recording an e-mail here is one of the two ways somebody becomes a lead —
  // the other is the widget's pre-chat form — so a lead goal (FR-MOD-13.3) has
  // to be evaluated from this side too.
  const goals = createGoalConversionRecorder(app.db, { logger: app.log });

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
          sort: query.sort,
          order: query.order,
          ...(query.query ? { query: query.query } : {}),
          ...(query.page_id ? { pageId: query.page_id } : {}),
          ...(query.country_code !== undefined ? { countryCode: query.country_code } : {}),
          ...(query.last_activity_from !== undefined
            ? { lastActivityFrom: query.last_activity_from }
            : {}),
          ...(query.last_activity_to !== undefined
            ? { lastActivityTo: query.last_activity_to }
            : {}),
          ...(query.has_tickets !== undefined ? { hasTickets: query.has_tickets } : {}),
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

      const { updated, becameLead } = await request.withTenant(async (tx) => {
        const existing = await tx.customer.findFirst({
          where: { id: customerId },
          select: { id: true, isLead: true },
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

        return {
          updated: await customers.get(tx, tenant, customerId),
          // The transition, not the state: `isLead` never goes back to false, so
          // re-evaluating on every later edit would ask a question already
          // answered.
          becameLead: Boolean(body.email) && !existing.isLead,
        };
      });

      // After the transaction commits — the matcher reads `is_lead` back, so it
      // has to see the write that set it (FR-MOD-13.3).
      if (becameLead) await goals.record(tenant, customerId);

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
    { config: { scopes: ['customers.ban:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      return reply.send(await setBanned(request, customers, true));
    },
  );

  app.delete<{ Params: { customerId: string } }>(
    '/customers/:customerId/ban',
    { config: { scopes: ['customers.ban:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      return reply.send(await setBanned(request, customers, false));
    },
  );

  // --- Right to erasure (GDPR Art. 17 · NFR-C8) ------------------------------
  //
  // `customers.erase:rw`, which nothing else implies — NFR-C8's own wording is
  // that the "erişim ≠ silme" tension has to be resolved, and it is not
  // resolved by a resource where the read/write scope also carries an
  // irreversible delete. `minimumRole: 'admin'` on top, so a broad PAT held by
  // an agent-role account is refused here the way it is at every other
  // workspace-level surface (tm 146's second half).
  //
  // The work itself is `services/retention/erasure.ts`, which explains what
  // goes, what deliberately survives, and why an active conversation refuses.
  app.post<{ Params: { customerId: string } }>(
    '/customers/:customerId/erase',
    { config: { scopes: ['customers.erase:rw'], minimumRole: 'admin' } },
    async (request, reply) => {
      const customerId = parse(customerIdSchema, request.params.customerId);
      const now = new Date();

      const receipt = await request.withTenant(async (tx) => {
        const result = await eraseCustomer(tx, customerId, now);

        // Written inside the same transaction as the deletes, so an erasure
        // that fails halfway leaves no receipt claiming it happened — and a
        // receipt that exists is backed by rows that are actually gone.
        //
        // Counts and the id only. The name, the e-mail, the phone number and
        // every message are exactly what was just erased; copying any of them
        // into an append-only table that outlives this request would undo the
        // request while recording that it was honoured.
        await writeAuditEntry(tx, request.auditContext(), {
          action: 'data.subject_erased',
          target: `customer:${customerId}`,
          metadata: {
            chats: result.chats,
            threads: result.threads,
            events: result.events,
            visits: result.visits,
            tickets: result.tickets,
            channel_identities: result.channelIdentities,
          },
        });

        return result;
      });

      return reply.send({
        customer_id: receipt.customerId,
        erased_at: receipt.erasedAt.toISOString(),
        chats: receipt.chats,
        threads: receipt.threads,
        events: receipt.events,
        visits: receipt.visits,
        tickets: receipt.tickets,
        channel_identities: receipt.channelIdentities,
      });
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
