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
 *   - **auditDays** — `audit_log` entries (NFR-S12: "the last 30 days" of basic
 *     audit — login, role change, data deletion, webhook change — on every
 *     plan). This step only adds the window and the cutoff arithmetic; the
 *     sweep itself does not delete audit rows yet (that lands with the actual
 *     hard-delete in a later step). Default 30.
 *
 * Every window is a positive integer number of days. A window of zero — or a
 * cutoff at or after "now" — would select the entire table, so `cutoffFor`
 * refuses it: the retention job must never be one misconfiguration away from
 * deleting everything.
 *
 * A workspace under HIPAA scope (NFR-C4 · C4-e) does not get to choose freely:
 * see `HIPAA_RETENTION_CEILING` and `capRetentionForHipaa` below.
 */
import { type Env } from '../../config/env.js';

export interface RetentionPolicy {
  /** Closed threads older than this many days (by `closed_at`) are pruned. */
  threadDays: number;
  /** Visitor telemetry older than this many days (by `started_at`) is pruned. */
  visitDays: number;
  /** Outgoing mail files older than this many days (by `sent_at`) are pruned. */
  mailDays: number;
  /** Audit log entries older than this many days (by `created_at`) are pruned. */
  auditDays: number;
}

/** Absolute instants the job compares rows against, derived from one `now`. */
export interface RetentionCutoffs {
  threads: Date;
  visits: Date;
  mail: Date;
  audit: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Read the policy out of the validated environment. Kept separate from the
 * runner so the day counts have one origin and the runner stays testable with a
 * hand-built policy.
 */
export function resolveRetentionPolicy(
  env: Pick<
    Env,
    | 'RETENTION_THREAD_DAYS'
    | 'RETENTION_VISIT_DAYS'
    | 'RETENTION_MAIL_DAYS'
    | 'RETENTION_AUDIT_DAYS'
  >,
): RetentionPolicy {
  return {
    threadDays: env.RETENTION_THREAD_DAYS,
    visitDays: env.RETENTION_VISIT_DAYS,
    mailDays: env.RETENTION_MAIL_DAYS,
    auditDays: env.RETENTION_AUDIT_DAYS,
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

/**
 * The longest window a workspace under HIPAA scope may keep (NFR-C4 · C4-e).
 *
 * These are the shipped defaults, restated as maximums. That is the whole rule:
 * **a covered workspace can shorten its windows and cannot lengthen them.** A
 * separate, longer set of "HIPAA numbers" would have been an invention — the
 * requirement is a ceiling, not a schedule — and picking one would have meant
 * choosing a retention period for somebody's medical conversations out of thin
 * air. NFR-C8's top configurable tier for conversations is 365 days, and its
 * fourth option, *unlimited*, is what this removes: indefinite retention of PHI
 * is the thing a BAA is signed to prevent, so it is not selectable here at any
 * value (see `capRetentionForHipaa`).
 *
 * `auditDays` is deliberately absent. Every other window here is a *ceiling* on
 * personal data; the audit log is the opposite — a record of who touched that
 * data, which HIPAA §164.316(b)(2)(i) requires be *kept*, and which NFR-S12
 * already floors at 30 days on every plan. Capping it would shorten the one
 * trail an investigation reads, in the name of a rule that exists to make that
 * investigation possible.
 */
export const HIPAA_RETENTION_CEILING: Omit<RetentionPolicy, 'auditDays'> = {
  threadDays: 365,
  visitDays: 90,
  mailDays: 30,
};

/**
 * The effective policy for a workspace inside HIPAA scope: each window is its
 * own value or the ceiling, whichever is shorter.
 *
 * Applied per tenant by the sweep — scope is a property of a licence, not of the
 * deployment, and two workspaces in the same US deployment can differ. Reducing
 * a window is always safe here (the sweep only ever deletes *older* data), which
 * is why capping is the right shape rather than refusing to run.
 */
export function capRetentionForHipaa(policy: RetentionPolicy): RetentionPolicy {
  return {
    threadDays: capWindow(policy.threadDays, HIPAA_RETENTION_CEILING.threadDays, 'threadDays'),
    visitDays: capWindow(policy.visitDays, HIPAA_RETENTION_CEILING.visitDays, 'visitDays'),
    mailDays: capWindow(policy.mailDays, HIPAA_RETENTION_CEILING.mailDays, 'mailDays'),
    // Untouched — a floor, not a ceiling. See HIPAA_RETENTION_CEILING.
    auditDays: policy.auditDays,
  };
}

/**
 * One window against one ceiling.
 *
 * The guard is what makes "unlimited is not available" true rather than
 * aspirational. NFR-C8 offers *unlimited* alongside 30/60/365, and whatever
 * shape a per-workspace setting eventually gives it — `null`, `Infinity`, an
 * absent field — it arrives here as a value `Math.min` would happily return
 * unchanged, quietly granting the covered workspace exactly the indefinite
 * retention the agreement forbids. So a non-finite window is refused outright
 * instead of clamped: the sweep stops and says why, rather than proceeding
 * under a policy nobody chose. Today the environment schema only admits
 * positive integers, so this cannot fire from configuration alone — it is the
 * door standing ready for the setting, in the same spirit as the AI provider
 * gate.
 */
function capWindow(days: number, ceiling: number, name: string): number {
  if (!Number.isFinite(days)) {
    throw new RangeError(
      `retention window ${name} is unlimited, which a workspace under HIPAA scope cannot select (NFR-C4)`,
    );
  }
  return Math.min(days, ceiling);
}

/** All four cutoffs from a single reference instant, so a run is consistent. */
export function resolveCutoffs(policy: RetentionPolicy, now: Date): RetentionCutoffs {
  return {
    threads: cutoffFor(policy.threadDays, now),
    visits: cutoffFor(policy.visitDays, now),
    mail: cutoffFor(policy.mailDays, now),
    audit: cutoffFor(policy.auditDays, now),
  };
}
