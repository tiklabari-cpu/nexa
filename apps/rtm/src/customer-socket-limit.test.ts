/**
 * The post-login visitor socket caps (tm 427): the counting alone. The gateway
 * around it — who is counted, when, and what a refusal looks like on the wire —
 * is proven against real sockets in `test/integration/customer-socket-limit.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { CustomerSocketLimiter } from './customer-socket-limit.js';

const ALICE = 'org:alice';
const BOB = 'org:bob';
const NET = '198.51.100.1';
const OTHER_NET = '198.51.100.2';

describe('CustomerSocketLimiter (tm 427)', () => {
  it('admits a visitor up to its limit, then names the visitor count as the full one (NFR-S8)', () => {
    const limiter = new CustomerSocketLimiter(2, 50);
    expect(limiter.admit('c1', ALICE, NET)).toBeNull();
    expect(limiter.admit('c2', ALICE, NET)).toBeNull();
    expect(limiter.admit('c3', ALICE, NET)).toBe('customer');

    // Refused means not counted, anywhere.
    expect(limiter.heldByCustomer(ALICE)).toBe(2);
    expect(limiter.heldByNetwork(NET)).toBe(2);
    expect(limiter.size).toBe(2);
    // Another visitor on the same network is not affected.
    expect(limiter.admit('c4', BOB, NET)).toBeNull();
  });

  it('admits a network up to its limit whoever the visitors are — a fresh token per socket does not get past it', () => {
    const limiter = new CustomerSocketLimiter(5, 3);
    for (let i = 0; i < 3; i += 1) expect(limiter.admit(`c${i}`, `org:v${i}`, NET)).toBeNull();
    expect(limiter.admit('c3', 'org:v3', NET)).toBe('network');
    expect(limiter.heldByNetwork(NET)).toBe(3);
    expect(limiter.heldByCustomer('org:v3')).toBe(0);
    // Another network is not affected.
    expect(limiter.admit('c4', 'org:v4', OTHER_NET)).toBeNull();
  });

  it('frees the slot when a socket is released, so the next one gets in', () => {
    const limiter = new CustomerSocketLimiter(1, 50);
    expect(limiter.admit('c1', ALICE, NET)).toBeNull();
    expect(limiter.admit('c2', ALICE, NET)).toBe('customer');
    limiter.release('c1');
    expect(limiter.admit('c2', ALICE, NET)).toBeNull();
  });

  it('releases once — a second release, or one for a socket never admitted, frees nothing', () => {
    const limiter = new CustomerSocketLimiter(2, 50);
    limiter.admit('c1', ALICE, NET);
    limiter.admit('c2', ALICE, NET);
    limiter.release('c1');
    limiter.release('c1');
    limiter.release('never-admitted');
    expect(limiter.heldByCustomer(ALICE)).toBe(1);
    expect(limiter.heldByNetwork(NET)).toBe(1);
  });

  it('admits the same socket once', () => {
    const limiter = new CustomerSocketLimiter(1, 50);
    expect(limiter.admit('c1', ALICE, NET)).toBeNull();
    expect(limiter.admit('c1', ALICE, NET)).toBeNull();
    expect(limiter.heldByCustomer(ALICE)).toBe(1);
  });

  it('drains to nothing — no visitor or network is left behind', () => {
    const limiter = new CustomerSocketLimiter(5, 50);
    limiter.admit('c1', ALICE, NET);
    limiter.admit('c2', BOB, OTHER_NET);
    limiter.admit('c3', BOB, null);
    expect(limiter.keys).toEqual({ customers: 2, networks: 2 });
    for (const id of ['c1', 'c2', 'c3']) limiter.release(id);
    expect(limiter.size).toBe(0);
    expect(limiter.keys).toEqual({ customers: 0, networks: 0 });
  });

  it('counts a socket with no derivable network per visitor only', () => {
    const limiter = new CustomerSocketLimiter(1, 1);
    expect(limiter.admit('c1', ALICE, null)).toBeNull();
    expect(limiter.admit('c2', BOB, null)).toBeNull();
    expect(limiter.admit('c3', ALICE, null)).toBe('customer');
  });

  it('counts only what is on: with the visitor count off, the network still holds', () => {
    const networkOnly = new CustomerSocketLimiter(null, 2);
    expect(networkOnly.admit('c1', ALICE, NET)).toBeNull();
    expect(networkOnly.admit('c2', ALICE, NET)).toBeNull();
    expect(networkOnly.admit('c3', ALICE, NET)).toBe('network');
    expect(networkOnly.keys.customers).toBe(0);

    const customerOnly = new CustomerSocketLimiter(1, null);
    expect(customerOnly.admit('c1', ALICE, NET)).toBeNull();
    expect(customerOnly.admit('c2', BOB, NET)).toBeNull();
    expect(customerOnly.keys.networks).toBe(0);
  });

  it('says to log once per episode — until the key has nothing counted', () => {
    const limiter = new CustomerSocketLimiter(1, 50);
    limiter.admit('c1', ALICE, NET);
    expect(limiter.refuse('customer', ALICE)).toBe(true);
    expect(limiter.refuse('customer', ALICE)).toBe(false);
    limiter.release('c1');
    limiter.admit('c2', ALICE, NET);
    expect(limiter.refuse('customer', ALICE)).toBe(true);
    // A key with nothing counted has no episode to log.
    expect(limiter.refuse('network', OTHER_NET)).toBe(false);
  });

  it('refuses a limit that is not a positive integer, and a limiter with nothing to count', () => {
    expect(() => new CustomerSocketLimiter(0, 50)).toThrow(/positive integers/);
    expect(() => new CustomerSocketLimiter(5, 1.5)).toThrow(/positive integers/);
    expect(() => new CustomerSocketLimiter(null, null)).toThrow(/at least one limit/);
  });
});
