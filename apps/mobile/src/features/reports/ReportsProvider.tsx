/**
 * Where the Reports API is built from the session's client — the one place
 * that knows `useServices()` exists, mirroring `features/customers/CustomersProvider`.
 * Mounted above the stack rather than the root, scoped to the tab the same way.
 */
import { useMemo, type PropsWithChildren } from 'react';

import { createReportsApi } from './api';
import type { ReportsApi } from './api';
import { ReportsContext } from './context';
import { useServices } from '../../app/services';

export interface ReportsProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session otherwise. */
  api?: ReportsApi;
}

export function ReportsProvider({ api, children }: ReportsProviderProps) {
  const { api: client } = useServices();
  const value = useMemo(() => api ?? createReportsApi(client), [api, client]);
  return <ReportsContext.Provider value={value}>{children}</ReportsContext.Provider>;
}
