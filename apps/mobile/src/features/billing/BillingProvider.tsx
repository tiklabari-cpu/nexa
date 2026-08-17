/**
 * Where the Billing API is built from the session's client — the one place
 * that knows `useServices()` exists, mirroring `features/team/TeamProvider`
 * and `features/playbook/PlaybookProvider`. Mounted above the stack rather
 * than the root, scoped to the tab the same way.
 */
import { useMemo, type PropsWithChildren } from 'react';

import { createBillingApi } from './api';
import type { BillingApi } from './api';
import { BillingContext } from './context';
import { useServices } from '../../app/services';

export interface BillingProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session otherwise. */
  api?: BillingApi;
}

export function BillingProvider({ api, children }: BillingProviderProps) {
  const { api: client } = useServices();
  const value = useMemo(() => api ?? createBillingApi(client), [api, client]);
  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}
