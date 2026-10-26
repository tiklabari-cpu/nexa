/**
 * The Operations surface (tm 389.14) for `fake-platform.ts`: a job table of three jobs, the
 * queues, the backlog figures, the partitions and the three mutations, with the server's gates
 * in miniature (who may run a job, that a purge wants a reason). The real rules have their own
 * suite (`platform-operations.test.ts`); here the question is what the SPA does with the answers.
 */
import { platformRoleHas, type PlatformRole } from '@siyahtus/types';

const NOW = '2026-10-25T10:00:00.000Z';

type Problem = (
  status: number,
  type: string,
  message?: string,
  details?: Record<string, unknown>,
) => Response;
type Json = (status: number, body: unknown) => Response;

export const OPERATIONS_SCHEDULER = {
  stale: false,
  generated_at: NOW,
  enabled: true,
  jobs: [
    {
      name: 'siem',
      interval_ms: 300_000,
      enabled: true,
      last_run_at: '2026-10-25T09:58:00.000Z',
      last_status: 'ok',
      last_duration_ms: 1_250,
      next_run_at: '2026-10-25T10:03:00.000Z',
      running: false,
      last_manual: null,
    },
    {
      name: 'sla',
      interval_ms: 60_000,
      enabled: true,
      last_run_at: '2026-10-25T09:59:00.000Z',
      last_status: 'error',
      last_error_class: 'PrismaClientKnownRequestError',
      last_duration_ms: 80,
      next_run_at: '2026-10-25T10:00:00.000Z',
      running: false,
      last_manual: {
        at: '2026-10-25T09:30:00.000Z',
        result: 'finished',
        status: 'ok',
        duration_ms: 42,
        error_class: null,
      },
    },
    {
      name: 'retention',
      interval_ms: 3_600_000,
      enabled: false,
      last_run_at: null,
      last_status: 'disabled',
      last_duration_ms: null,
      next_run_at: null,
      running: false,
      last_manual: null,
    },
  ],
};

export const OPERATIONS_JOBS = {
  generated_at: NOW,
  queues: [
    {
      key: 'ai_jobs',
      state: 'ok',
      counts: { pending: 2, done: 40 },
      oldest_unfinished_age_s: 95,
    },
    { key: 'knowledge_jobs', state: 'not_installed', counts: null, oldest_unfinished_age_s: null },
    { key: 'doc_worker', state: 'not_installed', counts: null, oldest_unfinished_age_s: null },
  ],
};

export const OPERATIONS_WEBHOOKS = {
  generated_at: NOW,
  window_hours: 24,
  pending: 4,
  overdue: 1,
  oldest_pending_age_s: 700,
  last_window: {
    delivered: 90,
    failed: 6,
    exhausted: 4,
    failure_rate: 0.1,
    workspaces_failing: 3,
  },
};

export const OPERATIONS_SIEM = {
  generated_at: NOW,
  provider: 'file',
  workspaces_enabled: 5,
  workspaces_stalled: 1,
  last_run_at: '2026-10-25T09:58:00.000Z',
  last_exported_at: '2026-10-25T09:57:00.000Z',
  exported_total: 12_345,
};

export const OPERATIONS_PARTITIONS = {
  generated_at: NOW,
  window: { behind: 1, ahead: 3 },
  partitions: [
    {
      name: 'events_2026_09',
      month: '2026-09',
      default: false,
      est_rows: 1200,
      size_bytes: 3_145_728,
    },
    {
      name: 'events_2026_10',
      month: '2026-10',
      default: false,
      est_rows: 800,
      size_bytes: 2_097_152,
    },
    { name: 'events_default', month: null, default: true, est_rows: 0, size_bytes: 8192 },
  ],
  missing_months: ['2026-11', '2026-12', '2027-01'],
  default_has_rows: false,
};

export const OPERATIONS_UNVERIFIED = {
  generated_at: NOW,
  ttl_hours: 168,
  total: 9,
  older_than_ttl: 4,
  oldest_age_s: 1_000_000,
};

export function handleOperations(
  method: string,
  path: string,
  body: unknown,
  role: PlatformRole,
  json: Json,
  problem: Problem,
): Response | null {
  if (!path.startsWith('/operations/')) return null;
  if (method === 'GET') {
    if (!platformRoleHas(role, 'operations.read')) return problem(403, 'authorization');
    switch (path) {
      case '/operations/scheduler':
        return json(200, OPERATIONS_SCHEDULER);
      case '/operations/jobs':
        return json(200, OPERATIONS_JOBS);
      case '/operations/webhooks':
        return json(200, OPERATIONS_WEBHOOKS);
      case '/operations/siem':
        return json(200, OPERATIONS_SIEM);
      case '/operations/partitions':
        return json(200, OPERATIONS_PARTITIONS);
      case '/operations/unverified-signups':
        return json(200, OPERATIONS_UNVERIFIED);
      case '/operations/components':
        return json(200, {
          generated_at: NOW,
          components: [
            { key: 'db', state: 'ok', detail: '3 ms', updated_at: NOW },
            { key: 'geoip', state: 'degraded', detail: 'DBIP · 120 days old', updated_at: NOW },
            { key: 'doc_worker', state: 'not_installed', detail: null, updated_at: NOW },
            { key: 'captcha', state: 'unknown', detail: null, updated_at: null },
          ],
        });
      default:
        return null;
    }
  }
  if (method !== 'POST') return null;

  const input = (body ?? {}) as { reason?: string };
  const needReason = (): Response | null =>
    !input.reason || input.reason.trim().length < 3
      ? problem(400, 'platform_reason_required')
      : null;

  const run = /^\/operations\/scheduler\/([a-z_]+)\/run$/.exec(path);
  if (run) {
    if (!platformRoleHas(role, 'operations.trigger')) return problem(403, 'authorization');
    const missing = needReason();
    if (missing) return missing;
    const name = run[1]!;
    if (!OPERATIONS_SCHEDULER.jobs.some((job) => job.name === name)) {
      return problem(404, 'not_found');
    }
    return json(200, {
      name,
      request_id: '6f1c1f2e-0d6a-4c53-9a43-1f1f0a9a1b2c',
      result: OPERATIONS_SCHEDULER.jobs.find((job) => job.name === name)!.enabled
        ? 'queued'
        : 'disabled',
    });
  }
  if (path === '/operations/partitions/ensure') {
    if (!platformRoleHas(role, 'operations.trigger')) return problem(403, 'authorization');
    const missing = needReason();
    if (missing) return missing;
    return json(200, {
      ensured: ['2026-09', '2026-10', '2026-11', '2026-12', '2027-01'].map((month) => ({
        month,
        name: `events_${month.replace('-', '_')}`,
      })),
      failed: [],
    });
  }
  if (path === '/operations/unverified-signups/purge') {
    if (!platformRoleHas(role, 'operations.run')) return problem(403, 'authorization');
    const missing = needReason();
    if (missing) return missing;
    return json(200, { purged: 3, batches: 1, ttl_hours: 168 });
  }
  return null;
}
