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
 *
 * **Whose cap, and what was spent on what (tm 283.2).** A workspace's cap is
 * no longer one setting for everyone: `ai-caps.ts` resolves the licence's
 * override, its plan's default and the deployment's, cached for 60 seconds,
 * and the answer is the reserve's cap parameter. Every reservation says which
 * feature it is for ({@link AiAttribution}); a simulation's is counted on the
 * `_test` meter — a fifth of the live allowance — and on the deployment's live
 * row. The settle writes one `ai_usage_events` row beside the counters, in the
 * same statement (`ai_budget_settle_usage`, migration
 * `20261015130000_ai_caps_usage_ledger`): the ledger the usage screen breaks
 * down, which never decides a refusal.
 */
import type { PrismaClient } from '@prisma/client';
import {
  AI_USAGE_METERS,
  aiLiveMeterOf,
  aiUsageMeterFor,
  type AiLiveMeter,
  type AiModelTier,
  type AiUsageMeter,
  type AiUsageSurface,
} from '@siyahtus/types';
import type { Env } from '../../config/env.js';
import { ApiError } from '../../lib/api-error.js';
import { refuseInSimulation } from '../../lib/simulation-context.js';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import {
  AiCapResolver,
  prismaCapInputs,
  type AiDailyCaps,
  type ResolvedAiCaps,
  type WorkspaceCapInputs,
} from './ai-caps.js';

export type { AiDailyCaps } from './ai-caps.js';

/**
 * What a cap counts: model tokens (input + output) or embedding tokens
 * (input), live or a simulation's (tm 283.2).
 */
export const AI_METERS = AI_USAGE_METERS;
export type AiMeter = AiUsageMeter;

/** Which cap a refused call would have crossed. */
export type AiCapScope = 'workspace' | 'global';

/**
 * Who a counted call is for, beyond the workspace — the usage ledger's row
 * (tm 283.2). `surface` decides the meter too: a `simulation` is counted on
 * the test meter. `chatId` when the call answers a conversation;
 * `configVersionId` once AI configuration versions exist (tm 290).
 */
export interface AiAttribution {
  surface: AiUsageSurface;
  chatId?: string | null;
  configVersionId?: string | null;
}

/** What a finished call cost, as the provider split it. An embedding's is all input. */
export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** The four `AI_DAILY_*` settings, by meter — the deployment's defaults. */
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

/** The next 00:00 UTC after `at` — when a refused call can fit again. */
export function nextUtcMidnight(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate() + 1));
}

/** Whole seconds from `at` to the next UTC midnight — when a refused call can fit again. At least 1. */
export function secondsUntilUtcMidnight(at: Date): number {
  return Math.max(1, Math.ceil((nextUtcMidnight(at).getTime() - at.getTime()) / 1000));
}

/**
 * The transaction a counter write on `meter` opens: a test meter's is the one
 * write a simulation may make (tm 314.2, `lib/simulation-context.ts`).
 */
function testMeterWrite(meter: AiMeter): { simulationWrite?: 'test_meter' } {
  return meter === 'llm_test' || meter === 'embedding_test'
    ? { simulationWrite: 'test_meter' }
    : {};
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

/** {@link AiAttribution} as the ledger stores it: plus the tier a completion asked for, null on an embedding. */
export interface AiLedgerAttribution {
  readonly surface: AiUsageSurface;
  readonly modelTier: AiModelTier | null;
  readonly chatId: string | null;
  readonly configVersionId: string | null;
}

/**
 * A reservation in flight: settled once, on the day it was made, on the meter
 * it was counted on. `tenant` null is operator work counted on the
 * deployment's row alone ({@link AiDailyBudget.reserveDeployment}), and has no
 * ledger row — no workspace spent it.
 */
export interface AiReservation {
  readonly tenant: TenantContext | null;
  readonly meter: AiMeter;
  readonly day: string;
  readonly estimate: number;
  /** The ledger row's attribution; null on operator work. */
  readonly ledger: AiLedgerAttribution | null;
  /** The workspace's cap on `meter` the reservation was checked against; null on operator work. */
  readonly cap: number | null;
}

/**
 * Where a workspace's counter stands after a settle, or that its cap refused a
 * call (tm 283.3) — what the usage alerts (`ai-usage-alerts.ts`) listen for.
 * `cap` is the workspace's on `meter`, as the call was checked against it.
 */
export interface AiUsageObservation {
  tenant: TenantContext;
  meter: AiMeter;
  day: string;
  cap: number;
}

/**
 * Told after every workspace settle and every workspace-scope refusal. Called
 * without being awaited and must not throw: whatever it does happens beside
 * the model call, never in its way.
 */
export interface AiUsageObserver {
  settled(observation: AiUsageObservation): void;
  refused(observation: AiUsageObservation): void;
}

export interface AiBudgetLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface AiDailyBudgetOptions {
  logger: AiBudgetLogger;
  /** The clock the day, `Retry-After` and the caps' cache are read from. */
  now?: () => Date;
  /** A workspace's override and plan default — its licence row and plan unless a test says otherwise. */
  capInputs?: (tenant: TenantContext) => Promise<WorkspaceCapInputs>;
  /**
   * The deployment's defaults, when they are not the `caps` the budget was
   * built with — where the root panel's AI settings (tm 389.17) plug in.
   */
  deploymentCaps?: () => AiDailyCaps | Promise<AiDailyCaps>;
  /** How long a workspace's resolved caps are reused (60 s). */
  capTtlMs?: number;
}

export class AiDailyBudget {
  readonly #db: PrismaClient;
  readonly #caps: AiCapResolver;
  readonly #log: AiBudgetLogger;
  readonly #now: () => Date;
  #observer: AiUsageObserver | null = null;

  /** `caps` is the deployment's defaults; a workspace's own come from its licence and plan (`ai-caps.ts`). */
  constructor(db: PrismaClient, caps: AiDailyCaps, options: AiDailyBudgetOptions) {
    this.#db = db;
    this.#log = options.logger;
    this.#now = options.now ?? (() => new Date());
    this.#caps = new AiCapResolver({
      load:
        options.capInputs ??
        prismaCapInputs(db, {
          now: () => this.#now().getTime(),
          onSettingsError: (error) =>
            this.#log.warn(
              { err: error },
              'platform AI plan defaults unreadable; the plan catalogue applies',
            ),
        }),
      deployment: options.deploymentCaps ?? (() => caps),
      ttlMs: options.capTtlMs,
      now: () => this.#now().getTime(),
    });
  }

  /**
   * Forget the cached caps of one workspace, or of every workspace — a change
   * announced on `ai.caps_changed` (`ai-caps-events.ts`).
   */
  invalidateCaps(licenseId?: bigint): void {
    this.#caps.invalidate(licenseId);
  }

  /**
   * The caps `tenant`'s calls are checked against right now — the usage
   * screen's denominators (tm 283.3), from the same 60-second cache.
   */
  async capsFor(tenant: TenantContext): Promise<ResolvedAiCaps> {
    return this.#caps.capsFor(tenant);
  }

  /**
   * Who hears where a workspace's counters stand (tm 283.3): the usage alerts.
   * Set once the server has built them — they need the mailer, which is built
   * after this budget.
   */
  observe(observer: AiUsageObserver | null): void {
    this.#observer = observer;
  }

  /**
   * Refuse now if not even `minimum` tokens would fit on `meter` — before any
   * work is done for the call. `minimum` must be no more than any real call's
   * estimate, so this never refuses a call `reserve` would have let through.
   * Reads only: a workspace that is never refused has no row written by this.
   */
  async check(tenant: TenantContext, meter: AiMeter, minimum: number): Promise<void> {
    const at = this.#now();
    const caps = await this.#caps.capsFor(tenant);
    const scope = await this.#exhausted(tenant, meter, minimum, at, caps);
    if (scope) throw this.#refuse(tenant, meter, scope, at, caps.workspace[meter]);
  }

  /**
   * {@link check}'s question without its refusal: the cap that would refuse
   * `minimum` tokens on `meter` now, or null. Reads only, logs nothing and
   * tells nobody — for a caller that asks on every poll whether the AI is
   * there at all (the widget's availability, WG-09), where a refusal is not
   * a call that was turned away.
   */
  async exhausted(
    tenant: TenantContext,
    meter: AiMeter,
    minimum: number,
  ): Promise<AiCapScope | null> {
    return this.#exhausted(tenant, meter, minimum, this.#now(), await this.#caps.capsFor(tenant));
  }

  async #exhausted(
    tenant: TenantContext,
    meter: AiMeter,
    minimum: number,
    at: Date,
    caps: ResolvedAiCaps,
  ): Promise<AiCapScope | null> {
    const rows = await withTenant(
      this.#db,
      tenant,
      (tx) => tx.$queryRaw<Array<{ scope: AiCapScope | null }>>`
        SELECT ai_budget_exhausted(${utcDayKey(at)}, ${meter}, ${BigInt(minimum)},
          ${BigInt(caps.workspace[meter])}, ${BigInt(caps.global[aiLiveMeterOf(meter)])}) AS scope`,
    );
    return rows[0]?.scope ?? null;
  }

  /**
   * Reserve `estimate` tokens on the workspace's row and the deployment's, or
   * throw {@link AiDailyCapError} and reserve nothing. Its own short
   * transaction, committed before the provider is called, so every concurrent
   * call sees it. Counted on `meter` — on its test meter when the attribution's
   * surface is a simulation. `modelTier` is the completion's tier, for the
   * ledger (`default` when not given; ignored on an embedding).
   */
  async reserve(
    tenant: TenantContext,
    meter: AiLiveMeter,
    estimate: number,
    attribution: AiAttribution,
    modelTier: AiModelTier | null = null,
  ): Promise<AiReservation> {
    const at = this.#now();
    const day = utcDayKey(at);
    const counted = aiUsageMeterFor(meter, attribution.surface);
    // Inside a simulation (tm 314.2 · AI-19-S2) a call is counted on the test
    // meter alone: one on a live meter is a defect, refused before any row moves.
    if (counted === meter) refuseInSimulation('live_meter');
    const caps = await this.#caps.capsFor(tenant);
    const amount = Math.max(0, Math.ceil(estimate));
    const rows = await withTenant(
      this.#db,
      tenant,
      (tx) => tx.$queryRaw<Array<{ scope: AiCapScope | null }>>`
        SELECT ai_budget_reserve(${day}, ${counted}, ${BigInt(amount)},
          ${BigInt(caps.workspace[counted])}, ${BigInt(caps.global[meter])}) AS scope`,
      testMeterWrite(counted),
    );
    const scope = rows[0]?.scope ?? null;
    if (scope) throw this.#refuse(tenant, counted, scope, at, caps.workspace[counted]);
    return {
      tenant,
      meter: counted,
      day,
      estimate: amount,
      cap: caps.workspace[counted],
      ledger: {
        surface: attribution.surface,
        // A completion always has a tier (the request's, else `default`); an
        // embedding never does — `ai_usage_events_model_tier_check`.
        modelTier: meter === 'llm' ? (modelTier ?? 'default') : null,
        chatId: attribution.chatId ?? null,
        configVersionId: attribution.configVersionId ?? null,
      },
    };
  }

  /**
   * Reserve `estimate` on the deployment's row only (tm 257.20), or throw
   * {@link AiDailyCapError} with scope `global` and reserve nothing.
   *
   * For operator work that no workspace asked for — `knowledge:reembed`
   * moving every workspace's stored knowledge into a new embedding space.
   * Charging that to the workspaces would switch their AI off for the day a
   * provider is changed; not counting it at all would let a migration spend
   * the deployment's key past its cap. No tenant transaction: the counting
   * function reads none (migration `20261003170000_ai_budget_deployment`).
   */
  async reserveDeployment(meter: AiLiveMeter, estimate: number): Promise<AiReservation> {
    const at = this.#now();
    const day = utcDayKey(at);
    const amount = Math.max(0, Math.ceil(estimate));
    const deployment = await this.#caps.deployment();
    const rows = await this.#db.$queryRaw<Array<{ scope: AiCapScope | null }>>`
      SELECT ai_budget_reserve_deployment(${day}, ${meter}, ${BigInt(amount)},
        ${BigInt(deployment[meter].global)}) AS scope`;
    const scope = rows[0]?.scope ?? null;
    if (scope) throw this.#refuse(null, meter, scope, at, null);
    return { tenant: null, meter, day, estimate: amount, ledger: null, cap: null };
  }

  /**
   * Hand the reservation back, keep what the call cost and — for a
   * workspace's call that cost anything — write its ledger row, in one
   * statement (`ai_budget_settle_usage`). Never throws: the call it belongs to
   * has already happened, and losing its answer to a counter write would be
   * the worse failure. A settle that did not land leaves the estimate counted,
   * which errs toward the cap; a ledger row that did not land leaves the
   * counter settled. Both are logged.
   */
  async settle(reservation: AiReservation, usage: AiTokenUsage): Promise<void> {
    const input = Math.max(0, Math.ceil(usage.inputTokens));
    const output = Math.max(0, Math.ceil(usage.outputTokens));
    const { tenant, day, meter, estimate, ledger, cap } = reservation;
    try {
      if (tenant === null || ledger === null) {
        await this.#db.$executeRaw`
          SELECT ai_budget_settle_deployment(${day}, ${meter}, ${BigInt(estimate)},
            ${BigInt(input + output)})`;
        return;
      }
      const rows = await withTenant(
        this.#db,
        tenant,
        (tx) => tx.$queryRaw<Array<{ refused: string | null }>>`
          SELECT ai_budget_settle_usage(${day}, ${meter}, ${BigInt(estimate)},
            ${BigInt(input)}, ${BigInt(output)}, ${ledger.surface}::text,
            ${ledger.modelTier}::text, ${ledger.chatId}::text,
            ${ledger.configVersionId}::uuid) AS refused`,
        testMeterWrite(meter),
      );
      const refused = rows[0]?.refused ?? null;
      if (cap !== null) this.#observe('settled', { tenant, meter, day, cap });
      if (refused) {
        this.#log.error(
          {
            event: 'ai.usage_ledger_failed',
            license_id: tenant.licenseId.toString(),
            meter,
            surface: ledger.surface,
            input_tokens: input,
            output_tokens: output,
            reason: refused,
          },
          'AI usage ledger row was not written; the daily counter is settled',
        );
      }
    } catch (error) {
      this.#log.error(
        {
          err: error,
          event: 'ai.budget_settle_failed',
          license_id: tenant ? tenant.licenseId.toString() : null,
          meter,
          reserved: estimate,
          used: input + output,
        },
        'daily AI cap could not be settled; the estimate stays counted',
      );
    }
  }

  /** Tell the observer, which never gets to fail the call it is told about. */
  #observe(kind: 'settled' | 'refused', observation: AiUsageObservation): void {
    try {
      this.#observer?.[kind](observation);
    } catch (error) {
      this.#log.error(
        { err: error, event: 'ai.usage_observer_failed', kind },
        'AI usage observer threw; the call is unaffected',
      );
    }
  }

  #refuse(
    tenant: TenantContext | null,
    meter: AiMeter,
    scope: AiCapScope,
    at: Date,
    cap: number | null,
  ): AiDailyCapError {
    this.#log.warn(
      {
        event: 'ai.cap_reached',
        license_id: tenant ? tenant.licenseId.toString() : null,
        meter,
        scope,
      },
      'daily AI cap reached; the provider was not called',
    );
    // The workspace's own allowance is used up — its owner hears (tm 283.3).
    // The deployment's is the operator's, and no workspace's notice.
    if (tenant && scope === 'workspace' && cap !== null) {
      this.#observe('refused', { tenant, meter, day: utcDayKey(at), cap });
    }
    return new AiDailyCapError(meter, scope, secondsUntilUtcMidnight(at));
  }
}
