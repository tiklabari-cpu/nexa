/**
 * Where a native sign-in comes back to.
 *
 * A phone cannot receive an `https` redirect: there is no server listening on
 * the device to catch it, and handing the code to a hosted page would put it in
 * a browser the app does not control. RFC 8252 §7.1 answers this with a
 * private-use URI scheme the operating system routes back to the app, and that
 * is what this is.
 *
 * It lives in `@nexa/types` rather than in `apps/mobile` because two sides have
 * to agree on the exact string: the app sends it on `/auth/authorize` and
 * `/auth/token`, and the server matches it against the client's registered set
 * *byte for byte* (`OauthService.isRegisteredRedirect`). A copy on each side is
 * a pair that can drift, and the symptom of drift is "sign-in fails on device,
 * works everywhere else".
 *
 * The scheme is not a secret and not a defence. Another app on the same phone
 * can claim `nexa://` and win the race for the callback — the collision RFC 8252
 * warns about, and the reason PKCE is mandatory here rather than optional: an
 * intercepted code is useless without the verifier, which never leaves the app
 * that started the login. The residual risk is a sign-in that does not complete,
 * not a session somebody else can hold.
 */

/** The app's private-use URI scheme, mirroring `expo.scheme` in `app.json`. */
export const MOBILE_APP_SCHEME = 'nexa';

/** The redirect URI the mobile client registers and sends. Exact-matched. */
export const MOBILE_REDIRECT_URI = `${MOBILE_APP_SCHEME}://auth/callback`;
