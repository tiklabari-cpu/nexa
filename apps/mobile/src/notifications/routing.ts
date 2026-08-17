/**
 * Getting from a tapped notification to the conversation it was about
 * (FR-MOD-13.7 · 13.7-s).
 *
 * Three things have to line up before the app can honour a tap, and none of
 * them is guaranteed at the moment it arrives: somebody has to be signed in,
 * the navigator has to have finished mounting, and the tab tree — not the
 * sign-in screen — has to be the one on screen. A cold start from a
 * notification has none of the three. So the tap is *held* and delivered when
 * they do line up, which is also the whole of the "signed out" requirement: the
 * destination is not lost, it waits.
 *
 * Held in React state rather than in the protected store, deliberately. A
 * pending destination is a fact about this launch, not about this account; a
 * chat id surviving a restart would re-open a conversation days later because
 * of a notification somebody tapped once. It dies with the process, which is
 * the correct lifetime.
 *
 * **Why the navigation ref rather than `nexa://chats/<id>`.** `13.7-q` gave the
 * conversation a URL, and reusing it here is tempting — one route, spelled
 * once. But a URL would have to go back out through `Linking` and in again, and
 * the signed-out linking map does not contain `chats/:chatId` at all (the two
 * trees never coexist, so neither does one combined map). A tap arriving before
 * sign-in would be parsed against a map that cannot express it and dropped —
 * exactly the case this hook exists to serve. The ref names the same screen
 * `appLinking` does, from the same param list, and can wait.
 */
import { useEffect, useRef, useState } from 'react';

import { installForegroundHandler } from './handler';
import { launchTap, subscribeToTaps, type NotificationTap } from './response';
import { navigationRef } from '../app/navigationRef';
import type { SessionStatus } from '../auth/session';

/**
 * Install the notification plumbing, and route what it delivers.
 *
 * `navigatorReady` is `NavigationContainer`'s own `onReady`, passed in rather
 * than read off the ref: `isReady()` is a question, not a subscription, and a
 * tap that arrived a moment too early would sit unanswered until something else
 * re-rendered. The container settling is the event worth waiting on — with
 * `linking` in play it resolves the launch URL first, so "mounted" and "ready"
 * are genuinely different moments (`RootNavigator`).
 */
export function useNotificationRouting(status: SessionStatus, navigatorReady: boolean): void {
  const [pending, setPending] = useState<NotificationTap | null>(null);
  // Every delivery this hook has already acted on. A cold start offers the same
  // response twice — once as the launch response, once through the listener —
  // and without this the app pushes the conversation onto the stack twice, so
  // "back" lands on the same chat again.
  const handled = useRef<Set<string>>(new Set());

  useEffect(() => {
    installForegroundHandler();

    let live = true;
    const accept = (tap: NotificationTap) => {
      if (!live || handled.current.has(tap.id)) return;
      handled.current.add(tap.id);
      setPending(tap);
    };

    const unsubscribe = subscribeToTaps(accept);
    // Asked once, at mount: the platform keeps answering with the same response
    // for the life of the process, so re-reading it later would drag somebody
    // back to a conversation they had already navigated away from.
    void launchTap().then((tap) => {
      if (tap !== null) accept(tap);
    });

    return () => {
      live = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (pending === null || !navigatorReady || status !== 'signed-in') return;
    // The container can be ready and the tab tree still a render behind it on
    // the frame the session flips. Leaving `pending` set means the next commit
    // tries again rather than losing the destination.
    if (!navigationRef.isReady()) return;

    setPending(null);
    // The same screen `appLinking` names, reached the same way the inbox list
    // reaches it — without a title, because a notification carries no name
    // either (`features/inbox/title.ts` fills it in from the list underneath).
    navigationRef.navigate('Inbox', {
      screen: 'ChatDetail',
      params: { chatId: pending.chatId },
    });
  }, [pending, navigatorReady, status]);
}
