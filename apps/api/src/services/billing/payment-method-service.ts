/**
 * The payment method on file (FR-MOD-10.3, "ödeme yöntemi güncelleme").
 *
 * Billing is mocked (ADR-13) and real card entry is out of scope (PRD §11.1/1),
 * so nothing here collects or charges a card. What is stored is the *masked*
 * representation a real processor hands back after tokenising one — brand, last
 * four, expiry and holder — the same fields a Stripe `PaymentMethod` exposes and
 * the only ones safe to keep. There is deliberately no field for a full card
 * number, so the out-of-scope data cannot be persisted even by accident.
 */
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';

/** Card networks the mock accepts — the four a real form would detect. */
export const PAYMENT_BRANDS = ['visa', 'mastercard', 'amex', 'discover'] as const;
export type PaymentBrand = (typeof PAYMENT_BRANDS)[number];

export interface PaymentMethodInput {
  brand: PaymentBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string;
}

/** The wire shape — snake_case, `updated_at` as ISO, or null when none on file. */
export interface PaymentMethodView {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  holder_name: string;
  updated_at: string;
}

/**
 * Reject a card whose expiry is already past.
 *
 * A real card form does this before it ever reaches a processor; the mock keeps
 * the check so a saved method is always one that *could* be charged, rather than
 * a dead card the workspace thinks is on file. Compared at month granularity in
 * UTC — a card is good through the last day of its expiry month.
 */
function assertNotExpired(expMonth: number, expYear: number, now = new Date()): void {
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
    throw ApiError.validation('The card expiry date is in the past.');
  }
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
 * and updating it just overwrites the row. Semantic validation the request shape
 * cannot express — an expired card — is settled here before the write.
 */
export async function upsertPaymentMethod(
  tx: TenantClient,
  tenant: TenantContext,
  input: PaymentMethodInput,
): Promise<PaymentMethodView> {
  assertNotExpired(input.expMonth, input.expYear);

  const data = {
    brand: input.brand,
    last4: input.last4,
    expMonth: input.expMonth,
    expYear: input.expYear,
    holderName: input.holderName,
  };

  const row = await tx.paymentMethod.upsert({
    where: { licenseId: tenant.licenseId },
    create: { licenseId: tenant.licenseId, ...data },
    update: data,
  });

  return serialisePaymentMethod(row) as PaymentMethodView;
}
