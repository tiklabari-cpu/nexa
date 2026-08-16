/**
 * Where the Notifications API is built from the session's client — the one
 * place that knows `useServices()` exists, mirroring
 * `features/reports/ReportsProvider`. Mounted above the Settings stack, not
 * the root, scoped to the tab the same way the other three are.
 */
import { useMemo, type PropsWithChildren } from 'react';

import { createNotificationsApi } from './api';
import type { NotificationsApi } from './api';
import { DevicePushPermissionContext, NotificationsContext } from './context';
import { readPushPermission } from '../../auth/push-tokens';
import type { PushPermissionReader } from '../../auth/push-tokens';
import { useServices } from '../../app/services';

export interface NotificationsProviderProps extends PropsWithChildren {
  /** Supplied by tests; the app builds one from the session otherwise. */
  api?: NotificationsApi;
  /** Supplied by tests; the app reads the real device permission otherwise. */
  devicePermission?: PushPermissionReader;
}

export function NotificationsProvider({
  api,
  devicePermission,
  children,
}: NotificationsProviderProps) {
  const { api: client } = useServices();
  const value = useMemo(() => api ?? createNotificationsApi(client), [api, client]);
  // Supplied here rather than defaulted inside the screen, so the module that
  // reaches for `expo-notifications` stays out of the screen's own import graph
  // (13.7-l) — the same reason `api` is built here and not there.
  const permission = devicePermission ?? readPushPermission;
  return (
    <NotificationsContext.Provider value={value}>
      <DevicePushPermissionContext.Provider value={permission}>
        {children}
      </DevicePushPermissionContext.Provider>
    </NotificationsContext.Provider>
  );
}
