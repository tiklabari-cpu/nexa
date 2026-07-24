/**
 * The self-serve checkout levers — plan, billing cycle, seats (FR-MOD-10.1.1–.3).
 *
 * Nexa's pricing is deliberately one transparent number (ADR-13, the PRD's
 * §5.3 differentiator): $99 per user per month, 200 AI resolutions included. So
 * there is one plan today. The endpoint still validates `plan`, prices annual
 * billing, and guards a downgrade — the shape a second tier would need — because
 * building those in later means reopening every caller.
 *
 * Billing is mocked (ADR-13, A5): this persists the choice and does the
 * arithmetic; nothing is charged and no external provider is called.
 */
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/**
 * The plan catalogue. A map rather than inlined constants so a future tier is a
 * data change, and so the downgrade guard has something real to compare against.
 * The single entry's numbers are ADR-13's, not invented here.
 */
export const PLANS = {
  growth: { unitPriceCents: 9900, aiResolutionsIncluded: 200 },
} as const;
export type PlanId = keyof typeof PLANS;

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/**
 * Annual billing charges ten months, not twelve — two months free. That puts
 * the discount at ~16.7%, inside the PRD's "%15–17" (FR-MOD-10.1.2), and is an
 * honest ratio rather than a round marketing number.
 */
const ANNUAL_MONTHS_CHARGED = 10;
const MONTHS_PER_YEAR = 12;

export interface UpdateSubscriptionInput {
  plan?: string;
  billingCycle?: string;
  seats?: number;
}

export interface SubscriptionFields {
  plan: PlanId;
  billingCycle: BillingCycle;
  seats: number;
  unitPriceCents: number;
  aiResolutionsIncluded: number;
}

/**
 * The seat charge for one billing period, and what annual billing saves.
 *
 * Monthly bills the seats once; annual bills ten of them and saves two. The
 * saving only means anything on the annual cycle, so it is 0 on monthly.
 */
export function priceSeats(
  unitPriceCents: number,
  seats: number,
  billingCycle: BillingCycle,
): { seatChargeCents: number; annualSavingsCents: number } {
  const monthlySeat = unitPriceCents * seats;
  if (billingCycle === 'annual') {
    return {
      seatChargeCents: monthlySeat * ANNUAL_MONTHS_CHARGED,
      annualSavingsCents: monthlySeat * (MONTHS_PER_YEAR - ANNUAL_MONTHS_CHARGED),
    };
  }
  return { seatChargeCents: monthlySeat, annualSavingsCents: 0 };
}

/**
 * Apply a checkout change and persist it, or reject it with a reason.
 *
 * Everything that can be wrong is settled before the write: an unknown plan or
 * cycle, seats below the people already on the workspace (FR-MOD-10.1.3), or a
 * plan whose quota is under what has already been spent this month
 * (FR-MOD-10.1.1). A workspace with no subscription row yet — the trial case —
 * gets one created.
 */
export async function updateSubscription(
  tx: TenantClient,
  tenant: TenantContext,
  input: UpdateSubscriptionInput,
  activeUsers: number,
  currentAiUsage: number,
): Promise<SubscriptionFields> {
  const existing = await tx.subscription.findFirst({
    where: { licenseId: tenant.licenseId },
    orderBy: { createdAt: 'desc' },
  });

  const plan = input.plan ?? existing?.plan ?? 'growth';
  if (!(plan in PLANS)) throw ApiError.validation(`Unknown plan: ${plan}.`);
  const planId = plan as PlanId;
  const spec = PLANS[planId];

  const billingCycle = input.billingCycle ?? existing?.billingCycle ?? 'monthly';
  if (!(BILLING_CYCLES as readonly string[]).includes(billingCycle)) {
    throw ApiError.validation(`Unknown billing cycle: ${billingCycle}.`);
  }

  // Seats floor: you cannot buy fewer seats than you have non-suspended agents
  // (FR-MOD-10.1.3), and never below one.
  const floor = Math.max(1, activeUsers);
  const requestedSeats = input.seats ?? existing?.seats ?? floor;
  if (requestedSeats < floor) {
    throw ApiError.validation(
      `Seats cannot be fewer than the ${floor} active agent(s) on this workspace.`,
    );
  }

  // Downgrade guard (FR-MOD-10.1.1): moving *to a different* plan whose quota is
  // below this month's usage is refused. Staying on the same plan is never a
  // downgrade — a workspace already over its quota pays overage and must still
  // be able to change seats or cycle. Inert with one plan (no plan to move to);
  // real the day a smaller tier exists.
  const changingPlan = existing != null && planId !== existing.plan;
  if (changingPlan && spec.aiResolutionsIncluded < currentAiUsage) {
    throw ApiError.validation(
      `The ${planId} plan includes ${spec.aiResolutionsIncluded} AI resolutions, ` +
        `below the ${currentAiUsage} already used this month.`,
    );
  }

  const data = {
    plan: planId,
    billingCycle,
    seats: requestedSeats,
    unitPriceCents: spec.unitPriceCents,
    aiResolutionsIncluded: spec.aiResolutionsIncluded,
  };

  const row = existing
    ? await tx.subscription.update({ where: { id: existing.id }, data })
    : await tx.subscription.create({
        data: { ...data, licenseId: tenant.licenseId, status: 'active' },
      });

  return {
    plan: planId,
    billingCycle: billingCycle as BillingCycle,
    seats: row.seats,
    unitPriceCents: row.unitPriceCents,
    aiResolutionsIncluded: row.aiResolutionsIncluded,
  };
}
