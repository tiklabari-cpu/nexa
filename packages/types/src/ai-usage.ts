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
 */
export const AI_USAGE_SURFACES = [
  'ai_agent',
  'copilot',
  'knowledge_index',
  'simulation',
  'qa',
  'cluster',
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
 * The Redis channel a change to a workspace's AI caps is announced on (tm 389
 * §D218 decision 5). The message is the licence id, or `*` for every
 * workspace (a plan or deployment default changed); the tenant API drops its
 * cached caps instead of waiting out the cache's 60 seconds.
 */
export const AI_CAPS_CHANGED_CHANNEL = 'ai.caps_changed';
