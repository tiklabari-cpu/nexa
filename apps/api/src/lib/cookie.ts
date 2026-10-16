/**
 * The cookie operations the API needs, and no more (tm 287.2): reading one
 * cookie out of a request's `Cookie` header, listing the names it carries
 * (tm 287.3, to expire them), and writing one `Set-Cookie`.
 *
 * Only the member token travels in a cookie (`siyahtus_member`, ID-03 · K4) —
 * every other credential is a bearer header — so a cookie plugin with signing,
 * parsing of every cookie into the request and its own option surface would be
 * more machinery than the one call site uses.
 */

/**
 * The value of the first cookie called `name`, or null.
 *
 * RFC 6265 §4.2.1: `name=value` pairs separated by `; `. A value may be wrapped
 * in double quotes, which are not part of it. The first match wins: a browser
 * orders cookies by path length, longest first, so the one this API set for
 * its own narrow path comes before any broader one with the same name.
 */
export function readCookie(header: string | string[] | undefined, name: string): string | null {
  const joined = Array.isArray(header) ? header.join('; ') : header;
  if (!joined) return null;
  for (const pair of joined.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== name) continue;
    let value = pair.slice(separator + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    return value === '' ? null : value;
  }
  return null;
}

/**
 * The names of the cookies a request carries, each once, in header order —
 * values are never read. A pair without `=` is not a cookie and is skipped.
 */
export function cookieNames(header: string | string[] | undefined): string[] {
  const joined = Array.isArray(header) ? header.join('; ') : header;
  if (!joined) return [];
  const names = new Set<string>();
  for (const pair of joined.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    const name = pair.slice(0, separator).trim();
    if (name !== '') names.add(name);
  }
  return [...names];
}

export interface CookieAttributes {
  maxAgeSeconds: number;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  /** CHIPS: kept per top-level site, never sent to another. Needs `Secure`. */
  partitioned?: boolean;
}

/**
 * One `Set-Cookie` header value. The value is written as given, so it must
 * already be a cookie-octet string (RFC 6265 §4.1.1) — a base64url token is.
 */
export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`invalid cookie name: ${name}`);
  if (!/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/.test(value)) {
    throw new Error('cookie value holds a character a cookie cannot carry');
  }
  const parts = [
    `${name}=${value}`,
    `Max-Age=${Math.max(0, Math.floor(attributes.maxAgeSeconds))}`,
    `Path=${attributes.path}`,
  ];
  if (attributes.secure) parts.push('Secure');
  if (attributes.httpOnly) parts.push('HttpOnly');
  if (attributes.sameSite) parts.push(`SameSite=${attributes.sameSite}`);
  if (attributes.partitioned) parts.push('Partitioned');
  return parts.join('; ');
}
