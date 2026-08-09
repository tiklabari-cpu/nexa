/**
 * API request packages — FR-MOD-09.3 (marketplace, "Could" v2 scope).
 *
 * A static, code-only catalogue of the named quotas a workspace can buy on top
 * of its plan's included API calls — the counterpart to the automatic overage
 * billing in `apps/api/src/services/billing/metering.ts` (which meters usage
 * past the plan quota); this catalogue is the proactively *purchased* packages
 * a workspace picks from, not an automatic charge.
 *
 * Essential and Pro's quota/price are the PRD's observation numbers verbatim
 * (PRD line 666/1412: "Essential 100K $29.99, Pro 500K $149.99"). Pro+ is not
 * given a distinct quota/price anywhere in the PRD (line 1412's "Pro+" entry
 * reuses Pro's $149.99 for a 500K quota plus an unrelated expert-session
 * add-on) — 1,000,000 calls / $249.99 is a derived third tier that keeps the
 * three-package progression internally consistent (see 09.3 task notes,
 * "açık soru 1").
 */

/** A named, purchasable API-call quota. */
export interface ApiPackage {
  id: string;
  name: string;
  api_calls: number;
  price_cents: number;
}

export const API_PACKAGE_CATALOG: readonly ApiPackage[] = [
  { id: 'essential', name: 'Essential', api_calls: 100_000, price_cents: 2999 },
  { id: 'pro', name: 'Pro', api_calls: 500_000, price_cents: 14999 },
  { id: 'pro-plus', name: 'Pro+', api_calls: 1_000_000, price_cents: 24999 },
] as const;

/** The catalogue entry for an id, or undefined if it names no package. */
export function findApiPackage(id: string): ApiPackage | undefined {
  return API_PACKAGE_CATALOG.find((entry) => entry.id === id);
}

/** True when `id` names a real API package. */
export function isApiPackageId(id: unknown): id is string {
  return typeof id === 'string' && API_PACKAGE_CATALOG.some((entry) => entry.id === id);
}
