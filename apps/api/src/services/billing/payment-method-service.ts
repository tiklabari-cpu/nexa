/**
 * The payment method on file (FR-MOD-10.3, "ödeme yöntemi güncelleme").
 *
 * Billing is mocked (ADR-13) and real card entry is out of scope (PRD §11.1/1),
 * so nothing here collects or charges a card. What is stored is the *masked*
 * representation a real processor hands back after tokenising one — brand, last
 * four, expiry and holder — the same fields a Stripe `PaymentMethod` exposes and
 * the only ones safe to keep. There is deliberately no field for a full card
 * number, so the out-of-scope data cannot be persisted even by accident.
 *
 * This module owns the *storage* half. Whether a card is acceptable at all is
 * the processor's call and lives behind `PaymentProvider` (`payment-provider.ts`)
 * — the seam `STRIPE_PROVIDER` selects through.
 */
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { PaymentMethodDetails, PaymentProvider } from './payment-provider.js';

/**
 * The card vocabulary and shape now belong to the processor seam
 * (`payment-provider.ts`), and are re-exported from where every caller has
 * always imported them. What a processor will accept is the processor's
 * statement, not this module's.
 */
export { PAYMENT_BRANDS, type PaymentBrand } from './payment-provider.js';
export type PaymentMethodInput = PaymentMethodDetails;

/** The wire shape — snake_case, `updated_at` as ISO, or null when none on file. */
export interface PaymentMethodView {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  holder_name: string;
  updated_at: string;
}

/** Serialise a stored row to the wire shape, or null when there is no method. */
export function serialisePaymentMethod(
  row: {
    brand: string;
    last4: string;
    expMonth: number;
    expYear: number;
    holderName: string;
    updatedAt: Date;
  } | null,
): PaymentMethodView | null {
  if (row === null) return null;
  return {
    brand: row.brand,
    last4: row.last4,
    exp_month: row.expMonth,
    exp_year: row.expYear,
    holder_name: row.holderName,
    updated_at: row.updatedAt.toISOString(),
  };
}

/** The method on file for this workspace, or null. RLS scopes the read. */
export async function getPaymentMethod(
  tx: TenantClient,
  tenant: TenantContext,
): Promise<PaymentMethodView | null> {
  const row = await tx.paymentMethod.findUnique({ where: { licenseId: tenant.licenseId } });
  return serialisePaymentMethod(row);
}

/**
 * Set (or replace) the payment method on file.
 *
 * An upsert on the license-keyed singleton: a workspace has at most one method,
 * and updating it just overwrites the row.
 *
 * The card goes past the processor first (`STRIPE_PROVIDER`, M-PROV-a). That is
 * where semantic validation the request shape cannot express now lives — an
 * expired card is refused by whoever would have to charge it, not by us — and
 * what gets stored is the masked representation the processor hands back, which
 * is the only thing a real one would let us keep. The mock returns the details
 * unchanged and rejects the same expiry with the same message, so nothing the
 * API does changed; a real provider would return its own normalised brand and
 * last four, and this write already stores those rather than the request's.
 */
export async function upsertPaymentMethod(
  tx: TenantClient,
  tenant: TenantContext,
  input: PaymentMethodInput,
  payments: PaymentProvider,
): Promise<PaymentMethodView> {
  const registered = await payments.registerPaymentMethod(input);

  const data = {
    brand: registered.brand,
    last4: registered.last4,
    expMonth: registered.expMonth,
    expYear: registered.expYear,
    holderName: registered.holderName,
  };

  const row = await tx.paymentMethod.upsert({
    where: { licenseId: tenant.licenseId },
    create: { licenseId: tenant.licenseId, ...data },
    update: data,
  });

  return serialisePaymentMethod(row) as PaymentMethodView;
}
