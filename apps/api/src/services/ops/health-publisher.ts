/**
 * The scheduler leader's 30-second health publication (tm 389.8 · FR-ADMIN-07).
 *
 * The platform process cannot ask the tenant API how it is — it shares no call
 * path with it (design.md §A) — so the tenant API says, on a timer, into Redis:
 * the detailed health body ({@link buildHealthSnapshot}) under
 * `siyahtus:ops:health` with a 90-second expiry, and the component statuses
 * the leader can judge for itself (mail, redis, db, scheduler) into the
 * component record. The expiry is the whole staleness story: when the leader
 * is gone nothing renews the key, and a missing key is what the dashboard
 * reads as "the tenant API is not reporting".
 *
 * "Leader" is the same Redis lock the sweeps use (`JobLock`, a 27 s key for a
 * 30 s interval): N API instances publish once between them, and when the
 * holder dies another takes over within one interval. It is deliberately not a
 * scheduler job — jobs are listed in the `/health` body and the interval
 * environment, and an admin-visible job list that changed shape would break
 * every monitor reading it.
 *
 * The same tick publishes the effective configuration (tm 389.13 ·
 * `effective-config.ts`) and re-writes maintenance mode for the realtime
 * gateway from the database (`OPS_MAINTENANCE_KEY`), so a Redis that lost the
 * root panel's write is right again within one interval.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { OPS_CONFIG_KEY, OPS_MAINTENANCE_KEY, type OpsComponentState } from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { lastMailSend } from '../mail/delivery.js';
import { JobLock, lockTtlMs, type LockRedis } from '../scheduler/lock.js';
import type { PublicSettings } from '../platform/public-settings.js';
import type { SchedulerDetail } from '../scheduler/types.js';
import { reportComponentNotInstalled, reportComponentStatus } from './component-status.js';
import {
  aiJobsProbe,
  COMPONENTS_NOT_IN_THIS_BUILD,
  webhooksProbe,
  type ComponentProbeResult,
} from './component-probes.js';
import {
  buildEffectiveConfig,
  OPS_CONFIG_TTL_S,
  type StoredEffectiveConfig,
} from './effective-config.js';
import {
  OPS_HEALTH_KEY,
  OPS_HEALTH_TTL_S,
  OPS_SCHEDULER_KEY,
  type StoredHealthSnapshot,
  type StoredSchedulerDetail,
} from './health-keys.js';
import {
  buildHealthSnapshot,
  probeDependencies,
  type BuildHealthSnapshotInput,
  type HealthSnapshotBody,
} from './health-snapshot.js';

export const OPS_HEALTH_INTERVAL_MS = 30_000;
export const OPS_HEALTH_LOCK = 'ops_health_snapshot';
/** A send that failed this recently makes the `mail` component `degraded`. */
export const MAIL_FAILURE_WINDOW_MS = 10 * 60_000;

type PublisherRedis = LockRedis & {
  ping(): Promise<unknown>;
  set(key: string, value: string, ex: 'EX', seconds: number): Promise<unknown>;
  set(key: string, value: string): Promise<unknown>;
  del(key: string): Promise<unknown>;
  hset(key: string, field: string, value: string): Promise<unknown>;
  hsetnx(key: string, field: string, value: string): Promise<unknown>;
};

export interface HealthSnapshotPublisherOptions {
  db: PrismaClient;
  redis: PublisherRedis;
  env: BuildHealthSnapshotInput['env'];
  version: string;
  scheduler: BuildHealthSnapshotInput['scheduler'];
  eventPartitions: BuildHealthSnapshotInput['eventPartitions'];
  logger: FastifyBaseLogger;
  /**
   * The effective configuration's inputs (tm 389.13): the whole parsed
   * environment and the root panel's settings. Omitted, neither the
   * configuration nor the maintenance key is written.
   */
  config?: { env: Env; settings: PublicSettings };
  /** The job table for the root panel's Operations page (tm 389.14); omitted, none is published. */
  schedulerDetail?: () => SchedulerDetail;
  /**
   * What this process knows about modules the leader does not judge itself —
   * the GeoIP file, the CAPTCHA provider (tm 389.14). Pure and synchronous: the
   * leader runs them every thirty seconds.
   */
  probes?: ReadonlyArray<() => ComponentProbeResult | null>;
  /** Whether this process publishes at all (`env.schedulerEnabled`). */
  enabled: boolean;
  now?: () => number;
}

export class HealthSnapshotPublisher {
  readonly #options: HealthSnapshotPublisherOptions;
  readonly #lock: JobLock;
  readonly #startedAt: number;
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<unknown> | null = null;
  #token: string | null = null;
  #stopped = false;

  constructor(options: HealthSnapshotPublisherOptions) {
    this.#options = options;
    this.#lock = new JobLock(options.redis);
    this.#startedAt = (options.now ?? Date.now)();
  }

  start(): void {
    if (!this.#options.enabled || this.#timer !== null || this.#stopped) return;
    // The first publication comes quickly, so a fresh deployment's dashboard
    // does not open on "not reporting" for half a minute.
    this.#schedule(2_000);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#inFlight?.catch(() => undefined);
    // Handed back so another instance publishes within its next tick instead
    // of after this process's 27 s key runs out.
    if (this.#token !== null) {
      const token = this.#token;
      this.#token = null;
      await this.#lock.release(OPS_HEALTH_LOCK, token).catch(() => undefined);
    }
  }

  /**
   * One publication, lock or no lock — what a tick does once it holds the
   * lock, and what a test calls. Returns what was written, or null when Redis
   * would not take it (logged, never thrown).
   */
  async publish(): Promise<StoredHealthSnapshot | null> {
    const { db, redis, logger } = this.#options;
    const now = (this.#options.now ?? Date.now)();
    try {
      const probes = await probeDependencies(db, redis);
      const health = await buildHealthSnapshot({
        db,
        env: this.#options.env,
        version: this.#options.version,
        uptimeS: Math.round((now - this.#startedAt) / 100) / 10,
        probes,
        scheduler: this.#options.scheduler,
        eventPartitions: this.#options.eventPartitions,
        logger,
      });
      const stored: StoredHealthSnapshot = { generated_at: new Date(now).toISOString(), health };
      await redis.set(OPS_HEALTH_KEY, JSON.stringify(stored), 'EX', OPS_HEALTH_TTL_S);
      if (this.#options.schedulerDetail) {
        const detail: StoredSchedulerDetail = {
          generated_at: stored.generated_at,
          scheduler: this.#options.schedulerDetail(),
        };
        await redis.set(OPS_SCHEDULER_KEY, JSON.stringify(detail), 'EX', OPS_HEALTH_TTL_S);
      }
      await this.#reportComponents(health, stored.generated_at, now);
      await this.#publishConfig(stored.generated_at);
      return stored;
    } catch (error) {
      logger.warn({ err: error }, 'health snapshot could not be published');
      return null;
    }
  }

  /** The effective configuration and the maintenance key — never a failed health publication. */
  async #publishConfig(generatedAt: string): Promise<void> {
    const { redis, logger, config } = this.#options;
    if (!config) return;
    try {
      const settings = await config.settings.refresh();
      const stored: StoredEffectiveConfig = {
        generated_at: generatedAt,
        entries: buildEffectiveConfig(config.env, settings),
      };
      await redis.set(OPS_CONFIG_KEY, JSON.stringify(stored), 'EX', OPS_CONFIG_TTL_S);
      // No expiry: maintenance mode outlives the leader that wrote it.
      if (settings.maintenance) {
        await redis.set(OPS_MAINTENANCE_KEY, JSON.stringify({ mode: settings.maintenance.mode }));
      } else {
        await redis.del(OPS_MAINTENANCE_KEY);
      }
    } catch (error) {
      logger.warn({ err: error }, 'effective configuration could not be published');
    }
  }

  async #reportComponents(
    health: HealthSnapshotBody,
    updatedAt: string,
    now: number,
  ): Promise<void> {
    const { redis, logger, env } = this.#options;
    const put = (
      key: Parameters<typeof reportComponentStatus>[1],
      state: OpsComponentState,
      detail: string | null,
    ) => reportComponentStatus(redis, key, { state, detail, updatedAt }, logger);

    const { database, redis: cache } = health.dependencies;
    await put('db', database.status === 'up' ? 'ok' : 'down', latency(database.latency_ms));
    await put('redis', cache.status === 'up' ? 'ok' : 'down', latency(cache.latency_ms));

    const failing = health.scheduler.jobs
      .filter((job) => job.enabled && job.last_status === 'error')
      .map((job) => job.name);
    await put(
      'scheduler',
      failing.length > 0 ? 'degraded' : 'ok',
      failing.length > 0
        ? `failing: ${failing.join(', ')}`
        : `${health.scheduler.jobs.filter((job) => job.enabled).length} jobs`,
    );

    if (env.MAIL_PROVIDER === 'null') {
      await put('mail', 'not_installed', 'MAIL_PROVIDER=null');
    } else {
      const last = lastMailSend();
      const failed = last !== null && last.failed && now - last.at < MAIL_FAILURE_WINDOW_MS;
      await put(
        'mail',
        failed ? 'degraded' : 'ok',
        failed ? `last send failed (${env.MAIL_PROVIDER})` : env.MAIL_PROVIDER,
      );
    }

    // The modules with a state of their own (tm 389.14). Each is judged from
    // what is already in hand, and none of them can stop the others.
    const results: Array<ComponentProbeResult | null> = [
      aiJobsProbe(health.ai_jobs),
      webhooksProbe(health.scheduler.jobs),
    ];
    for (const probe of this.#options.probes ?? []) {
      try {
        results.push(probe());
      } catch (error) {
        logger.debug({ err: error }, 'a component probe failed');
      }
    }
    for (const result of results) {
      if (result) await put(result.key, result.state, result.detail);
    }
    for (const missing of COMPONENTS_NOT_IN_THIS_BUILD) {
      await reportComponentNotInstalled(redis, missing.key, missing.detail, logger);
    }
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#inFlight = this.tick().finally(() => {
        this.#inFlight = null;
        this.#schedule(OPS_HEALTH_INTERVAL_MS);
      });
    }, delayMs);
    // Losing a publication costs a yellow badge, not correctness — it must
    // never be what keeps a process that is otherwise done alive.
    this.#timer.unref();
  }

  /**
   * One timer tick: take the leader lock and, holding it, publish. `skipped`
   * means another instance holds it this interval; public so a test can play
   * two instances against one Redis without waiting on timers.
   */
  async tick(): Promise<'published' | 'skipped' | 'failed'> {
    try {
      const token = await this.#lock.acquire(OPS_HEALTH_LOCK, lockTtlMs(OPS_HEALTH_INTERVAL_MS));
      if (token === null) return 'skipped';
      this.#token = token;
      return (await this.publish()) === null ? 'failed' : 'published';
    } catch (error) {
      this.#options.logger.warn({ err: error }, 'health snapshot tick failed');
      return 'failed';
    }
  }
}

function latency(ms: number | undefined): string | null {
  return ms === undefined ? null : `${ms} ms`;
}
