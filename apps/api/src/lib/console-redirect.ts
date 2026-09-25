/**
 * The agent console's OAuth callback, derived from this deployment's
 * `WEB_APP_URL` (tm 255.17).
 *
 * The panel sends `${window.location.origin}/auth/callback` as its
 * `redirect_uri` (`apps/web/src/lib/auth-store.ts`), so the value a workspace's
 * first-party client has to have registered is the panel's *origin* plus that
 * path — not `WEB_APP_URL` verbatim, whose trailing slash or path would make an
 * exact-match comparison fail for no reason.
 *
 * Server configuration is the only input. Nothing a request carries reaches the
 * allowlist: the `redirect_uri` a client sends is what gets *checked* against
 * it, and letting the same value also *write* it would make the check a no-op.
 */

/** The path the panel's `/auth/callback` route answers on. */
export const CONSOLE_CALLBACK_PATH = '/auth/callback';

/**
 * What `auth_signup` registers when it is called without a console redirect —
 * the value every first-party client carried before this was configurable, and
 * still the right one for the development stack (`WEB_APP_URL`'s default).
 */
export const DEV_CONSOLE_REDIRECT = `http://localhost:5173${CONSOLE_CALLBACK_PATH}`;

/**
 * The shapes a console redirect may take — the same rule, character for
 * character, as `auth_console_redirect_admissible` in migration
 * `20260925120000_console_redirect_from_config`, so the boot and the database
 * cannot disagree about a value (`console-redirect.test.ts` holds them to it).
 *
 * `https` on any host, or plain `http` on loopback only — the two web families
 * `OauthService.isRegisteredRedirect` admits. A lowercase ASCII host because
 * `URL.origin` has already lowercased and punycoded it; no userinfo, query or
 * fragment because an origin cannot carry them.
 */
export const CONSOLE_REDIRECT_PATTERN =
  /^(https:\/\/[a-z0-9.-]+(:[0-9]{1,5})?|http:\/\/(localhost|127\.0\.0\.1)(:[0-9]{1,5})?)\/auth\/callback$/;

/**
 * `WEB_APP_URL` → the console callback to register, or `null` when that
 * address cannot be a redirect target at all (plain `http` off loopback, a
 * non-web scheme, an IPv6 literal).
 */
export function consoleRedirectUri(webAppUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(webAppUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const candidate = `${url.origin}${CONSOLE_CALLBACK_PATH}`;
  return CONSOLE_REDIRECT_PATTERN.test(candidate) ? candidate : null;
}
