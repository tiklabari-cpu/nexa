/**
 * The AI's hand-over cards on the API (tm 304.1 · SiyahTuş analysis AI-10):
 *
 *   - `GET /chats/{chatId}/ai-handoffs` — a chat's cards, newest first, or one
 *     connection's (`thread_id`);
 *   - `POST /ai-handoffs/{handoffId}/feedback` — an agent marks a card
 *     sufficient or not (AI-10-S2, optional). One verdict per card: the next
 *     click overwrites it, no row is added.
 *
 * Agents only, behind the conversation's visibility like its transcript
 * (`resolveVisibility`): a conversation the caller may not see reads as absent
 * (NFR-S5). A customer token never reaches either — the card is the agents'.
 * The card itself is written by the hand-over (`services/ai/handoff-card.ts`).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AI_HANDOFF_FEEDBACK_REASON_MAX,
  AI_HANDOFF_FEEDBACK_VALUES,
  isShortId,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import type { TenantClient } from '../lib/tenant.js';
import type { Principal } from '../services/auth/principal.js';
import { canSeeChat, resolveVisibility } from '../services/chat/access.js';
import { serialiseAiHandoff } from '../services/chat/ai-handoff-view.js';

const CHAT_READ = ['chats--all:ro', 'chats--access:ro'];
const CHAT_WRITE = ['chats--all:rw', 'chats--access:rw'];

/** A chat's cards, at most — one per hand-over; a day rarely holds more than a few. */
const CARDS_MAX = 100;

const chatIdSchema = z.string().refine(isShortId, 'not a valid chat id');
const listQuery = z.object({ thread_id: z.string().min(1).max(64).optional() }).strict();
const feedbackBody = z
  .object({
    value: z.enum(AI_HANDOFF_FEEDBACK_VALUES),
    reason: z.string().trim().min(1).max(AI_HANDOFF_FEEDBACK_REASON_MAX).optional(),
  })
  .strict();

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

/** The chat, when the caller may see it; otherwise a 404 that says nothing more. */
async function requireVisibleChat(
  tx: TenantClient,
  principal: Principal,
  chatId: string,
): Promise<void> {
  const visibility = await resolveVisibility(tx, principal, 'read');
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    select: {
      customerId: true,
      access: { select: { groupId: true } },
      users: { select: { userId: true, userType: true } },
    },
  });
  if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');
}

export async function aiHandoffRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { chatId: string } }>(
    '/chats/:chatId/ai-handoffs',
    { config: { scopes: CHAT_READ, principals: ['agent', 'bot'] } },
    async (request, reply) => {
      const chatId = parse(chatIdSchema, request.params.chatId);
      const query = parse(listQuery, request.query);
      const principal = request.requirePrincipal();
      const rows = await request.withTenant(async (tx) => {
        await requireVisibleChat(tx, principal, chatId);
        return tx.aiHandoff.findMany({
          where: { chatId, ...(query.thread_id ? { threadId: query.thread_id } : {}) },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: CARDS_MAX,
        });
      });
      return reply.send({ items: rows.map(serialiseAiHandoff) });
    },
  );

  app.post<{ Params: { handoffId: string } }>(
    '/ai-handoffs/:handoffId/feedback',
    { config: { scopes: CHAT_WRITE, principals: ['agent'] } },
    async (request, reply) => {
      const handoffId = parse(z.string().uuid(), request.params.handoffId);
      const body = parse(feedbackBody, request.body);
      const principal = request.requirePrincipal();
      if (principal.kind !== 'agent') throw ApiError.authorization();

      const row = await request.withTenant(async (tx) => {
        const card = await tx.aiHandoff.findUnique({
          where: { id: handoffId },
          select: { chatId: true },
        });
        if (!card) throw ApiError.notFound('Hand-over card not found.');
        // The archive included: whoever sees the conversation may judge its card.
        await requireVisibleChat(tx, principal, card.chatId).catch(() => {
          throw ApiError.notFound('Hand-over card not found.');
        });
        // One verdict per card, the last click's (AI-10 §7): no row is added.
        return tx.aiHandoff.update({
          where: { id: handoffId },
          data: {
            feedback: body.value,
            feedbackReason: body.reason ?? null,
            feedbackBy: principal.accountId,
            feedbackAt: new Date(),
          },
        });
      });
      return reply.send(serialiseAiHandoff(row));
    },
  );
}
