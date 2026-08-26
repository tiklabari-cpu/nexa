/**
 * GET /api/v1/health — readiness probe.
 *
 * Actually touches each dependency instead of reporting a cached flag: an
 * endpoint that returns 200 while Postgres is unreachable is worse than no
 * endpoint at all. Returns 503 when any dependency is down so orchestrators
 * take the instance out of rotation.
 *
 * The detailed body (M-SEC-b2 · §D116 MEDIUM (b)) — version, region,
 * dependency latencies, scheduler status, which mock each provider runs — is
 * infrastructure fingerprinting an anonymous caller has no business reading.
 * An admin-role caller still gets all of it, unchanged; anyone else gets only
 * `status` + `service`. This narrows the BODY only — the status code still
 * reflects real dependency health either way, so an orchestrator watching for
 * 200/503 (never reading the body) keeps working exactly as before.
 */
import type { FastifyInstance } from 'fastify';
import { roleAtLeast } from '@nexa/types';
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

  // Monitors poll this continuously — `healthRateLimit` (rate-limit.ts) gives
  // it its own generous per-IP ceiling instead of `skipRateLimit`, so it stays
  // bounded without a tight probe interval tripping it.
  app.get(
    '/health',
    { config: { public: true, healthRateLimit: true } },
    async (request, reply) => {
      const [database, redis] = await Promise.all([
        probe('database', () => app.db.$queryRaw`SELECT 1`),
        probe('redis', () => app.redis.ping()),
      ]);

      const healthy = database.status === 'up' && redis.status === 'up';
      const status = healthy ? 'ok' : 'degraded';

      // `public: true` still resolves a presented bearer token (plugins/auth.ts)
      // — a customer/SCIM credential never reaches this handler at all (turned
      // away 404 upstream by the default agent/bot principal gate), so a
      // populated principal here is always an agent or a bot. Bots hold no
      // membership role, hence the explicit `kind === 'agent'`.
      const principal = request.principal;
      const isAdmin = principal?.kind === 'agent' && roleAtLeast(principal.role, 'admin');
      if (!isAdmin) {
        return reply.status(healthy ? 200 : 503).send({ status, service: 'api' });
      }

      return reply.status(healthy ? 200 : 503).send({
        status,
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
    },
  );
}
