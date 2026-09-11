/**
 * Retention policy: which data has a time-to-live, and how long (NFR-C8).
 *
 * PRD §7 NFR-C8 calls for a *configurable* retention window (30/60/365 days or
 * unlimited) with a real hard-delete once it lapses. The hard-delete is
 * `retention.ts`. This file is the arithmetic and the guards, and — since
 * tm 241 — the place the deployment's defaults meet a workspace's own choice.
 *
 * **Three layers, resolved in this order, and each one can only shorten the
 * next:**
 *
 *   1. `resolveRetentionPolicy(env)` — the deployment default, the four
 *      `RETENTION_*_DAYS` variables. This is what every workspace got before a
 *      per-workspace choice existed, and it is still what one that has not
 *      chosen gets.
 *   2. `applyTenantWindows(policy, overrides)` — the workspace's own choice,
 *      stored on its `licenses` row as one of `RETENTION_TIERS`. A null
 *      override is "no choice made", which is a different fact from
 *      `'unlimited'` and leaves layer 1 in place.
 *   3. `capRetentionForHipaa(policy)` — the ceiling a signed BAA imposes
 *      (NFR-C4 · C4-e). Applied last so it is the last word, whatever the
 *      workspace chose.
 *
 * Splitting them keeps one question per function and — more usefully — makes
 * the *reported* effective policy computable without running a sweep, which is
 * what `GET /settings/retention` returns and what an audit entry records.
 *
 * The three windows and what they cover:
 *
 *   - **threadDays** — a *closed* thread and everything it cascades to (its
 *     events and thread tags). Conversation content is the bulk of stored
 *     personal data; a closed thread past the window is the unit that ages out.
 *     Active threads and open chats are never touched. Default 365, the top of
 *     the PRD's configurable tiers. Configurable per workspace.
 *   - **visitDays** — visitor telemetry (`visits`: ip, user agent, os, browser).
 *     The Visit model flags itself as personal data subject to retention; it is
 *     pure tracking data with a shorter useful life, so it ages out faster than
 *     conversations. Default 90. Configurable per workspace.
 *   - **mailDays** — outgoing mail written to `MAIL_DIR` in place of real SMTP
 *     (PLAN A4). Transient dev/support artifacts that may contain an address, so
 *     they are swept too. Default 30. **Not** per workspace: the files carry no
 *     licence, so there is no workspace to look a choice up against.
 *   - **auditDays** — `audit_log` entries (NFR-S12: "the last 30 days" of basic
 *     audit — login, role change, data deletion, webhook change — on every
 *     plan). Default 30. **Not** per workspace either, and that one is a
 *     decision rather than a limitation: the audit log is the record of who
 *     deleted what, and a workspace that could shorten its own trail would be
 *     exactly the "erişim ≠ silme" hole NFR-C8 names.
 *
 * Every finite window is a positive integer number of days. A window of zero —
 * or a cutoff at or after "now" — would select the entire table, so `cutoffFor`
 * refuses it: the retention job must never be one misconfiguration away from
 * deleting everything. "Unlimited" is therefore *not a number* here; see
 * `@nexa/types#RetentionWindow` for why that is the load-bearing choice.
 *
 * The single-subject counterpart to this periodic sweep — the "right to
 * erasure" API NFR-C8 also names (GDPR Art. 17) — is `erasure.ts`. They share
 * the requirement line and nothing else: this one asks "is it old", that one
 * asks "did they ask".
 */
import {
  isRetentionTier,
  type RetentionTier,
  retentionTierWindow,
  type RetentionWindow,
} from '@nexa/types';
import { type Env } from '../../config/env.js';

export interface RetentionPolicy {
  /** Closed threads older than this many days (by `closed_at`) are pruned. */
  threadDays: RetentionWindow;
  /** Visitor telemetry older than this many days (by `started_at`) is pruned. */
  visitDays: RetentionWindow;
  /** Outgoing mail files older than this many days (by `sent_at`) are pruned. */
  mailDays: number;
  /** Audit log entries older than this many days (by `created_at`) are pruned. */
  auditDays: number;
}

/**
 * A workspace's stored choice, as it comes off its `licenses` row. `null` is
 * "no choice made"; an unrecognised string is treated as no choice too, because
 * a tier this build does not know is a tier it cannot apply — see
 * `readTenantWindow`.
 */
export interface TenantRetentionWindows {
  threadWindow: RetentionTier | null;
  visitWindow: RetentionTier | null;
}

/**
 * Absolute instants the job compares rows against, derived from one `now`.
 *
 * `null` where a window is unlimited: there is no instant that means "never",
 * and inventing one (`new Date(0)`) would be a cutoff a careless `<` could
 * still use. A null cutoff has to be branched on.
 */
export interface RetentionCutoffs {
  threads: Date | null;
  visits: Date | null;
  mail: Date;
  audit: Date;
}

const MS_PER_DAY = 86_400_000;

/**
 * Read the deployment default out of the validated environment. Kept separate
 * from the runner so the day counts have one origin and the runner stays
 * testable with a hand-built policy.
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
 * Interpret a stored window string (NFR-C8).
 *
 * An unrecognised value reads as "no choice" rather than raising. The database
 * constrains the column to the four tiers, so this can only fire on a build
 * that has met a row written by a *newer* one — the rollout case CONVENTIONS
 * §6.3 is about. Falling back to the deployment default there keeps the sweep
 * running under a window somebody configured; raising would stop retention for
 * every workspace because one of them used a tier this replica has not shipped
 * yet.
 */
export function readTenantWindow(stored: string | null | undefined): RetentionTier | null {
  return isRetentionTier(stored) ? stored : null;
}

/**
 * Layer the workspace's own choice over the deployment default.
 *
 * Only the two windows NFR-C8 makes configurable move; `mailDays` and
 * `auditDays` come through untouched, for the reasons in this file's header.
 */
export function applyTenantWindows(
  policy: RetentionPolicy,
  windows: TenantRetentionWindows,
): RetentionPolicy {
  return {
    ...policy,
    threadDays: windows.threadWindow
      ? retentionTierWindow(windows.threadWindow)
      : policy.threadDays,
    visitDays: windows.visitWindow ? retentionTierWindow(windows.visitWindow) : policy.visitDays,
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
 * The same, for a window that may be unlimited. `null` means "no cutoff" —
 * nothing in this class is pruned at all.
 *
 * This is the only sanctioned way to turn a `RetentionWindow` into a cutoff,
 * and the reason it returns `null` rather than a sentinel date is that a caller
 * has to *notice*. A sentinel in the distant past would silently prune nothing
 * (right answer, wrong mechanism, and one bad edit from pruning everything);
 * `null` will not survive a `<` comparison by accident.
 */
export function cutoffForWindow(window: RetentionWindow, now: Date): Date | null {
  return window === 'unlimited' ? null : cutoffFor(window, now);
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

/** The ceiling for one window, or `null` when nothing caps it. */
export function hipaaCeilingDays(
  field: 'threadDays' | 'visitDays',
  hipaaScope: boolean,
): number | null {
  if (!hipaaScope) return null;
  const ceiling = HIPAA_RETENTION_CEILING[field];
  // The ceiling constants are finite by construction; this narrowing exists so
  // the type of the constant can stay `RetentionWindow` alongside the policy's.
  return typeof ceiling === 'number' ? ceiling : null;
}

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
    mailDays: capNumber(policy.mailDays, HIPAA_RETENTION_CEILING.mailDays, 'mailDays'),
    // Untouched — a floor, not a ceiling. See HIPAA_RETENTION_CEILING.
    auditDays: policy.auditDays,
  };
}

/**
 * One window against one ceiling.
 *
 * Two failure modes, and they get opposite treatment on purpose.
 *
 * **`'unlimited'` is clamped.** NFR-C8 offers it beside 30/60/365 and a
 * workspace may legitimately have chosen it *before* signing a BAA — so this
 * value can arrive through a sequence of perfectly ordinary user actions, not
 * only through a bug. `PATCH /settings/retention` refuses to *store* it on a
 * covered workspace, which is where the refusal belongs (the admin is there to
 * be told); by the time the sweep reads a stale one, throwing would abort the
 * whole run and leave every *other* workspace unswept in order to punish this
 * one. Clamping applies the ceiling the agreement actually asks for.
 *
 * **A non-finite number is refused.** `Infinity`, `NaN`, and the `null`/
 * `undefined` that `Math.min` would turn into `0`/`NaN` are not choices anybody
 * made — they are a bad coercion, and the sweep proceeding under a policy
 * nobody chose is worse than the sweep stopping. Kept distinct from the case
 * above precisely because the type system now separates them: the deliberate
 * unlimited is a string and cannot be confused with arithmetic junk.
 */
function capWindow(window: RetentionWindow, ceiling: RetentionWindow, name: string): number {
  const cap = typeof ceiling === 'number' ? ceiling : Number.POSITIVE_INFINITY;
  if (window === 'unlimited') return cap;
  return capNumber(window, cap, name);
}

function capNumber(days: number, ceiling: number, name: string): number {
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
    threads: cutoffForWindow(policy.threadDays, now),
    visits: cutoffForWindow(policy.visitDays, now),
    mail: cutoffFor(policy.mailDays, now),
    audit: cutoffFor(policy.auditDays, now),
  };
}
