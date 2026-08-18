/**
 * `STRIPE_PROVIDER` selects a payment processor (M-PROV-a · §D113/K3).
 *
 * The expiry rule moved here from `payment-method-service.ts`, and moving a rule
 * is where behaviour quietly changes, so these cases are written against the
 * boundary the old `assertNotExpired` was written against: month granularity in
 * UTC, a card good through the last day of its expiry month. The API's own
 * assertion — that the request comes back a 400 with that sentence — stays where
 * it was, in the billing integration suite, which is what makes this file a
 * check on the rule rather than a second copy of the endpoint's contract.
 */
import { describe, expect, it } from 'vitest';
import { ApiError } from '../../lib/api-error.js';
import {
  createPaymentProvider,
  MockPaymentProvider,
  PAYMENT_PROVIDERS,
  type PaymentMethodDetails,
} from './payment-provider.js';

const CARD: PaymentMethodDetails = {
  brand: 'visa',
  last4: '4242',
  expMonth: 6,
  expYear: 2030,
  holderName: 'A Person',
};

/** Mid-month, so a same-month expiry is decided by the month and not the day. */
const NOW = new Date('2026-06-15T12:00:00.000Z');

describe('createPaymentProvider', () => {
  it('gives "mock" the processor that charges nothing', () => {
    const provider = createPaymentProvider('mock');
    expect(provider).toBeInstanceOf(MockPaymentProvider);
    expect(provider.name).toBe('mock');
  });

  it('has an implementation for every value the vocabulary allows', () => {
    for (const provider of PAYMENT_PROVIDERS) {
      expect(createPaymentProvider(provider).name).toBe(provider);
    }
    expect(PAYMENT_PROVIDERS).toEqual(['mock']);
  });
});

describe('MockPaymentProvider', () => {
  const provider = new MockPaymentProvider();

  it('hands the masked details straight back', async () => {
    // Verbatim on purpose: a real processor returns its own normalised brand and
    // last four, and `payment-method-service.ts` stores whatever comes back —
    // so the mock returning the input unchanged is what keeps today's stored row
    // identical to the one the pre-seam code wrote.
    await expect(provider.registerPaymentMethod(CARD, { now: NOW })).resolves.toEqual(CARD);
  });

  it('accepts a card expiring this very month', async () => {
    const card = { ...CARD, expMonth: 6, expYear: 2026 };
    await expect(provider.registerPaymentMethod(card, { now: NOW })).resolves.toEqual(card);
  });

  it('refuses last month, and says so as a validation error', async () => {
    // A client's mistake, not an outage — so a 400 with a readable sentence,
    // which is the exact failure the endpoint contract already promises.
    const error = await provider
      .registerPaymentMethod({ ...CARD, expMonth: 5, expYear: 2026 }, { now: NOW })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe('The card expiry date is in the past.');
  });

  it('refuses a past year even when the month is still ahead', async () => {
    // The comparison that a naive month-only check gets wrong: December 2025 is
    // expired in June 2026 despite 12 > 6.
    await expect(
      provider.registerPaymentMethod({ ...CARD, expMonth: 12, expYear: 2025 }, { now: NOW }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('reads the clock when no instant is given', async () => {
    // The default path the route takes. A card two years out must pass without
    // the caller having to inject anything.
    const ahead = new Date();
    await expect(
      provider.registerPaymentMethod({ ...CARD, expYear: ahead.getUTCFullYear() + 2 }),
    ).resolves.toBeDefined();
  });
});
