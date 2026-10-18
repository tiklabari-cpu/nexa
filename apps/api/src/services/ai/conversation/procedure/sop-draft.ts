/**
 * A procedure drafted from an SOP (tm 296.4 · SiyahTuş analysis AI-03 §11 ·
 * K8's helper): the text a support lead already wrote for people — "yöntemi
 * ve saati sor → finansa devret" — turned into a definition the editor opens.
 *
 * **A draft, never a skill.** Nothing here writes: `POST /skills/compile`
 * returns the draft, the author edits it, and `POST /skills` stores it the way
 * every skill is stored — validated, and off (`active: false`). The draft is
 * judged by the same save-time validator (`validateSkillProcedure`) before it
 * is returned, so what the editor shows as wrong is exactly what a save would
 * refuse.
 *
 * **Two writers, one shape.** With a model configured the SOP goes to it with
 * {@link SOP_DRAFT_SCHEMA} (ADR `pilot-llm-embedding-provider.md` §6a: a JSON
 * object the code decides on, never a command) and the answer is mapped by
 * {@link draftFromModel}. With the `mock` provider — every suite, dev, a
 * deployment with AI text generation off — the rule-based
 * {@link skeletonFromSop} writes the skeleton: one step per line it can read.
 *
 * **Conditions are the author's.** Neither writer produces a `check`, a `when`
 * or a hand-over condition. A branch is where a draft would most plausibly do
 * the wrong thing to a player — "bekleme ya da dekont sor" read the wrong way
 * round answers every late deposit with "please wait" — so a line that
 * branches comes back in `unrecognised`, and the editor's "Eğer…" is where it
 * is written. The same rule as `compileInstruction`: report what was not
 * understood rather than invent something plausible.
 */
import {
  DEFAULT_PROCEDURE_PRIORITY,
  PROCEDURE_COLLECT_SLOTS_MAX,
  PROCEDURE_EXAMPLE_MAX,
  PROCEDURE_EXAMPLES_MAX,
  PROCEDURE_INSTRUCTION_MAX,
  PROCEDURE_KEY_PATTERN,
  PROCEDURE_STEPS_MAX,
  PROCEDURE_TEMPLATES_MAX,
  PROCEDURE_WHEN_TO_USE_MAX,
  SLOT_ASK_MAX,
  SLOT_LABEL_MAX,
  SLOT_MAX_PER_PROCEDURE,
  SLOT_NAME_PATTERN,
  SLOT_TYPES,
  procedureProblemDetails,
  validateSkillProcedure,
  type ProcedureProblemDetails,
  type ProcedureValidationContext,
  type SlotType,
} from '@siyahtus/types';
import type { JsonSchema } from '../../provider/json-schema.js';
import { foldTr } from '../slots/normalize-tr.js';

/** What `POST /skills/compile` accepts as an SOP, in characters. */
export const SOP_TEXT_MAX = 20_000;

/** Who wrote the draft: the rule-based skeleton, or the model. */
export type SopDraftSource = 'rules' | 'model';

/** A procedure skill's definition as a draft — the fields `POST /skills` takes. */
export interface SopDraftDefinition {
  name: string;
  when_to_use: string;
  examples: string[];
  priority: number;
  slots: Array<Record<string, unknown>>;
  procedure: {
    steps: Array<Record<string, unknown>>;
    templates: Array<{ key: string; text: string }>;
  };
}

/** The draft as the editor gets it: the definition, and what a save would say of it. */
export interface SopDraft extends SopDraftDefinition {
  source: SopDraftSource;
  /** What a save would refuse — empty when it would store the draft as it is. */
  problems: ProcedureProblemDetails[];
  /** What a save allows but flags (`procedure_unreachable_step`). */
  warnings: ProcedureProblemDetails[];
}

/** The draft, and the SOP lines that produced nothing. */
export interface SopDraftResult {
  draft: SopDraft;
  unrecognised: string[];
}

/** The step types a draft may contain: none branches (see the file header), none calls a tool. */
const DRAFT_STEP_TYPES = [
  'say',
  'collect',
  'answer_from_knowledge',
  'handoff',
  'resolve',
  'tag',
] as const;
type DraftStepType = (typeof DRAFT_STEP_TYPES)[number];

/** `enum` needs its values and those come from a table or the author — never from an SOP line. */
const DRAFT_SLOT_TYPES = SLOT_TYPES.filter((type) => type !== 'enum');

/** The reason a drafted hand-over carries until the author names one. */
export const SOP_HANDOFF_REASON = 'sop_handoff';

const nullable = (type: 'string'): JsonSchema => ({ type: [type, 'null'] });

/**
 * The structured answer the model is asked for (ADR §6a.3). Flat on purpose:
 * one object per step with every field present, null where it does not apply,
 * so the strict subset (`json-schema.ts`) holds it and the mapping below
 * decides what each type keeps.
 */
export const SOP_DRAFT_SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'when_to_use', 'examples', 'slots', 'steps', 'templates', 'unrecognised'],
  properties: {
    name: { type: 'string', description: 'A short name for the procedure.' },
    when_to_use: {
      type: 'string',
      description: 'When the procedure applies, in one plain sentence.',
    },
    examples: {
      type: 'array',
      maxItems: PROCEDURE_EXAMPLES_MAX,
      description: 'Sentences a customer would write when this applies.',
      items: { type: 'string' },
    },
    slots: {
      type: 'array',
      maxItems: SLOT_MAX_PER_PROCEDURE,
      description: 'The pieces of information the procedure collects.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'label', 'type', 'ask'],
        properties: {
          name: { type: 'string', description: 'lower_snake_case, ASCII.' },
          label: { type: 'string' },
          type: { type: 'string', enum: DRAFT_SLOT_TYPES },
          ask: { type: 'string', description: 'The question that asks for it.' },
        },
      },
    },
    steps: {
      type: 'array',
      minItems: 1,
      maxItems: PROCEDURE_STEPS_MAX,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'id',
          'type',
          'instruction',
          'slots',
          'template_key',
          'reason_code',
          'outcome',
          'tag',
        ],
        properties: {
          id: { type: 'string', description: 'lower_snake_case, unique.' },
          type: { type: 'string', enum: DRAFT_STEP_TYPES },
          instruction: nullable('string'),
          slots: {
            type: 'array',
            maxItems: PROCEDURE_COLLECT_SLOTS_MAX,
            description: 'collect: the slot names it asks for; empty otherwise.',
            items: { type: 'string' },
          },
          template_key: nullable('string'),
          reason_code: nullable('string'),
          outcome: { type: ['string', 'null'], enum: ['resolved', 'resolved_waiting', null] },
          tag: nullable('string'),
        },
      },
    },
    templates: {
      type: 'array',
      maxItems: PROCEDURE_TEMPLATES_MAX,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['key', 'text'],
        properties: { key: { type: 'string' }, text: { type: 'string' } },
      },
    },
    unrecognised: {
      type: 'array',
      description: 'SOP lines that are conditions or that no step type covers.',
      items: { type: 'string' },
    },
  },
};

/** The model's answer, as {@link SOP_DRAFT_SCHEMA} holds it. */
export interface SopModelDraft {
  name: string;
  when_to_use: string;
  examples: string[];
  slots: Array<{ name: string; label: string; type: string; ask: string }>;
  steps: Array<{
    id: string;
    type: string;
    instruction: string | null;
    slots: string[];
    template_key: string | null;
    reason_code: string | null;
    outcome: string | null;
    tag: string | null;
  }>;
  templates: Array<{ key: string; text: string }>;
  unrecognised: string[];
}

/** The system prompt of the drafting call. The SOP itself is the user message. */
export function sopDraftSystemPrompt(): string {
  return [
    'You turn a customer-support SOP into a draft procedure for an AI assistant.',
    'Answer with the JSON object the schema describes and nothing else.',
    'Step types: say (a reply: instruction, or template_key naming one of templates), collect (asks for one or two slots by name), answer_from_knowledge (answers from the knowledge base), handoff (hands the conversation to a person: reason_code in lower_snake_case), resolve (ends it: outcome resolved, or resolved_waiting when the customer is asked to wait), tag (tag in lower_snake_case).',
    'Do not write conditions or branches. Put every SOP line that compares, branches or depends on an answer ("if", "otherwise", "eğer", "ya da", "karşılaştır") in unrecognised, word for word.',
    'Never collect a password, a PIN, a one-time code, a full card number or an identity document.',
    'Write the questions and replies in the language of the SOP. Ids, slot names, keys and codes are lower_snake_case ASCII.',
  ].join('\n');
}

/**
 * Judge a draft as `POST /skills` would and attach the verdict. `context` is
 * the save's (the license's teams); the draft names none, so it matters only
 * for what a model wrote anyway.
 */
export function judgeDraft(
  definition: SopDraftDefinition,
  source: SopDraftSource,
  context: ProcedureValidationContext = {},
): SopDraft {
  const verdict = validateSkillProcedure(definition, context);
  return {
    ...definition,
    source,
    problems: verdict.ok ? [] : verdict.problems.map(procedureProblemDetails),
    warnings: verdict.warnings.map(procedureProblemDetails),
  };
}

// ---------------------------------------------------------------------------
// The model's draft.
// ---------------------------------------------------------------------------

/**
 * The model's answer as a definition. Each step keeps only the fields its type
 * has — a `reason_code` on a `say` is dropped, not passed to the validator to
 * refuse — and a field the type needs and the model left null is passed on as
 * missing, for the validator to name. Ids, names and keys are taken as written:
 * one the model got wrong is a problem the editor shows, not one quietly fixed.
 */
export function draftFromModel(value: SopModelDraft): SopDraftResult {
  const steps = value.steps.map((step) => {
    const base: Record<string, unknown> = { id: step.id, type: step.type };
    if (step.instruction) base['instruction'] = step.instruction;
    switch (step.type as DraftStepType) {
      case 'say':
        if (step.template_key) base['template_key'] = step.template_key;
        break;
      case 'collect':
        base['slots'] = step.slots;
        break;
      case 'handoff':
        base['reason_code'] = step.reason_code ?? SOP_HANDOFF_REASON;
        break;
      case 'resolve':
        if (step.outcome) base['outcome'] = step.outcome;
        break;
      case 'tag':
        if (step.tag) base['tag'] = step.tag;
        break;
      case 'answer_from_knowledge':
        break;
    }
    return base;
  });
  return {
    draft: judgeDraft(
      {
        name: clip(value.name.trim() || 'SOP', 120),
        when_to_use: value.when_to_use.trim(),
        examples: value.examples.map((example) => example.trim()).filter(Boolean),
        priority: DEFAULT_PROCEDURE_PRIORITY,
        slots: value.slots.map((slot) => ({ ...slot })),
        procedure: { steps, templates: value.templates.map((template) => ({ ...template })) },
      },
      'model',
    ),
    unrecognised: value.unrecognised.map((line) => line.trim()).filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// The rule-based skeleton.
// ---------------------------------------------------------------------------

/** A line that compares or branches: the author writes it as a condition. */
const BRANCH =
  /^(eger|sayet|if|when|unless)\b|\b(ise|degilse|aksi halde|aksi takdirde|yoksa|ya da|otherwise|either|unless|karsilastir|compare|kontrol et|check)\b/;
const HANDOFF = /\b(devret|devredin|devir|aktar|yonlendir|escalate|hand ?over|hand ?off|transfer)/;
const KNOWLEDGE = /\b(bilgi bankas|makale|sss|knowledge|faq|article|kb)\b/;
const TAG = /\b(?:etiketle|etiket ekle|tag(?: it)?(?: as)?)\b\s*["“']?([\p{L}\p{N}_ -]*)/u;
const SAY =
  /\b(soyle|bildir|acikla|belirt|ilet|hatirlat|ozur dile|tesekkur|selamla|tell|inform|explain|say|apologi[sz]e|thank|greet|remind)/;
const RESOLVE_WAITING = /\b(bekle|beklet|beklemesi|wait)\b/;
const RESOLVE = /\b(coz|cozuldu|kapat|resolve|close)\b/;
/**
 * "yöntemi ve saati sor" (the verb last) or "ask for the method and time" —
 * on the line as written, so the label keeps its letters. The Turkish verb
 * ends at a space or the end: `\b` is ASCII, and "alın" would match "al".
 */
const COLLECT_TR = /^(.+?)\s+(?:sor|iste|al|öğren|talep et)(?=$|[\s.,;!?])/iu;
const COLLECT_EN = /\b(?:ask|request|collect)\b\s+(?:for\s+|the\s+|their\s+)*(.+)$/i;

/** Words that make an SOP Turkish rather than English. */
const TURKISH = /[çğıöşüİ]|\b(ve|ile|sor|iste|devret|bekle|oyuncu|musteri|müşteri)\b/i;

/** Slot types by what the slot's words say, first match wins (folded text). */
const SLOT_TYPE_RULES: ReadonlyArray<readonly [RegExp, SlotType]> = [
  [/\b(txid|tx id|hash)\b/, 'txid'],
  [/\biban\b/, 'iban_last4'],
  [/\b(e-?posta|e-?mail|mail)\b/, 'email'],
  [/\b(telefon|phone|gsm)\b/, 'phone'],
  [/\b(kullanici adi|username|user name)\b/, 'username'],
  [/\b(dekont|makbuz|ekran goruntusu|screenshot|receipt|dosya|file)/, 'file'],
  [/\b(tutar|miktar|amount|ucret|meblag)/, 'money'],
  [/\b(saat|zaman|tarih|time|date|when)/, 'datetime'],
];

/**
 * The rule-based skeleton (AI-03 §11: "mock modda kural tabanlı derleyici
 * iskelet üretir"). One line, one step: asking becomes `collect` (two slots a
 * step at most), handing over `handoff` (no team — routing decides until the
 * author picks one), the knowledge base `answer_from_knowledge`, telling
 * `say` with the line as its instruction, waiting or closing `resolve`,
 * tagging `tag`. A heading first line is the `when_to_use`; quoted sentences
 * are the examples. Branches and the rest are `unrecognised`.
 */
export function skeletonFromSop(sopText: string): SopDraftResult {
  const turkish = TURKISH.test(sopText);
  const lines = splitSop(sopText);
  const examples = quoted(sopText);
  const unrecognised: string[] = [];
  const steps: Array<Record<string, unknown>> = [];
  const slots: Array<Record<string, unknown>> = [];
  const counters = new Map<string, number>();
  const stepId = (type: string): string => {
    const n = (counters.get(type) ?? 0) + 1;
    counters.set(type, n);
    return `${type}_${n}`;
  };
  const instruction = (line: string) => clip(line, PROCEDURE_INSTRUCTION_MAX);

  let title: string | null = null;
  for (const [index, line] of lines.entries()) {
    const folded = foldTr(line);
    // A first line ending in a colon is the SOP's heading, whatever it says.
    if (index === 0 && /[:：]\s*$/.test(line)) {
      title = line.replace(/[:：]\s*$/, '').trim();
      continue;
    }
    if (BRANCH.test(folded)) {
      unrecognised.push(line);
      continue;
    }
    if (HANDOFF.test(folded)) {
      steps.push({
        id: stepId('handoff'),
        type: 'handoff',
        reason_code: SOP_HANDOFF_REASON,
        instruction: instruction(line),
      });
      continue;
    }
    const asked = collectedPhrases(line);
    if (asked) {
      const names = asked.map((phrase) => {
        const name = uniqueSlotName(phrase, slots);
        if (!slots.some((slot) => slot['name'] === name) && slots.length < SLOT_MAX_PER_PROCEDURE) {
          slots.push(draftSlot(name, phrase, turkish));
        }
        return name;
      });
      const known = names.filter((name) => slots.some((slot) => slot['name'] === name));
      for (let at = 0; at < known.length; at += PROCEDURE_COLLECT_SLOTS_MAX) {
        steps.push({
          id: stepId('collect'),
          type: 'collect',
          slots: known.slice(at, at + PROCEDURE_COLLECT_SLOTS_MAX),
        });
      }
      continue;
    }
    if (KNOWLEDGE.test(folded)) {
      steps.push({
        id: stepId('answer'),
        type: 'answer_from_knowledge',
        instruction: instruction(line),
      });
      continue;
    }
    const tag = TAG.exec(folded);
    const tagKey = tag ? keyOf(tag[1] ?? '') : '';
    if (tagKey) {
      steps.push({ id: stepId('tag'), type: 'tag', tag: tagKey });
      continue;
    }
    if (SAY.test(folded)) {
      steps.push({ id: stepId('say'), type: 'say', instruction: instruction(line) });
      continue;
    }
    if (RESOLVE_WAITING.test(folded) || RESOLVE.test(folded)) {
      steps.push({
        id: stepId('resolve'),
        type: 'resolve',
        outcome: RESOLVE_WAITING.test(folded) ? 'resolved_waiting' : 'resolved',
        instruction: instruction(line),
      });
      continue;
    }
    // A first line that is none of the above is the SOP's heading: it says
    // what the procedure is for.
    if (index === 0) {
      title = line.trim();
      continue;
    }
    unrecognised.push(line);
  }

  const heading = title ?? lines[0] ?? sopText.trim();
  const definition: SopDraftDefinition = {
    name: clip(heading, 120) || 'SOP',
    when_to_use: clip(heading, PROCEDURE_WHEN_TO_USE_MAX),
    examples,
    priority: DEFAULT_PROCEDURE_PRIORITY,
    slots,
    procedure: { steps: steps.slice(0, PROCEDURE_STEPS_MAX), templates: [] },
  };
  return { draft: judgeDraft(definition, 'rules'), unrecognised };
}

/**
 * One SOP instruction per line: newlines, list markers, sentence ends, arrows
 * and "sonra/ardından/then" — "yöntem/saat sor → süreyle karşılaştır".
 */
function splitSop(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?])\s+|\s*(?:→|->|=>|;)\s*|\s+(?:sonra|ardından|ardindan|then)\s+/i)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0);
}

/** The things a line asks for, or null when it asks for nothing. */
function collectedPhrases(line: string): string[] | null {
  const asked = COLLECT_EN.exec(line) ?? COLLECT_TR.exec(line);
  if (!asked) return null;
  const phrases = (asked[1] ?? '')
    .replace(/[.!?]+$/, '')
    .split(/\s*[/,]\s*|\s+(?:ve|ile|veya|and|or)\s+/i)
    .map((phrase) =>
      phrase.replace(
        /^(?:oyuncu(?:nun|dan|ya)?|müşteri(?:nin|den|ye)?|the|their|your|an?)\s+/i,
        '',
      ),
    )
    .map((phrase) => phrase.trim())
    .filter((phrase) => keyOf(phrase).length > 0);
  return phrases.length > 0 ? phrases : null;
}

function draftSlot(name: string, phrase: string, turkish: boolean): Record<string, unknown> {
  const folded = foldTr(phrase);
  const type = SLOT_TYPE_RULES.find(([pattern]) => pattern.test(folded))?.[1] ?? 'text';
  const label = clip(capitalise(phrase), SLOT_LABEL_MAX);
  const ask = turkish
    ? type === 'file'
      ? `${label} gönderebilir misiniz?`
      : `${label} paylaşır mısınız?`
    : type === 'file'
      ? `Could you send the ${phrase.toLowerCase()}?`
      : `Could you share your ${phrase.toLowerCase()}?`;
  return { name, label, type, ask: clip(ask, SLOT_ASK_MAX) };
}

/** A slot name for the phrase, made unique against the ones already drafted unless it is the same slot. */
function uniqueSlotName(phrase: string, slots: ReadonlyArray<Record<string, unknown>>): string {
  const base = keyOf(phrase).slice(0, 36) || 'bilgi';
  const sameLabel = slots.find(
    (slot) => foldTr(String(slot['label'])) === foldTr(clip(capitalise(phrase), SLOT_LABEL_MAX)),
  );
  if (sameLabel) return String(sameLabel['name']);
  let name = base;
  for (let n = 2; slots.some((slot) => slot['name'] === name); n += 1) name = `${base}_${n}`;
  return SLOT_NAME_PATTERN.test(name) ? name : `bilgi_${slots.length + 1}`;
}

/** Quoted sentences — how an SOP shows what a player writes. */
function quoted(text: string): string[] {
  const found = [...text.matchAll(/["“”«»]([^"“”«»\n]{3,})["“”«»]/g)]
    .map((match) => (match[1] ?? '').trim())
    .filter((example) => example.length > 0 && example.length <= PROCEDURE_EXAMPLE_MAX);
  return [...new Set(found)].slice(0, PROCEDURE_EXAMPLES_MAX);
}

/** lower_snake_case ASCII, starting with a letter, or '' when nothing is left. */
function keyOf(text: string): string {
  const key = foldTr(text)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/, '');
  return PROCEDURE_KEY_PATTERN.test(key) ? key : '';
}

function capitalise(text: string): string {
  const trimmed = text.trim();
  return trimmed.charAt(0).toLocaleUpperCase('tr') + trimmed.slice(1);
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
