/**
 * Where the unresolved questions are written (tm 317.1 · SiyahTuş analysis
 * AI-22): one `ai_unresolved_items` row per message the AI could not
 * resolve. Two writers:
 *
 *   - **the AI's live turn** (`ai-responder.ts`), once its reply is out: the
 *     turn decided why (`TurnResult.unresolved`) and hands over the words and
 *     the embedding its search already made — no provider is asked again;
 *   - **the close of a conversation** (`ChatService`: an archive, the player's
 *     own close, the inactivity sweep), after it committed: a connection the
 *     AI kept, whose last word was a question the player never answered, is
 *     `player_abandoned` ({@link recordAbandonment}).
 *
 * What both keep is the same (AI-22 §2): the player's message and the
 * player's message before it, masked under the player's policy (AI-26 — the
 * transcript is masked already; this is the second line, as for every AI
 * record), with a message that says nothing worth grouping left out
 * (`unresolvedTextOf`). A conversation a compliance rule touched is never
 * written (`UNRESOLVED_EXCLUDED_GUARDRAILS`): self-exclusion, self-harm, a
 * minor and the rest are AI-27's and AI-24's, not a gap in the AI's knowledge.
 *
 * The rows go with their chat (erasure deletes the customer and its chats)
 * and their thread (the retention sweep), and after
 * `UNRESOLVED_TEXT_RETENTION_DAYS` whatever the conversation's window (the
 * sweep, AI-22-S1). It lives beside `ai-digest.ts` for the same reason: the
 * close path, which the rule bot shares, reaches no module of the AI service
 * (`bots/rule-bot-isolation.test.ts`).
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  UNRESOLVED_EXCLUDED_GUARDRAILS,
  parseEventId,
  unresolvedTextOf,
  type UnresolvedReason,
} from '@siyahtus/types';
import { maskForWrite } from '../../lib/sensitive-mask.js';
import type { TenantClient } from '../../lib/tenant.js';

/** A vector as the turn's search made it: a pgvector literal, and its space. */
export interface UnresolvedEmbedding {
  space: string;
  vector: string;
}

/** One unresolved message, as a writer hands it over. */
export interface UnresolvedItemInput {
  aiAgentId: string;
  brandId: string | null;
  /** The day container (panel "Thread ID"). */
  chatId: string;
  /** The connection (panel "Chat ID"). */
  threadId: string;
  /** The player's message; null when it is not on the connection. */
  eventId: string | null;
  /** The player's words — masked here, whoever wrote them. */
  text: string;
  reason: UnresolvedReason;
  language: string | null;
  intentGuess: string | null;
  configVersionId: string | null;
  embedding: UnresolvedEmbedding | null;
}

const LANGUAGE = /^[a-z]{2}$/;
const INTENT_MAX = 200;

/**
 * Write one item, in the caller's transaction. Null — and nothing written —
 * when the masked words say nothing worth grouping. The context is the
 * player's own message before `eventId` on the same connection.
 */
export async function writeUnresolvedItem(
  tx: TenantClient,
  licenseId: bigint,
  input: UnresolvedItemInput,
): Promise<string | null> {
  const text = unresolvedTextOf(maskForWrite(input.text, 'customer').text);
  if (text === null) return null;
  const at = input.eventId ? parseEventId(input.eventId) : null;
  const before =
    at && at.threadId === input.threadId
      ? await playerMessage(tx, input.threadId, at.sequence)
      : null;
  const context = before?.text
    ? unresolvedTextOf(maskForWrite(before.text, 'customer').text)
    : null;
  const id = randomUUID();
  const language = input.language && LANGUAGE.test(input.language) ? input.language : null;
  const intent = input.intentGuess?.trim().slice(0, INTENT_MAX) || null;
  const embedding = input.embedding
    ? Prisma.sql`CAST(${input.embedding.vector} AS vector), ${input.embedding.space}`
    : Prisma.sql`NULL, NULL`;
  await tx.$executeRaw`
    INSERT INTO ai_unresolved_items (
      id, license_id, ai_agent_id, brand_id, chat_id, thread_id, event_id,
      text_masked, context_masked, language, reason, intent_guess,
      config_version_id, embedding, embedding_space
    ) VALUES (
      ${id}::uuid, ${licenseId}, ${input.aiAgentId}::uuid, ${input.brandId}::uuid,
      ${input.chatId}, ${input.threadId}, ${input.eventId},
      ${text}, ${context}, ${language}, ${input.reason}, ${intent},
      ${input.configVersionId}::uuid, ${embedding}
    )`;
  return id;
}

/**
 * The player's newest message on the connection — before `sequence` when one
 * is given.
 */
async function playerMessage(
  tx: TenantClient,
  threadId: string,
  sequence: number | null,
): Promise<{ id: string; text: string | null } | null> {
  const before = sequence === null ? Prisma.empty : Prisma.sql`AND event_sequence < ${sequence}`;
  const [row] = await tx.$queryRaw<Array<{ id: string; text: string | null }>>`
    SELECT id, text FROM events
     WHERE thread_id = ${threadId}
       AND author_type = 'customer'
       AND recipients = 'all'
       AND type = 'message'
       ${before}
     ORDER BY event_sequence DESC
     LIMIT 1`;
  return row ?? null;
}

/**
 * Whether a compliance rule touched the connection (AI-22 §1): a hit of one
 * of `UNRESOLVED_EXCLUDED_GUARDRAILS` on any of its turns.
 */
async function complianceTouched(tx: TenantClient, threadId: string): Promise<boolean> {
  const hit = await tx.aiGuardrailHit.findFirst({
    where: { threadId, ruleKey: { in: [...UNRESOLVED_EXCLUDED_GUARDRAILS] } },
    select: { id: true },
  });
  return hit !== null;
}

/** The AI's newest decision on a connection, an overtaken draft aside. */
interface LastDecision {
  decision: string;
  /** The agent of the procedure it named; null when it named none. */
  ai_agent_id: string | null;
  language: string | null;
}

async function lastDecision(tx: TenantClient, threadId: string): Promise<LastDecision | null> {
  const [row] = await tx.$queryRaw<LastDecision[]>`
    SELECT d.decision,
           s.ai_agent_id::text AS ai_agent_id,
           COALESCE(d.details #>> '{unanswered,language}', d.details #>> '{understood,language}')
             AS language
      FROM ai_decision_logs d
      LEFT JOIN skills s ON s.id = d.procedure_id
     WHERE d.thread_id = ${threadId} AND d.decision <> 'expired'
     ORDER BY d.created_at DESC
     LIMIT 1`;
  return row ?? null;
}

/**
 * The agent a turn runs on when nothing names one — the newest active skill's
 * (`turn-config.ts`, `turnAgentId`): a knowledge answer's decision names no
 * procedure.
 */
async function defaultAgent(tx: TenantClient): Promise<string | null> {
  const skill = await tx.skill.findFirst({
    where: { active: true, kind: 'ai_agent', aiAgentId: { not: null }, aiAgent: { active: true } },
    orderBy: { updatedAt: 'desc' },
    select: { aiAgentId: true },
  });
  return skill?.aiAgentId ?? null;
}

/**
 * The close's half, after the close committed: a connection no person took,
 * whose AI's newest decision was a question (`asked`) and whose last message
 * is that question — the player left without answering it, and confirmed
 * nothing — is `player_abandoned`, filed under the player's last message.
 * Null when there is nothing to write: any other connection, one a
 * compliance rule touched, words not worth grouping, no agent known.
 */
export async function recordAbandonment(
  tx: TenantClient,
  licenseId: bigint,
  threadId: string,
): Promise<string | null> {
  const thread = await tx.thread.findUnique({
    where: { id: threadId },
    select: { chatId: true, aiMode: true, chat: { select: { brandId: true } } },
  });
  if (!thread || thread.aiMode === null || thread.aiMode === 'human') return null;
  const decided = await lastDecision(tx, threadId);
  if (decided?.decision !== 'asked') return null;
  // The AI's question is the connection's last word: nobody answered it.
  const [lastWord] = await tx.$queryRaw<Array<{ author_type: string }>>`
    SELECT author_type FROM events
     WHERE thread_id = ${threadId}
       AND author_type IN ('customer', 'bot', 'agent')
       AND recipients = 'all'
       AND type = 'message'
     ORDER BY event_sequence DESC
     LIMIT 1`;
  if (lastWord?.author_type !== 'bot') return null;
  const last = await playerMessage(tx, threadId, null);
  if (!last?.text) return null;
  if (await complianceTouched(tx, threadId)) return null;
  const aiAgentId = decided.ai_agent_id ?? (await defaultAgent(tx));
  if (!aiAgentId) return null;
  const conversation = await tx.aiConversation.findFirst({
    where: { threadId },
    select: { configVersionId: true },
  });
  return writeUnresolvedItem(tx, licenseId, {
    aiAgentId,
    brandId: thread.chat.brandId,
    chatId: thread.chatId,
    threadId,
    eventId: last.id,
    text: last.text,
    reason: 'player_abandoned',
    language: decided.language,
    intentGuess: null,
    configVersionId: conversation?.configVersionId ?? null,
    embedding: null,
  });
}
