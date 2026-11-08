/**
 * The password doors' budget per sign-in address (tm 422 · denetim F05).
 *
 * `/auth/login` and `/auth/authorize` sit on the anonymous bucket, which is
 * counted per client network (`clientNetworkKey`: an IPv4 address, an IPv6
 * /64). That stops one host; it does nothing about guesses at one person's
 * password spread over a thousand hosts, each of which stays far below its own
 * ceiling. This budget counts the failures against the *address being
 * guessed* — the e-mail as typed and normalised, so an unknown address is
 * counted exactly like a registered one and the answer says nothing about which
 * it is.
 *
 * ## Filling it must not lock the person out
 *
 * A budget per account is also a way to deny the account to its owner: ten
 * wrong passwords every fifteen minutes and nobody signs in. So a spent budget
 * refuses the networks that spent it, not the account. Within the window, an
 * attempt from network `n` is verified when
 *
 *   1. the failures are under `limit` (the ordinary case), or
 *   2. `n` is a network this account last signed in from (`TRUST_MS`, the
 *      newest `TRUST_MAX`) and its own failures are under `limit` — the office
 *      and the home connection keep working whatever a stranger does, or
 *   3. `n` has not failed against this address in the window and the failures
 *      are under twice `limit` — a person somewhere new gets one attempt.
 *
 * Everything else is a 429 before the password is looked at. (3) is bounded on
 * purpose: unbounded, every fresh network would buy one more guess, and a
 * thousand rented addresses would be a thousand guesses a window. Bounded, a
 * crowd of addresses can still use up (3) — then a person somewhere new waits
 * out the window while home and the office stay open. That is the trade.
 *
 * An attempt let through by (3) that fails is answered 429, not 401: the
 * caller learns the same — that was not the password — and is told to wait,
 * which is what the next attempt from that network would be told anyway. One
 * let through by (2) stays a 401: the person at home mistyped, and may type
 * again.
 *
 * ## Reserved, not counted afterwards
 *
 * The slot is taken before the password is verified (`admit`) and handed back
 * when it was right (`succeeded`). Counting only once the outcome is known
 * would let every request already in flight past the check first — a burst of
 * a hundred would all be verified. A right password takes its slot back and
 * marks its network as one the account signs in from.
 *
 * Fails open when Redis is unreachable, like every tenant bucket
 * (`plugins/rate-limit.ts`): the anonymous bucket and the password itself do
 * not depend on it. Logged at error level by the caller.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ApiError } from '../../lib/api-error.js';
import { clientNetworkKey } from '../../lib/ip-allowlist.js';

/** How long a network the account signed in from keeps rule (2). */
export const LOGIN_TRUST_MS = 30 * 24 * 60 * 60 * 1000;
/** How many such networks one address keeps — the newest. */
export const LOGIN_TRUST_MAX = 10;

/**
 * KEYS[1] failures (`<uuid>|<network>` scored by time) · KEYS[2] trusted
 * networks (scored by the last sign-in). ARGV: now, window, limit, network,
 * member, trustMs. Returns `[allowed, rule, resetMs]`: the rule that let the
 * attempt through (0 ordinary, 1 trusted network, 2 fresh network) and, for
 * rule 2, when the network opens again should this attempt fail; for a
 * refusal, when it opens.
 */
const ADMIT_LUA = `
local fail    = KEYS[1]
local trust   = KEYS[2]
local now     = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])
local limit   = tonumber(ARGV[3])
local network = ARGV[4]
local member  = ARGV[5]
local trustMs = tonumber(ARGV[6])

redis.call('ZREMRANGEBYSCORE', fail, 0, now - window)
local entries = redis.call('ZRANGE', fail, 0, -1, 'WITHSCORES')
local total = #entries / 2
local suffix = '|' .. network
local mine = {}
for i = 1, #entries, 2 do
  if string.sub(entries[i], -#suffix) == suffix then
    mine[#mine + 1] = tonumber(entries[i + 1])
  end
end

local since = redis.call('ZSCORE', trust, network)
local trusted = since and tonumber(since) > now - trustMs

local rule = -1
if total < limit then
  rule = 0
elseif trusted and #mine < limit then
  rule = 1
elseif #mine == 0 and total < 2 * limit then
  rule = 2
end

if rule >= 0 then
  redis.call('ZADD', fail, now, member)
  redis.call('PEXPIRE', fail, window)
  local reset = 0
  if rule == 2 then
    -- Should this attempt fail, the network is shut until the failures (this
    -- one among them) fall under the limit, or this one leaves the window.
    reset = window
    local k = total + 1 - limit
    if k < total then
      local at = tonumber(entries[k * 2 + 2]) + window - now
      if at < reset then reset = at end
    end
  end
  return {1, rule, reset}
end

-- Refused: the soonest moment one of the three rules opens for this network.
local reset = tonumber(entries[(total - limit) * 2 + 2]) + window - now
if trusted and #mine >= limit then
  local own = mine[#mine - limit + 1] + window - now
  if own < reset then reset = own end
end
if #mine > 0 and total - #mine < 2 * limit then
  local own = mine[#mine] + window - now
  if own < reset then reset = own end
end
if reset < 1 then reset = 1 end
return {0, 0, reset}
`;

/** A slot `admit` took, which `succeeded` hands back. */
export interface LoginAttempt {
  failKey: string;
  trustKey: string;
  member: string;
  network: string;
}

/** Which of the three rules (file header) let an attempt through. */
export type LoginAdmissionRule = 'ordinary' | 'trusted_network' | 'fresh_network';

export type LoginAdmission =
  | {
      allowed: true;
      rule: LoginAdmissionRule;
      /**
       * For `fresh_network`: how long the network stays shut should this
       * attempt fail, which is then answered 429 rather than 401 — its next
       * attempt would be refused anyway. 0 otherwise.
       */
      resetMs: number;
      /** Null when Redis could not be reached and the attempt was let through. */
      attempt: LoginAttempt | null;
    }
  | { allowed: false; resetMs: number };

const RULES: readonly LoginAdmissionRule[] = ['ordinary', 'trusted_network', 'fresh_network'];

/** The address as the budget keys it: no e-mail in a Redis key, one key per spelling the schema allows. */
export function loginAddressKey(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32);
}

export class LoginAttemptBudget {
  #admitSha: string | null = null;

  constructor(
    private readonly redis: FastifyInstance['redis'],
    private readonly options: { limit: number; windowMs: number },
  ) {}

  /**
   * Take a slot for one password attempt at `email` from `ip`, or refuse it.
   * Throws only what Redis throws; the caller decides to fail open.
   */
  async admit(email: string, ip: string): Promise<LoginAdmission> {
    const address = loginAddressKey(email);
    const network = clientNetworkKey(ip);
    // One hash tag, so both keys live on one slot should Redis ever be a cluster.
    const failKey = `rl:loginfail:{${address}}`;
    const trustKey = `rl:logintrust:{${address}}`;
    const member = `${randomUUID()}|${network}`;
    const args = [
      String(Date.now()),
      String(this.options.windowMs),
      String(this.options.limit),
      network,
      member,
      String(LOGIN_TRUST_MS),
    ];

    let raw: unknown;
    try {
      this.#admitSha ??= (await this.redis.script('LOAD', ADMIT_LUA)) as string;
      raw = await this.redis.evalsha(this.#admitSha, 2, failKey, trustKey, ...args);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('NOSCRIPT')) throw error;
      this.#admitSha = null;
      raw = await this.redis.eval(ADMIT_LUA, 2, failKey, trustKey, ...args);
    }

    const [allowed, rule, resetMs] = raw as [number, number, number];
    if (allowed !== 1) return { allowed: false, resetMs };
    return {
      allowed: true,
      rule: RULES[rule] ?? 'ordinary',
      resetMs,
      attempt: { failKey, trustKey, member, network },
    };
  }

  /**
   * The password was right: the slot goes back, and the network becomes one
   * this address signs in from (rule 2) — the newest `LOGIN_TRUST_MAX` kept.
   */
  async succeeded(attempt: LoginAttempt): Promise<void> {
    const now = Date.now();
    await this.redis
      .multi()
      .zrem(attempt.failKey, attempt.member)
      .zadd(attempt.trustKey, now, attempt.network)
      .zremrangebyscore(attempt.trustKey, 0, now - LOGIN_TRUST_MS)
      .zremrangebyrank(attempt.trustKey, 0, -(LOGIN_TRUST_MAX + 1))
      .pexpire(attempt.trustKey, LOGIN_TRUST_MS)
      .exec();
  }

  /** The 429 for a refused attempt, with ADR-07's headers. */
  refusal(resetMs: number): ApiError {
    const seconds = Math.max(1, Math.ceil(resetMs / 1000));
    return new ApiError(
      'too_many_requests',
      'Too many failed sign-in attempts for this email address. Retry after the interval in the Retry-After header.',
      {
        headers: {
          'Retry-After': String(seconds),
          'X-RateLimit-Limit': String(this.options.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(Date.now() / 1000) + seconds),
        },
      },
    );
  }
}
