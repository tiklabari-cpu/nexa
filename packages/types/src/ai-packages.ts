/**
 * AI-resolution overage packs — FR-MOD-10.1.4 (PRD §10.1.4's "aşım paketi").
 *
 * Unlike the API request packages next door (`api-packages.ts`), this is not a
 * catalogue of named tiers. The PRD sells AI overage as one pack bought in a
 * quantity — the meter's "sold in packs of 50" — so what lives here is the pack
 * *size*, the ceiling on a single purchase, and the arithmetic that turns a
 * quantity into money. The per-resolution price is deliberately absent: it is
 * `AI_OVERAGE_CENTS`, deployment configuration rather than a code constant, and
 * copying it here would give the meter and the sale two prices to disagree
 * about.
 *
 * `AI_RESOLUTION_PACK_SIZE` is the single definition of the pack. The API's
 * `AI_RESOLUTION_OVERAGE_UNIT` (metering.ts) re-exports it rather than
 * declaring a second 50, because that constant is stamped onto every
 * `usage_records` row: two spellings of the pack size would let a workspace be
 * *sold* a pack of one size and *billed* against another.
 */

/**
 * How many AI resolutions one overage pack contains (PRD §10.1.4).
 *
 * The pack is a pricing bundle, not a billing quantum — the invoice still
 * meters overage per resolution — so buying a pack raises the included
 * allowance by exactly this many resolutions.
 */
export const AI_RESOLUTION_PACK_SIZE = 50;

/**
 * The most packs one purchase may buy.
 *
 * A stepper needs an upper bound, and the bound has to be the server's: a
 * client-side maximum is a suggestion, and the request behind it is a money
 * write. Twenty packs is 1,000 resolutions — comfortably more than a month's
 * overshoot on any listed plan, and small enough that a fat-fingered quantity
 * cannot bill a workspace thousands of dollars in one click. A workspace that
 * genuinely needs more buys twice, which is the cheaper failure.
 */
export const AI_PACKAGE_MAX_PACKS = 20;

/** The resolutions `packs` packs add. */
export function aiPackageResolutions(packs: number): number {
  return packs * AI_RESOLUTION_PACK_SIZE;
}

/**
 * What `packs` packs cost, at `unitPriceCents` per resolution.
 *
 * Priced from the per-resolution rate rather than from a stored pack price, so
 * the pack and the overage it pre-buys can never quote different money. The
 * caller supplies the rate because it is configuration (`AI_OVERAGE_CENTS`),
 * which is also why this is a function and not a constant.
 */
export function aiPackagePriceCents(packs: number, unitPriceCents: number): number {
  return aiPackageResolutions(packs) * unitPriceCents;
}

/** True when `packs` is a whole number of packs a purchase may ask for. */
export function isBuyablePackCount(packs: unknown): packs is number {
  return (
    typeof packs === 'number' &&
    Number.isInteger(packs) &&
    packs >= 1 &&
    packs <= AI_PACKAGE_MAX_PACKS
  );
}
