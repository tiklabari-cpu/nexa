/**
 * The predicate `server.ts` hands Fastify as `trustProxy`. The integration
 * suite (`test/integration/trust-proxy.test.ts`) runs it against a real
 * allow-list. This file pins the address classes, including the IPv6 and
 * IPv4-mapped forms `app.inject` never produces.
 */
import { describe, expect, it } from 'vitest';
import { isInternalPeer, trustProxyFor } from './trust-proxy.js';

describe('isInternalPeer', () => {
  it.each([
    '127.0.0.1',
    '::1',
    '10.42.0.17',
    '172.18.0.5',
    '192.168.1.20',
    '169.254.10.1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:172.17.0.1',
    '::ffff:127.0.0.1',
  ])('counts %s as a peer our own proxy could be', (addr) => {
    expect(isInternalPeer(addr, 0)).toBe(true);
  });

  it.each([
    '203.0.113.9',
    '198.51.100.7',
    '8.8.8.8',
    '172.32.0.1',
    '2001:db8::1',
    '::ffff:8.8.8.8',
  ])('refuses %s, a public address', (addr) => {
    expect(isInternalPeer(addr, 0)).toBe(false);
  });
});

describe('trustProxyFor', () => {
  it('is false at zero, so Fastify reads only the socket', () => {
    expect(trustProxyFor(0)).toBe(false);
  });

  it('trusts an internal first hop and counts the rest, up to the limit', () => {
    const trust = trustProxyFor(2);
    if (!trust) throw new Error('expected a predicate');

    expect(trust('172.18.0.5', 0)).toBe(true);
    // The second hop is the address the first attested: a CDN edge, public by design.
    expect(trust('192.0.2.10', 1)).toBe(true);
    // One past the count is the caller's own entry.
    expect(trust('203.0.113.9', 2)).toBe(false);
  });

  it('refuses a public first hop at every count, which is the advisory', () => {
    for (const hops of [1, 2, 8]) {
      const trust = trustProxyFor(hops);
      if (!trust) throw new Error('expected a predicate');
      expect(trust('198.51.100.7', 0), `hops=${hops}`).toBe(false);
    }
  });
});
