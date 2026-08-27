/**
 * GET /api/v1/health/live, /health/ready, /health (M-OPS-a).
 *
 * Split three ways because "is the process up" and "can it actually serve
 * traffic" are different questions with different consequences when answered
 * wrong:
 *
 * - `/health/live` touches no dependency at all and always answers 200 while
 *   the process is up. This is what an orchestrator's LIVENESS probe must
 *   point at — a process that reports unhealthy because Postgres is down
 *   gets killed for a problem restarting it cannot fix, and the replacement
 *   process is no better off.
 * - `/health/ready` runs the real dependency probes below and returns 503
 *   when either is down, taking the instance out of rotation. This is the
 *   READINESS probe. It always answers the narrow `{status, service}` body —
 *   an orchestrator probe never carries a bearer token, so the detailed body
 *   would never be seen there.
 * - `/health` stays backward compatible: same dependency probe, but the body
 *   is admin-gated (M-SEC-b2 · §D116 MEDIUM (b)) — version, region,
 *   dependency latencies, scheduler status, which mock each provider runs is
 *   infrastructure fingerprinting an anonymous caller has no business
 *   reading. An admin-role caller still gets all of it; anyone else gets only
 *   `status` + `service`. This narrows the BODY only — the status code still
 *   reflects real dependency health either way, so an orchestrator watching
 *   for 200/503 (never reading the body) keeps working exactly as before.
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
  const uptimeS = () => Math.round((Date.now() - startedAt) / 100) / 10;

  async function probeDependencies() {
    const [database, redis] = await Promise.all([
      probe('database', () => app.db.$queryRaw`SELECT 1`),
      probe('redis', () => app.redis.ping()),
    ]);
    return { database, redis, healthy: database.status === 'up' && redis.status === 'up' };
  }

  // LIVENESS: no dependency touch, always 200 while the process is up. A
  // Postgres outage must not make an orchestrator kill this process — that
  // is exactly the thing that could still recover on its own once Postgres
  // comes back, and killing it only adds a restart to the outage.
  app.get(
    '/health/live',
    { config: { public: true, healthRateLimit: true } },
    async (_request, reply) => {
      return reply.status(200).send({ status: 'ok', service: 'api', uptime_s: uptimeS() });
    },
  );

  // READINESS: today's dependency probe, unchanged — 503 takes the instance
  // out of rotation. Always the narrow body: unlike `/health` below, this is
  // meant to be hit by an orchestrator, which never presents a bearer token,
  // so an admin-gated detailed body would never be reachable here anyway.
  app.get(
    '/health/ready',
    { config: { public: true, healthRateLimit: true } },
    async (_request, reply) => {
      const { healthy } = await probeDependencies();
      return reply
        .status(healthy ? 200 : 503)
        .send({ status: healthy ? 'ok' : 'degraded', service: 'api' });
    },
  );

  // Monitors poll this continuously — `healthRateLimit` (rate-limit.ts) gives
  // it its own generous per-IP ceiling instead of `skipRateLimit`, so it stays
  // bounded without a tight probe interval tripping it.
  app.get(
    '/health',
    { config: { public: true, healthRateLimit: true } },
    async (request, reply) => {
      const { database, redis, healthy } = await probeDependencies();
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
        uptime_s: uptimeS(),
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
