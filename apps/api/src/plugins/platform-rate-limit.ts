/**
 * Rate limiting for the platform process (tm 389.3 · design.md §A).
 *
 * The tenant limiter's sliding window (`RateLimiter`, one Lua round-trip) and
 * its 429 contract — `Retry-After` plus the three `X-RateLimit-*` headers — but
 * its own buckets, under their own prefix, so the back office and the tenant
 * API never spend from each other's budget even on one Redis:
 *
 *   `rl:platform:<ip>`         every request, `RATE_LIMIT_PLATFORM_PER_MIN` (300)
 *   `rl:platform:health:<ip>`  `healthRateLimit` routes, `RATE_LIMIT_HEALTH_PER_MIN`
 *
 * Keyed by address and charged at `onRequest`, before anything else runs. The
 * operator sign-in (389.4) adds its own failure budget beside these; an
 * operator's session does not buy a larger bucket — there are a handful of
 * operators, and 300 a minute is far above what a person clicks.
 *
 * Fails open when Redis is down, like the tenant limiter and for its reason:
 * the platform's other protections (operator session, TOTP, the edge's access
 * policy) do not depend on it.
 */
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import type { PlatformEnv } from '../config/platform-env.js';
import { ApiError } from '../lib/api-error.js';
import { RateLimiter, type RateLimitDecision } from './rate-limit.js';

export const PLATFORM_RATE_LIMIT_PREFIX = 'rl:platform:';
const WINDOW_MS = 60_000;

async function platformRateLimitPlugin(
  app: FastifyInstance,
  options: { env: Env; platform: PlatformEnv },
): Promise<void> {
  const limiter = new RateLimiter(app.redis);

  app.addHook('onRequest', async (request, reply) => {
    const config = request.routeOptions.config;
    if (config.skipRateLimit) return;

    const bucket = config.healthRateLimit
      ? {
          key: `${PLATFORM_RATE_LIMIT_PREFIX}health:${request.ip}`,
          limit: options.env.RATE_LIMIT_HEALTH_PER_MIN,
        }
      : {
          key: `${PLATFORM_RATE_LIMIT_PREFIX}${request.ip}`,
          limit: options.platform.rateLimitPerMin,
        };

    let decision: RateLimitDecision;
    try {
      decision = await limiter.consume(bucket.key, bucket.limit, WINDOW_MS);
    } catch (error) {
      request.log.error({ err: error }, 'rate limiter unavailable — allowing request');
      return;
    }

    const resetAt = Math.ceil((Date.now() + decision.resetMs) / 1000);
    reply.headers({
      'X-RateLimit-Limit': String(decision.limit),
      'X-RateLimit-Remaining': String(decision.remaining),
      'X-RateLimit-Reset': String(resetAt),
    });
    if (!decision.allowed) {
      throw ApiError.tooManyRequests(
        decision.resetMs / 1000,
        'Rate limit exceeded. Retry after the interval in the Retry-After header.',
      );
    }
  });
}

export default fp(platformRateLimitPlugin, {
  name: 'platform-rate-limit',
  dependencies: ['redis'],
});
