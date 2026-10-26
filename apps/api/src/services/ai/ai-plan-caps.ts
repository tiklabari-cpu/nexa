/**
 * Each plan's default daily AI allowance, as the root panel sets it (tm 389.12 ·
 * PLAN §D218 · design.md §B2 `ai.caps`) — the middle layer of
 * `override ?? plan ?? deployment` (`ai-caps.ts`).
 *
 * Stored in `platform_settings` under `ai.caps`, beside whatever else that key
 * comes to hold (the deployment's own figures are 389.17's), as
 *
 *     { "plans": { "growth": { "llm": 300000, "embedding": null }, … } }
 *
 * `null` (or a plan not named) inherits the plan catalogue's figure
 * (`subscription-service.ts PLANS[…].aiDailyTokens`), and that the
 * deployment's. Two readers: the tenant API through `platform_ai_settings()`
 * (the only way its role may look at a platform setting), and the platform API
 * from the table. Both go through {@link parsePlanAiCaps}, which keeps what it
 * understands and drops the rest — a malformed setting never stops a model
 * call, it only falls back to the next layer (the owner's rule of 2026-10-10).
 */
import type { PrismaClient } from '@prisma/client';
import { PLAN_IDS, type PlanAiDailyTokens, type PlanId } from '../billing/subscription-service.js';

/** The `platform_settings` key. */
export const AI_CAPS_SETTING_KEY = 'ai.caps';

/** The largest daily cap the panel accepts — far past any real day, inside a BIGINT. */
export const AI_DAILY_CAP_MAX = 10_000_000_000;

/** A plan's figures as the setting holds them; a plan not named has none. */
export type PlanAiCapDefaults = Partial<Record<PlanId, PlanAiDailyTokens>>;

function capOf(value: unknown): number | null {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= AI_DAILY_CAP_MAX
    ? value
    : null;
}

/** The plans' figures in a stored `ai.caps` value; anything unreadable is "not set". */
export function parsePlanAiCaps(value: unknown): PlanAiCapDefaults {
  const out: PlanAiCapDefaults = {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out;
  const plans = (value as Record<string, unknown>)['plans'];
  if (plans === null || typeof plans !== 'object' || Array.isArray(plans)) return out;
  for (const plan of PLAN_IDS) {
    const entry = (plans as Record<string, unknown>)[plan];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const figures = entry as Record<string, unknown>;
    const llm = capOf(figures['llm']);
    const embedding = capOf(figures['embedding']);
    if (llm !== null || embedding !== null) out[plan] = { llm, embedding };
  }
  return out;
}

/** The setting's figure for `plan`, else the catalogue's. */
export function planAiDailyTokens(
  defaults: PlanAiCapDefaults,
  plan: PlanId | null,
  catalogue: PlanAiDailyTokens,
): PlanAiDailyTokens {
  const set = plan ? defaults[plan] : undefined;
  return {
    llm: set?.llm ?? catalogue.llm,
    embedding: set?.embedding ?? catalogue.embedding,
  };
}

/**
 * The plans' figures as the tenant API may read them: `platform_ai_settings()`
 * (SECURITY DEFINER, `siyahtus_app` only), outside any tenant transaction — a
 * failed statement inside one would abort the workspace's own reads. A
 * database without the function (or any failure) reads as "nothing set".
 */
export async function readPlanAiCapsForTenant(
  db: PrismaClient,
  onError?: (error: unknown) => void,
): Promise<PlanAiCapDefaults> {
  try {
    const rows = await db.$queryRaw<Array<{ caps: unknown }>>`
      SELECT caps FROM platform_ai_settings()`;
    return parsePlanAiCaps(rows[0]?.caps ?? null);
  } catch (error) {
    onError?.(error);
    return {};
  }
}
