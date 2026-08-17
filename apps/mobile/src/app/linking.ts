/**
 * What a `nexa://` URL means — and why that depends on whether anybody is
 * signed in.
 *
 * `app.json` has registered `scheme: nexa` since `13.7-a` and `@nexa/types`
 * has built `MOBILE_REDIRECT_URI` out of it since `13.7-b`, but nothing ever
 * told React Navigation about either: `NavigationContainer` was mounted without
 * `linking`, so every URL the operating system handed this app was dropped on
 * the floor (§D111). This is the map it was missing.
 *
 * Two of them, because `RootNavigator` swaps between two trees that never
 * coexist. A path is only meaningful against the tree that is mounted:
 * `chats/<id>` names a screen a signed-out person has no route to, and
 * `auth/callback` names one a signed-in person has no route to. One combined
 * config would parse both and then ask the navigator to visit a screen that is
 * not there — which React Navigation answers with a warning and nothing else.
 * Choosing by session status says the same thing honestly and testably.
 *
 * The prefix is derived from `MOBILE_APP_SCHEME` rather than written out, for
 * the reason that constant exists at all: the redirect URI the server
 * exact-matches is built from the same value, and a second copy here is a pair
 * that can drift.
 */
import { MOBILE_APP_SCHEME } from '@nexa/types';
import type { LinkingOptions } from '@react-navigation/native';

import type { AuthStackParamList, RootTabParamList } from './navigation';
import type { SessionStatus } from '../auth/session';

/** Every route a URL can name, across the two trees `RootNavigator` swaps between. */
export type LinkableParamList = AuthStackParamList & RootTabParamList;

/**
 * `nexa://` — the app's private-use scheme (RFC 8252 §7.1), the one `app.json`
 * registers. Universal (`https`) links are deliberately not here: they need a
 * verified domain and a hosted association file, which is the deployment this
 * repository does not do (§C-A29 · CLAUDE.md).
 */
export const URL_PREFIXES: readonly string[] = [`${MOBILE_APP_SCHEME}://`];

/** The path half of `MOBILE_REDIRECT_URI`, as the OS hands it back. */
export const CALLBACK_PATH = 'auth/callback';

/**
 * Signed out: the only URL that means anything is the SSO callback.
 *
 * Almost always it is *not* seen here. `openAuthSessionAsync` registers its own
 * listener while the sheet is open and resolves with the callback itself, which
 * is the path `MobileSession.signInWithSso` takes and the only one that can
 * finish a sign-in.
 *
 * What lands here is the other case: a callback that arrives when nothing is
 * waiting for it — the sheet was dismissed and the identity provider redirected
 * anyway, or Android killed this process while the browser was in front and
 * relaunched it to deliver the URL. Either way the verifier is gone. It lived
 * on the stack across the round trip, on purpose (`session.ts`), so a process
 * that restarted does not have it and the code cannot be redeemed by anyone,
 * including this app. Storing the code to "try again later" would trade that
 * property away for a login that still would not complete.
 *
 * So this routes to the sign-in form and says what happened, and it drops the
 * query string on the way: an authorization code in `params` would be written
 * into navigation state, which React Navigation serialises, persists and hands
 * to devtools. `returned` is the whole of what survives — one boolean, no
 * credential — which is the same rule `13.7-p` applied to the password.
 */
export const authLinking: LinkingOptions<LinkableParamList> = {
  prefixes: [...URL_PREFIXES],
  getStateFromPath: (path) => {
    const [pathname] = path.split('?');
    if (trimSlashes(pathname ?? '') !== CALLBACK_PATH) return undefined;
    return { routes: [{ name: 'SignIn', params: { returned: true } }] };
  },
};

/**
 * Signed in: one conversation, by id.
 *
 * `initialRouteName` is what puts the list underneath rather than beside it —
 * without it a deep-linked chat is the only route on the stack, "back" leaves
 * the app, and the inbox never loads (which is also where `ChatDetail`'s header
 * gets the customer's name from, since a URL cannot carry one).
 *
 * `13.7-s` sends a tapped notification down this same path, which is why the
 * route is spelled once, here.
 */
export const appLinking: LinkingOptions<LinkableParamList> = {
  prefixes: [...URL_PREFIXES],
  config: {
    screens: {
      Inbox: {
        initialRouteName: 'InboxHome',
        screens: { ChatDetail: 'chats/:chatId' },
      },
    },
  },
};

/**
 * The map for the tree that is mounted right now.
 *
 * `unknown` gets the signed-out map because it is the one that cannot go wrong:
 * `RootNavigator` renders no container at all in that state, and if it ever
 * does, a callback URL is the likelier thing to be holding.
 */
export function linkingFor(status: SessionStatus): LinkingOptions<LinkableParamList> {
  return status === 'signed-in' ? appLinking : authLinking;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}
