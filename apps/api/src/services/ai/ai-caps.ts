/**
 * Which daily AI caps apply to a workspace (tm 283.2 · SiyahTuş analysis
 * AI-16-S2, AI-19-S2 · PLAN §D231).
 *
 * Until this, every workspace had the deployment's one allowance
 * (`AI_DAILY_*_PER_WORKSPACE`). A workspace's cap is now, per live meter,
 *
 *     licence override  ??  plan default  ??  deployment default
 *
 *   - **override** — `licenses.ai_daily_{llm,embedding}_tokens_cap`, set by
 *     the platform (psql today, the root panel's 389.12 later), never by the
 *     workspace: `licenses_ai_caps_platform_only` refuses the tenant API's role.
 *   - **plan** — the plan catalogue's `aiDailyTokens`
 *     (`billing/subscription-service.ts`). Both plans leave it unset today:
 *     self-serve gets the deployment's default, and Enterprise's allowance is a
 *     contract term, which is what the override is for.
 *   - **deployment** — the four `AI_DAILY_*` settings; once the root panel's AI
 *     settings land (389.17, `platform_ai_settings().caps`), whatever the server
 *     passes as `AiDailyBudgetOptions.deploymentCaps`.
 *
 * The test meters (`llm_test`, `embedding_test`) have no figures of their own:
 * a simulation may spend {@link AI_TEST_CAP_PERCENT}% of the live allowance
 * (AI-19-S2). The deployment's cap is the deployment's alone — no workspace
 * overrides the key's ceiling.
 *
 * **The answer is a parameter, not a lookup inside the counter.** The resolved
 * cap is handed to `ai_budget_reserve`, whose one `INSERT … ON CONFLICT DO
 * UPDATE … WHERE` is still the check and the increment together; nothing here
 * reads the counter.
 *
 * **Cached for 60 seconds per workspace**, so a model call does not cost an
 * extra query. A change is announced on `ai.caps_changed`
 * (`AI_CAPS_CHANGED_CHANNEL`) and drops the cache at once
 * (`ai-caps-events.ts`); without the announcement it takes effect within the
 * minute. An invalidation that arrives while a workspace's caps are being read
 * keeps that read out of the cache — it may predate the change.
 */
import { AI_TEST_CAP_PERCENT, type AiLiveMeter, type AiUsageMeter } from '@siyahtus/types';
import type { PrismaClient } from '@prisma/client';
import { readEntitlements } from '../../lib/entitlements.js';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { aiDailyTokensForPlan, type PlanAiDailyTokens } from '../billing/subscription-service.js';

/** The deployment's defaults: the per-workspace allowance and the deployment's own cap, per live meter. */
export interface AiDailyCaps {
  llm: { workspace: number; global: number };
  embedding: { workspace: number; global: number };
}

/** A workspace's own figures, as stored — null inherits the next layer. */
export interface WorkspaceCapInputs {
  override: PlanAiDailyTokens;
  plan: PlanAiDailyTokens;
}

/** The caps a call is checked against: the workspace's per meter, the deployment's per live meter. */
export interface ResolvedAiCaps {
  workspace: Record<AiUsageMeter, number>;
  global: Record<AiLiveMeter, number>;
}

/** A simulation's allowance: {@link AI_TEST_CAP_PERCENT}% of the live one, at least one token. */
export function testCap(live: number): number {
  return Math.max(1, Math.floor((live * AI_TEST_CAP_PERCENT) / 100));
}

/** `override ?? plan ?? deployment` per live meter, and the test meters from the result. */
export function resolveAiCaps(inputs: WorkspaceCapInputs, deployment: AiDailyCaps): ResolvedAiCaps {
  const live = (meter: AiLiveMeter): number =>
    inputs.override[meter] ?? inputs.plan[meter] ?? deployment[meter].workspace;
  const llm = live('llm');
  const embedding = live('embedding');
  return {
    workspace: { llm, embedding, llm_test: testCap(llm), embedding_test: testCap(embedding) },
    global: { llm: deployment.llm.global, embedding: deployment.embedding.global },
  };
}

/**
 * A stored cap as a number the counter can take: null stays null (inherit);
 * anything past `Number.MAX_SAFE_INTEGER` is held there, since the counter's
 * parameter is a BIGINT and a float rounded above its range would be refused.
 */
export function storedCap(value: bigint | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(value);
}

/**
 * The workspace's override and its plan's default, read in the workspace's
 * own transaction — the licence row by id (one organization may hold several
 * licences) and the plan the way the entitlement gate reads it.
 */
export function prismaCapInputs(
  db: PrismaClient,
): (tenant: TenantContext) => Promise<WorkspaceCapInputs> {
  return (tenant) =>
    withTenant(db, tenant, async (tx) => {
      const license = await tx.license.findUnique({
        where: { id: tenant.licenseId },
        select: { aiDailyLlmTokensCap: true, aiDailyEmbeddingTokensCap: true },
      });
      const { plan } = await readEntitlements(tx, tenant);
      return {
        override: {
          llm: storedCap(license?.aiDailyLlmTokensCap),
          embedding: storedCap(license?.aiDailyEmbeddingTokensCap),
        },
        plan: aiDailyTokensForPlan(plan),
      };
    });
}

export interface AiCapResolverOptions {
  /** A workspace's override and plan default ({@link prismaCapInputs} on the server). */
  load: (tenant: TenantContext) => Promise<WorkspaceCapInputs>;
  /** The deployment's defaults — the environment's today. */
  deployment: () => AiDailyCaps | Promise<AiDailyCaps>;
  /** How long a workspace's caps are reused. */
  ttlMs?: number;
  /** Milliseconds, for the cache's expiry. */
  now?: () => number;
  /** Workspaces kept; the oldest entry goes first past this. */
  maxEntries?: number;
}

export const AI_CAPS_TTL_MS = 60_000;
const MAX_ENTRIES = 10_000;

export class AiCapResolver {
  readonly #load: AiCapResolverOptions['load'];
  readonly #deployment: AiCapResolverOptions['deployment'];
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #maxEntries: number;
  readonly #entries = new Map<string, { caps: ResolvedAiCaps; expires: number }>();
  /** Bumped by every invalidation; a read that saw it change is not cached. */
  #generation = 0;

  constructor(options: AiCapResolverOptions) {
    this.#load = options.load;
    this.#deployment = options.deployment;
    this.#ttlMs = options.ttlMs ?? AI_CAPS_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#maxEntries = options.maxEntries ?? MAX_ENTRIES;
  }

  /** The deployment's defaults, read fresh — for operator work, which no workspace pays for. */
  async deployment(): Promise<AiDailyCaps> {
    return this.#deployment();
  }

  /** The caps `tenant`'s calls are checked against right now. */
  async capsFor(tenant: TenantContext): Promise<ResolvedAiCaps> {
    const key = tenant.licenseId.toString();
    const hit = this.#entries.get(key);
    if (hit && hit.expires > this.#now()) return hit.caps;

    const generation = this.#generation;
    const [inputs, deployment] = await Promise.all([this.#load(tenant), this.#deployment()]);
    const caps = resolveAiCaps(inputs, deployment);
    if (generation === this.#generation) {
      this.#entries.delete(key);
      if (this.#entries.size >= this.#maxEntries) {
        const oldest = this.#entries.keys().next().value;
        if (oldest !== undefined) this.#entries.delete(oldest);
      }
      this.#entries.set(key, { caps, expires: this.#now() + this.#ttlMs });
    }
    return caps;
  }

  /**
   * Forget one workspace's caps, or every workspace's (`undefined`: a plan or
   * deployment default changed). The next call reads them again.
   */
  invalidate(licenseId?: bigint): void {
    this.#generation += 1;
    if (licenseId === undefined) this.#entries.clear();
    else this.#entries.delete(licenseId.toString());
  }
}
