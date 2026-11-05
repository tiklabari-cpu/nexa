/**
 * The key the pre-login cap counts a client against (tm 409).
 *
 *   - what it is: an IPv4 address as itself, an IPv6 address as its /64, a
 *     mapped `::ffff:a.b.c.d` as the IPv4 client it carries — so a subscriber
 *     rotating through the /64 it was handed holds one count, not one per
 *     address;
 *   - that it is the api's key, function for function, text for text
 *     (`clientNetworkKey` in `apps/api/src/lib/ip-allowlist.ts`, `normaliseIp`
 *     in `apps/api/src/lib/banned-ip.ts`). The two apps cannot import each
 *     other's source, and a silent drift would let the gateway count a client
 *     one way and the api another.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clientNetworkKey } from './client-network.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const RTM = readFileSync(resolve(SRC, 'client-network.ts'), 'utf8');
const API = [
  readFileSync(resolve(SRC, '../../api/src/lib/ip-allowlist.ts'), 'utf8'),
  readFileSync(resolve(SRC, '../../api/src/lib/banned-ip.ts'), 'utf8'),
].join('\n');

describe('clientNetworkKey (tm 409)', () => {
  it('keys an IPv4 client by its address — a neighbour in the same /24 is apart', () => {
    expect(clientNetworkKey('203.0.113.7')).toBe('203.0.113.7');
    expect(clientNetworkKey('203.0.113.8')).toBe('203.0.113.8');
    expect(clientNetworkKey(' 203.0.113.7 ')).toBe('203.0.113.7');
  });

  it('keys an IPv4-mapped IPv6 address as the IPv4 client it carries', () => {
    expect(clientNetworkKey('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(clientNetworkKey('::FFFF:203.0.113.7')).toBe('203.0.113.7');
    // What Node reports for an IPv4 peer on a dual-stack socket.
    expect(clientNetworkKey('::ffff:127.0.0.1')).toBe('127.0.0.1');
  });

  it('keys every IPv6 address in one /64 alike, whatever its interface bits or spelling', () => {
    const key = clientNetworkKey('2001:db8:1:2::1');
    expect(key).toBe('2001:db8:1:2::/64');
    for (const ip of [
      '2001:db8:1:2:ffff:ffff:ffff:ffff',
      '2001:DB8:1:2:0:0:0:9',
      '2001:0db8:0001:0002::abcd',
      '2001:db8:1:2:a:b:c:d',
      '2001:db8:1:2::1.2.3.4',
    ]) {
      expect(clientNetworkKey(ip), ip).toBe(key);
    }
  });

  it('keys the next /64 apart, and every /64 of a larger allocation apart', () => {
    expect(clientNetworkKey('2001:db8:1:3::1')).toBe('2001:db8:1:3::/64');
    expect(clientNetworkKey('2001:db8:1:3::1')).not.toBe(clientNetworkKey('2001:db8:1:2::1'));
    expect(clientNetworkKey('2001:db8:1:102::1')).toBe('2001:db8:1:102::/64');
  });

  it('writes one canonical key per /64, zero groups and all', () => {
    expect(clientNetworkKey('2001:db8::5')).toBe('2001:db8::/64');
    expect(clientNetworkKey('2001:0:0:1::5')).toBe('2001:0:0:1::/64');
    expect(clientNetworkKey('::1')).toBe('::/64');
    expect(clientNetworkKey('fd12:3456:789a:1::42')).toBe('fd12:3456:789a:1::/64');
  });

  it('is IPv6 to both processes when a mapped address is written in hex — one /64, never a key per address', () => {
    expect(clientNetworkKey('::ffff:7f00:1')).toBe('::/64');
    expect(clientNetworkKey('::ffff:c633:6401')).toBe('::/64');
  });

  it('returns what it cannot parse as given — still a key', () => {
    expect(clientNetworkKey('not-an-ip')).toBe('not-an-ip');
    expect(clientNetworkKey('')).toBe('');
    expect(clientNetworkKey('fe80::1%eth0')).toBe('fe80::1%eth0');
    expect(clientNetworkKey('203.0.113.256')).toBe('203.0.113.256');
  });
});

/** Whitespace-insensitive, `export` dropped: the code, not its layout. */
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** A top-level function, from its signature to the `}` that closes it at column 0. */
function fn(source: string, name: string): string {
  const match = new RegExp(`^(?:export )?(function ${name}\\([\\s\\S]*?\\n\\})`, 'm').exec(source);
  return match ? squash(match[1]!) : '';
}

/** A top-level constant's declaration. */
function constant(source: string, name: string): string {
  const match = new RegExp(`^const ${name} = [^;]+;`, 'm').exec(source);
  return match ? squash(match[0]) : '';
}

/** An interface's fields, comments dropped. */
function fields(source: string, name: string): string {
  const match = new RegExp(`^(?:export )?interface ${name} \\{([\\s\\S]*?)\\n\\}`, 'm').exec(
    source,
  );
  return match ? squash(match[1]!.replace(/\/\*\*[\s\S]*?\*\//g, '')) : '';
}

const FUNCTIONS = [
  'clientNetworkKey',
  'normaliseIp',
  'formatAllowlistEntry',
  'parseAddress',
  'v4ToBytes',
  'v6ToBytes',
  'parseHextets',
  'formatV4',
  'formatV6',
  'maskToPrefix',
];

describe("client-network.ts is the api's clientNetworkKey, text for text", () => {
  it('copies every function it defines, and only those', () => {
    const defined = [...RTM.matchAll(/^(?:export )?function (\w+)\(/gm)].map((m) => m[1]);
    expect(defined.sort()).toEqual([...FUNCTIONS].sort());
  });

  it.each(FUNCTIONS)('%s is the api function, unchanged', (name) => {
    expect(fn(API, name), `${name} in the api`).not.toBe('');
    expect(fn(RTM, name)).toBe(fn(API, name));
  });

  it.each(['V4_BITS', 'V6_BITS', 'IPV6_CLIENT_PREFIX'])('%s is the api constant', (name) => {
    expect(constant(API, name)).not.toBe('');
    expect(constant(RTM, name)).toBe(constant(API, name));
  });

  it.each(['AllowlistEntry', 'AddressBytes'])('%s has the api fields', (name) => {
    expect(fields(API, name)).not.toBe('');
    expect(fields(RTM, name)).toBe(fields(API, name));
  });

  it('parses with the same library call', () => {
    expect(RTM).toMatch(/^import \{ isIP \} from 'node:net';$/m);
    expect(API).toMatch(/^import \{ isIP \} from 'node:net';$/m);
  });
});
