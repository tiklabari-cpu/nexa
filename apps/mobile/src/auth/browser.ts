/**
 * The system browser, wrapped down to the one question the session asks.
 *
 * `expo-web-browser`'s `openAuthSessionAsync` is the API that matters here, and
 * the reason is §C-A29: it presents ASWebAuthenticationSession on iOS and a
 * Chrome Custom Tab on Android — real browsers, in their own process, that this
 * app cannot read a keystroke out of. The alternative every "just embed a
 * WebView" answer reaches for is a login form running inside the app that asks
 * for it, which is indistinguishable from a phishing screen and is why identity
 * providers increasingly refuse to render in one.
 *
 * Everything except "here is the callback URL, or nothing" is collapsed away.
 * Dismissed, cancelled, and locked (another auth session already open) all mean
 * the same thing to a sign-in screen: no credential arrived, offer the button
 * again.
 */
import * as WebBrowser from 'expo-web-browser';

import type { AuthBrowser } from './session';

export const systemBrowser: AuthBrowser = {
  async open(url: string, redirectUri: string): Promise<string | null> {
    const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
    return result.type === 'success' ? result.url : null;
  },
};
