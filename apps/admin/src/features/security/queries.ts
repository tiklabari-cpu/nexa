/**
 * The Security page's reads and writes (tm 389.16 · FR-ADMIN-22). One query per section, so a
 * slow counter does not hold the blocklist back and a failed read blanks only its own card.
 *
 * Each mutation writes its own path where it calls (`scripts/audit/endpoint-ui.cjs` reads every
 * call as written) and refetches what it can have changed.
 */
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
  PlatformAbuseCounters,
  PlatformBlocklistEntry,
  PlatformBlocklistKind,
  PlatformBlocklistList,
  PlatformFailedLogins,
  PlatformImpersonationList,
  PlatformSignupsByIp,
} from '../../lib/platform-types.js';

export const BLOCKLIST_PAGE_SIZE = 25;
export const IMPERSONATIONS_PAGE_SIZE = 20;
export const COUNTERS_REFRESH_MS = 30_000;

export const FAILED_LOGIN_SPANS = [1, 24, 72, 168] as const;
export const SIGNUP_SPANS = [7, 30, 90] as const;

export function useBlocklist(kind: PlatformBlocklistKind | '', q: string) {
  return useInfiniteQuery({
    queryKey: ['security', 'blocklist', kind, q],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (kind) params.set('kind', kind);
      if (q) params.set('q', q);
      params.set('limit', String(BLOCKLIST_PAGE_SIZE));
      if (pageParam) params.set('cursor', pageParam);
      return api.get<PlatformBlocklistList>(`/security/blocklist?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 0,
  });
}

export function useAddBlocklistEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { kind: PlatformBlocklistKind; value: string; reason: string }) =>
      api.post<PlatformBlocklistEntry>('/security/blocklist', input),
    onSuccess: () => client.invalidateQueries({ queryKey: ['security', 'blocklist'] }),
  });
}

export function useRemoveBlocklistEntry() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.delete<void>(`/security/blocklist/${id}`, { reason }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['security', 'blocklist'] }),
  });
}

export function useFailedLogins(hours: number): UseQueryResult<PlatformFailedLogins> {
  return useQuery({
    queryKey: ['security', 'failed-logins', hours],
    queryFn: () => api.get<PlatformFailedLogins>(`/security/failed-logins?hours=${hours}`),
    refetchInterval: COUNTERS_REFRESH_MS,
    staleTime: 0,
  });
}

export function useSignupsByIp(days: number): UseQueryResult<PlatformSignupsByIp> {
  return useQuery({
    queryKey: ['security', 'signups-by-ip', days],
    queryFn: () => api.get<PlatformSignupsByIp>(`/security/signups-by-ip?days=${days}`),
    staleTime: 0,
  });
}

export function useAbuseCounters(): UseQueryResult<PlatformAbuseCounters> {
  return useQuery({
    queryKey: ['security', 'abuse-counters'],
    queryFn: () => api.get<PlatformAbuseCounters>('/security/abuse-counters'),
    refetchInterval: COUNTERS_REFRESH_MS,
    staleTime: 0,
  });
}

export function useSecurityImpersonations(activeOnly: boolean) {
  return useInfiniteQuery({
    queryKey: ['security', 'impersonations', activeOnly],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (activeOnly) params.set('active', 'true');
      params.set('limit', String(IMPERSONATIONS_PAGE_SIZE));
      if (pageParam) params.set('cursor', pageParam);
      return api.get<PlatformImpersonationList>(`/security/impersonations?${params.toString()}`);
    },
    getNextPageParam: (last) => last.next_cursor,
    staleTime: 0,
  });
}
