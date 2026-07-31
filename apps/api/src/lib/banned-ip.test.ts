import { describe, expect, it } from 'vitest';
import { normaliseIp } from './banned-ip.js';

/**
 * FR-MOD-08.9.2 — the address-comparison primitive behind the IP ban.
 *
 * `isIpBanned` needs a database and is covered by the integration tests; this
 * pins the pure normalisation, which is what makes an address an admin typed
 * match the one a proxy reports even when the two arrive in different shapes.
 */
describe('normaliseIp', () => {
  it('trims surrounding whitespace', () => {
    expect(normaliseIp('  203.0.113.5  ')).toBe('203.0.113.5');
  });

  it('lowercases IPv6 so a case difference is not a different address', () => {
    expect(normaliseIp('2001:DB8::1')).toBe('2001:db8::1');
  });

  it('unwraps an IPv4-mapped IPv6 address to its bare IPv4 form', () => {
    // A proxy may report `::ffff:203.0.113.5` for what the admin typed as
    // `203.0.113.5`; both must reduce to one string.
    expect(normaliseIp('::ffff:203.0.113.5')).toBe('203.0.113.5');
  });

  it('leaves a plain IPv4 address unchanged', () => {
    expect(normaliseIp('10.0.0.1')).toBe('10.0.0.1');
  });

  it('compares equal for the two shapes of one address', () => {
    expect(normaliseIp(' ::FFFF:198.51.100.7 ')).toBe(normaliseIp('198.51.100.7'));
  });
});
