/**
 * Rate limiting (ADR-07 / NFR-S8).
 *
 *   agent token (PAT or OAuth) : 180 req/min, burst 30
 *   customer token             : 60 req/min
 *   unauthenticated            : 30 req/min per IP
 *
 * Sliding window over a Redis sorted set: each request is a member scored by
 * timestamp, older entries are trimmed, and the remaining count is the usage.
 * A fixed window would let a caller send a full quota at 59s and another at
 * 61s — double the intended rate across the boundary.
 *
 * The whole check is one round-trip via a Lua script, so it is atomic. Doing
 * trim/count/add as separate commands would let concurrent requests each see a
 * pre-insert count and all pass.
 *
 * Every 429 carries `Retry-After`, which the source platform omitted.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';

/**
 * KEYS[1] window key · ARGV: now(ms), windowMs, limit, member id
 * Returns [allowed, remaining, resetMs].
 */
const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, now - window)
local used = redis.call('ZCARD', key)

if used >= limit then
  -- Retry-After is derived from the oldest surviving entry: that is exactly
  -- when a slot frees up, so an honest client retries once instead of polling.
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local reset = window
  if oldest[2] then reset = (tonumber(oldest[2]) + window) - now end
  if reset < 1 then reset = 1 end
  return {0, 0, reset}
end

redis.call('ZADD', key, now, member)
redis.call('PEXPIRE', key, window)
return {1, limit - used - 1, window}
`;

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
}

export class RateLimiter {
  #scriptSha: string | null = null;

  constructor(private readonly redis: FastifyInstance['redis']) {}

  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    const now = Date.now();
    const args = [String(now), String(windowMs), String(limit), randomUUID()];

    let raw: unknown;
    try {
      if (!this.#scriptSha) {
        this.#scriptSha = (await this.redis.script('LOAD', SLIDING_WINDOW_LUA)) as string;
      }
      raw = await this.redis.evalsha(this.#scriptSha, 1, key, ...args);
    } catch (error) {
      // NOSCRIPT means Redis restarted and dropped the cache — reload once.
      if (error instanceof Error && error.message.includes('NOSCRIPT')) {
        this.#scriptSha = null;
        raw = await this.redis.eval(SLIDING_WINDOW_LUA, 1, key, ...args);
      } else {
        throw error;
      }
    }

    const [allowed, remaining, resetMs] = raw as [number, number, number];
    return { allowed: allowed === 1, limit, remaining, resetMs };
  }
}

interface Bucket {
  key: string;
  limit: number;
  windowMs: number;
}

function bucketFor(request: FastifyRequest, env: Env): Bucket {
  const principal = request.principal;

  if (principal?.kind === 'agent' || principal?.kind === 'bot') {
    const owner = principal.kind === 'agent' ? principal.accountId : principal.botId;
    return {
      // Keyed by token, not by account: one runaway script must not exhaust the
      // quota of the human's browser session.
      key: `rl:agent:${principal.licenseId}:${owner}:${principal.tokenId}`,
      limit: env.RATE_LIMIT_AGENT_PER_MIN,
      windowMs: 60_000,
    };
  }

  if (principal?.kind === 'customer') {
    return {
      key: `rl:customer:${principal.organizationId}:${principal.customerId}`,
      limit: env.RATE_LIMIT_CUSTOMER_PER_MIN,
      windowMs: 60_000,
    };
  }

  return {
    key: `rl:anon:${request.ip}`,
    limit: 30,
    windowMs: 60_000,
  };
}

async function rateLimitPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const { env } = options;
  const limiter = new RateLimiter(app.redis);

  app.decorate('rateLimiter', limiter);

  // preHandler, not onRequest: the principal must already be resolved so the
  // right bucket and limit apply.
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.config.skipRateLimit) return;

    const bucket = bucketFor(request, env);

    let decision: RateLimitDecision;
    try {
      decision = await limiter.consume(bucket.key, bucket.limit, bucket.windowMs);
    } catch (error) {
      // Redis being unavailable must not take the API down with it. Fail open
      // and shout: availability matters more than a perfectly enforced limit,
      // and the other protections (auth, RLS) are unaffected.
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

declare module 'fastify' {
  interface FastifyInstance {
    rateLimiter: RateLimiter;
  }
  interface FastifyContextConfig {
    /** For health checks and other endpoints a monitor hits continuously. */
    skipRateLimit?: boolean;
  }
}

export default fp(rateLimitPlugin, { name: 'rate-limit', dependencies: ['redis', 'auth'] });
