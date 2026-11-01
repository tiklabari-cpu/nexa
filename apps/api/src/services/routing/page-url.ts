/**
 * The form a page address is compared in by a routing rule's "URL is exactly"
 * condition (AU-02 · tm 373).
 *
 * The widget reports the page as the browser has it — with campaign parameters
 * (`?utm_source=…`), a fragment, a capitalised host, sometimes a trailing slash —
 * while an owner types the page they mean. Raw string equality made the rule
 * miss the same page for any of those reasons. Both sides are therefore reduced
 * to: lowercase scheme and host, no credentials, no default port, no query, no
 * fragment, no trailing slash. The path keeps its case (paths are case-sensitive).
 *
 * Applied when a rule is stored *and* when it is matched, so a rule saved before
 * this existed (stored raw) still matches without a migration.
 */
export function normalisePageUrl(raw: string): string {
  const value = raw.trim();
  try {
    const url = new URL(value);
    // `host` already drops a default port and lowercases (WHATWG URL).
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    // Not an absolute address (no scheme): strip what is plainly not the page
    // and keep the rest as typed, so a malformed value still compares equal
    // to itself rather than to everything.
    return value.replace(/[?#].*$/s, '').replace(/\/+$/, '');
  }
}

/** Normalised, de-duplicated, blanks dropped — the stored shape of `url_equals`. */
export function normalisePageUrls(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    const normalised = normalisePageUrl(value);
    if (normalised) out.add(normalised);
  }
  return [...out];
}
