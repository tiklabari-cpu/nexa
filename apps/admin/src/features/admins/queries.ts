/**
 * The operator's own alert preferences (tm 389.20 · FR-ADMIN-24): which alert mails they get, and
 * in which language. The write answers with the stored choice as it now reads.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type { PlatformAlertPrefs, PlatformAlertPrefsUpdate } from '../../lib/platform-types.js';

const ALERT_PREFS_KEY = ['admins', 'alert-prefs'] as const;

export function useAlertPrefs(): UseQueryResult<PlatformAlertPrefs> {
  return useQuery({
    queryKey: ALERT_PREFS_KEY,
    queryFn: () => api.get<PlatformAlertPrefs>('/auth/me/alert-prefs'),
  });
}

export function useSaveAlertPrefs() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PlatformAlertPrefsUpdate) =>
      api.put<PlatformAlertPrefs>('/auth/me/alert-prefs', body),
    onSuccess: (prefs) => {
      client.setQueryData(ALERT_PREFS_KEY, prefs);
    },
  });
}
