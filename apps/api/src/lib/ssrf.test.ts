import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, assertPublicHttpUrlResolved, isBlockedHost } from './ssrf.js';
import { isApiError } from './api-error.js';

/** Asserts the call throws a `validation` ApiError (a 4xx the client can act on). */
function expectRejected(url: string): void {
  try {
    assertPublicHttpUrl(url);
  } catch (error) {
    expect(isApiError(error) && error.type === 'validation').toBe(true);
    return;
  }
  throw new Error(`expected ${url} to be rejected`);
}

describe('assertPublicHttpUrl — SSRF guard', () => {
  // --- Rejections come first: the negative cases are the point of the guard. ---

  it('rejects loopback by IP and by name', () => {
    expectRejected('http://127.0.0.1/');
    expectRejected('http://127.0.0.1:6379/');
    expectRejected('http://localhost/admin');
    expectRejected('http://acme.localhost/');
    expectRejected('http://[::1]/');
  });

  it('rejects the cloud metadata endpoint and link-local range', () => {
    expectRejected('http://169.254.169.254/latest/meta-data/');
    expectRejected('http://169.254.1.1/');
  });

  it('rejects private IPv4 ranges', () => {
    expectRejected('http://10.0.0.5/');
    expectRejected('http://172.16.9.9/');
    expectRejected('http://192.168.1.1/');
    expectRejected('http://100.64.0.1/'); // CGNAT
    expectRejected('http://0.0.0.0/');
  });

  it('rejects private and mapped IPv6', () => {
    expectRejected('http://[fd00::1]/'); // unique-local
    expectRejected('http://[fe80::1]/'); // link-local
    expectRejected('http://[::ffff:127.0.0.1]/'); // IPv4-mapped loopback
  });

  it('rejects non-http(s) schemes', () => {
    expectRejected('file:///etc/passwd');
    expectRejected('gopher://127.0.0.1/');
    expectRejected('ftp://example.com/');
    expectRejected('data:text/html,hi');
  });

  it('rejects embedded credentials and malformed input', () => {
    expectRejected('http://user:pass@example.com/');
    expectRejected('not a url');
    expectRejected('');
  });

  // --- Then the positive: a real public URL is allowed through. ---

  it('allows an ordinary public https URL and returns it parsed', () => {
    const url = assertPublicHttpUrl('https://example.com/help/delivery');
    expect(url.hostname).toBe('example.com');
    expect(url.pathname).toBe('/help/delivery');
  });

  it('allows plain http on a public host', () => {
    expect(assertPublicHttpUrl('http://docs.example.org').hostname).toBe('docs.example.org');
  });

  it('classifies hosts through the exported predicate', () => {
    expect(isBlockedHost('127.0.0.1')).toBe(true);
    expect(isBlockedHost('169.254.169.254')).toBe(true);
    expect(isBlockedHost('localhost')).toBe(true);
    expect(isBlockedHost('example.com')).toBe(false);
  });
});

describe('assertPublicHttpUrlResolved — DNS-rebinding guard', () => {
  const PUBLIC_IP = '93.184.216.34'; // example.com, not in any blocked range
  /** A resolver that fails the test if DNS is consulted at all. */
  const neverResolve = () => {
    throw new Error('resolver should not be called');
  };

  async function expectResolvedRejected(url: string, resolver: (h: string) => Promise<string[]>) {
    try {
      await assertPublicHttpUrlResolved(url, resolver);
    } catch (error) {
      expect(isApiError(error) && error.type === 'validation').toBe(true);
      return;
    }
    throw new Error(`expected ${url} to be rejected`);
  }

  // --- Negative first: a public name resolving inward is the attack. ---

  it('rejects a public host that resolves to a private address (rebinding)', async () => {
    await expectResolvedRejected('https://hooks.evil.example/', async () => ['10.0.0.5']);
    await expectResolvedRejected('https://hooks.evil.example/', async () => ['169.254.169.254']);
    await expectResolvedRejected('https://hooks.evil.example/', async () => ['::1']);
  });

  it('rejects when any one of several resolved addresses is internal', async () => {
    await expectResolvedRejected('https://split.example/', async () => [PUBLIC_IP, '127.0.0.1']);
  });

  it('rejects a host that does not resolve', async () => {
    await expectResolvedRejected('https://nx.example/', async () => []);
    await expectResolvedRejected('https://nx.example/', async () => {
      throw new Error('ENOTFOUND');
    });
  });

  it('still rejects a literal private IP before any lookup', async () => {
    await expectResolvedRejected('http://10.0.0.1/', neverResolve);
    await expectResolvedRejected('http://169.254.169.254/', neverResolve);
  });

  // --- Then the positive: a public name resolving to a public IP passes. ---

  it('allows a public host resolving to a public address', async () => {
    const url = await assertPublicHttpUrlResolved('https://hooks.example.com/webhook', async () => [
      PUBLIC_IP,
    ]);
    expect(url.hostname).toBe('hooks.example.com');
  });

  it('does not resolve a literal public IP', async () => {
    const url = await assertPublicHttpUrlResolved(`http://${PUBLIC_IP}/hook`, neverResolve);
    expect(url.hostname).toBe(PUBLIC_IP);
  });
});
