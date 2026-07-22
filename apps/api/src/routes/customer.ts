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
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { ChatService } from '../services/chat/chat-service.js';
import { RealtimePublisher } from '../services/realtime/publisher.js';

const startSchema = z.object({
  text: z.string().trim().min(1).max(10_000),
  /** Page the visitor is on — feeds the routing rules. */
  url: z.string().max(2048).optional(),
  /** Optional pre-chat form values. */
  name: z.string().trim().max(120).optional(),
  email: z.string().email().max(320).optional(),
  idempotency_key: z.string().min(1).max(128).optional(),
});

const rateSchema = z.object({
  value: z.enum(['good', 'bad']),
  comment: z.string().trim().max(1000).optional(),
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

export default async function customerRoutes(app: FastifyInstance): Promise<void> {
  const publisher = new RealtimePublisher(app.redis, app.log);
  const chats = new ChatService(app.db, app.redis, publisher);

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

      return { chat, agentsOnline, customer };
    });

    const events = state.chat
      ? await chats.listEvents(request.tenant(), principal, state.chat.id, { limit: 100 })
      : { items: [] };

    return reply.send({
      // The widget shows "we're away" rather than pretending someone will
      // answer immediately.
      online: state.agentsOnline > 0,
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

      const existing = await request.withTenant((tx) =>
        tx.chat.findFirst({
          where: { customerId: principal.customerId, active: true },
          select: { id: true },
        }),
      );

      if (existing) {
        const { event, replayed } = await chats.sendEvent(tenant, principal, existing.id, {
          type: 'message',
          text: body.text,
          recipients: 'all',
          ...(body.idempotency_key ? { idempotencyKey: body.idempotency_key } : {}),
        });
        return reply.status(replayed ? 200 : 201).send({ chat_id: existing.id, event });
      }

      const { chat } = await chats.start(tenant, principal, {
        customerId: principal.customerId,
        // Never self-assign: the customer is not an agent, and routing decides.
        assignToMe: false,
        initialEvent: {
          type: 'message',
          text: body.text,
          recipients: 'all',
          ...(body.idempotency_key ? { idempotencyKey: body.idempotency_key } : {}),
        },
        ...(body.url ? { routing: { url: body.url } } : {}),
      });

      const events = await chats.listEvents(tenant, principal, chat.id, { limit: 10 });
      return reply.status(201).send({
        chat_id: chat.id,
        queue_position: chat.thread?.queue_position ?? null,
        event: events.items.at(-1) ?? null,
      });
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
            ...(body.comment ? { comment: body.comment } : {}),
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
