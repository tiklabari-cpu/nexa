/**
 * Buying AI-resolution overage packs (FR-MOD-10.1.4).
 *
 * The counterpart to `api-package-service.ts`, and shaped the same way: the
 * receipt in `ai_package_purchases` and the resolutions it bought credited to
 * `usage_records.included` for the current period, both inside one `withTenant`
 * transaction, so a workspace is never charged for quota it did not get and
 * never given quota with no record of the sale.
 *
 * Two things differ from the API-package sibling, and both come from what the
 * PRD sells. First, there is no catalogue of named tiers — §10.1.4's "aşım
 * paketi" is one pack of `AI_RESOLUTION_PACK_SIZE` resolutions bought in a
 * quantity, which is why the request carries a count and the screen carries a
 * stepper. Second, **the price is not stored anywhere to be looked up**: it is
 * `packs × pack size × AI_OVERAGE_CENTS`, the same per-resolution rate the
 * meter already quotes and the invoice already bills overage at (ADR-09, one
 * source). A price in the request body is ignored — see `purchaseAiPackage`.
 *
 * Payment is mocked (ADR-13): no card is charged, no payment method is required
 * and no external processor is called. What is real is the quota, and the money
 * the invoice will later show for it — which is why the price is copied onto
 * the receipt rather than recomputed at read time.
 *
 * A pack is a one-off top-up, not a subscription: nothing renews, and the
 * resolutions belong to the period they were bought into. That follows from
 * where the quota lands — `usage_records` is keyed `(license_id, metric,
 * period)`, so there is nowhere for an allowance to sit that outlives a period.
 */
import { AI_PACKAGE_MAX_PACKS, aiPackagePriceCents, aiPackageResolutions } from '@nexa/types';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { AI_RESOLUTION_OVERAGE_UNIT, currentPeriod } from './metering.js';

/** The stored receipt, as Prisma reads it back. */
export interface AiPackagePurchaseRow {
  id: string;
  packs: number;
  resolutions: number;
  priceCents: number;
  period: string;
  purchasedAt: Date;
}

/** The wire shape — snake_case, `purchased_at` as ISO. */
export interface AiPackagePurchaseView {
  id: string;
  packs: number;
  resolutions: number;
  price_cents: number;
  period: string;
  purchased_at: string;
}

/**
 * What a pack costs and how many may be bought at once — the terms the stepper
 * on the meter is built from.
 *
 * Published rather than left for a client to derive, because `max_packs` is a
 * rule the server enforces (`purchaseAiPackage` rejects more) and a client that
 * hardcoded its own bound would drift into offering a quantity that 400s. The
 * price is here for the same reason it is on `UsageSummary`: what extra usage
 * costs is visible before any is spent.
 */
export interface AiPackageTerms {
  /** Resolutions one pack adds (`AI_RESOLUTION_PACK_SIZE`). */
  resolutions_per_pack: number;
  /** Price of one resolution beyond the allowance, in cents. */
  unit_price_cents: number;
  /** Price of one whole pack, in cents. */
  pack_price_cents: number;
  /** The most packs a single purchase may buy. */
  max_packs: number;
}

/**
 * The pack on sale, priced from the configured per-resolution rate.
 *
 * Derived on every read rather than stored: the rate is deployment
 * configuration and the pack size is a code constant, so there is no third copy
 * that could be stale. The pack size quoted is `AI_RESOLUTION_OVERAGE_UNIT` —
 * the one the *meter* stamps onto every usage record — rather than a second
 * reading of the same number, so what is sold and what is billed are literally
 * the same binding (metering.ts re-exports `AI_RESOLUTION_PACK_SIZE`).
 */
export function aiPackageTerms(config: { aiOverageCents: number }): AiPackageTerms {
  return {
    resolutions_per_pack: AI_RESOLUTION_OVERAGE_UNIT,
    unit_price_cents: config.aiOverageCents,
    pack_price_cents: aiPackagePriceCents(1, config.aiOverageCents),
    max_packs: AI_PACKAGE_MAX_PACKS,
  };
}

/**
 * Serialise a receipt for the wire.
 *
 * The quota and price come off the row, never recomputed: the row is what the
 * workspace was actually charged, and re-deriving it would let the next change
 * to `AI_OVERAGE_CENTS` restate a sale that already happened.
 */
export function serialiseAiPackagePurchase(row: AiPackagePurchaseRow): AiPackagePurchaseView {
  return {
    id: row.id,
    packs: row.packs,
    resolutions: row.resolutions,
    price_cents: row.priceCents,
    period: row.period,
    purchased_at: row.purchasedAt.toISOString(),
  };
}

/**
 * Credit bought resolutions to this period's included allowance.
 *
 * Identical in shape to `creditApiCallQuota`, and correct for the same reason:
 * the row is shared with the meter. `recordAiResolution` upserts the *same*
 * `(license_id, 'ai_resolutions', period)` row every time a thread closes
 * without a human, and the two writes can arrive in either order or at once.
 *
 *  - `DO UPDATE SET included = usage_records.included + <quota>` reads the
 *    stored value and adds to it, so a purchase composes with whatever is
 *    already there. Writing `EXCLUDED.included` would look identical in every
 *    single-purchase test and silently overwrite a second purchase's quota.
 *  - The insert branch seeds `included` with the plan allowance *plus* the
 *    quota. When a workspace buys before its first AI resolution of the month
 *    there is no row yet, and both `usageSummary` and `recordAiResolution`
 *    treat "no row" as "the plan's allowance" — seeding with the quota alone
 *    would be a purchase that lowers your quota.
 *  - `quantity` starts at 0 and is never touched here, mirroring how
 *    `recordAiResolution` increments `quantity` and never touches `included`.
 *    Each side owns one column, so neither has to read the other's.
 *
 * One statement, so the read-modify-write happens under the row lock Postgres
 * takes for the conflicting insert.
 */
async function creditAiResolutionQuota(
  tx: TenantClient,
  tenant: TenantContext,
  period: string,
  quota: number,
  config: { aiIncluded: number; aiOverageCents: number },
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO usage_records
      (id, license_id, metric, period, quantity, included, overage_unit, overage_unit_price_cents, updated_at)
    VALUES
      (gen_random_uuid(), ${tenant.licenseId}::bigint, 'ai_resolutions', ${period}::char(6),
       0, ${BigInt(config.aiIncluded) + BigInt(quota)}::bigint, ${AI_RESOLUTION_OVERAGE_UNIT}::integer,
       ${config.aiOverageCents}::integer, now())
    ON CONFLICT (license_id, metric, period)
    DO UPDATE SET included = usage_records.included + ${BigInt(quota)}::bigint, updated_at = now()
  `;
}

/** A purchase that happened, or the earlier one a repeated request replayed. */
export interface AiPackagePurchaseOutcome {
  purchase: AiPackagePurchaseRow;
  /** True when this request found its own key already spent and charged nothing. */
  replayed: boolean;
}

/**
 * Sell `packs` AI-resolution packs to this workspace.
 *
 * **The price is computed here and nowhere else.** The caller passes a count and
 * a key; the amount is `packs × pack size × config.aiOverageCents`. A body field
 * naming a price never reaches this function — the route's schema drops unknown
 * keys — so there is no path by which a client can name what it pays.
 *
 * **Buying twice by accident is impossible, buying twice on purpose is not.**
 * The `idempotencyKey` is the caller's claim that two requests are the same
 * attempt. The insert is `ON CONFLICT (license_id, idempotency_key) DO NOTHING
 * RETURNING`, so of two overlapping requests exactly one inserts and credits;
 * the other returns no row, re-reads the winner's receipt and credits nothing.
 * This is done in SQL rather than as "look first, then insert" because the
 * look-first version has a window between the two statements that is precisely
 * the double-click it is meant to stop — and because a unique-violation *error*
 * would abort the surrounding transaction, taking the caller's ability to
 * recover with it.
 *
 * Nothing here checks for a payment method: requiring one would be theatre
 * while billing is mocked (ADR-13), and it would lock a workspace out of the
 * capacity it needs behind a form that does nothing.
 */
export async function purchaseAiPackage(
  tx: TenantClient,
  tenant: TenantContext,
  input: { packs: number; idempotencyKey: string },
  config: { aiIncluded: number; aiOverageCents: number },
): Promise<AiPackagePurchaseOutcome> {
  // The period the quota lands in, in the format `usage_records` and the
  // receipt's own CHECK constraint both demand (`yyyymm`).
  const period = currentPeriod();
  const resolutions = aiPackageResolutions(input.packs);
  const priceCents = aiPackagePriceCents(input.packs, config.aiOverageCents);

  const inserted = await tx.$queryRaw<AiPackagePurchaseRow[]>`
    INSERT INTO ai_package_purchases
      (id, license_id, idempotency_key, packs, resolutions, price_cents, period, purchased_at)
    VALUES
      (gen_random_uuid(), ${tenant.licenseId}::bigint, ${input.idempotencyKey},
       ${input.packs}::integer, ${resolutions}::integer, ${priceCents}::integer,
       ${period}::char(6), now())
    ON CONFLICT (license_id, idempotency_key) DO NOTHING
    RETURNING id,
              packs,
              resolutions,
              price_cents AS "priceCents",
              period,
              purchased_at AS "purchasedAt"
  `;

  const purchase = inserted[0];
  if (purchase === undefined) {
    // The key was already spent. Report the sale that did happen — a retry of a
    // request whose response was lost must be able to see what it bought — and
    // credit nothing.
    const existing = await tx.aiPackagePurchase.findUniqueOrThrow({
      where: {
        licenseId_idempotencyKey: {
          licenseId: tenant.licenseId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      select: {
        id: true,
        packs: true,
        resolutions: true,
        priceCents: true,
        period: true,
        purchasedAt: true,
      },
    });
    return { purchase: existing, replayed: true };
  }

  await creditAiResolutionQuota(tx, tenant, period, resolutions, config);

  return { purchase, replayed: false };
}
