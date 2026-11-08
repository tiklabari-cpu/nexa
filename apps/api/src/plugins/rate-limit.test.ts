/**
 * The keys of the per-address buckets (tm 422 · tm 429): counted per client
 * network — an IPv4 address as itself, an IPv6 address as its /64 — because
 * one IPv6 subscriber holds a whole /64 and a key on the full address gave it
 * a fresh budget per request. The wiring is proven against a real server in
 * `test/integration/login-attempts.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import { anonymousBucket, authFailureBucket, customerTokenBucket } from './rate-limit.js';

const env = {
  RATE_LIMIT_ANON_PER_MIN: 30,
  RATE_LIMIT_AUTH_FAILURES_PER_MIN: 60,
  RATE_LIMIT_CUSTOMER_TOKEN_PER_MIN: 120,
} as Env;

const BUCKETS = [
  ['anonymous', anonymousBucket, 'rl:anon:'],
  ['failed token resolutions', authFailureBucket, 'rl:authfail:'],
  ['widget token mint', customerTokenBucket, 'rl:custtoken:'],
] as const;

describe.each(BUCKETS)('the %s bucket (NFR-S8)', (_name, bucket, prefix) => {
  it('gives two addresses of one IPv6 /64 one key', () => {
    const a = bucket('2001:db8:1:2::a', env);
    const b = bucket('2001:db8:1:2::b', env);
    expect(a.key).toBe(b.key);
    expect(a.key).toBe(`${prefix}2001:db8:1:2::/64`);
    // Spelled out in full, or with the host half random: the same network.
    expect(bucket('2001:0db8:0001:0002:ffff:1234:5678:9abc', env).key).toBe(a.key);
  });

  it('gives the next /64 a key of its own', () => {
    expect(bucket('2001:db8:1:3::a', env).key).not.toBe(bucket('2001:db8:1:2::a', env).key);
  });

  it('keys an IPv4 address by the address itself, mapped or not', () => {
    expect(bucket('203.0.113.7', env).key).toBe(`${prefix}203.0.113.7`);
    expect(bucket('203.0.113.8', env).key).not.toBe(bucket('203.0.113.7', env).key);
    expect(bucket('::ffff:203.0.113.7', env).key).toBe(`${prefix}203.0.113.7`);
  });
});

describe('bucket limits', () => {
  it('reads each ceiling from its own environment key', () => {
    expect(anonymousBucket('203.0.113.7', env).limit).toBe(30);
    expect(authFailureBucket('203.0.113.7', env).limit).toBe(60);
    expect(customerTokenBucket('203.0.113.7', env).limit).toBe(120);
  });
});
