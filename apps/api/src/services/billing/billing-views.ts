/**
 * The billing screen's read models, shared by the two processes that show them
 * (tm 389.9 · design.md §A): the tenant API's `/billing/*` routes
 * (`routes/reports.ts`) and the root panel's workspace detail
 * (`routes/platform/workspaces.ts`). One builder, so an operator looking at a
 * workspace's subscription sees exactly what its owner sees.
 *
 * Every query here names the licence it reads. Inside the tenant API that is
 * redundant with row level security; on the platform's `siyahtus_platform`
 * connection, which bypasses it, the filter is the boundary — a count without
 * one would add up every workspace's members.
 */
import type { Env } from '../../config/env.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { trialState, usageSummary } from './metering.js';
import { priceSeats, pricingForPlan, type BillingCycle } from './subscription-service.js';

/**
 * The metering config both billing reads pass to {@link usageSummary} — one
 * place, so the included allowances and overage prices the subscription view
 * quotes can never diverge from the ones the usage endpoint does.
 */
export function usageConfig(env: Env): {
  aiOverageCents: number;
  aiIncluded: number;
  apiOverageCents: number;
  apiIncluded: number;
} {
  return {
    aiOverageCents: env.AI_OVERAGE_CENTS,
    aiIncluded: env.AI_RESOLUTIONS_INCLUDED,
    apiOverageCents: env.API_CALL_OVERAGE_CENTS,
    apiIncluded: env.API_CALLS_INCLUDED,
  };
}

/**
 * The full subscription view (`SubscriptionView`), built the same way for a read
 * and for the reply after a change — so `PATCH` returns exactly what the next
 * `GET` would, no client refetch needed.
 *
 * `seats` is the purchased count (the stored subscription, falling back to the
 * active headcount before anyone has checked out); `min_seats` is the floor the
 * stepper enforces. `estimated_total_cents` is 0 while trialing — the trial owes
 * nothing — and otherwise the cycle-aware seat charge plus this month's overage.
 */
export async function buildSubscriptionView(
  tx: TenantClient,
  tenant: TenantContext,
  env: Env,
): Promise<Record<string, unknown>> {
  const [subscription, trial, usage, activeUsers] = await Promise.all([
    tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
    }),
    trialState(tx, tenant),
    usageSummary(tx, tenant, usageConfig(env)),
    tx.agentMembership.count({ where: { licenseId: tenant.licenseId, suspended: false } }),
  ]);

  const unitPrice = subscription?.unitPriceCents ?? env.UNIT_PRICE_CENTS;
  const billingCycle = (subscription?.billingCycle ?? 'monthly') as BillingCycle;
  const seats = subscription?.seats ?? activeUsers;
  const { seatChargeCents, annualSavingsCents } = priceSeats(unitPrice, seats, billingCycle);
  // The trial owes nothing, and neither does any workspace in the public pilot
  // (tm 257.2) — the same decision `readComposition` makes for the statement,
  // so the quote and the open estimate cannot disagree.
  const owesNothing = trial.access === 'trialing' || env.PILOT_MODE;
  const plan = subscription?.plan ?? 'growth';

  return {
    plan,
    // Whether `unit_price_cents` below is a price this product quotes or the
    // last figure on file under a contract nobody here can read (11.5-a). A
    // screen shows the number for `listed` and "contact sales" for `quoted` —
    // the amounts stay in the response either way, because the mocked invoice
    // is still built from them.
    pricing: pricingForPlan(plan),
    billing_cycle: billingCycle,
    status: trial.status,
    // What the workspace can still do, spelled out — a client should not have to
    // infer read-only from a status string.
    access: trial.access,
    trial: { ends_at: trial.trialEndsAt, days_remaining: trial.daysRemaining },
    seats,
    min_seats: activeUsers,
    unit_price_cents: unitPrice,
    usage,
    // Seats plus this period's metered overage — both AI resolutions and API
    // calls land on the invoice (FR-MOD-10.1.5, "aşım faturaya"). Zero while
    // trialing or in the pilot; neither owes anything.
    estimated_total_cents: owesNothing
      ? 0
      : seatChargeCents + usage.ai_resolutions.overage_cents + usage.api_calls.overage_cents,
    annual_savings_cents: owesNothing ? 0 : annualSavingsCents,
    provider: 'mock',
  };
}
