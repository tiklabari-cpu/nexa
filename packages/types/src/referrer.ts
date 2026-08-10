/**
 * The page a visitor arrived from, on its way to `visits.came_from`.
 *
 * Shared because the same rule has to hold in two places that cannot see each
 * other: the loader trims the value on the host page, so the parts we refuse to
 * keep never leave the visitor's browser, and the API trims it again before the
 * write, because a body is client input and a hand-rolled request can carry
 * anything.
 *
 * The rule (NFR-S9): keep origin + path, drop query string and fragment. A
 * referrer is an external URL, and its query string is exactly where password
 * reset tokens, session ids and e-mail addresses live — a support transcript is
 * the last place those should surface. The path is what answers the question an
 * agent actually has ("they came from the pricing page"), which is the same
 * trade-off `hostPageUrl` already makes for the visited-pages list.
 */

/** Matches the `visits.came_from` column and the contract's `maxLength`. */
export const REFERRER_MAX_LENGTH = 2048;

/**
 * Origin + path of a referrer, or `null` when there is nothing worth keeping.
 *
 * A value that does not parse as a URL is kept as-is (truncated): referrers are
 * not always http — `android-app://…` is a real one — and a string with no URL
 * structure has no query string to strip.
 */
export function sanitizeReferrer(value: string | null | undefined): string | null {
  const raw = value?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, REFERRER_MAX_LENGTH);
  } catch {
    return raw.slice(0, REFERRER_MAX_LENGTH);
  }
}
