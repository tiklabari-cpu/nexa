/**
 * Gateway environment parsing — the region half (C4-a).
 *
 * This file is here because the first pass at C4-a listed only the API's env
 * schema. Both processes carried `z.literal('eu')`, so widening one would have
 * produced a US deployment whose API boots and whose realtime gateway does not
 * — a failure that shows up as "chat does not update", not as "wrong region".
 */
import { describe, expect, it } from 'vitest';
import { REGIONS } from '@nexa/types';
import { parseEnv } from './env.js';

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
