import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { EVENT_RECIPIENTS, EVENT_TYPES, TRANSFER_REASONS, isShortId } from '@nexa/types';
import { ApiError } from '../lib/api-error.js';
import { ChatService } from '../services/chat/chat-service.js';
import { hasChatScope } from '../services/chat/access.js';

const chatIdSchema = z.string().refine(isShortId, 'not a valid chat id');

const listQuery = z.object({
  view: z.enum(['all', 'my', 'queued', 'unassigned', 'archived']).default('all'),
  customer_id: z.string().uuid().optional(),
  group_id: z.coerce.bigint().optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page_id: z.string().max(512).optional(),
});

const newEventSchema = z.object({
  type: z.enum(EVENT_TYPES).default('message'),
  text: z.string().max(10_000).optional(),
  recipients: z.enum(EVENT_RECIPIENTS).default('all'),
  attachment_url: z.string().url().max(2048).optional(),
  properties: z.record(z.unknown()).optional(),
  idempotency_key: z.string().min(1).max(128).optional(),
});

const startChatSchema = z.object({
  customer_id: z.string().uuid(),
  group_ids: z.array(z.coerce.bigint()).max(20).optional(),
  assign_to_me: z.boolean().default(true),
  initial_event: newEventSchema.optional(),
});

const transferSchema = z.object({
  group_id: z.coerce.bigint().optional(),
  agent_id: z.string().uuid().optional(),
  reason: z.enum(TRANSFER_REASONS).default('manual'),
});

const tagSchema = z.object({ tag: z.string().trim().min(1).max(64) });
const seenSchema = z.object({ seen_up_to: z.coerce.date() });

const eventsQuery = z.object({
  thread_id: z.string().optional(),
  after_event_id: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
      { fields: result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) },
    );
  }
  return result.data;
}

export default async function chatRoutes(app: FastifyInstance): Promise<void> {
  const chats = new ChatService(app.db, app.redis);

  /**
   * An event body must carry something. A `message` with neither text nor an
   * attachment renders as an empty bubble the recipient cannot interpret.
   */
  function normaliseEvent(raw: z.infer<typeof newEventSchema>) {
    if (raw.type === 'message' && !raw.text?.trim() && !raw.attachment_url) {
      throw ApiError.validation('A message must have text or an attachment.');
    }
    return {
      type: raw.type,
      recipients: raw.recipients,
      ...(raw.text !== undefined ? { text: raw.text } : {}),
      ...(raw.attachment_url !== undefined ? { attachmentUrl: raw.attachment_url } : {}),
      ...(raw.properties !== undefined ? { properties: raw.properties } : {}),
      ...(raw.idempotency_key !== undefined ? { idempotencyKey: raw.idempotency_key } : {}),
    };
  }

  // --- GET /chats -----------------------------------------------------------

  app.get(
    '/chats',
    { config: { scopes: ['chats--all:ro', 'chats--access:ro'] } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);
      const principal = request.requirePrincipal();

      const result = await chats.list(request.tenant(), principal, {
        view: query.view,
        sort: query.sort,
        limit: query.limit,
        ...(query.customer_id !== undefined ? { customerId: query.customer_id } : {}),
        ...(query.group_id !== undefined ? { groupId: query.group_id } : {}),
        ...(query.page_id !== undefined ? { pageId: query.page_id } : {}),
      });

      return reply.send({
        items: result.items,
        ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
      });
    },
  );

  // --- POST /chats ----------------------------------------------------------

  app.post(
    '/chats',
    { config: { scopes: ['chats--all:rw', 'chats--access:rw'] } },
    async (request, reply) => {
      const body = parse(startChatSchema, request.body);
      const principal = request.requirePrincipal();

      const { chat, created } = await chats.start(request.tenant(), principal, {
        customerId: body.customer_id,
        assignToMe: body.assign_to_me,
        ...(body.group_ids !== undefined ? { groupIds: body.group_ids } : {}),
        ...(body.initial_event !== undefined
          ? { initialEvent: normaliseEvent(body.initial_event) }
          : {}),
      });

      return reply.status(created ? 201 : 200).send(chat);
    },
  );

  // --- GET /chats/:chatId ---------------------------------------------------

  app.get<{ Params: { chatId: string } }>(
    '/chats/:chatId',
    {
      config: {
        scopes: ['chats--all:ro', 'chats--access:ro'],
        principals: ['agent', 'bot', 'customer'],
      },
    },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const chat = await chats.get(request.tenant(), request.requirePrincipal(), chatId);
      return reply.send(chat);
    },
  );

  // --- Events ---------------------------------------------------------------

  app.get<{ Params: { chatId: string } }>(
    '/chats/:chatId/events',
    {
      config: {
        scopes: ['chats--all:ro', 'chats--access:ro'],
        // The customer reads their own transcript here; internal notes are
        // filtered out in SQL for them.
        principals: ['agent', 'bot', 'customer'],
      },
    },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const query = parse(eventsQuery, request.query);

      const result = await chats.listEvents(request.tenant(), request.requirePrincipal(), chatId, {
        limit: query.limit,
        ...(query.thread_id !== undefined ? { threadId: query.thread_id } : {}),
        ...(query.after_event_id !== undefined ? { afterEventId: query.after_event_id } : {}),
      });

      return reply.send({
        items: result.items,
        ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
      });
    },
  );

  app.post<{ Params: { chatId: string } }>(
    '/chats/:chatId/events',
    {
      config: {
        scopes: ['chats--all:rw', 'chats--access:rw'],
        principals: ['agent', 'bot', 'customer'],
      },
    },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const body = parse(newEventSchema, request.body);

      const { event, replayed } = await chats.sendEvent(
        request.tenant(),
        request.requirePrincipal(),
        chatId,
        normaliseEvent(body),
      );

      // 200 rather than 201 on replay: nothing was created this time.
      return reply.status(replayed ? 200 : 201).send(event);
    },
  );

  // --- Lifecycle ------------------------------------------------------------

  app.post<{ Params: { chatId: string } }>(
    '/chats/:chatId/deactivate',
    { config: { scopes: ['chats--all:rw', 'chats--access:rw'] } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const chat = await chats.deactivate(request.tenant(), request.requirePrincipal(), chatId);
      return reply.send(chat);
    },
  );

  app.post<{ Params: { chatId: string } }>(
    '/chats/:chatId/resume',
    { config: { scopes: ['chats--all:rw', 'chats--access:rw'] } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const chat = await chats.resume(request.tenant(), request.requirePrincipal(), chatId);
      return reply.send(chat);
    },
  );

  app.post<{ Params: { chatId: string } }>(
    '/chats/:chatId/transfer',
    { config: { scopes: ['chats--all:rw', 'chats--access:rw'] } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const body = parse(transferSchema, request.body ?? {});

      const chat = await chats.transfer(request.tenant(), request.requirePrincipal(), chatId, {
        reason: body.reason,
        ...(body.group_id !== undefined ? { groupId: body.group_id } : {}),
        ...(body.agent_id !== undefined ? { agentId: body.agent_id } : {}),
      });
      return reply.send(chat);
    },
  );

  // --- Tags -----------------------------------------------------------------

  app.post<{ Params: { chatId: string } }>(
    '/chats/:chatId/tags',
    {
      config: { scopes: ['tags--all:rw', 'tags--groups:rw', 'chats--all:rw', 'chats--access:rw'] },
    },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const body = parse(tagSchema, request.body);
      const principal = request.requirePrincipal();

      // Tagging mutates the conversation, so chat-write is required in addition
      // to whatever tag scope let the request through.
      if (!hasChatScope(principal, 'write')) {
        throw ApiError.authorization('Tagging a conversation requires chat write access.');
      }

      const tags = await chats.tagThread(request.tenant(), principal, chatId, body.tag);
      return reply.send({ tags });
    },
  );

  app.delete<{ Params: { chatId: string; tagName: string } }>(
    '/chats/:chatId/tags/:tagName',
    {
      config: { scopes: ['tags--all:rw', 'tags--groups:rw', 'chats--all:rw', 'chats--access:rw'] },
    },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const principal = request.requirePrincipal();
      if (!hasChatScope(principal, 'write')) {
        throw ApiError.authorization('Untagging a conversation requires chat write access.');
      }

      await chats.untagThread(
        request.tenant(),
        principal,
        chatId,
        decodeURIComponent(request.params.tagName),
      );
      return reply.status(204).send();
    },
  );

  // --- Read receipts --------------------------------------------------------

  app.post<{ Params: { chatId: string } }>(
    '/chats/:chatId/seen',
    {
      config: {
        scopes: ['chats--all:ro', 'chats--access:ro'],
        principals: ['agent', 'bot', 'customer'],
      },
    },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const body = parse(seenSchema, request.body);

      await chats.markSeen(request.tenant(), request.requirePrincipal(), chatId, body.seen_up_to);
      return reply.status(204).send();
    },
  );
}
