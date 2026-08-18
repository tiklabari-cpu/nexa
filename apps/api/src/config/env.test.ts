/**
 * Environment parsing — the region half (C4-a).
 *
 * `NEXA_REGION` was `z.literal('eu')`, so a US deployment could not boot: the
 * process died at `parseEnv` before any of the region logic C4-b goes on to
 * build could run. The gateway carries an identical schema
 * (`apps/rtm/src/config/env.ts`), which is tested separately and for the same
 * reason — the two are separate processes, and one of them being widened alone
 * produces a deployment with an API and no realtime.
 */
import { describe, expect, it } from 'vitest';
import { REGIONS } from '@nexa/types';
import { SIEM_PROVIDERS } from '../services/audit/siem-target.js';
import { PAYMENT_PROVIDERS } from '../services/billing/payment-provider.js';
import { MAIL_PROVIDERS } from '../services/mail/mailer.js';
import { PUSH_PROVIDERS } from '../services/push/push-provider.js';
import { STORAGE_PROVIDERS } from '../services/storage/object-store.js';
import { parseEnv } from './env.js';

/** The minimum a boot needs, so a failure below is about the region and nothing else. */
const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://nexa:nexa@127.0.0.1:5432/nexa',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
  WEBHOOK_HMAC_SEED: 'dev-only-webhook-hmac-seed-at-least-32-chars',
  CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
  UPLOAD_SIGNING_KEY: 'dev-only-upload-signing-key-at-least-32-chars',
  AUDIT_CHAIN_SECRET: 'dev-only-audit-chain-secret-at-least-32-chars',
};

describe('NEXA_REGION', () => {
  it('accepts every region the shared list declares', () => {
    // Driven off REGIONS rather than a literal pair: adding a third region to
    // the list without widening this schema is exactly the failure this file
    // exists to catch, and a hard-coded ['eu','us'] here would not catch it.
    for (const region of REGIONS) {
      expect(parseEnv({ ...BASE, NEXA_REGION: region }).NEXA_REGION).toBe(region);
    }
    expect(REGIONS).toContain('us');
  });

  it('defaults to eu when unset', () => {
    expect(parseEnv(BASE).NEXA_REGION).toBe('eu');
  });

  it('refuses a region that is not one of them', () => {
    // Fail at boot, loudly. A process that shrugged at `apac` would serve
    // requests while claiming a residency guarantee nobody implements.
    expect(() => parseEnv({ ...BASE, NEXA_REGION: 'apac' })).toThrow(/NEXA_REGION/);
  });
});

/**
 * The provider keys (M-PROV-a · §D113/K3).
 *
 * §D113/K3 found `MAIL_PROVIDER`, `STORAGE_PROVIDER` and `STRIPE_PROVIDER`
 * "doğrulanıp okunmuyor" — parsed here, and then ignored by a `server.ts` that
 * branched on `NODE_ENV`. The factories are what closed that (each has its own
 * test); what this file owns is the other half of the same promise: the schema's
 * vocabulary is the factories' vocabulary, so a value that parses is a value
 * something can actually build, and a value that does not parse stops the boot
 * instead of silently becoming a default.
 */
describe('provider selection', () => {
  const PROVIDERS = [
    { key: 'MAIL_PROVIDER', vocabulary: MAIL_PROVIDERS, fallback: 'file' },
    { key: 'PUSH_PROVIDER', vocabulary: PUSH_PROVIDERS, fallback: 'file' },
    { key: 'STORAGE_PROVIDER', vocabulary: STORAGE_PROVIDERS, fallback: 'local' },
    { key: 'STRIPE_PROVIDER', vocabulary: PAYMENT_PROVIDERS, fallback: 'mock' },
    { key: 'SIEM_PROVIDER', vocabulary: SIEM_PROVIDERS, fallback: 'file' },
  ] as const;

  for (const { key, vocabulary, fallback } of PROVIDERS) {
    describe(key, () => {
      it('accepts every value its factory implements', () => {
        // Driven off the factory's own list rather than a literal, for the
        // reason NEXA_REGION is: widening one side alone is precisely the drift
        // this pair of readers exists to prevent.
        for (const value of vocabulary) {
          expect(parseEnv({ ...BASE, [key]: value })[key]).toBe(value);
        }
      });

      it('falls back to the mock when unset', () => {
        expect(parseEnv(BASE)[key]).toBe(fallback);
        expect(vocabulary).toContain(fallback);
      });

      it('refuses a value nothing implements, at boot', () => {
        // Loudly, and before the first request. A process that shrugged at
        // `smtp` would keep writing files while an operator believed mail was
        // being sent — the failure mode that is only ever noticed by whoever
        // did not get the e-mail.
        expect(() => parseEnv({ ...BASE, [key]: 'nonesuch' })).toThrow(new RegExp(key));
      });
    });
  }

  it('does not accept the pre-seam spelling of MAIL_PROVIDER', () => {
    // `mock` used to be the only value, and named the environment rather than
    // the implementation — there are two mocks now. A stale `.env` has to fail
    // at boot rather than quietly getting whichever one is the default.
    expect(() => parseEnv({ ...BASE, MAIL_PROVIDER: 'mock' })).toThrow(/MAIL_PROVIDER/);
  });
});
