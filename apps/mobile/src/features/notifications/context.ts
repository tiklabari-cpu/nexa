/**
 * The Notifications API, kept apart from the provider that builds it — same
 * split as Reports/Customers. A screen needs the two requests it can make; it
 * does not need the session or the transport `NotificationsProvider` builds
 * one from, so a screen — and a test of one — depends on the smaller thing.
 */
import { createContext, useContext } from 'react';

import type { NotificationsApi } from './api';

export const NotificationsContext = createContext<NotificationsApi | null>(null);

export function useNotificationsApi(): NotificationsApi {
  const api = useContext(NotificationsContext);
  if (api === null) {
    throw new Error('useNotificationsApi must be called within a NotificationsProvider');
  }
  return api;
}
