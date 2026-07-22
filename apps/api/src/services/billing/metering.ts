/**
 * Usage metering and trial state (ADR-09, ADR-10, ADR-13).
 *
 * The definition of an "AI resolution" lives here and nowhere else: a thread
 * that closed with no `author_type = 'agent'` event in it. Both billing and the
 * Reports "Automated" figure read this one function, because two counters that
 * are supposed to agree eventually will not, and the one that decides the
 * invoice is the wrong one to discover was drifting.
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

export type LicenseAccess = 'active' | 'trialing' | 'read_only';

export interface TrialState {
  status: string;
  access: LicenseAccess;
  trialEndsAt: string | null;
  daysRemaining: number | null;
}

export interface UsageSummary {
  period: string;
  ai_resolutions: { used: number; included: number; overage: number; overage_cents: number };
  api_calls: { used: number; included: number };
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
    VALUES
      (gen_random_uuid(), ${tenant.licenseId}, 'ai_resolutions', ${currentPeriod()},
       1, ${BigInt(includedPerMonth)}, 50, ${overageUnitPriceCents}, now())
    ON CONFLICT (license_id, metric, period)
    DO UPDATE SET quantity = usage_records.quantity + 1, updated_at = now()
  `;
}

export async function usageSummary(
  tx: TenantClient,
  tenant: TenantContext,
  config: { aiOverageCents: number; aiIncluded: number },
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

  return {
    period,
    ai_resolutions: {
      used,
      included,
      overage,
      overage_cents: overage * config.aiOverageCents,
    },
    api_calls: {
      used: Number(api?.quantity ?? 0n),
      included: Number(api?.included ?? 100_000n),
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
