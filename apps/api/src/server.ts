import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Env } from './config/env.js';
import errorHandler from './plugins/error-handler.js';
import database from './plugins/database.js';
import redis from './plugins/redis.js';
import healthRoutes from './routes/health.js';

export const API_PREFIX = '/api/v1';
export const VERSION = '0.1.0';

export interface BuildServerOptions {
  env: Env;
}

export async function buildServer({ env }: BuildServerOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Secrets must never reach the log, even at trace level.
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.password',
          'req.body.client_secret',
          'req.body.code_verifier',
          'req.body.token',
          'res.headers["set-cookie"]',
        ],
        censor: '[redacted]',
      },
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino/file', options: { destination: 1 } }
          : undefined,
    },
    // Correlates the log line, the trace and the `request_id` the client sees.
    genReqId: (req) => (req.headers['x-request-id'] as string | undefined) ?? randomUUID(),
    requestIdHeader: 'x-request-id',
    trustProxy: true,
    disableRequestLogging: env.isTest,
    bodyLimit: 1_048_576, // 1 MiB — attachments go through signed upload URLs
  });

  await app.register(errorHandler);
  await app.register(sensible);
  await app.register(helmet, {
    // The API serves JSON only; a restrictive default CSP is right here and the
    // widget/web apps set their own.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: env.isProduction ? [env.WEB_ORIGIN] : true,
    credentials: true,
    exposedHeaders: [
      'X-Request-Id',
      'Retry-After',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
  });

  await app.register(database, { env });
  await app.register(redis, { env });

  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
  });

  await app.register(
    async (api) => {
      await api.register(healthRoutes, { env, version: VERSION });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
