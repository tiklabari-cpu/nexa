import { describe, expect, it } from 'vitest';
import {
  decideIpAccess,
  formatAllowlistEntry,
  ipMatchesEntry,
  parseAllowlistEntry,
  wouldLockOut,
  type AllowlistEntry,
} from './ip-allowlist.js';

/** Parse an entry we assert is valid, so the match tests below can use it. */
function entry(value: string): AllowlistEntry {
  const parsed = parseAllowlistEntry(value);
  if (!parsed) throw new Error(`expected ${value} to parse`);
  return parsed;
}

describe('parseAllowlistEntry', () => {
  // --- Rejections first: fail-closed is the point of the parser. ---

  it('rejects a prefix out of range for the family', () => {
    expect(parseAllowlistEntry('10.0.0.0/33')).toBeNull(); // v4 max is /32
    expect(parseAllowlistEntry('2001:db8::/129')).toBeNull(); // v6 max is /128
  });

  it('rejects a malformed address', () => {
    expect(parseAllowlistEntry('999.1.1.1')).toBeNull();
    expect(parseAllowlistEntry('10.0.0')).toBeNull();
    expect(parseAllowlistEntry('nonsense')).toBeNull();
  });

  it('rejects a broken prefix', () => {
    expect(parseAllowlistEntry('10.0.0.0/')).toBeNull(); // trailing slash, no number
    expect(parseAllowlistEntry('10.0.0.0/-1')).toBeNull(); // negative
    expect(parseAllowlistEntry('10.0.0.0/ab')).toBeNull(); // not a number
    expect(parseAllowlistEntry('10.0.0.0/24/8')).toBeNull(); // second slash
  });

  it('rejects an empty string', () => {
    expect(parseAllowlistEntry('')).toBeNull();
    expect(parseAllowlistEntry('   ')).toBeNull();
  });

  // --- Then the positives: what a valid entry canonicalises to. ---

  it('parses a v4 CIDR and zeroes host bits into the network address', () => {
    const parsed = entry('10.0.0.5/24');
    expect(parsed.version).toBe(4);
    expect(parsed.prefixLength).toBe(24);
    expect([...parsed.bytes]).toEqual([10, 0, 0, 0]); // .5 masked away
  });

  it('treats a bare address as a single host', () => {
    const parsed = entry('203.0.113.5');
    expect(parsed.version).toBe(4);
    expect(parsed.prefixLength).toBe(32);
    expect([...parsed.bytes]).toEqual([203, 0, 113, 5]);
  });

  it('parses a v6 CIDR', () => {
    const parsed = entry('2001:db8::/32');
    expect(parsed.version).toBe(6);
    expect(parsed.prefixLength).toBe(32);
  });
});

describe('formatAllowlistEntry', () => {
  // The invariant the store relies on: whatever an admin typed, its canonical
  // form is what lands, so two spellings of one range cannot both be saved.

  it('renders a v4 CIDR as its masked network, dropping the host bits', () => {
    expect(formatAllowlistEntry(entry('10.0.0.55/24'))).toBe('10.0.0.0/24');
  });

  it('drops a full-length prefix so a bare host round-trips as itself', () => {
    expect(formatAllowlistEntry(entry('203.0.113.5'))).toBe('203.0.113.5');
    expect(formatAllowlistEntry(entry('203.0.113.5/32'))).toBe('203.0.113.5');
  });

  it('compresses a v6 address per RFC 5952 (lowercase, longest zero-run → ::)', () => {
    expect(formatAllowlistEntry(entry('2001:0DB8:0000:0000:0000:0000:0000:0001'))).toBe(
      '2001:db8::1',
    );
    expect(formatAllowlistEntry(entry('2001:db8:0:0:0:0:0:0/32'))).toBe('2001:db8::/32');
  });

  it('collapses an all-zero v6 address to ::', () => {
    expect(formatAllowlistEntry(entry('0:0:0:0:0:0:0:0'))).toBe('::');
    expect(formatAllowlistEntry(entry('::/0'))).toBe('::/0');
  });

  it('folds an IPv4-mapped v6 entry back to its v4 form', () => {
    expect(formatAllowlistEntry(entry('::ffff:203.0.113.5'))).toBe('203.0.113.5');
  });

  it('round-trips: parsing the canonical form yields the same range', () => {
    for (const raw of ['10.0.0.55/24', '203.0.113.5', '2001:db8::1', '2001:db8:abcd::/48', '::/0']) {
      const once = entry(raw);
      const twice = entry(formatAllowlistEntry(once));
      expect(twice).toEqual(once);
      // Idempotent: formatting the canonical form again changes nothing.
      expect(formatAllowlistEntry(twice)).toBe(formatAllowlistEntry(once));
    }
  });
});

describe('ipMatchesEntry', () => {
  // --- Negative first. ---

  it('denies an address outside the range', () => {
    expect(ipMatchesEntry('10.0.1.5', entry('10.0.0.0/24'))).toBe(false);
  });

  it('never matches a v4 address against a v6 entry, or the reverse', () => {
    expect(ipMatchesEntry('2001:db8::1', entry('10.0.0.0/24'))).toBe(false);
    expect(ipMatchesEntry('10.0.0.5', entry('2001:db8::/32'))).toBe(false);
  });

  it('matches nothing when the address will not parse', () => {
    expect(ipMatchesEntry('not-an-ip', entry('10.0.0.0/24'))).toBe(false);
    expect(ipMatchesEntry('', entry('10.0.0.0/24'))).toBe(false);
  });

  // --- Positive membership. ---

  it('matches an address inside a v4 CIDR', () => {
    expect(ipMatchesEntry('10.0.0.5', entry('10.0.0.0/24'))).toBe(true);
    expect(ipMatchesEntry('10.0.0.255', entry('10.0.0.0/24'))).toBe(true);
  });

  it('treats a single-IP entry as an exact /32 match', () => {
    expect(ipMatchesEntry('10.0.0.5', entry('10.0.0.5'))).toBe(true);
    expect(ipMatchesEntry('10.0.0.6', entry('10.0.0.5'))).toBe(false);
  });

  it('flattens IPv4-mapped IPv6 so the mapped and dotted forms are one address', () => {
    // Admin typed the dotted form; a proxy reports the mapped form (and reverse).
    expect(ipMatchesEntry('::ffff:203.0.113.5', entry('203.0.113.5'))).toBe(true);
    expect(ipMatchesEntry('203.0.113.5', entry('::ffff:203.0.113.5'))).toBe(true);
  });

  it('matches inside a v6 CIDR and denies outside it', () => {
    expect(ipMatchesEntry('2001:db8::1', entry('2001:db8::/32'))).toBe(true);
    expect(ipMatchesEntry('2001:db9::1', entry('2001:db8::/32'))).toBe(false);
  });

  // --- Boundary: /0 is deliberately fixed to match the whole family. ---

  it('treats /0 as "the entire family" — matches any same-family address, never the other', () => {
    expect(ipMatchesEntry('8.8.8.8', entry('0.0.0.0/0'))).toBe(true);
    expect(ipMatchesEntry('198.51.100.23', entry('0.0.0.0/0'))).toBe(true);
    expect(ipMatchesEntry('2001:db8::1', entry('0.0.0.0/0'))).toBe(false); // v6 vs v4 /0
    expect(ipMatchesEntry('2001:db8::1', entry('::/0'))).toBe(true);
  });
});

describe('decideIpAccess', () => {
  // --- Negative first. ---

  it('denies an address that matches no entry in a non-empty list', () => {
    expect(decideIpAccess({ clientIp: '10.0.1.5', entries: ['10.0.0.0/24'] })).toBe('deny');
  });

  it('denies when the client address is absent but the list is non-empty', () => {
    // Absence of an address is not proof of being inside a restriction.
    expect(decideIpAccess({ clientIp: null, entries: ['10.0.0.0/24'] })).toBe('deny');
    expect(decideIpAccess({ clientIp: undefined, entries: ['10.0.0.0/24'] })).toBe('deny');
    expect(decideIpAccess({ clientIp: '', entries: ['10.0.0.0/24'] })).toBe('deny');
    expect(decideIpAccess({ clientIp: '   ', entries: ['10.0.0.0/24'] })).toBe('deny');
  });

  it('denies a configured-but-corrupt list rather than admitting everyone', () => {
    // A non-empty list whose entries are all unparseable must not collapse to open.
    expect(decideIpAccess({ clientIp: '10.0.0.5', entries: ['garbage', '10.0.0.0/99'] })).toBe(
      'deny',
    );
  });

  // --- The regression locks: the two policy decisions that must never drift. ---

  it('allows everything when the list is empty (unconfigured is not deny-all)', () => {
    expect(decideIpAccess({ clientIp: '10.0.0.5', entries: [] })).toBe('allow');
    expect(decideIpAccess({ clientIp: null, entries: [] })).toBe('allow');
  });

  it('allows an address that matches any entry in the list', () => {
    expect(
      decideIpAccess({ clientIp: '10.0.0.5', entries: ['192.168.0.0/16', '10.0.0.0/24'] }),
    ).toBe('allow');
    expect(decideIpAccess({ clientIp: '::ffff:10.0.0.5', entries: ['10.0.0.0/24'] })).toBe('allow');
  });
});

describe('wouldLockOut', () => {
  it('is true when the proposed list excludes the caller', () => {
    expect(wouldLockOut('10.0.9.9', ['10.0.0.0/24'])).toBe(true);
    expect(wouldLockOut(null, ['10.0.0.0/24'])).toBe(true); // caller IP unknown, list restrictive
  });

  it('is false when the caller stays inside the proposed list', () => {
    expect(wouldLockOut('10.0.0.5', ['10.0.0.0/24'])).toBe(false);
  });

  it('is false when the proposed list is empty (clearing the restriction locks no one out)', () => {
    expect(wouldLockOut('10.0.0.5', [])).toBe(false);
    expect(wouldLockOut(null, [])).toBe(false);
  });
});
