/**
 * The card processor seam (M-PROV-a · §D113/K3 · tm 382 · ADR-13a) —
 * `STRIPE_PROVIDER`.
 *
 * Two implementations. `mock` (the default, ADR-13) charges nothing: it takes
 * the masked card form and accepts any unexpired card, which is how every
 * test, demo and the pilot run. `stripe` (`stripe-provider.ts`) speaks Stripe's
 * REST API; this build runs it only against a stand-in (tests) or sandbox keys
 * an operator supplies — no key is in the repository, and going live is a
 * human decision (ADR-13a §4).
 *
 * **Where the line falls.** A processor holds the card: it takes it on its own
 * hosted page (so card data never reaches SiyahTuş — PCI SAQ A), keeps a
 * customer and a saved payment method, charges that method later, refunds,
 * and tells us what happened through a signed webhook. Everything about *what*
 * a payment pays for — the term, the licence it lifts, the dunning plan — is
 * ours and processor-independent (`payment-methods.ts`): the bank transfer and
 * the crypto transfer pay exactly the same way without any processor at all.
 *
 * The methods are the ones a real processor has an honest version of
 * (ADR-13a §4). The mock has none of the hosted ones — it has no page to send
 * a browser to — so it says so with `hostedCheckout: false` and refuses them;
 * nothing calls them on it, because `stripe` is not offered on the mock.
 */
import { ApiError } from '../../lib/api-error.js';
// A cycle, and a safe one: each side uses the other only inside functions.
import { StripePaymentProvider } from './stripe-provider.js';

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

/** A hosted checkout for one term: the processor's page takes the card. */
export interface HostedCheckoutInput {
  customerId: string;
  amountMinor: number;
  currency: string;
  /** Ours — carried in the processor's metadata so its webhook names it back. */
  transactionId: string;
  reference: string;
  description: string;
  successUrl: string;
  cancelUrl: string;
}

/** An off-session charge of the card the checkout saved (a renewal). */
export interface ChargeInput {
  customerId: string;
  paymentMethodId: string;
  amountMinor: number;
  currency: string;
  transactionId: string;
  reference: string;
}

/**
 * What a charge came to. `pending` is the processor still deciding (its
 * webhook settles it); `failed` carries a code, never the processor's prose.
 */
export type ChargeResult =
  | { outcome: 'succeeded'; providerRef: string; paymentMethodId: string | null }
  | { outcome: 'failed'; providerRef: string | null; failureCode: string }
  | { outcome: 'pending'; providerRef: string };

/**
 * One processor event, read and verified. `ignored` is every event this build
 * has nothing to do with — acknowledged, so the processor stops sending it.
 */
export interface ProviderEvent {
  id: string;
  type: 'payment_succeeded' | 'payment_failed' | 'dispute_opened' | 'ignored';
  /** Our transaction id from the event's metadata, when it carries one. */
  transactionId: string | null;
  /** The processor's id for the payment (a Stripe payment intent). */
  providerRef: string | null;
  customerId: string | null;
  paymentMethodId: string | null;
  failureCode: string | null;
}

/**
 * The processor did not answer, or answered with an error of its own — an
 * outage from our side (503), never the client's mistake. A refused card is
 * not this: that is a `failed` charge.
 */
export class PaymentProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

/** A webhook whose signature is missing, wrong or stale. */
export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export interface PaymentProvider {
  /** The `STRIPE_PROVIDER` value this implementation serves. */
  readonly name: PaymentProviderId;
  /**
   * Whether cards are taken on the processor's own page. False on the mock,
   * whose card path is the masked form; true on Stripe, whose card path is the
   * hosted checkout — and which therefore refuses the masked form.
   */
  readonly hostedCheckout: boolean;
  /**
   * Register a card and return the masked representation to keep on file
   * (the mock's card form). Rejects with an `ApiError` for a card the
   * processor refuses — a client's mistake, not an outage.
   *
   * `now` is injected for the reason every sweep takes one: an expiry rule is
   * only testable against a clock the test controls.
   */
  registerPaymentMethod(
    details: PaymentMethodDetails,
    options?: { now?: Date },
  ): Promise<PaymentMethodDetails>;
  /** The processor's customer for a workspace — made once, kept on the subscription. */
  createCustomer(input: {
    licenseId: bigint;
    name: string;
    email: string | null;
  }): Promise<{ customerId: string }>;
  createCheckoutSession(input: HostedCheckoutInput): Promise<{ sessionId: string; url: string }>;
  chargeInvoice(input: ChargeInput): Promise<ChargeResult>;
  /**
   * Give money back. No route calls it in this build — SiyahTuş does not
   * refund (BL-03 decision 2) — but a processor that can take money has to be
   * able to return it, and an operator correcting a double charge needs it.
   */
  refund(input: {
    providerRef: string;
    amountMinor?: number;
    idempotencyKey: string;
  }): Promise<{ refundId: string }>;
  /**
   * Verify a webhook's signature over its raw bytes and read it. Throws
   * {@link WebhookSignatureError} before anything is parsed when the
   * signature does not hold.
   */
  parseWebhook(rawBody: Buffer, signature: string | undefined, now?: Date): ProviderEvent;
}

/** The payment processors this deployment can select between (`STRIPE_PROVIDER`). */
export const PAYMENT_PROVIDERS = ['mock', 'stripe'] as const;
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
  readonly hostedCheckout = false;

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

  async createCustomer(): Promise<{ customerId: string }> {
    throw new PaymentProviderError('The mock processor has no customers.');
  }

  async createCheckoutSession(): Promise<{ sessionId: string; url: string }> {
    throw new PaymentProviderError('The mock processor has no hosted checkout.');
  }

  async chargeInvoice(): Promise<ChargeResult> {
    throw new PaymentProviderError('The mock processor charges nothing.');
  }

  async refund(): Promise<{ refundId: string }> {
    throw new PaymentProviderError('The mock processor charges nothing to refund.');
  }

  parseWebhook(): ProviderEvent {
    throw new WebhookSignatureError('The mock processor sends no webhooks.');
  }
}

/** What `stripe` needs besides the vocabulary — the two keys and how to reach the API. */
export interface StripeProviderConfig {
  secretKey: string;
  webhookSecret: string;
  /** Injected in tests: a stand-in for `api.stripe.com`. Omitted, the global `fetch`. */
  fetch?: typeof fetch;
}

/**
 * The provider `STRIPE_PROVIDER` names. `stripe` needs its keys; the boot path
 * goes through {@link resolvePaymentProvider}, which falls back to the mock
 * with a warning instead of throwing.
 */
export function createPaymentProvider(
  provider: PaymentProviderId,
  stripe?: StripeProviderConfig,
): PaymentProvider {
  switch (provider) {
    case 'mock':
      return new MockPaymentProvider();
    case 'stripe':
      if (!stripe)
        throw new Error('STRIPE_PROVIDER=stripe needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET');
      return new StripePaymentProvider(stripe);
  }
}

export interface PaymentProviderEnv {
  NODE_ENV: string;
  STRIPE_PROVIDER: PaymentProviderId;
  STRIPE_SECRET_KEY?: string | undefined;
  STRIPE_WEBHOOK_SECRET?: string | undefined;
}

/**
 * The processor this deployment runs, and why it is not the one asked for.
 *
 * `stripe` without both keys stays on the mock and the boot says which key is
 * missing — never a refusal to start: the bank transfer and crypto work without
 * Stripe (ADR-13a §4). A live key (`sk_live_…`) outside `NODE_ENV=production`
 * is refused the same way: a developer's machine must not charge real cards.
 */
export function resolvePaymentProvider(
  env: PaymentProviderEnv,
  options: { fetch?: typeof fetch } = {},
): { provider: PaymentProvider; warnings: string[] } {
  if (env.STRIPE_PROVIDER === 'mock') return { provider: new MockPaymentProvider(), warnings: [] };
  const missing = (['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] as const).filter(
    (key) => !env[key],
  );
  if (missing.length > 0) {
    return {
      provider: new MockPaymentProvider(),
      warnings: [
        `STRIPE_PROVIDER=stripe but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set; card payments stay on the mock and Stripe is not offered.`,
      ],
    };
  }
  const secretKey = env.STRIPE_SECRET_KEY as string;
  if (secretKey.startsWith('sk_live_') && env.NODE_ENV !== 'production') {
    return {
      provider: new MockPaymentProvider(),
      warnings: [
        'STRIPE_SECRET_KEY is a live key outside NODE_ENV=production; it is ignored and card payments stay on the mock.',
      ],
    };
  }
  return {
    provider: new StripePaymentProvider({
      secretKey,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET as string,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    }),
    warnings: [],
  };
}
