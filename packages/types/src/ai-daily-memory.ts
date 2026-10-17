/**
 * Same-day memory (tm 294 · SiyahTuş analysis AI-02; owner decisions K4, K5).
 *
 * A player who wrote "Papara 2,500 TL, it has not arrived" this morning and
 * comes back at noon should not be asked the same six questions again. Each
 * connection the AI took part in keeps a short, model-free summary of itself
 * (`ai_conversations.digest`); the day's next connection reads the newest
 * ones on its first turn. The day is the chat (K1=A: panel "Thread ID"), so a
 * previous day's connections are never in it (AI-02-S3).
 *
 * What the AI may do with the summaries depends on how sure we are that the
 * visitor is the same member ({@link IDENTITY_TRUSTS}), decided in code before
 * any prompt is built — never left to the model (K4). And whatever the trust,
 * the AI recalls the earlier conversation at the level of its topic; it does
 * not volunteer an amount, an IBAN or a transaction id (K5).
 */

/**
 * How the visitor writing the message proved who they are (K4 · tm 287):
 *
 *   - `verified` — a member token this workspace signed (the widget's cookie or
 *                  its stored copy): the same member as the day's earlier
 *                  connections.
 *   - `session`  — a customer this browser was given just now: a new visitor,
 *                  whose day is the one they are in.
 *   - `claimed`  — nothing signed: the one-time adoption of a bare
 *                  `customer_id` (tm 287.2's transition), or a message whose
 *                  proof was not recorded. Only the topic-free "did you write
 *                  to us earlier today?" is allowed.
 *
 * `verified` and `session` may see the details and carry collected slots;
 * `claimed` sees none of them.
 */
export const IDENTITY_TRUSTS = ['verified', 'session', 'claimed'] as const;
export type IdentityTrust = (typeof IDENTITY_TRUSTS)[number];

export function isIdentityTrust(value: unknown): value is IdentityTrust {
  return typeof value === 'string' && (IDENTITY_TRUSTS as readonly string[]).includes(value);
}

/** Whether a trust level may see the earlier connections' details and carry their slots. */
export function trustSeesDetails(trust: IdentityTrust): boolean {
  return trust !== 'claimed';
}

/**
 * When the AI brings the earlier conversation up itself (AI-02-S1):
 *
 *   - `auto_if_unresolved` — in its first answer, when the day's latest
 *                            conversation did not end solved (handed over,
 *                            left half-way, or waiting on something), unless
 *                            the new message is plainly about something else.
 *   - `on_topic_only`      — only when the new message is about the same topic.
 */
export const DAILY_MEMORY_RECALLS = ['auto_if_unresolved', 'on_topic_only'] as const;
export type DailyMemoryRecall = (typeof DAILY_MEMORY_RECALLS)[number];

/** An AI agent's same-day memory setting (`AiAgent.daily_memory`). */
export interface DailyMemorySettings {
  enabled: boolean;
  recall: DailyMemoryRecall;
}

/** An agent that never set it: on, recalling an unresolved topic (AI-02-S1). */
export const DEFAULT_DAILY_MEMORY: Readonly<DailyMemorySettings> = Object.freeze({
  enabled: true,
  recall: 'auto_if_unresolved',
});

/**
 * The agent's setting from its `persona` JSON (`dailyMemory`), the default for
 * anything missing or malformed — like `readBatchWindowSeconds`, kept beside
 * the persona so no column is needed.
 */
export function readDailyMemory(persona: unknown): DailyMemorySettings {
  const stored =
    persona && typeof persona === 'object' && !Array.isArray(persona)
      ? (persona as Record<string, unknown>)['dailyMemory']
      : undefined;
  const source =
    stored && typeof stored === 'object' && !Array.isArray(stored)
      ? (stored as Record<string, unknown>)
      : {};
  const enabled = source['enabled'];
  const recall = source['recall'];
  return {
    enabled: typeof enabled === 'boolean' ? enabled : DEFAULT_DAILY_MEMORY.enabled,
    recall:
      typeof recall === 'string' && (DAILY_MEMORY_RECALLS as readonly string[]).includes(recall)
        ? (recall as DailyMemoryRecall)
        : DEFAULT_DAILY_MEMORY.recall,
  };
}

/** How many of the day's earlier summaries a first turn reads, newest first (AI-02 §3). */
export const DAILY_DIGEST_LIMIT = 3;

/** The longest excerpt of the AI's last words a summary keeps. */
export const DAILY_DIGEST_EXCERPT_MAX = 200;
