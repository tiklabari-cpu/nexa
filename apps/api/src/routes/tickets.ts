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
import {
  DEFAULT_TICKET_SORT_KEY,
  SORT_ORDERS,
  TICKET_BULK_MAX,
  TICKET_PRIORITY_MAX,
  TICKET_PRIORITY_MIN,
  TICKET_SORT_KEYS,
} from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import type { WorkspaceEventDispatcher } from '../services/webhooks/workspace-events.js';
import { TICKET_STATUSES, TicketService } from '../services/tickets/ticket-service.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';
import { TicketEmailTemplateService } from '../services/tickets/ticket-email-template-service.js';
import type { RenderedTicketEmail } from '../services/tickets/ticket-email.js';
import type { Mailer } from '../services/mail/mailer.js';
import { selfAccountId } from '../services/auth/principal.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';

const READ_SCOPES = ['tickets--all:ro', 'tickets--access:ro', 'tickets--all:rw'];
const WRITE_SCOPES = ['tickets--all:rw', 'tickets--access:rw'];

const listQuery = z.object({
  view: z.enum(['all', 'unassigned', 'my_open', 'solved']).default('all'),
  query: z.string().trim().max(320).optional(),
  // The enum is the contract's, shared rather than restated: the grid, this
  // route and the keyset predicate all have to agree on which columns the
  // database can order the whole collection by (`@nexa/types`).
  sort: z.enum(TICKET_SORT_KEYS).default(DEFAULT_TICKET_SORT_KEY),
  order: z.enum(SORT_ORDERS).default('desc'),
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
    /**
     * Tell the customer, in the workspace's own words (FR-MOD-08.7.5). Names a
     * template from `/settings/ticket-email-templates`; its placeholders are
     * filled from this ticket and the message goes out once the change commits.
     */
    email_template_id: z.string().uuid().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required')
  // A notice is *about* a transition, and a template may print `{{ticket.status}}`
  // — so a template with no status alongside it would mail a customer a sentence
  // about a change that did not happen. Refused at the edge, where the shape of
  // the request is judged, rather than deep in the send path.
  .refine(
    (body) => body.email_template_id === undefined || body.status !== undefined,
    'email_template_id: a template notice needs a status to be about',
  );

/**
 * A bulk action over the Tickets grid (FR-MOD-02.7.1).
 *
 * The field list is `updateBody` minus `subject` (it describes one ticket) and
 * minus `email_template_id` (mailing every customer in a selection is a
 * different product decision, and this endpoint does not make it quietly).
 *
 * The ceiling is `@nexa/types`' rather than a literal: the console sizes its
 * "select the whole page" gesture from the same constant, and a client offering
 * one more row than the server accepts would 400 on the flagship action.
 */
const bulkBody = z
  .object({
    ticket_ids: z
      .array(z.string().min(1).max(12))
      .min(1)
      .max(TICKET_BULK_MAX)
      // Refused rather than deduplicated: a duplicate id means the caller and
      // the server disagree about what was selected, and silently collapsing it
      // would return fewer results than ids and break the report's alignment
      // with the rows the agent ticked.
      .refine((ids) => new Set(ids).size === ids.length, 'ticket_ids: ids must be unique'),
    status: z.enum(TICKET_STATUSES).optional(),
    priority: z.number().int().min(TICKET_PRIORITY_MIN).max(TICKET_PRIORITY_MAX).optional(),
    assignee_id: z.string().uuid().nullable().optional(),
    group_id: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (body) =>
      body.status !== undefined ||
      body.priority !== undefined ||
      body.assignee_id !== undefined ||
      body.group_id !== undefined,
    'at least one field to change is required',
  );

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

export default async function ticketRoutes(
  app: FastifyInstance,
  {
    automations,
    mailer,
  }: {
    /** Fans a committed ticket creation out to Zapier/Make subscriptions (FR-MOD-09.4). */
    automations?: WorkspaceEventDispatcher;
    /**
     * Delivers the templated customer notice a status change can carry
     * (FR-MOD-08.7.5). Optional like `automations`: absent, the endpoint still
     * refuses an unusable template — the validation is the requirement, the
     * delivery is the effect.
     */
    mailer?: Mailer;
  } = {},
): Promise<void> {
  const tickets = new TicketService();
  const customFields = new CustomFieldService();
  const templates = new TicketEmailTemplateService();

  app.get('/tickets', { config: { scopes: READ_SCOPES } }, async (request, reply) => {
    const query = parse(listQuery, request.query);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();

    const result = await request.withTenant((tx) =>
      tickets.list(tx, tenant, principal, {
        view: query.view,
        limit: query.limit,
        sort: query.sort,
        order: query.order,
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

    // After the transaction, never inside it (FR-MOD-09.4): the delivery is an
    // HTTP call to somebody else's server, and the ticket is already committed
    // — a receiver having a bad minute must not roll it back. `emit` swallows
    // its own failures, so nothing here can turn a created ticket into a 500.
    await automations?.emit(tenant, 'ticket_created', {
      ticket_id: ticket.id,
      subject: ticket.subject,
      status: ticket.status,
      priority: ticket.priority,
      customer_id: ticket.customer_id,
      created_at: ticket.created_at,
    });

    return reply.code(201).send(ticket);
  });

  // Bulk actions (PRD §5.2 "Ticketing (gelişmiş)" · FR-13-EK.3 ·
  // FR-MOD-02.7.1). Declared before `/tickets/:ticketId` so the literal
  // segment is unambiguous to a reader; Fastify's radix tree prefers the
  // static branch either way.
  //
  // A POST rather than a PATCH on the collection: it does not describe the
  // collection's new state, it runs one action over a caller-named selection
  // and answers with a report. `WRITE_SCOPES` and the licence gate hook are the
  // same ones the single endpoint sits behind — nothing here is a cheaper door
  // into a ticket than `PATCH /tickets/{id}` is.
  app.post('/tickets/bulk', { config: { scopes: WRITE_SCOPES } }, async (request, reply) => {
    const body = parse(bulkBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const audit = request.auditContext();

    const result = await request.withTenant((tx) =>
      tickets.bulkUpdate(tx, tenant, principal, audit, body.ticket_ids, {
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.assignee_id !== undefined ? { assignee_id: body.assignee_id } : {}),
        ...(body.group_id !== undefined ? { group_id: body.group_id } : {}),
      }),
    );

    return reply.send(result);
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
      const audit = request.auditContext();
      const templateId = body.email_template_id;

      const { ticket, notice } = await request.withTenant(async (tx) => {
        // Everything the notice needs is settled *before* the transition, and
        // inside the same transaction: an unusable template throws here and the
        // status never moves. The alternative — update, then discover the
        // template is broken — would leave an agent looking at a solved ticket
        // believing a customer had been told.
        let mail: RenderedTicketEmail | null = null;
        if (templateId !== undefined) {
          // `get` is the visibility gate: a ticket this caller cannot see is a
          // 404 here, so a template is never rendered against one they could
          // not otherwise read.
          const before = await tickets.get(tx, principal, ticketId);
          // The status is what the notice asserts. Sending one when nothing
          // moved would be the product generating a false statement — and it
          // is also what keeps this endpoint from being a mailer: at most one
          // notice per real transition. Same rule the audit entry and the
          // resolution clock below already follow.
          if (before.status === body.status) {
            throw ApiError.validation(
              `email_template_id: this ticket is already ${before.status}; nothing to notify about.`,
            );
          }
          mail = await templates.prepareTicketEmail(tx, tenant, {
            templateId,
            ticket: before,
            // `body.status` is present whenever a template is — `updateBody`
            // refuses the pair otherwise, which is what makes this narrowing safe.
            nextStatus: body.status ?? before.status,
            agentAccountId: selfAccountId(principal),
          });
        }

        const updated = await tickets.update(tx, tenant, principal, audit, ticketId, {
          ...(body.subject !== undefined ? { subject: body.subject } : {}),
          ...(body.status !== undefined ? { status: body.status } : {}),
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.assignee_id !== undefined ? { assignee_id: body.assignee_id } : {}),
          ...(body.group_id !== undefined ? { group_id: body.group_id } : {}),
        });

        if (mail) {
          // The template and the *names* of the variables it drew on — never a
          // value, never the rendered text. The message is the customer's data;
          // the trail records that it was sent, not what it said.
          await writeAuditEntry(tx, audit, {
            action: 'ticket.email_sent',
            target: `ticket:${ticketId}`,
            metadata: { template_id: mail.templateId, variables: mail.variables },
          });
        }

        return { ticket: updated, notice: mail };
      });

      // After the commit, never inside it: a mail must not be able to hold a
      // transaction open or be undone by a rollback. A delivery failure is
      // logged and not raised — the transition is already durable, and turning
      // a committed change into a 500 would tell the agent it did not happen.
      if (notice && mailer) {
        try {
          await mailer.send({
            to: notice.to,
            kind: 'ticket_notice',
            subject: notice.subject,
            body: notice.body,
          });
        } catch (error) {
          // The template id, not the message: this line goes to the same log
          // the body is deliberately kept out of.
          request.log.error(
            { err: error, template_id: notice.templateId, ticket_id: ticketId },
            'ticket notice delivery failed',
          );
        }
      }

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
