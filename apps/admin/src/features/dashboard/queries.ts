/**
 * The dashboard's three reads (tm 389.8). One query each, so a slow health read does not hold
 * the figures back and a failed one does not blank them.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
  PlatformDashboardHealth,
  PlatformDashboardKpis,
  PlatformDashboardSignups,
} from '../../lib/platform-types.js';

export const SIGNUP_DAYS = 30;
/** The leader republishes every 30 s; asking twice as often shows each publication within 15 s. */
export const HEALTH_REFRESH_MS = 15_000;

export function useKpis(): UseQueryResult<PlatformDashboardKpis> {
  return useQuery({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => api.get<PlatformDashboardKpis>('/dashboard/kpis'),
  });
}

export function useSignups(days = SIGNUP_DAYS): UseQueryResult<PlatformDashboardSignups> {
  return useQuery({
    queryKey: ['dashboard', 'signups', days],
    queryFn: () => api.get<PlatformDashboardSignups>(`/dashboard/signups?days=${days}`),
  });
}

export function useHealth(): UseQueryResult<PlatformDashboardHealth> {
  return useQuery({
    queryKey: ['dashboard', 'health'],
    queryFn: () => api.get<PlatformDashboardHealth>('/dashboard/health'),
    refetchInterval: HEALTH_REFRESH_MS,
    // A health screen is read in the moment: a copy from the last visit is worse than a spinner.
    staleTime: 0,
  });
}
