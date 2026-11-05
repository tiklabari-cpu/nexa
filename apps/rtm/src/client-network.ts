/**
 * The network a client address is counted against (tm 409): an IPv4 address
 * as itself, an IPv6 address as its /64, an IPv4-mapped IPv6 address as the
 * IPv4 client it carries.
 *
 * The pre-login cap (`prelogin-limit.ts`) bounds what one source can hold, and
 * until tm 409 it keyed that source on the full address. One IPv6 subscriber
 * is routinely handed a whole /64 and can pick a fresh address from it for
 * every socket, so a cap keyed on the full address capped nothing over IPv6.
 * Keyed on the /64, every address the subscriber can choose shares one count.
 *
 * Copied, not imported, from the api, which keys its own per-client limits the
 * same way (`clientNetworkKey`, `apps/api/src/lib/ip-allowlist.ts`, tm 257.14;
 * `normaliseIp` from `apps/api/src/lib/banned-ip.ts`). The reason is the one
 * `client-address.ts` gives: an app cannot import another app's source, and
 * `@siyahtus/types` is bundled into the browser apps, where `node:net` has no
 * place. The names are the api's, so `client-network.test.ts` can hold every
 * function here to its original, text against text, and the two processes key
 * a client the same way.
 *
 * Pure: this file reads no request and no socket. It is handed the string
 * `clientAddress` derived and returns the key; the gateway's one address read
 * stays in `client-address.ts`.
 *
 * Anything that will not parse is returned as given — still a key, and the
 * cap still applies to whoever keeps presenting it. At the hop count a
 * deployment trusts, that string comes from the socket or from a proxy the
 * deployment runs, never from what the caller wrote.
 */
import { isIP } from 'node:net';

const V4_BITS = 32;
const V6_BITS = 128;

/** What one IPv6 subscriber is assigned (RFC 6177's /64 floor). */
const IPV6_CLIENT_PREFIX = 64;

/** A network range in canonical form: host bits past `prefixLength` are zero. */
interface AllowlistEntry {
  version: 4 | 6;
  bytes: Uint8Array;
  prefixLength: number;
}

interface AddressBytes {
  version: 4 | 6;
  bytes: Uint8Array;
}

/**
 * The key the pre-login cap counts `ip` against: an IPv4 address as itself, an
 * IPv6 address as its /64 (`2001:db8:1:2::/64`), a mapped `::ffff:a.b.c.d` as
 * the IPv4 client it carries. An address that will not parse is returned as
 * given. The api's function, unchanged.
 */
export function clientNetworkKey(ip: string): string {
  const address = parseAddress(ip);
  if (!address) return ip;
  if (address.version === 4) return formatV4(address.bytes);
  return formatAllowlistEntry({
    version: 6,
    bytes: maskToPrefix(address.bytes, IPV6_CLIENT_PREFIX),
    prefixLength: IPV6_CLIENT_PREFIX,
  });
}

/**
 * Trimmed, lowercased (IPv6 is case-insensitive) and with the IPv4-mapped
 * prefix stripped, so `::ffff:203.0.113.5` is the `203.0.113.5` it carries.
 */
function normaliseIp(ip: string): string {
  const trimmed = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(trimmed);
  return mapped ? mapped[1]! : trimmed;
}

/** A range back to its canonical text; a full-length prefix is dropped. */
function formatAllowlistEntry(entry: AllowlistEntry): string {
  const maxPrefix = entry.version === 4 ? V4_BITS : V6_BITS;
  const address = entry.version === 4 ? formatV4(entry.bytes) : formatV6(entry.bytes);
  return entry.prefixLength === maxPrefix ? address : `${address}/${entry.prefixLength}`;
}

/** An address (no prefix) as its version and raw bytes, or `null`. */
function parseAddress(value: string): AddressBytes | null {
  const canonical = normaliseIp(value);
  const kind = isIP(canonical);
  if (kind === 4) {
    const bytes = v4ToBytes(canonical);
    return bytes ? { version: 4, bytes } : null;
  }
  if (kind === 6) {
    const bytes = v6ToBytes(canonical);
    return bytes ? { version: 6, bytes } : null;
  }
  return null;
}

/** Dotted-quad → 4 bytes, or `null` if any octet is missing or out of range. */
function v4ToBytes(ip: string): Uint8Array | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const part = parts[i]!;
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    bytes[i] = n;
  }
  return bytes;
}

/**
 * IPv6 text → 16 bytes, or `null` if malformed. Handles `::` compression and a
 * trailing embedded IPv4 (`2001:db8::1.2.3.4`). A shape it cannot expand —
 * a zone id (`fe80::1%eth0`) among them — returns `null`, never a guess.
 */
function v6ToBytes(ip: string): Uint8Array | null {
  let text = ip;

  const dot = text.indexOf('.');
  if (dot !== -1) {
    const lastColon = text.lastIndexOf(':', dot);
    if (lastColon === -1) return null;
    const v4 = v4ToBytes(text.slice(lastColon + 1));
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null; // more than one "::" is illegal

  const head = parseHextets(halves[0]!);
  if (!head) return null;

  let groups: number[];
  if (halves.length === 2) {
    const tail = parseHextets(halves[1]!);
    if (!tail) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null; // "::" must stand for at least one zero group
    groups = [...head, ...new Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    bytes[i * 2] = (groups[i]! >> 8) & 0xff;
    bytes[i * 2 + 1] = groups[i]! & 0xff;
  }
  return bytes;
}

/** Split a colon-separated run of hextets into numbers, or `null` if any is bad. */
function parseHextets(segment: string): number[] | null {
  if (segment === '') return [];
  const groups = segment.split(':');
  const out: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    out.push(parseInt(group, 16));
  }
  return out;
}

/** 4 network bytes → dotted quad. */
function formatV4(bytes: Uint8Array): string {
  return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
}

/**
 * 16 network bytes → canonical IPv6 text (RFC 5952): lowercase hextets with no
 * leading zeros, the longest run of two or more zero groups replaced by `::`
 * (the leftmost on a tie), so one /64 has exactly one key.
 */
function formatV6(bytes: Uint8Array): string {
  const groups: number[] = [];
  for (let i = 0; i < 8; i++) groups.push(((bytes[i * 2]! << 8) | bytes[i * 2 + 1]!) >>> 0);

  // Find the longest run of consecutive zero groups (RFC 5952 only collapses a
  // run of length ≥ 2; a single zero stays "0"). Leftmost wins a tie.
  let bestStart = -1;
  let bestLen = 0;
  let runStart = -1;
  let runLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (runStart === -1) runStart = i;
      runLen++;
      if (runLen > bestLen) {
        bestLen = runLen;
        bestStart = runStart;
      }
    } else {
      runStart = -1;
      runLen = 0;
    }
  }

  const hex = (g: number): string => g.toString(16);
  if (bestLen < 2) return groups.map(hex).join(':');

  const head = groups.slice(0, bestStart).map(hex).join(':');
  const tail = groups
    .slice(bestStart + bestLen)
    .map(hex)
    .join(':');
  return `${head}::${tail}`;
}

/** A copy of `bytes` with every bit past `prefixLength` cleared. */
function maskToPrefix(bytes: Uint8Array, prefixLength: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const bitOffset = i * 8;
    if (prefixLength >= bitOffset + 8) {
      out[i] = bytes[i]!; // byte lies entirely inside the prefix
    } else if (prefixLength <= bitOffset) {
      out[i] = 0; // byte is entirely host bits
    } else {
      const keep = prefixLength - bitOffset; // 1..7 leading bits survive
      out[i] = bytes[i]! & ((0xff << (8 - keep)) & 0xff);
    }
  }
  return out;
}
