/**
 * Origin and hostname handling, in one place on purpose.
 *
 * Two paths have to agree exactly: the token endpoint reduces an incoming
 * `Origin` to a hostname, and settings stores what an admin typed. If those
 * disagree by so much as a trailing dot or a port, the domain sits in the
 * allowlist looking correct while the widget is refused on the very site it was
 * added for — with nothing in either place to explain why.
 */

/**
 * Hostname of an origin, or null when the origin is unusable.
 *
 * Plaintext http is refused except on loopback. `.localhost` is included
 * because RFC 6761 §6.3 reserves the whole TLD for loopback — a browser can
 * never be pointed at another machine through it — and development seeds give
 * each demo tenant its own `<tenant>.localhost`.
 *
 * `"null"` — what a sandboxed, opaque-origin document sends — parses as a
 * relative URL and is rejected, which is the intent: an origin that identifies
 * nothing cannot be matched against an allowlist.
 */
export function originHost(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    const hostname = canonicalHost(url.hostname);
    if (!hostname) return null;
    if (url.protocol !== 'https:' && !isLoopback(hostname)) return null;
    return hostname;
  } catch {
    return null;
  }
}

/**
 * What an admin typed, reduced to the same shape `originHost` produces.
 *
 * Accepts a bare hostname or a URL to take one from, since people paste both.
 */
export function normaliseTrustedDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // A scheme means it is a URL; otherwise treat it as a bare hostname, using a
  // placeholder scheme so the same parser handles both.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  // A URL with a path or query is fine as input — only the host is stored —
  // but credentials in it are a sign the value was pasted from somewhere it
  // should not have been.
  if (url.username || url.password) return null;

  return canonicalHost(url.hostname);
}

/**
 * Lowercased, with the root-zone trailing dot removed.
 *
 * `example.com.` and `example.com` are the same host to DNS but different
 * strings, and a browser sends whichever the page used — so storing one and
 * comparing against the other silently never matches.
 */
function canonicalHost(hostname: string): string | null {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253) return null;

  // IPv6 arrives bracketed from `URL.hostname`; keep it as-is.
  if (host.startsWith('[')) return host;

  // Reject anything that is not a plausible hostname. Wildcards in particular:
  // `*.example.com` looks like it would work and would instead be stored as a
  // literal that can never match.
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(host)) {
    return null;
  }
  return host;
}

export function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  );
}
