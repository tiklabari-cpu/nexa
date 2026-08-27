/**
 * Gateway environment parsing — the region half (C4-a) and the production
 * branch (M-PROD-CFG-a).
 *
 * This file is here because the first pass at C4-a listed only the API's env
 * schema. Both processes carried `z.literal('eu')`, so widening one would have
 * produced a US deployment whose API boots and whose realtime gateway does not
 * — a failure that shows up as "chat does not update", not as "wrong region".
 */
import { describe, expect, it } from 'vitest';
import { REGIONS } from '@nexa/types';
import { SECRET_KEYS, parseEnv } from './env.js';

const BASE: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://nexa:nexa@127.0.0.1:5432/nexa',
  REDIS_URL: 'redis://127.0.0.1:6379',
  JWT_SIGNING_KEY: 'dev-only-jwt-signing-key-at-least-32-chars',
  CUSTOMER_TOKEN_SECRET: 'dev-only-customer-token-secret-32-chars',
};

describe('NEXA_REGION', () => {
  it('accepts every region the shared list declares', () => {
    for (const region of REGIONS) {
      expect(parseEnv({ ...BASE, NEXA_REGION: region }).NEXA_REGION).toBe(region);
    }
    expect(REGIONS).toContain('us');
  });

  it('defaults to eu when unset', () => {
    expect(parseEnv(BASE).NEXA_REGION).toBe('eu');
  });

  it('refuses a region that is not one of them', () => {
    expect(() => parseEnv({ ...BASE, NEXA_REGION: 'apac' })).toThrow(/NEXA_REGION/);
  });
});

/**
 * The connection ceiling (M-LOAD-CAP · §D127).
 *
 * The behaviour worth pinning is not that a number parses — it is the three
 * ways an operator can spell "no ceiling" and the one way they can spell a
 * ceiling of zero, because those four spellings sit next to each other and mean
 * opposite things. Unset has to keep meaning what the gateway did before this
 * key existed; `0` must not quietly become that too.
 */
describe('RTM_MAX_CONNECTIONS', () => {
  it('is unlimited when unset — today’s behaviour, unchanged', () => {
    expect(parseEnv(BASE).maxConnections).toBeNull();
    expect(parseEnv(BASE).RTM_MAX_CONNECTIONS).toBeUndefined();
  });

  it('reads a ceiling when one is set', () => {
    expect(parseEnv({ ...BASE, RTM_MAX_CONNECTIONS: '8000' }).maxConnections).toBe(8_000);
    expect(parseEnv({ ...BASE, RTM_MAX_CONNECTIONS: '1' }).maxConnections).toBe(1);
  });

  it('treats blank as unset, the way a template interpolating an unset variable writes it', () => {
    // `RTM_MAX_CONNECTIONS=${RTM_MAX_CONNECTIONS}` in a compose file or a
    // Helm values block produces exactly this. Coercing it would land on 0,
    // which is the one value in range that accepts nobody.
    expect(parseEnv({ ...BASE, RTM_MAX_CONNECTIONS: '' }).maxConnections).toBeNull();
    expect(parseEnv({ ...BASE, RTM_MAX_CONNECTIONS: '   ' }).maxConnections).toBeNull();
  });

  it('refuses 0 and negatives rather than reading them as "no ceiling"', () => {
    expect(() => parseEnv({ ...BASE, RTM_MAX_CONNECTIONS: '0' })).toThrow(/RTM_MAX_CONNECTIONS/);
    expect(() => parseEnv({ ...BASE, RTM_MAX_CONNECTIONS: '-1' })).toThrow(/RTM_MAX_CONNECTIONS/);
  });

  it('refuses a fractional or non-numeric ceiling', () => {
    expect(() => parseEnv({ ...BASE, RTM_MAX_CONNECTIONS: '1.5' })).toThrow(/RTM_MAX_CONNECTIONS/);
    expect(() => parseEnv({ ...BASE, RTM_MAX_CONNECTIONS: 'lots' })).toThrow(/RTM_MAX_CONNECTIONS/);
  });

  it('is not implied by production — a production gateway is unlimited until told otherwise', () => {
    // Deliberate: unlike `SHUTDOWN_DRAIN_MS`, this one has no
    // environment-following default. A ceiling is a property of the pod's size
    // and of what sits in front of it, and inventing one at boot would cap a
    // deployment at a number this repo measured on a laptop (§D127).
    const env = parseEnv({
      ...BASE,
      NODE_ENV: 'production',
      DATABASE_APP_URL: 'postgresql://nexa_app:app-password@127.0.0.1:5432/nexa',
      JWT_SIGNING_KEY: 'jwt-0123456789abcdef0123456789abcdef',
      CUSTOMER_TOKEN_SECRET: 'customer-0123456789abcdef0123456789abcdef',
    });
    expect(env.maxConnections).toBeNull();
  });
});

/**
 * The production branch (M-PROD-CFG-a).
 *
 * The gateway had none. The API refused an owner connection and a published
 * placeholder in production; this process — which reads the same database
 * through the same `set_config` tenant context, and verifies tokens signed with
 * the same two keys — accepted both. That is the worse half of the pair to get
 * wrong: an operator who sees the API refuse to start reads it as the deployment
 * being stopped, when in fact the socket half of it came up on exactly the
 * values that were rejected.
 *
 * Kept deliberately parallel to `apps/api/src/config/env.test.ts`: the point is
 * that both processes refuse the same environment, so both are asserted the
 * same way.
 */
describe('production configuration', () => {
  const realSecret = (label: string): string => `${label}-0123456789abcdef0123456789abcdef`;

  const PROD_BASE: NodeJS.ProcessEnv = {
    ...BASE,
    NODE_ENV: 'production',
    DATABASE_APP_URL: 'postgresql://nexa_app:app-password@127.0.0.1:5432/nexa',
    JWT_SIGNING_KEY: realSecret('jwt'),
    CUSTOMER_TOKEN_SECRET: realSecret('customer'),
  };

  it('boots on a fully configured production environment', () => {
    const env = parseEnv(PROD_BASE);

    expect(env.isProduction).toBe(true);
    expect(env.isTest).toBe(false);
    expect(env.runtimeDatabaseUrl).toBe(PROD_BASE['DATABASE_APP_URL']);
    expect(env.JWT_SIGNING_KEY_CUSTOMER).toBe(PROD_BASE['CUSTOMER_TOKEN_SECRET']);
  });

  it('resolves the shutdown drain window exactly as the API does (M-OPS-b)', () => {
    // One variable, two processes. A deployment that drains the API for five
    // seconds while the gateway drops its sockets instantly has not drained —
    // so the default and the override have to mean the same thing on both
    // sides (`apps/api/src/config/env.ts`).
    expect(parseEnv(PROD_BASE).shutdownDrainMs).toBe(5_000);
    expect(parseEnv(BASE).shutdownDrainMs).toBe(0);
    expect(parseEnv({ ...BASE, SHUTDOWN_DRAIN_MS: '250' }).shutdownDrainMs).toBe(250);
    expect(parseEnv({ ...PROD_BASE, SHUTDOWN_DRAIN_MS: '0' }).shutdownDrainMs).toBe(0);
    expect(() => parseEnv({ ...BASE, SHUTDOWN_DRAIN_MS: '600000' })).toThrow(/SHUTDOWN_DRAIN_MS/);
  });

  it('refuses to boot without DATABASE_APP_URL, and says why', () => {
    const { DATABASE_APP_URL: _omitted, ...withoutAppUrl } = PROD_BASE;

    // `auth.ts#scoped` sets `app.current_license` on every read and trusts RLS
    // to hold it. As the table owner Postgres exempts the connection from the
    // policy, so the scoping still runs and stops meaning anything.
    expect(() => parseEnv(withoutAppUrl)).toThrow(/DATABASE_APP_URL/);
    expect(() => parseEnv(withoutAppUrl)).toThrow(/row level security/i);
  });

  for (const key of SECRET_KEYS) {
    it(`refuses the published development placeholder for ${key}`, () => {
      const source = { ...PROD_BASE, [key]: `dev-only-${key.toLowerCase()}-0123456789abcdef` };

      expect(() => parseEnv(source)).toThrow(new RegExp(key));
      expect(() => parseEnv(source)).toThrow(/placeholder/i);
    });
  }

  it('reports every problem at once rather than one per deploy', () => {
    const message = (() => {
      try {
        parseEnv({ ...BASE, NODE_ENV: 'production' });
        return '';
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(message).toMatch(/DATABASE_APP_URL/);
    for (const key of SECRET_KEYS) expect(message).toMatch(new RegExp(key));
  });

  it('leaves development and test exactly as they were', () => {
    for (const nodeEnv of ['development', 'test'] as const) {
      const env = parseEnv({ ...BASE, NODE_ENV: nodeEnv });
      expect(env.isProduction).toBe(false);
      expect(env.runtimeDatabaseUrl).toBe(env.DATABASE_URL);
    }
  });
});
