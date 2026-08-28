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
 *
 * ## Two stages, because a limit is only useful before the work it protects
 *
 * The buckets above are keyed by *who is asking*, so they cannot be evaluated
 * until authentication has resolved the caller — which is why they run in
 * `preHandler`. Fastify runs every `onRequest` hook before any `preHandler`,
 * and authentication is an `onRequest` hook, so for a long time that ordering
 * meant a request nobody could authenticate was refused *after* it had already
 * spent an `auth_resolve_token` query, and without ever reaching a limit at all
 * (an `onRequest` throw skips the `preHandler` below). A flood of invalid
 * bearer tokens therefore bought one indexed database lookup per request,
 * unbounded — §D116 LOW/1, M-SEC-c1.
 *
 * So there is now a second hook, an `onRequest` one registered *before* the
 * `auth` plugin (see `server.ts`, where the registration order is the
 * mechanism), covering exactly the two cases the principal buckets cannot:
 *
 *   1. **No credential at all.** The caller is anonymous by definition, so the
 *      per-IP bucket that would have been chosen in `preHandler` anyway is
 *      chosen and charged here instead — early enough that it also applies to
 *      anonymous traffic aimed at *protected* routes, which previously got a
 *      401 out of the authentication hook and was never metered.
 *   2. **A credential whose verification costs a database query**
 *      (`costsTokenResolution`). The limit cannot know yet whether the token is
 *      good, so it does not charge this request to anything; it *checks* the
 *      per-IP budget of recently failed token resolutions and refuses when that
 *      budget is gone. Authentication charges that budget itself, one entry per
 *      resolution that failed (`plugins/auth.ts`).
 *
 * Requests that pass stage 2 are still metered by their principal bucket in
 * `preHandler`, unchanged: the account-scoped limit ADR-07 specifies (agent
 * 180/min) requires knowing the account, so that is where it has to stay. Two
 * buckets at two stages is the point, not an accident.
 *
 * What deliberately did *not* change: an authenticated caller refused by a
 * later gate inside the authentication hook (wrong scope, wrong role, wrong
 * region, blocked address) still throws from `onRequest` and so still skips the
 * `preHandler` bucket. Metering those would mean splitting authentication from
 * authorization across two lifecycle phases, which touches every route; the
 * credential there is real, attributable and revocable, so it is a different
 * problem from an anonymous flood and gets its own task, not this one.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { costsTokenResolution, readCredential } from '../lib/credential.js';

/**
 * KEYS[1] window key · ARGV: now(ms), windowMs, limit, member id, record(1|0)
 * Returns [allowed, remaining, resetMs].
 *
 * `record` is what separates spending a slot from reading the meter. A caller
 * that only wants to know whether a budget is exhausted (the pre-auth check
 * above) must not consume one by asking — otherwise the check would be the
 * thing that fills the bucket.
 */
const SLIDING_WINDOW_LUA = `
local key    = KEYS[1]
local now    = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit  = tonumber(ARGV[3])
local member = ARGV[4]
local record = tonumber(ARGV[5])

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

-- A read of the meter: the trim above still ran (so an expired budget reports
-- itself as free), but nothing was spent, so the remaining count is not one
-- lower than what the next real request will find.
if record == 0 then
  return {1, limit - used, window}
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

  /** Spend one slot of `key`'s budget, or report that there was none to spend. */
  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    return this.#evaluate(key, limit, windowMs, true);
  }

  /**
   * Read `key`'s budget without spending any of it.
   *
   * For a limit that is checked at one point and charged at another — the
   * pre-auth failure budget of M-SEC-c1, checked before authentication and
   * charged by it — the two have to be separable, or every check would be
   * indistinguishable from the failure it is looking for.
   */
  async peek(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    return this.#evaluate(key, limit, windowMs, false);
  }

  async #evaluate(
    key: string,
    limit: number,
    windowMs: number,
    record: boolean,
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const args = [String(now), String(windowMs), String(limit), randomUUID(), record ? '1' : '0'];

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

/**
 * How many token resolutions may fail for one source address per minute before
 * further credentials from it are refused without being looked up at all
 * (M-SEC-c1).
 *
 * Charged by `plugins/auth.ts` on each failed resolution and checked here
 * before authentication runs, so the two halves have to name the same key and
 * the same ceiling — hence one exported function rather than a string spelled
 * in two files.
 *
 * Keyed by IP because that is the only thing known about the caller at the
 * point the decision has to be made: the credential is precisely what could not
 * be trusted, and keying by the token itself would hand an attacker a fresh
 * budget with every random string they send.
 */
export function authFailureBucket(ip: string, env: Env): Bucket {
  return {
    key: `rl:authfail:${ip}`,
    limit: env.RATE_LIMIT_AUTH_FAILURES_PER_MIN,
    windowMs: 60_000,
  };
}

function bucketFor(request: FastifyRequest, env: Env): Bucket {
  const principal = request.principal;

  // Public KB reads (PUBKB-c) are the anonymous SEO surface: a crawler indexing
  // one workspace's articles would drain the shared 30/min anon bucket in
  // seconds. They get their own, higher per-IP bucket instead — keyed by IP like
  // the anon bucket (the reader has no principal), separate so the two never
  // contend. Checked before the principal buckets so the limit is the route's,
  // not whatever token a caller happened to also send to a public route.
  if (request.routeOptions.config.publicKbRateLimit) {
    return {
      key: `rl:pubkb:${request.ip}`,
      limit: env.RATE_LIMIT_PUBKB_PER_MIN,
      windowMs: 60_000,
    };
  }

  // `/health` (M-SEC-b2): its own per-IP bucket, checked before the principal
  // buckets below so an admin polling it with a bearer token still gets the
  // generous health ceiling rather than being metered out of the 180/min agent
  // bucket by its own monitoring. High limit is deliberate (env.ts) — this is
  // a liveness probe an orchestrator hits on a tight interval, not a surface
  // worth defending at the same tightness as sign-in.
  if (request.routeOptions.config.healthRateLimit) {
    return {
      key: `rl:health:${request.ip}`,
      limit: env.RATE_LIMIT_HEALTH_PER_MIN,
      windowMs: 60_000,
    };
  }

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

  // A SCIM provisioning connector (NFR-S11). Its own bucket rather than the
  // agent one: the traffic shape is different (a nightly sync pages the whole
  // directory in a burst, then goes quiet for a day) and folding it into the
  // agent limit would mean a full reconciliation could exhaust the quota of a
  // credential that has nothing to do with it. Keyed by token, like the agent
  // bucket and for the same reason — rotating a leaked SCIM token also resets
  // whatever it was doing to the limit.
  if (principal?.kind === 'scim') {
    return {
      key: `rl:scim:${principal.licenseId}:${principal.tokenId}`,
      limit: env.RATE_LIMIT_SCIM_PER_MIN,
      windowMs: 60_000,
    };
  }

  // Unauthenticated callers share one bucket per IP. This covers sign-in,
  // token exchange and widget token minting, so it is the limit an end-to-end
  // suite runs into first — hence configurable like the others (ADR-07), rather
  // than the only hard-coded one.
  return {
    key: `rl:anon:${request.ip}`,
    limit: env.RATE_LIMIT_ANON_PER_MIN,
    windowMs: 60_000,
  };
}

async function rateLimitPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const { env } = options;
  const limiter = new RateLimiter(app.redis);

  app.decorate('rateLimiter', limiter);
  app.decorateRequest('rateLimitChargedKey', undefined);

  /**
   * Evaluate one bucket and answer the request, or let it through.
   *
   * `mode: 'peek'` reports the budget without spending a slot, and then only
   * writes the headers when it refuses — a request that passed the pre-auth
   * check has a real bucket waiting for it in `preHandler`, and announcing the
   * failure budget's numbers first would just be overwritten a moment later by
   * the ones the caller actually spends from.
   */
  async function meter(
    request: FastifyRequest,
    reply: FastifyReply,
    bucket: Bucket,
    mode: 'consume' | 'peek',
  ): Promise<RateLimitDecision | null> {
    let decision: RateLimitDecision;
    try {
      decision =
        mode === 'consume'
          ? await limiter.consume(bucket.key, bucket.limit, bucket.windowMs)
          : await limiter.peek(bucket.key, bucket.limit, bucket.windowMs);
    } catch (error) {
      // Redis being unavailable must not take the API down with it. Fail open
      // and shout: availability matters more than a perfectly enforced limit,
      // and the other protections (auth, RLS) are unaffected.
      request.log.error({ err: error }, 'rate limiter unavailable — allowing request');
      return null;
    }

    if (mode === 'consume' || !decision.allowed) {
      const resetAt = Math.ceil((Date.now() + decision.resetMs) / 1000);
      reply.headers({
        'X-RateLimit-Limit': String(decision.limit),
        'X-RateLimit-Remaining': String(decision.remaining),
        'X-RateLimit-Reset': String(resetAt),
      });
    }

    if (!decision.allowed) {
      // ADR-07's contract holds wherever the refusal comes from: `Retry-After`
      // plus the three `X-RateLimit-*` headers, on every 429.
      throw ApiError.tooManyRequests(
        decision.resetMs / 1000,
        'Rate limit exceeded. Retry after the interval in the Retry-After header.',
      );
    }

    return decision;
  }

  // Stage one, before `auth` (see the file header): the limit that can be
  // decided without knowing who is asking.
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.config.skipRateLimit) return;

    const credential = readCredential(request);

    if (costsTokenResolution(credential)) {
      // Nothing is charged here — whether this credential is any good is not
      // known yet, and a valid token must not spend from a budget that exists
      // to meter invalid ones. Only the standing budget is read: if this
      // address has already burned it on failed lookups, the request is refused
      // now, which is the whole point — the refusal happens before the query it
      // would otherwise have cost.
      await meter(request, reply, authFailureBucket(request.ip, env), 'peek');
      return;
    }

    // No credential (or one that is refused without a query): the caller is
    // anonymous, so the per-IP bucket `preHandler` would have picked anyway is
    // charged here instead. `bucketFor` returns it unchanged — there is no
    // principal yet, and a route with its own IP bucket (`/health`, public KB)
    // gets that one, exactly as it does later.
    const bucket = bucketFor(request, env);
    const decision = await meter(request, reply, bucket, 'consume');
    // Remember which bucket paid, so `preHandler` does not bill the same
    // request a second time for the same key.
    if (decision) request.rateLimitChargedKey = bucket.key;
  });

  // Stage two. preHandler, not onRequest: the principal must already be
  // resolved so the right bucket and limit apply.
  app.addHook('preHandler', async (request, reply) => {
    if (request.routeOptions.config.skipRateLimit) return;

    const bucket = bucketFor(request, env);
    // Already charged before authentication ran, and to the same key — this is
    // one request, not two.
    if (request.rateLimitChargedKey === bucket.key) return;

    await meter(request, reply, bucket, 'consume');
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    rateLimiter: RateLimiter;
  }
  interface FastifyRequest {
    /**
     * Internal to this plugin: the bucket the pre-auth hook already charged, so
     * the `preHandler` hook can tell "not metered yet" from "metered a
     * lifecycle phase ago". Undefined on every request that reached
     * authentication with a credential.
     */
    rateLimitChargedKey?: string;
  }
  interface FastifyContextConfig {
    /** For health checks and other endpoints a monitor hits continuously. */
    skipRateLimit?: boolean;
    /**
     * Anonymous public-KB reads (PUBKB-c): use the higher `rl:pubkb:<ip>` bucket
     * instead of the shared 30/min anon one, so a crawler indexing the SEO pages
     * is not throttled. Never pairs with `skipRateLimit` — a public content
     * surface stays limited, just more generously.
     */
    publicKbRateLimit?: boolean;
    /**
     * `/health` (M-SEC-b2): use the `rl:health:<ip>` bucket instead of
     * `skipRateLimit` — a public endpoint stays bounded, just at a ceiling high
     * enough that a legitimate probe never trips it.
     */
    healthRateLimit?: boolean;
  }
}

/**
 * `auth` is no longer a declared dependency, and that is the change, not an
 * omission: this plugin now has to be registered *before* it, because
 * `dependencies` asserts "already registered" and the pre-auth hook has to run
 * first. What the ordering has to be, and why, is written where it is enforced
 * — `server.ts`. `redis` stays: the limiter reads `app.redis` at construction.
 */
export default fp(rateLimitPlugin, { name: 'rate-limit', dependencies: ['redis'] });
