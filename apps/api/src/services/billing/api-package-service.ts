/**
 * Buying an API request package (FR-MOD-09.3).
 *
 * Two writes that have to happen together: the receipt in
 * `api_package_purchases`, and the calls it bought credited to
 * `usage_records.included` for the current period. Callers run both inside one
 * `withTenant` transaction, so a workspace is never charged for quota it did
 * not get, and never given quota with no record of the sale.
 *
 * Payment is mocked (ADR-13): no card is charged, no payment method is required
 * and no external processor is called. What is real is the quota — and the
 * money the invoice will later show for it (09.3-e), which is why the price is
 * copied onto the receipt rather than looked up again at read time.
 *
 * A package is a one-off top-up, not a subscription: nothing renews, and the
 * calls belong to the period they were bought into. That follows from where the
 * quota lands — `usage_records` is keyed `(license_id, metric, period)`, so
 * there is nowhere for an allowance to sit that outlives a period. Carrying
 * quota over would need a column that does not exist yet, and inventing one
 * quietly here would make every past period's invoice depend on it.
 */
import { findApiPackage, type ApiPackage } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { API_CALL_OVERAGE_UNIT, currentPeriod } from './metering.js';

/** The stored receipt, as Prisma reads it back. */
export interface ApiPackagePurchaseRow {
  id: string;
  packageId: string;
  apiCalls: bigint;
  priceCents: number;
  period: string;
  purchasedAt: Date;
}

/** The wire shape — snake_case, `api_calls` widened, `purchased_at` as ISO. */
export interface ApiPackagePurchaseView {
  id: string;
  package_id: string;
  /** Catalogue name, or null once the package stops being offered. */
  name: string | null;
  api_calls: number;
  price_cents: number;
  period: string;
  purchased_at: string;
}

/**
 * Serialise a receipt for the wire.
 *
 * The quota and price come off the row, never from today's catalogue: the row
 * is what the workspace was actually charged, and re-deriving it would let the
 * next price change restate a bill that was already issued. Only `name` is
 * joined from the catalogue, for display, and it is null for a package that has
 * since been withdrawn — the sale still happened, so the row still lists.
 *
 * Shared by the purchase response and the history listing so the two can never
 * describe the same row differently.
 */
export function serialiseApiPackagePurchase(row: ApiPackagePurchaseRow): ApiPackagePurchaseView {
  return {
    id: row.id,
    package_id: row.packageId,
    name: findApiPackage(row.packageId)?.name ?? null,
    // `api_calls` is a bigint column; the wire carries a number, the same
    // widening `usageSummary` does for the counters it reads.
    api_calls: Number(row.apiCalls),
    price_cents: row.priceCents,
    period: row.period,
    purchased_at: row.purchasedAt.toISOString(),
  };
}

/**
 * Credit a package's calls to this period's included allowance.
 *
 * The whole correctness of the feature is in the `ON CONFLICT` clause, because
 * this row is shared with the meter: `recordApiCall` upserts the *same*
 * `(license_id, metric, period)` row on every billed API call, and the two can
 * arrive in either order or at the same instant.
 *
 *  - `DO UPDATE SET included = usage_records.included + <quota>` reads the
 *    stored value and adds to it, so a purchase composes with whatever is
 *    already there — an earlier purchase this period, or the allowance the
 *    meter stamped on the period's first call. Writing `EXCLUDED.included`
 *    instead (the value computed in VALUES below) would look identical in every
 *    single-purchase test and silently overwrite a second purchase's quota with
 *    "plan allowance + this package", losing the first one.
 *  - The insert branch seeds `included` with the plan allowance *plus* the
 *    quota, not the quota alone. When a workspace buys before making its first
 *    API call of the month there is no row yet, and `usageSummary` /
 *    `recordApiCall` both treat "no row" as "the plan's allowance". Seeding
 *    with the quota alone would take the plan's own included calls away from
 *    anyone who bought early — a purchase that lowers your quota.
 *  - `quantity` starts at 0 and is never touched here, mirroring how
 *    `recordApiCall` increments `quantity` and never touches `included`. Each
 *    side owns one column, so neither has to read the other's.
 *
 * One statement, so the read-modify-write happens under the row lock Postgres
 * takes for the conflicting insert. Two concurrent purchases therefore add up
 * rather than racing to write the same total.
 */
async function creditApiCallQuota(
  tx: TenantClient,
  tenant: TenantContext,
  period: string,
  quota: bigint,
  config: { apiIncluded: number; apiOverageCents: number },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO usage_records
      (id, license_id, metric, period, quantity, included, overage_unit, overage_unit_price_cents, updated_at)
    VALUES
      (gen_random_uuid(), ${tenant.licenseId}, 'api_calls', ${period},
       0, ${BigInt(config.apiIncluded) + quota}, ${API_CALL_OVERAGE_UNIT}, ${config.apiOverageCents}, now())
    ON CONFLICT (license_id, metric, period)
    DO UPDATE SET included = usage_records.included + ${quota}, updated_at = now()
  `;
}

/**
 * Sell one catalogue package to this workspace.
 *
 * Records the sale and credits the quota in the caller's transaction, then
 * returns the receipt. An id that names no package is a 404 rather than a 400:
 * the request is well-formed, it just asks for something that is not for sale.
 *
 * Nothing here checks for a payment method. Requiring one would be theatre
 * while billing is mocked (ADR-13) — there is no card to charge and no
 * processor to decline — and it would lock a workspace out of the quota it
 * needs behind a form that does nothing.
 */
export async function purchaseApiPackage(
  tx: TenantClient,
  tenant: TenantContext,
  packageId: string,
  config: { apiIncluded: number; apiOverageCents: number },
): Promise<{ purchase: ApiPackagePurchaseRow; package: ApiPackage }> {
  const pkg = findApiPackage(packageId);
  if (!pkg) throw ApiError.notFound(`No API package with id ${packageId}.`);

  // The period the quota lands in, in the format `usage_records` and the
  // receipt's own CHECK constraint both demand (`yyyymm`).
  const period = currentPeriod();
  const quota = BigInt(pkg.api_calls);

  // The receipt first, then the credit. Order is immaterial to correctness —
  // the transaction commits both or neither — but recording the sale before
  // raising the allowance keeps the shorter-held lock last.
  const purchase = await tx.apiPackagePurchase.create({
    // Quota and price are copied from the catalogue at sale time. A later
    // reprice must not reach back into a sale that already happened.
    data: {
      licenseId: tenant.licenseId,
      packageId: pkg.id,
      apiCalls: quota,
      priceCents: pkg.price_cents,
      period,
    },
  });

  await creditApiCallQuota(tx, tenant, period, quota, config);

  return { purchase, package: pkg };
}
