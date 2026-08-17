/**
 * Where the Team API is built from the session's client — the one place that
 * knows `useServices()` exists, mirroring `features/customers/CustomersProvider`.
 * Mounted above the stack rather than the root, scoped to the tab the same way.
 */
import { useMemo, type PropsWithChildren } from 'react';

import { createTeamApi } from './api';
import type { TeamApi } from './api';
import { TeamContext } from './context';
import { useServices } from '../../app/services';

export interface TeamProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session otherwise. */
  api?: TeamApi;
}

export function TeamProvider({ api, children }: TeamProviderProps) {
  const { api: client } = useServices();
  const value = useMemo(() => api ?? createTeamApi(client), [api, client]);
  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}
