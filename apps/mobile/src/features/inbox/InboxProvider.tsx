/**
 * Where the inbox store and the socket are wired together, and the only place
 * that knows both exist.
 *
 * Mounted inside the Inbox tab's stack rather than at the root: the chat list
 * and the chat screen are two routes over one conversation state, and scoping
 * it to the tab means the socket opens when the inbox is reachable and closes
 * with it, instead of living for the lifetime of the process.
 *
 * The push subscription is narrow on purpose. Every action asked for is a frame
 * the radio has to wake for, and a phone that subscribes to everything the
 * console shows — sneak peeks, per-keystroke typing indicators, queue position
 * recalculations — spends battery rendering nothing. What is left is what moves
 * the list or the transcript.
 */
import { useEffect, useMemo, type PropsWithChildren } from 'react';
import type { RtmPushAction } from '@nexa/types';

import { createInboxApi } from './api';
import { InboxContext } from './context';
import { InboxStore } from './store';
import { MobileRtmClient } from '../../rtm/client';
import { connectivity } from '../../lib/connectivity';
import { useServices, useSessionState } from '../../app/services';

const MOBILE_PUSHES: RtmPushAction[] = [
  'incoming_chat',
  'incoming_event',
  'chat_deactivated',
  'chat_transferred',
  'chat_taken_over',
];

export interface InboxProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session. */
  store?: InboxStore;
}

export function InboxProvider({ store, children }: InboxProviderProps) {
  const { api, session, config } = useServices();
  const sessionState = useSessionState();
  const organizationId = sessionState.principal?.organization_id ?? null;
  const accountId = sessionState.principal?.account_id ?? null;

  const wired = useMemo(() => {
    if (store !== undefined) return { store, rtm: null };

    // The store reports cursors and the client consumes them, so one of the two
    // has to be built first. A closed-over slot keeps the dependency in this
    // file rather than giving the store a socket type it has no other use for.
    let rtm: MobileRtmClient | null = null;
    const inbox = new InboxStore({
      api: createInboxApi(api),
      accountId,
      onCursor: (chatId, eventId) => rtm?.noteEvent(chatId, eventId),
      onChatForgotten: (chatId) => rtm?.forgetChat(chatId),
    });

    // No principal yet means no workspace to subscribe against; the list still
    // loads (and fails honestly) while the session settles, and this rebuilds
    // the moment it does.
    if (organizationId !== null) {
      rtm = new MobileRtmClient({
        baseUrl: config.rtmBaseUrl,
        organizationId,
        getToken: () => session.getAccessToken(),
        // Tells "the renewal has not landed yet" (wait, then dial again) from
        // "this session is over" (stop) — the socket cannot see the difference
        // from a null token alone (13.7-v).
        isSignedOut: () => session.getState().status === 'signed-out',
        pushes: MOBILE_PUSHES,
        onPush: (action, payload) => inbox.applyPush(action, payload),
        onStatusChange: (status) => {
          inbox.setConnection(status);
          // A socket that reached the gateway is proof the radio is back, and
          // often the first proof there is: while offline the screens have
          // stopped asking for anything, so nothing else would clear the band.
          if (status === 'live') connectivity.reportReachable();
        },
      });
    }

    return { store: inbox, rtm };
  }, [store, api, session, config.rtmBaseUrl, organizationId, accountId]);

  useEffect(() => {
    const rtm = wired.rtm;
    if (rtm === null) return;
    rtm.connect();
    return () => rtm.disconnect();
  }, [wired]);

  return <InboxContext.Provider value={wired.store}>{children}</InboxContext.Provider>;
}
