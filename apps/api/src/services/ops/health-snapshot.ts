/**
 * The tenant API's detailed health body, as a value (tm 389.8 · FR-ADMIN-07).
 *
 * Until now this body was assembled inline in `routes/health.ts`, for an
 * admin-role caller of `GET /api/v1/health`. The root panel's dashboard wants
 * the same facts about the same process without holding a tenant token — and
 * the platform process is not the tenant API, it cannot ask its scheduler or
 * its event partitions anything. So the body is built here, by the one function
 * both the route and the scheduler leader's 30-second publisher call, and the
 * leader leaves the result in Redis (`siyahtus:ops:health`,
 * {@link HealthSnapshotPublisher}) for the platform to read.
 *
 * `probe` and the dependency vocabulary live here for the same reason: a body
 * with two builders is a body that drifts.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from '../../config/env.js';
import { type AiJobsHealth, readAiJobsHealth } from '../ai/ai-jobs.js';
import type { EventPartitionsSnapshot } from '../chat/event-partitions.js';
import type { SchedulerSnapshot } from '../scheduler/types.js';

export interface DependencyHealth {
  status: 'up' | 'down';
  latency_ms?: number;
  error?: string;
}

export const PROBE_TIMEOUT_MS = 2_000;

/** One dependency check, bounded — shared with the platform process (tm 389.3). */
export async function probe(
  name: string,
  check: () => Promise<unknown>,
): Promise<DependencyHealth> {
  const startedAt = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${name} probe timed out`)), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { status: 'up', latency_ms: Math.round((performance.now() - startedAt) * 100) / 100 };
  } catch (error) {
    return {
      status: 'down',
      latency_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      // Driver messages can carry connection strings — surface the class only.
      error: error instanceof Error ? error.name : 'unknown error',
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface DependencyProbes {
  database: DependencyHealth;
  redis: DependencyHealth;
  healthy: boolean;
}

/** Postgres and Redis, probed in parallel — what `/health/ready` and `/health` both ask. */
export async function probeDependencies(
  db: Pick<PrismaClient, '$queryRaw'>,
  redis: { ping(): Promise<unknown> },
): Promise<DependencyProbes> {
  const [database, redisProbe] = await Promise.all([
    probe('database', () => db.$queryRaw`SELECT 1`),
    probe('redis', () => redis.ping()),
  ]);
  return {
    database,
    redis: redisProbe,
    healthy: database.status === 'up' && redisProbe.status === 'up',
  };
}

/** The admin body of `GET /api/v1/health` (and the dashboard's snapshot). */
export interface HealthSnapshotBody {
  status: 'ok' | 'degraded';
  service: 'api';
  version: string;
  region: string;
  uptime_s: number;
  dependencies: { database: DependencyHealth; redis: DependencyHealth };
  scheduler: SchedulerSnapshot;
  event_partitions: EventPartitionsSnapshot;
  ai_jobs: AiJobsHealth | null;
  providers: Record<string, string>;
}

export interface BuildHealthSnapshotInput {
  db: Pick<PrismaClient, '$queryRaw'>;
  env: Pick<
    Env,
    | 'SIYAHTUS_REGION'
    | 'MAIL_PROVIDER'
    | 'PUSH_PROVIDER'
    | 'STORAGE_PROVIDER'
    | 'STRIPE_PROVIDER'
    | 'SIEM_PROVIDER'
    | 'LLM_PROVIDER'
    | 'VIRUS_SCANNER'
  >;
  version: string;
  uptimeS: number;
  /** Already probed by the caller, which also needs the status code from them. */
  probes: DependencyProbes;
  scheduler: { snapshot(): SchedulerSnapshot };
  eventPartitions: { snapshot(): EventPartitionsSnapshot };
  logger: Pick<FastifyBaseLogger, 'warn'>;
}

export async function buildHealthSnapshot(
  input: BuildHealthSnapshotInput,
): Promise<HealthSnapshotBody> {
  const { probes, env } = input;

  // The durable AI job queue across every workspace (tm 289.5 · GV-02): how
  // many replies are owed and how long the oldest has waited. Read only when
  // the database answered the probe. Body only — a queue that is behind does
  // not stop this process serving, and a reading that fails or times out is
  // `null`, not a 503.
  let aiJobs: AiJobsHealth | null = null;
  if (probes.database.status === 'up') {
    let timer: NodeJS.Timeout | undefined;
    aiJobs = await Promise.race([
      readAiJobsHealth(input.db),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), PROBE_TIMEOUT_MS);
      }),
    ])
      .catch((error: unknown) => {
        input.logger.warn({ err: error }, 'ai job queue could not be read for /health');
        return null;
      })
      .finally(() => clearTimeout(timer));
  }

  return {
    status: probes.healthy ? 'ok' : 'degraded',
    service: 'api',
    version: input.version,
    region: env.SIYAHTUS_REGION,
    uptime_s: input.uptimeS,
    dependencies: { database: probes.database, redis: probes.redis },
    // Whether the background sweeps are ticking in this process at all
    // (M-SCHED-b · §D113/K1) — the failure this replaces was silent: a
    // deployment with none of them running looked identical to one that had
    // just found nothing to do.
    scheduler: input.scheduler.snapshot(),
    // Whether the months ahead have their `events` partitions (tm 255.14 ·
    // §D187). Body only, never the status code — the process still serves,
    // and a restart fixes nothing.
    event_partitions: input.eventPartitions.snapshot(),
    ai_jobs: aiJobs,
    // Which implementation each mockable dependency currently runs (M-ENV-b ·
    // §D113/K3) — read straight off the validated env, so this can never drift
    // from what `server.ts` actually built the factories with.
    providers: {
      mail: env.MAIL_PROVIDER,
      push: env.PUSH_PROVIDER,
      storage: env.STORAGE_PROVIDER,
      payment: env.STRIPE_PROVIDER,
      siem: env.SIEM_PROVIDER,
      llm: env.LLM_PROVIDER,
      virus_scanner: env.VIRUS_SCANNER,
    },
  };
}
