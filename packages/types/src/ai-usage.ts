/**
 * The AI usage vocabulary (tm 283.2 · SiyahTuş analysis AI-16, AI-19-S2) —
 * what the daily AI counters and the usage ledger (`ai_usage_events`) are
 * keyed by, shared by the database's CHECK constraints, the API that writes
 * them and the screens that will read them (`GET /ai/usage`, tm 283.3/283.4).
 *
 * A surface or meter spelled two ways is a breakdown that silently drops one
 * of them, so each list here is the one the migration's CHECKs repeat
 * (`20261015130000_ai_caps_usage_ledger`).
 */

/**
 * What a daily AI counter counts. `llm` is model tokens (input + output),
 * `embedding` is embedding tokens (input). The `_test` meters are the same
 * units spent by a simulation (AI-19-S2): a separate, smaller daily allowance,
 * so testing the agent never spends what live visitors need.
 */
export const AI_USAGE_METERS = ['llm', 'embedding', 'llm_test', 'embedding_test'] as const;
export type AiUsageMeter = (typeof AI_USAGE_METERS)[number];

/** The two meters live traffic is counted on — and the deployment's cap. */
export const AI_LIVE_METERS = ['llm', 'embedding'] as const;
export type AiLiveMeter = (typeof AI_LIVE_METERS)[number];

/**
 * Which feature spent the tokens — the ledger's breakdown (AI-16).
 *
 *   - `ai_agent`        — the AI agent answering a visitor, and its Preview.
 *   - `copilot`         — the agent's assistant: summary, rewrite, its
 *                         question embedding.
 *   - `knowledge_index` — turning knowledge sources into vectors (panel,
 *                         bulk import, freshness sweep).
 *   - `simulation`      — the test lab (AI-19); counted on the `_test` meters.
 *   - `qa`              — automatic conversation review (AI-24).
 *   - `cluster`         — grouping unanswered questions (AI-22).
 *   - `coaching`        — drafting an agent's suggestion into knowledge and
 *                         looking for it in the knowledge base (AI-23).
 */
export const AI_USAGE_SURFACES = [
  'ai_agent',
  'copilot',
  'knowledge_index',
  'simulation',
  'qa',
  'cluster',
  'coaching',
] as const;
export type AiUsageSurface = (typeof AI_USAGE_SURFACES)[number];

/** The model a completion asked for (tm 283.1 `LlmCompletionRequest.tier`). Embeddings have none. */
export const AI_MODEL_TIERS = ['default', 'fast'] as const;
export type AiModelTier = (typeof AI_MODEL_TIERS)[number];

/**
 * The meter a call on `live` is counted on when `surface` spends it: a
 * simulation's on the `_test` meter, everything else on the live one. Derived,
 * never chosen by a caller, so a simulation cannot be counted against the live
 * allowance by forgetting a flag.
 */
export function aiUsageMeterFor(live: AiLiveMeter, surface: AiUsageSurface): AiUsageMeter {
  if (surface !== 'simulation') return live;
  return live === 'llm' ? 'llm_test' : 'embedding_test';
}

/** The live meter a meter's spend belongs to — what the deployment's cap counts it on. */
export function aiLiveMeterOf(meter: AiUsageMeter): AiLiveMeter {
  return meter === 'llm' || meter === 'llm_test' ? 'llm' : 'embedding';
}

/**
 * The test allowance as a share of the live one, in percent (AI-19-S2's
 * suggested default: "günlük canlı kotanın %20'si").
 */
export const AI_TEST_CAP_PERCENT = 20;

/**
 * The shares of a workspace's daily allowance that warn its owner, in percent
 * (tm 283.3 · AI-16-S2): once each per workspace, UTC day and live meter. 100
 * is also sent when the cap first refuses a call — a refusal can come a little
 * before the counter reads 100%, since a call reserves its estimate first.
 */
export const AI_USAGE_ALERT_THRESHOLDS = [80, 100] as const;
export type AiUsageAlertThreshold = (typeof AI_USAGE_ALERT_THRESHOLDS)[number];

/**
 * The thresholds `used` of `cap` has reached, lowest first. A cap is at least
 * one token, so the share is defined; integers only, so 80% of 200 000 is
 * reached at exactly 160 000 and not at a rounding of it.
 */
export function aiUsageThresholdsReached(used: number, cap: number): AiUsageAlertThreshold[] {
  if (!(cap >= 1)) return [];
  return AI_USAGE_ALERT_THRESHOLDS.filter((threshold) => used * 100 >= threshold * cap);
}

/**
 * The realtime push an alert is announced with to the people it is for (tm
 * 283.3) — `RTM_PUSH_ACTIONS` `ai_usage_alert`. Numbers only, like the usage
 * screen: no conversation, no text.
 */
export interface AiUsageAlertPush {
  meter: AiLiveMeter;
  threshold: AiUsageAlertThreshold;
  /** `yyyy-mm-dd`, UTC — the day the allowance belongs to. */
  day: string;
  used: number;
  cap: number;
}

/**
 * The Redis channel a change to a workspace's AI caps is announced on (tm 389
 * §D218 decision 5). The message is the licence id, or `*` for every
 * workspace (a plan or deployment default changed); the tenant API drops its
 * cached caps instead of waiting out the cache's 60 seconds.
 */
export const AI_CAPS_CHANGED_CHANNEL = 'ai.caps_changed';
