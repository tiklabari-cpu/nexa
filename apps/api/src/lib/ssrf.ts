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
 * The boundary this does NOT cross alone: a public hostname that *resolves* to a
 * private address (DNS rebinding) passes the literal check. A production fetcher
 * must additionally resolve the host and re-check the resolved IP, and pin it for
 * the connection. That belongs in the fetcher; this function guards the URL.
 */
import { isIP } from 'node:net';
import { ApiError } from './api-error.js';

/**
 * Validate and return a URL safe for the server to fetch, or throw a validation
 * error naming why. Returns the parsed `URL` so the caller does not re-parse.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw ApiError.validation('Enter a valid URL, like https://example.com/help.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw ApiError.validation('Only http and https URLs can be fetched.');
  }

  // Credentials in the URL would be replayed by the server against an internal
  // service that trusts them — refuse rather than strip, so nothing silently
  // authenticates as someone else.
  if (url.username || url.password) {
    throw ApiError.validation('Remove the username and password from the URL.');
  }

  const host = normaliseHost(url.hostname);
  if (!host) throw ApiError.validation('Enter a valid URL, like https://example.com/help.');

  if (isBlockedHost(host)) {
    throw ApiError.validation('That address points at a private or internal host and cannot be fetched.');
  }

  return url;
}

/** Strip the brackets URL keeps around an IPv6 literal, and lowercase the host. */
function normaliseHost(hostname: string): string {
  return hostname.replace(/^\[/, '').replace(/\]$/, '').toLowerCase();
}

/** True when a host names this machine or a private/reserved network. */
export function isBlockedHost(host: string): boolean {
  // `localhost` and the RFC 6761 `.localhost` TLD always mean loopback.
  if (host === 'localhost' || host.endsWith('.localhost')) return true;

  const kind = isIP(host);
  if (kind === 4) return isPrivateV4(host);
  if (kind === 6) return isPrivateV6(host);

  // A public hostname passes the literal check (see the DNS-rebinding note above).
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

function isPrivateV6(ip: string): boolean {
  const host = ip.toLowerCase();

  // Anything in `::/xx` — the unspecified address, loopback `::1`, and both the
  // IPv4-mapped (`::ffff:a.b.c.d`, which WHATWG URL rewrites to `::ffff:7f00:1`)
  // and IPv4-compatible forms. None are globally routable, and blocking the
  // whole prefix is what stops the mapped-address bypass regardless of how the
  // URL parser compressed it.
  if (host.startsWith('::')) return true;

  const head = host.split(':')[0] ?? '';
  if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) {
    return true; // fe80::/10 link-local
  }
  if (head.startsWith('fc') || head.startsWith('fd')) return true; // fc00::/7 unique-local
  if (head.startsWith('fec')) return true; // fec0::/10 deprecated site-local
  return false;
}
