/**
 * The Team API, kept apart from the provider that builds it — same split as
 * the Customers context. A screen needs the three requests it can make; it
 * does not need the session or the transport `TeamProvider` assembles one
 * from, so a screen — and a test of one — depends on the smaller thing.
 */
import { createContext, useContext } from 'react';

import type { TeamApi } from './api';

export const TeamContext = createContext<TeamApi | null>(null);

export function useTeamApi(): TeamApi {
  const api = useContext(TeamContext);
  if (api === null) {
    throw new Error('useTeamApi must be called within a TeamProvider');
  }
  return api;
}
