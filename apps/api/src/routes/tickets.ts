/**
 * Tickets — asynchronous follow-up work (PRD FR-MOD-02.1.3, 02.6).
 *
 * Scopes are the ticket's own (`tickets--all` / `tickets--access`) rather than
 * the chat ones. A token handed out to read conversations should not silently
 * also read the follow-up queue, and ADR-04 keeps resources distinct.
 *
 * Writes are covered by the licence gate hook, so an expired trial refuses to
 * create or edit a ticket (402, ADR-10) without this file having to know.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { TICKET_PRIORITY_MAX, TICKET_PRIORITY_MIN } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { TICKET_STATUSES, TicketService } from '../services/tickets/ticket-service.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';

const READ_SCOPES = ['tickets--all:ro', 'tickets--access:ro', 'tickets--all:rw'];
const WRITE_SCOPES = ['tickets--all:rw', 'tickets--access:rw'];

const listQuery = z.object({
  view: z.enum(['all', 'unassigned', 'my_open', 'solved']).default('all'),
  query: z.string().trim().max(320).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page_id: z.string().max(512).optional(),
});

const createBody = z
  .object({
    subject: z.string().trim().min(1).max(200),
    source_chat_id: z.string().max(12).optional(),
    customer_id: z.string().uuid().optional(),
    group_id: z.number().int().positive().nullable().optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    status: z.enum(TICKET_STATUSES).optional(),
  })
  .refine(
    (body) => body.source_chat_id !== undefined || body.customer_id !== undefined,
    'either source_chat_id or customer_id is required',
  );

/**
 * `null` clears the field, an absent key leaves it alone.
 *
 * Collapsing the two would mean an agent changing a subject silently unassigns
 * the ticket they were looking at.
 */
const updateBody = z
  .object({
    subject: z.string().trim().min(1).max(200).optional(),
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.number().int().min(TICKET_PRIORITY_MIN).max(TICKET_PRIORITY_MAX).optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    group_id: z.number().int().positive().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const mergeBody = z.object({ into: z.string().min(1).max(12) });
const followerBody = z.object({ account_id: z.string().uuid() });

// A map of definition id → value, where `null` clears a field. The values are
// validated against their definitions (type + required) in the service.
const customFieldsBody = z.object({
  values: z.record(z.string().max(5000).nullable()),
});

const ticketIdSchema = z.string().min(1).max(12);
const accountIdSchema = z.string().uuid();

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

export default async function ticketRoutes(app: FastifyInstance): Promise<void> {
  const tickets = new TicketService();
  const customFields = new CustomFieldService();

  app.get('/tickets', { config: { scopes: READ_SCOPES } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();

    const result = await request.withTenant((tx) =>
      tickets.list(tx, tenant, principal, {
        view: query.view,
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
  });

  app.post('/tickets', { config: { scopes: WRITE_SCOPES } }, async (request, reply) => {
    const body = parse(createBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();

    const ticket = await request.withTenant((tx) =>
      tickets.create(tx, tenant, principal, {
        subject: body.subject,
        ...(body.source_chat_id !== undefined ? { source_chat_id: body.source_chat_id } : {}),
        ...(body.customer_id !== undefined ? { customer_id: body.customer_id } : {}),
        ...(body.group_id !== undefined ? { group_id: body.group_id } : {}),
        ...(body.assignee_id !== undefined ? { assignee_id: body.assignee_id } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      }),
    );

    return reply.code(201).send(ticket);
  });

  app.get<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId',
    { config: { scopes: READ_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const principal = request.requirePrincipal();

      return reply.send(await request.withTenant((tx) => tickets.get(tx, principal, ticketId)));
    },
  );

  app.patch<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId',
    { config: { scopes: WRITE_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const body = parse(updateBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const ticket = await request.withTenant((tx) =>
        tickets.update(tx, tenant, principal, request.auditContext(), ticketId, {
          ...(body.subject !== undefined ? { subject: body.subject } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.assignee_id !== undefined ? { assignee_id: body.assignee_id } : {}),
          ...(body.group_id !== undefined ? { group_id: body.group_id } : {}),
        }),
      );

      return reply.send(ticket);
    },
  );

  // Custom fields (FR-MOD-08.7.6): set this ticket's values for the fields a
  // workspace has defined. Each is validated against its definition — a wrong
  // type, or a blank on a required field, is a 400. Returns the fresh detail,
  // whose `custom_fields` now carries the stored values (visible in Details).
  app.put<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId/custom-fields',
    { config: { scopes: WRITE_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const { values } = parse(customFieldsBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const ticket = await request.withTenant(async (tx) => {
        // Visibility + existence first: `get` throws 404 for a ticket this
        // caller cannot see, so a value is never written against one they
        // could not otherwise touch.
        await tickets.get(tx, principal, ticketId);
        await customFields.setValues(tx, tenant, 'ticket', ticketId, values);
        return tickets.get(tx, principal, ticketId);
      });

      return reply.send(ticket);
    },
  );

  // --- HelpDesk layer (FR-MOD-13.6): merge / unmerge / followers -------------

  app.post<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId/merge',
    { config: { scopes: WRITE_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const { into } = parse(mergeBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const ticket = await request.withTenant((tx) =>
        tickets.merge(tx, tenant, principal, request.auditContext(), ticketId, into),
      );

      return reply.send(ticket);
    },
  );

  app.delete<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId/merge',
    { config: { scopes: WRITE_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const ticket = await request.withTenant((tx) =>
        tickets.unmerge(tx, tenant, principal, request.auditContext(), ticketId),
      );

      return reply.send(ticket);
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId/followers',
    { config: { scopes: WRITE_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const { account_id } = parse(followerBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const ticket = await request.withTenant((tx) =>
        tickets.addFollower(tx, tenant, principal, request.auditContext(), ticketId, account_id),
      );

      return reply.send(ticket);
    },
  );

  app.delete<{ Params: { ticketId: string; accountId: string } }>(
    '/tickets/:ticketId/followers/:accountId',
    { config: { scopes: WRITE_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const accountId = parse(accountIdSchema, request.params.accountId);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const ticket = await request.withTenant((tx) =>
        tickets.removeFollower(tx, tenant, principal, request.auditContext(), ticketId, accountId),
      );

      return reply.send(ticket);
    },
  );
}
