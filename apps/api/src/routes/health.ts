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

  app.get('/health', { config: { public: true } }, async (_request, reply) => {
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
    });
  });
}
