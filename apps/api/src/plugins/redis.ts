/**
 * Redis connection used for presence, rate limiting and RTM fan-out (ADR-11 —
 * Redis Streams + pub/sub, no external broker).
 *
 * `lazyConnect` is off so a bad URL fails at boot rather than on the first
 * request, and retries are bounded so a dead Redis cannot wedge the process in
 * an infinite reconnect loop.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import type { Env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export function createRedisClient(env: Env, role = 'client'): Redis {
  const client = new Redis(env.REDIS_URL, {
    connectionName: `nexa-api-${role}`,
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });
  return client;
}

async function redisPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const redis = createRedisClient(options.env);

  redis.on('error', (error) => {
    // ioredis emits on every failed reconnect; log without crashing so a brief
    // Redis blip degrades the service instead of taking the process down.
    app.log.error({ err: error }, 'redis connection error');
  });

  await redis.ping();
  app.decorate('redis', redis);
  app.addHook('onClose', async () => {
    await redis.quit().catch(() => redis.disconnect());
  });
}

export default fp(redisPlugin, { name: 'redis' });
