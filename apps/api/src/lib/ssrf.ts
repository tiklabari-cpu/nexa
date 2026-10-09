/**
 * SSRF guard for any URL the server is asked to fetch on a caller's behalf
 * (NFR-S7). Knowledge-base website crawling is the first caller; webhook
 * delivery (08.8.4) is the second — one guard so both refuse the same targets.
 *
 * The threat: a tenant supplies a URL and the *server* makes the request, from
 * inside the network, carrying whatever the network trusts. `http://169.254.169.254`
 * reads cloud instance credentials; `http://127.0.0.1:6379` talks to Redis;
 * `file:///etc/passwd` reads the disk. So this refuses every scheme but http/s,
 * refuses embedded credentials, and refuses hosts that name the machine or a
 * private network — by literal IP (v4 and v6, including IPv4-mapped) and by the
 * `localhost` name.
 *
 * ## A name is not an address
 *
 * `assertPublicHttpUrl` guards the URL, and that is enough for a caller that
 * only stores or parses one (registration, the mocked crawler). A caller that
 * opens a connection needs the other half: `hooks.evil.example` passes the
 * literal check because it is a name, and resolves to `169.254.169.254`.
 *
 * Resolving and checking is still not enough on its own (tm 256.9). Until then
 * the webhook sender checked the answer and then gave `fetch` the *name*, and
 * `fetch` resolved it again for itself. A zero-TTL record answers the check
 * with a public address and the connection, a moment later, with `127.0.0.1`
 * (DNS rebinding — a time-of-check/time-of-use gap). So the two go together:
 *
 *   - `resolvePublicHttpTarget` resolves the name once and checks *every*
 *     address, refusing the target if any one of them is internal;
 *   - `pinnedConnection` is how a request is made to that target: its `lookup`
 *     answers with exactly those addresses and never asks DNS, while the URL
 *     keeps its name — so `Host` and TLS SNI still carry it and the
 *     certificate is still checked against it.
 */
import type { LookupAddress, LookupOptions } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP, type LookupFunction } from 'node:net';
import { ApiError } from './api-error.js';

/**
 * Validate and return a URL safe for the server to fetch, or throw a validation
 * error naming why. Returns the parsed `URL` so the caller does not re-parse.
 *
 * The sentence is English for API callers; `details.reason` (`url_invalid`,
 * `url_scheme`, `url_credentials`, `url_private_host`) is what the console words
 * in its own language (tm 261).
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw ApiError.validation('Enter a valid URL, like https://example.com/help.', {
      reason: 'url_invalid',
    });
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw ApiError.validation('Only http and https URLs can be fetched.', {
      reason: 'url_scheme',
    });
  }

  // Credentials in the URL would be replayed by the server against an internal
  // service that trusts them — refuse rather than strip, so nothing silently
  // authenticates as someone else.
  if (url.username || url.password) {
    throw ApiError.validation('Remove the username and password from the URL.', {
      reason: 'url_credentials',
    });
  }

  const host = normaliseHost(url.hostname);
  if (!host) {
    throw ApiError.validation('Enter a valid URL, like https://example.com/help.', {
      reason: 'url_invalid',
    });
  }

  if (isBlockedHost(host)) {
    throw ApiError.validation(
      'That address points at a private or internal host and cannot be fetched.',
      { reason: 'url_private_host' },
    );
  }

  return url;
}

/** Strip the brackets URL keeps around an IPv6 literal, and lowercase the host. */
function normaliseHost(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

/**
 * Resolve a hostname to its addresses. Injectable so a test needs no real DNS.
 * Whatever it answers is what the connection is pinned to, so it is asked once
 * per attempt and never again for that attempt.
 */
export type HostResolver = (hostname: string) => Promise<string[]>;

const defaultResolver: HostResolver = async (hostname) => {
  const results = await lookup(hostname, { all: true });
  return results.map((record) => record.address);
};

/** One address a connection may use — resolved, checked, never re-resolved. */
export interface PinnedAddress {
  address: string;
  family: 4 | 6;
}

/**
 * Where a request may go: the URL it was asked for, whose hostname `Host` and
 * TLS SNI keep carrying, and every address that name resolved to, each one
 * checked. A literal IP is its own single address.
 */
export interface PublicHttpTarget {
  url: URL;
  addresses: readonly PinnedAddress[];
}

/**
 * The literal guard (`assertPublicHttpUrl`) plus the DNS check it deliberately
 * leaves to its caller: resolve the host and refuse if *any* resolved address
 * is private, loopback or link-local — then hand back the addresses, so the
 * connection is made to what was checked and not to a fresh answer.
 *
 * Because DNS can change between registration and delivery, the webhook path
 * runs this immediately before every send, not only when the URL is stored;
 * because it can also change between this check and the connection, the
 * connection uses this function's answer (`pinnedConnection`).
 */
export async function resolvePublicHttpTarget(
  raw: string,
  resolver: HostResolver = defaultResolver,
): Promise<PublicHttpTarget> {
  const url = assertPublicHttpUrl(raw);

  const host = normaliseHost(url.hostname);
  // A literal IP was already range-checked by assertPublicHttpUrl; there is
  // nothing to resolve, and calling DNS on an IP would be pointless.
  const literal = isIP(host);
  if (literal === 4 || literal === 6)
    return { url, addresses: [{ address: host, family: literal }] };

  let answers: string[];
  try {
    answers = await resolver(host);
  } catch {
    throw ApiError.validation('That host could not be resolved.');
  }
  if (answers.length === 0) {
    throw ApiError.validation('That host could not be resolved.');
  }

  const addresses: PinnedAddress[] = [];
  for (const answer of answers) {
    const family = isIP(answer);
    // An answer that is not an address cannot be range-checked, so it cannot
    // be connected to either.
    if (family !== 4 && family !== 6) {
      throw ApiError.validation('That host could not be resolved.');
    }
    if (isBlockedHost(answer)) {
      throw ApiError.validation(
        'That address resolves to a private or internal host and cannot be fetched.',
      );
    }
    addresses.push({ address: answer, family });
  }
  return { url, addresses };
}

/** The `code` a connection carries when it is asked to go somewhere it was not pinned. */
export const UNPINNED_CODE = 'ERR_SSRF_UNPINNED';

function unpinned(message: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(message);
  error.code = UNPINNED_CODE;
  return error;
}

/**
 * How a request is made to a checked target without asking DNS again.
 *
 * `lookup` goes to `http.request` / `https.request` (and through them to
 * `net.connect`) in place of the system resolver. It answers only for the
 * target's own hostname and only with the pinned addresses — all of them when
 * the socket asks for all (Node's happy-eyeballs connect does), so a receiver
 * with an IPv6 and an IPv4 address still falls back from one to the other, but
 * never to an address the check did not see. `servername` is the registered
 * name for TLS SNI (RFC 6066: never an address); the certificate is verified
 * against the same name.
 *
 * A literal-IP URL is connected to without any lookup at all, so it is only
 * accepted when that very address is the pin — otherwise the pin would be
 * decoration. Throws `ERR_SSRF_UNPINNED` for that and for a target that pins
 * nothing.
 */
export function pinnedConnection(target: PublicHttpTarget): {
  lookup: LookupFunction;
  servername: string | undefined;
} {
  const hostname = normaliseHost(target.url.hostname);
  const pinned = target.addresses;
  if (pinned.length === 0) throw unpinned('The target pins no address to connect to.');
  if (isIP(hostname) !== 0 && !pinned.some((entry) => entry.address === hostname)) {
    throw unpinned('The target URL names an address it does not pin.');
  }

  const pinnedLookup: LookupFunction = (requested, options: LookupOptions, callback) => {
    const family = requestedFamily(options.family);
    const eligible = family === 0 ? pinned : pinned.filter((entry) => entry.family === family);
    process.nextTick(() => {
      // Only ever asked for the target's own name; anything else is not this
      // lookup's to answer, and answering it would connect somewhere unchecked.
      if (normaliseHost(requested) !== hostname) {
        callback(unpinned('The connection asked for a host the target does not pin.'), '');
        return;
      }
      const first = eligible[0];
      if (!first) {
        callback(unpinned('The target pins no address of the requested family.'), '');
        return;
      }
      if (options.all) {
        callback(
          null,
          eligible.map((entry): LookupAddress => ({
            address: entry.address,
            family: entry.family,
          })),
        );
      } else {
        callback(null, first.address, first.family);
      }
    });
  };

  return { lookup: pinnedLookup, servername: isIP(hostname) === 0 ? hostname : undefined };
}

function requestedFamily(family: LookupOptions['family']): 0 | 4 | 6 {
  if (family === 4 || family === 'IPv4') return 4;
  if (family === 6 || family === 'IPv6') return 6;
  return 0;
}

/** True when a host names this machine or a private/reserved network. */
export function isBlockedHost(host: string): boolean {
  // `localhost` and the RFC 6761 `.localhost` TLD always mean loopback.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const kind = isIP(host);
  if (kind === 4) return isPrivateV4(host);
  if (kind === 6) return isPrivateV6(host);

  // A public hostname passes the literal check (see "A name is not an address").
  return false;
}

function isPrivateV4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Malformed despite isIP saying v4 — treat as unsafe rather than guess.
    return true;
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24 (IETF/doc)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
  if (a >= 224) return true; // multicast 224/4 + reserved 240/4 + 255.255.255.255
  return false;
}

/**
 * Judged on the address's eight 16-bit words, not on how it happens to be
 * spelled: since tm 256.9 a resolver's AAAA answer goes straight to the socket,
 * so `0:0:0:0:0:ffff:7f00:1`, `::FFFF:127.0.0.1` and `::ffff:7f00:1` must all
 * read as the loopback address they are.
 */
function isPrivateV6(ip: string): boolean {
  const words = ipv6Words(ip);
  // An address this cannot read is an address it cannot vouch for.
  if (!words) return true;
  const [w0, w1, w2, w3, w4, w5, w6, w7] = words as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];

  // NAT64 (RFC 6052): the well-known prefix carries an IPv4 address in its
  // last 32 bits, and a translator on the path delivers the packet to *that*
  // address — so it is judged as the IPv4 address it stands for.
  if (w0 === 0x64 && w1 === 0xff9b && w2 === 0 && w3 === 0 && w4 === 0 && w5 === 0) {
    return isPrivateV4(wordsToV4(w6, w7));
  }
  // Local-use NAT64 (RFC 8215, 64:ff9b:1::/48): translates into the operator's
  // own network by definition.
  if (w0 === 0x64 && w1 === 0xff9b && w2 === 1) return true;
  // The rest of ::/8 — the unspecified address, loopback `::1`, IPv4-mapped
  // (`::ffff:a.b.c.d`) and IPv4-compatible forms. None are globally routable,
  // and blocking the whole prefix is what stops the mapped-address bypass
  // regardless of how it was written.
  if (w0 < 0x0100) return true;
  // 6to4 (2002::/16): an IPv4 address in bits 16–47, reached through it.
  if (w0 === 0x2002) return isPrivateV4(wordsToV4(w1, w2));
  if ((w0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((w0 & 0xffc0) === 0xfec0) return true; // fec0::/10 deprecated site-local
  if ((w0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((w0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  return false;
}

/**
 * The eight words of an IPv6 address, or null if it is not one this can read.
 *
 * Parsed from the WHATWG serialisation, which is canonical: lowercase, at most
 * one `::`, and an IPv4 tail rewritten as two hex words. It also refuses a
 * zone id (`fe80::1%eth0`) — an address scoped to one link is never a target.
 */
function ipv6Words(ip: string): number[] | null {
  let canonical: string;
  try {
    canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  } catch {
    return null;
  }
  const [head = '', tail] = canonical.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const gap = 8 - left.length - right.length;
  if (tail === undefined ? gap !== 0 : gap < 1) return null;
  const words = [...left, ...Array<string>(tail === undefined ? 0 : gap).fill('0'), ...right].map(
    (word) => Number.parseInt(word, 16),
  );
  return words.length === 8 && words.every((word) => word >= 0 && word <= 0xffff) ? words : null;
}

function wordsToV4(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}
