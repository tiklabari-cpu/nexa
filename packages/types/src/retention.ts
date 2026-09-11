/**
 * Retention windows a workspace may choose for itself (NFR-C8).
 *
 * PRD §7 NFR-C8 asks for a retention window that is *configurable*
 * — "30/60/365/sınırsız" — with a real hard-delete once it lapses. Until now
 * the four windows in `services/retention/policy.ts` came only from the
 * environment, which made them a property of the **deployment**: every
 * workspace on one installation shared one number, and nobody could pick.
 * This file is the vocabulary the choice is spelled in, and it lives in
 * `@nexa/types` because three parties have to agree on it — the API that
 * stores it, the sweep that applies it, and the console that offers it.
 *
 * ## Why the tiers are a closed list and not a number of days
 *
 * The PRD enumerates four values rather than describing a range, and that is
 * the shape kept here. A free integer would have to answer "is 1 day allowed?"
 * (a workspace deleting yesterday's conversations is almost certainly a
 * misconfiguration, and the sweep is irreversible) and "is 100 000 allowed?"
 * (indistinguishable from unlimited, but passing every positive-integer check).
 * A closed list answers both by construction, the same reason
 * `settings.ts`'s other pickers are enums rather than strings.
 *
 * ## Why "unlimited" is a string and not a number
 *
 * This is the load-bearing decision in the file. `cutoffFor` refuses a zero or
 * negative window precisely because such a window puts the cutoff at or after
 * "now" and therefore matches **every** row — a retention sweep that deletes
 * the table. So the one encoding of "unlimited" that must never appear is `0`,
 * which is exactly the encoding a numeric field invites ("0 = off", the idiom
 * `session_idle_timeout_seconds` and half the world's config files use).
 * `Infinity` is no better: it survives `Math.min` untouched, and `null` coerces
 * to `0` under it.
 *
 * `'unlimited'` is none of those. It cannot be compared, subtracted or
 * minimised by accident — every arithmetic site that meets a `RetentionWindow`
 * is a type error until it says what it does with the unlimited case, and the
 * compiler is what enforces that rather than a reviewer's memory.
 */

/** The four windows NFR-C8 enumerates, in the order a picker should show them. */
export const RETENTION_TIERS = ['30d', '60d', '365d', 'unlimited'] as const;

export type RetentionTier = (typeof RETENTION_TIERS)[number];

/**
 * A resolved window: a positive integer number of days, or `'unlimited'`.
 *
 * Deliberately not `number | null`. `null` is the *absence* of a per-workspace
 * choice (inherit the deployment default) and is a different fact from a
 * workspace that chose to keep its conversations forever — collapsing the two
 * would make "we never configured this" and "we decided never to delete" the
 * same row in the database and the same sentence on the screen.
 */
export type RetentionWindow = number | 'unlimited';

export function isRetentionTier(value: unknown): value is RetentionTier {
  return typeof value === 'string' && (RETENTION_TIERS as readonly string[]).includes(value);
}

/** The window a tier names. `'unlimited'` passes through as itself, not a number. */
export function retentionTierWindow(tier: RetentionTier): RetentionWindow {
  switch (tier) {
    case '30d':
      return 30;
    case '60d':
      return 60;
    case '365d':
      return 365;
    case 'unlimited':
      return 'unlimited';
  }
}

/**
 * The days in a window, or `null` when it is unlimited.
 *
 * The one narrowing helper callers are allowed, and it returns `null` rather
 * than `Infinity` on purpose: `null` is unusable in arithmetic without a check,
 * `Infinity` is not.
 */
export function retentionWindowDays(window: RetentionWindow): number | null {
  return window === 'unlimited' ? null : window;
}
