/**
 * What an "AI resolution" is — ADR-09 as narrowed by ADR-09a
 * (`docs/adr/ai-resolution-handoff.md`, owner decision K10 · tm 293.4).
 *
 * A thread is one when it closed with
 *
 *   (a) no `author_type = 'agent'` event in it (ADR-09, unchanged), and
 *   (b) no automatic hand-off: no `chat_transferred` system event whose reason
 *       is one of {@link AUTOMATIC_HANDOFF_REASONS}, and no `ai_mode_changed`
 *       system event whose reason is one of {@link AUTOMATIC_MODE_HANDOVERS}
 *       (the stall watchdog's, tm 293.6). Condition (b) applies only to
 *       threads closed at or after {@link ADR_09A_EFFECTIVE_AT}.
 *
 * Every surface reads this module and nothing else: the billing counter
 * (`usage_records`, `metric = 'ai_resolutions'`) at close, the inbox's
 * `ai_solved` view (and MCP `list_chats` through it), and Reports "Automated"
 * — Overview, Breakdown, the AI Agent report's `resolutions`, CSV and the
 * scheduled reports, which Home, Copilot BI and the command palette read in
 * turn — and the archive's `threads.handled_by = 'ai'` (AR-01 · tm 335.1),
 * written at close by the same statement the counter reads
 * ({@link recordHandledBy}). The predicate has two spellings because Prisma cannot take raw SQL
 * inside a `where`: {@link aiResolvedSql} for every aggregate and for the
 * close-time check, {@link aiResolvedThreadWhere} for the view. They sit next to
 * each other and one test (`ai-resolution-handoff.test.ts`) holds them to the
 * same set of threads; a third spelling anywhere else is how the report and the
 * invoice start to disagree.
 */
import { Prisma } from '@prisma/client';
import type { AiModeReason, ThreadHandledBy, TransferReason } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';

/**
 * When condition (b) starts to count: the first billing period after tm 293.4
 * is deployed — the start of a UTC month, because a period is a UTC month
 * (`currentPeriod`) and each period is counted under one definition, never
 * switched halfway through. Threads that closed earlier keep ADR-09's reading
 * everywhere, so a past period's report still matches the invoice it produced;
 * usage records already written and invoices already issued are not
 * recomputed.
 *
 * Assumption (PLAN §D262): tm 293.4 is deployed in October 2026. Deployed in
 * November or later, this moves to the first of the following month in the
 * same change — a value in the past would switch the rule mid-period.
 *
 * Production only ever uses this value. The functions below take the moment as
 * a parameter so a test can put its own threads on either side of it.
 */
export const ADR_09A_EFFECTIVE_AT = new Date('2026-11-01T00:00:00.000Z');

/**
 * The `chat_transferred` reasons that are a hand-off rather than a transfer
 * between people: the AI's (`ai-responder.ts`) and a rule bot's
 * (`rule-bot-responder.ts`). `manual`, `routing` and `agent_disconnected` move a
 * conversation between agents and leave the predicate alone.
 */
export const AUTOMATIC_HANDOFF_REASONS = [
  'ai_handoff',
  'bot_handoff',
] as const satisfies readonly TransferReason[];

/**
 * The AI mode changes that are a hand-off with no transfer behind them: the
 * stall watchdog sending a person to a conversation the AI left unanswered
 * (`ai_failure`, `ai-stall.ts` · tm 293.6). It routes the connection without a
 * `chat_transferred` event — nobody moved it between teams — so the one line
 * it leaves, `system_event: 'ai_mode_changed'`, is what the predicate reads.
 * The other reasons either come with a transfer (counted above) or are a
 * person's doing (an agent writing is condition (a)).
 */
export const AUTOMATIC_MODE_HANDOVERS = ['ai_failure'] as const satisfies readonly AiModeReason[];

/** (a) A person wrote in the thread — an internal note included. */
const AGENT_WROTE = Prisma.sql`EXISTS (
  SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'agent'
)`;

/**
 * (b) The thread was handed off automatically, at any point. "Once handed off,
 * never an AI resolution" (ADR-09a §2.5): the AI being given the conversation
 * back later does not undo it, so this is one existence check, not a question
 * about what happened after the last hand-off.
 *
 * `author_type = 'system'` because the server is the only writer of a transfer
 * event (`ChatService.transfer`) and of a mode line (`#changeAiMode`); a
 * message whose properties merely read like one cannot take a thread off the
 * invoice. Looked up by `thread_id` (the `(thread_id, created_at)` index),
 * like {@link AGENT_WROTE}.
 */
const HANDED_OFF = Prisma.sql`EXISTS (
  SELECT 1 FROM events e
  WHERE e.thread_id = t.id
    AND e.author_type = 'system'
    AND (
      (e.properties ->> 'system_event' = 'chat_transferred'
        AND e.properties ->> 'reason' = ANY(${[...AUTOMATIC_HANDOFF_REASONS]}::text[]))
      OR (e.properties ->> 'system_event' = 'ai_mode_changed'
        AND e.properties ->> 'reason' = ANY(${[...AUTOMATIC_MODE_HANDOVERS]}::text[]))
    )
)`;

/**
 * The predicate over a `threads` row aliased `t`, closed included — true only
 * for a closed thread the AI resolved.
 *
 * Never NULL, so `NOT (…)` is its exact complement among closed threads: the
 * report's manual / assisted / automated split relies on that to keep
 * `manual + assisted + automated === closed`. It holds because a closed thread
 * always has a `closed_at` (`threads_closed_consistency_check`). The time test
 * comes first so the hand-off lookup runs only for threads it can decide.
 */
export function aiResolvedSql(effectiveAt: Date = ADR_09A_EFFECTIVE_AT): Prisma.Sql {
  return Prisma.sql`(
    NOT t.active
    AND NOT ${AGENT_WROTE}
    AND (t.closed_at < ${effectiveAt}::timestamptz OR NOT ${HANDED_OFF})
  )`;
}

/**
 * {@link aiResolvedSql} as a Prisma filter on one thread, for the inbox's
 * `ai_solved` view. Same three conditions.
 */
export function aiResolvedThreadWhere(
  effectiveAt: Date = ADR_09A_EFFECTIVE_AT,
): Prisma.ThreadWhereInput {
  return {
    active: false,
    events: { none: { authorType: 'agent' } },
    OR: [
      { closedAt: { lt: effectiveAt } },
      {
        events: {
          none: {
            authorType: 'system',
            OR: [
              ...AUTOMATIC_HANDOFF_REASONS.map((reason) => systemLine('chat_transferred', reason)),
              ...AUTOMATIC_MODE_HANDOVERS.map((reason) => systemLine('ai_mode_changed', reason)),
            ],
          },
        },
      },
    ],
  };
}

/** One system line by its `system_event` and `reason`, as {@link HANDED_OFF} reads it. */
function systemLine(systemEvent: string, reason: string): Prisma.EventWhereInput {
  return {
    AND: [
      { properties: { path: ['system_event'], equals: systemEvent } },
      { properties: { path: ['reason'], equals: reason } },
    ],
  };
}

/**
 * Did this thread resolve without a human? Asked at close, in the transaction
 * that closes it (after `active`/`closed_at` are written), by running
 * {@link aiResolvedSql} on the row — so the counter cannot read the thread
 * differently from the reports that later count it.
 *
 * Asked at close rather than tracked incrementally: an incremental flag would
 * have to be un-set correctly every time an agent joins late, and getting that
 * wrong bills the customer for work a person did.
 */
export async function threadWasAiResolved(
  tx: TenantClient,
  threadId: string,
  effectiveAt: Date = ADR_09A_EFFECTIVE_AT,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ resolved: boolean }>>`
    SELECT ${aiResolvedSql(effectiveAt)} AS resolved FROM threads t WHERE t.id = ${threadId}
  `;
  return rows[0]?.resolved === true;
}

/** A bot wrote in the thread — the AI's line or a rule bot's. */
const BOT_WROTE = Prisma.sql`EXISTS (
  SELECT 1 FROM events e WHERE e.thread_id = t.id AND e.author_type = 'bot'
)`;

/**
 * Who answered a closed thread (`threads.handled_by`, AR-01 / AR-02 · tm 335.1),
 * over a `threads` row aliased `t`:
 *
 *   - `ai` — {@link aiResolvedSql}, nothing else (ADR-09a §2.2): the archive's
 *     "AI solved" is the invoice's AI resolution, so a thread nobody answered
 *     at all is `ai` here exactly when the counter bills it (ADR-09a §3, the
 *     open question it leaves to the owner);
 *   - `human` — a person wrote and no bot did;
 *   - `mixed` — the rest: a bot and a person, or a hand-off nobody answered.
 */
export function handledBySql(effectiveAt: Date = ADR_09A_EFFECTIVE_AT): Prisma.Sql {
  return Prisma.sql`(CASE
    WHEN ${aiResolvedSql(effectiveAt)} THEN 'ai'
    WHEN ${AGENT_WROTE} AND NOT ${BOT_WROTE} THEN 'human'
    ELSE 'mixed'
  END)`;
}

/**
 * Write `handled_by` on a thread that has just closed, in the transaction that
 * closes it, and return it. `'ai'` is {@link threadWasAiResolved}'s `true` —
 * the close reads this one answer for both the column and the billing counter,
 * so the two are one evaluation, not two that happen to agree.
 */
export async function recordHandledBy(
  tx: TenantClient,
  threadId: string,
  effectiveAt: Date = ADR_09A_EFFECTIVE_AT,
): Promise<ThreadHandledBy> {
  const rows = await tx.$queryRaw<Array<{ handled_by: ThreadHandledBy }>>`
    UPDATE threads t SET handled_by = ${handledBySql(effectiveAt)}
    WHERE t.id = ${threadId} AND NOT t.active
    RETURNING t.handled_by
  `;
  const handledBy = rows[0]?.handled_by;
  if (!handledBy) throw new Error(`thread ${threadId} is not closed`);
  return handledBy;
}
