/**
 * The decision order (tm 297.2 · SiyahTuş analysis AI-05 §4, §5, §7;
 * assumption AI-05-S1): what a turn does with the understanding call's
 * reading. Deterministic — the reading names candidates and how sure it is;
 * this file, never the model, decides.
 *
 *   1. **Forced hand-overs.** A message the call could not read is the
 *      engine's (`notUnderstood`, AI-09 `ai_failure`); a message in a
 *      language the persona does not speak is handed over, not left in
 *      silence ({@link languageVerdict}, AI-05 §7).
 *   2. **The procedure in progress carries on** when the message continues it
 *      or answers its question — no new classification (`selectProcedure`).
 *   3. **Sure (≥ `high`)**: the procedure starts, or takes over from the one
 *      in progress. A tie (closer than 0.10) goes to the locked one, then the
 *      smaller `priority`, then the higher confidence (`rankProcedures`).
 *   4. **Unsure (`low` ≤ c < `high`)** with nothing in progress: one
 *      either-or question between the two likeliest — or "is it about X?"
 *      when only one is that likely — and never a second one straight after.
 *      On the turn after, a candidate it offered starts when it is at `low`
 *      or above and clearly ahead of the other one offered.
 *   5. **Otherwise** the knowledge path (AI-06): the one-message skills whose
 *      gate matches; small talk gets a short reply instead, with nothing
 *      searched.
 *   6. **Nothing** — no procedure, no skill: the fallback, and when there is
 *      none either, the turn is `unmatched` (AI-22 collects these).
 *
 * The fallback (`is_fallback`, AI-05 §5) is never a candidate: it is not in
 * the catalogue the call chooses from, and the engine tries it only at 6.
 *
 * Pure: the clock and the turn number are handed in, nothing is written.
 */
import {
  DEFAULT_CLARIFY_THRESHOLDS,
  isPersonaLanguage,
  personaLanguageVerdict,
  type ClarifyThresholds,
  type LanguageVerdict,
  type Persona,
  type PersonaLanguage,
} from '@siyahtus/types';
import {
  selectProcedure,
  type ProcedureSelection,
  type SelectionInput,
} from './procedure/selection.js';
import {
  PROCEDURE_TIE_MARGIN,
  rankProcedures,
  type CatalogueEntry,
} from './procedure/understanding.js';
import type { AiStateObject } from './state-store.js';
import type { SkillRunLogEntry } from './turn.js';

/** Where the clarifying question is kept between turns (`ai_conversations.signals`). */
export const CLARIFY_SIGNAL = 'clarify';

/** The question asked: the procedures it offered and the AI turn it was asked on. */
export interface ClarifyMark {
  readonly keys: readonly string[];
  readonly turn: number;
}

export type PolicyDecision =
  | Exclude<ProcedureSelection, { kind: 'none' }>
  /** Ask which of these one or two the message is about (AI-05 §4.4). */
  | { kind: 'clarify'; options: readonly CatalogueEntry[] }
  /** A short persona reply, nothing searched (AI-05 §4.5). */
  | { kind: 'smalltalk' }
  /** The knowledge path, then the fallback, then `unmatched` (AI-05 §4.5–§4.6). */
  | { kind: 'knowledge' };

/**
 * Which rule decided, for the decision record and the "why this procedure"
 * of the test screen (AI-05 §8, AI-19): keys and numbers, no words.
 */
export interface PolicyRecord {
  /**
   * The rule's place in the order (AI-05 §4): 2 carry on, 3 start, 4 ask,
   * 5 knowledge or small talk, 6 the fallback or nothing.
   */
  step: 2 | 3 | 4 | 5 | 6;
  rule:
    | 'continue'
    | 'start'
    | 'resume'
    | 'declined'
    | 'clarified'
    | 'clarify'
    | 'smalltalk'
    | 'knowledge'
    | 'fallback'
    | 'unmatched';
  /** The procedure keys a clarifying question offered. */
  options?: string[];
  high: number;
  low: number;
}

export interface PolicyInput extends Omit<SelectionInput, 'high'> {
  readonly thresholds: ClarifyThresholds;
  /** The clarifying question kept in the conversation, if any. */
  readonly clarified: ClarifyMark | null;
  /** The AI turns taken before this one (`counters.turns`). */
  readonly turnsTaken: number;
}

export interface PolicyResult {
  readonly decision: PolicyDecision;
  /** What `ai_conversations.suspended` holds after the turn. */
  readonly suspended: SelectionInput['suspended'];
  readonly log: SkillRunLogEntry[];
  readonly record: PolicyRecord;
}

/** At most this many procedures in one clarifying question (AI-05-S1). */
export const CLARIFY_OPTIONS_MAX = 2;

export function decide(input: PolicyInput): PolicyResult {
  const { high, low } = input.thresholds;
  const { understanding, active } = input;
  const at = (step: PolicyRecord['step'], rule: PolicyRecord['rule'], options?: string[]) => ({
    step,
    rule,
    ...(options ? { options } : {}),
    high,
    low,
  });

  // The question asked on the AI's previous turn: its answer is read now, and
  // a second one is not asked (AI-05 §4.4).
  const justAsked =
    input.clarified !== null && input.clarified.turn === input.turnsTaken ? input.clarified : null;

  // 2–3 (and the set-aside topic): `selectProcedure`, at the agent's `high`.
  const picked = selectProcedure({ ...input, high });
  if (picked.selection.kind !== 'none') {
    const { selection } = picked;
    const rule: PolicyRecord['rule'] = selection.kind;
    return {
      decision: selection,
      suspended: picked.suspended,
      log: picked.log,
      record: at(selection.kind === 'continue' ? 2 : 3, rule),
    };
  }
  const log = [...picked.log];
  const note = (detail: string) => log.push({ step: 'policy', detail, ok: true });

  if (active === null) {
    const likely = rankProcedures(understanding, input.catalogue, low);
    if (justAsked) {
      // The answer to the question: one of the procedures it offered, named
      // at `low` or above and clearly ahead of the other — the same unsure
      // message again is no answer — or, when it offered one, a plain yes.
      const offered = likely.filter((candidate) => justAsked.keys.includes(candidate.entry.key));
      const [first, second] = offered;
      const chosen =
        (first && (!second || first.confidence - second.confidence >= PROCEDURE_TIE_MARGIN)
          ? first.entry
          : undefined) ??
        (justAsked.keys.length === 1 && understanding.yes_no === 'yes'
          ? input.catalogue.find((entry) => entry.key === justAsked.keys[0])
          : undefined);
      if (chosen) {
        note(`${chosen.name} — the answer to the clarifying question`);
        return {
          decision: { kind: 'start', key: chosen.key },
          suspended: picked.suspended,
          log,
          record: at(4, 'clarified'),
        };
      }
      note('still unclear after the clarifying question — no second one is asked');
    } else if (likely.length > 0) {
      const options = likely.slice(0, CLARIFY_OPTIONS_MAX).map((candidate) => candidate.entry);
      note(`unsure between ${options.map((entry) => entry.name).join(' and ')} — asking which`);
      return {
        decision: { kind: 'clarify', options },
        suspended: picked.suspended,
        log,
        record: at(
          4,
          'clarify',
          options.map((entry) => entry.key),
        ),
      };
    }
  }

  if (understanding.intent.smalltalk === true) {
    return {
      decision: { kind: 'smalltalk' },
      suspended: picked.suspended,
      log,
      record: at(5, 'smalltalk'),
    };
  }
  return {
    decision: { kind: 'knowledge' },
    suspended: picked.suspended,
    log,
    record: at(5, 'knowledge'),
  };
}

/** The clarifying question as the conversation keeps it. */
export function clarifySignal(options: readonly CatalogueEntry[], turn: number): AiStateObject {
  return { keys: options.map((entry) => entry.key), turn };
}

/** The question kept in `signals`, or null for none or a malformed one. */
export function readClarifyMark(signals: AiStateObject): ClarifyMark | null {
  const raw = signals[CLARIFY_SIGNAL];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { keys, turn } = raw as Record<string, unknown>;
  if (
    !Array.isArray(keys) ||
    keys.length === 0 ||
    !keys.every((key) => typeof key === 'string') ||
    typeof turn !== 'number' ||
    !Number.isInteger(turn)
  ) {
    return null;
  }
  return { keys: keys as string[], turn };
}

/**
 * The question (AI-05-S1), in the language the reply is in: the procedures by
 * their names, which are the workspace's own words.
 */
export function clarifyQuestion(
  options: readonly CatalogueEntry[],
  language: PersonaLanguage | null,
): string {
  const [first, second] = options.map((entry) => entry.name);
  const phrase = CLARIFY_PHRASES[language ?? 'tr'];
  return second === undefined ? phrase.one(first as string) : phrase.two(first as string, second);
}

const CLARIFY_PHRASES: Readonly<
  Record<PersonaLanguage, { one: (a: string) => string; two: (a: string, b: string) => string }>
> = {
  tr: {
    one: (a) => `Doğru anladıysam “${a}” konusunda mı yardım istiyorsunuz?`,
    two: (a, b) =>
      `Tam anlayamadım: “${a}” konusunda mı, yoksa “${b}” konusunda mı yardım istiyorsunuz?`,
  },
  en: {
    one: (a) => `Just to be sure — is this about “${a}”?`,
    two: (a, b) => `Just to be sure — is this about “${a}” or “${b}”?`,
  },
  de: {
    one: (a) => `Nur zur Sicherheit: Geht es um „${a}“?`,
    two: (a, b) => `Nur zur Sicherheit: Geht es um „${a}“ oder um „${b}“?`,
  },
  fr: {
    one: (a) => `Pour être sûr : s’agit-il de « ${a} » ?`,
    two: (a, b) => `Pour être sûr : s’agit-il de « ${a} » ou de « ${b} » ?`,
  },
  es: {
    one: (a) => `Para asegurarme: ¿se trata de «${a}»?`,
    two: (a, b) => `Para asegurarme: ¿se trata de «${a}» o de «${b}»?`,
  },
};

/**
 * Whether the persona serves the message, and in which language (AI-05 §7).
 * The rule (`personaLanguageVerdict`) decides for the languages it knows; the
 * understanding's `language` adds the ones it cannot tell — a message in
 * Russian to a Turkish persona is a hand-over (AI-09), never a silence. A
 * model's guess at a language the rule knows does not overrule it: "ORD-99231"
 * is in no language, and treating a guess as a detection would turn away a
 * customer whose language is declared.
 */
export function languageVerdict(
  message: string,
  persona: Persona,
  understood: string | null | undefined,
): LanguageVerdict {
  const rule = personaLanguageVerdict(message, persona);
  if (!understood || isPersonaLanguage(understood) || rule.detected !== null) return rule;
  if (persona.languages.length > 0 && !persona.languages.includes(understood)) {
    return { detected: null, answerIn: null, unsupported: true };
  }
  return rule;
}

/**
 * The thresholds of the agents a turn's skills belong to: one agent's own;
 * several agents' strictest — the higher `high` and the higher `low` (each
 * pair keeps `low` below `high`, so the pair of maxima does too).
 */
export function turnThresholds(pairs: readonly ClarifyThresholds[]): ClarifyThresholds {
  if (pairs.length === 0) return { ...DEFAULT_CLARIFY_THRESHOLDS };
  return {
    high: Math.max(...pairs.map((pair) => pair.high)),
    low: Math.max(...pairs.map((pair) => pair.low)),
  };
}
