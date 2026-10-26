/**
 * Wires the background sweeps into a running server (M-SCHED-b, and webhook
 * redelivery M-SCHED-e · §D113/K1).
 *
 * `Scheduler.start()` is itself the on/off switch — it reads `enabled` and,
 * off, only logs (`scheduler.ts`) — so this plugin registers unconditionally
 * rather than branching on `env.schedulerEnabled` itself. That keeps a test
 * server exactly as inert as it always was: `schedulerEnabled` defaults to
 * false under `NODE_ENV=test`, so `app.scheduler` exists (and `/health` can
 * report on it) but nothing is ever scheduled to run.
 *
 * Depends on `database` and `redis`: every job reads through `app.db`, and
 * the leader lock lives in `app.redis`.
 *
 * It also starts the health publisher (tm 389.8): the same switch, the same
 * lock mechanism, but not a job — see `services/ops/health-publisher.ts`.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import type { KnowledgeService } from '../services/ai/knowledge-service.js';
import type { MeteredLlm } from '../services/ai/metered-llm.js';
import type { Mailer } from '../services/mail/mailer.js';
import type { RealtimePublisher } from '../services/realtime/publisher.js';
import { HealthSnapshotPublisher } from '../services/ops/health-publisher.js';
import { buildSchedulerJobs } from '../services/scheduler/jobs.js';
import { Scheduler } from '../services/scheduler/scheduler.js';
import type { WorkspaceEventDispatcher } from '../services/webhooks/workspace-events.js';
import type { Telemetry } from '../telemetry/telemetry.js';
import { VERSION } from '../version.js';

declare module 'fastify' {
  interface FastifyInstance {
    scheduler: Scheduler;
    /** The leader's 30-second health publication into Redis (tm 389.8); tests call `publish()`. */
    opsHealth: HealthSnapshotPublisher;
  }
}

export interface SchedulerPluginOptions {
  env: Env;
  mailer: Mailer;
  /** Omitted or null disables spans; the jobs still run and still log. */
  telemetry?: Telemetry | null;
  /**
   * Fans a sweep-driven lifecycle event out to Zapier/Make subscriptions
   * (FR-MOD-09.4). Omitted, the sweeps close chats exactly as before and tell
   * nobody outside the building.
   */
  automations?: WorkspaceEventDispatcher;
  /** The server's knowledge service, so the freshness sweep embeds as requests do (tm 255.7). */
  knowledge?: KnowledgeService;
  /** The stalled-AI watchdog's push to the agent it routes to (tm 293.6). */
  publisher?: RealtimePublisher;
  /** The server's metered model, which titles the unresolved questions' clusters (tm 317.2). */
  llm?: MeteredLlm;
}

async function schedulerPlugin(
  app: FastifyInstance,
  options: SchedulerPluginOptions,
): Promise<void> {
  const scheduler = new Scheduler({
    enabled: options.env.schedulerEnabled,
    redis: app.redis,
    logger: app.log,
    telemetry: options.telemetry ?? null,
    jitterPct: options.env.SCHEDULE_JITTER_PCT,
  });

  for (const job of buildSchedulerJobs({
    db: app.db,
    readDb: app.dbRead,
    env: options.env,
    mailer: options.mailer,
    ...(options.automations ? { automations: options.automations } : {}),
    ...(options.knowledge ? { knowledge: options.knowledge } : {}),
    ...(options.publisher ? { publisher: options.publisher } : {}),
    ...(options.llm ? { llm: options.llm } : {}),
  })) {
    scheduler.register(job);
  }

  app.decorate('scheduler', scheduler);
  // Safe to call unconditionally: `start()` itself is the enabled check.
  scheduler.start();

  const opsHealth = new HealthSnapshotPublisher({
    db: app.db,
    redis: app.redis,
    env: options.env,
    version: VERSION,
    scheduler,
    eventPartitions: app.eventPartitions,
    logger: app.log,
    enabled: options.env.schedulerEnabled,
  });
  app.decorate('opsHealth', opsHealth);
  opsHealth.start();

  app.addHook('onClose', async () => {
    await opsHealth.stop();
    await scheduler.stop();
  });
}

export default fp(schedulerPlugin, { name: 'scheduler', dependencies: ['database', 'redis'] });
