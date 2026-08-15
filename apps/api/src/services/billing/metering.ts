/**
 * Usage metering and trial state (ADR-09, ADR-10, ADR-13).
 *
 * The definition of an "AI resolution" lives here and nowhere else: a thread
 * that closed with no `author_type = 'agent'` event in it. Both billing and the
 * Reports "Automated" figure read this one function, because two counters that
 * are supposed to agree eventually will not, and the one that decides the
 * invoice is the wrong one to discover was drifting.
 */
import { Prisma } from '@prisma/client';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

export type LicenseAccess = 'active' | 'trialing' | 'read_only';

/**
 * Is this licence one an invoice may be built from? (FR-MOD-11.5 · 11.5-f)
 *
 * A sandbox is a second tenant with no commercial existence: nothing it does
 * reaches `usage_records`, so nothing it does can reach an invoice, a quota
 * warning or the Reports "Automated" figure derived from the same rows. Written
 * as a predicate on the *insert* rather than as a separate lookup the caller
 * makes first, so there is no window between asking and writing and no second
 * round trip on the hottest write in the system — `recordApiCall` runs on every
 * PAT request the platform serves.
 *
 * `EXISTS (… IS NULL)` rather than `NOT EXISTS (… IS NOT NULL)`, and the
 * difference is which way it fails. A licence row the caller cannot see makes
 * this false and the meter silently records nothing — under-billing. The
 * inverted spelling would record everything, which is how a sandbox ends up on
 * a customer's invoice. Neither happens in practice (the licence gate reads the
 * same row on every mutating request, so an invisible one would already be
 * failing loudly); it is written this way because the harmless failure should be
 * the reachable one.
 */
const isBillableLicense = (licenseId: bigint): Prisma.Sql => Prisma.sql`EXISTS (
  SELECT 1 FROM licenses l WHERE l.id = ${licenseId}::bigint AND l.sandbox_of_license_id IS NULL
)`;

/**
 * Overage is sold in packs of this many AI resolutions (PRD §10.1.4, the
 * "aşım paketi"). The pack is a pricing bundle, not a billing quantum — the
 * invoice still meters per resolution (see `overage_cents`), so a workspace a
 * few over its allowance pays for those few, not for a whole pack it did not
 * use. Named here so the value the meter shows and the value a usage record is
 * stamped with can never disagree.
 */
export const AI_RESOLUTION_OVERAGE_UNIT = 50;

/**
 * API-call overage is sold by the block (FR-MOD-10.1.5, the PRD's "$29.50 per
 * 100,000 extra"). Unlike an AI resolution — metered one at a time — an API call
 * is billed by the whole block: any part of a 100,000 block over the allowance
 * costs one block. Named here so the meter, the invoice and the seed stamp the
 * same pack size, and so `overage_cents` is computed from a single constant.
 */
export const API_CALL_OVERAGE_UNIT = 100_000;

export interface TrialState {
  status: string;
  access: LicenseAccess;
  trialEndsAt: string | null;
  daysRemaining: number | null;
}

export interface UsageSummary {
  period: string;
  ai_resolutions: {
    used: number;
    included: number;
    overage: number;
    overage_cents: number;
    /** Pack size the overage is priced in (`AI_RESOLUTION_OVERAGE_UNIT`). */
    overage_unit: number;
    /** Price of one AI resolution beyond the allowance, in cents. */
    overage_unit_price_cents: number;
  };
  api_calls: {
    used: number;
    included: number;
    overage: number;
    overage_cents: number;
    /** Block size the overage is billed in (`API_CALL_OVERAGE_UNIT`). */
    overage_unit: number;
    /** Price of one 100,000-call block beyond the allowance, in cents. */
    overage_unit_price_cents: number;
  };
}

/** `yyyymm` for the current UTC month. */
export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Did this thread resolve without a human?
 *
 * Asked at close time rather than tracked incrementally: an incremental flag
 * would have to be un-set correctly every time an agent joins late, and getting
 * that wrong bills the customer for work a person did.
 */
export async function threadWasAiResolved(tx: TenantClient, threadId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ agent_events: bigint }>>`
    SELECT count(*) AS agent_events
    FROM events
    WHERE thread_id = ${threadId} AND author_type = 'agent'
  `;
  return Number(rows[0]?.agent_events ?? 0) === 0;
}

/**
 * Record one AI resolution.
 *
 * An upsert with an atomic increment, so two threads closing at the same
 * instant cannot both read the old total and write the same new one.
 */
export async function recordAiResolution(
  tx: TenantClient,
  tenant: TenantContext,
  overageUnitPriceCents: number,
  includedPerMonth: number,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO usage_records
      (id, license_id, metric, period, quantity, included, overage_unit, overage_unit_price_cents, updated_at)
    SELECT gen_random_uuid(), ${tenant.licenseId}::bigint, 'ai_resolutions', ${currentPeriod()}::char(6),
           1, ${BigInt(includedPerMonth)}::bigint, ${AI_RESOLUTION_OVERAGE_UNIT}::integer,
           ${overageUnitPriceCents}::integer, now()
    WHERE ${isBillableLicense(tenant.licenseId)}
    ON CONFLICT (license_id, metric, period)
    DO UPDATE SET quantity = usage_records.quantity + 1, updated_at = now()
  `;
}

/**
 * Record one billed API call (FR-MOD-10.1.5).
 *
 * The same atomic-increment upsert as {@link recordAiResolution}: the row's
 * `quantity` *is* the counter, so two concurrent calls cannot both read the old
 * total and write the same new one. Stamped with the block size and per-block
 * price so a period's usage record carries the pricing that produced it — the
 * meter reads it back rather than re-deriving, and the two cannot drift.
 */
export async function recordApiCall(
  tx: TenantClient,
  tenant: TenantContext,
  overageUnitPriceCents: number,
  includedPerMonth: number,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO usage_records
      (id, license_id, metric, period, quantity, included, overage_unit, overage_unit_price_cents, updated_at)
    SELECT gen_random_uuid(), ${tenant.licenseId}::bigint, 'api_calls', ${currentPeriod()}::char(6),
           1, ${BigInt(includedPerMonth)}::bigint, ${API_CALL_OVERAGE_UNIT}::integer,
           ${overageUnitPriceCents}::integer, now()
    WHERE ${isBillableLicense(tenant.licenseId)}
    ON CONFLICT (license_id, metric, period)
    DO UPDATE SET quantity = usage_records.quantity + 1, updated_at = now()
  `;
}

export async function usageSummary(
  tx: TenantClient,
  tenant: TenantContext,
  config: {
    aiOverageCents: number;
    aiIncluded: number;
    apiOverageCents: number;
    apiIncluded: number;
  },
): Promise<UsageSummary> {
  const period = currentPeriod();
  const records = await tx.usageRecord.findMany({
    where: { licenseId: tenant.licenseId, period },
  });

  const ai = records.find((r) => r.metric === 'ai_resolutions');
  const api = records.find((r) => r.metric === 'api_calls');

  const used = Number(ai?.quantity ?? 0n);
  const included = Number(ai?.included ?? BigInt(config.aiIncluded));
  const overage = Math.max(0, used - included);

  const apiUsed = Number(api?.quantity ?? 0n);
  const apiIncluded = Number(api?.included ?? BigInt(config.apiIncluded));
  const apiOverage = Math.max(0, apiUsed - apiIncluded);
  // Billed by the block, not the call (FR-MOD-10.1.5): any part of a 100,000
  // block over the allowance costs one $29.50 block. `ceil` is the difference
  // between AI's per-unit metering and this — a workspace one call over pays for
  // the whole block, exactly as "$29.50 per 100,000 extra" reads.
  const apiOverageBlocks = Math.ceil(apiOverage / API_CALL_OVERAGE_UNIT);

  return {
    period,
    ai_resolutions: {
      used,
      included,
      overage,
      overage_cents: overage * config.aiOverageCents,
      // The pack size and the same per-resolution price `overage_cents` is
      // computed from, so the meter can quote the overage price up front — the
      // "predictable AI bill" the PRD sells (§5.3) — instead of only after the
      // first unit is spent.
      overage_unit: AI_RESOLUTION_OVERAGE_UNIT,
      overage_unit_price_cents: config.aiOverageCents,
    },
    api_calls: {
      used: apiUsed,
      included: apiIncluded,
      overage: apiOverage,
      overage_cents: apiOverageBlocks * config.apiOverageCents,
      // The block size and its price, quoted whether or not any overage has been
      // spent, so an integration sees the extra-usage price before the allowance
      // runs out — the same up-front honesty the AI meter gives.
      overage_unit: API_CALL_OVERAGE_UNIT,
      overage_unit_price_cents: config.apiOverageCents,
    },
  };
}

/**
 * Trial state and what the license may still do.
 *
 * ADR-10: an expired trial becomes read-only, not locked. Data stays readable
 * and nothing is deleted — a workspace that cannot export its own conversation
 * history has been taken hostage, not downgraded.
 */
export async function trialState(tx: TenantClient, tenant: TenantContext): Promise<TrialState> {
  const license = await tx.license.findUniqueOrThrow({
    where: { id: tenant.licenseId },
    select: { status: true, trialEndsAt: true },
  });

  const endsAt = license.trialEndsAt;
  const daysRemaining =
    endsAt === null ? null : Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 86_400_000));

  let access: LicenseAccess = 'active';
  if (license.status === 'trialing') {
    access = endsAt !== null && endsAt.getTime() <= Date.now() ? 'read_only' : 'trialing';
  } else if (license.status === 'read_only' || license.status === 'past_due') {
    access = 'read_only';
  } else if (license.status === 'canceled') {
    access = 'read_only';
  }

  return {
    status: license.status,
    access,
    trialEndsAt: endsAt?.toISOString() ?? null,
    daysRemaining,
  };
}
