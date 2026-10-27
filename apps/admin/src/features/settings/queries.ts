/**
 * The Settings page's reads and writes (tm 389.13 · FR-ADMIN-15/16). Every write answers with
 * the stored settings as they now read, written straight into the cache.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
  PlatformAiConnectionTest,
  PlatformAiConnectionTestRequest,
  PlatformAiReembedStatus,
  PlatformAiSettings,
  PlatformAiSettingsRequest,
  PlatformDeploymentSettings,
  PlatformEffectiveConfig,
  PlatformMaintenanceRequest,
  PlatformSettingsPatchRequest,
} from '../../lib/platform-types.js';

const SETTINGS_KEY = ['settings', 'deployment'] as const;

export function useDeploymentSettings(): UseQueryResult<PlatformDeploymentSettings> {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => api.get<PlatformDeploymentSettings>('/settings'),
  });
}

/** The tenant API publishes every 30 seconds; read again at the same pace. */
export function useEffectiveConfig(): UseQueryResult<PlatformEffectiveConfig> {
  return useQuery({
    queryKey: ['settings', 'effective-config'],
    queryFn: () => api.get<PlatformEffectiveConfig>('/settings/effective-config'),
    refetchInterval: 30_000,
  });
}

function useStore() {
  const client = useQueryClient();
  return async (settings: PlatformDeploymentSettings) => {
    client.setQueryData(SETTINGS_KEY, settings);
    // The trial length and the sign-up switch show up in the effective configuration once
    // the tenant API's leader publishes again.
    await client.invalidateQueries({ queryKey: ['settings', 'effective-config'] });
  };
}

export function usePatchSettings() {
  const store = useStore();
  return useMutation({
    mutationFn: (body: PlatformSettingsPatchRequest) =>
      api.patch<PlatformDeploymentSettings>('/settings', body),
    onSuccess: store,
  });
}

export function useSetMaintenance() {
  const store = useStore();
  return useMutation({
    mutationFn: (body: PlatformMaintenanceRequest) =>
      api.put<PlatformDeploymentSettings>('/settings/maintenance', body),
    onSuccess: store,
  });
}

// --- AI settings (tm 389.17 · FR-ADMIN-17/19) ------------------------------------------------

const AI_KEY = ['settings', 'ai'] as const;

/** Read every five seconds while a re-embedding runs, so its progress moves on the page. */
export function useAiSettings(): UseQueryResult<PlatformAiSettings> {
  return useQuery({
    queryKey: AI_KEY,
    queryFn: () => api.get<PlatformAiSettings>('/settings/ai'),
    refetchInterval: (query) => (query.state.data?.reembed.state === 'running' ? 5_000 : false),
  });
}

export function useSaveAiSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: PlatformAiSettingsRequest) =>
      api.put<PlatformAiSettings>('/settings/ai', body),
    onSuccess: async (settings) => {
      client.setQueryData(AI_KEY, settings);
      await client.invalidateQueries({ queryKey: ['settings', 'effective-config'] });
    },
  });
}

export function useTestAiConnection() {
  return useMutation({
    mutationFn: (body: PlatformAiConnectionTestRequest) =>
      api.post<PlatformAiConnectionTest>('/settings/ai/test-connection', body),
  });
}

export function useStartReembed() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { reason: string }) =>
      api.post<PlatformAiReembedStatus>('/settings/ai/reembed', body),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: AI_KEY });
    },
  });
}
