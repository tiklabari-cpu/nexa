/**
 * Where the Customers API is built from the session's client — the one place
 * that knows `useServices()` exists, mirroring `features/inbox/InboxProvider`.
 * Mounted above the stack rather than the root, scoped to the tab the same way.
 */
import { useMemo, type PropsWithChildren } from 'react';

import { createCustomersApi } from './api';
import type { CustomersApi } from './api';
import { CustomersContext } from './context';
import { useServices } from '../../app/services';

export interface CustomersProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session otherwise. */
  api?: CustomersApi;
}

export function CustomersProvider({ api, children }: CustomersProviderProps) {
  const { api: client } = useServices();
  const value = useMemo(() => api ?? createCustomersApi(client), [api, client]);
  return <CustomersContext.Provider value={value}>{children}</CustomersContext.Provider>;
}
