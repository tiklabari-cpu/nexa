/**
 * The self-serve checkout levers — plan, billing cycle, seats (FR-MOD-10.1.1–.3).
 *
 * Nexa's self-serve pricing is deliberately one transparent number (ADR-13, the
 * PRD's §5.3 differentiator): $99 per user per month, 200 AI resolutions
 * included. Enterprise (PRD §5.4 "Kurumsal") sits beside it as a *quoted* tier —
 * it carries capabilities, not a price this repo is allowed to invent.
 *
 * Billing is mocked (ADR-13, A5): this persists the choice and does the
 * arithmetic; nothing is charged and no external provider is called.
 */
import { ENTITLEMENTS, entitlementMap, type Entitlement, type EntitlementMap } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/**
 * How a tier is priced.
 *
 * `listed` means the catalogue below states the number and the checkout can
 * charge it. `quoted` means the price is agreed in a contract this deployment
 * never sees — the PRD gives Enterprise no figure, and picking one here would
 * put an invented price on an invoice and in the UI.
 */
export type PlanPricing = 'listed' | 'quoted';

export interface PlanSpec {
  pricing: PlanPricing;
  /** List price per seat per month. `null` on a quoted tier. */
  unitPriceCents: number | null;
  /** Included AI resolutions per month. `null` when the contract sets it. */
  aiResolutionsIncluded: number | null;
  /** What this tier unlocks. Everything not listed is denied (§C-A25). */
  entitlements: readonly Entitlement[];
}

/**
 * The plan catalogue — the single source of both price and capability.
 *
 * A map rather than inlined constants so a tier is a data change, and so the
 * downgrade guard has something real to compare against. Growth's numbers are
 * ADR-13's, not invented here.
 *
 * Enterprise carries every entitlement and no numbers. That asymmetry is the
 * point: the PRD names the Enterprise *capabilities* (§5.4, NFR-S11, NFR-C4,
 * NFR-S12) and never names an Enterprise *price*, so the catalogue states the
 * first and refuses to state the second. `quoted` is how that refusal travels to
 * a caller — see {@link updateSubscription} for what the mocked bill does with
 * it.
 */
export const PLANS = {
  growth: {
    pricing: 'listed',
    unitPriceCents: 9900,
    aiResolutionsIncluded: 200,
    // Self-serve buys the product, not the Enterprise controls. Every key here
    // would be a leak of exactly the kind 11.5 exists to close.
    entitlements: [],
  },
  enterprise: {
    pricing: 'quoted',
    unitPriceCents: null,
    aiResolutionsIncluded: null,
    entitlements: [...ENTITLEMENTS],
  },
} as const satisfies Record<string, PlanSpec>;

export type PlanId = keyof typeof PLANS;

export const PLAN_IDS = Object.keys(PLANS) as PlanId[];

export function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && value in PLANS;
}

/**
 * What a plan unlocks, as a total map.
 *
 * Takes a plain string rather than a `PlanId` because the caller is usually
 * holding `subscription.plan` — a database column, not a checked union. A value
 * the catalogue does not know grants nothing: a workspace whose row says
 * `platinum` gets the free tier's answer, not an unhandled case that falls
 * through to allow. This is the function every gate should ask; there is no
 * second place where a capability can be turned on.
 */
export function entitlementsForPlan(plan: string | null | undefined): EntitlementMap {
  return entitlementMap(isPlanId(plan) ? PLANS[plan].entitlements : []);
}

/** How the plan on a subscription row is priced; an unknown plan reads as listed. */
export function pricingForPlan(plan: string | null | undefined): PlanPricing {
  return isPlanId(plan) ? PLANS[plan].pricing : 'listed';
}

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
  // be able to change seats or cycle.
  //
  // A quoted tier has no catalogue allowance (`null`) and so can never be the
  // smaller side of a move: refusing an *upgrade* to Enterprise because the
  // workspace has been heavily using the product would be precisely backwards.
  // The guard still fires in the other direction — Enterprise → growth with 250
  // resolutions spent is a real downgrade, and this is where it is caught.
  const changingPlan = existing != null && planId !== existing.plan;
  if (
    changingPlan &&
    spec.aiResolutionsIncluded !== null &&
    spec.aiResolutionsIncluded < currentAiUsage
  ) {
    throw ApiError.validation(
      `The ${planId} plan includes ${spec.aiResolutionsIncluded} AI resolutions, ` +
        `below the ${currentAiUsage} already used this month.`,
    );
  }

  // What a quoted tier bills. The catalogue has no number for Enterprise and
  // this repo may not invent one (ADR-13's figures are the PRD's), so moving to
  // it leaves the amounts already on the row exactly where they are: the plan
  // change alone must not silently re-price a workspace in either direction.
  // A workspace that has never checked out falls back to the list figures for
  // the same reason — they are the only numbers anyone has agreed to.
  //
  // The honest part is that nobody reads these as an Enterprise price: the
  // subscription view reports `pricing: "quoted"` alongside them, which is what
  // a client shows instead of a per-seat figure. The real number arrives from a
  // signed contract, and this deployment has no surface that takes one.
  const fallback = PLANS.growth;
  const data = {
    plan: planId,
    billingCycle,
    seats: requestedSeats,
    unitPriceCents: spec.unitPriceCents ?? existing?.unitPriceCents ?? fallback.unitPriceCents,
    aiResolutionsIncluded:
      spec.aiResolutionsIncluded ??
      existing?.aiResolutionsIncluded ??
      fallback.aiResolutionsIncluded,
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

/**
 * Raise the purchased seat count to cover the people who can actually sign in,
 * and return the move if there was one (NFR-S11 · S11-f).
 *
 * `updateSubscription` above states the rule for a human at the checkout: you
 * cannot buy fewer seats than you have non-suspended agents (FR-MOD-10.1.3).
 * Directory provisioning approaches the same rule from the other side — it adds
 * the agent first — and something has to give. Three ways out, and only one of
 * them is defensible:
 *
 *   - **Refuse the create.** Commercially tidy, operationally awful: the
 *     directory is the source of truth, its connector would retry the same call
 *     forever, and a new hire would silently have no account until somebody
 *     noticed. It also fails in the direction that costs the customer, not us.
 *   - **Let headcount exceed seats.** Under-bills, and — worse — leaves the
 *     workspace in a state its *own* checkout refuses to save: the next admin to
 *     change the billing cycle gets a validation error about a seat count they
 *     never chose, caused by a sync they cannot see.
 *   - **Raise the count.** The bill follows the people, which is what "$99 per
 *     user per month" (ADR-13) already promises, and the workspace can see the
 *     new figure in Reports → Billing the moment it changes.
 *
 * It only ever goes **up**. Lowering is a downgrade, and a downgrade is a
 * commercial decision the workspace makes — an admin at `PATCH
 * /billing/subscription`, once headcount has actually dropped and the floor
 * rule allows it. A directory that deprovisions thirty people overnight must not
 * be able to shrink a customer's committed plan mid-cycle on its own.
 *
 * A workspace with no subscription row is on trial: it has bought nothing, so
 * there is nothing to raise, and both the billing view and the invoice already
 * fall back to live headcount for it. Creating a row here would turn a
 * provisioning call into the moment a trial started looking subscribed.
 */
export async function ensureSeatsCoverHeadcount(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<{ from: number; to: number } | null> {
  const [subscription, headcount] = await Promise.all([
    tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
    }),
    tx.agentMembership.count({ where: { suspended: false } }),
  ]);

  if (!subscription || subscription.seats >= headcount) return null;

  // Keyed by id, so two provisioning calls racing to grow the same subscription
  // both land on the row the read found rather than one of them creating a
  // second one.
  await tx.subscription.update({ where: { id: subscription.id }, data: { seats: headcount } });
  return { from: subscription.seats, to: headcount };
}
