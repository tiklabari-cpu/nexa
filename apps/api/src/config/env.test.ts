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
