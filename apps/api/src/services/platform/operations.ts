/**
 * The root panel's Operations page (tm 389.14 · FR-ADMIN-20 · design.md §C
 * operations): the scheduler's jobs, webhook backlog, SIEM export, `events`
 * partitions, expired unverified sign-ups, the job queues and the component
 * record — read from the platform process, which has Postgres (as
 * `siyahtus_platform`, past row-level security) and Redis and nothing else.
 *
 * Counts, ages and states only. A workspace's name, a message, a webhook
 * payload or a queue row's content never leaves these queries (design.md §E,
 * requirements §1): every statement here is an aggregate.
 *
 * What lives in the tenant API's memory — the scheduler's job table — arrives
 * by Redis (`siyahtus:ops:scheduler`, published by the health leader with a
 * 90-second expiry), and a command goes the other way on
 * `siyahtus:platform:ops:jobs` (`services/ops/ops-channel.ts`). Both are
 * best-effort in the same sense as the dashboard's health view: Redis down or a
 * missing publication answers `stale`, never an error, because this is the
 * page an operator opens when something is wrong.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { PLATFORM_JOB_CHANNEL, PLATFORM_JOB_RUN } from '@siyahtus/types';
import type { Redis } from 'ioredis';
import { ApiError } from '../../lib/api-error.js';
import {
  PARTITION_MONTHS_AHEAD,
  PARTITION_MONTHS_BEHIND,
  monthKey,
  windowMonths,
} from '../chat/event-partitions.js';
import {
  emptyComponentStatuses,
  readComponentStatuses,
  type ComponentStatus,
} from '../ops/component-status.js';
import {
  OPS_JOB_RUNS_KEY,
  OPS_SCHEDULER_KEY,
  type StoredJobRun,
  type StoredSchedulerDetail,
} from '../ops/health-keys.js';
import { JOB_NAME_PATTERN } from '../ops/ops-channel.js';
import { runningKey } from '../scheduler/lock.js';
import type { JobDetail } from '../scheduler/types.js';

/** The job table is stale once its publication is older than the key's own expiry. */
export const SCHEDULER_STALE_AFTER_S = 90;
/** A panel purge never touches a sign-up younger than this, whatever the environment says. */
export const UNVERIFIED_PURGE_MIN_HOURS = 7 * 24;
/** Accounts per call to `purge_unverified_signups`, and calls per request. */
export const UNVERIFIED_PURGE_BATCH = 50;
export const UNVERIFIED_PURGE_MAX_BATCHES = 20;
/** A pending webhook delivery this far past its due time is stuck, not queued. */
export const WEBHOOK_OVERDUE_AFTER_MIN = 10;
export const WEBHOOK_WINDOW_HOURS = 24;
/** A SIEM-enabled workspace that has not delivered for this long is stalled. */
export const SIEM_STALLED_AFTER_HOURS = 24;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type RunRequestResult = 'queued' | 'already_running' | 'disabled' | 'no_listener';

export interface SchedulerJobView extends JobDetail {
  /** A pass is executing right now, on some instance. */
  running: boolean;
  /** The outcome of the last "run now" on this job, wherever it ran. */
  last_manual: {
    at: string;
    result: StoredJobRun['result'];
    status: StoredJobRun['status'];
    duration_ms: number | null;
    error_class: string | null;
  } | null;
}

export interface SchedulerView {
  /** No publication, or one older than {@link SCHEDULER_STALE_AFTER_S}. */
  stale: boolean;
  generated_at: string | null;
  /** Whether the publishing process runs its jobs (`SCHEDULER_ENABLED`); null with no publication. */
  enabled: boolean | null;
  jobs: SchedulerJobView[];
}

export interface WebhookBacklog {
  generated_at: string;
  window_hours: number;
  /** Deliveries owed a retry right now, all workspaces. */
  pending: number;
  /** Of those, due more than {@link WEBHOOK_OVERDUE_AFTER_MIN} minutes ago. */
  overdue: number;
  oldest_pending_age_s: number | null;
  last_window: {
    delivered: number;
    failed: number;
    exhausted: number;
    /** (failed + exhausted) / (delivered + failed + exhausted); null with no terminal delivery. */
    failure_rate: number | null;
    workspaces_failing: number;
  };
}

export interface SiemStatus {
  generated_at: string;
  provider: string;
  workspaces_enabled: number;
  /** Enabled and either never delivered or silent for {@link SIEM_STALLED_AFTER_HOURS} hours. */
  workspaces_stalled: number;
  last_run_at: string | null;
  last_exported_at: string | null;
  exported_total: number;
}

export interface PartitionRow {
  name: string;
  /** `YYYY-MM`, or null for the catch-all. */
  month: string | null;
  default: boolean;
  est_rows: number;
  size_bytes: number;
}

export interface PartitionsView {
  generated_at: string;
  window: { behind: number; ahead: number };
  partitions: PartitionRow[];
  /** Months of the window with no partition. */
  missing_months: string[];
  /** Whether `events_default` holds rows — a month it covers can no longer be opened. */
  default_has_rows: boolean | null;
}

export interface EnsurePartitionsResult {
  ensured: Array<{ month: string; name: string }>;
  failed: Array<{ month: string; error_code: string }>;
}

export interface UnverifiedSignups {
  generated_at: string;
  /** The age a sign-up must exceed to be purged. */
  ttl_hours: number;
  total: number;
  older_than_ttl: number;
  oldest_age_s: number | null;
}

export interface QueueView {
  key: 'ai_jobs' | 'knowledge_jobs' | 'doc_worker';
  /** `not_installed`: the table (or the module) is not part of this deployment. */
  state: 'ok' | 'not_installed' | 'unreadable';
  counts: Record<string, number> | null;
  oldest_unfinished_age_s: number | null;
}

export interface JobsView {
  generated_at: string;
  queues: QueueView[];
}

/** The queues, and the table behind each — `null`: no table, the worker reports for itself. */
const QUEUES: ReadonlyArray<{ key: QueueView['key']; table: string | null }> = [
  { key: 'ai_jobs', table: 'ai_jobs' },
  { key: 'knowledge_jobs', table: 'knowledge_jobs' },
  { key: 'doc_worker', table: null },
];

export interface PlatformOperationsOptions {
  now: () => number;
  /** `env.UNVERIFIED_SIGNUP_TTL_HOURS`; a panel purge never goes below the floor. */
  unverifiedTtlHours: number;
  siemProvider: string;
}

type OperationsRedis = Pick<Redis, 'get' | 'hgetall' | 'exists' | 'publish' | 'mget'>;

export class PlatformOperations {
  readonly #db: PrismaClient;
  readonly #redis: OperationsRedis;
  readonly #options: PlatformOperationsOptions;

  constructor(db: PrismaClient, redis: OperationsRedis, options: PlatformOperationsOptions) {
    this.#db = db;
    this.#redis = redis;
    this.#options = options;
  }

  // --- Scheduler ----------------------------------------------------------

  async #readSchedulerDetail(): Promise<StoredSchedulerDetail | null> {
    const raw = await this.#redis.get(OPS_SCHEDULER_KEY).catch(() => null);
    if (raw === null) return null;
    try {
      const value = JSON.parse(raw) as Partial<StoredSchedulerDetail>;
      if (typeof value.generated_at !== 'string' || Number.isNaN(Date.parse(value.generated_at))) {
        return null;
      }
      if (!Array.isArray(value.scheduler?.jobs)) return null;
      return value as StoredSchedulerDetail;
    } catch {
      return null;
    }
  }

  async scheduler(): Promise<SchedulerView> {
    const [stored, runs] = await Promise.all([
      this.#readSchedulerDetail(),
      this.#redis.hgetall(OPS_JOB_RUNS_KEY).catch(() => ({}) as Record<string, string>),
    ]);
    if (stored === null) return { stale: true, generated_at: null, enabled: null, jobs: [] };

    const names = stored.scheduler.jobs.map((job) => job.name);
    const running = await Promise.all(
      names.map((name) =>
        this.#redis
          .exists(runningKey(name))
          .then((count) => count > 0)
          .catch(() => false),
      ),
    );
    const ageS = (this.#options.now() - Date.parse(stored.generated_at)) / 1000;
    return {
      stale: ageS > SCHEDULER_STALE_AFTER_S,
      generated_at: stored.generated_at,
      enabled: stored.scheduler.enabled,
      jobs: stored.scheduler.jobs.map((job, index) => ({
        ...job,
        running: running[index] ?? false,
        last_manual: lastManualOf(runs[job.name]),
      })),
    };
  }

  /**
   * Ask the tenant processes to run `name` now. Answers what the platform can
   * know without them: the job is unknown (404), switched off, already
   * executing (the running marker), or nobody is subscribed to hear the
   * request. `queued` means a process heard it — the outcome follows in the job
   * table (`last_manual`), because the platform does not wait on a sweep.
   */
  async requestRun(name: string): Promise<{ request_id: string; result: RunRequestResult }> {
    if (!JOB_NAME_PATTERN.test(name)) throw ApiError.notFound('Job not found.');
    const requestId = randomUUID();

    const stored = await this.#readSchedulerDetail();
    const job = stored?.scheduler.jobs.find((row) => row.name === name);
    if (stored !== null && !job) throw ApiError.notFound('Job not found.');
    if (job && !job.enabled) return { request_id: requestId, result: 'disabled' };

    if ((await this.#redis.exists(runningKey(name))) > 0) {
      return { request_id: requestId, result: 'already_running' };
    }

    const listeners = await this.#redis.publish(
      PLATFORM_JOB_CHANNEL,
      JSON.stringify({ type: PLATFORM_JOB_RUN, name, request_id: requestId }),
    );
    return { request_id: requestId, result: listeners > 0 ? 'queued' : 'no_listener' };
  }

  // --- Webhooks -----------------------------------------------------------

  async webhooks(): Promise<WebhookBacklog> {
    const now = new Date(this.#options.now());
    const [row] = await this.#db.$queryRaw<
      Array<{
        pending: number;
        overdue: number;
        oldest_pending_s: number | null;
        delivered: number;
        failed: number;
        exhausted: number;
        failing: number;
      }>
    >`
      SELECT
        count(*) FILTER (WHERE state = 'pending')::int AS pending,
        count(*) FILTER (WHERE state = 'pending'
          AND next_attempt_at < ${now}::timestamptz - make_interval(mins => ${WEBHOOK_OVERDUE_AFTER_MIN}::int))::int AS overdue,
        extract(epoch FROM (${now}::timestamptz - min(created_at) FILTER (WHERE state = 'pending')))::float8 AS oldest_pending_s,
        count(*) FILTER (WHERE state = 'delivered' AND created_at >= ${now}::timestamptz - make_interval(hours => ${WEBHOOK_WINDOW_HOURS}::int))::int AS delivered,
        count(*) FILTER (WHERE state = 'failed' AND created_at >= ${now}::timestamptz - make_interval(hours => ${WEBHOOK_WINDOW_HOURS}::int))::int AS failed,
        count(*) FILTER (WHERE state = 'exhausted' AND created_at >= ${now}::timestamptz - make_interval(hours => ${WEBHOOK_WINDOW_HOURS}::int))::int AS exhausted,
        count(DISTINCT license_id) FILTER (WHERE state IN ('failed', 'exhausted')
          AND created_at >= ${now}::timestamptz - make_interval(hours => ${WEBHOOK_WINDOW_HOURS}::int))::int AS failing
      FROM webhook_deliveries`;
    const terminal = (row?.delivered ?? 0) + (row?.failed ?? 0) + (row?.exhausted ?? 0);
    const bad = (row?.failed ?? 0) + (row?.exhausted ?? 0);
    return {
      generated_at: now.toISOString(),
      window_hours: WEBHOOK_WINDOW_HOURS,
      pending: row?.pending ?? 0,
      overdue: row?.overdue ?? 0,
      oldest_pending_age_s:
        row?.oldest_pending_s == null
          ? null
          : Math.max(0, Math.round(row.oldest_pending_s * 10) / 10),
      last_window: {
        delivered: row?.delivered ?? 0,
        failed: row?.failed ?? 0,
        exhausted: row?.exhausted ?? 0,
        failure_rate: terminal === 0 ? null : Math.round((bad / terminal) * 10_000) / 10_000,
        workspaces_failing: row?.failing ?? 0,
      },
    };
  }

  // --- SIEM ---------------------------------------------------------------

  async siem(): Promise<SiemStatus> {
    const now = new Date(this.#options.now());
    const [row] = await this.#db.$queryRaw<
      Array<{
        enabled: number;
        stalled: number;
        last_run_at: Date | null;
        last_exported_at: Date | null;
        exported_total: bigint | null;
      }>
    >`
      SELECT
        count(*) FILTER (WHERE enabled)::int AS enabled,
        count(*) FILTER (WHERE enabled AND (last_run_at IS NULL
          OR last_run_at < ${now}::timestamptz - make_interval(hours => ${SIEM_STALLED_AFTER_HOURS}::int)))::int AS stalled,
        max(last_run_at) AS last_run_at,
        max(last_exported_at) AS last_exported_at,
        sum(exported_count)::bigint AS exported_total
      FROM siem_export_cursors`;
    return {
      generated_at: now.toISOString(),
      provider: this.#options.siemProvider,
      workspaces_enabled: row?.enabled ?? 0,
      workspaces_stalled: row?.stalled ?? 0,
      last_run_at: row?.last_run_at ? row.last_run_at.toISOString() : null,
      last_exported_at: row?.last_exported_at ? row.last_exported_at.toISOString() : null,
      exported_total: Number(row?.exported_total ?? 0),
    };
  }

  // --- Partitions ---------------------------------------------------------

  async partitions(): Promise<PartitionsView> {
    const now = new Date(this.#options.now());
    const rows = await this.#db.$queryRaw<
      Array<{ name: string; est_rows: bigint; size_bytes: bigint }>
    >`
      SELECT c.relname AS name, greatest(c.reltuples, 0)::bigint AS est_rows,
             pg_total_relation_size(c.oid)::bigint AS size_bytes
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_namespace n ON n.oid = p.relnamespace
       WHERE n.nspname = 'public' AND p.relname = 'events'
       ORDER BY c.relname`;
    const partitions: PartitionRow[] = rows.map((row) => {
      const match = /^events_(\d{4})_(\d{2})$/.exec(row.name);
      return {
        name: row.name,
        month: match ? `${match[1]}-${match[2]}` : null,
        default: row.name === 'events_default',
        est_rows: Number(row.est_rows),
        size_bytes: Number(row.size_bytes),
      };
    });

    const have = new Set(partitions.map((row) => row.month).filter((m) => m !== null));
    const missing = windowMonths(now, PARTITION_MONTHS_BEHIND, PARTITION_MONTHS_AHEAD)
      .map(monthKey)
      .filter((month) => !have.has(month));

    // An exact existence check, not the estimate: the default partition is
    // meant to be empty, and a single row in it blocks a month.
    const defaultHasRows = await this.#db.$queryRaw<
      Array<{ has: boolean }>
    >`SELECT EXISTS (SELECT 1 FROM events_default) AS has`
      .then((result) => result[0]?.has ?? null)
      .catch(() => null);

    return {
      generated_at: now.toISOString(),
      window: { behind: PARTITION_MONTHS_BEHIND, ahead: PARTITION_MONTHS_AHEAD },
      partitions,
      missing_months: missing,
      default_has_rows: defaultHasRows,
    };
  }

  /**
   * Open `month` (`YYYY-MM`), or — omitted — every month of the runtime
   * window. One statement per month, so one blocked month does not cost the
   * others (the same reasoning as `EventPartitionMaintenance`); a failure is
   * reported by its SQLSTATE, never by the database's message.
   */
  async ensurePartitions(month?: string): Promise<EnsurePartitionsResult> {
    let months: Date[];
    if (month !== undefined) {
      const match = MONTH_PATTERN.exec(month);
      if (!match) throw ApiError.validation('`month` must be YYYY-MM.');
      months = [new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1))];
    } else {
      months = windowMonths(
        new Date(this.#options.now()),
        PARTITION_MONTHS_BEHIND,
        PARTITION_MONTHS_AHEAD,
      );
    }

    const result: EnsurePartitionsResult = { ensured: [], failed: [] };
    for (const start of months) {
      try {
        const [row] = await this.#db.$queryRaw<Array<{ name: string }>>`
          SELECT events_ensure_partition(${start}::timestamptz) AS name`;
        result.ensured.push({ month: monthKey(start), name: row?.name ?? '' });
      } catch (error) {
        result.failed.push({ month: monthKey(start), error_code: sqlStateOf(error) });
      }
    }
    return result;
  }

  // --- Unverified sign-ups -------------------------------------------------

  /** The age a panel purge requires: the environment's TTL, never under the floor. */
  get purgeTtlHours(): number {
    return Math.max(this.#options.unverifiedTtlHours, UNVERIFIED_PURGE_MIN_HOURS);
  }

  async unverifiedSignups(): Promise<UnverifiedSignups> {
    const now = new Date(this.#options.now());
    const ttl = this.purgeTtlHours;
    const [row] = await this.#db.$queryRaw<
      Array<{ total: number; expired: number; oldest_s: number | null }>
    >`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE created_at < ${now}::timestamptz - make_interval(hours => ${ttl}::int))::int AS expired,
             extract(epoch FROM (${now}::timestamptz - min(created_at)))::float8 AS oldest_s
        FROM accounts
       WHERE email_verified_at IS NULL`;
    return {
      generated_at: now.toISOString(),
      ttl_hours: ttl,
      total: row?.total ?? 0,
      older_than_ttl: row?.expired ?? 0,
      oldest_age_s: row?.oldest_s == null ? null : Math.max(0, Math.round(row.oldest_s)),
    };
  }

  /**
   * Run `purge_unverified_signups` — the function the scheduler's job calls,
   * with its own locking and its own idea of what may go — in the same bounded
   * batches. Returns how many accounts it deleted.
   */
  async purgeUnverifiedSignups(): Promise<{ purged: number; batches: number; ttl_hours: number }> {
    const ttl = this.purgeTtlHours;
    let purged = 0;
    let batches = 0;
    while (batches < UNVERIFIED_PURGE_MAX_BATCHES) {
      const [row] = await this.#db.$queryRaw<Array<{ purged: number }>>`
        SELECT purge_unverified_signups(
                 make_interval(hours => ${ttl}::int),
                 ${UNVERIFIED_PURGE_BATCH}::int
               ) AS purged`;
      batches += 1;
      const count = row?.purged ?? 0;
      purged += count;
      if (count < UNVERIFIED_PURGE_BATCH) break;
    }
    return { purged, batches, ttl_hours: ttl };
  }

  // --- Queues and components ----------------------------------------------

  async jobs(): Promise<JobsView> {
    const queues: QueueView[] = [];
    for (const { key, table } of QUEUES) {
      queues.push(await this.#queue(key, table));
    }
    return { generated_at: new Date(this.#options.now()).toISOString(), queues };
  }

  async #queue(key: QueueView['key'], table: string | null): Promise<QueueView> {
    const notInstalled: QueueView = {
      key,
      state: 'not_installed',
      counts: null,
      oldest_unfinished_age_s: null,
    };
    if (table === null) return notInstalled;
    // The table is looked up first, so a queue that does not exist yet costs a
    // catalogue read and never a failed statement.
    const [exists] = await this.#db.$queryRaw<Array<{ present: boolean }>>`
      SELECT to_regclass(${`public.${table}`}) IS NOT NULL AS present`;
    if (!exists?.present) return notInstalled;
    try {
      // `table` is one of the constants above, never request input.
      const rows = await this.#db.$queryRawUnsafe<
        Array<{ state: string; n: number; oldest_s: number | null }>
      >(
        `SELECT state, count(*)::int AS n,
                extract(epoch FROM (now() - min(created_at)))::float8 AS oldest_s
           FROM "${table}" GROUP BY state`,
      );
      const counts: Record<string, number> = {};
      let oldest: number | null = null;
      for (const row of rows) {
        counts[row.state] = row.n;
        if (['pending', 'running'].includes(row.state) && row.oldest_s !== null) {
          oldest = Math.max(oldest ?? 0, row.oldest_s);
        }
      }
      return {
        key,
        state: 'ok',
        counts,
        oldest_unfinished_age_s: oldest === null ? null : Math.round(oldest * 10) / 10,
      };
    } catch {
      return { key, state: 'unreadable', counts: null, oldest_unfinished_age_s: null };
    }
  }

  async components(): Promise<{ generated_at: string; components: ComponentStatus[] }> {
    const components = await readComponentStatuses(this.#redis).catch(() =>
      emptyComponentStatuses(),
    );
    return { generated_at: new Date(this.#options.now()).toISOString(), components };
  }
}

function lastManualOf(raw: string | undefined): SchedulerJobView['last_manual'] {
  if (raw === undefined) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredJobRun>;
    if (typeof value.at !== 'string' || typeof value.result !== 'string') return null;
    return {
      at: value.at,
      result: value.result,
      status: value.status ?? null,
      duration_ms: typeof value.duration_ms === 'number' ? value.duration_ms : null,
      error_class: typeof value.error_class === 'string' ? value.error_class : null,
    };
  } catch {
    return null;
  }
}

/** The SQLSTATE a failed call carries — Prisma reports a raw query's as `meta.code`. */
function sqlStateOf(error: unknown): string {
  const meta = (error as { meta?: { code?: unknown } } | null)?.meta;
  if (typeof meta?.code === 'string') return meta.code;
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}
