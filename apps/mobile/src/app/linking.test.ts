/**
 * The two maps, read the way React Navigation reads them.
 *
 * `getStateFromPath` is the library's own parser rather than a re-implementation
 * of it, so what is asserted here is what the container will actually do with a
 * URL — a config that merely *looks* right is the failure this file exists to
 * catch. The prefix half (stripping `nexa://` off a real launch URL) is proved
 * where it happens, against the real `App`, in `App.test.tsx`.
 */
import { MOBILE_REDIRECT_URI } from '@nexa/types';
import { getStateFromPath } from '@react-navigation/native';

import { appLinking, authLinking, CALLBACK_PATH, linkingFor, URL_PREFIXES } from './linking';

/** `authLinking` supplies one; the type has it optional for configs that do not. */
const parseAuth = (path: string) => authLinking.getStateFromPath!(path);

const parseApp = (path: string) => getStateFromPath(path, appLinking.config);

describe('the scheme', () => {
  it('is the one the redirect URI is built from, not a second copy', () => {
    // Drift here is the bug that reads as "sign-in fails on device only": the
    // server exact-matches `MOBILE_REDIRECT_URI`, and the OS routes by whatever
    // `prefixes` says. Both come from `MOBILE_APP_SCHEME`, and this is the
    // assertion that keeps it that way.
    expect(URL_PREFIXES).toEqual(['nexa://']);
    expect(MOBILE_REDIRECT_URI).toBe(`${URL_PREFIXES[0]}${CALLBACK_PATH}`);
  });
});

describe('signed out — the SSO callback', () => {
  it('lands on the sign-in form and says the round trip is over', () => {
    expect(parseAuth(CALLBACK_PATH)).toEqual({
      routes: [{ name: 'SignIn', params: { returned: true } }],
    });
  });

  it('keeps nothing the callback carried', () => {
    const state = parseAuth(`${CALLBACK_PATH}?code=secret-code&state=abc123`);

    // The verifier died with the process that started the login, so the code is
    // unredeemable by anyone — but navigation state is serialised and persisted,
    // and a credential does not go in it (the rule `13.7-p` set for the
    // password). One boolean is the whole of what survives.
    expect(state).toEqual({ routes: [{ name: 'SignIn', params: { returned: true } }] });
    expect(JSON.stringify(state)).not.toContain('secret-code');
    expect(JSON.stringify(state)).not.toContain('abc123');
  });

  it('reads the same path however the platform spells the slashes', () => {
    expect(parseAuth(`/${CALLBACK_PATH}`)).toEqual(parseAuth(CALLBACK_PATH));
    expect(parseAuth(`${CALLBACK_PATH}/`)).toEqual(parseAuth(CALLBACK_PATH));
  });

  it('ignores a URL that is not the callback rather than guessing a screen', () => {
    // `chats/<id>` is a real route — in the *other* tree. Signed out there is
    // nowhere to put it, and inventing a destination would be worse than
    // opening the app where it already was.
    expect(parseAuth('chats/chat-1')).toBeUndefined();
    expect(parseAuth('')).toBeUndefined();
    expect(parseAuth('auth')).toBeUndefined();
    expect(parseAuth('auth/callback/extra')).toBeUndefined();
  });
});

describe('signed in — one conversation by id', () => {
  it('opens the chat the URL names, with the inbox underneath it', () => {
    expect(parseApp('chats/chat-1')).toEqual({
      routes: [
        {
          name: 'Inbox',
          state: {
            index: 1,
            routes: [
              // `initialRouteName` — without it "back" from a deep link leaves
              // the app, and the list that supplies the header's title never
              // loads.
              { name: 'InboxHome' },
              { name: 'ChatDetail', params: { chatId: 'chat-1' }, path: 'chats/chat-1' },
            ],
          },
        },
      ],
    });
  });

  it('carries no title — a URL has none, and the header must not invent one', () => {
    // `ChatDetail.title` is optional for exactly this reason; the screen works
    // it out from the inbox instead (`features/inbox/title.ts`).
    expect(JSON.stringify(parseApp('chats/chat-1'))).not.toContain('title');
  });

  it('ignores a path no screen claims', () => {
    expect(parseApp('auth/callback')).toBeUndefined();
    expect(parseApp('reports')).toBeUndefined();
  });
});

describe('linkingFor', () => {
  it('hands each session state the tree that is actually mounted', () => {
    expect(linkingFor('signed-in')).toBe(appLinking);
    expect(linkingFor('signed-out')).toBe(authLinking);
    // No container is rendered while the session is still being restored; the
    // callback map is the safer of the two to be holding if that ever changes.
    expect(linkingFor('unknown')).toBe(authLinking);
  });
});
