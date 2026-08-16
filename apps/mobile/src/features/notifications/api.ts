/**
 * The two requests the notification preferences screen makes, kept apart the
 * same way `features/reports/api.ts` is: path literals live here, not in the
 * component, so a screen — and a test of one — can hand in a plain object
 * instead of a real session and a real fetch.
 *
 * `PUT` takes a partial body — the endpoint requires at least one channel —
 * so `updatePreferences` sends only what moved rather than restating all
 * five, the same rule the web console's Settings page follows (a full
 * restate would clobber a channel a second session had just changed).
 */
import type { SessionApiClient } from '../../api/client';
import type { NotificationPreferences, NotificationPreferencesPatch } from './types';

export interface NotificationsApi {
  getPreferences(signal?: AbortSignal): Promise<NotificationPreferences>;
  updatePreferences(
    patch: NotificationPreferencesPatch,
    signal?: AbortSignal,
  ): Promise<NotificationPreferences>;
}

export function createNotificationsApi(client: SessionApiClient): NotificationsApi {
  return {
    getPreferences(signal) {
      return client.request('get', '/agents/me/notification-preferences', {
        ...(signal ? { signal } : {}),
      });
    },

    updatePreferences(patch, signal) {
      return client.request('put', '/agents/me/notification-preferences', {
        body: patch,
        ...(signal ? { signal } : {}),
      });
    },
  };
}
