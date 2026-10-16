/**
 * `app.aiJobs` — the durable AI job worker (tm 289.3 · ADR-11a · GV-02), one
 * per server.
 *
 * Built here, started by the code that owns the answer
 * (`app.aiJobs.start({ handler, notes })` — the customer routes, tm 289.5):
 * the rule bot, the AI Agent and the assignee's notice are put together
 * there, with the route's own services. Until then this costs nothing — no
 * poll, no doorbell connection.
 *
 * {@link AiJobDiscovery}: how the worker finds jobs besides the wake-up the
 * visitor's own request gives it. `shared` (the server's default) is the
 * fleet: a 500 ms poll and the `LISTEN ai_jobs` doorbell, so any process
 * answers any message — the one that wrote it may have died. `in_process`
 * drops both, and a server answers only what its own requests woke it for
 * (and whatever its claims happen to find then). The test fixture runs every
 * server so: a suite holding two servers open, one of them with a stubbed
 * model, is never answered by the other.
 *
 * Registered after `database`, so that — `onClose` hooks running in reverse
 * registration order — its drain runs while the pool is still open. The drain
 * is the worker's own bounded one (`AI_JOB_DRAIN_MS`, under the shutdown's
 * `CLOSE_TIMEOUT_MS`); during the shutdown's drain window before it
 * (`SHUTDOWN_DRAIN_MS`) the worker keeps answering like the rest of the
 * server. A job cut off is handed back to the queue for the next process, not
 * lost.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { AI_JOB_LEASE_MS, AI_JOB_POLL_MS, AiJobWorker } from '../services/ai/ai-job-worker.js';
import { listenConnectionString, pgWakeups } from '../services/ai/ai-job-wakeups.js';
import { AI_JOB_MAX_LEASE_MS } from '../services/ai/ai-jobs.js';

declare module 'fastify' {
  interface FastifyInstance {
    aiJobs: AiJobWorker;
  }
}

/**
 * How long a claim holds its job: longer than the slowest answer the AI step
 * can take — the knowledge search and the completion, each at its timeout —
 * so a live worker is not overtaken, and no shorter than `AI_JOB_LEASE_MS`.
 */
export function aiJobLeaseMs(env: Pick<Env, 'LLM_TIMEOUT_MS' | 'EMBEDDING_TIMEOUT_MS'>): number {
  return Math.min(
    AI_JOB_MAX_LEASE_MS,
    Math.max(AI_JOB_LEASE_MS, env.EMBEDDING_TIMEOUT_MS + env.LLM_TIMEOUT_MS + 30_000),
  );
}

/** How the worker finds jobs it was not woken for — see the file header. */
export type AiJobDiscovery = 'shared' | 'in_process';

async function aiJobsPlugin(
  app: FastifyInstance,
  options: { env: Env; discovery?: AiJobDiscovery },
): Promise<void> {
  const log = app.log.child({ component: 'ai-jobs' });
  const shared = (options.discovery ?? 'shared') === 'shared';
  const listenUrl = shared ? listenConnectionString(options.env.runtimeDatabaseUrl) : null;
  if (shared && listenUrl === null) {
    log.info({}, 'the database is reached through PgBouncer; ai jobs are found by polling alone');
  }
  const worker = new AiJobWorker({
    db: app.db,
    logger: log,
    wakeups: listenUrl === null ? null : pgWakeups({ connectionString: listenUrl, logger: log }),
    pollMs: shared ? AI_JOB_POLL_MS : null,
    leaseMs: aiJobLeaseMs(options.env),
  });
  app.decorate('aiJobs', worker);
  app.addHook('onClose', async () => {
    await worker.stop();
  });
}

export default fp(aiJobsPlugin, { name: 'ai-jobs', dependencies: ['database'] });
