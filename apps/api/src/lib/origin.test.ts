/**
 * The two halves of the trusted-domain check have to reduce a host to the same
 * string. The last test in this file is the one that matters: whatever an admin
 * types in settings must equal what the token endpoint derives from the browser's
 * `Origin`, or the domain sits in the allowlist looking correct while the widget
 * is refused on exactly the site it was added for.
 */
import { describe, expect, it } from 'vitest';
import { isLoopback, normaliseTrustedDomain, originHost } from './origin.js';

describe('originHost', () => {
  it('takes the hostname from an https origin', () => {
    expect(originHost('https://shop.example')).toBe('shop.example');
    expect(originHost('https://shop.example:8443')).toBe('shop.example');
  });

  it('lowercases', () => {
    expect(originHost('https://SHOP.Example')).toBe('shop.example');
  });

  it('refuses plaintext http off loopback', () => {
    // Accepting it would let anyone on the network between the visitor and the
    // site claim to be that site.
    expect(originHost('http://shop.example')).toBeNull();
  });

  it('allows http on loopback, including the reserved .localhost TLD', () => {
    expect(originHost('http://localhost:5174')).toBe('localhost');
    expect(originHost('http://acme-bikes.localhost:5174')).toBe('acme-bikes.localhost');
    expect(originHost('http://127.0.0.1:5174')).toBe('127.0.0.1');
  });

  it('rejects the opaque origin a sandboxed frame sends', () => {
    // "null" identifies nothing, so it cannot be matched against an allowlist.
    expect(originHost('null')).toBeNull();
  });

  it('rejects missing and malformed values', () => {
    expect(originHost(undefined)).toBeNull();
    expect(originHost('')).toBeNull();
    expect(originHost('not an origin')).toBeNull();
  });
});

describe('normaliseTrustedDomain', () => {
  it('accepts a bare hostname', () => {
    expect(normaliseTrustedDomain('shop.example')).toBe('shop.example');
  });

  it('accepts a URL and keeps only the host', () => {
    // People paste whatever is in the address bar.
    expect(normaliseTrustedDomain('https://shop.example/pricing?utm=x')).toBe('shop.example');
    expect(normaliseTrustedDomain('http://shop.example:3000')).toBe('shop.example');
  });

  it('trims, lowercases and drops the root-zone dot', () => {
    // `example.com.` and `example.com` are one host to DNS and two strings to a
    // comparison; a browser sends whichever the page used.
    expect(normaliseTrustedDomain('  SHOP.Example.  ')).toBe('shop.example');
  });

  it('rejects a wildcard rather than storing a literal that can never match', () => {
    // `*.example.com` looks like it would work. Subdomain matching is the
    // `include_subdomains` flag, not a character in the domain.
    expect(normaliseTrustedDomain('*.example.com')).toBeNull();
  });

  it('rejects a value carrying credentials', () => {
    expect(normaliseTrustedDomain('https://user:pass@shop.example')).toBeNull();
  });

  it.each(['', '   ', 'shop..example', '-shop.example', 'shop.example-', 'sh op.example'])(
    'rejects %j',
    (input) => {
      expect(normaliseTrustedDomain(input)).toBeNull();
    },
  );

  it('rejects a hostname longer than DNS allows', () => {
    expect(normaliseTrustedDomain(`${'a'.repeat(254)}.example`)).toBeNull();
  });
});

describe('the two sides agree', () => {
  it.each([
    ['shop.example', 'https://shop.example'],
    ['SHOP.Example', 'https://shop.example'],
    ['shop.example.', 'https://shop.example'],
    ['https://shop.example/pricing', 'https://shop.example'],
    ['shop.example', 'https://shop.example:8443'],
    ['acme-bikes.localhost', 'http://acme-bikes.localhost:5174'],
  ])('stored %j matches Origin %j', (typed, origin) => {
    const stored = normaliseTrustedDomain(typed);
    expect(stored).not.toBeNull();
    expect(originHost(origin)).toBe(stored);
  });
});

describe('isLoopback', () => {
  it.each(['localhost', 'acme.localhost', '127.0.0.1', '[::1]'])('accepts %s', (host) => {
    expect(isLoopback(host)).toBe(true);
  });

  it('does not treat a lookalike as loopback', () => {
    // `notlocalhost` and `localhost.evil.com` are someone else's machines.
    expect(isLoopback('notlocalhost')).toBe(false);
    expect(isLoopback('localhost.evil.example')).toBe(false);
  });
});
