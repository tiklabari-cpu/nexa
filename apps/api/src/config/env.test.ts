/**
 * Environment parsing — the region half (C4-a), the provider keys (M-PROV-a)
 * and the production branch (M-PROD-CFG-a).
 *
 * `NEXA_REGION` was `z.literal('eu')`, so a US deployment could not boot: the
 * process died at `parseEnv` before any of the region logic C4-b goes on to
 * build could run. The gateway carries an identical schema
 * (`apps/rtm/src/config/env.ts`), which is tested separately and for the same
 * reason — the two are separate processes, and one of them being widened alone
 * produces a deployment with an API and no realtime.
 */
import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';
import { REGIONS } from '@nexa/types';
import { SIEM_PROVIDERS } from '../services/audit/siem-target.js';
import { PAYMENT_PROVIDERS } from '../services/billing/payment-provider.js';
import { MAIL_PROVIDERS } from '../services/mail/mailer.js';
import { PUSH_PROVIDERS } from '../services/push/push-provider.js';
import { STORAGE_PROVIDERS } from '../services/storage/object-store.js';
import { SECRET_KEYS, envSchema, parseEnv } from './env.js';

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

/**
 * The production branch (M-PROD-CFG-a).
 *
 * This code had never run. `NODE_ENV` is `production` nowhere in this repo —
 * the container stack sets `development` on purpose — so the block that refuses
 * an unsafe deployment was, until now, asserted only by reading it. That is a
 * poor way to hold two failures that are silent by construction: connecting as
 * the table owner disables every RLS policy without raising anything, and
 * booting on the secrets published in `.env.example` produces a process that
 * works perfectly and trusts tokens anyone can mint.
 *
 * Nothing here touches `process.env`. `parseEnv` takes its source as an
 * argument, so a production environment is an ordinary object and the suites
 * that run alongside this one are undisturbed — mutating the real `NODE_ENV`
 * mid-run would change what every other file under test believes it is.
 */
describe('production configuration', () => {
  /** What a real deployment sets: long enough, and not the published placeholder. */
  const realSecret = (label: string): string => `${label}-0123456789abcdef0123456789abcdef`;

  const PROD_BASE: NodeJS.ProcessEnv = {
    ...BASE,
    NODE_ENV: 'production',
    DATABASE_APP_URL: 'postgresql://nexa_app:app-password@127.0.0.1:5432/nexa',
    INBOUND_EMAIL_SECRET: 'an-inbound-webhook-shared-secret',
    JWT_SIGNING_KEY: realSecret('jwt'),
    WEBHOOK_HMAC_SEED: realSecret('webhook'),
    CUSTOMER_TOKEN_SECRET: realSecret('customer'),
    UPLOAD_SIGNING_KEY: realSecret('upload'),
    AUDIT_CHAIN_SECRET: realSecret('audit'),
  };

  it('boots on a fully configured production environment', () => {
    const env = parseEnv(PROD_BASE);

    expect(env.isProduction).toBe(true);
    expect(env.isTest).toBe(false);
    // The whole reason DATABASE_APP_URL is mandatory above: the request path has
    // to reach Postgres as `nexa_app`, never as the owner.
    expect(env.runtimeDatabaseUrl).toBe(PROD_BASE['DATABASE_APP_URL']);
    expect(env.runtimeDatabaseUrl).not.toBe(env.DATABASE_URL);
  });

  it('runs the sweeps and telemetry by default, where test does not', () => {
    // Both follow NODE_ENV unless set explicitly, and the difference matters in
    // opposite directions: a production instance that silently stopped sweeping
    // would never archive an idle chat or mark an SLA breach, and a test that
    // accidentally boots this env gets background writes under its fixtures.
    const env = parseEnv(PROD_BASE);
    expect(env.schedulerEnabled).toBe(true);
    expect(env.otelEnabled).toBe(true);

    expect(
      parseEnv({ ...PROD_BASE, SCHEDULER_ENABLED: 'false', OTEL_ENABLED: 'false' }),
    ).toMatchObject({ schedulerEnabled: false, otelEnabled: false });
  });

  it('refuses to boot without DATABASE_APP_URL, and says why', () => {
    const { DATABASE_APP_URL: _omitted, ...withoutAppUrl } = PROD_BASE;

    // The message has to carry the reason, not just the key: "DATABASE_APP_URL
    // is required" invites someone to point it at the owner connection, which is
    // the exact failure the check exists to prevent.
    expect(() => parseEnv(withoutAppUrl)).toThrow(/DATABASE_APP_URL/);
    expect(() => parseEnv(withoutAppUrl)).toThrow(/row level security/i);
  });

  for (const key of SECRET_KEYS) {
    it(`refuses the published development placeholder for ${key}`, () => {
      // `.env.example` is in the repository, so `dev-only-…` is not a weak
      // secret — it is a public one.
      const source = { ...PROD_BASE, [key]: `dev-only-${key.toLowerCase()}-0123456789abcdef` };

      expect(() => parseEnv(source)).toThrow(new RegExp(key));
      expect(() => parseEnv(source)).toThrow(/placeholder/i);
    });
  }

  it('checks every secret the schema declares, not a list that drifts from it', () => {
    // Derived from the schema by behaviour rather than by reading SECRET_KEYS
    // back: a sixth secret added to `envSchema` and forgotten in the production
    // check would otherwise ship able to boot on its placeholder, and nothing
    // would say so. Matches both the helper's message and zod's default one, so
    // a secret declared without `secret()` is caught too.
    const shape: Record<string, ZodTypeAny> = envSchema.shape;
    const declared = Object.keys(shape).filter((key) => {
      const result = shape[key]!.safeParse('too-short');
      return (
        !result.success && result.error.issues.some((i) => /at least 32 character/.test(i.message))
      );
    });

    expect(declared.sort()).toEqual([...SECRET_KEYS].sort());
    expect(declared).toHaveLength(5);
  });

  it('refuses an inbound mail webhook that authenticates nobody', () => {
    const { INBOUND_EMAIL_SECRET: _omitted, ...withoutSecret } = PROD_BASE;

    // Unset, `routes/channels.ts` skips the check and the endpoint is public:
    // the recipient address is the only routing key, and it is an address the
    // workspace publishes to its own customers.
    expect(() => parseEnv(withoutSecret)).toThrow(/INBOUND_EMAIL_SECRET/);
    // Empty is the same hole spelled differently — `INBOUND_EMAIL_SECRET=` in a
    // unit file parses to '', which the route reads as "no secret configured".
    expect(() => parseEnv({ ...PROD_BASE, INBOUND_EMAIL_SECRET: '' })).toThrow(
      /INBOUND_EMAIL_SECRET/,
    );
  });

  it('reports every problem at once rather than one per deploy', () => {
    // A misconfigured deployment should be one readable failure, not a queue of
    // them: fix, redeploy, wait, discover the next line.
    const message = (() => {
      try {
        parseEnv({ ...BASE, NODE_ENV: 'production' });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(message).toMatch(/DATABASE_APP_URL/);
    expect(message).toMatch(/INBOUND_EMAIL_SECRET/);
    for (const key of SECRET_KEYS) expect(message).toMatch(new RegExp(key));
  });

  it('leaves development and test exactly as they were', () => {
    // None of the above may become a cost paid everywhere: `make dev` and every
    // suite in this repo run on the placeholders and on a single connection
    // string, and must keep doing so.
    for (const nodeEnv of ['development', 'test'] as const) {
      const env = parseEnv({ ...BASE, NODE_ENV: nodeEnv });
      expect(env.isProduction).toBe(false);
      expect(env.runtimeDatabaseUrl).toBe(env.DATABASE_URL);
    }
  });
});
