/**
 * Where the Playbook API is built from the session's client — the one place
 * that knows `useServices()` exists, mirroring `features/team/TeamProvider`.
 * Mounted above the stack rather than the root, scoped to the tab the same way.
 */
import { useMemo, type PropsWithChildren } from 'react';

import { createPlaybookApi } from './api';
import type { PlaybookApi } from './api';
import { PlaybookContext } from './context';
import { useServices } from '../../app/services';

export interface PlaybookProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session otherwise. */
  api?: PlaybookApi;
}

export function PlaybookProvider({ api, children }: PlaybookProviderProps) {
  const { api: client } = useServices();
  const value = useMemo(() => api ?? createPlaybookApi(client), [api, client]);
  return <PlaybookContext.Provider value={value}>{children}</PlaybookContext.Provider>;
}
