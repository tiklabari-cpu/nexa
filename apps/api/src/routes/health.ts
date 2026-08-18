/**
 * GET /api/v1/health — readiness probe.
 *
 * Actually touches each dependency instead of reporting a cached flag: an
 * endpoint that returns 200 while Postgres is unreachable is worse than no
 * endpoint at all. Returns 503 when any dependency is down so orchestrators
 * take the instance out of rotation.
 */
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.js';

interface DependencyHealth {
  status: 'up' | 'down';
  latency_ms?: number;
  error?: string;
}

const PROBE_TIMEOUT_MS = 2_000;

async function probe(name: string, check: () => Promise<unknown>): Promise<DependencyHealth> {
  const startedAt = performance.now();
  try {
    await Promise.race([
      check(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${name} probe timed out`)), PROBE_TIMEOUT_MS),
      ),
    ]);
    return { status: 'up', latency_ms: Math.round((performance.now() - startedAt) * 100) / 100 };
  } catch (error) {
    return {
      status: 'down',
      latency_ms: Math.round((performance.now() - startedAt) * 100) / 100,
      // Driver messages can carry connection strings — surface the class only.
      error: error instanceof Error ? error.name : 'unknown error',
    };
  }
}

export default async function healthRoutes(
  app: FastifyInstance,
  options: { env: Env; version: string },
): Promise<void> {
  const startedAt = Date.now();

  // Monitors poll this continuously; rate limiting it would take the probe down
  // before it took the service down.
  app.get('/health', { config: { public: true, skipRateLimit: true } }, async (_request, reply) => {
    const [database, redis] = await Promise.all([
      probe('database', () => app.db.$queryRaw`SELECT 1`),
      probe('redis', () => app.redis.ping()),
    ]);

    const healthy = database.status === 'up' && redis.status === 'up';
    return reply.status(healthy ? 200 : 503).send({
      status: healthy ? 'ok' : 'degraded',
      service: 'api',
      version: options.version,
      region: options.env.NEXA_REGION,
      uptime_s: Math.round((Date.now() - startedAt) / 100) / 10,
      dependencies: { database, redis },
      // Whether the five background sweeps are ticking in this process at all
      // (M-SCHED-b · §D113/K1) — the failure this replaces was silent: a
      // deployment with none of them running looked identical to one that had
      // just found nothing to do.
      scheduler: app.scheduler.snapshot(),
      // Which implementation each mockable dependency currently runs (M-ENV-b ·
      // §D113/K3) — read straight off the validated env, so this can never drift
      // from what `server.ts` actually built the factories with.
      providers: {
        mail: options.env.MAIL_PROVIDER,
        push: options.env.PUSH_PROVIDER,
        storage: options.env.STORAGE_PROVIDER,
        payment: options.env.STRIPE_PROVIDER,
        siem: options.env.SIEM_PROVIDER,
        llm: options.env.LLM_PROVIDER,
        virus_scanner: options.env.VIRUS_SCANNER,
      },
    });
  });
}
