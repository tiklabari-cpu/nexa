/**
 * This deployment's settings, read before anyone signs in (tm 257.13 · ADR
 * docs/adr/pilot-public-readiness.md K-a).
 *
 * `GET /deployment` is anonymous, so the sign-in screen can already know it is
 * looking at the public pilot, and the answer sits under one query key — the
 * same cache before and after sign-in, read once a minute at most. Everything
 * that hides a surface in pilot mode reads it through `useDeployment`, which
 * is also the one seam a test mocks.
 *
 * While the answer is loading, or when the first read fails, this returns
 * the settings of an ordinary deployment: pilot mode off, sign-up open. That
 * only ever *shows* something — and the API refuses every hidden surface on
 * its own, so showing it costs a 403, never a hole. A later failed refetch
 * keeps the last answer instead of flipping a screen back.
 */
import { useQuery } from '@tanstack/react-query';
import type { DeploymentConfig } from '@siyahtus/types';
import { ApiClient } from './api-client.js';

export const DEPLOYMENT_QUERY_KEY = ['deployment'] as const;

/** What a screen assumes until the server has said otherwise. */
export const DEPLOYMENT_FALLBACK: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
};

/**
 * Anonymous on purpose, signed in or not: the route takes no credential, and
 * a fresh client per read picks up whatever `fetch` is current.
 */
export function fetchDeployment(client: ApiClient = new ApiClient()): Promise<DeploymentConfig> {
  return client.get<DeploymentConfig>('/deployment');
}

export function useDeployment(): DeploymentConfig {
  const query = useQuery({
    queryKey: DEPLOYMENT_QUERY_KEY,
    queryFn: () => fetchDeployment(),
    staleTime: 60_000,
  });
  return query.data ?? DEPLOYMENT_FALLBACK;
}
