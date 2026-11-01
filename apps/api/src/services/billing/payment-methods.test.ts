/**
 * The processor-independent arithmetic of paying (tm 382 · BL-01): terms,
 * the dunning clock, references, and reading the platform's settings. The
 * database half — settle, fail, the licence moving — is in
 * `test/integration/billing-payments.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { DUNNING_RETRY_DAYS, isValidTxid, isValidWalletAddress } from '@siyahtus/types';
import {
  addTerm,
  DEFAULT_PROVIDER_VISIBILITY,
  LAST_DUNNING_ATTEMPT,
  newPaymentReference,
  nextRetryAt,
  readBankDetails,
  readOnlyAfter,
  readProviderVisibility,
  visibleMethods,
} from './payment-methods.js';

const DAY = 86_400_000;

describe('a term', () => {
  it('is one calendar month, or a year', () => {
    expect(addTerm(new Date('2026-03-15T10:00:00Z'), 'monthly').toISOString()).toBe(
      '2026-04-15T10:00:00.000Z',
    );
    expect(addTerm(new Date('2026-03-15T10:00:00Z'), 'annual').toISOString()).toBe(
      '2027-03-15T10:00:00.000Z',
    );
  });

  it('clamps to the last day of a shorter month and crosses the year', () => {
    expect(addTerm(new Date('2026-01-31T00:00:00Z'), 'monthly').toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addTerm(new Date('2028-01-31T00:00:00Z'), 'monthly').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(addTerm(new Date('2026-12-31T00:00:00Z'), 'monthly').toISOString()).toBe(
      '2027-01-31T00:00:00.000Z',
    );
    expect(addTerm(new Date('2028-02-29T00:00:00Z'), 'annual').toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
  });
});

describe('the dunning plan (FR-MOD-10.2)', () => {
  const since = new Date('2026-11-01T09:00:00Z');

  it('retries on the 1st, 3rd and 7th day after the first failure, then stops', () => {
    expect(DUNNING_RETRY_DAYS).toEqual([1, 3, 7]);
    expect(nextRetryAt(since, 1)?.getTime()).toBe(since.getTime() + DAY);
    expect(nextRetryAt(since, 2)?.getTime()).toBe(since.getTime() + 3 * DAY);
    expect(nextRetryAt(since, 3)?.getTime()).toBe(since.getTime() + 7 * DAY);
    expect(nextRetryAt(since, 4)).toBeNull();
    expect(LAST_DUNNING_ATTEMPT).toBe(4);
  });

  it('turns read-only on the day of the last retry', () => {
    expect(readOnlyAfter(since).getTime()).toBe(since.getTime() + 7 * DAY);
  });
});

describe('payment references', () => {
  it('are ST- and two groups of four unambiguous characters, and differ', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const reference = newPaymentReference();
      expect(reference).toMatch(/^ST-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      seen.add(reference);
    }
    expect(seen.size).toBe(200);
  });
});

describe('the platform settings', () => {
  it('starts with both manual methods on and Stripe off (ADR-13a §1)', () => {
    expect(readProviderVisibility(null)).toEqual({
      swift_manual: true,
      crypto_manual: true,
      stripe: false,
    });
    expect(DEFAULT_PROVIDER_VISIBILITY.stripe).toBe(false);
  });

  it('takes the platform’s booleans and ignores anything else', () => {
    expect(readProviderVisibility({ swift_manual: false, stripe: 'yes', extra: true })).toEqual({
      swift_manual: false,
      crypto_manual: true,
      stripe: false,
    });
  });

  it('offers Stripe only on a processor with a hosted checkout', () => {
    const settings = {
      providers: { swift_manual: true, crypto_manual: false, stripe: true },
      bank: null,
    };
    expect(visibleMethods(settings, { hostedCheckout: false })).toEqual(['swift_manual']);
    expect(visibleMethods(settings, { hostedCheckout: true })).toEqual(['swift_manual', 'stripe']);
  });

  it('shows bank details only when the four a transfer needs are set', () => {
    expect(readBankDetails({ beneficiary: 'SiyahTuş Ltd', bank_name: 'Example Bank' })).toBeNull();
    expect(
      readBankDetails({
        beneficiary: ' SiyahTuş Ltd ',
        bank_name: 'Example Bank',
        iban: 'XX00 TEST 0000 0000',
        swift_bic: 'TESTXX00',
      }),
    ).toEqual({
      beneficiary: 'SiyahTuş Ltd',
      bank_name: 'Example Bank',
      iban: 'XX00 TEST 0000 0000',
      swift_bic: 'TESTXX00',
      bank_address: null,
    });
  });
});

describe('crypto shapes', () => {
  it('knows a TXID per network', () => {
    expect(isValidTxid('usdt_trc20', 'a'.repeat(64))).toBe(true);
    expect(isValidTxid('usdt_trc20', `0x${'a'.repeat(64)}`)).toBe(false);
    expect(isValidTxid('usdt_erc20', `0x${'A'.repeat(64)}`)).toBe(true);
    expect(isValidTxid('usdt_erc20', 'a'.repeat(64))).toBe(false);
    expect(isValidTxid('usdt_trc20', 'g'.repeat(64))).toBe(false);
  });

  it('knows a wallet address per network', () => {
    expect(isValidWalletAddress('usdt_trc20', 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toBe(true);
    expect(isValidWalletAddress('usdt_trc20', '0x52908400098527886E0F7030069857D2E4169EE7')).toBe(
      false,
    );
    expect(isValidWalletAddress('usdt_erc20', '0x52908400098527886E0F7030069857D2E4169EE7')).toBe(
      true,
    );
    expect(isValidWalletAddress('usdt_erc20', 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb')).toBe(false);
  });
});
