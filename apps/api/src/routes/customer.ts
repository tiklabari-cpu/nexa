/**
 * Customer Chat API — the surface the widget talks to.
 *
 * Separate from the agent routes because the shapes genuinely differ: a
 * customer has one conversation and no concept of teams, assignment or notes.
 * Reusing the agent endpoints and filtering afterwards would mean every future
 * field added there is exposed to the widget until someone remembers to hide it.
 *
 * Every route here is `principals: ['customer']`. An agent token reaching them
 * would work, but the agent API is what agents should use, and keeping the two
 * disjoint means the widget surface can be reasoned about on its own.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SNEAK_PEEK_MAX_LENGTH, typingStateKey } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { maskCardNumbers, maskOptional } from '../lib/cc-mask.js';
import { isIpBanned } from '../lib/banned-ip.js';
import { evaluateSpam, isSpamFilterEnabled } from '../services/security/spam-filter.js';
import type { Env } from '../config/env.js';
import { ChatService } from '../services/chat/chat-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';
import { CustomerService } from '../services/customers/customer-service.js';
import { CustomFieldService } from '../services/custom-fields/custom-field-service.js';
import { AiResponder } from '../services/ai/ai-responder.js';
import { LocalStore } from '../services/storage/local-store.js';
import { assertUploadedAttachment } from '../services/storage/attachment.js';
import type { Mailer } from '../services/mail/mailer.js';
import { shouldEmailAssignee } from '../services/notifications/assignee-email.js';

const startSchema = z
  .object({
    // Optional now that an attachment can stand alone (FR-MOD-11.4): a visitor
    // may send just a screenshot. The either/or is enforced by the refine below,
    // the same invariant the agent path applies in `chats.ts`.
    text: z.string().trim().max(10_000).optional(),
    /** A file the visitor uploaded through `/uploads`, validated before use. */
    attachment_url: z.string().max(2048).optional(),
    /** Page the visitor is on — feeds the routing rules. */
    url: z.string().max(2048).optional(),
    /** Optional pre-chat form values. */
    name: z.string().trim().max(120).optional(),
    email: z.string().email().max(320).optional(),
    /**
     * Pre-chat form answers (FR-MOD-08.7.7): a map of contact custom-field id →
     * value, validated against each field's definition (type + required) and
     * written to the contact. A `null` clears a field.
     */
    custom_fields: z.record(z.string().max(5000).nullable()).optional(),
    idempotency_key: z.string().min(1).max(128).optional(),
  })
  .refine((body) => Boolean(body.text?.trim()) || Boolean(body.attachment_url), {
    message: 'A message must have text or an attachment.',
  });

const rateSchema = z.object({
  value: z.enum(['good', 'bad']),
  comment: z.string().trim().max(1000).optional(),
});

const typingSchema = z.object({
  is_typing: z.boolean(),
  // The in-progress text shown to the agent as a sneak-peek. Capped here as well
  // as at the fan-out, so an oversized body is rejected before any work.
  text: z.string().max(SNEAK_PEEK_MAX_LENGTH).optional(),
});

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

export default async function customerRoutes(
  app: FastifyInstance,
  { env, mailer }: { env: Env; mailer: Mailer },
): Promise<void> {
  const publisher = new RealtimePublisher(app.redis, app.log);
  const chats = new ChatService(app.db, app.redis, publisher);
  const customerDirectory = new CustomerService();
  const customFields = new CustomFieldService();
  const ai = new AiResponder(chats, publisher);
  const store = new LocalStore(env.STORAGE_LOCAL_DIR);

  /**
   * Email the human assigned to a chat that their visitor wrote in
   * (FR-MOD-13.8, the e-mail channel). Best-effort on purpose: the message is
   * already persisted and delivered over realtime, so a mail failure must not
   * fail the visitor's send. Only fires when there is a human assignee — a
   * queued or AI-only chat has nobody to e-mail, and emailing on every message
   * to an unassigned chat would be noise.
   */
  async function notifyAssignee(request: FastifyRequest, chatId: string): Promise<void> {
    try {
      const licenseId = request.tenant().licenseId;
      const channel = await request.withTenant(async (tx) => {
        const thread = await tx.thread.findFirst({
          where: { chatId, active: true },
          orderBy: { createdAt: 'desc' },
          select: { assigneeId: true },
        });
        if (!thread?.assigneeId) return null;

        // The account carries the address; the membership carries the per-user,
        // per-license opt-in — read together so the decision has both.
        const [account, membership] = await Promise.all([
          tx.account.findUnique({
            where: { id: thread.assigneeId },
            select: { email: true, name: true },
          }),
          tx.agentMembership.findUnique({
            where: { licenseId_agentId: { licenseId, agentId: thread.assigneeId } },
            select: { notifyEmail: true },
          }),
        ]);

        return {
          email: account?.email ?? null,
          name: account?.name ?? null,
          // No membership row would be an inconsistency, not an opt-out; default
          // on, matching the column default.
          emailEnabled: membership?.notifyEmail ?? true,
        };
      });

      // Honours the opt-out and the no-assignee/no-address cases in one place
      // (FR-MOD-13.8); the guard narrows `email` to a string for the send.
      if (!shouldEmailAssignee(channel)) return;

      await mailer.send({
        to: channel.email,
        kind: 'notification',
        subject: 'New message from a visitor',
        body: `Hi ${channel.name ?? 'there'},\n\nA visitor sent a new message in a conversation assigned to you.\n\nOpen it here:\n${env.WEB_APP_URL}/app/inbox`,
      });
    } catch (error) {
      // The realtime push already reached the agent; the e-mail is a courtesy.
      request.log.warn({ err: error, chatId }, 'assignee notification e-mail failed');
    }
  }

  /**
   * The widget's whole conversation state in one call.
   *
   * One round-trip on load rather than three: on a slow connection the
   * difference is whether the panel opens with the conversation already in it.
   */
  app.get('/customer/chat', { config: { principals: ['customer'] } }, async (request, reply) => {
    const principal = request.requirePrincipal();
    if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

    const state = await request.withTenant(async (tx) => {
      const chat = await tx.chat.findFirst({
        where: { customerId: principal.customerId, active: true },
        include: {
          threads: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      const [agentsOnline, customer] = await Promise.all([
        tx.agentMembership.count({
          where: { routingStatus: 'accepting_chats', suspended: false },
        }),
        tx.customer.findUnique({
          where: { id: principal.customerId },
          select: { name: true, email: true },
        }),
      ]);

      // Who the visitor is talking to (FR-MOD-11.3). A human assignee wins — it
      // is a real person on the other end — otherwise the active AI persona,
      // which is who answers first when one is configured.
      const assigneeId = chat?.threads[0]?.assigneeId ?? null;
      const responder = assigneeId
        ? await tx.account.findUnique({
            where: { id: assigneeId },
            select: { name: true, avatarUrl: true },
          })
        : // The customer-facing persona only — `kind: 'copilot'` is the agent's
          // assistant, not who the visitor is talking to. Oldest-first so the
          // choice is stable when more than one exists.
          await tx.aiAgent.findFirst({
            where: { active: true, kind: 'ai_agent' },
            orderBy: { createdAt: 'asc' },
            select: { name: true, avatarUrl: true },
          });

      return { chat, agentsOnline, customer, responder };
    });

    const events = state.chat
      ? await chats.listEvents(request.tenant(), principal, state.chat.id, { limit: 100 })
      : { items: [] };

    // Whether an agent is mid-reply (FR-MOD-02.9). The widget polls and holds no
    // socket, so an agent's typing cannot be pushed to it — the RTM gateway
    // writes a short-lived flag on each keystroke and it is read back here.
    const agentTyping = state.chat
      ? (await app.redis.get(typingStateKey(request.tenant().licenseId, state.chat.id))) !== null
      : false;

    return reply.send({
      // The widget shows "we're away" rather than pretending someone will
      // answer immediately.
      online: state.agentsOnline > 0,
      agent_typing: agentTyping,
      customer: {
        id: principal.customerId,
        name: state.customer?.name ?? null,
        email: state.customer?.email ?? null,
      },
      chat: state.chat
        ? {
            id: state.chat.id,
            thread_id: state.chat.threads[0]?.id ?? null,
            queue_position: state.chat.threads[0]?.queuePosition ?? null,
          }
        : null,
      // The name and face the widget shows in its header, so the visitor knows
      // whether they are talking to a person or the AI persona (FR-MOD-11.3).
      agent: state.responder
        ? { name: state.responder.name, avatar_url: state.responder.avatarUrl }
        : null,
      events: events.items,
    });
  });

  /**
   * Send a message, opening a conversation if there is not one already.
   *
   * A single endpoint because from the widget's side there is no difference: a
   * visitor types and presses enter. Making the client decide between "start"
   * and "send" invites a race where two first messages both try to start.
   */
  app.post(
    '/customer/chat/events',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const body = parse(startSchema, request.body);
      const tenant = request.tenant();

      // An IP ban (FR-MOD-08.9.2) refuses the conversation itself, not just the
      // token: a token minted before the ban would otherwise still let the
      // address open or continue a chat. Enforced here — the one visitor-facing
      // write path — so "a banned visitor cannot start a chat" holds even for a
      // session that was already live. The identity ban (`Customer.bannedAt`) is
      // enforced deeper in `chat-service`; this is the address-based half.
      if (await request.withTenant((tx) => isIpBanned(tx, request.ip))) {
        throw new ApiError('customer_banned', 'This customer is banned.');
      }

      // Mask a card number the moment the message arrives (FR-MOD-08.9.5), then
      // use the masked text for everything downstream — the persisted event, the
      // realtime push and the AI skill matcher — so a raw PAN never reaches the
      // database, a log or the AI path.
      const maskedText = maskOptional(body.text);

      // An attachment must be a file this workspace uploaded through `/uploads`
      // (FR-MOD-08.9.4) — the same check the agent path runs, before it can be
      // stored on an event.
      if (body.attachment_url) {
        await assertUploadedAttachment(store, tenant.licenseId, body.attachment_url);
      }

      // The one active conversation, if there is one. Fetched here — before any
      // pre-chat write — because the spam filter below screens only the message
      // that would OPEN a chat, and a refused chat-start must leave no trace.
      const existing = await request.withTenant((tx) =>
        tx.chat.findFirst({
          where: { customerId: principal.customerId, active: true },
          select: { id: true },
        }),
      );

      // Spam filter (FR-MOD-08.9.3): screen the message that would open a chat.
      // A spam conversation floods the queue; screening only chat-start — not
      // every message in an established thread — keeps the false-positive cost
      // off a legitimate visitor mid-conversation (who may, say, paste several
      // links). Gated by the per-workspace spamFilterEnabled (schema default on)
      // and routed through the same deterministic engine the email channel uses.
      if (!existing && maskedText) {
        const spamFilterOn = await request.withTenant((tx) => isSpamFilterEnabled(tx));
        if (evaluateSpam({ filterEnabled: spamFilterOn, text: maskedText }).spam) {
          // An enveloped refusal, like the co-located banned-IP check: a
          // synchronous widget request has nothing to return once the chat is
          // refused, and a silent 2xx would leave a false-positive visitor
          // staring at a message no agent ever answers. The message is generic
          // on purpose — it names no rule, so the filter cannot be probed — and
          // nothing (no chat, no customer field write) is persisted.
          throw new ApiError('message_rejected', 'This message could not be sent.');
        }
      }

      // Pre-chat details, if the visitor gave them.
      if (body.name || body.email) {
        await request.withTenant((tx) =>
          tx.customer.update({
            where: { id: principal.customerId },
            data: {
              ...(body.name ? { name: body.name } : {}),
              ...(body.email ? { email: body.email, isLead: true } : {}),
              lastActivityAt: new Date(),
            },
          }),
        );
      }

      // Pre-chat form answers (FR-MOD-08.7.7): validated against their contact
      // custom-field definitions and written to the contact, one transaction so
      // it is all-or-nothing. An ill-typed value or a blank required field throws
      // a 400 here — before any chat is opened, so a bad form never leaves a
      // half-started conversation behind.
      if (body.custom_fields && Object.keys(body.custom_fields).length > 0) {
        // Pre-chat answers are visitor free text too — mask each value at the
        // source (FR-MOD-08.9.5) before it is written to the contact.
        const maskedFields = Object.fromEntries(
          Object.entries(body.custom_fields).map(([key, value]) => [key, maskOptional(value)]),
        );
        await request.withTenant((tx) =>
          customFields.setValues(tx, tenant, 'contact', principal.customerId, maskedFields),
        );
      }

      // The page the visitor wrote from. Recorded on a best-effort basis: it
      // feeds the "Visited pages" panel an agent reads for context, and losing
      // that context is not worth failing the message the visitor is trying to
      // send.
      if (body.url) {
        try {
          await request.withTenant((tx) =>
            customerDirectory.recordPageView(tx, tenant, {
              customerId: principal.customerId,
              url: body.url!,
              userAgent: request.headers['user-agent'],
              ip: request.ip,
            }),
          );
        } catch (error) {
          request.log.warn({ err: error }, 'could not record page view');
        }
      }

      if (existing) {
        const { event, replayed } = await chats.sendEvent(tenant, principal, existing.id, {
          type: 'message',
          ...(maskedText !== undefined ? { text: maskedText } : {}),
          ...(body.attachment_url ? { attachmentUrl: body.attachment_url } : {}),
          recipients: 'all',
          ...(body.idempotency_key ? { idempotencyKey: body.idempotency_key } : {}),
        });

        // A replay is the same message arriving twice; running the skill again
        // would answer the customer twice for one question. An attachment with no
        // text gives the skill nothing to match, so it is left for a human.
        if (!replayed && maskedText?.trim()) await ai.handle(request, existing.id, maskedText);

        // A replay is the same message arriving twice — do not e-mail again.
        if (!replayed) await notifyAssignee(request, existing.id);

        return reply.status(replayed ? 200 : 201).send({ chat_id: existing.id, event });
      }

      const { chat } = await chats.start(tenant, principal, {
        customerId: principal.customerId,
        // Never self-assign: the customer is not an agent, and routing decides.
        assignToMe: false,
        initialEvent: {
          type: 'message',
          ...(maskedText !== undefined ? { text: maskedText } : {}),
          ...(body.attachment_url ? { attachmentUrl: body.attachment_url } : {}),
          recipients: 'all',
          ...(body.idempotency_key ? { idempotencyKey: body.idempotency_key } : {}),
        },
        ...(body.url ? { routing: { url: body.url } } : {}),
      });

      if (maskedText?.trim()) await ai.handle(request, chat.id, maskedText);

      // Routing may have assigned this brand-new chat to an agent — that is the
      // "assignment" notification (FR-MOD-13.8).
      await notifyAssignee(request, chat.id);

      const events = await chats.listEvents(tenant, principal, chat.id, { limit: 10 });
      return reply.status(201).send({
        chat_id: chat.id,
        queue_position: chat.thread?.queue_position ?? null,
        event: events.items.at(-1) ?? null,
      });
    },
  );

  /**
   * Live typing preview from the visitor's side (FR-MOD-02.9 / 11.8).
   *
   * The widget calls this — debounced — while the visitor types, so the agent
   * sees "the visitor is typing" and a preview of the in-progress message. It is
   * ephemeral: nothing is written to the conversation, and the preview reaches
   * agents only, never echoed back to the visitor. Typing into a panel with no
   * open conversation is a no-op, not an error.
   */
  app.post(
    '/customer/chat/typing',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const body = parse(typingSchema, request.body);

      const chat = await request.withTenant((tx) =>
        tx.chat.findFirst({
          where: { customerId: principal.customerId, active: true },
          select: { id: true },
        }),
      );

      if (chat) {
        await chats.publishCustomerTyping(request.tenant(), principal, chat.id, {
          isTyping: body.is_typing,
          // The sneak-peek is pushed to the agent as the visitor types; mask a
          // card there too (FR-MOD-08.9.5) so a PAN is not exposed mid-type.
          ...(body.text !== undefined ? { text: maskOptional(body.text) } : {}),
        });
      }

      return reply.status(204).send();
    },
  );

  /** Close the conversation from the customer's side. */
  app.post(
    '/customer/chat/close',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const chat = await request.withTenant((tx) =>
        tx.chat.findFirst({
          where: { customerId: principal.customerId, active: true },
          select: { id: true },
        }),
      );
      if (!chat) throw ApiError.chatInactive('There is no open conversation.');

      await chats.deactivate(request.tenant(), principal, chat.id);
      return reply.status(204).send();
    },
  );

  /** Customer satisfaction rating (FR-MOD-11). */
  app.post(
    '/customer/chat/rating',
    { config: { principals: ['customer'] } },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');

      const body = parse(rateSchema, request.body);
      const tenant = request.tenant();

      const rating = await request.withTenant(async (tx) => {
        // The most recent conversation, open or not: ratings usually arrive
        // just after it closes.
        const chat = await tx.chat.findFirst({
          where: { customerId: principal.customerId },
          orderBy: { createdAt: 'desc' },
          include: { threads: { orderBy: { createdAt: 'desc' }, take: 1 } },
        });
        if (!chat) throw ApiError.notFound('No conversation to rate.');

        return tx.rating.create({
          data: {
            chatId: chat.id,
            licenseId: tenant.licenseId,
            threadId: chat.threads[0]?.id ?? null,
            value: body.value,
            // A rating comment is visitor free text written to the database —
            // masked at the source like every other write path (FR-MOD-08.9.5).
            ...(body.comment ? { comment: maskCardNumbers(body.comment) } : {}),
          },
          select: { id: true, value: true, chatId: true },
        });
      });

      return reply.status(201).send({
        id: rating.id,
        value: rating.value,
        chat_id: rating.chatId,
      });
    },
  );
}
