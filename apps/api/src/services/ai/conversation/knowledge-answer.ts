/**
 * A knowledge answer and the "I cannot answer this" behind it (tm 298 ·
 * SiyahTuş analysis AI-06; ADR `pilot-llm-embedding-provider.md` §6a).
 *
 * The engine (`conversation-engine.ts`) runs the path: a question no procedure
 * takes is searched in the knowledge base, an answer is written from the
 * passages found, and when there is none the AI says so. What is decided here
 * is everything about that path that does not need a provider:
 *
 *   - **The written answer is an object** (§6a.1): `{ reply, grounded,
 *     cited_ids }`. `grounded` is the model's own reading of whether the
 *     passages answer the question — `full`, `partial` (the answer, and an
 *     offer of a person for the rest) or `none` (no answer: nothing of the
 *     reply is used). `cited_ids` names the passages the reply is drawn from,
 *     by the labels the prompt gave them (`P1`, `P2`, …) — never by anything
 *     the model could make up (§6a.2).
 *   - **The gate on a draft** (`readKnowledgeAnswer`): a citation of a passage
 *     the prompt did not give, a grounded reply that cites nothing, or a figure
 *     with a unit — an amount, a limit, a duration, a percentage, a multiplier
 *     — that no passage gives (`inventedFigures`). In iGaming an invented
 *     limit or time is money lost and a complaint (G17); "I don't know" is
 *     always better. A draft that breaks a rule is written once more with the
 *     rule named; a second that breaks one is withheld and the AI says it
 *     cannot answer (the AI-08 output check's place, #301).
 *   - **Where a question goes when there is no answer** (AI-06-S1): its group
 *     (`noAnswerCategory` — money, account, bonus, responsible gaming, other)
 *     and the agent's `no_answer` policy for it: a person at once, or asked
 *     once. The sentences are fixed and in the reply's language; the
 *     workspace may put the hand-over one in its own words.
 *   - **What AI-22 collects** (`ai.unanswered`): the group, the policy applied
 *     and why there was no answer — no words; the decision record links the
 *     message (`UnansweredRecord`).
 *
 * AI-13's tables (#310) answer a question about a table row before anything is
 * searched — "Papara ile en az ne kadar yatırabilirim?" is the row's value,
 * not a passage's paraphrase. The seam is {@link KnowledgeFacts}; until the
 * tables exist it knows nothing.
 */
import {
  ANSWER_BUDGETS,
  DEFAULT_ANSWER_PASSAGES,
  isHandoffReason,
  shapeAnswer,
  type HandoffReason,
  type NoAnswerCategory,
  type NoAnswerPolicy,
  type PersonaLanguage,
} from '@siyahtus/types';
import type { AnswerGrounding } from '../provider/answer-prompt.js';
import type { JsonSchema } from '../provider/json-schema.js';
import type { LlmResponseFormat } from '../provider/llm-provider.js';
import type { ProcedureUnderstanding } from './procedure/understanding.js';
import { foldTr, parseBooleanTr } from './slots/normalize-tr.js';
import type { AiStateObject } from './state-store.js';

export const KNOWLEDGE_ANSWER_RESPONSE_NAME = 'knowledge_answer';

export const KNOWLEDGE_GROUNDINGS = ['full', 'partial', 'none'] as const;
export type KnowledgeGrounded = (typeof KNOWLEDGE_GROUNDINGS)[number];

export const KNOWLEDGE_ANSWER_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'grounded', 'cited_ids'],
  properties: {
    reply: { type: 'string' },
    grounded: { type: 'string', enum: KNOWLEDGE_GROUNDINGS },
    cited_ids: { type: 'array', items: { type: 'string' } },
  },
};

export const KNOWLEDGE_ANSWER_RESPONSE_FORMAT: LlmResponseFormat = {
  name: KNOWLEDGE_ANSWER_RESPONSE_NAME,
  schema: KNOWLEDGE_ANSWER_SCHEMA,
};

/** The object the schema admits. */
export interface KnowledgeAnswerReply {
  reply: string;
  grounded: KnowledgeGrounded;
  cited_ids: string[];
}

/** The label the prompt gives the passage at `index` — what `cited_ids` names. */
export function passageLabel(index: number): string {
  return `P${index + 1}`;
}

/** Why a draft is not sent as it is. Kinds and counts, never the reply's words. */
export type DraftProblem =
  | { kind: 'unknown_citation'; count: number }
  | { kind: 'uncited' }
  | { kind: 'invented_figure'; figures: string[] };

export interface ReadKnowledgeAnswer {
  /** The reply, trimmed; empty when `grounded` is `none`. */
  reply: string;
  grounded: KnowledgeGrounded;
  /** The labels cited that the prompt gave, in the order cited. */
  cited: string[];
  problems: DraftProblem[];
}

/**
 * The draft as the engine may use it. `none`, or an empty reply, is no answer
 * and nothing else is checked; otherwise every rule in the file header.
 */
export function readKnowledgeAnswer(
  value: KnowledgeAnswerReply,
  given: { labels: readonly string[]; sources: readonly string[] },
): ReadKnowledgeAnswer {
  const reply = value.reply.trim();
  if (value.grounded === 'none' || reply === '') {
    return { reply: '', grounded: 'none', cited: [], problems: [] };
  }
  const known = new Set(given.labels);
  const cited = [...new Set(value.cited_ids)].filter((id) => known.has(id));
  const unknown = new Set(value.cited_ids.filter((id) => !known.has(id))).size;
  const problems: DraftProblem[] = [];
  if (unknown > 0) problems.push({ kind: 'unknown_citation', count: unknown });
  if (value.cited_ids.length === 0) problems.push({ kind: 'uncited' });
  const figures = inventedFigures(reply, given.sources);
  if (figures.length > 0) problems.push({ kind: 'invented_figure', figures });
  return { reply, grounded: value.grounded, cited, problems };
}

/** The sentence the second draft is asked with: the rules it broke, in the model's terms. */
export function rewriteNote(problems: readonly DraftProblem[]): string {
  const parts = problems.map((problem) => {
    switch (problem.kind) {
      case 'unknown_citation':
        return 'it cited passage ids that were not given';
      case 'uncited':
        return 'it cited no passage';
      case 'invented_figure':
        return `it gave figures no passage gives (${problem.figures.join(', ')})`;
    }
  });
  return `Your previous reply could not be sent: ${parts.join('; ')}. Write it again from the passages alone, citing the ids of the passages you use; if they do not answer the question, set grounded to "none".`;
}

/** The run log's words for a withheld draft: kinds and counts, no values. */
export function problemDetail(problems: readonly DraftProblem[]): string {
  return problems
    .map((problem) =>
      problem.kind === 'invented_figure'
        ? `${problem.figures.length} figure(s) no passage gives`
        : problem.kind === 'unknown_citation'
          ? `${problem.count} citation(s) of a passage it was not given`
          : 'no passage cited',
    )
    .join(', ');
}

// ---------------------------------------------------------------------------
// Figures with a unit (AI-06 §11).
// ---------------------------------------------------------------------------

export type FigureUnit = 'currency' | 'minute' | 'hour' | 'day' | 'percent' | 'multiplier';

interface Figure {
  raw: string;
  values: number[];
  unit: FigureUnit;
  start: number;
  end: number;
}

const NUMBER = String.raw`\d+(?:[.,]\d+)*`;

/** A unit after the number; a short one must not run on into a word ("10 xyz"). */
const UNIT_AFTER: ReadonlyArray<[FigureUnit, string]> = [
  ['currency', String.raw`(?:tl|try|lira|usdt|usd|eur|euro|₺|\$|€)(?![\p{L}\d])`],
  ['percent', String.raw`%`],
  ['minute', String.raw`(?:dk|dak|min|mins)(?![\p{L}])|dakika\p{L}*|minutes?(?![\p{L}])`],
  ['hour', String.raw`(?:sa|h|hr|hrs)(?![\p{L}])|saat\p{L}*|hours?(?![\p{L}])`],
  ['day', String.raw`(?:iş\s+)?gün\p{L}*|(?:business\s+)?days?(?![\p{L}])`],
  ['multiplier', String.raw`(?:x|kat\p{L}*|times)(?![\p{L}])`],
];

/** A unit before the number: "₺100", "%10", "yüzde 10", "x30". */
const UNIT_BEFORE: ReadonlyArray<[FigureUnit, string]> = [
  ['currency', String.raw`[₺$€]`],
  ['percent', String.raw`%|yüzde\s`],
  ['multiplier', String.raw`(?<![\p{L}])x`],
];

/**
 * Dates and clock times are not figures (AI-06 risk note): "18.10.2026",
 * "2026-10-18", "14:30" — the sentence around them is left alone.
 */
const DATES_AND_TIMES =
  /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/g;

function prepared(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase('tr')
    .replace(DATES_AND_TIMES, (match) => ' '.repeat(match.length));
}

function figuresIn(text: string): Figure[] {
  const source = prepared(text);
  const found: Figure[] = [];
  const taken = (start: number, end: number) =>
    found.some((figure) => start < figure.end && end > figure.start);
  for (const [unit, pattern] of UNIT_AFTER) {
    const re = new RegExp(String.raw`(?<![\d.,])(${NUMBER})\s?(?:${pattern})`, 'gu');
    for (const match of source.matchAll(re)) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken(start, end)) continue;
      found.push({ raw: match[0].trim(), values: numberValues(match[1]!), unit, start, end });
    }
  }
  for (const [unit, pattern] of UNIT_BEFORE) {
    const re = new RegExp(String.raw`(?:${pattern})\s?(${NUMBER})(?![\d])`, 'gu');
    for (const match of source.matchAll(re)) {
      const start = match.index;
      const end = start + match[0].length;
      if (taken(start, end)) continue;
      found.push({ raw: match[0].trim(), values: numberValues(match[1]!), unit, start, end });
    }
  }
  return found;
}

/** Every number written outside a figure — a table cell, "en az 100". */
function bareNumbers(text: string, figures: readonly Figure[]): number[] {
  const source = prepared(text);
  const values: number[] = [];
  for (const match of source.matchAll(new RegExp(String.raw`(?<![\d.,])${NUMBER}`, 'gu'))) {
    const start = match.index;
    if (figures.some((figure) => start >= figure.start && start < figure.end)) continue;
    values.push(...numberValues(match[0]));
  }
  return values;
}

/**
 * What a written number may mean. "1.000" is a thousand in Turkish and one in
 * English, so both; "2,5" and "2.5" are two and a half; "1.000,50" has the
 * decimal point last.
 */
export function numberValues(raw: string): number[] {
  const separators = raw.match(/[.,]/g) ?? [];
  if (separators.length === 0) return [Number(raw)];
  const groups = raw.split(/[.,]/);
  const values = new Set<number>();
  if (new Set(separators).size === 2) {
    const last = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
    values.add(Number(`${raw.slice(0, last).replace(/[.,]/g, '')}.${raw.slice(last + 1)}`));
  } else {
    if (groups.slice(1).every((group) => group.length === 3)) values.add(Number(groups.join('')));
    if (separators.length === 1) values.add(Number(groups.join('.')));
  }
  return [...values].filter(Number.isFinite);
}

/**
 * The figures in `reply` that no source gives: a number with a unit is given
 * when a source has it with the same kind of unit ("30 dk" and "30 dakika"),
 * or writes the number bare — a table row's "100" behind a reply's "100 TL".
 * Dates and clock times are never figures. Returned as written in the reply,
 * for the rewrite request; the run log keeps only their count.
 */
export function inventedFigures(reply: string, sources: readonly string[]): string[] {
  const given = sources.flatMap((text) => {
    const figures = figuresIn(text);
    return [
      ...figures.map((figure) => ({
        unit: figure.unit as FigureUnit | null,
        values: figure.values,
      })),
      { unit: null, values: bareNumbers(text, figures) },
    ];
  });
  const invented: string[] = [];
  for (const figure of figuresIn(reply)) {
    const known = given.some(
      (candidate) =>
        (candidate.unit === null || candidate.unit === figure.unit) &&
        candidate.values.some((value) => figure.values.includes(value)),
    );
    if (!known && !invented.includes(figure.raw)) invented.push(figure.raw);
  }
  return invented;
}

// ---------------------------------------------------------------------------
// When there is no answer (AI-06 §8, AI-06-S1).
// ---------------------------------------------------------------------------

/** The understanding's risk flags (`Understanding.risk`, AI-05 §3), when the call read them. */
export type RiskReading = ProcedureUnderstanding & {
  readonly risk?: Readonly<Record<string, { readonly flag: boolean } | undefined>>;
};

/** Word stems by group, on `foldTr` text; the first group a word of the question is in wins. */
const CATEGORY_STEMS: ReadonlyArray<[Exclude<NoAnswerCategory, 'other'>, readonly string[]]> = [
  [
    'rg',
    [
      'sorumlu oyun',
      'kendimi',
      'bagimli',
      'kumar',
      'oyun limiti',
      'ara vermek',
      'ara ver',
      'self exclusion',
      'self-exclusion',
      'responsible gambling',
      'responsible gaming',
      'gambling',
      'addict',
    ],
  ],
  [
    'bonus',
    ['bonus', 'freespin', 'free spin', 'cevrim', 'promosyon', 'kampanya', 'cashback', 'wager'],
  ],
  [
    'money',
    [
      'yatir',
      'cekim',
      'cekme',
      'cekt',
      'cekemiyorum',
      'para',
      'odeme',
      'bakiye',
      'havale',
      'eft',
      'papara',
      'iban',
      'kripto',
      'usdt',
      'limit',
      'deposit',
      'withdraw',
      'payment',
      'balance',
      'refund',
      'iade',
      'payout',
    ],
  ],
  [
    'account',
    [
      'hesab',
      'hesap',
      'sifre',
      'giris',
      'dogrula',
      'kyc',
      'kimlik',
      'belge',
      'uyelik',
      'account',
      'password',
      'login',
      'log in',
      'verif',
      'document',
    ],
  ],
];

/**
 * The question's group (AI-06-S1). A responsible-gaming or self-exclusion
 * flag on the understanding is `rg` whatever the words; otherwise the first
 * group, in the order above, one of whose stems starts a word of the question
 * — or is the phrase it contains.
 */
export function noAnswerCategory(
  message: string,
  understanding: RiskReading | null,
): NoAnswerCategory {
  const risk = understanding?.risk;
  if (risk?.rg_signal?.flag || risk?.self_exclusion?.flag) return 'rg';
  const folded = ` ${foldTr(message).replace(/[^a-z0-9 -]/g, ' ')} `;
  for (const [category, stems] of CATEGORY_STEMS) {
    if (stems.some((stem) => folded.includes(` ${stem}`))) return category;
  }
  return 'other';
}

export interface NoAnswerPhrases {
  /** "I cannot answer this; a person will" — the hand-over at once. */
  handoff: string;
  /** "I cannot answer this; shall I pass you to a person?" — asked once. */
  ask: string;
  /** The "yes" to the question, or to a partial answer's offer. */
  handingOver: string;
  /** The "no" to it. */
  declined: string;
  /** After a partial answer: a person can say more. */
  offer: string;
}

export const NO_ANSWER_PHRASES: Readonly<Record<PersonaLanguage, NoAnswerPhrases>> = {
  tr: {
    handoff: 'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarıyorum.',
    ask: 'Bu konuda size kesin bilgi veremiyorum. Sizi bir temsilcimize aktarayım mı?',
    handingOver: 'Sizi bir temsilcimize aktarıyorum.',
    declined: 'Peki. Başka bir konuda yardımcı olabileceğim bir şey var mı?',
    offer: 'Daha fazla ayrıntı için sizi temsilcimize aktarabilirim.',
  },
  en: {
    handoff: 'I can’t give you a definite answer on this. I’m passing you to one of our agents.',
    ask: 'I can’t give you a definite answer on this. Shall I pass you to one of our agents?',
    handingOver: 'I’m passing you to one of our agents.',
    declined: 'All right. Is there anything else I can help you with?',
    offer: 'For more detail, I can pass you to one of our agents.',
  },
  de: {
    handoff:
      'Dazu kann ich Ihnen keine verlässliche Auskunft geben. Ich verbinde Sie mit einem unserer Mitarbeiter.',
    ask: 'Dazu kann ich Ihnen keine verlässliche Auskunft geben. Soll ich Sie mit einem unserer Mitarbeiter verbinden?',
    handingOver: 'Ich verbinde Sie mit einem unserer Mitarbeiter.',
    declined: 'In Ordnung. Kann ich Ihnen sonst noch helfen?',
    offer: 'Für weitere Einzelheiten kann ich Sie mit einem unserer Mitarbeiter verbinden.',
  },
  fr: {
    handoff:
      'Je ne peux pas vous donner de réponse sûre à ce sujet. Je vous transfère à l’un de nos conseillers.',
    ask: 'Je ne peux pas vous donner de réponse sûre à ce sujet. Voulez-vous que je vous transfère à l’un de nos conseillers ?',
    handingOver: 'Je vous transfère à l’un de nos conseillers.',
    declined: 'D’accord. Puis-je vous aider pour autre chose ?',
    offer: 'Pour plus de détails, je peux vous transférer à l’un de nos conseillers.',
  },
  es: {
    handoff: 'No puedo darle una respuesta segura sobre esto. Le paso con uno de nuestros agentes.',
    ask: 'No puedo darle una respuesta segura sobre esto. ¿Quiere que le pase con uno de nuestros agentes?',
    handingOver: 'Le paso con uno de nuestros agentes.',
    declined: 'De acuerdo. ¿Puedo ayudarle con algo más?',
    offer: 'Para más detalles, puedo pasarle con uno de nuestros agentes.',
  },
};

/** Where the offer of a person is kept between turns (`ai_conversations.signals`). */
export const NO_ANSWER_SIGNAL = 'no_answer';

/**
 * The offer: the AI turn it was made on, and — when a hand-over trigger made
 * it rather than a knowledge miss (tm 303.2 · AI-09 `ask_first`) — the reason
 * a "yes" hands over with. Its presence is "asked once" (AI-06-S1).
 */
export interface NoAnswerMark {
  readonly turn: number;
  /** Absent: `no_knowledge`. */
  readonly reason?: HandoffReason;
}

export function noAnswerSignal(turn: number, reason?: HandoffReason): AiStateObject {
  return reason && reason !== 'no_knowledge' ? { turn, reason } : { turn };
}

/** The offer kept in `signals`, or null for none or a malformed one. */
export function readNoAnswerMark(signals: AiStateObject): NoAnswerMark | null {
  const raw = signals[NO_ANSWER_SIGNAL];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { turn, reason } = raw as Record<string, unknown>;
  if (typeof turn !== 'number' || !Number.isInteger(turn)) return null;
  return isHandoffReason(reason) && reason !== 'no_knowledge' ? { turn, reason } : { turn };
}

const ENGLISH_YES = new Set(['yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'ja', 'oui', 'si']);
const ENGLISH_NO = new Set(['no', 'nope', 'nah', 'nein', 'non']);

/**
 * A short "yes" or "no" — the answer to the offer of a person. Anything
 * longer than four words is a new message, not an answer, and goes the
 * ordinary way: "papara ile yatırdım ama gelmedi" is not a yes for having a
 * verb in it. "Please" alone is no yes either: "a human please" is a request
 * a skill may be written for.
 */
export function readOfferAnswer(text: string): 'yes' | 'no' | null {
  const words = foldTr(text).match(/[a-z]+/g) ?? [];
  if (words.length === 0 || words.length > 4) return null;
  const yes = words.some((word) => ENGLISH_YES.has(word));
  const no = words.some((word) => ENGLISH_NO.has(word));
  if (yes !== no) return yes ? 'yes' : 'no';
  const turkish = parseBooleanTr(text);
  if (turkish.status !== 'filled') return null;
  return turkish.value ? 'yes' : 'no';
}

/** What the decision record keeps of a knowledge answer (AI-06 §10 · G18 · AI-24). */
export interface KnowledgeRecord {
  grounded: KnowledgeGrounded;
  /** The chunks the reply cites (`knowledge_chunks.id`). */
  cited_ids: string[];
  /** Their sources (`knowledge_sources.id`), once each — the "which source" of AI-06's criterion. */
  source_ids: string[];
  /** 2 when the first draft broke a rule and was written again. */
  drafts?: 2;
  /** What the withheld draft broke: kinds, never values. */
  withheld?: DraftProblem['kind'][];
}

/** Why there was no answer — for AI-22's report. */
export type UnansweredReason = 'no_passages' | 'not_grounded' | 'withheld' | 'nothing_answered';

/**
 * What the decision record keeps of a question with no answer (`ai.unanswered`,
 * AI-22): the group, what the AI did and why — never the question's words
 * (ID-08 "never the words"). The record's `trigger_event_id` is the message;
 * AI-22 reads and normalises it from there, under the transcript's own rules.
 */
export interface UnansweredRecord {
  language: PersonaLanguage | null;
  category: NoAnswerCategory;
  /** What the AI did: handed over at once, or asked. */
  policy: NoAnswerPolicy;
  reason: UnansweredReason;
}

/**
 * The deterministic answer `LLM_PROVIDER=mock` writes (ADR §6a.6): the
 * passages stitched and trimmed to the persona's budget — the answer the
 * product gave before answers were objects — citing the passages it used.
 * No passages, no answer.
 */
export function mockKnowledgeAnswer(grounding: AnswerGrounding): KnowledgeAnswerReply {
  const { text } = shapeAnswer(
    grounding.passages,
    { tone: grounding.tone, languages: [], answerLength: grounding.answerLength },
    { language: grounding.answerIn },
  );
  if (!text) return { reply: '', grounded: 'none', cited_ids: [] };
  const used = grounding.answerLength
    ? ANSWER_BUDGETS[grounding.answerLength].passages
    : DEFAULT_ANSWER_PASSAGES;
  const labels = grounding.ids ?? grounding.passages.map((_, index) => passageLabel(index));
  return {
    reply: text,
    grounded: 'full',
    cited_ids: labels.filter((_, index) => grounding.passages[index]?.trim()).slice(0, used),
  };
}

/**
 * The AI-13 tables' answer to a question about one of their rows (#310): the
 * row's value, said by a template — before any passage is searched. Null: the
 * tables do not answer it, and the knowledge base is searched.
 */
export interface FactAnswer {
  text: string;
  /** The rows the answer came from, for the decision record. */
  factIds: string[];
}

export interface KnowledgeFacts {
  answer(input: {
    message: string;
    understanding: ProcedureUnderstanding | null;
    language: PersonaLanguage | null;
  }): Promise<FactAnswer | null>;
}

/** No tables yet (#310): nothing is answered from a row. */
export const NO_FACT_TABLES: KnowledgeFacts = Object.freeze({
  answer: async () => null,
});
