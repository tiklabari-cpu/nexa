/**
 * The store's context, kept apart from the provider that fills it.
 *
 * A screen needs the store; it does not need the session, the secure store or
 * the socket that `InboxProvider` assembles to build one. Splitting the two
 * means a screen — and a test of that screen — depends on the smaller thing.
 */
import { createContext, useContext } from 'react';

import type { InboxStore } from './store';

export const InboxContext = createContext<InboxStore | null>(null);

export function useInboxStore(): InboxStore {
  const store = useContext(InboxContext);
  if (store === null) throw new Error('useInboxStore must be called within an InboxProvider');
  return store;
}
