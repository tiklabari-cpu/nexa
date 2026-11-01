/**
 * Cancelling a subscription (tm 384 · BL-03): the owner's reasons, the export
 * window after the period ends and the arithmetic of when the data goes.
 *
 * The timeline, one subscription:
 *
 *   1. **Cancel** — only a flag (`cancel_at_period_end`). The workspace keeps
 *      everything it paid for; nothing is refunded (BL-03 decision 2).
 *   2. **Resume** — clears the flag, any time before the period ends.
 *   3. **Period end** — the subscription is `canceled` and the workspace
 *      read-only (the expired trial's gate, ADR-10). Reads and exports work.
 *   4. **Export window** — {@link CANCEL_EXPORT_DAYS} days after the period
 *      end the workspace closes (`licenses.status = 'canceled'`): nobody signs
 *      in any more, the data is kept.
 *   5. **Deletion** — at {@link cancellationDeletionAt}: the export window, or
 *      longer when the workspace chose a longer retention for its
 *      conversations (a licence obligation to keep records), never when it
 *      chose `unlimited`. The retention sweep deletes the workspace.
 *
 * Shared so the API, the panel and the tests compute the same dates.
 */
import { isRetentionTier, retentionTierWindow, retentionWindowDays } from './retention.js';

/** Why the owner cancels — a closed list, the panel's radio group. */
export const CANCEL_REASONS = [
  'too_expensive',
  'missing_features',
  'switching_provider',
  'not_using',
  'business_closed',
  'other',
] as const;

export type CancelReason = (typeof CANCEL_REASONS)[number];

export function isCancelReason(value: unknown): value is CancelReason {
  return typeof value === 'string' && (CANCEL_REASONS as readonly string[]).includes(value);
}

/** Days a canceled workspace stays readable and exportable (BL-03 decision 1). */
export const CANCEL_EXPORT_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/**
 * When a cancellation takes effect: the end of the paid term, or — for a
 * subscription that has no term on file (the mocked checkout never sets one) —
 * the end of the calendar month (UTC) it was cancelled in, the period the
 * monthly statement closes. The SQL of `subscription_cancel_due_tenants` says
 * the same thing; the integration suite holds the two together.
 */
export function cancellationTakesEffectAt(currentPeriodEnd: Date | null, canceledAt: Date): Date {
  if (currentPeriodEnd) return currentPeriodEnd;
  return new Date(Date.UTC(canceledAt.getUTCFullYear(), canceledAt.getUTCMonth() + 1, 1));
}

/** The last moment of the export window, from the moment the period ended. */
export function cancellationExportUntil(endedAt: Date): Date {
  return new Date(endedAt.getTime() + CANCEL_EXPORT_DAYS * MS_PER_DAY);
}

/**
 * When a canceled workspace's data is deleted, or `null` when it is kept
 * (the workspace chose `unlimited`).
 *
 * The workspace's own retention choice for conversations
 * (`licenses.retention_thread_window`) decides: a workspace that chose a
 * longer window than the export window keeps its data that long, one that
 * chose nothing or a shorter window loses it when the export window ends.
 * The deployment default is not read — a workspace that never chose is not
 * one that asked to keep a year of records after leaving.
 */
export function cancellationDeletionAt(
  endedAt: Date,
  retentionThreadWindow: string | null,
): Date | null {
  const tier = isRetentionTier(retentionThreadWindow) ? retentionThreadWindow : null;
  const days = tier ? retentionWindowDays(retentionTierWindow(tier)) : CANCEL_EXPORT_DAYS;
  if (days === null) return null;
  return new Date(endedAt.getTime() + Math.max(CANCEL_EXPORT_DAYS, days) * MS_PER_DAY);
}
