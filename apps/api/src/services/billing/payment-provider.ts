/**
 * The payment processor seam (M-PROV-a · §D113/K3) — `STRIPE_PROVIDER`.
 *
 * Billing is mocked (ADR-13) and card entry is out of scope (PRD §11.1/1), so
 * there is one implementation and it charges nothing. The point of the seam is
 * not that a second one exists; it is that the boundary between *us* and *a
 * processor* is drawn somewhere, because today it was drawn nowhere and
 * `STRIPE_PROVIDER` was a validated string nothing read.
 *
 * **Where the line falls.** A processor takes card details, decides whether it
 * would accept them, and hands back the masked representation it will recognise
 * later; storing that representation against a workspace is ours, and stays in
 * `payment-method-service.ts` with the tenant transaction. So the only method
 * here is `registerPaymentMethod`, and the only judgement inside the mock is the
 * expiry check that used to live in that file — the same check, the same
 * `ApiError.validation`, the same message. Nothing about what the API does
 * changed; what changed is who owns the decision.
 *
 * A real Stripe provider would slot in by tokenising through their SDK and
 * returning `brand`/`last4`/`exp_*` off the resulting `PaymentMethod` — the four
 * fields this interface already speaks in, which is why they are the ones a real
 * processor exposes rather than an invention of ours. It would also gain the
 * methods a mock has no honest version of (detach, charge); those are not
 * declared here, because an interface with methods nobody calls is a promise a
 * second implementation has to keep blind.
 */
import { ApiError } from '../../lib/api-error.js';

/** Card networks the mock accepts — the four a real form would detect. */
export const PAYMENT_BRANDS = ['visa', 'mastercard', 'amex', 'discover'] as const;
export type PaymentBrand = (typeof PAYMENT_BRANDS)[number];

/**
 * A card as the processor speaks about it: masked already, never a full number.
 *
 * There is deliberately no field for a PAN, so the out-of-scope data cannot
 * cross this boundary even by accident.
 */
export interface PaymentMethodDetails {
  brand: PaymentBrand;
  last4: string;
  expMonth: number;
  expYear: number;
  holderName: string;
}

export interface PaymentProvider {
  /** The `STRIPE_PROVIDER` value this implementation serves. */
  readonly name: PaymentProviderId;
  /**
   * Register a card and return the masked representation to keep on file.
   *
   * Rejects with an `ApiError` for a card the processor refuses — which is a
   * client's mistake, not an outage, and is why the failure is a validation
   * error rather than a 502.
   *
   * `now` is injected for the reason every sweep takes one: an expiry rule is
   * only testable against a clock the test controls.
   */
  registerPaymentMethod(
    details: PaymentMethodDetails,
    options?: { now?: Date },
  ): Promise<PaymentMethodDetails>;
}

/** The payment providers this deployment can select between (`STRIPE_PROVIDER`). */
export const PAYMENT_PROVIDERS = ['mock'] as const;
export type PaymentProviderId = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Accepts any card that has not already expired, and hands it straight back.
 *
 * Compared at month granularity in UTC — a card is good through the last day of
 * its expiry month. A real form does this before it ever reaches a processor;
 * keeping it means a method on file is always one that *could* be charged,
 * rather than a dead card the workspace believes is good.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'mock' as const;

  async registerPaymentMethod(
    details: PaymentMethodDetails,
    options: { now?: Date } = {},
  ): Promise<PaymentMethodDetails> {
    const now = options.now ?? new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth() + 1;
    if (
      details.expYear < currentYear ||
      (details.expYear === currentYear && details.expMonth < currentMonth)
    ) {
      throw ApiError.validation('The card expiry date is in the past.');
    }
    return details;
  }
}

/** The provider `STRIPE_PROVIDER` names. */
export function createPaymentProvider(provider: PaymentProviderId): PaymentProvider {
  switch (provider) {
    case 'mock':
      return new MockPaymentProvider();
  }
}
