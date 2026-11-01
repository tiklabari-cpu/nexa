/**
 * The Stripe adapter (tm 382 · ADR-13a §4) — `STRIPE_PROVIDER=stripe`.
 *
 * Plain REST over `fetch` (form-encoded, `Authorization: Bearer <secret>`),
 * no SDK: five calls is all this build makes, and an injected `fetch` is how
 * every test runs it against a stand-in without a network or a key. The
 * stand-in speaks the same request and response shapes Stripe documents; CI
 * never reaches `api.stripe.com` (ADR-13a §4), and no key — live or sandbox —
 * is in the repository.
 *
 * What it does with Stripe:
 *   - a **customer** per workspace, kept on the subscription;
 *   - a **hosted checkout** (`mode=payment`) for one term, with
 *     `setup_future_usage=off_session` so the card is saved for the renewal —
 *     the card is typed into Stripe's page, never ours (PCI SAQ A);
 *   - an **off-session charge** of that card when the term runs out (the
 *     dunning job), with our transaction id as the idempotency key so a retry
 *     after a crash charges once;
 *   - a **refund** (no caller in this build — BL-03 decision 2);
 *   - the **webhook**: `Stripe-Signature` is checked over the raw bytes before
 *     anything is read, and the three events this build acts on are mapped to
 *     the processor-independent `ProviderEvent`.
 *
 * Every call carries our transaction id in `metadata`, so the webhook names
 * the payment back without a lookup by amount or customer.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../../lib/api-error.js';
import {
  PaymentProviderError,
  WebhookSignatureError,
  type ChargeInput,
  type ChargeResult,
  type HostedCheckoutInput,
  type PaymentMethodDetails,
  type PaymentProvider,
  type ProviderEvent,
  type StripeProviderConfig,
} from './payment-provider.js';

const STRIPE_API = 'https://api.stripe.com';
/** Pinned, so a change to the account's default version cannot reshape a response. */
export const STRIPE_API_VERSION = '2024-06-20';
const REQUEST_TIMEOUT_MS = 10_000;
/** How old a signed webhook may be — Stripe's own default tolerance. */
export const STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300;

type Params = Record<string, string | number | boolean | null | undefined>;

function formBody(params: Params): string {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    body.append(key, String(value));
  }
  return body.toString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 ? value : null;
}

/**
 * A processor failure as a code the database keeps (`failure_code`): lower
 * snake case, at most 64 characters. Anything else — prose, a number, nothing —
 * is the generic `payment_failed`, because a decline message can carry the
 * cardholder's details and has no business in our tables.
 */
export function failureCodeOf(value: unknown): string {
  return typeof value === 'string' && /^[a-z][a-z0-9_]{0,63}$/.test(value)
    ? value
    : 'payment_failed';
}

/**
 * The `Stripe-Signature` header Stripe would send for this body — for tests and
 * the local stand-in, which sign with a secret they made up.
 */
export function stripeSignatureHeader(
  secret: string,
  payload: string | Buffer,
  timestampSeconds: number,
): string {
  const raw = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
  const mac = createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from(`${timestampSeconds}.`, 'utf8'), raw]))
    .digest('hex');
  return `t=${timestampSeconds},v1=${mac}`;
}

/**
 * Check a webhook's signature: the timestamp is within the tolerance and one
 * of the `v1` signatures is the HMAC-SHA256 of `<t>.<raw body>` under the
 * endpoint secret. Constant-time comparison; throws on any failure.
 */
export function verifyStripeSignature(
  secret: string,
  rawBody: Buffer,
  header: string | undefined,
  now: Date = new Date(),
): void {
  if (!header) throw new WebhookSignatureError('Missing Stripe-Signature header.');
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2) as [string, string | undefined];
    if (key.trim() === 't' && value) timestamp = value.trim();
    if (key.trim() === 'v1' && value) signatures.push(value.trim());
  }
  if (!timestamp || !/^[0-9]{1,12}$/.test(timestamp) || signatures.length === 0) {
    throw new WebhookSignatureError('Malformed Stripe-Signature header.');
  }
  const age = Math.abs(Math.floor(now.getTime() / 1000) - Number(timestamp));
  if (age > STRIPE_SIGNATURE_TOLERANCE_SECONDS) {
    throw new WebhookSignatureError('Stale Stripe-Signature timestamp.');
  }
  const expected = Buffer.from(
    stripeSignatureHeader(secret, rawBody, Number(timestamp)).split('v1=')[1] ?? '',
    'hex',
  );
  const match = signatures.some((signature) => {
    if (!/^[0-9a-f]+$/.test(signature)) return false;
    const given = Buffer.from(signature, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!match) throw new WebhookSignatureError('Stripe-Signature does not match.');
}

/** Read a verified Stripe event into the processor-independent shape. */
export function readStripeEvent(body: unknown): ProviderEvent {
  const event = asRecord(body);
  const id = asString(event['id']);
  if (!id) throw ApiError.validation('The webhook body is not a Stripe event.');
  const type = typeof event['type'] === 'string' ? event['type'] : '';
  const object = asRecord(asRecord(event['data'])['object']);
  const metadata = asRecord(object['metadata']);
  const base: ProviderEvent = {
    id,
    type: 'ignored',
    transactionId: asString(metadata['transaction_id']),
    providerRef: null,
    customerId: asString(object['customer']),
    paymentMethodId: asString(object['payment_method']),
    failureCode: null,
  };
  switch (type) {
    case 'payment_intent.succeeded':
      return { ...base, type: 'payment_succeeded', providerRef: asString(object['id']) };
    case 'payment_intent.payment_failed': {
      const error = asRecord(object['last_payment_error']);
      return {
        ...base,
        type: 'payment_failed',
        providerRef: asString(object['id']),
        failureCode: failureCodeOf(error['decline_code'] ?? error['code']),
      };
    }
    case 'charge.dispute.created':
      return {
        ...base,
        type: 'dispute_opened',
        transactionId: null,
        providerRef: asString(object['payment_intent']),
      };
    default:
      return base;
  }
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  readonly hostedCheckout = true;
  readonly #config: StripeProviderConfig;

  constructor(config: StripeProviderConfig) {
    this.#config = config;
  }

  /**
   * The masked card form is the mock's card path. With a real processor a
   * card is typed into its hosted page only, so a form that hands us card
   * details — even masked ones nobody verified — is refused rather than
   * trusted to activate a workspace.
   */
  async registerPaymentMethod(_details: PaymentMethodDetails): Promise<PaymentMethodDetails> {
    throw ApiError.validation('Cards are entered on the payment page, not here.', {
      reason: 'hosted_checkout_required',
    });
  }

  async #post(
    path: string,
    params: Params,
    idempotencyKey?: string,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const doFetch = this.#config.fetch ?? fetch;
    let response: Response;
    try {
      response = await doFetch(`${STRIPE_API}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#config.secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          'stripe-version': STRIPE_API_VERSION,
          ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}),
        },
        body: formBody(params),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new PaymentProviderError('Stripe did not answer.');
    }
    let body: Record<string, unknown>;
    try {
      body = asRecord(await response.json());
    } catch {
      throw new PaymentProviderError(`Stripe answered ${response.status} without JSON.`);
    }
    return { status: response.status, body };
  }

  async createCustomer(input: {
    licenseId: bigint;
    name: string;
    email: string | null;
  }): Promise<{ customerId: string }> {
    const { status, body } = await this.#post(
      '/v1/customers',
      { name: input.name, email: input.email, 'metadata[license_id]': input.licenseId.toString() },
      `customer-${input.licenseId.toString()}`,
    );
    const id = asString(body['id']);
    if (status !== 200 || !id) throw new PaymentProviderError(`Stripe customer: ${status}.`);
    return { customerId: id };
  }

  async createCheckoutSession(
    input: HostedCheckoutInput,
  ): Promise<{ sessionId: string; url: string }> {
    const { status, body } = await this.#post(
      '/v1/checkout/sessions',
      {
        mode: 'payment',
        customer: input.customerId,
        client_reference_id: input.reference,
        success_url: input.successUrl,
        cancel_url: input.cancelUrl,
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': input.currency,
        'line_items[0][price_data][unit_amount]': input.amountMinor,
        'line_items[0][price_data][product_data][name]': input.description,
        'payment_intent_data[setup_future_usage]': 'off_session',
        'payment_intent_data[metadata][transaction_id]': input.transactionId,
        'payment_intent_data[metadata][reference]': input.reference,
        'metadata[transaction_id]': input.transactionId,
      },
      `checkout-${input.transactionId}`,
    );
    const id = asString(body['id']);
    const url = typeof body['url'] === 'string' ? body['url'] : null;
    if (status !== 200 || !id || !url || !/^https:\/\//.test(url)) {
      throw new PaymentProviderError(`Stripe checkout session: ${status}.`);
    }
    return { sessionId: id, url };
  }

  async chargeInvoice(input: ChargeInput): Promise<ChargeResult> {
    const { status, body } = await this.#post(
      '/v1/payment_intents',
      {
        amount: input.amountMinor,
        currency: input.currency,
        customer: input.customerId,
        payment_method: input.paymentMethodId,
        off_session: true,
        confirm: true,
        'metadata[transaction_id]': input.transactionId,
        'metadata[reference]': input.reference,
      },
      `charge-${input.transactionId}`,
    );
    if (status === 200) {
      const id = asString(body['id']);
      if (!id) throw new PaymentProviderError('Stripe payment intent without an id.');
      switch (body['status']) {
        case 'succeeded':
          return {
            outcome: 'succeeded',
            providerRef: id,
            paymentMethodId: asString(body['payment_method']),
          };
        case 'processing':
          return { outcome: 'pending', providerRef: id };
        case 'requires_action':
          return { outcome: 'failed', providerRef: id, failureCode: 'authentication_required' };
        default:
          return { outcome: 'failed', providerRef: id, failureCode: 'payment_failed' };
      }
    }
    // A declined card is Stripe's 402 with the payment intent inside the
    // error — a failed charge, not an outage.
    if (status === 402) {
      const error = asRecord(body['error']);
      return {
        outcome: 'failed',
        providerRef: asString(asRecord(error['payment_intent'])['id']),
        failureCode: failureCodeOf(error['decline_code'] ?? error['code']),
      };
    }
    throw new PaymentProviderError(`Stripe charge: ${status}.`);
  }

  async refund(input: {
    providerRef: string;
    amountMinor?: number;
    idempotencyKey: string;
  }): Promise<{ refundId: string }> {
    const { status, body } = await this.#post(
      '/v1/refunds',
      { payment_intent: input.providerRef, amount: input.amountMinor },
      input.idempotencyKey,
    );
    const id = asString(body['id']);
    if (status !== 200 || !id) throw new PaymentProviderError(`Stripe refund: ${status}.`);
    return { refundId: id };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined, now?: Date): ProviderEvent {
    verifyStripeSignature(this.#config.webhookSecret, rawBody, signature, now);
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw ApiError.validation('The webhook body is not JSON.');
    }
    return readStripeEvent(body);
  }
}
