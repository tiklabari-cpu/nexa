/**
 * The gateway reads one client address, in one file, for one kind of decision
 * — how many sockets a source may hold (tm 405 · tm 427 · was tm 257.10's
 * "reads no address at all").
 *
 * Until tm 405 the gateway read no address: it rate limited per socket and
 * authorised by token, and this file guarded that. Then a single source turned
 * out to be able to fill the global connection ceiling with sockets that never
 * log in, and the only key that bounds "a single source" is its address — so
 * the pre-login cap (`prelogin-limit.ts`) reads one, and since tm 427 the
 * post-login visitor cap (`customer-socket-limit.ts`) counts by the same
 * network. What this file guards now is that it stayed one:
 *
 *   - only `client-address.ts` touches anything address-shaped — a header, the
 *     socket peer, a proxy library — so the day something else in the gateway
 *     starts reading an address, for a limit, a ban or a log field, this fails;
 *   - the address is derived exactly as the api derives `request.ip`
 *     (`apps/api/src/lib/trust-proxy.ts`), from the same `TRUST_PROXY_HOPS`.
 *     The copy is held to the original as text, because the two apps cannot
 *     import each other's source and a silent drift would let one process
 *     believe a header the other ignores;
 *   - its behaviour, including what the api's integration suite cannot
 *     produce: a public peer, IPv6, IPv4-mapped peers, a peer already gone.
 */
import type { IncomingMessage } from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clientAddress, isInternalPeer, trustProxyFor } from './client-address.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const API_TRUST_PROXY = resolve(SRC, '../../api/src/lib/trust-proxy.ts');

/** Every production source file under apps/rtm/src — tests excluded. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const FILES = sources(SRC).map((path) => ({
  name: relative(SRC, path).replaceAll('\\', '/'),
  text: readFileSync(path, 'utf8'),
}));
const text = (name: string): string => FILES.find((file) => file.name === name)!.text;

/** What reading a client address looks like, by header, by socket, or by library. */
const ADDRESS_READS = [
  'x-forwarded-for',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'remoteAddress',
  'trustProxy',
  'proxy-addr',
];

describe('the gateway reads one client address, in client-address.ts (tm 405)', () => {
  it('scans the real gateway (guards a vacuous pass)', () => {
    const names = FILES.map((file) => file.name);
    expect(names).toContain('server.ts');
    expect(names).toContain('connection.ts');
    expect(names).toContain('client-address.ts');
    expect(names).toContain('client-network.ts');
    expect(names.some((name) => name.endsWith('.test.ts'))).toBe(false);
    expect(text('server.ts')).toContain("http.on('upgrade'");
  });

  it.each(ADDRESS_READS)('no other source file mentions %s', (needle) => {
    const hits = FILES.filter((file) => file.text.toLowerCase().includes(needle.toLowerCase()));
    expect(hits.map((file) => file.name).filter((name) => name !== 'client-address.ts')).toEqual(
      [],
    );
  });

  // Until tm 454 the one header was `authorization`, for `/health`'s admin
  // detail; that body is the same for every caller now, so none is read.
  it('reads no request header itself — the address is read by the library', () => {
    const read = new Set<string>();
    for (const file of FILES) {
      for (const match of file.text.matchAll(/headers(?:\.([\w-]+)|\[\s*['"]([^'"]+)['"]\s*\])/g)) {
        read.add((match[1] ?? match[2])!.toLowerCase());
      }
    }
    expect([...read]).toEqual([]);
  });

  it('derives it once, on the upgrade path, under TRUST_PROXY_HOPS — for the two caps that count by network only', () => {
    const calls = FILES.flatMap((file) =>
      [...file.text.matchAll(/\bclientAddress\(/g)].map(() => file.name),
    );
    // The definition, and the one call site.
    expect(calls.sort()).toEqual(['client-address.ts', 'server.ts']);
    // Reduced to its network before anything counts it (tm 409): an IPv6
    // subscriber rotating through its /64 is one source, not one per address.
    // Derived only when a cap counts by it — the pre-login cap (tm 405) or the
    // post-login visitor cap (tm 427).
    expect(text('server.ts')).toMatch(
      /const key = countsByNetwork\s*\?\s*clientNetworkKey\(clientAddress\(request, env\.TRUST_PROXY_HOPS\)\)\s*:\s*null;/,
    );
    expect(text('server.ts')).toMatch(
      /const countsByNetwork = preLogin !== null \|\| customerSockets\?\.perNetwork != null;/,
    );
    const keyed = FILES.flatMap((file) =>
      [...file.text.matchAll(/\bclientNetworkKey\(/g)].map(() => file.name),
    );
    expect(keyed.sort()).toEqual(['client-network.ts', 'server.ts']);
    // And what the result is handed to: the two limiters — the pre-login cap
    // here, the visitor cap at login through the connection it is kept on —
    // and nothing that logs in, routes or authorises.
    expect(text('server.ts')).toMatch(/preLogin\.admits\(key\)/);
    expect(text('server.ts')).toMatch(
      /customerSockets\.admit\(connection\.id, customerKey, connection\.clientNetwork\)/,
    );
    const carried = FILES.filter((file) => /\bclientNetwork\b/.test(file.text)).map(
      (file) => file.name,
    );
    expect(carried.sort()).toEqual(['connection.ts', 'server.ts']);
  });
});

describe("client-address.ts is the api's trust-proxy.ts, text for text", () => {
  const api = readFileSync(API_TRUST_PROXY, 'utf8');
  const rtm = text('client-address.ts');

  const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
  const compiled = (source: string): string =>
    squash(/proxyAddr\.compile\(\[([^\]]*)\]\)/.exec(source)?.[1] ?? '');
  const predicate = (source: string): string =>
    squash(/export function trustProxyFor\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1] ?? '');

  it('trusts the same peer ranges', () => {
    expect(compiled(api)).not.toBe('');
    expect(compiled(rtm)).toBe(compiled(api));
  });

  it('counts hops with the same predicate', () => {
    expect(predicate(api)).toContain('isInternalPeer');
    expect(predicate(rtm)).toBe(predicate(api));
  });
});

/** The parts of an upgrade request proxy-addr reads: the peer and one header. */
function request(peer: string | undefined, forwardedFor?: string): IncomingMessage {
  return {
    socket: { remoteAddress: peer },
    headers: forwardedFor === undefined ? {} : { 'x-forwarded-for': forwardedFor },
  } as unknown as IncomingMessage;
}

describe('clientAddress', () => {
  it('reads the socket peer and ignores the header at TRUST_PROXY_HOPS=0', () => {
    expect(clientAddress(request('127.0.0.1', '198.51.100.1'), 0)).toBe('127.0.0.1');
    expect(clientAddress(request('10.0.0.5', '198.51.100.1, 198.51.100.2'), 0)).toBe('10.0.0.5');
  });

  it('believes the entry an internal proxy appended, at one hop', () => {
    expect(clientAddress(request('127.0.0.1', '198.51.100.1'), 1)).toBe('198.51.100.1');
    expect(clientAddress(request('172.18.0.5', '198.51.100.1'), 1)).toBe('198.51.100.1');
    expect(clientAddress(request('::ffff:172.17.0.1', '198.51.100.1'), 1)).toBe('198.51.100.1');
  });

  it('takes only the rightmost entry at one hop — what the caller wrote to its left is not read', () => {
    expect(clientAddress(request('10.0.0.5', '203.0.113.66, 198.51.100.1'), 1)).toBe(
      '198.51.100.1',
    );
  });

  it('ignores a forged header from a public peer, at every hop count', () => {
    for (const hops of [1, 2, 8]) {
      expect(clientAddress(request('203.0.113.9', '198.51.100.1'), hops), `hops=${hops}`).toBe(
        '203.0.113.9',
      );
      expect(clientAddress(request('2001:db8::1', '198.51.100.1'), hops), `hops=${hops}`).toBe(
        '2001:db8::1',
      );
    }
  });

  it('counts further hops from the right, as the api does', () => {
    // CDN edge (public, attested by the internal proxy) → internal proxy → us.
    expect(clientAddress(request('10.0.0.5', '198.51.100.1, 192.0.2.10'), 2)).toBe('198.51.100.1');
    // One hop configured: the edge's address is the client's, collapsed — the
    // "too low" failure README describes, not a bypass.
    expect(clientAddress(request('10.0.0.5', '198.51.100.1, 192.0.2.10'), 1)).toBe('192.0.2.10');
  });

  it('falls back to the peer when nothing was forwarded', () => {
    expect(clientAddress(request('::1'), 1)).toBe('::1');
    expect(clientAddress(request('127.0.0.1', ''), 1)).toBe('127.0.0.1');
  });

  it('answers an empty string for a peer that has already gone', () => {
    expect(clientAddress(request(undefined), 0)).toBe('');
    expect(clientAddress(request(undefined), 1)).toBe('');
  });
});

describe('isInternalPeer / trustProxyFor — the cases the api pins', () => {
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

  it('is false at zero hops', () => {
    expect(trustProxyFor(0)).toBe(false);
  });
});
