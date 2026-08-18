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
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import type { Mailer } from '../services/mail/mailer.js';
import { buildSchedulerJobs } from '../services/scheduler/jobs.js';
import { Scheduler } from '../services/scheduler/scheduler.js';
import type { Telemetry } from '../telemetry/telemetry.js';

declare module 'fastify' {
  interface FastifyInstance {
    scheduler: Scheduler;
  }
}

export interface SchedulerPluginOptions {
  env: Env;
  mailer: Mailer;
  /** Omitted or null disables spans; the jobs still run and still log. */
  telemetry?: Telemetry | null;
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

  for (const job of buildSchedulerJobs({ db: app.db, env: options.env, mailer: options.mailer })) {
    scheduler.register(job);
  }

  app.decorate('scheduler', scheduler);
  // Safe to call unconditionally: `start()` itself is the enabled check.
  scheduler.start();

  app.addHook('onClose', async () => {
    await scheduler.stop();
  });
}

export default fp(schedulerPlugin, { name: 'scheduler', dependencies: ['database', 'redis'] });
