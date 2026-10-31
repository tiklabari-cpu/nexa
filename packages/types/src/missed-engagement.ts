/**
 * Missed conversations and who started them (RP-02 · tm 369): the closed
 * vocabularies behind `threads.initiated_by` and `threads.missed_reason`, and
 * the two reports that read them, `GET /reports/missed` and
 * `GET /reports/engagement`.
 *
 * Names follow the identity glossary (ID-01, K1 = A): a row is one connection
 * — a nexa thread, "Chat ID" in the panel — not the member's day.
 *
 * Plain literals only: this module reaches the widget loader through the
 * barrel, and a top-level call would keep it in that bundle.
 */

/**
 * Who started a connection (`threads.initiated_by`), written once as the
 * connection opens:
 *
 *   - `customer` — the player wrote from the widget;
 *   - `agent`    — an agent started or reopened the conversation;
 *   - `campaign` — the player opened it from a campaign card (EN-02 · a send
 *                  delivered to them and not yet acted on);
 *   - `ai`       — the AI started it (no path does today; the value is held
 *                  for a proactive AI opening, so adding one is no migration);
 *   - `channel`  — a message from a channel adapter (e-mail, WhatsApp, …).
 *
 * Null on a connection opened before the column existed, and on any opening
 * path that does not say — the reports show it as {@link ENGAGEMENT_UNKNOWN}.
 * The database CHECK `threads_initiated_by_check` lists exactly these values.
 */
export const THREAD_INITIATED_BY = ['customer', 'agent', 'campaign', 'ai', 'channel'] as const;
export type ThreadInitiatedBy = (typeof THREAD_INITIATED_BY)[number];

/** The engagement report's bucket for a connection whose opener was not recorded. */
export const ENGAGEMENT_UNKNOWN = 'unknown' as const;

/** The engagement report's rows, in this order, every one present even at zero. */
export const ENGAGEMENT_INITIATORS = [
  'customer',
  'agent',
  'campaign',
  'ai',
  'channel',
  'unknown',
] as const;
export type EngagementInitiator = (typeof ENGAGEMENT_INITIATORS)[number];

/**
 * Why a connection was missed (`threads.missed_reason`), written once, in the
 * transaction that closes it (05 RP-02 decision 1). A connection is missed
 * when it needed a person (`needs_human_since` set — it was queued, assigned,
 * or handed over by the AI) and no agent ever answered the player
 * (`first_response_at` null). One the AI answered and never handed over is
 * not missed: the AI handled it.
 *
 *   - `unanswered_after_ai` — the AI (or a rule bot) handed it to a person and
 *                             nobody answered: "devir sonrası kaçan". Checked
 *                             first, so a hand-over always reads as one;
 *   - `unanswered_assigned` — it closed with an agent assigned who never wrote
 *                             to the player;
 *   - `queue_abandoned`     — it closed with nobody assigned: it waited in
 *                             the queue (or for an agent) and the wait ended.
 *
 * Null on a connection that was not missed, and on an open one. A closed
 * connection from before the column existed carries a value only when the
 * backfill (`20261210090100_threads_missed_backfill`) could infer one from the
 * transcript; such a row has no `needs_human_since`, which is how a report
 * tells an estimate (`ReportsMissed.totals.estimated`) from a recorded value.
 */
export const MISSED_REASONS = [
  'queue_abandoned',
  'unanswered_assigned',
  'unanswered_after_ai',
] as const;
export type MissedReason = (typeof MISSED_REASONS)[number];
