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
  detectLanguage,
  isPersonaLanguage,
  normaliseLanguage,
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
  ru: {
    one: (a) => `Уточню: речь идёт о «${a}»?`,
    two: (a, b) => `Уточню: речь идёт о «${a}» или о «${b}»?`,
  },
  az: {
    one: (a) => `Dəqiqləşdirim: söhbət «${a}» barədədir?`,
    two: (a, b) => `Dəqiqləşdirim: söhbət «${a}», yoxsa «${b}» barədədir?`,
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
  understood: LanguageInput,
  conversation?: ConversationLanguage,
): LanguageVerdict {
  if (conversation) return conversationVerdict(message, persona, understood, conversation);
  const model = languageReadingOf(understood).language;
  const rule = personaLanguageVerdict(message, persona);
  if (!model || isPersonaLanguage(model) || rule.detected !== null) return rule;
  if (persona.languages.length > 0 && !persona.languages.includes(model)) {
    return { detected: null, answerIn: null, unsupported: true };
  }
  return rule;
}

// ---------------------------------------------------------------------------
// The conversation's language (tm 387 · AI-30).
// ---------------------------------------------------------------------------

/** Where the conversation's language is kept between turns (`ai_conversations.signals`). */
export const LANGUAGE_SIGNAL = 'language';

/** Below this the understanding's reading of the language is no reading (AI-30 §1). */
export const LANGUAGE_CONFIDENCE_MIN = 0.7;

/** A message shorter than this says nothing about its language ("ok", "tamam"). */
export const LANGUAGE_WORDS_MIN = 3;

/**
 * The conversation's language as kept: `current` the one it is in (null:
 * the player has not shown one yet), `pending` a different one the last
 * confident message was in — a second one in a row switches to it.
 */
export interface LanguageTrack {
  readonly current: string | null;
  readonly pending: string | null;
}

export const NO_LANGUAGE_TRACK: LanguageTrack = Object.freeze({ current: null, pending: null });

/** What a turn knows of the conversation's language before it reads the message. */
export interface ConversationLanguage {
  readonly track: LanguageTrack;
  /** The visitor's widget language (`customers.locale`), when the turn knows it. */
  readonly visitor?: string | null;
}

/** The understanding's reading, as it reaches a verdict: the code alone, or with its confidence. */
export type LanguageInput =
  | string
  | { readonly language?: string | null; readonly language_confidence?: number | null }
  | null
  | undefined;

export interface LanguageReading {
  readonly language: string | null;
  readonly confidence: number | null;
}

export function languageReadingOf(input: LanguageInput): LanguageReading {
  if (!input) return { language: null, confidence: null };
  if (typeof input === 'string') return { language: input, confidence: null };
  return { language: input.language ?? null, confidence: input.language_confidence ?? null };
}

export function readLanguageTrack(signals: AiStateObject): LanguageTrack {
  const raw = signals[LANGUAGE_SIGNAL];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return NO_LANGUAGE_TRACK;
  const { current, pending } = raw as Record<string, unknown>;
  const code = (value: unknown) => (typeof value === 'string' ? normaliseLanguage(value) : null);
  return { current: code(current), pending: code(pending) };
}

export function languageSignal(track: LanguageTrack): AiStateObject {
  return { current: track.current, pending: track.pending };
}

function wordCount(message: string): number {
  return message.split(/[^\p{L}\p{M}\p{N}']+/u).filter(Boolean).length;
}

/**
 * The language one message is confidently in, or null (AI-30 §1). The
 * persona rule first — it knows the languages it speaks and needs two of
 * their small words; the understanding's reading for the rest, when it is
 * sure enough. A model reading with no confidence counts only for a
 * language the rule does not know (the reading before tm 387). Under three
 * words, nothing.
 */
export function confidentLanguage(message: string, understood: LanguageInput): string | null {
  if (wordCount(message) < LANGUAGE_WORDS_MIN) return null;
  const rule = detectLanguage(message);
  if (rule !== null) return rule;
  const { language, confidence } = languageReadingOf(understood);
  const code = normaliseLanguage(language);
  if (code === null) return null;
  if (confidence === null) return isPersonaLanguage(code) ? null : code;
  return confidence >= LANGUAGE_CONFIDENCE_MIN ? code : null;
}

/**
 * The track after one message: a first confident language is the
 * conversation's at once; a different one replaces it only when two
 * confident messages in a row are in it. A message with no confident
 * language changes nothing.
 */
export function nextLanguageTrack(track: LanguageTrack, language: string | null): LanguageTrack {
  if (language === null) return track;
  if (track.current === null || track.current === language || track.pending === language) {
    return { current: language, pending: null };
  }
  return { current: track.current, pending: language };
}

/**
 * The language a conversation with no confident message yet is answered in:
 * the visitor's widget language when the persona speaks it, the persona's
 * default, else its first declared language it can phrase (the fallback
 * before tm 387).
 */
export function startingLanguage(
  persona: Persona,
  visitor?: string | null,
): PersonaLanguage | null {
  const widget = normaliseLanguage(visitor ?? null);
  if (isPersonaLanguage(widget) && persona.languages.includes(widget)) return widget;
  if (persona.defaultLanguage && isPersonaLanguage(persona.defaultLanguage)) {
    return persona.defaultLanguage;
  }
  return persona.languages.find(isPersonaLanguage) ?? null;
}

function conversationVerdict(
  message: string,
  persona: Persona,
  understood: LanguageInput,
  conversation: ConversationLanguage,
): LanguageVerdict {
  const track = nextLanguageTrack(conversation.track, confidentLanguage(message, understood));
  return verdictInLanguage(persona, track.current, conversation.visitor);
}

/**
 * The verdict for a conversation in `language` (null: none shown yet) —
 * what {@link languageVerdict} gives once the message has moved the track.
 */
export function verdictInLanguage(
  persona: Persona,
  language: string | null,
  visitor?: string | null,
): LanguageVerdict {
  if (language === null) {
    return { detected: null, answerIn: startingLanguage(persona, visitor), unsupported: false };
  }
  const detected = isPersonaLanguage(language) ? language : null;
  if (persona.languages.length > 0 && !persona.languages.includes(language)) {
    return { detected, answerIn: null, unsupported: true };
  }
  return {
    detected,
    answerIn: detected ?? startingLanguage(persona, visitor),
    unsupported: false,
  };
}

/**
 * The verdict a finished turn stands on, for the words said around it (the
 * after-hours line, the AI disclosure): the language the turn kept in
 * `signals`; a turn that kept none reads the message as before.
 */
export function turnLanguageVerdict(
  message: string,
  persona: Persona,
  result: { nextState: { signals: AiStateObject }; decisions: { understood?: LanguageInput } },
): LanguageVerdict {
  const { current } = readLanguageTrack(result.nextState.signals);
  if (current !== null) return verdictInLanguage(persona, current);
  return languageVerdict(message, persona, result.decisions.understood);
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
