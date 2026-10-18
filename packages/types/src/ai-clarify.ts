/**
 * When the AI is sure enough to start a procedure, and when it asks first
 * (tm 297.2 · SiyahTuş analysis AI-05 §4; assumption AI-05-S1).
 *
 * The understanding call names the procedure a message is about and how sure
 * it is (0–1). The decision order reads that number against the agent's two
 * thresholds:
 *
 *   - `high` and above — the procedure starts, or takes over from the one in
 *     progress;
 *   - `low` up to `high` — the AI asks one either-or question between the two
 *     likeliest procedures, and never a second one straight after it;
 *   - below `low` — no procedure: the knowledge path, then the fallback.
 *
 * Kept in the agent's `persona` JSON (`clarifyThresholds`) beside
 * `batchWindowSeconds` and `dailyMemory`, so no column is needed.
 */

/** An AI agent's thresholds (`AiAgent.clarify_thresholds`). */
export interface ClarifyThresholds {
  high: number;
  low: number;
}

/** An agent that never set them (AI-05 §4.3, §4.4). */
export const DEFAULT_CLARIFY_THRESHOLDS: Readonly<ClarifyThresholds> = Object.freeze({
  high: 0.7,
  low: 0.4,
});

/**
 * Why a pair cannot be stored, or null: both within 0–1, `low` above 0 —
 * at 0 every message would be "unsure" — and below `high`, or there is no
 * room left to ask in.
 */
export function clarifyThresholdsProblem(thresholds: ClarifyThresholds): string | null {
  const { high, low } = thresholds;
  if (!Number.isFinite(high) || high <= 0 || high > 1) return 'high must be above 0 and at most 1';
  if (!Number.isFinite(low) || low <= 0 || low > 1) return 'low must be above 0 and at most 1';
  if (low >= high) return 'low must be below high';
  return null;
}

/**
 * The agent's thresholds from its `persona` JSON, the defaults for a missing,
 * malformed or contradictory pair — like `readDailyMemory`. Read as a pair:
 * one valid number beside a broken one would make a pair nobody chose.
 */
export function readClarifyThresholds(persona: unknown): ClarifyThresholds {
  const stored =
    persona && typeof persona === 'object' && !Array.isArray(persona)
      ? (persona as Record<string, unknown>)['clarifyThresholds']
      : undefined;
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { ...DEFAULT_CLARIFY_THRESHOLDS };
  }
  const { high, low } = stored as Record<string, unknown>;
  if (typeof high !== 'number' || typeof low !== 'number') return { ...DEFAULT_CLARIFY_THRESHOLDS };
  return clarifyThresholdsProblem({ high, low }) === null
    ? { high, low }
    : { ...DEFAULT_CLARIFY_THRESHOLDS };
}
