/**
 * Asking a waiting player for an e-mail (WG-08 · tm 342), the first step of
 * the inactivity sweep (`chat-inactivity.ts`) — it runs before the transfer in
 * the same pass, because a player who has left is no one to transfer to
 * anybody: the e-mail is how the team still reaches them.
 *
 * Two triggers on `inbox_settings`, both off until a workspace sets them:
 *
 *   1. **Waiting too long** — `ask_email_after_seconds`. An open connection
 *      the player has written to, with no reply from a person yet
 *      (`first_response_at`, the first reply only — as for the transfer), whose
 *      wait began before the window. The wait begins when it was given to an
 *      agent (`assigned_at`, which the AI's hand-over moves to the hand-over),
 *      or, with nobody having it, when it joined the queue (`queued_at`) or
 *      began. A connection the AI is answering (`ai_mode = 'ai'`) is not
 *      waiting for anyone.
 *   2. **Nobody there** — `ask_email_when_offline`. An open connection nobody
 *      has, while no person is accepting chats. With an AI that would answer
 *      (`aiAnswersVisitors`) only after it handed the connection over — the
 *      player is never asked for an address while the AI is talking to them;
 *      with no AI, as soon as the sweep sees the player's first message.
 *
 * One event per connection, ever: either `ask_email` (the widget draws a card)
 * or, when the team already has a way to reach the player — an e-mail, or the
 * username they typed — `reply_here`, a line saying the answer will come to
 * this conversation. The two share the existence check, so a connection that
 * got one never gets the other, whichever of the triggers fires later, and a
 * second pass finds nothing to do.
 *
 * The same predicate is asked again under the chat and thread locks by
 * `ChatService.requestContact`, so a reply that commits while the pass is
 * running spares the connection.
 *
 * What it leaves alone, on purpose:
 *
 *   - a connection whose player has written nothing (a widget opened with a
 *     pre-chat form and left): nobody is waiting for an answer yet.
 *   - the day's cap and the player's own share of the AI (`customerHasAiTurnLeft`):
 *     "would the AI answer" is the workspace's question here, not the player's.
 *     An AI out of allowance leaves the connection waiting, and the delay
 *     trigger covers it.
 */
import { Prisma } from '@prisma/client';
import { CONTACT_REQUEST_SYSTEM_EVENTS } from '@siyahtus/types';
import { type TenantClient } from '../../lib/tenant.js';
import { aiAnswersVisitors } from './ai-first.js';

/** The windows a pass applies, from the workspace's most recently saved row. */
export interface AskEmailSettings {
  afterSeconds: number | null;
  whenOffline: boolean;
}

/** What a pass asks of a connection: either trigger, or both, or neither. */
export interface ContactRequestRule {
  /** The wait must have begun before this; null when the delay trigger is off. */
  cutoff: Date | null;
  /**
   * The nobody-there trigger: `off`, `handed_over` (an AI would answer, so only
   * a connection it handed over) or `any` (no AI to wait for).
   */
  offline: 'off' | 'handed_over' | 'any';
}

export function ruleIsOff(rule: ContactRequestRule): boolean {
  return rule.cutoff === null && rule.offline === 'off';
}

/**
 * The predicate over a `threads` row aliased `t`: the player is waiting for a
 * person, nobody asked them for a contact yet, and the rule says to now. One
 * spelling, read by the pass that lists candidates and by the request that
 * asks again under the locks.
 */
export function contactRequestSql(rule: ContactRequestRule): Prisma.Sql {
  const delayed =
    rule.cutoff === null
      ? Prisma.sql`FALSE`
      : Prisma.sql`(
          t.ai_mode IS DISTINCT FROM 'ai'
          AND CASE WHEN t.assignee_id IS NOT NULL
                   THEN t.assigned_at
                   ELSE COALESCE(t.queued_at, t.created_at)
              END < ${rule.cutoff}
        )`;
  const offline =
    rule.offline === 'off'
      ? Prisma.sql`FALSE`
      : rule.offline === 'handed_over'
        ? Prisma.sql`(t.assignee_id IS NULL AND t.ai_mode = 'human')`
        : Prisma.sql`(t.assignee_id IS NULL AND t.ai_mode IS DISTINCT FROM 'ai')`;
  return Prisma.sql`(
    t.active
    AND t.first_response_at IS NULL
    AND (${delayed} OR ${offline})
    AND EXISTS (
      SELECT 1 FROM events e
       WHERE e.thread_id = t.id AND e.type = 'message' AND e.author_type = 'customer'
    )
    AND NOT EXISTS (
      SELECT 1 FROM events e
       WHERE e.thread_id = t.id AND e.type = 'system_message'
         AND e.properties->>'system_event' IN (${Prisma.join([...CONTACT_REQUEST_SYSTEM_EVENTS])})
    )
  )`;
}

export async function readAskEmailSettings(tx: TenantClient): Promise<AskEmailSettings> {
  const row = await tx.inboxSettings.findFirst({
    select: { askEmailAfterSeconds: true, askEmailWhenOffline: true },
    orderBy: { updatedAt: 'desc' },
  });
  // A stored non-positive window cannot pass the CHECK; read as off all the
  // same, so it can never become "ask every waiting player now".
  const seconds = row?.askEmailAfterSeconds;
  return {
    afterSeconds: typeof seconds === 'number' && seconds > 0 ? seconds : null,
    whenOffline: row?.askEmailWhenOffline ?? false,
  };
}

/**
 * The rule a pass applies now: the settings, and — only when the offline
 * trigger is on — whether a person is accepting chats (the widget's own count,
 * `GET /customer/chat` `online`) and whether an AI would answer.
 */
export async function contactRequestRule(
  tx: TenantClient,
  settings: AskEmailSettings,
  now: Date,
): Promise<ContactRequestRule> {
  const cutoff =
    settings.afterSeconds === null ? null : new Date(now.getTime() - settings.afterSeconds * 1000);
  if (!settings.whenOffline) return { cutoff, offline: 'off' };
  const humansOnline = await tx.agentMembership.count({
    where: { routingStatus: 'accepting_chats', suspended: false },
  });
  if (humansOnline > 0) return { cutoff, offline: 'off' };
  return { cutoff, offline: (await aiAnswersVisitors(tx)) ? 'handed_over' : 'any' };
}
