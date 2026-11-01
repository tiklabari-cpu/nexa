/**
 * Cleaning a delivery's error text before it is stored or shown (KN-03 · tm 375).
 * Its own module so the dispatcher can use it without importing the log screen's
 * service (which imports the dispatcher).
 */

/** The longest error text the log ever returns. */
export const DELIVERY_ERROR_MAX_LENGTH = 500;

/**
 * An error text safe to show a screen: no signing secret, token, URL or long
 * body, flattened to one line and cut at {@link DELIVERY_ERROR_MAX_LENGTH}.
 *
 * What the sender writes today is already a code (`http_503`, `ECONNREFUSED`),
 * never a message — this is the belt to that brace, because a row can also hold
 * text written by an earlier release, and because the next person to add a
 * detail to a failure should not be able to leak a header through it.
 */
export function sanitizeDeliveryError(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = raw
    // Control characters, incl. newlines and escapes — one printable line.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    // Anything shaped like a URL (a query string can carry a token).
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[url]')
    // A webhook signing secret, and "Bearer …" / "Authorization: …" / "secret=…" pairs.
    .replace(/\bwhsec_[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]')
    .replace(
      /\b(authorization|token|secret|signature|api[_-]?key|password)(\s*[:=]\s*)\S+/gi,
      '$1$2[redacted]',
    )
    // Long opaque runs: hex/base64/JWT-looking tokens.
    .replace(/[A-Za-z0-9_+/=-]{32,}/g, '[redacted]')
    .replace(/\s+/g, ' ')
    .trim();
  if (cleaned === '') return null;
  return cleaned.length > DELIVERY_ERROR_MAX_LENGTH
    ? `${cleaned.slice(0, DELIVERY_ERROR_MAX_LENGTH - 1)}…`
    : cleaned;
}
