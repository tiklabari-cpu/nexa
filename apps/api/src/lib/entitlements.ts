/**
 * The entitlement gate (FR-MOD-11.5) — the one place that answers "has this
 * workspace bought this capability?".
 *
 * `11.5-a` built the vocabulary and the catalogue: six keys, derived from the
 * subscription's plan, reported by `GET /billing/entitlements`. That endpoint
 * *tells* a screen what to render. This module is what *refuses*, and the
 * distinction matters — a control hidden in the UI is a control anyone with
 * `curl` still has.
 *
 * **One question, one function.** Every gate goes through
 * {@link readEntitlements}, which reads the subscription and expands its plan.
 * A second path to "may they?" — a cached flag, a column somebody added, a
 * route that checks the plan name itself — is how two answers start disagreeing
 * with nobody able to say which one is authoritative.
 *
 * **Both ends, not just the write.** The half that is easy to get right is
 * refusing the write. The half that actually leaks is the read: a workspace
 * that turned white-label on while it had the entitlement keeps a
 * `powered_by = false` row after it downgrades, and the widget goes on shipping
 * unbranded forever. So the row is *not* deleted (§C-A26 — a downgrade must not
 * destroy configuration a re-upgrade should restore) and the read path applies
 * the rule instead. {@link poweredByFor} is that rule, in one place, for all
 * three surfaces that serve the widget's look.
 *
 * Read fresh on every call, never cached — the same trade `plugins/license-gate.ts`
 * makes: a cached entitlement keeps honouring a capability for the length of the
 * TTL after the plan that granted it is gone, which is precisely the window this
 * gate exists to close. It costs one indexed lookup, inside a transaction the
 * caller already has open.
 */
import type { Entitlement, EntitlementMap } from '@nexa/types';
import { entitlementsForPlan } from '../services/billing/subscription-service.js';
import { ApiError } from './api-error.js';
import type { TenantClient, TenantContext } from './tenant.js';

/**
 * What a workspace with no subscription row is treated as.
 *
 * No row means a trial (ADR-10): it has bought nothing, so it unlocks nothing
 * beyond the self-serve tier. Named here and matched to
 * `GET /billing/entitlements`, so what the endpoint *reports* to a screen and
 * what this module *enforces* cannot come apart on a workspace that has never
 * checked out. Exported for the report builders (`report-csv.ts`), which read
 * a plan by license id alone and need the same no-subscription fallback.
 */
export const TRIAL_PLAN = 'growth';

/**
 * How each capability is named to someone who just hit the wall.
 *
 * `Record<Entitlement, string>` rather than a lookup with a fallback: adding a
 * key to `ENTITLEMENTS` without naming it here stops the build, so a refusal
 * can never come back describing itself as `undefined`.
 */
const ENTITLEMENT_LABELS: Record<Entitlement, string> = {
  white_label: 'Removing Nexa branding from the widget',
  sandbox: 'A sandbox workspace',
  sla: 'SLA targets and breach reporting',
  sso: 'Single sign-on and directory provisioning',
  hipaa: 'HIPAA cover',
  siem_export: 'SIEM export',
};

/**
 * This workspace's plan and what it unlocks.
 *
 * Addressed by `licenseId` rather than left to `findFirst`: RLS narrows to the
 * *organization*, and one organization may hold several licences (schema,
 * `License`) — the caller's is the one their credential names, not whichever
 * row comes back first. `/settings/compliance` reads its licence the same way
 * and for the same reason.
 */
export async function readEntitlements(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<{ plan: string; entitlements: EntitlementMap }> {
  const subscription = await tx.subscription.findFirst({
    where: { licenseId: tenant.licenseId },
    orderBy: { createdAt: 'desc' },
    select: { plan: true },
  });

  const plan = subscription?.plan ?? TRIAL_PLAN;
  return { plan, entitlements: entitlementsForPlan(plan) };
}

export async function hasEntitlement(
  tx: TenantClient,
  tenant: TenantContext,
  key: Entitlement,
): Promise<boolean> {
  const { entitlements } = await readEntitlements(tx, tenant);
  return entitlements[key];
}

/**
 * Refuse, with the plan that was checked and the capability that was missing.
 *
 * `not_allowed` (403), not `authorization`: nothing is wrong with the
 * credential and no scope or role would change the answer. The workspace has
 * not bought this, which is a fact about the licence rather than about who is
 * holding it — the same distinction `/settings/compliance/baa` draws when it
 * refuses a workspace hosted outside the US.
 *
 * Nothing here is enumerable. A caller who reaches this already holds a
 * credential for the workspace and can read its plan from
 * `GET /billing/entitlements`; saying so plainly is what lets a client show
 * "upgrade to Enterprise" instead of an unexplained failure.
 */
export function entitlementDenied(key: Entitlement, plan: string): ApiError {
  return new ApiError(
    'not_allowed',
    `${ENTITLEMENT_LABELS[key]} is not included in the ${plan} plan.`,
    { details: { entitlement: key, plan } },
  );
}

/** {@link hasEntitlement}, but throwing — for a caller that has nothing to say about "no". */
export async function requireEntitlement(
  tx: TenantClient,
  tenant: TenantContext,
  key: Entitlement,
): Promise<void> {
  const { plan, entitlements } = await readEntitlements(tx, tenant);
  if (!entitlements[key]) throw entitlementDenied(key, plan);
}

/**
 * Whether the widget must show "Powered by Nexa" — the white-label rule, for
 * every path that serves the widget's appearance.
 *
 * The stored value is the workspace's *intent*; this is what it is allowed to
 * mean today. Branding stays on unless the licence has bought the right to turn
 * it off, so a workspace that downgrades goes back to branded on its next page
 * load, without a migration, a sweep, or a row being rewritten behind its back
 * (§C-A26).
 *
 * `stored === true` short-circuits before the query on purpose, and it is
 * correct by construction rather than by luck: branding *on* is the answer
 * under both entitlements, so there is nothing to ask. That is the common case
 * — including every visitor minting a customer token — so the overwhelming
 * majority of widget loads pay nothing for this rule at all.
 */
export async function poweredByFor(
  tx: TenantClient,
  tenant: TenantContext,
  stored: boolean,
): Promise<boolean> {
  if (stored) return true;
  // Stored as "hide the branding". It stays hidden only while the licence says
  // it may be; otherwise the branding comes back.
  return !(await hasEntitlement(tx, tenant, 'white_label'));
}

/**
 * The most `applySeatEffect` (`routes/scim.ts`) may raise a workspace's
 * purchased seat count in one reconciliation, before an administrator has to
 * confirm the new commitment at `PATCH /billing/subscription` (§D116 LOW (5)).
 *
 * `ensureSeatsCoverHeadcount` raising `seats` to match headcount is
 * deliberate — see its own doc comment — and this does not undo that: the
 * bill following the people is what "$99 per user per month" (ADR-13)
 * already promises, and refusing an ordinary directory sync would be worse
 * than the problem this closes. What is different here is *where the number
 * comes from*. SCIM reaches only the `enterprise` plan (`scimRoute`'s
 * `entitlement: 'sso'`, granted only there — `PLANS` in
 * `services/billing/subscription-service.ts`), and enterprise is priced by a
 * signed, out-of-band quote (ADR-13): `PLANS.enterprise.unitPriceCents` is
 * deliberately `null`, so this schema holds no committed seat count to check
 * growth against — only whatever the last human checkout or reconciliation
 * left in `subscription.seats`. A misconfigured connector re-provisioning the
 * same source directory into the wrong tenant, or looping on a create it
 * believes failed, has nothing here to stop it from raising that number
 * without limit.
 *
 * This constant is that stop: a safety rail on *unattended* growth, not a
 * price. It plays the same role `MAX_ACTIVE_SCIM_TOKENS` (`routes/settings.ts`)
 * plays for how many live directory credentials a workspace may hold, and is
 * sized the way `SCIM_MAX_PAGE_SIZE` (`lib/scim.ts`) is — generous enough for
 * a real directory sync, bounded enough that reaching it is itself the
 * signal something is wrong, not a real company's headcount.
 */
export const SCIM_SEAT_CEILING = 200;

/**
 * Refuse a directory-driven seat increase past {@link SCIM_SEAT_CEILING},
 * before anything is written.
 *
 * Takes the active headcount the caller is *about* to reach, not one read
 * after the fact: checked too late, this would be answering for a workspace
 * that has already moved on, with `routes/scim.ts` having written the
 * membership (or reinstated it) it now has no way to undo. A refusal must
 * land before that write or it stops being a refusal — a member provisioned
 * with no seat behind them is exactly the "grows the bill unsupervised"
 * outcome this exists to prevent, just relabelled as a rejected response
 * (§D116 LOW (5)).
 */
export function assertScimSeatCeiling(nextActiveHeadcount: number): void {
  if (nextActiveHeadcount <= SCIM_SEAT_CEILING) return;
  throw new ApiError(
    'limit_reached',
    `Directory provisioning would raise this workspace to ${nextActiveHeadcount} active ` +
      `members, above the ${SCIM_SEAT_CEILING}-seat safety ceiling on unattended growth. ` +
      'An administrator must confirm the new seat count at Settings → Billing before ' +
      'provisioning more active members over SCIM.',
  );
}
