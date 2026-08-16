/**
 * Where the Notifications API is built from the session's client — the one
 * place that knows `useServices()` exists, mirroring
 * `features/reports/ReportsProvider`. Mounted above the Settings stack, not
 * the root, scoped to the tab the same way the other three are.
 */
import { useMemo, type PropsWithChildren } from 'react';

import { createNotificationsApi } from './api';
import type { NotificationsApi } from './api';
import { NotificationsContext } from './context';
import { useServices } from '../../app/services';

export interface NotificationsProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session otherwise. */
  api?: NotificationsApi;
}

export function NotificationsProvider({ api, children }: NotificationsProviderProps) {
  const { api: client } = useServices();
  const value = useMemo(() => api ?? createNotificationsApi(client), [api, client]);
  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}
