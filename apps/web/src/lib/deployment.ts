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
 * The app does not draw a screen before that answer is in (tm 259.4):
 * `DeploymentGate`, around the whole app in `main.tsx`, waits for the first
 * read and stops on "cannot reach the server" if it keeps failing. So under
 * the gate `useDeployment` always has the server's answer — and keeps it: a
 * later failed refetch leaves the last answer in place rather than flipping a
 * screen back.
 */
import { queryOptions, useQuery } from '@tanstack/react-query';
import type { DeploymentConfig } from '@siyahtus/types';
import { ApiClient } from './api-client.js';

export const DEPLOYMENT_QUERY_KEY = ['deployment'] as const;

/**
 * What `useDeployment` answers with no server answer cached — which, under
 * `DeploymentGate`, never happens. It is for a screen rendered on its own, as
 * a unit test does; the app itself does not fall back to it (fail-closed).
 */
export const DEPLOYMENT_FALLBACK: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  // No documents named: no terms box and no links (tm 257.9). The server
  // still refuses a sign-up without acceptance if it does name terms.
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};

/**
 * Anonymous on purpose, signed in or not: the route takes no credential, and
 * a fresh client per read picks up whatever `fetch` is current.
 */
export function fetchDeployment(client: ApiClient = new ApiClient()): Promise<DeploymentConfig> {
  return client.get<DeploymentConfig>('/deployment');
}

/**
 * The one definition of the read, shared by the gate and every screen.
 *
 * Three attempts, a second and then two apart, before the gate gives up: a
 * blip in the network should not cost an agent a "cannot reach the server"
 * screen, and a server that is really down should not leave them on
 * "Loading…" for long. Every error is retried, a 4xx included — the route
 * takes no input, so a 4xx here is a proxy or a rate limit, not a bad request.
 */
export const deploymentQuery = queryOptions({
  queryKey: DEPLOYMENT_QUERY_KEY,
  queryFn: () => fetchDeployment(),
  staleTime: 60_000,
  retry: 2,
  retryDelay: (failures) => 1_000 * 2 ** failures,
  // Attempted offline too: the default waits for the browser to say it is
  // back online, which would hold the gate on "Loading…" with no way out.
  networkMode: 'always',
});

export function useDeployment(): DeploymentConfig {
  return useQuery(deploymentQuery).data ?? DEPLOYMENT_FALLBACK;
}
