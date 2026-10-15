/**
 * What `GET /ai/usage` answers with (tm 283.3), and the one place the web reads
 * it from — Settings › Usage and quotas › AI usage (`AiUsage.tsx`) and the AI
 * performance tab's cost card (`AiPerformance.tsx`) share the query key, so
 * opening one after the other costs a single request.
 *
 * Numbers only: the endpoint carries no conversation, prompt or reply text, and
 * neither does anything built on it. Money is an estimate and appears only when
 * the operator configured prices — a missing `cost_usd` is "not priced", never
 * zero.
 */
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useApiClient } from '../../lib/auth-store.js';
import type { AiUsageAlertThreshold, AiUsageMeter, AiUsageSurface } from '@siyahtus/types';

export interface AiUsageMeterToday {
  meter: AiUsageMeter;
  used: number;
  reserved: number;
  cap: number;
  /** `used` as a share of `cap`, in percent, to one decimal. May pass 100. */
  percent: number;
  cost_usd?: number;
}

export interface AiUsageDay {
  /** `yyyy-mm-dd`, UTC. */
  day: string;
  llm: number;
  embedding: number;
  llm_test: number;
  embedding_test: number;
}

export interface AiUsageSurfaceRow {
  surface: AiUsageSurface;
  meter: AiUsageMeter;
  input_tokens: number;
  output_tokens: number;
  cost_usd?: number;
}

export interface AiUsageAlertRow {
  meter: AiUsageMeter;
  threshold: AiUsageAlertThreshold;
  used: number;
  cap: number;
  created_at: string;
}

export interface AiUsage {
  /** Today, `yyyy-mm-dd` UTC. */
  day: string;
  /** The next 00:00 UTC — when the allowance renews. */
  resets_at: string;
  window_days: number;
  time_zone: 'UTC';
  meters: AiUsageMeterToday[];
  daily: AiUsageDay[];
  surfaces: AiUsageSurfaceRow[];
  pricing?: {
    currency: 'USD';
    estimated: true;
    llm_input_usd_per_mtok?: number;
    llm_output_usd_per_mtok?: number;
    embedding_usd_per_mtok?: number;
  };
  alerts: AiUsageAlertRow[];
  alert_recipients: string[];
}

/** The roles the endpoint answers (`minimumRole: admin`); an agent gets 403. */
const VIEWER_ROLES = new Set(['admin', 'viceowner', 'owner']);

export function canViewAiUsage(role: string | null | undefined): boolean {
  return role != null && VIEWER_ROLES.has(role);
}

export const AI_USAGE_QUERY_KEY = ['ai', 'usage'] as const;

export function useAiUsage(enabled: boolean): UseQueryResult<AiUsage> {
  const api = useApiClient();
  return useQuery({
    queryKey: AI_USAGE_QUERY_KEY,
    queryFn: () => api.get<AiUsage>('/ai/usage'),
    enabled,
  });
}
