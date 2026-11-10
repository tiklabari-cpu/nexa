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
 *   READINESS probe. Since M-OPS-b it also answers 503 while the process is
 *   shutting down, before it stops accepting: that 503 is what makes a
 *   graceful drain possible at all, because an orchestrator only stops
 *   routing here once a probe fails, and `status: 'draining'` distinguishes
 *   "leaving on purpose" from "a dependency is down" for whoever reads it.
 * - `/health` stays backward compatible: the same dependency probe and the
 *   same status code as `/health/ready`.
 *
 * Every one of them answers the narrow body — `status` + `service`
 * (`uptime_s` on liveness) — to every caller (tm 454 · F35). Until then an
 * admin-role bearer token got the detailed body on `/health` (M-SEC-b2):
 * version, region, dependency latencies, scheduler, event partitions, the
 * mock providers and `ai_jobs` — the depth of the AI queue across every
 * workspace. A workspace admin is a tenant, and with public sign-up anyone
 * can be one, so none of that is theirs. The one reader it is for — the
 * platform operator — never reaches this process (the platform API is a
 * separate process with its own principal, design.md §A); the root panel's
 * dashboard reads the same body from the leader's 30-second publication
 * (`services/ops/health-publisher.ts` → `GET /platform/v1/dashboard/health`).
 * So the detail left this route rather than gaining a new credential.
 */
import type { FastifyInstance } from 'fastify';
import {
  probe,
  probeDependencies as probeDeps,
  type DependencyHealth,
} from '../services/ops/health-snapshot.js';

// Moved to `services/ops/health-snapshot.ts` (tm 389.8); re-exported so the
// platform process's probes keep their import.
export { probe, type DependencyHealth };

export default async function healthRoutes(app: FastifyInstance): Promise<void> {
  const startedAt = Date.now();
  const uptimeS = () => Math.round((Date.now() - startedAt) / 100) / 10;

  /**
   * The readiness answer while shutting down (M-OPS-b).
   *
   * Short-circuits the dependency probe rather than running it and overriding
   * the result: mid-close the pool may already be gone, so probing would trade
   * a truthful 503 for a two-second timeout on the way to the same status
   * code — and slow readiness during a drain is exactly what a deploy cannot
   * afford.
   */
  const drainingBody = { status: 'draining' as const, service: 'api' };

  const probeDependencies = () => probeDeps(app.db, app.redis);

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
  // out of rotation.
  app.get(
    '/health/ready',
    { config: { public: true, healthRateLimit: true } },
    async (_request, reply) => {
      if (app.lifecycle.draining) return reply.status(503).send(drainingBody);
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
    async (_request, reply) => {
      // Draining wins: this route is still a readiness signal for anything
      // pointed at it from before the split, and a 200 here during a drain
      // would keep traffic coming to a process that is closing.
      if (app.lifecycle.draining) return reply.status(503).send(drainingBody);

      // The narrow body for every caller, a presented credential included
      // (tm 454 · F35 — see the header for where the detail went).
      const { healthy } = await probeDependencies();
      return reply
        .status(healthy ? 200 : 503)
        .send({ status: healthy ? 'ok' : 'degraded', service: 'api' });
    },
  );
}
