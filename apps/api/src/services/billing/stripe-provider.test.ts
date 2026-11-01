/**
 * The Stripe adapter against a stand-in `fetch` (tm 382 · ADR-13a §4): no
 * network, no key — the secret and the webhook signing secret are made up
 * here, which is the only way this repository ever signs a Stripe event.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api-error.js';
import { PaymentProviderError, WebhookSignatureError } from './payment-provider.js';
import {
  failureCodeOf,
  readStripeEvent,
  STRIPE_SIGNATURE_TOLERANCE_SECONDS,
  StripePaymentProvider,
  stripeSignatureHeader,
  verifyStripeSignature,
} from './stripe-provider.js';

const SECRET = 'whsec_test_made_up_here';
const NOW = new Date('2026-11-01T12:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: URLSearchParams;
}

function standIn(answer: (url: string) => { status: number; body: unknown } | Error): {
  fetch: typeof fetch;
  calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      headers: init?.headers as Record<string, string>,
      body: new URLSearchParams(String(init?.body ?? '')),
    });
    const result = answer(url);
    if (result instanceof Error) throw result;
    return new Response(JSON.stringify(result.body), { status: result.status });
  }) as typeof fetch;
  return { fetch: fake, calls };
}

function provider(doFetch: typeof fetch): StripePaymentProvider {
  return new StripePaymentProvider({
    secretKey: 'sk_test_made_up',
    webhookSecret: SECRET,
    fetch: doFetch,
  });
}

const CHARGE = {
  customerId: 'cus_1',
  paymentMethodId: 'pm_1',
  amountMinor: 9900,
  currency: 'usd',
  transactionId: '0b3c8a4e-4b1f-4f6e-9a55-3f2a1c9d7e10',
  reference: 'ST-7K2M-Q9TB',
};

describe('Stripe webhook signature (FR-MOD-10.3)', () => {
  const body = Buffer.from('{"id":"evt_1","type":"payment_intent.succeeded"}');

  it('accepts the signature Stripe would send', () => {
    expect(() =>
      verifyStripeSignature(SECRET, body, stripeSignatureHeader(SECRET, body, NOW_S), NOW),
    ).not.toThrow();
  });

  it('accepts one good signature among several, as during a secret rotation', () => {
    const good = stripeSignatureHeader(SECRET, body, NOW_S).split('v1=')[1]!;
    const header = `t=${NOW_S},v1=${'0'.repeat(64)},v1=${good}`;
    expect(() => verifyStripeSignature(SECRET, body, header, NOW)).not.toThrow();
  });

  it.each([
    ['no header', undefined],
    ['a malformed header', 'nonsense'],
    ['another secret', stripeSignatureHeader('whsec_someone_else', body, NOW_S)],
    ['a body changed after signing', stripeSignatureHeader(SECRET, Buffer.from('{}'), NOW_S)],
    [
      'a timestamp past the tolerance',
      stripeSignatureHeader(SECRET, body, NOW_S - STRIPE_SIGNATURE_TOLERANCE_SECONDS - 1),
    ],
  ])('refuses %s', (_label, header) => {
    expect(() => verifyStripeSignature(SECRET, body, header, NOW)).toThrow(WebhookSignatureError);
  });

  it('checks the signature before it reads the body', () => {
    const stripe = provider(standIn(() => ({ status: 200, body: {} })).fetch);
    expect(() => stripe.parseWebhook(Buffer.from('not json'), 't=1,v1=00', NOW)).toThrow(
      WebhookSignatureError,
    );
    const signed = Buffer.from('not json');
    expect(() =>
      stripe.parseWebhook(signed, stripeSignatureHeader(SECRET, signed, NOW_S), NOW),
    ).toThrow(ApiError);
  });
});

describe('readStripeEvent', () => {
  const event = (type: string, object: Record<string, unknown>) => ({
    id: 'evt_9',
    type,
    data: { object },
  });

  it('reads a succeeded payment intent with our transaction id and the saved card', () => {
    expect(
      readStripeEvent(
        event('payment_intent.succeeded', {
          id: 'pi_1',
          customer: 'cus_1',
          payment_method: 'pm_1',
          metadata: { transaction_id: CHARGE.transactionId },
        }),
      ),
    ).toEqual({
      id: 'evt_9',
      type: 'payment_succeeded',
      transactionId: CHARGE.transactionId,
      providerRef: 'pi_1',
      customerId: 'cus_1',
      paymentMethodId: 'pm_1',
      failureCode: null,
    });
  });

  it('keeps a decline code, and turns prose into the generic code', () => {
    const declined = readStripeEvent(
      event('payment_intent.payment_failed', {
        id: 'pi_2',
        last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' },
      }),
    );
    expect(declined).toMatchObject({ type: 'payment_failed', failureCode: 'insufficient_funds' });
    const prose = readStripeEvent(
      event('payment_intent.payment_failed', {
        id: 'pi_3',
        last_payment_error: { code: 'Your card ending 4242 was declined' },
      }),
    );
    expect(prose.failureCode).toBe('payment_failed');
  });

  it('names a dispute by its payment intent', () => {
    expect(
      readStripeEvent(event('charge.dispute.created', { payment_intent: 'pi_1' })),
    ).toMatchObject({ type: 'dispute_opened', providerRef: 'pi_1', transactionId: null });
  });

  it('ignores every other event and refuses a body that is not an event', () => {
    expect(readStripeEvent(event('customer.created', {})).type).toBe('ignored');
    expect(() => readStripeEvent({ type: 'x' })).toThrow(ApiError);
  });

  it('keeps failure codes to what the database stores', () => {
    expect(failureCodeOf('expired_card')).toBe('expired_card');
    expect(failureCodeOf('Expired Card')).toBe('payment_failed');
    expect(failureCodeOf(42)).toBe('payment_failed');
    expect(failureCodeOf('x'.repeat(65))).toBe('payment_failed');
  });
});

describe('StripePaymentProvider calls', () => {
  it('opens a hosted checkout that saves the card and carries our ids', async () => {
    const { fetch, calls } = standIn(() => ({
      status: 200,
      body: { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' },
    }));
    const session = await provider(fetch).createCheckoutSession({
      customerId: 'cus_1',
      amountMinor: 19800,
      currency: 'usd',
      transactionId: CHARGE.transactionId,
      reference: CHARGE.reference,
      description: 'SiyahTuş subscription',
      successUrl: 'https://panel.example/billing?payment=success',
      cancelUrl: 'https://panel.example/billing?payment=canceled',
    });
    expect(session).toEqual({ sessionId: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' });
    const [call] = calls;
    expect(call!.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(call!.headers['authorization']).toBe('Bearer sk_test_made_up');
    expect(call!.headers['idempotency-key']).toBe(`checkout-${CHARGE.transactionId}`);
    expect(call!.body.get('mode')).toBe('payment');
    expect(call!.body.get('line_items[0][price_data][unit_amount]')).toBe('19800');
    expect(call!.body.get('payment_intent_data[setup_future_usage]')).toBe('off_session');
    expect(call!.body.get('payment_intent_data[metadata][transaction_id]')).toBe(
      CHARGE.transactionId,
    );
    // No card field of any kind leaves SiyahTuş (PCI SAQ A).
    expect([...call!.body.keys()].some((key) => /card|number|cvc/i.test(key))).toBe(false);
  });

  it('charges the saved card off-session under our transaction id', async () => {
    const { fetch, calls } = standIn(() => ({
      status: 200,
      body: { id: 'pi_1', status: 'succeeded', payment_method: 'pm_1' },
    }));
    expect(await provider(fetch).chargeInvoice(CHARGE)).toEqual({
      outcome: 'succeeded',
      providerRef: 'pi_1',
      paymentMethodId: 'pm_1',
    });
    expect(calls[0]!.headers['idempotency-key']).toBe(`charge-${CHARGE.transactionId}`);
    expect(calls[0]!.body.get('off_session')).toBe('true');
    expect(calls[0]!.body.get('confirm')).toBe('true');
  });

  it('reads a decline as a failed charge with its code, not an outage', async () => {
    const { fetch } = standIn(() => ({
      status: 402,
      body: {
        error: {
          code: 'card_declined',
          decline_code: 'insufficient_funds',
          payment_intent: { id: 'pi_2' },
        },
      },
    }));
    expect(await provider(fetch).chargeInvoice(CHARGE)).toEqual({
      outcome: 'failed',
      providerRef: 'pi_2',
      failureCode: 'insufficient_funds',
    });
  });

  it('reads an authentication the customer must complete as a failure, processing as pending', async () => {
    const action = standIn(() => ({
      status: 200,
      body: { id: 'pi_3', status: 'requires_action' },
    }));
    expect(await provider(action.fetch).chargeInvoice(CHARGE)).toMatchObject({
      outcome: 'failed',
      failureCode: 'authentication_required',
    });
    const processing = standIn(() => ({ status: 200, body: { id: 'pi_4', status: 'processing' } }));
    expect(await provider(processing.fetch).chargeInvoice(CHARGE)).toEqual({
      outcome: 'pending',
      providerRef: 'pi_4',
    });
  });

  it('reports a server error or no answer as the processor being unavailable', async () => {
    const down = standIn(() => ({ status: 500, body: { error: {} } }));
    await expect(provider(down.fetch).chargeInvoice(CHARGE)).rejects.toBeInstanceOf(
      PaymentProviderError,
    );
    const gone = standIn(() => new TypeError('fetch failed'));
    await expect(
      provider(gone.fetch).createCustomer({ licenseId: 1n, name: 'A', email: null }),
    ).rejects.toBeInstanceOf(PaymentProviderError);
  });

  it('makes one customer per workspace, and refunds a payment intent', async () => {
    const { fetch, calls } = standIn((url) =>
      url.endsWith('/v1/customers')
        ? { status: 200, body: { id: 'cus_7' } }
        : { status: 200, body: { id: 're_1' } },
    );
    const stripe = provider(fetch);
    expect(await stripe.createCustomer({ licenseId: 7n, name: 'Org', email: 'o@x.test' })).toEqual({
      customerId: 'cus_7',
    });
    expect(calls[0]!.headers['idempotency-key']).toBe('customer-7');
    expect(calls[0]!.body.get('metadata[license_id]')).toBe('7');
    expect(await stripe.refund({ providerRef: 'pi_1', idempotencyKey: 'refund-1' })).toEqual({
      refundId: 're_1',
    });
    expect(calls[1]!.body.get('payment_intent')).toBe('pi_1');
  });

  it('refuses the masked card form — cards go on the hosted page only', async () => {
    const stripe = provider(standIn(() => ({ status: 200, body: {} })).fetch);
    const error = await stripe
      .registerPaymentMethod({
        brand: 'visa',
        last4: '4242',
        expMonth: 1,
        expYear: 2099,
        holderName: 'A',
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).details).toEqual({ reason: 'hosted_checkout_required' });
  });
});
