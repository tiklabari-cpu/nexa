/**
 * The Notifications API, kept apart from the provider that builds it — same
 * split as Reports/Customers. A screen needs the two requests it can make; it
 * does not need the session or the transport `NotificationsProvider` builds
 * one from, so a screen — and a test of one — depends on the smaller thing.
 */
import { createContext, useContext } from 'react';

import type { NotificationsApi } from './api';
import type { PushPermissionReader } from '../../auth/push-tokens';

export const NotificationsContext = createContext<NotificationsApi | null>(null);

export function useNotificationsApi(): NotificationsApi {
  const api = useContext(NotificationsContext);
  if (api === null) {
    throw new Error('useNotificationsApi must be called within a NotificationsProvider');
  }
  return api;
}

/**
 * Whether this handset will show a notification at all — the operating
 * system's answer, which no preference on the server can overrule (13.7-l).
 *
 * Deliberately a second context rather than a third member of
 * `NotificationsApi`. That interface is the two *requests* this screen makes;
 * a native permission read is not one, and folding it in would make every
 * existing test of the screen stand up a device story it does not care about.
 *
 * `null` — the default — means this build cannot tell, not that permission was
 * refused. A screen that treated the two the same would accuse a phone of
 * blocking notifications it is perfectly happy to show.
 */
export const DevicePushPermissionContext = createContext<PushPermissionReader | null>(null);

export function useDevicePushPermission(): PushPermissionReader | null {
  return useContext(DevicePushPermissionContext);
}
