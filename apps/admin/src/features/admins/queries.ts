/**
 * The Admins page's reads (tm 391 · FR-ADMIN-04): the operator directory and the pending
 * invitations; and the operator's own alert preferences (tm 389.20 · FR-ADMIN-24). Each action
 * writes its own path where it calls (`scripts/audit/endpoint-ui.cjs` reads every call as written).
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
  PlatformAdminList,
  PlatformAlertPrefs,
  PlatformAlertPrefsUpdate,
  PlatformInviteList,
} from '../../lib/platform-types.js';

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

const ADMINS_KEY = ['admins', 'directory'] as const;
const INVITES_KEY = ['admins', 'invites'] as const;

/** The operators. Not paged: the server returns the whole handful. */
export function useAdmins(): UseQueryResult<PlatformAdminList> {
  return useQuery({
    queryKey: ADMINS_KEY,
    queryFn: () => api.get<PlatformAdminList>('/admins'),
  });
}

export function useInvites(): UseQueryResult<PlatformInviteList> {
  return useQuery({
    queryKey: INVITES_KEY,
    queryFn: () => api.get<PlatformInviteList>('/admins/invites'),
  });
}

/**
 * Every operator write refetches both lists: a role change moves a row, an invitation appears
 * in one list and (once accepted) the other, and the audit page's operator filter reads the first.
 */
export function useRefreshDirectory(): () => Promise<void> {
  const client = useQueryClient();
  return async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ADMINS_KEY }),
      client.invalidateQueries({ queryKey: INVITES_KEY }),
    ]);
  };
}
