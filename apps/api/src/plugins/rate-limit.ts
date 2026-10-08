/**
 * Rate limiting (ADR-07 / NFR-S8).
 *
 *   agent token (PAT or OAuth) : 180 req/min, burst 30
 *   customer token             : 60 req/min
 *   unauthenticated            : 30 req/min per IP
 *   token exchange             : 300 req/min per IP (`POST /auth/token`, below)
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
 *
 * ## The token endpoint (tm 259.3)
 *
 * `POST /auth/token` used to share the anonymous bucket with sign-in and the
 * widget's token mint. Every panel page load spends a refresh, so a team behind
 * one office address used up 30 a minute with reloads alone, and the 429 took
 * the session with it. The exchange has its own per-IP bucket now
 * (`tokenRateLimit`).
 *
 * That bucket must not become a budget for guessing. A refresh token, an
 * authorization code and a client secret are credentials too, only carried in
 * the body, so the endpoint answers to the same per-IP failure budget as a
 * bearer token — with one difference, because the outcome is only known after
 * the lookup: the slot is *reserved* on the way in and handed back once the
 * answer is anything but a refusal (the `onSend` hook below). Reading the budget
 * on the way in and charging it on the way out, as the bearer path does, would
 * let every request already in flight past the read before the first refusal is
 * charged; a reservation is counted the moment it is made, so the ceiling holds
 * for simultaneous requests too.
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

/** What `reserve` answers: the decision, and the window entry `release` takes back. */
export interface RateLimitReservation extends RateLimitDecision {
  member: string;
}

export class RateLimiter {
  #scriptSha: string | null = null;

  constructor(private readonly redis: FastifyInstance['redis']) {}

  /** Spend one slot of `key`'s budget, or report that there was none to spend. */
  async consume(key: string, limit: number, windowMs: number): Promise<RateLimitDecision> {
    return this.#evaluate(key, limit, windowMs, true);
  }

  /**
   * Spend one slot provisionally, for a request whose outcome decides whether
   * it should have cost one — the token endpoint's credential check (tm 259.3).
   *
   * Counted the moment it is made, exactly like `consume`, which is the point:
   * charging only after the outcome is known lets every request already in
   * flight past the check first. `release` hands the slot back once the
   * request turns out not to be what the budget meters.
   *
   * The entry is a fresh random id, never the request id: that one can come
   * from the caller's `X-Request-Id`, and attempts sharing an entry would
   * count as one.
   */
  async reserve(key: string, limit: number, windowMs: number): Promise<RateLimitReservation> {
    const member = randomUUID();
    return { ...(await this.#evaluate(key, limit, windowMs, true, member)), member };
  }

  /** Hand back a slot `reserve` spent. A slot already out of the window is a no-op. */
  async release(key: string, member: string): Promise<void> {
    await this.redis.zrem(key, member);
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
    member: string = randomUUID(),
  ): Promise<RateLimitDecision> {
    const now = Date.now();
    const args = [String(now), String(windowMs), String(limit), member, record ? '1' : '0'];

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
 * in two files. The token endpoint reserves from the same budget for the
 * credential in its body (tm 259.3): one ceiling per address, whichever door
 * the credential was tried at.
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

  // `GET /deployment` (tm 257.13): the panel reads it on every page load,
  // signed in or not, so in the anon bucket below it would spend the 30/min
  // that sign-in and the widget's token mint share — a few reloads of the
  // sign-in screen would lock out the sign-in itself. Its own per-IP bucket,
  // ahead of the principal buckets like the two above, so a caller that also
  // sends a token is still metered by the route.
  if (request.routeOptions.config.publicConfigRateLimit) {
    return {
      key: `rl:pubcfg:${request.ip}`,
      limit: env.RATE_LIMIT_PUBLIC_CONFIG_PER_MIN,
      windowMs: 60_000,
    };
  }

  // `POST /auth/token` (tm 259.3): every panel page load spends a refresh, so
  // in the anon bucket an office's reloads locked out its own sessions. Instead
  // of the anon bucket, not as well as it: one request, one traffic bucket.
  // Ahead of the principal buckets for the same reason as `/deployment`. What
  // keeps a higher ceiling from buying guesses is the failure budget the
  // pre-auth hook reserves from for this route, not this bucket.
  if (request.routeOptions.config.tokenRateLimit) {
    return {
      key: `rl:token:${request.ip}`,
      limit: env.RATE_LIMIT_TOKEN_PER_MIN,
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

  // Unauthenticated callers share one bucket per IP. This covers sign-in (both
  // password doors) and widget token minting, so it is the limit an end-to-end
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
  app.decorateRequest('credentialAttempt', undefined);

  /**
   * Answer the request from one decision, or let it through.
   *
   * `announce` is false for a budget the caller does not spend from in the
   * ordinary way — the failure budget, read or reserved — and then the headers
   * are written only when it refuses: a request that got past it has a real
   * bucket waiting for it, and announcing the failure budget's numbers first
   * would just be overwritten a moment later by the ones the caller actually
   * spends from.
   */
  function enforce(reply: FastifyReply, decision: RateLimitDecision, announce: boolean): void {
    if (announce || !decision.allowed) {
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
  }

  /**
   * Evaluate one bucket and answer the request, or let it through.
   *
   * `mode: 'peek'` reports the budget without spending a slot (see `enforce`
   * for why it then stays quiet unless it refuses).
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

    enforce(reply, decision, mode === 'consume');
    return decision;
  }

  /**
   * Take one slot of the address's failure budget for the credential in a
   * token request's body, before anything is looked up (tm 259.3 — the file
   * header has the reasoning). Remembered on the request so `onSend` can hand
   * it back; an address with no slot left is refused here, without the lookup.
   */
  async function reserveCredentialAttempt(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const failures = authFailureBucket(request.ip, env);
    let reservation: RateLimitReservation;
    try {
      reservation = await limiter.reserve(failures.key, failures.limit, failures.windowMs);
    } catch (error) {
      // Fails open, like `meter` and for the same reason.
      request.log.error({ err: error }, 'rate limiter unavailable — allowing request');
      return;
    }

    enforce(reply, reservation, false);
    request.credentialAttempt = { key: failures.key, member: reservation.member };
  }

  // Stage one, before `auth` (see the file header): the limit that can be
  // decided without knowing who is asking.
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions.config.skipRateLimit) return;

    if (request.routeOptions.config.tokenRateLimit) {
      // The credential this route verifies is in the body, so `Authorization`
      // has no say in how it is metered: the failure budget is reserved and
      // the route's bucket charged here, header or not. Otherwise a header —
      // a stranger's garbage, or a trial account's own working token — would
      // send the request down the branch below, which reads the failure budget
      // without spending from it, and the body's guess would go uncounted.
      await reserveCredentialAttempt(request, reply);
      const bucket = bucketFor(request, env);
      const decision = await meter(request, reply, bucket, 'consume');
      if (decision) request.rateLimitChargedKey = bucket.key;
      return;
    }

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

  // The other half of the token endpoint's reservation. A 401 is that route
  // refusing the credential it was shown — `invalid_grant` for a code or a
  // refresh token, `invalid_client` for a client — which is the failure the
  // slot stands for, so it stays spent. Anything else hands it back: a grant,
  // a body that never reached a lookup (400), a request a bucket turned away
  // (429), our own fault (5xx). Before the response goes out rather than after
  // it, so a client that waits for one answer before asking again never finds
  // its previous, successful request still holding a slot.
  app.addHook('onSend', async (request, reply, payload) => {
    const attempt = request.credentialAttempt;
    if (attempt === undefined || reply.statusCode === 401) return payload;

    request.credentialAttempt = undefined;
    try {
      await limiter.release(attempt.key, attempt.member);
    } catch (error) {
      // The slot stays counted until the window passes — the direction a
      // budget that bounds guessing should fail in, and never the reason the
      // answer itself fails.
      request.log.error(
        { err: error },
        'credential attempt not handed back — counted until it expires',
      );
    }
    return payload;
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
    /**
     * Internal to this plugin: the failure-budget slot a `tokenRateLimit` route
     * reserved on the way in (tm 259.3), handed back in `onSend` unless the
     * answer was a refusal. Undefined on every other request.
     */
    credentialAttempt?: { key: string; member: string };
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
    /**
     * `GET /deployment` (tm 257.13): use the `rl:pubcfg:<ip>` bucket instead of
     * the shared anon one, which sign-in and the widget's token mint need.
     */
    publicConfigRateLimit?: boolean;
    /**
     * `POST /auth/token` (tm 259.3): use the `rl:token:<ip>` bucket instead of
     * the shared anon one, and reserve a slot of the per-IP failure budget for
     * the credential the body carries. Only for a route that answers 401 for
     * exactly the presentations that budget meters — a 401 is what keeps the
     * slot spent.
     */
    tokenRateLimit?: boolean;
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
