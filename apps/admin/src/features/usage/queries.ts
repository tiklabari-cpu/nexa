/**
 * The Usage page's reads and writes (tm 389.12 · FR-ADMIN-13): the deployment's counters, the
 * heaviest workspaces on one meter, one workspace's AI allowance and its override, each plan's
 * default. A write refreshes everything under `usage` and the billing plan list, which shows
 * the plan defaults too.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
  PlatformGlobalUsage,
  PlatformPlanAiCaps,
  PlatformPlanAiCapsResult,
  PlatformTopUsage,
  PlatformUsageTopMeter,
  PlatformWorkspaceAiCapsResult,
  PlatformWorkspaceUsageDetail,
} from '../../lib/platform-types.js';

export const USAGE_DAYS = 30;
export const TOP_SIZE = 20;
export const TOP_METERS: readonly PlatformUsageTopMeter[] = [
  'llm',
  'embedding',
  'ai_resolutions',
  'api_calls',
];

export function useGlobalUsage(): UseQueryResult<PlatformGlobalUsage> {
  return useQuery({
    queryKey: ['usage', 'global', USAGE_DAYS],
    queryFn: () => api.get<PlatformGlobalUsage>(`/usage/global?days=${USAGE_DAYS}`),
  });
}

export function useTopUsage(meter: PlatformUsageTopMeter): UseQueryResult<PlatformTopUsage> {
  return useQuery({
    queryKey: ['usage', 'top', meter],
    queryFn: () => api.get<PlatformTopUsage>(`/usage/workspaces?meter=${meter}&top=${TOP_SIZE}`),
  });
}

export function useWorkspaceUsage(licenseId: string): UseQueryResult<PlatformWorkspaceUsageDetail> {
  return useQuery({
    queryKey: ['usage', 'workspace', licenseId],
    queryFn: () => api.get<PlatformWorkspaceUsageDetail>(`/usage/workspaces/${licenseId}`),
  });
}

export function usePlanCaps(): UseQueryResult<PlatformPlanAiCaps> {
  return useQuery({
    queryKey: ['usage', 'plan-caps'],
    queryFn: () => api.get<PlatformPlanAiCaps>('/settings/ai-caps'),
  });
}

export interface WorkspaceAiCapsInput {
  llm_daily_tokens_cap: number | null;
  embedding_daily_tokens_cap: number | null;
  expires_at: string | null;
  reason: string;
}

export function usePutWorkspaceAiCaps(licenseId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: WorkspaceAiCapsInput) =>
      api.put<PlatformWorkspaceAiCapsResult>(`/usage/workspaces/${licenseId}/ai-caps`, input),
    onSuccess: (result) => {
      client.setQueryData(['usage', 'workspace', licenseId], result.usage);
      return client.invalidateQueries({ queryKey: ['usage'] });
    },
  });
}

export interface PlanCapsInput {
  plans: Record<string, { llm: number | null; embedding: number | null }>;
  reason: string;
}

export function usePutPlanCaps() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: PlanCapsInput) =>
      api.put<PlatformPlanAiCapsResult>('/settings/ai-caps', input),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: ['usage'] }),
        client.invalidateQueries({ queryKey: ['billing', 'plans'] }),
      ]),
  });
}
