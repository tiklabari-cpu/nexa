/**
 * GET /platform/v1/health/live, /health/ready, /health (tm 389.3).
 *
 * The tenant API's three probes (`routes/health.ts`, M-OPS-a/b), answered by
 * the platform process about its own dependencies: Postgres as
 * `siyahtus_platform` and Redis. Same split, same reasons — liveness touches
 * nothing, readiness probes for real and says `draining` during a shutdown,
 * and `/health` is the narrow body a monitor can poll.
 *
 * Narrow everywhere. The tenant `/health` gives an admin token the detail
 * (version, latencies, scheduler, providers); here there is no operator yet
 * (389.4), and when there is, that detail is the dashboard's health view
 * (389.8), behind a session — not a second body on an anonymous route.
 */
import type { FastifyInstance } from 'fastify';
import { probe } from '../health.js';

const SERVICE = 'platform';

export default async function platformHealthRoutes(app: FastifyInstance): Promise<void> {
  const startedAt = Date.now();
  const uptimeS = () => Math.round((Date.now() - startedAt) / 100) / 10;
  const drainingBody = { status: 'draining' as const, service: SERVICE };

  async function healthy(): Promise<boolean> {
    const [database, redis] = await Promise.all([
      probe('database', () => app.platformDb.$queryRaw`SELECT 1`),
      probe('redis', () => app.redis.ping()),
    ]);
    return database.status === 'up' && redis.status === 'up';
  }

  app.get(
    '/health/live',
    { config: { public: true, healthRateLimit: true } },
    async (_request, reply) =>
      reply.status(200).send({ status: 'ok', service: SERVICE, uptime_s: uptimeS() }),
  );

  for (const path of ['/health/ready', '/health'] as const) {
    app.get(path, { config: { public: true, healthRateLimit: true } }, async (_request, reply) => {
      if (app.lifecycle.draining) return reply.status(503).send(drainingBody);
      const ok = await healthy();
      return reply
        .status(ok ? 200 : 503)
        .send({ status: ok ? 'ok' : 'degraded', service: SERVICE });
    });
  }
}
