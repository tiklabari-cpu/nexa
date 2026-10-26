/**
 * The Settings page's reads and writes (tm 389.13 · FR-ADMIN-15/16). Every write answers with
 * the stored settings as they now read, written straight into the cache.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { api } from '../../lib/auth-store.js';
import type {
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
