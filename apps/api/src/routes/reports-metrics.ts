/**
 * Pure metric arithmetic for the reports overview.
 *
 * Kept free of Fastify, Prisma and env (the only import is the shared
 * CHANNEL_TYPES constant) so the rounding, the null-when-empty rate rule and
 * the channel label mapping can be unit-tested on their own, and so every
 * resolution class — manual, assisted, automated — shares one definition of
 * "share of closed" rather than three hand-copied expressions that could drift.
 */

import { CHANNEL_TYPES } from '../services/channels/channel-adapter.js';

/** Round to three decimals — the precision a percentage KPI ever shows. */
export function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Share of *closed* conversations a resolution class accounts for — null, not
 * zero, when nothing closed. The denominator is closed conversations (an open
 * chat has not resolved either way), so a busy inbox never drags a rate down,
 * and an empty window reads as unknown rather than as a 0% failure.
 */
export function resolutionRate(count: number, closed: number): number | null {
  return closed === 0 ? null : round(count / closed);
}

/**
 * The channel breakdown's dimension label for a `channel_messages.channel_type`
 * value. Known adapter types (CHANNEL_TYPES — the single source of truth,
 * `channel-adapter.ts`) keep their own name; `null` or anything else falls
 * back to `'website'`, since the native web widget is not an adapter and never
 * writes a `channel_messages` row for its chats. `reports.ts`, the CSV export
 * and the UI all consume this one mapping so the fallback bucket cannot drift
 * between them.
 */
export function channelLabel(type: string | null): string {
  return (CHANNEL_TYPES as readonly string[]).includes(type ?? '') ? (type as string) : 'website';
}

/* -------------------------------------------------------------------------- *
 * Benchmark comparison (FR-MOD-07.7 "benchmark karşılaştırma", 07.7-e)
 *
 * WHAT "BENCHMARK" MEANS HERE — the interpretation this codebase commits to,
 * recorded in code because the PRD does not settle it (PLAN §V1).
 *
 * The PRD asks the report groups to carry a "benchmark comparison" without
 * saying what the benchmark is. Two readings were open:
 *
 *   1. This license against its OWN past — the window before, or the same
 *      window a year earlier.
 *   2. This license against OTHER licenses — an industry average, a peer
 *      cohort, an anonymised pool.
 *
 * Reading 2 is REFUSED, and the refusal is an access-control decision rather
 * than a product preference. Every figure the reports serve comes from a
 * license-scoped query underneath RLS (ADR-12, NFR-S4); a cross-license
 * benchmark would have to read rows this tenant may not see and hand back a
 * number derived from them. Aggregation does not make that safe: a cohort that
 * happens to hold one other license, or one the caller can shrink by picking a
 * narrow enough window, discloses a competitor's traffic. So a baseline is
 * always another window of the SAME license, and there is deliberately no
 * `baseline` value that names anyone else — an unrecognised one is rejected at
 * the route rather than quietly falling back, so `baseline=industry` fails
 * loudly instead of looking supported.
 *
 * A cross-license benchmark, if it is ever wanted, is separate work with its
 * own isolation and anonymisation design (a k-anonymity floor, an explicit
 * opt-in, a separate aggregation store) — not one more value accepted here.
 * -------------------------------------------------------------------------- */

/** The baselines a report may be compared against — all within one license. */
export const BENCHMARK_BASELINES = ['previous_period', 'previous_year'] as const;

export type BenchmarkBaseline = (typeof BENCHMARK_BASELINES)[number];

/**
 * What a request without `baseline` gets: the equal-length window immediately
 * before the requested one — the comparison the Overview and Reviews reports
 * already made before this parameter existed, so the default keeps every
 * existing caller's output unchanged.
 */
export const DEFAULT_BENCHMARK_BASELINE: BenchmarkBaseline = 'previous_period';

/** Whether an arbitrary string names a baseline this license may ask for. */
export function isBenchmarkBaseline(value: string): value is BenchmarkBaseline {
  return (BENCHMARK_BASELINES as readonly string[]).includes(value);
}

/**
 * A fixed 365 days, deliberately not "one calendar year". Calendar arithmetic
 * would make the year-ago window a day longer or shorter than the window it is
 * compared against whenever a February 29th falls between them — and comparing
 * a 366-day span against a 365-day one is exactly the like-for-unlike mistake
 * the equal-length rule exists to prevent. A fixed offset also keeps this
 * function pure integer arithmetic on UTC instants, with no timezone or DST
 * reasoning to get wrong.
 */
const YEAR_MS = 365 * 86_400_000;

/**
 * The window a report is benchmarked against — always another window of the
 * *same* license (see the block comment above).
 *
 * `previous_period` is the equal-length window immediately before `from`,
 * ending a millisecond short of it: a case created exactly at `from` belongs to
 * the requested window and must not be counted in the baseline as well.
 *
 * `previous_year` is the same window shifted back 365 days, so it keeps the
 * requested window's length and its position in the week — the comparison you
 * want for a seasonal figure, where the period immediately before is the wrong
 * yardstick. It can overlap the requested window when the range itself is
 * longer than a year; that is an honest consequence of the question asked, not
 * a miscount, since the two windows are still measured independently.
 */
export function benchmarkWindow(
  from: Date,
  to: Date,
  baseline: BenchmarkBaseline = DEFAULT_BENCHMARK_BASELINE,
): { from: Date; to: Date } {
  if (baseline === 'previous_year') {
    return { from: new Date(from.getTime() - YEAR_MS), to: new Date(to.getTime() - YEAR_MS) };
  }
  const spanMs = to.getTime() - from.getTime();
  return { from: new Date(from.getTime() - spanMs), to: new Date(from.getTime() - 1) };
}
