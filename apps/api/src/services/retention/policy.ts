/**
 * Retention policy: which data has a time-to-live, and how long (NFR-C8).
 *
 * PRD §7 NFR-C8 calls for a *configurable* retention window (30/60/365 days or
 * unlimited) with a real hard-delete once it lapses. This is the MVP shape of
 * that: three windows, each overridable from the environment, applied by the
 * pruning job. Per-tenant overrides (a column on `security_settings`) and the
 * "right to erasure" API (GDPR Art. 17, a targeted single-subject delete) are
 * separate, later work — this is the periodic, whole-workspace sweep.
 *
 * The three windows and what they cover:
 *
 *   - **threadDays** — a *closed* thread and everything it cascades to (its
 *     events and thread tags). Conversation content is the bulk of stored
 *     personal data; a closed thread past the window is the unit that ages out.
 *     Active threads and open chats are never touched. Default 365, the top of
 *     the PRD's configurable tiers.
 *   - **visitDays** — visitor telemetry (`visits`: ip, user agent, os, browser).
 *     The Visit model flags itself as personal data subject to retention; it is
 *     pure tracking data with a shorter useful life, so it ages out faster than
 *     conversations. Default 90.
 *   - **mailDays** — outgoing mail written to `MAIL_DIR` in place of real SMTP
 *     (PLAN A4). Transient dev/support artifacts that may contain an address, so
 *     they are swept too. Default 30.
 *
 * Every window is a positive integer number of days. A window of zero — or a
 * cutoff at or after "now" — would select the entire table, so `cutoffFor`
 * refuses it: the retention job must never be one misconfiguration away from
 * deleting everything.
 */
import { type Env } from '../../config/env.js';

export interface RetentionPolicy {
  /** Closed threads older than this many days (by `closed_at`) are pruned. */
  threadDays: number;
  /** Visitor telemetry older than this many days (by `started_at`) is pruned. */
  visitDays: number;
  /** Outgoing mail files older than this many days (by `sent_at`) are pruned. */
  mailDays: number;
}

/** Absolute instants the job compares rows against, derived from one `now`. */
export interface RetentionCutoffs {
  threads: Date;
  visits: Date;
  mail: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Read the policy out of the validated environment. Kept separate from the
 * runner so the day counts have one origin and the runner stays testable with a
 * hand-built policy.
 */
export function resolveRetentionPolicy(
  env: Pick<Env, 'RETENTION_THREAD_DAYS' | 'RETENTION_VISIT_DAYS' | 'RETENTION_MAIL_DAYS'>,
): RetentionPolicy {
  return {
    threadDays: env.RETENTION_THREAD_DAYS,
    visitDays: env.RETENTION_VISIT_DAYS,
    mailDays: env.RETENTION_MAIL_DAYS,
  };
}

/**
 * The instant a row must be *older than* to be pruned. Anything at or after it
 * survives.
 *
 * The guard is the load-bearing line: a non-positive window would put the
 * cutoff at or in the future and match every row, turning a retention sweep
 * into a table wipe. That can only happen through a bug or a bad override, so
 * it raises rather than proceeding.
 */
export function cutoffFor(days: number, now: Date): Date {
  if (!Number.isInteger(days) || days < 1) {
    throw new RangeError(`retention window must be a positive integer number of days, got ${days}`);
  }
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/** All three cutoffs from a single reference instant, so a run is consistent. */
export function resolveCutoffs(policy: RetentionPolicy, now: Date): RetentionCutoffs {
  return {
    threads: cutoffFor(policy.threadDays, now),
    visits: cutoffFor(policy.visitDays, now),
    mail: cutoffFor(policy.mailDays, now),
  };
}
