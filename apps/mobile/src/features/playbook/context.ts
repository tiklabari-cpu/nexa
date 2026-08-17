/**
 * The Playbook API, kept apart from the provider that builds it — same split
 * as the Team context. A screen needs the four requests it can make; it does
 * not need the session or the transport `PlaybookProvider` assembles one
 * from, so a screen — and a test of one — depends on the smaller thing.
 */
import { createContext, useContext } from 'react';

import type { PlaybookApi } from './api';

export const PlaybookContext = createContext<PlaybookApi | null>(null);

export function usePlaybookApi(): PlaybookApi {
  const api = useContext(PlaybookContext);
  if (api === null) {
    throw new Error('usePlaybookApi must be called within a PlaybookProvider');
  }
  return api;
}
