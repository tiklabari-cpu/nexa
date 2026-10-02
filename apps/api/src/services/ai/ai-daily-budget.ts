/**
 * The daily AI caps (tm 257.8 · ADR `docs/adr/pilot-public-readiness.md`
 * K-e(3)): how many provider tokens a workspace, and the deployment as a
 * whole, may spend in one UTC day.
 *
 * Sign-up is public in the pilot. Anyone can open a workspace, install the
 * widget on a page of their choosing and let strangers talk to the model on the
 * deployment's key — nothing before this counted that spend per day, and the
 * monthly invoice meter (`usage_records`) refuses nothing. The caps bound it
 * twice: per workspace, so one tenant cannot use up the key, and for the
 * deployment, so many cannot either.
 *
 * **Counted in Postgres, in tokens.** Tokens are what the provider bills; a
 * request count is beaten by one long transcript. Postgres rather than Redis
 * because every Redis bucket here fails open (`plugins/rate-limit.ts`) and a
 * spend cap that opens when Redis is away is not a cap; a database that is away
 * fails the call instead, which leaves the visitor with a human. The counting
 * is in the `ai_budget_*` SECURITY DEFINER functions (migration
 * `20261002150000_ai_daily_usage`) — the check and the increment are one
 * statement per row, so concurrent calls cannot all slip under the line.
 *
 * **Reserve, call, settle.** A call reserves its estimate before the provider
 * is asked and settles afterwards: the estimate is handed back and what the
 * provider reported is kept (`metered-llm.ts`). Reserving first is what makes
 * the cap hold under concurrency — ten calls started at once see each other's
 * reservations — and settling is what keeps a cautious estimate from eating the
 * day's allowance.
 *
 * **A refusal is not a provider failure.** {@link AiDailyCapError} is an
 * `ApiError` (429 `limit_reached`, `details.reason: 'ai_daily_cap'`, a
 * `Retry-After` to the next UTC midnight), never an `LlmProviderError`: it is
 * thrown before any provider is reached, so it never counts toward a circuit
 * breaker — one tenant's cap must not switch the AI off for every other
 * workspace — and it is not `quota_exhausted`, which is the provider's own
 * 429 about the deployment's account.
 *
 * Every refusal writes exactly one warning line, here, where it is decided:
 * `{ event: 'ai.cap_reached', license_id, meter, scope }`.
 */
import type { PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { withTenant, type TenantContext } from '../../lib/tenant.js';

/** What a cap counts: model tokens (input + output) or embedding tokens (input). */
export const AI_METERS = ['llm', 'embedding'] as const;
export type AiMeter = (typeof AI_METERS)[number];

/** Which cap a refused call would have crossed. */
export type AiCapScope = 'workspace' | 'global';

export interface AiDailyCaps {
  llm: { workspace: number; global: number };
  embedding: { workspace: number; global: number };
}

/** The four `AI_DAILY_*` settings, by meter. */
export function aiDailyCaps(
  env: Pick<
    Env,
    | 'AI_DAILY_LLM_TOKENS_PER_WORKSPACE'
    | 'AI_DAILY_LLM_TOKENS_GLOBAL'
    | 'AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE'
    | 'AI_DAILY_EMBEDDING_TOKENS_GLOBAL'
  >,
): AiDailyCaps {
  return {
    llm: {
      workspace: env.AI_DAILY_LLM_TOKENS_PER_WORKSPACE,
      global: env.AI_DAILY_LLM_TOKENS_GLOBAL,
    },
    embedding: {
      workspace: env.AI_DAILY_EMBEDDING_TOKENS_PER_WORKSPACE,
      global: env.AI_DAILY_EMBEDDING_TOKENS_GLOBAL,
    },
  };
}

/**
 * The day a call is counted on: `yyyymmdd` in UTC. UTC, not the server's zone
 * and not the workspace's: the deployment's cap is one count for everyone, and
 * `Retry-After` has to name the same midnight for every caller.
 */
export function utcDayKey(at: Date): string {
  const yyyy = String(at.getUTCFullYear()).padStart(4, '0');
  const mm = String(at.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(at.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/** Whole seconds from `at` to the next UTC midnight — when a refused call can fit again. At least 1. */
export function secondsUntilUtcMidnight(at: Date): number {
  const midnight = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - at.getTime()) / 1000));
}

/**
 * The daily cap refused this call. A 429 for a panel route; on the visitor's
 * path the message is left for a human (`ai-responder.ts`).
 */
export class AiDailyCapError extends ApiError {
  readonly meter: AiMeter;
  readonly scope: AiCapScope;

  constructor(meter: AiMeter, scope: AiCapScope, retryAfterSeconds: number) {
    super(
      'limit_reached',
      scope === 'workspace'
        ? "Today's AI allowance for this workspace is used up; it renews at 00:00 UTC."
        : "Today's AI allowance for this service is used up; it renews at 00:00 UTC.",
      {
        details: { reason: 'ai_daily_cap', meter, scope },
        headers: { 'Retry-After': String(retryAfterSeconds) },
      },
    );
    this.meter = meter;
    this.scope = scope;
  }
}

/** A reservation in flight: settled once, on the day it was made. */
export interface AiReservation {
  readonly tenant: TenantContext;
  readonly meter: AiMeter;
  readonly day: string;
  readonly estimate: number;
}

export interface AiBudgetLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface AiDailyBudgetOptions {
  logger: AiBudgetLogger;
  /** The clock the day and `Retry-After` are read from. */
  now?: () => Date;
}

export class AiDailyBudget {
  readonly #db: PrismaClient;
  readonly #caps: AiDailyCaps;
  readonly #log: AiBudgetLogger;
  readonly #now: () => Date;

  constructor(db: PrismaClient, caps: AiDailyCaps, options: AiDailyBudgetOptions) {
    this.#db = db;
    this.#caps = caps;
    this.#log = options.logger;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Refuse now if not even `minimum` tokens would fit — before any work is
   * done for the call. `minimum` must be no more than any real call's
   * estimate, so this never refuses a call `reserve` would have let through.
   * Reads only: a workspace that is never refused has no row written by this.
   */
  async check(tenant: TenantContext, meter: AiMeter, minimum: number): Promise<void> {
    const at = this.#now();
    const caps = this.#caps[meter];
    const rows = await withTenant(
      this.#db,
      tenant,
      (tx) => tx.$queryRaw<Array<{ scope: AiCapScope | null }>>`
        SELECT ai_budget_exhausted(${utcDayKey(at)}, ${meter}, ${BigInt(minimum)},
          ${BigInt(caps.workspace)}, ${BigInt(caps.global)}) AS scope`,
    );
    const scope = rows[0]?.scope ?? null;
    if (scope) throw this.#refuse(tenant, meter, scope, at);
  }

  /**
   * Reserve `estimate` tokens on the workspace's row and the deployment's, or
   * throw {@link AiDailyCapError} and reserve nothing. Its own short
   * transaction, committed before the provider is called, so every concurrent
   * call sees it.
   */
  async reserve(tenant: TenantContext, meter: AiMeter, estimate: number): Promise<AiReservation> {
    const at = this.#now();
    const day = utcDayKey(at);
    const caps = this.#caps[meter];
    const amount = Math.max(0, Math.ceil(estimate));
    const rows = await withTenant(
      this.#db,
      tenant,
      (tx) => tx.$queryRaw<Array<{ scope: AiCapScope | null }>>`
        SELECT ai_budget_reserve(${day}, ${meter}, ${BigInt(amount)},
          ${BigInt(caps.workspace)}, ${BigInt(caps.global)}) AS scope`,
    );
    const scope = rows[0]?.scope ?? null;
    if (scope) throw this.#refuse(tenant, meter, scope, at);
    return { tenant, meter, day, estimate: amount };
  }

  /**
   * Hand the reservation back and keep `used`. Never throws: the call it
   * belongs to has already happened, and losing its answer to a counter write
   * would be the worse failure. A settle that did not land leaves the estimate
   * counted, which errs toward the cap, and is logged.
   */
  async settle(reservation: AiReservation, used: number): Promise<void> {
    const spent = Math.max(0, Math.ceil(used));
    try {
      await withTenant(
        this.#db,
        reservation.tenant,
        (tx) => tx.$executeRaw`
          SELECT ai_budget_settle(${reservation.day}, ${reservation.meter},
            ${BigInt(reservation.estimate)}, ${BigInt(spent)})`,
      );
    } catch (error) {
      this.#log.error(
        {
          err: error,
          event: 'ai.budget_settle_failed',
          license_id: reservation.tenant.licenseId.toString(),
          meter: reservation.meter,
          reserved: reservation.estimate,
          used: spent,
        },
        'daily AI cap could not be settled; the estimate stays counted',
      );
    }
  }

  #refuse(tenant: TenantContext, meter: AiMeter, scope: AiCapScope, at: Date): AiDailyCapError {
    this.#log.warn(
      { event: 'ai.cap_reached', license_id: tenant.licenseId.toString(), meter, scope },
      'daily AI cap reached; the provider was not called',
    );
    return new AiDailyCapError(meter, scope, secondsUntilUtcMidnight(at));
  }
}
