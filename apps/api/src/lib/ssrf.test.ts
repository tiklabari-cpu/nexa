import dns from 'node:dns';
import type { LookupAddress, LookupOptions } from 'node:dns';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertPublicHttpUrl,
  isBlockedHost,
  pinnedConnection,
  resolvePublicHttpTarget,
  UNPINNED_CODE,
  type PublicHttpTarget,
} from './ssrf.js';
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

  it('rejects IPv6 forms that carry a private IPv4 address, and IPv6 multicast', () => {
    expectRejected('http://[64:ff9b::7f00:1]/'); // NAT64 → 127.0.0.1
    expectRejected('http://[64:ff9b::a9fe:a9fe]/'); // NAT64 → 169.254.169.254
    expectRejected('http://[64:ff9b:1::a00:5]/'); // local-use NAT64
    expectRejected('http://[2002:a00:5::1]/'); // 6to4 → 10.0.0.5
    expectRejected('http://[ff02::1]/'); // multicast
    expectRejected('http://[fed0::1]/'); // site-local, beyond fec0::/12
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

  it('judges an IPv6 address by its value, not by how it is written', () => {
    // Every spelling of IPv4-mapped loopback — a resolver's AAAA answer goes to
    // the socket as-is, so none of them may slip past a prefix match.
    for (const mapped of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::FFFF:7F00:1',
      '0:0:0:0:0:ffff:7f00:1',
      '0000:0000:0000:0000:0000:ffff:a9fe:a9fe',
    ]) {
      expect(isBlockedHost(mapped), mapped).toBe(true);
    }
    // A zone id scopes an address to one link; never a target.
    expect(isBlockedHost('fe80::1%eth0')).toBe(true);
    expect(isBlockedHost('2606:4700::1%1')).toBe(true);
    // The embedded forms are only as private as the IPv4 address they carry.
    expect(isBlockedHost('64:ff9b::5db8:d822')).toBe(false); // NAT64 → 93.184.216.34
    expect(isBlockedHost('2002:5db8:d822::1')).toBe(false); // 6to4 → 93.184.216.34
    expect(isBlockedHost('2606:4700:4700::1111')).toBe(false);
  });
});

const PUBLIC_IP = '93.184.216.34'; // example.com, not in any blocked range
const PUBLIC_V6 = '2606:2800:220:1:248:1893:25c8:1946';

describe('resolvePublicHttpTarget — DNS-rebinding guard', () => {
  /** A resolver that fails the test if DNS is consulted at all. */
  const neverResolve = () => {
    throw new Error('resolver should not be called');
  };

  async function expectResolvedRejected(url: string, resolver: (h: string) => Promise<string[]>) {
    try {
      await resolvePublicHttpTarget(url, resolver);
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
    await expectResolvedRejected('https://split.example/', async () => [PUBLIC_V6, 'fd00::1']);
  });

  it('rejects mapped and embedded IPv6 answers that stand for an internal IPv4 address', async () => {
    for (const answer of [
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '0:0:0:0:0:ffff:a9fe:a9fe',
      '64:ff9b::a9fe:a9fe',
      '2002:c0a8:101::1',
    ]) {
      await expectResolvedRejected('https://hooks.evil.example/', async () => [answer]);
    }
  });

  it('rejects a host that does not resolve, or resolves to something that is not an address', async () => {
    await expectResolvedRejected('https://nx.example/', async () => []);
    await expectResolvedRejected('https://nx.example/', async () => {
      throw new Error('ENOTFOUND');
    });
    // A name cannot be range-checked, so it cannot be connected to either.
    await expectResolvedRejected('https://cname.example/', async () => ['internal.corp']);
  });

  it('still rejects a literal private IP before any lookup', async () => {
    await expectResolvedRejected('http://10.0.0.1/', neverResolve);
    await expectResolvedRejected('http://169.254.169.254/', neverResolve);
    await expectResolvedRejected('http://[64:ff9b::7f00:1]/', neverResolve);
  });

  // --- Then the positive: the checked addresses come back, to be pinned. ---

  it('returns every checked address with its family, in the order DNS gave them', async () => {
    const target = await resolvePublicHttpTarget('https://hooks.example.com/webhook', async () => [
      PUBLIC_V6,
      PUBLIC_IP,
    ]);
    expect(target.url.hostname).toBe('hooks.example.com');
    expect(target.addresses).toEqual([
      { address: PUBLIC_V6, family: 6 },
      { address: PUBLIC_IP, family: 4 },
    ]);
  });

  it('resolves exactly once per call', async () => {
    const resolver = vi.fn(async () => [PUBLIC_IP]);
    await resolvePublicHttpTarget('https://hooks.example.com/webhook', resolver);
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(resolver).toHaveBeenCalledWith('hooks.example.com');
  });

  it('pins a literal public IP, v4 or v6, to itself without resolving', async () => {
    const v4 = await resolvePublicHttpTarget(`http://${PUBLIC_IP}/hook`, neverResolve);
    expect(v4.url.hostname).toBe(PUBLIC_IP);
    expect(v4.addresses).toEqual([{ address: PUBLIC_IP, family: 4 }]);

    const v6 = await resolvePublicHttpTarget('https://[2606:4700:4700::1111]/hook', neverResolve);
    expect(v6.url.hostname).toBe('[2606:4700:4700::1111]');
    expect(v6.addresses).toEqual([{ address: '2606:4700:4700::1111', family: 6 }]);
  });
});

describe('pinnedConnection — the connection answers from the pin, never from DNS', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const target = (url: string, ...addresses: Array<[string, 4 | 6]>): PublicHttpTarget => ({
    url: new URL(url),
    addresses: addresses.map(([address, family]) => ({ address, family })),
  });

  /** Ask a pinned lookup what `net.connect` would ask it, and collect the answer. */
  function ask(
    lookup: ReturnType<typeof pinnedConnection>['lookup'],
    hostname: string,
    options: LookupOptions,
  ): Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family: unknown }> {
    return new Promise((resolve) => {
      lookup(hostname, options, (error, address, family) => resolve({ error, address, family }));
    });
  }

  it('answers with every pinned address when asked for all, the first when asked for one', async () => {
    const { lookup } = pinnedConnection(
      target('https://hooks.example.com/x', [PUBLIC_V6, 6], [PUBLIC_IP, 4]),
    );

    const all = await ask(lookup, 'hooks.example.com', { all: true });
    expect(all.error).toBeNull();
    expect(all.address).toEqual([
      { address: PUBLIC_V6, family: 6 },
      { address: PUBLIC_IP, family: 4 },
    ] satisfies LookupAddress[]);

    const one = await ask(lookup, 'hooks.example.com', {});
    expect(one).toEqual({ error: null, address: PUBLIC_V6, family: 6 });
  });

  it('honours a requested family from within the pin, and refuses when the pin has none', async () => {
    const { lookup } = pinnedConnection(target('https://hooks.example.com/x', [PUBLIC_IP, 4]));

    expect(await ask(lookup, 'hooks.example.com', { family: 4 })).toEqual({
      error: null,
      address: PUBLIC_IP,
      family: 4,
    });
    const v6 = await ask(lookup, 'hooks.example.com', { family: 6, all: true });
    expect(v6.error?.code).toBe(UNPINNED_CODE);
  });

  it('refuses to answer for any other host', async () => {
    const { lookup } = pinnedConnection(target('https://hooks.example.com/x', [PUBLIC_IP, 4]));

    const other = await ask(lookup, 'metadata.google.internal', { all: true });
    expect(other.error?.code).toBe(UNPINNED_CODE);
    expect(other.address).toEqual('');
  });

  it('never consults the system resolver', async () => {
    const system = vi.spyOn(dns, 'lookup');
    const promises = vi.spyOn(dns.promises, 'lookup');
    const { lookup } = pinnedConnection(target('https://hooks.example.com/x', [PUBLIC_IP, 4]));

    await ask(lookup, 'hooks.example.com', { all: true });
    await ask(lookup, 'hooks.example.com', {});

    expect(system).not.toHaveBeenCalled();
    expect(promises).not.toHaveBeenCalled();
  });

  it('carries the registered name as SNI, and no SNI for an address', () => {
    expect(pinnedConnection(target('https://hooks.example.com/x', [PUBLIC_IP, 4])).servername).toBe(
      'hooks.example.com',
    );
    expect(
      pinnedConnection(target(`https://${PUBLIC_IP}/x`, [PUBLIC_IP, 4])).servername,
    ).toBeUndefined();
  });

  it('refuses a target that pins nothing, or a literal URL that is not its own pin', () => {
    const refused = (build: () => unknown): string | undefined => {
      try {
        build();
      } catch (error) {
        return (error as NodeJS.ErrnoException).code;
      }
      return undefined;
    };
    expect(refused(() => pinnedConnection(target('https://hooks.example.com/x')))).toBe(
      UNPINNED_CODE,
    );
    expect(refused(() => pinnedConnection(target('http://10.0.0.5/x', [PUBLIC_IP, 4])))).toBe(
      UNPINNED_CODE,
    );
    expect(
      refused(() =>
        pinnedConnection(target('http://[2606:4700:4700::1111]/x', ['2606:4700:4700::1111', 6])),
      ),
    ).toBeUndefined();
  });
});
