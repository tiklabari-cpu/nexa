/**
 * Pure metric arithmetic for the reports overview.
 *
 * Kept dependency-free (no Fastify, Prisma or env) so the rounding and the
 * null-when-empty rate rule can be unit-tested on their own, and so every
 * resolution class — manual, assisted, automated — shares one definition of
 * "share of closed" rather than three hand-copied expressions that could drift.
 */

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
