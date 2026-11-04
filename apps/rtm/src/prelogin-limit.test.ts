/**
 * The per-address pre-login count (tm 405), without a socket: the bookkeeping
 * properties a leak would break. `test/integration/prelogin-limit.test.ts`
 * drives the same class through a real gateway.
 */
import { describe, expect, it } from 'vitest';
import { PreLoginLimiter } from './prelogin-limit.js';

describe('PreLoginLimiter', () => {
  it('admits up to the limit per address, and each address has its own', () => {
    const limiter = new PreLoginLimiter(2);
    expect(limiter.admits('198.51.100.1')).toBe(true);
    limiter.hold('a', '198.51.100.1');
    limiter.hold('b', '198.51.100.1');
    expect(limiter.admits('198.51.100.1')).toBe(false);
    expect(limiter.admits('198.51.100.2')).toBe(true);
    expect(limiter.heldBy('198.51.100.1')).toBe(2);
    expect(limiter.heldBy('198.51.100.2')).toBe(0);
  });

  it('frees a slot on release and forgets an address whose count reaches zero', () => {
    const limiter = new PreLoginLimiter(2);
    limiter.hold('a', '198.51.100.1');
    limiter.hold('b', '198.51.100.1');
    limiter.release('a');
    expect(limiter.admits('198.51.100.1')).toBe(true);
    expect(limiter.heldBy('198.51.100.1')).toBe(1);
    limiter.release('b');
    expect(limiter.size).toBe(0);
    expect(limiter.addresses).toBe(0);
  });

  it('releases a socket once, whether it logs in, closes, or both', () => {
    const limiter = new PreLoginLimiter(3);
    limiter.hold('a', '198.51.100.1');
    limiter.hold('b', '198.51.100.1');
    // Logged in, then closed: two releases, one slot.
    limiter.release('a');
    limiter.release('a');
    expect(limiter.heldBy('198.51.100.1')).toBe(1);
    // An id never held, or already gone, changes nothing.
    limiter.release('never-held');
    expect(limiter.heldBy('198.51.100.1')).toBe(1);
    expect(limiter.size).toBe(1);
  });

  it('counts an id once, however often it is held', () => {
    const limiter = new PreLoginLimiter(3);
    limiter.hold('a', '198.51.100.1');
    limiter.hold('a', '198.51.100.1');
    expect(limiter.heldBy('198.51.100.1')).toBe(1);
    limiter.release('a');
    expect(limiter.addresses).toBe(0);
  });

  it('reports the first refusal of an episode only, and starts a new episode once the address drains', () => {
    const limiter = new PreLoginLimiter(1);
    limiter.hold('a', '198.51.100.1');
    expect(limiter.refuse('198.51.100.1')).toBe(true);
    expect(limiter.refuse('198.51.100.1')).toBe(false);
    // A slot freed and taken again at once is the same episode.
    limiter.release('a');
    limiter.hold('b', '198.51.100.1');
    expect(limiter.refuse('198.51.100.1')).toBe(true);
    expect(limiter.refuse('198.51.100.1')).toBe(false);
    limiter.release('b');
    limiter.hold('c', '198.51.100.1');
    expect(limiter.refuse('198.51.100.1')).toBe(true);
  });

  it('never records a refusal for an address it holds nothing for', () => {
    const limiter = new PreLoginLimiter(1);
    expect(limiter.refuse('198.51.100.9')).toBe(false);
    expect(limiter.addresses).toBe(0);
  });

  it('stays bounded under churn: ten thousand sockets in and out leave nothing behind', () => {
    const limiter = new PreLoginLimiter(5);
    for (let i = 0; i < 10_000; i += 1) {
      const address = `10.0.${(i >> 8) & 255}.${i & 255}`;
      limiter.hold(`c${i}`, address);
      if (i % 2 === 0) limiter.release(`c${i}`);
    }
    for (let i = 1; i < 10_000; i += 2) limiter.release(`c${i}`);
    expect(limiter.size).toBe(0);
    expect(limiter.addresses).toBe(0);
  });

  it('refuses a limit that is not a positive integer — 0 is "off" and never reaches the class', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => new PreLoginLimiter(bad), String(bad)).toThrow(/positive integer/);
    }
  });
});
