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
import { ticketNoticeMail, ticketReplyMail } from '../services/mail/templates/messages.js';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_TICKET_SORT_KEY,
  SORT_ORDERS,
  TICKET_BULK_MAX,
  TICKET_COMPOSER_KINDS,
  TICKET_MESSAGE_ATTACHMENTS_MAX,
  TICKET_MESSAGE_PAGE_SIZE,
  TICKET_MESSAGE_TEXT_MAX,
  TICKET_PRIORITY_MAX,
  TICKET_PRIORITY_MIN,
  TICKET_REPLY_SET_STATUSES,
  TICKET_SORT_KEYS,
} from '@siyahtus/types';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { withTenant, type TenantContext } from '../lib/tenant.js';
import type { WorkspaceEventDispatcher } from '../services/webhooks/workspace-events.js';
import {
  TICKET_STATUSES,
  TicketService,
  maskTicketContact,
} from '../services/tickets/ticket-service.js';
import { seesPlayerContact } from '../services/customers/player-contact.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';
import { TicketEmailTemplateService } from '../services/tickets/ticket-email-template-service.js';
import {
  withPilotNoReplyLine,
  type RenderedTicketEmail,
} from '../services/tickets/ticket-email.js';
import { logUnsentMail } from '../services/mail/delivery.js';
import { messageIdDomainOf } from '../services/tickets/ticket-auto-ack.js';
import { selfAccountId } from '../services/auth/principal.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { ticketArrivalPush } from '../services/tickets/ticket-arrival.js';
import { createObjectStore } from '../services/storage/object-store.js';
import { licenseOfStoredKey } from '../services/storage/upload-url.js';
import {
  TicketMessageService,
  resolveAttachments,
  type TicketReplyOutbound,
} from '../services/tickets/ticket-message-service.js';
import { TicketReplyAddresses } from '../services/tickets/ticket-reply-address.js';

const READ_SCOPES = ['tickets--all:ro', 'tickets--access:ro', 'tickets--all:rw'];
const WRITE_SCOPES = ['tickets--all:rw', 'tickets--access:rw'];

const listQuery = z.object({
  view: z.enum(['all', 'unassigned', 'my_open', 'solved']).default('all'),
  query: z.string().trim().max(320).optional(),
  // The enum is the contract's, shared rather than restated: the grid, this
  // route and the keyset predicate all have to agree on which columns the
  // database can order the whole collection by (`@siyahtus/types`).
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
 * The ceiling is `@siyahtus/types`' rather than a literal: the console sizes its
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

/** A page of a ticket's thread, oldest first (HD-01). */
const messageListQuery = z.object({
  page_id: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(TICKET_MESSAGE_PAGE_SIZE),
});

/**
 * The composer (HD-01 · `TicketMessageInput`). The vocabularies and bounds are
 * `@siyahtus/types`', which the console builds the composer from. The text is
 * trimmed before it is measured: a reply of spaces is no reply.
 */
const messageBody = z.object({
  kind: z.enum(TICKET_COMPOSER_KINDS),
  text: z.string().trim().min(1).max(TICKET_MESSAGE_TEXT_MAX),
  attachment_keys: z
    .array(z.string().min(1).max(512))
    .max(TICKET_MESSAGE_ATTACHMENTS_MAX)
    // Refused rather than collapsed, like `ticket_ids` on the bulk action: a
    // file named twice is a composer that lost track of what it attached.
    .refine((keys) => new Set(keys).size === keys.length, 'keys must be unique')
    .default([]),
  set_status: z.enum(TICKET_REPLY_SET_STATUSES).optional(),
  idempotency_key: z.string().min(1).max(128),
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
    env,
    automations,
    pilotMode = false,
  }: {
    /** Where the composer's attachments live (`STORAGE_PROVIDER`). */
    env: Env;
    /** Fans a committed ticket creation out to Zapier/Make subscriptions (FR-MOD-09.4). */
    automations?: WorkspaceEventDispatcher;
    /**
     * `PILOT_MODE`: the pilot refuses the inbound e-mail webhook, so an answer
     * cannot come back — ticket mail carries no `Reply-To` and says its mailbox
     * reads no replies (tm 257.14). Off, it carries the ticket's reply address
     * (tm 358 · HD-03) and no such line.
     */
    pilotMode?: boolean;
  },
): Promise<void> {
  const tickets = new TicketService();
  const messages = new TicketMessageService({
    outbound: env.TICKET_MAIL_OUTBOUND,
    messageIdDomain: messageIdDomainOf(env),
  });
  const store = createObjectStore(env.STORAGE_PROVIDER, env.storage);
  const publisher = new RealtimePublisher(app.redis, app.log);
  const replyAddresses = new TicketReplyAddresses(
    env.CUSTOMER_TOKEN_SECRET,
    env.INBOUND_EMAIL_DOMAIN,
  );
  /**
   * The `Reply-To` of a ticket's mail (tm 358 · HD-03): the signed address the
   * inbound webhook threads an answer back onto this ticket by. None in the
   * pilot, which serves no inbound mail — an answer there would go nowhere.
   */
  const replyToFor = (tenant: TenantContext, ticketId: string) =>
    pilotMode ? {} : { replyTo: replyAddresses.addressFor(tenant, ticketId) };

  /**
   * A queued reply's e-mail, sent after the commit (tm 356.3 · HD-01) — like
   * the ticket notice, handed to `app.backgroundMail` rather than awaited, so
   * the agent's answer depends on neither the carrier's latency nor its
   * failure. How it went is written back to the reply in a transaction of its
   * own and announced to the people working the ticket; the log line carries
   * the ids and the carrier's classification, never the address or the text.
   *
   * `unconfirmed` — handed over, acceptance never confirmed — is written
   * `sent`: the message may well have arrived, and "try again" on it would
   * mail the player the same answer twice.
   */
  const mailReply = (log: FastifyBaseLogger, tenant: TenantContext, mail: TicketReplyOutbound) => {
    app.backgroundMail.send(
      {
        to: mail.to,
        licenseId: tenant.licenseId,
        kind: 'ticket_reply',
        messageId: mail.emailMessageId,
        ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo } : {}),
        references: mail.references,
        ...replyToFor(tenant, mail.ticketId),
        fromName: mail.workspaceName,
        // The player's language is not known to the server — the frame's few
        // words are English, as on the ticket notice.
        ...ticketReplyMail(
          { locale: 'en' },
          {
            workspaceName: mail.workspaceName,
            ticketId: mail.ticketId,
            ticketSubject: mail.ticketSubject,
            body: pilotMode ? withPilotNoReplyLine(mail.body) : mail.body,
            agentName: mail.agentName,
          },
        ),
      },
      async (outcome) => {
        logUnsentMail(log, 'ticket.reply_mail', outcome, {
          ticket_id: mail.ticketId,
          message_id: mail.messageId,
        });
        try {
          const push = await withTenant(app.db, tenant, (tx) =>
            messages.recordDelivery(
              tx,
              mail.messageId,
              outcome.status === 'failed' ? 'failed' : 'sent',
            ),
          );
          if (push) {
            await publisher.publish(
              tenant,
              'ticket_message_delivery_changed',
              push.audience,
              push.payload,
            );
          }
        } catch (error) {
          // The reply stays `queued`; nothing a log reader could act on is lost.
          log.error(
            { err: error, ticket_id: mail.ticketId, message_id: mail.messageId },
            'ticket reply delivery status not recorded',
          );
        }
      },
    );
  };
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

    const { ticket, arrival } = await request.withTenant(async (tx) => {
      const created = await tickets.create(tx, tenant, principal, {
        subject: body.subject,
        ...(body.source_chat_id !== undefined ? { source_chat_id: body.source_chat_id } : {}),
        ...(body.customer_id !== undefined ? { customer_id: body.customer_id } : {}),
        ...(body.group_id !== undefined ? { group_id: body.group_id } : {}),
        ...(body.assignee_id !== undefined ? { assignee_id: body.assignee_id } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
      });
      // The assignee and team as the ticket rules left them (IN-10).
      const arrived = await ticketArrivalPush(tx, created.id, {
        reason: 'created',
        actorId: selfAccountId(principal),
      });
      return { ticket: created, arrival: arrived };
    });
    // After the commit (see `RealtimePublisher`): the console's new-ticket alert.
    if (arrival) {
      await publisher.publish(tenant, 'incoming_ticket', arrival.audience, arrival.payload);
    }

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

    return reply
      .code(201)
      .send(maskTicketContact(ticket, seesPlayerContact(request.requirePrincipal())));
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

      const ticket = await request.withTenant((tx) => tickets.get(tx, principal, ticketId));
      return reply.send(maskTicketContact(ticket, seesPlayerContact(principal)));
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

      const { ticket, notice, arrival } = await request.withTenant(async (tx) => {
        // Handing a ticket to somebody is news to them (IN-10): note who held it.
        const heldBy =
          body.assignee_id !== undefined
            ? (
                await tx.ticket.findUnique({
                  where: { id: ticketId },
                  select: { assigneeId: true },
                })
              )?.assigneeId
            : undefined;
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

        // The frame around the workspace's own words (tm 265) names it.
        const organization = mail
          ? await tx.organization.findUnique({
              where: { id: tenant.organizationId },
              select: { name: true },
            })
          : null;
        const handedOver =
          body.assignee_id != null && heldBy !== undefined && heldBy !== body.assignee_id;
        return {
          ticket: updated,
          notice: mail ? { ...mail, workspaceName: organization?.name ?? 'SiyahTuş' } : null,
          arrival: handedOver
            ? await ticketArrivalPush(tx, ticketId, {
                reason: 'assigned',
                actorId: selfAccountId(principal),
              })
            : null,
        };
      });
      if (arrival) {
        await publisher.publish(tenant, 'incoming_ticket', arrival.audience, arrival.payload);
      }

      // After the commit, never inside it: a mail must not be able to hold a
      // transaction open or be undone by a rollback. Handed off rather than
      // awaited (tm 256.4): the transition is already durable, so the agent's
      // answer depends on neither the carrier's latency nor its failure — a 500
      // would tell them it did not happen, and a hung server made them wait
      // ~33 s to learn that it had. A failure is logged with the template id and
      // the carrier's classification, never the message: this line goes to the
      // same log the body is deliberately kept out of.
      if (notice) {
        app.backgroundMail.send(
          {
            to: notice.to,
            licenseId: tenant.licenseId,
            kind: 'ticket_notice',
            ...replyToFor(tenant, ticketId),
            // The workspace's subject and text, untouched, in the shared frame
            // (tm 265). The customer's language is not known to the server, so
            // the frame's few words are English.
            ...ticketNoticeMail(
              { locale: 'en' },
              {
                workspaceName: notice.workspaceName,
                subject: notice.subject,
                // Added here, at the send, rather than by the renderer: the line
                // is the deployment's statement, not part of the workspace's
                // template.
                body: pilotMode ? withPilotNoReplyLine(notice.body) : notice.body,
              },
            ),
          },
          (outcome) =>
            logUnsentMail(request.log, 'ticket.notice_mail', outcome, {
              template_id: notice.templateId,
              ticket_id: ticketId,
            }),
        );
      }

      return reply.send(maskTicketContact(ticket, seesPlayerContact(request.requirePrincipal())));
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

      return reply.send(maskTicketContact(ticket, seesPlayerContact(request.requirePrincipal())));
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

      return reply.send(maskTicketContact(ticket, seesPlayerContact(request.requirePrincipal())));
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

      return reply.send(maskTicketContact(ticket, seesPlayerContact(request.requirePrincipal())));
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

      return reply.send(maskTicketContact(ticket, seesPlayerContact(request.requirePrincipal())));
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

      return reply.send(maskTicketContact(ticket, seesPlayerContact(request.requirePrincipal())));
    },
  );

  // --- The conversation (HD-01 · tm 356): replies, notes, the player's mail ----

  app.get<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId/messages',
    { config: { scopes: READ_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const query = parse(messageListQuery, request.query);
      const principal = request.requirePrincipal();

      const page = await request.withTenant((tx) =>
        messages.list(tx, principal, ticketId, {
          limit: query.limit,
          ...(query.page_id !== undefined ? { pageId: query.page_id } : {}),
        }),
      );

      return reply.send({
        items: page.items,
        ...(page.nextPageId ? { next_page_id: page.nextPageId } : {}),
      });
    },
  );

  app.post<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId/messages',
    { config: { scopes: WRITE_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const body = parse(messageBody, request.body);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const audit = request.auditContext();

      // The files first, outside the transaction: the store may be a bucket
      // across the network, and nothing about it needs the ticket locked.
      const attachments = await resolveAttachments(store, tenant.licenseId, body.attachment_keys);

      const written = await request.withTenant((tx) =>
        messages.createFromComposer(tx, tenant, principal, audit, ticketId, {
          kind: body.kind,
          text: body.text,
          attachments,
          idempotencyKey: body.idempotency_key,
          ...(body.set_status !== undefined ? { setStatus: body.set_status } : {}),
        }),
      );

      // After the commit (see `RealtimePublisher`): announced inside the
      // transaction, a listener could fetch the thread before the message is
      // in it. A replay announces nothing — the first attempt already did.
      if (written.push) {
        await publisher.publish(
          tenant,
          'ticket_message_created',
          written.push.audience,
          written.push.payload,
        );
      }
      // Only a reply just stored `queued` carries one — never a note, a replay
      // or a reply this deployment does not mail (K23).
      if (written.outbound) mailReply(request.log, tenant, written.outbound);

      return reply.code(written.replayed ? 200 : 201).send(written.message);
    },
  );

  app.post<{ Params: { ticketId: string; messageId: string } }>(
    '/tickets/:ticketId/messages/:messageId/resend',
    { config: { scopes: WRITE_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const messageId = parse(z.string().uuid(), request.params.messageId);
      const tenant = request.tenant();
      const principal = request.requirePrincipal();

      const resent = await request.withTenant((tx) =>
        messages.resend(tx, tenant, principal, ticketId, messageId),
      );

      if (resent.push) {
        await publisher.publish(
          tenant,
          'ticket_message_delivery_changed',
          resent.push.audience,
          resent.push.payload,
        );
      }
      if (resent.outbound) mailReply(request.log, tenant, resent.outbound);

      return reply.send(resent.message);
    },
  );

  /**
   * One file of a message (tm 357 · HD-02) — the only door a file the player
   * e-mailed opens through; `GET /uploads/{key}` does not serve those keys.
   *
   * The ticket, the message and the role decide in the transaction, and a
   * sensitive file's opening is audited there; the bytes are read after it, so
   * no row lock waits on the store. The entry therefore records an opening the
   * caller was allowed — should the store then fail, the 503 says so too.
   */
  app.get<{ Params: { ticketId: string; messageId: string; attachmentKey: string } }>(
    '/tickets/:ticketId/messages/:messageId/attachments/:attachmentKey',
    { config: { scopes: READ_SCOPES } },
    async (request, reply) => {
      const ticketId = parse(ticketIdSchema, request.params.ticketId);
      const { messageId, attachmentKey } = request.params;
      const tenant = request.tenant();
      const principal = request.requirePrincipal();
      const audit = request.auditContext();

      // The licence inside the key, as `GET /uploads/{key}` checks it — RLS
      // already confines the message, this keeps the store's read to it too.
      const owner = licenseOfStoredKey(attachmentKey);
      if (owner === null || owner !== tenant.licenseId) {
        throw ApiError.notFound('Attachment not found.');
      }
      const file = await request.withTenant((tx) =>
        messages.openAttachment(tx, principal, audit, ticketId, messageId, attachmentKey),
      );

      const stored = await store.get(attachmentKey);
      if (!stored) throw ApiError.notFound('Attachment not found.');
      return (
        reply
          .header('content-type', stored.contentType)
          // Never inline, as for every upload: the console fetches the bytes and
          // draws them itself (an image) or offers them as a download.
          .header('content-disposition', 'attachment')
          .header('x-content-type-options', 'nosniff')
          // An identity document is not left in a browser cache for the next
          // person at the desk; an ordinary file may be, privately.
          .header('cache-control', file.sensitive ? 'no-store' : 'private, max-age=86400')
          .send(stored.bytes)
      );
    },
  );
}
