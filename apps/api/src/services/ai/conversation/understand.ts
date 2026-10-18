/**
 * The understanding call (tm 297.1 · SiyahTuş analysis AI-05 §1, §3, §6, §9 ·
 * ADR `docs/adr/pilot-llm-embedding-provider.md` §6a): one structured model
 * call per turn that reads the player's message and says what it is — which
 * procedure it is about and how sure, whether it carries on the active one or
 * answers the question the AI asked, a yes/no, the slot values it heard
 * (AI-04), the answers to the procedure's `ai` conditions (AI-03), whether the
 * player wants a person, the mood, and the risk signals (AI-08/AI-09/AI-27).
 *
 * **A reading, never a decision** (ADR §6a.2). Nothing in the answer acts:
 * which procedure runs is the policy's (`selectProcedure` until #297.2's
 * `policy.ts`), what a slot holds is the readers' (`applyExtraction`), and a
 * risk flag is an input to the hand-over rules (#303), not a hand-over.
 *
 * Four parts, each its own function:
 *
 *   - {@link understandCatalogue} — the procedures the call chooses among:
 *     the agent's published ones for the conversation's brand (AI-14), at most
 *     {@link UNDERSTAND_EXAMPLES_MAX} example sentences each; the locked ones
 *     (AI-15) and the active one always. Locked first, then by priority, so
 *     the same configuration always writes the same prompt.
 *   - {@link buildUnderstandPrompt} — instructions in prose and, after
 *     {@link UNDERSTAND_MARKER}, the context as one JSON line: the catalogue,
 *     the active procedure, the question it waits on, its slots and `ai`
 *     questions, the clock. The model reads the JSON; so does the in-process
 *     stub (`understand-mock.ts`), which is why it is the last line, as in
 *     `compose-prompt.ts`.
 *   - {@link UNDERSTAND_SCHEMA} — the strict schema the reply must match. The
 *     call goes through `completeStructured`: an invalid reply gets one more
 *     try, a second invalid one is an `LlmProviderError('no_answer')`, which
 *     the engine turns into "a human answers" (AI-09 `ai_failure`, §6a.4.4).
 *   - {@link readUnderstanding} — the reply, checked against what the call was
 *     given: a procedure key outside the catalogue is no key, an `ai` answer
 *     for a question nobody asked is dropped, an evidence quote the player did
 *     not write is no quote (the traceability shield, §6a.2). Each drop is a
 *     run-log note naming the field, never the value.
 *
 * **Tier `fast`, no temperature** (AI-05 §9). The fast tier is the
 * classification model (`LLM_MODEL_FAST`, §6a.5) — no `LLM_UNDERSTAND_MODEL`
 * of its own. "Temperature 0" is not sent: several current models reject any
 * value but their default with a 400, which would make every understanding a
 * failure; the schema and the code's decisions are what keep a turn
 * repeatable (PLAN §D276).
 */
import { procedureAiQuestions, type Procedure, type SlotDef } from '@siyahtus/types';
import type { JsonSchema } from '../provider/json-schema.js';
import type { LlmCompletionRequest, LlmResponseFormat } from '../provider/llm-provider.js';
import { conversation, historyLines } from '../provider/compose-prompt.js';
import type { AnswerHistory } from '../provider/answer-prompt.js';
import { slotRecord, tracesTo } from './slots/extract.js';
import type { SlotEnumOption } from './slots/validators.js';
import type { UnderstoodRecord } from './turn.js';
import type {
  CatalogueEntry,
  PendingQuestion,
  ProcedureUnderstanding,
} from './procedure/understanding.js';

/** `response_format.json_schema.name` — and what the mock answers by. */
export const UNDERSTAND_RESPONSE_NAME = 'turn_understanding';

/** Example sentences per procedure in the prompt (AI-05 §1). */
export const UNDERSTAND_EXAMPLES_MAX = 8;

/** Other procedures the reply may name beside its choice. */
export const UNDERSTAND_ALTERNATIVES_MAX = 3;

/** An evidence quote is cut to this many characters. */
export const UNDERSTAND_EVIDENCE_MAX = 200;

/** The risk signals the call reads (AI-05 §3; AI-08, AI-09, AI-27 act on them). */
export const UNDERSTAND_RISKS = [
  'self_exclusion',
  'rg_signal',
  'self_harm',
  'minor',
  'fraud_aml',
  'complaint_formal',
  'account_takeover',
] as const;
export type UnderstandRisk = (typeof UNDERSTAND_RISKS)[number];

export const UNDERSTAND_SENTIMENTS = ['positive', 'neutral', 'negative', 'angry'] as const;
export type UnderstandSentiment = (typeof UNDERSTAND_SENTIMENTS)[number];

export const UNDERSTAND_MARKER = '--- understand context (JSON, last line) ---';

// ---------------------------------------------------------------------------
// The catalogue.
// ---------------------------------------------------------------------------

/** A procedure the turn may start, and the brands it serves. */
export interface CatalogueCandidate {
  readonly entry: CatalogueEntry;
  /**
   * The brands whose conversations it serves (AI-14); absent, null or empty:
   * every brand. Skills carry no brand scope yet (#309), so nothing sets it.
   */
  readonly brandIds?: readonly string[] | null;
}

export interface CatalogueInput {
  readonly procedures: readonly CatalogueCandidate[];
  /** The procedure in progress, from its snapshot — in the catalogue even when it is no longer published. */
  readonly active: CatalogueEntry | null;
  /** The conversation's brand; absent or null when it is not known, which filters nothing. */
  readonly brandId?: string | null;
}

/**
 * The procedures the understanding call chooses among (AI-05 §1): those for
 * the conversation's brand, each with its first {@link UNDERSTAND_EXAMPLES_MAX}
 * examples; a locked one whatever its brand, and the active one whether or
 * not it is still published. Locked first, then the smaller priority, then
 * the name — a stable prompt for a stable configuration.
 */
export function understandCatalogue(input: CatalogueInput): CatalogueEntry[] {
  const byKey = new Map<string, CatalogueEntry>();
  const serves = (candidate: CatalogueCandidate) =>
    candidate.entry.locked ||
    !input.brandId ||
    !candidate.brandIds ||
    candidate.brandIds.length === 0 ||
    candidate.brandIds.includes(input.brandId);
  for (const candidate of input.procedures) {
    if (!serves(candidate) || byKey.has(candidate.entry.key)) continue;
    byKey.set(candidate.entry.key, candidate.entry);
  }
  // The live definition when it is still published; its snapshot when not.
  if (input.active && !byKey.has(input.active.key)) byKey.set(input.active.key, input.active);
  return [...byKey.values()]
    .map((entry) => ({ ...entry, examples: entry.examples.slice(0, UNDERSTAND_EXAMPLES_MAX) }))
    .sort(
      (a, b) =>
        Number(b.locked) - Number(a.locked) ||
        a.priority - b.priority ||
        a.name.localeCompare(b.name, 'tr') ||
        a.key.localeCompare(b.key),
    );
}

// ---------------------------------------------------------------------------
// The prompt.
// ---------------------------------------------------------------------------

/** What the call is given besides the conversation — the JSON line. */
export interface UnderstandGrounding {
  /** The player's message the turn processes. */
  message: string;
  catalogue: Array<{
    key: string;
    name: string;
    when_to_use: string;
    examples: string[];
    locked: boolean;
  }>;
  /** The procedure in progress. */
  active: { key: string; name: string } | null;
  /** The question the AI is waiting on: the slots it asked, a partial value each may complete. */
  pending: { asked: string[]; partial: Record<string, unknown> } | null;
  /** The active procedure's slots — what `extracted` may name. */
  slots: SlotDef[];
  /** The active procedure's `ai` conditions — what `ai_conditions` may answer. */
  questions: Array<{ key: string; question: string }>;
  /** Table-sourced options of an enum slot (#310). */
  options: Record<string, SlotEnumOption[]>;
  /** The moment of the turn (ISO 8601), its zone and the workspace currency — how "dün 13:40" and "500" read. */
  now: string;
  time_zone: string;
  currency: string;
}

export interface UnderstandContextInput {
  readonly message: string;
  readonly catalogue: readonly CatalogueEntry[];
  /** The procedure in progress: its key, name and pinned definition. */
  readonly active: { key: string; name: string; procedure: Procedure } | null;
  readonly pending: PendingQuestion | null;
  readonly options?: Readonly<Record<string, readonly SlotEnumOption[]>>;
  readonly now: Date;
  readonly timeZone: string;
  readonly currency: string;
}

/** The JSON line's content for one turn. */
export function understandGrounding(input: UnderstandContextInput): UnderstandGrounding {
  const slots = input.active ? (input.active.procedure.slots as SlotDef[]) : [];
  const partial: Record<string, unknown> = {};
  for (const name of input.pending?.asked ?? []) {
    const current = slotRecord(input.pending?.slots[name]);
    if (current.status === 'partial' && current.value !== null) partial[name] = current.value;
  }
  const options: Record<string, SlotEnumOption[]> = {};
  for (const def of slots) {
    const listed = input.options?.[def.name];
    if (listed) options[def.name] = [...listed];
  }
  return {
    message: input.message,
    catalogue: input.catalogue.map((entry) => ({
      key: entry.key,
      name: entry.name,
      when_to_use: entry.whenToUse ?? '',
      examples: [...entry.examples],
      locked: entry.locked,
    })),
    active: input.active ? { key: input.active.key, name: input.active.name } : null,
    pending: input.pending ? { asked: [...input.pending.asked], partial } : null,
    slots,
    questions: input.active ? procedureAiQuestions(input.active.procedure) : [],
    options,
    now: input.now.toISOString(),
    time_zone: input.timeZone,
    currency: input.currency,
  };
}

const INSTRUCTIONS = [
  'You read the latest message a customer wrote in a live support chat and describe it for the support system. You do not reply to the customer.',
  'Answer with one JSON object that matches the schema. Each field is a reading of the message, never an action:',
  '- language: the ISO 639-1 code of the language the latest message is written in; null when it cannot be told.',
  '- relates_to_previous: whether the latest message is about the same matter as the earlier messages; null when there are none.',
  '- wants_human.value: the customer asks for, or clearly wants, a person instead of the assistant; wants_human.explicit: they said so in words.',
  '- intent.procedure_key: the key of the one procedure in "catalogue" the message is about, or null; intent.confidence: 0 to 1, how sure; intent.alternatives: up to 3 other catalogue procedures it could be about, with their confidence. Use only keys from "catalogue"; judge by when_to_use and the examples, whatever the spelling.',
  '- intent.is_continuation: the message carries on the procedure in "active"; intent.smalltalk: a greeting, thanks or small talk with no request; intent.off_topic: a request that is no customer-support matter.',
  '- answers_pending_question: the message answers the question the assistant asked — the slots named in "pending".',
  '- yes_no: "yes" or "no" when the message is one, otherwise null.',
  '- extracted: one item per slot in "slots" the message gives a value for: slot (its name), raw_text (the customer\'s own words for it, copied exactly), value (the value written plainly, or null), confidence (0 to 1). Only slots listed in "slots"; never words the customer did not write.',
  '- correction: the message corrects a value the customer gave before.',
  '- ai_conditions: one item per question in "questions": its key, and answer true, false, or null when the conversation does not say.',
  "- sentiment: the customer's mood; abuse: insults or threats aimed at the staff.",
  "- risk: for each signal, flag (the conversation shows it) and evidence_quote (the customer's exact words that show it, or null). self_exclusion: asks to close, pause or limit the account because of gambling; rg_signal: signs of problem gambling; self_harm: thoughts of harming themselves; minor: may be under 18; fraud_aml: fraud or money-laundering signs; complaint_formal: a formal complaint, a regulator or legal action; account_takeover: someone else may be using the account.",
  'The context is the JSON on the last line: the catalogue, the active procedure, the question it waits on, its slots and questions, the current time.',
];

export interface UnderstandPromptInput {
  readonly grounding: UnderstandGrounding;
  readonly history?: AnswerHistory;
}

export function buildUnderstandPrompt(
  input: UnderstandPromptInput,
): Pick<LlmCompletionRequest, 'system' | 'messages'> {
  const lines = [
    ...INSTRUCTIONS,
    ...historyLines(input.history),
    UNDERSTAND_MARKER,
    JSON.stringify(input.grounding),
  ];
  return {
    system: lines.join('\n'),
    messages: conversation(input.history?.messages ?? [], input.grounding.message),
  };
}

/**
 * The grounding `buildUnderstandPrompt` wrote into `system`, or `null` for
 * any other prompt: the line after the last marker line — not always the last
 * line, since the structured gate's second try appends its note below it.
 */
export function readUnderstandGrounding(system: string): UnderstandGrounding | null {
  const lines = system.split('\n');
  const at = lines.lastIndexOf(UNDERSTAND_MARKER);
  if (at < 0 || at + 1 >= lines.length) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(lines[at + 1]!);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const { message, catalogue, slots, questions, options, now, time_zone, currency } = parsed;
  if (
    typeof message !== 'string' ||
    !Array.isArray(catalogue) ||
    !Array.isArray(slots) ||
    !Array.isArray(questions) ||
    !isRecord(options) ||
    typeof now !== 'string' ||
    Number.isNaN(new Date(now).getTime()) ||
    typeof time_zone !== 'string' ||
    typeof currency !== 'string'
  ) {
    return null;
  }
  return parsed as unknown as UnderstandGrounding;
}

// ---------------------------------------------------------------------------
// The schema.
// ---------------------------------------------------------------------------

const nullable = (type: 'string' | 'boolean' | 'number', description: string): JsonSchema => ({
  type: [type, 'null'],
  description,
});

const share: JsonSchema = { type: 'number', minimum: 0, maximum: 1 };

const RISK_SIGNAL: JsonSchema = {
  type: 'object',
  properties: {
    flag: { type: 'boolean' },
    evidence_quote: nullable('string', "The customer's exact words that show it."),
  },
  required: ['flag', 'evidence_quote'],
  additionalProperties: false,
};

/** The reply's shape (AI-05 §3) in the strict subset `json-schema.ts` accepts. */
export const UNDERSTAND_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    language: nullable('string', 'ISO 639-1 code.'),
    relates_to_previous: nullable('boolean', 'About the same matter as the earlier messages.'),
    wants_human: {
      type: 'object',
      properties: { value: { type: 'boolean' }, explicit: { type: 'boolean' } },
      required: ['value', 'explicit'],
      additionalProperties: false,
    },
    intent: {
      type: 'object',
      properties: {
        procedure_key: nullable('string', 'A key from the catalogue.'),
        confidence: share,
        alternatives: {
          type: 'array',
          maxItems: UNDERSTAND_ALTERNATIVES_MAX,
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, confidence: share },
            required: ['key', 'confidence'],
            additionalProperties: false,
          },
        },
        is_continuation: { type: 'boolean' },
        smalltalk: { type: 'boolean' },
        off_topic: { type: 'boolean' },
      },
      required: [
        'procedure_key',
        'confidence',
        'alternatives',
        'is_continuation',
        'smalltalk',
        'off_topic',
      ],
      additionalProperties: false,
    },
    answers_pending_question: { type: 'boolean' },
    yes_no: { type: ['string', 'null'], enum: ['yes', 'no', null] },
    extracted: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slot: { type: 'string' },
          raw_text: { type: 'string', description: "The customer's own words, copied exactly." },
          value: nullable('string', 'The value written plainly.'),
          confidence: share,
        },
        required: ['slot', 'raw_text', 'value', 'confidence'],
        additionalProperties: false,
      },
    },
    correction: { type: 'boolean' },
    ai_conditions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          answer: nullable('boolean', 'Null when the conversation does not say.'),
        },
        required: ['key', 'answer'],
        additionalProperties: false,
      },
    },
    sentiment: { type: 'string', enum: [...UNDERSTAND_SENTIMENTS] },
    abuse: { type: 'boolean' },
    risk: {
      type: 'object',
      properties: Object.fromEntries(UNDERSTAND_RISKS.map((risk) => [risk, RISK_SIGNAL])),
      required: [...UNDERSTAND_RISKS],
      additionalProperties: false,
    },
  },
  required: [
    'language',
    'relates_to_previous',
    'wants_human',
    'intent',
    'answers_pending_question',
    'yes_no',
    'extracted',
    'correction',
    'ai_conditions',
    'sentiment',
    'abuse',
    'risk',
  ],
  additionalProperties: false,
};

export const UNDERSTAND_RESPONSE_FORMAT: LlmResponseFormat = {
  name: UNDERSTAND_RESPONSE_NAME,
  schema: UNDERSTAND_SCHEMA,
};

/** A reply that passed {@link UNDERSTAND_SCHEMA} — the model's words, not yet checked against the turn. */
export interface UnderstandReply {
  language: string | null;
  relates_to_previous: boolean | null;
  wants_human: { value: boolean; explicit: boolean };
  intent: {
    procedure_key: string | null;
    confidence: number;
    alternatives: Array<{ key: string; confidence: number }>;
    is_continuation: boolean;
    smalltalk: boolean;
    off_topic: boolean;
  };
  answers_pending_question: boolean;
  yes_no: 'yes' | 'no' | null;
  extracted: Array<{ slot: string; raw_text: string; value: string | null; confidence: number }>;
  correction: boolean;
  ai_conditions: Array<{ key: string; answer: boolean | null }>;
  sentiment: UnderstandSentiment;
  abuse: boolean;
  risk: Record<UnderstandRisk, { flag: boolean; evidence_quote: string | null }>;
}

// ---------------------------------------------------------------------------
// The reply, read.
// ---------------------------------------------------------------------------

/** The understanding a turn acts on: the reply, checked against what the call was given. */
export interface Understanding extends ProcedureUnderstanding {
  readonly language: string | null;
  readonly relates_to_previous: boolean | null;
  readonly wants_human: { readonly value: boolean; readonly explicit: boolean };
  readonly intent: UnderstandReply['intent'];
  readonly answers_pending_question: boolean;
  readonly yes_no: 'yes' | 'no' | null;
  readonly extracted: UnderstandReply['extracted'];
  readonly correction: boolean;
  /** Keyed as `procedureAiQuestions` keys them; null is "the conversation does not say". */
  readonly ai_conditions: Readonly<Record<string, boolean | null>>;
  readonly sentiment: UnderstandSentiment;
  readonly abuse: boolean;
  readonly risk: Readonly<Record<UnderstandRisk, { flag: boolean; evidence_quote: string | null }>>;
}

const LANGUAGE_CODE = /^[a-z]{2,3}$/;

/**
 * {@link UnderstandReply} → {@link Understanding}, and what was dropped on
 * the way. The slot items are left to `applyExtraction`, which has its own
 * shape check and shield and logs its own drops.
 */
export function readUnderstanding(
  reply: UnderstandReply,
  grounding: Pick<UnderstandGrounding, 'message' | 'catalogue' | 'questions'>,
): { understanding: Understanding; dropped: string[] } {
  const dropped: string[] = [];
  const keys = new Set(grounding.catalogue.map((entry) => entry.key));

  let procedureKey = reply.intent.procedure_key;
  let confidence = reply.intent.confidence;
  if (procedureKey !== null && !keys.has(procedureKey)) {
    dropped.push('intent.procedure_key is not in the catalogue');
    procedureKey = null;
    confidence = 0;
  }
  const seen = new Set(procedureKey === null ? [] : [procedureKey]);
  const alternatives: Array<{ key: string; confidence: number }> = [];
  for (const alternative of reply.intent.alternatives) {
    if (!keys.has(alternative.key)) {
      dropped.push('an intent.alternatives key is not in the catalogue');
      continue;
    }
    if (seen.has(alternative.key)) continue;
    seen.add(alternative.key);
    alternatives.push({ key: alternative.key, confidence: alternative.confidence });
  }
  alternatives.sort((a, b) => b.confidence - a.confidence);

  const asked = new Set(grounding.questions.map((question) => question.key));
  const aiConditions: Record<string, boolean | null> = {};
  for (const item of reply.ai_conditions) {
    if (!asked.has(item.key)) {
      dropped.push('an ai_conditions key was not asked');
      continue;
    }
    aiConditions[item.key] = item.answer;
  }

  const risk = {} as Record<UnderstandRisk, { flag: boolean; evidence_quote: string | null }>;
  for (const name of UNDERSTAND_RISKS) {
    const signal = reply.risk[name];
    let quote = signal.evidence_quote?.trim() || null;
    if (quote !== null && !tracesTo(quote, grounding.message)) {
      dropped.push(`risk.${name}.evidence_quote is not in the message`);
      quote = null;
    }
    risk[name] = {
      flag: signal.flag,
      evidence_quote: quote === null ? null : quote.slice(0, UNDERSTAND_EVIDENCE_MAX),
    };
  }

  const language = reply.language?.trim().toLowerCase() ?? null;
  if (language !== null && !LANGUAGE_CODE.test(language)) dropped.push('language is not a code');

  return {
    understanding: {
      language: language !== null && LANGUAGE_CODE.test(language) ? language : null,
      relates_to_previous: reply.relates_to_previous,
      wants_human: { value: reply.wants_human.value, explicit: reply.wants_human.explicit },
      intent: {
        procedure_key: procedureKey,
        confidence,
        alternatives,
        is_continuation: reply.intent.is_continuation,
        smalltalk: reply.intent.smalltalk,
        off_topic: reply.intent.off_topic,
      },
      answers_pending_question: reply.answers_pending_question,
      yes_no: reply.yes_no,
      extracted: reply.extracted,
      correction: reply.correction,
      ai_conditions: aiConditions,
      sentiment: reply.sentiment,
      abuse: reply.abuse,
      risk,
    },
    dropped,
  };
}

/** What the decision record keeps of the understanding (ID-08 · AI-05 §8): keys and numbers. */
export function understoodRecord(understanding: Understanding, tries: 1 | 2): UnderstoodRecord {
  const { intent } = understanding;
  return {
    procedure_key: intent.procedure_key,
    confidence: round(intent.confidence),
    alternatives: intent.alternatives.map((alt) => ({
      key: alt.key,
      confidence: round(alt.confidence),
    })),
    language: understanding.language,
    tries,
  };
}

/** One run-log line for what the call understood: the choice, the alternatives, the tries. */
export function understoodDetail(understanding: Understanding, tries: 1 | 2): string {
  const { intent } = understanding;
  return [
    intent.procedure_key === null
      ? 'understood: no procedure'
      : `understood: ${intent.procedure_key} (${round(intent.confidence)})`,
    intent.alternatives.length > 0
      ? `or ${intent.alternatives.map((alt) => `${alt.key} (${round(alt.confidence)})`).join(', ')}`
      : '',
    understanding.language ? `language ${understanding.language}` : '',
    tries === 2 ? 'second try' : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

const round = (value: number) => Math.round(value * 100) / 100;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
