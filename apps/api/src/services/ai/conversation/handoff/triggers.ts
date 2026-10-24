/**
 * The hand-over triggers (tm 303.2 · SiyahTuş analysis AI-09; owner decision
 * K9): when the AI hands a conversation to a person on its own, what it tells
 * the player as it does, and the reasons every hand-over carries.
 *
 * Pure, like the rest of the engine: the turn's state, message and result go
 * in, a turn comes out. The workspace's settings (`ai_handoff_settings.triggers`,
 * `.messages`, `.after_hours`, tm 303.1) reach a turn through its configuration
 * (`TurnConfig.handoff`, read by `turn-config.ts` — ADR-14b §2.6), never from
 * the table.
 *
 * Where each trigger is judged (AI-09 §1):
 *
 *   - **input** — a person asked for in words (G16). Handed over at once, as
 *     every guardrail is — unless the topic is not known yet and this is the
 *     first ask, when the understanding call decides (below).
 *   - **understanding** ({@link understandVerdict}), right after the call and
 *     before the decision order: `player_request` (`wants_human.explicit`, or
 *     G16's words held from the input) — the one clarifying question G16
 *     allows ("what is it about?") when the topic is not known and it is the
 *     first ask, a person otherwise; `negative_sentiment` — an angry player, or
 *     `consecutive` negative turns, asked about first when `ask_first`.
 *   - **the procedure** — `max_turns` (the workspace's limit over the
 *     procedure's own, {@link effectiveMaxTurns}), `missing_required_info` (a
 *     required answer refused), `repeat_same_day` (the same problem again
 *     today: only the procedure's questions are asked, then a person).
 *   - **the end of the turn** ({@link settleHandoffTurn}): `loop_detected` (the
 *     same question from the AI twice in a row, the same message from the
 *     player three times), `not_understood` (`turns` in a row with no intent,
 *     no continuation and no answer — asked about once when `ask_first`), and
 *     every hand-over's reasons, priority and words.
 *
 * Every hand-over carries all of its reasons as catalogue codes
 * ({@link catalogueReason}), most severe first — the first is its primary
 * reason (`primaryHandoffReason`) — and says the reason's message as written
 * (no model, AI-09 §4): the workspace's, or the default. `ai_failure` and
 * `unsupported_language` are no longer silences. A stored risk flag's
 * hand-over (AI-27) stays silent unless the workspace wrote a message for it;
 * `no_knowledge`'s turn already said `no_answer.text` (AI-06).
 */
import {
  DEFAULT_HANDOFF_AFTER_HOURS_TEXT,
  DEFAULT_HANDOFF_MESSAGES,
  GUARDRAIL_LANGS,
  HANDOFF_MESSAGE_REASONS,
  HANDOFF_REASON_INFO,
  RESOLUTION_UNMET_REASON,
  isHandoffReason,
  readHandoffAfterHours,
  readHandoffMessages,
  readHandoffTriggers,
  readResolutionCriteria,
  type Cond,
  type GuardrailLang,
  type GuardrailPriority,
  type HandoffAfterHours,
  type HandoffMessageReason,
  type HandoffMessages,
  type HandoffReason,
  type HandoffTriggers,
  type PersonaLanguage,
} from '@siyahtus/types';
import { safeText } from '../guardrails/guardrail-turn.js';
import { playerSummaryLine } from './card-builder.js';
import { morePressing, routingRule, ruleTarget, type HandoffRuleConfig } from './rules.js';
import type { HandoffRouteConfig } from './target-resolver.js';
import {
  NO_ANSWER_PHRASES,
  NO_ANSWER_SIGNAL,
  noAnswerSignal,
  readNoAnswerMark,
} from '../knowledge-answer.js';
import { foldTr } from '../slots/normalize-tr.js';
import type { AiStateObject } from '../state-store.js';
import {
  handoffOf,
  tookTurn,
  turnsTaken,
  type TurnDecisions,
  type TurnHistory,
  type TurnMessage,
  type TurnResult,
  type TurnState,
} from '../turn.js';

// ---------------------------------------------------------------------------
// The settings a turn carries.
// ---------------------------------------------------------------------------

/** The turn agent's hand-over settings, as its configuration carries them. */
export interface HandoffConfig {
  readonly triggers: HandoffTriggers;
  readonly messages: HandoffMessages;
  readonly afterHours: HandoffAfterHours;
  /**
   * The workspace's active hand-over rules, in order (tm 303.3 · K9 —
   * `./rules.ts`). Absent: none.
   */
  readonly rules?: readonly HandoffRuleConfig[];
  /**
   * The workspace's active hand-over routes (tm 307.2 · AI-12 · ADR-14b
   * §2.12): the AI's copy, which its target is resolved from
   * (`./target-resolver.ts`). Absent: none.
   */
  readonly routes?: readonly HandoffRouteConfig[];
  /**
   * The workspace's default "resolved" criteria (tm 303.4 · K9 —
   * `../resolution.ts`). Absent: the platform's, the player's yes.
   */
  readonly resolution?: Cond;
}

/** An agent with no `ai_handoff_settings` row: AI-09-S1/S2's defaults, the default words. */
export const DEFAULT_HANDOFF_CONFIG: HandoffConfig = Object.freeze({
  triggers: readHandoffTriggers(null),
  messages: readHandoffMessages(null),
  afterHours: readHandoffAfterHours(null),
});

/** The stored row read the way the API reads it — null is the defaults. */
export function readHandoffConfig(
  row: {
    triggers: unknown;
    messages: unknown;
    afterHours: unknown;
    resolutionCriteria?: unknown;
  } | null,
): HandoffConfig {
  if (!row) return DEFAULT_HANDOFF_CONFIG;
  const resolution = readResolutionCriteria(row.resolutionCriteria);
  return {
    triggers: readHandoffTriggers(row.triggers),
    messages: readHandoffMessages(row.messages),
    afterHours: readHandoffAfterHours(row.afterHours),
    ...(resolution ? { resolution } : {}),
  };
}

/**
 * The turns a procedure may take before it hands over with `max_turns`: the
 * workspace's limit when it is on and lower than the procedure's own; the
 * procedure's own otherwise (a procedure always has one, AI-03).
 */
export function effectiveMaxTurns(procedureLimit: number, triggers: HandoffTriggers): number {
  return triggers.max_turns.enabled
    ? Math.min(procedureLimit, triggers.max_turns.turns)
    : procedureLimit;
}

// ---------------------------------------------------------------------------
// Reasons and priority.
// ---------------------------------------------------------------------------

/**
 * The catalogue code of a reason the engine hands over with. The guardrails
 * and the triggers name catalogue codes already; a procedure names its own
 * (`slot_refused`, `procedure_condition`, its step's `reason_code`), and a
 * provider failure or a cap is named after what failed.
 */
export function catalogueReason(raw: string | null | undefined): HandoffReason {
  if (isHandoffReason(raw)) return raw;
  switch (raw) {
    case 'slot_refused':
      return 'missing_required_info';
    // K9 (tm 303.4): the "resolved" criteria were not met — the AI could not
    // solve it, as when the player says so; the "AI could not" rule routes it.
    case RESOLUTION_UNMET_REASON:
      return 'player_said_unresolved';
    case 'llm_failure':
    case 'embedding_failure':
    case 'ai_cap_reached':
    case 'ai_challenge_unverified':
      return 'ai_failure';
    default:
      return 'procedure_rule';
  }
}

/** The reasons once each, most severe first — the first is the primary reason. */
export function orderHandoffReasons(reasons: readonly HandoffReason[]): HandoffReason[] {
  return [...new Set(reasons)].sort(
    (a, b) => HANDOFF_REASON_INFO[a].rank - HANDOFF_REASON_INFO[b].rank,
  );
}

/**
 * How urgent the hand-over is (AI-12 §3): a guardrail's own priority —
 * `urgent` for self-harm, a minor, a self-exclusion — and `high` for the same
 * problem again today or an angry player; `normal` otherwise.
 */
export function handoffPriority(
  reasons: readonly HandoffReason[],
  given: GuardrailPriority | undefined,
  angry: boolean,
): GuardrailPriority {
  if (given === 'urgent') return 'urgent';
  if (given === 'high' || angry || reasons.includes('repeat_same_day')) return 'high';
  return given ?? 'normal';
}

// ---------------------------------------------------------------------------
// Words.
// ---------------------------------------------------------------------------

function isMessageReason(reason: HandoffReason): reason is HandoffMessageReason {
  return (HANDOFF_MESSAGE_REASONS as readonly string[]).includes(reason);
}

/**
 * Whether the hand-over tells the player what they gave (AI-10-S1): not when a
 * guardrail, a stored risk flag or abuse set it off — a crisis text or a
 * refusal is no place for "Papara, 2.500 TL" — nor in a language the persona
 * does not speak.
 */
function tellsPlayerSummary(reasons: readonly HandoffReason[]): boolean {
  return !reasons.some(
    (reason) =>
      reason.startsWith('guardrail_') ||
      reason === 'risk_flag' ||
      reason === 'abuse' ||
      reason === 'unsupported_language',
  );
}

function guardrailLang(lang: PersonaLanguage | null): GuardrailLang {
  return lang !== null && (GUARDRAIL_LANGS as readonly string[]).includes(lang)
    ? (lang as GuardrailLang)
    : lang === null
      ? 'tr'
      : 'en';
}

/**
 * What the player is told for `reason` as the AI hands over: the workspace's
 * message, as written, or the default in the turn's language — the defaults
 * are Turkish and English; another persona language says its own "a person
 * takes over". Null for `no_knowledge`, whose turn said `no_answer.text`.
 */
export function handoffWords(
  config: HandoffConfig,
  reason: HandoffReason,
  answerIn: PersonaLanguage | null,
): string | null {
  if (!isMessageReason(reason)) return null;
  const own = config.messages[reason];
  if (own) return own;
  if (answerIn !== null && !(GUARDRAIL_LANGS as readonly string[]).includes(answerIn)) {
    return NO_ANSWER_PHRASES[answerIn].handingOver;
  }
  return DEFAULT_HANDOFF_MESSAGES[reason][guardrailLang(answerIn)];
}

/** What the player is told when nobody can take the conversation now (AI-12 §4). */
export function afterHoursWords(config: HandoffConfig, answerIn: PersonaLanguage | null): string {
  return config.afterHours.text ?? DEFAULT_HANDOFF_AFTER_HOURS_TEXT[guardrailLang(answerIn)];
}

/** The fixed questions the triggers ask — no promise, no model. */
export interface HandoffPhrases {
  /** G16's one clarifying question: what it is about, so the right team takes it. */
  topic: string;
  /** "Shall I pass you to a person?" — `ask_first`, once per conversation. */
  offer: string;
}

export const HANDOFF_PHRASES: Readonly<Record<PersonaLanguage, HandoffPhrases>> = {
  tr: {
    topic: 'Sizi doğru ekibe aktarabilmem için konuyu kısaca yazar mısınız?',
    offer: 'Sizi bir temsilcimize aktarmamı ister misiniz?',
  },
  en: {
    topic: 'So I can pass you to the right team, could you tell me briefly what it is about?',
    offer: 'Would you like me to pass you to one of our agents?',
  },
  de: {
    topic:
      'Damit ich Sie an das richtige Team weiterleiten kann: Worum geht es, kurz zusammengefasst?',
    offer: 'Möchten Sie, dass ich Sie mit einem unserer Mitarbeiter verbinde?',
  },
  fr: {
    topic:
      'Pour vous orienter vers la bonne équipe, pouvez-vous me dire brièvement de quoi il s’agit ?',
    offer: 'Voulez-vous que je vous transfère à l’un de nos conseillers ?',
  },
  es: {
    topic: 'Para pasarle al equipo adecuado, ¿podría decirme brevemente de qué se trata?',
    offer: '¿Quiere que le pase con uno de nuestros agentes?',
  },
};

/** A reply the engine says for any hand-over — what the workspace's own message replaces. */
function isStockReply(reply: string, answerIn: PersonaLanguage | null): boolean {
  return reply === safeText(answerIn) || reply === NO_ANSWER_PHRASES[answerIn ?? 'tr'].handingOver;
}

// ---------------------------------------------------------------------------
// What the triggers keep between turns (`ai_conversations.signals.handoff`).
// ---------------------------------------------------------------------------

export const HANDOFF_SIGNAL = 'handoff';

/**
 * The counts the triggers keep: turns not understood in a row, negative turns
 * in a row, and the AI turn G16's question was asked on (null: never).
 */
export interface HandoffMark {
  readonly not_understood: number;
  readonly negative: number;
  readonly topic_asked: number | null;
}

const NO_MARK: HandoffMark = Object.freeze({ not_understood: 0, negative: 0, topic_asked: null });

function countOf(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

export function readHandoffMark(signals: AiStateObject): HandoffMark {
  const raw = signals[HANDOFF_SIGNAL];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return NO_MARK;
  const stored = raw as Record<string, unknown>;
  const asked = stored['topic_asked'];
  return {
    not_understood: countOf(stored['not_understood']),
    negative: countOf(stored['negative']),
    topic_asked: typeof asked === 'number' && Number.isInteger(asked) ? asked : null,
  };
}

function sameMark(a: HandoffMark, b: HandoffMark): boolean {
  return (
    a.not_understood === b.not_understood &&
    a.negative === b.negative &&
    a.topic_asked === b.topic_asked
  );
}

// ---------------------------------------------------------------------------
// The understanding's triggers.
// ---------------------------------------------------------------------------

/** What the understanding call read that the triggers act on — no words. */
export interface HandoffReading {
  readonly sentiment: 'positive' | 'neutral' | 'negative' | 'angry' | null;
  /** The player asked for a person in so many words (`wants_human.explicit`). */
  readonly wantsHuman: boolean;
  readonly procedureKey: string | null;
}

/** The reading off an understanding — a handed-in one (a test, a simulation) may say less. */
export function readingOf(understanding: {
  readonly intent: { readonly procedure_key: string | null };
}): HandoffReading {
  const raw = understanding as {
    readonly sentiment?: unknown;
    readonly wants_human?: { readonly explicit?: unknown };
  };
  const sentiment = raw.sentiment;
  return {
    sentiment:
      sentiment === 'positive' ||
      sentiment === 'neutral' ||
      sentiment === 'negative' ||
      sentiment === 'angry'
        ? sentiment
        : null,
    wantsHuman: raw.wants_human?.explicit === true,
    procedureKey: understanding.intent.procedure_key,
  };
}

export type UnderstandVerdict =
  /** A person now, for these reasons. */
  | { readonly kind: 'handoff'; readonly reasons: readonly HandoffReason[] }
  /** G16's one question: what is it about? */
  | { readonly kind: 'ask_topic' }
  /** The turn goes on — offering a person at its end, for `offer`, when not null. */
  | { readonly kind: 'go_on'; readonly offer: HandoffReason | null };

/**
 * The understanding's triggers (AI-09 §2): the player asked for a person —
 * `wants_human.explicit`, or G16's words held from the input (`requested`) —
 * or is upset. Returns the verdict and the counts after this turn.
 *
 * A person asked for: at once when the topic is known (`topicKnown` — a
 * procedure in progress or set aside, or the one the call named) or G16's
 * question was asked already; otherwise that one question (AI-09-S1).
 * Upset: angry, or `consecutive` negative turns in a row (an angry one counts);
 * asked about first when `ask_first` and no person was offered yet.
 */
export function understandVerdict(input: {
  reading: HandoffReading;
  requested: boolean;
  topicKnown: boolean;
  mark: HandoffMark;
  triggers: HandoffTriggers;
  /** A person was offered in this conversation already (asked once, AI-06-S1). */
  offered: boolean;
}): { verdict: UnderstandVerdict; mark: HandoffMark; angry: boolean } {
  const { reading, triggers } = input;
  const upset = reading.sentiment === 'negative' || reading.sentiment === 'angry';
  const mark: HandoffMark = { ...input.mark, negative: upset ? input.mark.negative + 1 : 0 };
  const angry = reading.sentiment === 'angry';

  if (reading.wantsHuman || input.requested) {
    if (input.topicKnown || mark.topic_asked !== null) {
      return { verdict: { kind: 'handoff', reasons: ['player_request'] }, mark, angry };
    }
    return { verdict: { kind: 'ask_topic' }, mark, angry };
  }

  const negative = triggers.negative_sentiment;
  if (negative.enabled && (angry || (upset && mark.negative >= negative.consecutive))) {
    if (negative.ask_first && !input.offered) {
      return { verdict: { kind: 'go_on', offer: 'negative_sentiment' }, mark, angry };
    }
    return { verdict: { kind: 'handoff', reasons: ['negative_sentiment'] }, mark, angry };
  }
  return { verdict: { kind: 'go_on', offer: null }, mark, angry };
}

// ---------------------------------------------------------------------------
// Turns the triggers decide.
// ---------------------------------------------------------------------------

function stepped(state: TurnState, message: TurnMessage): TurnState {
  return {
    ...state,
    counters: { ...state.counters, turns: turnsTaken(state) + 1 },
    lastProcessedEventSeq: Math.max(state.lastProcessedEventSeq, message.throughSeq ?? 0),
  };
}

const NOTHING_SPENT = { llmInputTokens: 0, llmOutputTokens: 0, embeddingTokens: 0 };

/**
 * A hand-over a trigger decides. Nothing is said yet — the end of the turn
 * says the reason's message ({@link settleHandoffTurn}) — and a procedure in
 * progress stays where it stood: nothing of it ran.
 */
export function triggerHandoffTurn(
  state: TurnState,
  message: TurnMessage,
  input: {
    reasons: readonly HandoffReason[];
    detail: string;
    decided: Partial<TurnDecisions>;
    skill?: { id: string; name: string } | null;
    /** The workspace's rule that set it off (`tenant_rule`): its team and priority. */
    rule?: HandoffRuleConfig;
  },
): TurnResult {
  const reasons = orderHandoffReasons(input.reasons);
  const { rule } = input;
  const primary = reasons[0] as HandoffReason;
  return {
    reply: null,
    decisions: {
      outcome: 'handed_off',
      skillId: input.skill?.id ?? null,
      skillName: input.skill?.name ?? null,
      failure: null,
      capped: null,
      usage: NOTHING_SPENT,
      ...input.decided,
      replyKind: null,
      handoffReason: primary,
      log: [...(input.decided.log ?? []), { step: 'handoff', detail: input.detail, ok: true }],
    },
    sideEffects: [
      {
        kind: 'handoff',
        team: null,
        reason: primary,
        reasons,
        ...(rule ? { ...ruleTarget(rule), priority: rule.priority, ruleId: rule.id } : {}),
      },
    ],
    nextState: stepped(state, message),
  };
}

/** G16's one clarifying question (AI-09-S1): what is it about, so the right team takes it. */
export function topicQuestionTurn(
  state: TurnState,
  message: TurnMessage,
  input: { answerIn: PersonaLanguage | null; decided: Partial<TurnDecisions> },
): TurnResult {
  return {
    reply: HANDOFF_PHRASES[input.answerIn ?? 'tr'].topic,
    decisions: {
      outcome: 'answered',
      skillId: null,
      skillName: null,
      failure: null,
      capped: null,
      usage: NOTHING_SPENT,
      ...input.decided,
      replyKind: 'question',
      log: [
        ...(input.decided.log ?? []),
        {
          step: 'handoff',
          detail: 'the player asked for a person — asked what it is about first (G16)',
          ok: true,
        },
      ],
    },
    sideEffects: [],
    nextState: stepped(state, message),
  };
}

// ---------------------------------------------------------------------------
// The end of the turn.
// ---------------------------------------------------------------------------

/** The policy rules that mean the AI knew what the player meant. */
const UNDERSTOOD_RULES = new Set(['continue', 'start', 'resume', 'declined', 'clarified']);

/**
 * Whether the turn is one the AI could not tell what the player wants (AI-09
 * `not_understood`): no intent, not carrying on, and no answer — the knowledge
 * base had none, nothing took the message, or the AI could only ask which
 * topic. Null when no understanding call ran: nothing to count.
 */
export function notUnderstoodTurn(
  reading: HandoffReading | null,
  decisions: TurnDecisions,
): boolean | null {
  if (!reading) return null;
  if (reading.procedureKey !== null) return false;
  const rule = decisions.policy?.rule;
  if (rule !== undefined && UNDERSTOOD_RULES.has(rule)) return false;
  return decisions.unanswered !== undefined || rule === 'unmatched' || rule === 'clarify';
}

function normalised(text: string): string {
  return foldTr(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Whether the conversation goes round in a circle (AI-09 `loop_detected`):
 * the AI would ask the question it asked last, or the player wrote the same
 * thing for the third time in a row, the AI answering each time.
 */
export function loopDetected(input: {
  reply: string | null;
  replyKind: TurnDecisions['replyKind'];
  text: string;
  history: TurnHistory | undefined;
}): 'question_repeated' | 'message_repeated' | null {
  const messages = input.history?.messages ?? [];
  const lastAssistant = [...messages].reverse().find((entry) => entry.role === 'assistant');
  if (
    input.reply &&
    input.replyKind === 'question' &&
    lastAssistant &&
    normalised(lastAssistant.content) === normalised(input.reply)
  ) {
    return 'question_repeated';
  }
  // The same message, answered each time: the last exchanges alternate — a
  // message left to a person in between (a hand-back) is no loop.
  const said = normalised(input.text);
  const last = messages.slice(-4);
  if (
    said !== '' &&
    last.length === 4 &&
    last.every((entry, i) => entry.role === (i % 2 === 0 ? 'user' : 'assistant')) &&
    normalised(last[0]?.content ?? '') === said &&
    normalised(last[2]?.content ?? '') === said
  ) {
    return 'message_repeated';
  }
  return null;
}

/** What the turn's triggers noted on the way, for its end. */
export interface HandoffWatch {
  /** G16's words at input, held for the understanding call to say whether the topic is known. */
  requested: boolean;
  /** The understanding call's reading, when it ran. */
  reading: HandoffReading | null;
  /** The counts after the understanding's triggers, when they ran. */
  mark: HandoffMark | null;
  /** A person to offer at the end of the turn (`ask_first`). */
  offer: HandoffReason | null;
  angry: boolean;
}

export function openHandoffWatch(): HandoffWatch {
  return { requested: false, reading: null, mark: null, offer: null, angry: false };
}

/** The turn turned into a hand-over at its end: what it would have said is not said. */
function handOverInstead(result: TurnResult, reason: HandoffReason, detail: string): TurnResult {
  return {
    ...result,
    reply: null,
    decisions: {
      ...result.decisions,
      outcome: 'handed_off',
      replyKind: null,
      handoffReason: reason,
      log: [...result.decisions.log, { step: 'handoff', detail, ok: true }],
    },
    sideEffects: [
      ...result.sideEffects.filter((effect) => effect.kind !== 'handoff'),
      { kind: 'handoff', team: null, reason, reasons: [reason] },
    ],
  };
}

/**
 * The end of every turn the AI took (AI-09 §2–§4):
 *
 *   1. the end-of-turn triggers on a turn that would not hand over — a loop,
 *      then `not_understood` at its count (offered once when `ask_first`),
 *      then the understanding's offer (`negative_sentiment` with `ask_first`);
 *   2. a hand-over's reasons — its own, `ai_failure` when the AI could not
 *      answer, and those the triggers noted (a person asked for, the count of
 *      turns not understood) — as catalogue codes, most severe first, with its
 *      priority;
 *   3. its words: a silent hand-over says its primary reason's message; the
 *      workspace's own message replaces the engine's stock "a person takes
 *      over" (and follows the crisis text); when nobody is accepting chats
 *      (`available` false) the after-hours text follows (AI-12 §4);
 *   4. the counts kept for the next turn.
 */
export function settleHandoffTurn(input: {
  state: TurnState;
  message: TurnMessage;
  result: TurnResult;
  config: HandoffConfig;
  watch: HandoffWatch;
  answerIn: PersonaLanguage | null;
  /** Whether anyone is accepting chats now; absent: not known, nothing is said of it. */
  available?: boolean;
}): TurnResult {
  const { state, message, config, watch, answerIn } = input;
  let out = input.result;
  if (!tookTurn(out)) return out;
  const { triggers } = config;

  const before = watch.mark ?? readHandoffMark(state.signals);
  const missed = notUnderstoodTurn(watch.reading, out.decisions);
  const mark: HandoffMark = {
    ...before,
    not_understood:
      missed === null ? before.not_understood : missed ? before.not_understood + 1 : 0,
  };
  const notUnderstoodDue =
    missed === true &&
    triggers.not_understood.enabled &&
    mark.not_understood >= triggers.not_understood.turns;
  // A person offered before, or by this very turn (the no-answer's "shall I?"):
  // either is the one offer `ask_first` asks for.
  const offeredBefore = readNoAnswerMark(state.signals) !== null;
  const offeringNow = !offeredBefore && readNoAnswerMark(out.nextState.signals) !== null;
  const extra: HandoffReason[] = watch.requested ? ['player_request'] : [];
  let offer: HandoffReason | null = null;

  if (!handoffOf(out.sideEffects) && out.decisions.outcome !== 'handed_off') {
    const loop = triggers.loop_detected.enabled
      ? loopDetected({
          reply: out.reply,
          replyKind: out.decisions.replyKind,
          text: message.text,
          history: message.history,
        })
      : null;
    if (loop) {
      out = handOverInstead(
        out,
        'loop_detected',
        loop === 'question_repeated'
          ? 'the AI would ask the question it asked last — handed to a human (loop_detected)'
          : 'the player wrote the same message a third time — handed to a human (loop_detected)',
      );
    } else if (notUnderstoodDue && offeringNow) {
      // The turn asks whether to hand over already: that is the one offer.
    } else if (notUnderstoodDue && triggers.not_understood.ask_first && !offeredBefore) {
      offer = 'not_understood';
    } else if (notUnderstoodDue) {
      out = handOverInstead(
        out,
        'not_understood',
        `${mark.not_understood} turns in a row not understood — handed to a human (not_understood)`,
      );
    } else if (watch.offer && !offeredBefore && !offeringNow) {
      offer = watch.offer;
    }
  } else if (notUnderstoodDue) {
    extra.push('not_understood');
  }

  const handoff = handoffOf(out.sideEffects);
  if (handoff) {
    const { decisions } = out;
    const reasons = orderHandoffReasons([
      ...(handoff.reasons ?? [catalogueReason(handoff.reason)]),
      ...(decisions.failure || decisions.capped ? (['ai_failure'] as const) : []),
      ...extra,
    ]);
    const primary = reasons[0] as HandoffReason;
    // A routing rule (K9): the AI could not solve it, or a person was asked
    // for — the workspace's team and priority, unless the hand-over names its own.
    const routed = routingRule(config.rules ?? [], reasons);
    const computed = handoffPriority(reasons, handoff.priority, watch.angry);
    const priority = routed ? morePressing(computed, routed.priority) : computed;
    const routedTo =
      routed &&
      handoff.groupId === undefined &&
      handoff.topic === undefined &&
      handoff.team === null
        ? ruleTarget(routed)
        : {};
    const own = isMessageReason(primary) ? config.messages[primary] : null;
    // A language the persona does not speak is told in English, the likelier read.
    const lang = primary === 'unsupported_language' ? 'en' : answerIn;
    let reply = out.reply;
    if (reply === null) {
      // A stored risk flag says a person answers (AI-27): silent, unless the
      // workspace wrote a message for it.
      const words = primary === 'risk_flag' && !own ? null : handoffWords(config, primary, lang);
      if (words) reply = words;
    } else if (own && isStockReply(reply, answerIn)) {
      reply = own;
    } else if (own && primary === 'guardrail_self_harm' && !reply.includes(own)) {
      // The crisis text first, whatever else is said (AI-08 G3).
      reply = `${reply}\n${own}`;
    }
    // What the player gave, told back with the hand-over (tm 304.1 ·
    // AI-10-S1): a value read wrong can be corrected before a person starts
    // from it. Not with a guardrail's, a risk flag's or abuse's hand-over.
    const told =
      reply !== null && tellsPlayerSummary(reasons)
        ? playerSummaryLine(out.nextState, answerIn)
        : null;
    if (told && reply !== null && !reply.includes(told)) reply = `${reply}\n${told}`;
    if (input.available === false && reply !== null) {
      reply = `${reply}\n${afterHoursWords(config, answerIn)}`;
    }
    // No line of its own in the run log: the turn's last step stays the one
    // that decided (the decision record's `step`); the reasons are on the record.
    out = {
      ...out,
      reply,
      decisions: {
        ...decisions,
        outcome: 'handed_off',
        replyKind: reply === null ? null : (decisions.replyKind ?? 'answer'),
        handoffReasons: reasons,
        // For the card (AI-10): how the player came across, when it was read.
        ...(watch.reading ? { sentiment: watch.reading.sentiment } : {}),
      },
      sideEffects: out.sideEffects.map((effect) =>
        effect.kind === 'handoff'
          ? {
              ...effect,
              ...routedTo,
              reason: effect.reason ?? primary,
              reasons,
              priority,
              ...(routed ? { ruleId: routed.id } : {}),
            }
          : effect,
      ),
    };
  }

  let signals = out.nextState.signals;
  if (offer) {
    const phrase = HANDOFF_PHRASES[answerIn ?? 'tr'].offer;
    out = {
      ...out,
      reply: out.reply ? `${out.reply}\n${phrase}` : phrase,
      decisions: {
        ...out.decisions,
        replyKind: 'question',
        log: [
          ...out.decisions.log,
          { step: 'handoff', detail: `offered a person (${offer})`, ok: true },
        ],
      },
    };
    signals = {
      ...signals,
      [NO_ANSWER_SIGNAL]: noAnswerSignal(turnsTaken(out.nextState), offer),
    };
  }
  if (!sameMark(mark, readHandoffMark(state.signals))) {
    signals = { ...signals, [HANDOFF_SIGNAL]: { ...mark } as unknown as AiStateObject };
  }
  return signals === out.nextState.signals
    ? out
    : { ...out, nextState: { ...out.nextState, signals } };
}
