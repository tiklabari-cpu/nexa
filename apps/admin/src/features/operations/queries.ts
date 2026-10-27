/**
 * The Operations page's reads and writes (tm 389.14 · FR-ADMIN-20). One query per section, so a
 * slow partition catalogue does not hold the job table back and a failed read blanks only its
 * own card.
 *
 * Each mutation writes its own path where it calls (`scripts/audit/endpoint-ui.cjs` reads every
 * call as written) and refetches what it can have changed.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
  PlatformOperationsComponents,
  PlatformOperationsEnsureResult,
  PlatformOperationsJobs,
  PlatformOperationsPartitions,
  PlatformOperationsPurgeResult,
  PlatformOperationsRunResult,
  PlatformOperationsScheduler,
  PlatformOperationsSiem,
  PlatformOperationsUnverifiedSignups,
  PlatformOperationsWebhooks,
} from '../../lib/platform-types.js';

/**
 * The job table is the page an operator watches after pressing "Run now": `running` and the
 * last manual outcome are read live, so it refreshes faster than the leader republishes.
 */
export const SCHEDULER_REFRESH_MS = 5_000;
export const BACKLOG_REFRESH_MS = 30_000;

export function useScheduler(): UseQueryResult<PlatformOperationsScheduler> {
  return useQuery({
    queryKey: ['operations', 'scheduler'],
    queryFn: () => api.get<PlatformOperationsScheduler>('/operations/scheduler'),
    refetchInterval: SCHEDULER_REFRESH_MS,
    staleTime: 0,
  });
}

export function useWebhooks(): UseQueryResult<PlatformOperationsWebhooks> {
  return useQuery({
    queryKey: ['operations', 'webhooks'],
    queryFn: () => api.get<PlatformOperationsWebhooks>('/operations/webhooks'),
    refetchInterval: BACKLOG_REFRESH_MS,
    staleTime: 0,
  });
}

export function useSiem(): UseQueryResult<PlatformOperationsSiem> {
  return useQuery({
    queryKey: ['operations', 'siem'],
    queryFn: () => api.get<PlatformOperationsSiem>('/operations/siem'),
    refetchInterval: BACKLOG_REFRESH_MS,
    staleTime: 0,
  });
}

export function usePartitions(): UseQueryResult<PlatformOperationsPartitions> {
  return useQuery({
    queryKey: ['operations', 'partitions'],
    queryFn: () => api.get<PlatformOperationsPartitions>('/operations/partitions'),
    staleTime: 0,
  });
}

export function useUnverifiedSignups(): UseQueryResult<PlatformOperationsUnverifiedSignups> {
  return useQuery({
    queryKey: ['operations', 'unverified'],
    queryFn: () => api.get<PlatformOperationsUnverifiedSignups>('/operations/unverified-signups'),
    staleTime: 0,
  });
}

export function useQueues(): UseQueryResult<PlatformOperationsJobs> {
  return useQuery({
    queryKey: ['operations', 'jobs'],
    queryFn: () => api.get<PlatformOperationsJobs>('/operations/jobs'),
    refetchInterval: BACKLOG_REFRESH_MS,
    staleTime: 0,
  });
}

export function useComponentRecord(): UseQueryResult<PlatformOperationsComponents> {
  return useQuery({
    queryKey: ['operations', 'components'],
    queryFn: () => api.get<PlatformOperationsComponents>('/operations/components'),
    refetchInterval: BACKLOG_REFRESH_MS,
    staleTime: 0,
  });
}

/** "Run now": the answer says what the platform could know; the outcome follows in the table. */
export function useRunJob() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ name, reason }: { name: string; reason: string }) =>
      api.post<PlatformOperationsRunResult>(`/operations/scheduler/${name}/run`, { reason }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['operations', 'scheduler'] }),
  });
}

/** Open one month's partition, or — without `month` — every month of the runtime window. */
export function useEnsurePartitions() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ reason, month }: { reason: string; month?: string }) =>
      api.post<PlatformOperationsEnsureResult>(
        '/operations/partitions/ensure',
        month === undefined ? { reason } : { reason, month },
      ),
    onSuccess: () => client.invalidateQueries({ queryKey: ['operations', 'partitions'] }),
  });
}

export function usePurgeUnverified() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ reason }: { reason: string }) =>
      api.post<PlatformOperationsPurgeResult>('/operations/unverified-signups/purge', { reason }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['operations', 'unverified'] }),
  });
}
