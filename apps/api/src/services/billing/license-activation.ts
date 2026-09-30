/**
 * Paying is how a trial becomes a paid licence (FR-MOD-10.2 · ADR-10 · tm 256.1).
 *
 * The trial gate (`plugins/license-gate.ts`) turns an expired trial read-only,
 * and its refusal tells the admin to subscribe. Until this module, subscribing
 * did nothing to the gate: the checkout wrote a `subscriptions` row and the
 * card went into `payment_methods`, while `trialState` reads only
 * `licenses.status` + `trial_ends_at` — and nothing anywhere ever moved a
 * licence off `trialing`. A workspace that did exactly what the refusal asked
 * stayed read-only for good, and so did every workspace on day fifteen.
 *
 * The rule: a licence is paid for once it has BOTH a plan (a subscription row)
 * and a card on file. Either alone is not a purchase — a plan with no way to
 * charge it, or a card with nothing to charge for. The two billing writes that
 * can complete the pair (`PATCH /billing/subscription`, `PUT
 * /billing/payment-method`, both writable while read-only) call this in their
 * own transaction, in either order.
 *
 * `active` with `trial_ends_at` cleared is the shape an activated licence has
 * everywhere else in the repository (the checkout tests' `activate()` helper
 * wrote it by hand for exactly this reason). A trial that is still running
 * counts too: subscribing early ends the trial, and the banner with it.
 *
 * `canceled` is not lifted: a cancelled workspace is being wound down
 * (`token-service` already refuses its tokens), and a checkout is not how it
 * comes back.
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/** Licence states a completed purchase lifts to `active`. */
const PAYABLE_STATES = ['trialing', 'read_only', 'past_due'] as const;

export type LicenseActivation = { activated: false } | { activated: true; from: string };

/**
 * Make the licence `active` when it now has a plan and a card; otherwise leave
 * it alone. Idempotent: an already-active licence reports `activated: false`,
 * so a caller can write its audit entry only on the transition.
 *
 * Call it after the caller's own half is written, inside the same transaction.
 */
export async function activateIfPaid(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<LicenseActivation> {
  // The lock on the caller's own licence row serialises the two halves of a
  // purchase. A plan and a card saved at the same moment (two tabs, two
  // admins) each write their own half first; without the lock each would then
  // look for the other before it had committed, find nothing, and leave the
  // licence read-only with both on file. With it, whichever transaction takes
  // the lock second reads the first one's committed row — READ COMMITTED takes
  // a fresh snapshot per statement — and activates; and it reads the status
  // the first one may just have written, so one transition, one audit entry.
  //
  // `NO KEY UPDATE`, not `UPDATE`: each half's insert already holds a key-share
  // lock on this row through its foreign key, and `FOR UPDATE` conflicts with
  // that — the two transactions would each wait on the other's insert, a
  // deadlock. `NO KEY UPDATE` conflicts only with itself here, and it is the
  // lock the status update below takes anyway.
  const [license] = await tx.$queryRaw<Array<{ status: string }>>`
    SELECT status FROM licenses WHERE id = ${tenant.licenseId} FOR NO KEY UPDATE`;
  if (!license || !(PAYABLE_STATES as readonly string[]).includes(license.status)) {
    return { activated: false };
  }

  const [plan, card] = await Promise.all([
    tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      select: { id: true },
    }),
    tx.paymentMethod.findUnique({
      where: { licenseId: tenant.licenseId },
      select: { licenseId: true },
    }),
  ]);
  if (!plan || !card) return { activated: false };

  await tx.license.update({
    where: { id: tenant.licenseId },
    data: { status: 'active', trialEndsAt: null },
  });
  return { activated: true, from: license.status };
}
