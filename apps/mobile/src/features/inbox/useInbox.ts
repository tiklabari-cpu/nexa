/**
 * React's view of the inbox store.
 *
 * `useSyncExternalStore` rather than a `useState` mirror: the store is written
 * to from outside React (a socket frame, a reconnect replay), and a mirror
 * would let the screen render a snapshot the store has already moved past.
 */
import { useSyncExternalStore } from 'react';

import { useInboxStore } from './context';
import type { InboxState, TranscriptState } from './store';

export function useInboxState(): InboxState {
  const store = useInboxStore();
  return useSyncExternalStore(store.subscribe, store.getState);
}

/**
 * One chat's transcript.
 *
 * Derived from the same subscription rather than its own: `getSnapshot` has to
 * return a referentially stable value between changes, and the store already
 * keeps each transcript object identical until something in it actually moves.
 */
export function useTranscript(chatId: string): TranscriptState {
  const state = useInboxState();
  const store = useInboxStore();
  return state.transcripts[chatId] ?? store.transcriptOf(chatId);
}
