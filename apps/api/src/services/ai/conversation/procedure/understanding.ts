/**
 * What the procedure executor needs to know about a message (tm 296.3 ·
 * SiyahTuş analysis AI-03 §4, §7; AI-05 §3), and how the candidates it names
 * are ranked.
 *
 * The understanding call (`../understand.ts`, tm 297.1 · AI-05) reads every
 * message once and answers in one JSON object: which procedure it is about and
 * how sure it is, whether it continues the active one or answers the question
 * the AI asked, a yes/no, the slot values it heard (AI-04), the answers to the
 * procedure's `ai` conditions (AI-03). {@link ProcedureUnderstanding} is the
 * part of that object the executor reads, under the same names, so the call's
 * output goes in as it comes. With `LLM_PROVIDER=mock` the call is answered
 * by `../understand-mock.ts`, the deterministic reading that stood here as
 * `interimUnderstanding` until #297.
 */
import type { SlotDef } from '@siyahtus/types';
import type { AiStateObject } from '../state-store.js';

/**
 * The part of the understanding call's answer (AI-05 §3 · ADR §6a) a
 * procedure turn reads. Field names are the call's JSON.
 */
export interface ProcedureUnderstanding {
  readonly intent: {
    /** The procedure the message is about — a skill id — or null. */
    readonly procedure_key: string | null;
    /** 0–1. */
    readonly confidence: number;
    readonly alternatives?: ReadonlyArray<{ readonly key: string; readonly confidence: number }>;
    /** The message carries on the active procedure. */
    readonly is_continuation?: boolean;
  };
  /** The message answers the question the AI is waiting on. */
  readonly answers_pending_question?: boolean;
  readonly yes_no?: 'yes' | 'no' | null;
  /** AI-04's `extracted` and `correction`, read by `applyExtraction`. */
  readonly extracted?: unknown;
  readonly correction?: unknown;
  /** The `ai` conditions' answers, keyed as `procedureAiQuestions` keys them. */
  readonly ai_conditions?: Readonly<Record<string, unknown>>;
}

/**
 * The understanding at which a procedure starts, or takes over from the active
 * one — AI-05's `clarify_thresholds.high` default (0.70). The agent's own
 * thresholds and the clarifying question between them are #297.2's.
 */
export const PROCEDURE_START_CONFIDENCE = 0.7;

/** Two candidates closer than this are a tie, broken by the policy (AI-05 §4.3). */
export const PROCEDURE_TIE_MARGIN = 0.1;

/** A procedure the turn may start, as the selection sees it. */
export interface CatalogueEntry {
  /** The skill's id — the understanding's `procedure_key`. */
  readonly key: string;
  readonly name: string;
  /** "Ne zaman kullanılır" — what the understanding call selects by. */
  readonly whenToUse?: string;
  readonly examples: readonly string[];
  readonly priority: number;
  /** A locked template copy (self-exclusion, responsible gaming) — first, always. */
  readonly locked: boolean;
}

/** One candidate and how sure the understanding is of it. */
export interface RankedProcedure {
  readonly entry: CatalogueEntry;
  readonly confidence: number;
}

/**
 * The candidates in the order the policy takes them (AI-05 §4.3): by
 * confidence, except that two within {@link PROCEDURE_TIE_MARGIN} of each
 * other are ordered locked first, then the smaller `priority`, then the higher
 * confidence. Only candidates at {@link PROCEDURE_START_CONFIDENCE} or above.
 */
export function rankProcedures(
  understanding: ProcedureUnderstanding,
  catalogue: readonly CatalogueEntry[],
): RankedProcedure[] {
  const byKey = new Map(catalogue.map((entry) => [entry.key, entry]));
  const scored = new Map<string, number>();
  const offer = (key: string | null | undefined, confidence: unknown) => {
    if (!key || typeof confidence !== 'number' || !Number.isFinite(confidence)) return;
    if (!byKey.has(key)) return;
    scored.set(key, Math.max(scored.get(key) ?? 0, confidence));
  };
  offer(understanding.intent.procedure_key, understanding.intent.confidence);
  for (const alternative of understanding.intent.alternatives ?? []) {
    offer(alternative.key, alternative.confidence);
  }
  const ranked = [...scored]
    .filter(([, confidence]) => confidence >= PROCEDURE_START_CONFIDENCE)
    .map(([key, confidence]) => ({ entry: byKey.get(key) as CatalogueEntry, confidence }));
  const top = Math.max(0, ...ranked.map((candidate) => candidate.confidence));
  return ranked.sort((a, b) => {
    const tied =
      top - a.confidence < PROCEDURE_TIE_MARGIN && top - b.confidence < PROCEDURE_TIE_MARGIN;
    if (tied) {
      if (a.entry.locked !== b.entry.locked) return a.entry.locked ? -1 : 1;
      if (a.entry.priority !== b.entry.priority) return a.entry.priority - b.entry.priority;
    }
    return b.confidence - a.confidence;
  });
}

/** The question the AI is waiting on: the awaiting `collect`'s slots that are still open. */
export interface PendingQuestion {
  readonly defs: readonly SlotDef[];
  readonly slots: AiStateObject;
  /** The slot names the `collect` asks for. */
  readonly asked: readonly string[];
  /** The procedure waiting — its key. */
  readonly key: string;
}
