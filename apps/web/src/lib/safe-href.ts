/**
 * The one way a visitor- or customer-supplied address becomes a link (tm 451).
 *
 * A visitor's widget reports the page it is on, and a hand-rolled request can
 * report `javascript:alert(document.domain)` instead. React 18 renders such an
 * `href` with a console warning and nothing more; the panel's CSP (nginx only)
 * was the single thing between that link and the agent's session. The API now
 * drops non-http(s) page addresses, but rows written before it still hold
 * them, so the panel checks too: an address that is not an absolute http(s)
 * URL is not a link — the caller shows it as text.
 */
export function safeHref(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
}
