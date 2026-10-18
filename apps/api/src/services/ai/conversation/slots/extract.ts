/**
 * The understanding call's slots → the slots a conversation keeps (tm 295.3 ·
 * SiyahTuş analysis AI-04 §4–§9).
 *
 * The understanding call (#297) answers, among other things, `extracted`: for
 * each value it heard, the slot, the player's own words (`raw_text`), the value
 * it proposes and how sure it is. Nothing in that answer is trusted as it
 * comes:
 *
 *   - **the shape is checked** — an item that is not an object, names a slot the
 *     procedure does not define, or has no words is dropped, and the run log
 *     says why;
 *   - **the traceability shield** — words that do not occur in the messages the
 *     turn processes are not the player's; the item is dropped, whatever value
 *     the model put beside it;
 *   - **the value is the readers'** — `readSlot` (`validators.ts`) turns the
 *     words into the value. Only when the words alone are unreadable is the
 *     model's value read instead, by the same reader, and kept as `inferred`.
 *
 * {@link applyExtraction} then moves each slot through its statuses (AI-04 §5):
 * a settled value (`filled`, `carried`) is overwritten only by a correction,
 * which keeps the old one in `previous_values`; an invalid answer never wipes a
 * value; a `partial` moment is completed by the time given later; a `file` slot
 * fills with the player's attachment on the connection (G12 — received, never
 * read). {@link planQuestions} picks what to ask next — required, unsettled,
 * at most `max_questions_per_message` (AI-07) — counts the attempt, words a
 * later attempt with the author's variant, asks only the time of a partial
 * moment, explains an invalid answer once, and marks a slot asked
 * `max_attempts` times without an answer `refused` (AI-04-S2).
 * {@link slotCardLines} is what the hand-off card (AI-10) shows: "verilmedi"
 * for a refused slot.
 *
 * Everything here is pure: the state goes in, the next state comes out, the
 * caller (the procedure executor, #296.3) saves it in `ai_conversations.slots`.
 * The log names slots and statuses, never values — a `pii: 'high'` value is
 * kept on its record for the card and nowhere else (AI-04 §9).
 */
import {
  DEFAULT_MAX_QUESTIONS_PER_MESSAGE,
  SLOT_SETTLED_STATUSES,
  SLOT_SOURCES,
  SLOT_STATUSES,
  type PersonaLanguage,
  type SlotDateTime,
  type SlotDef,
  type SlotScalar,
  type SlotSource,
  type SlotStatus,
  type SlotValue,
} from '@siyahtus/types';
import type { AiStateObject } from '../state-store.js';
import type { SkillRunLogEntry } from '../turn.js';
import {
  SLOT_INVALID_REASONS,
  SLOT_MAX_AGE_DAYS,
  SLOT_TEXT_MAX,
  foldTr,
  type SlotInvalidReason,
  type SlotReading,
} from './normalize-tr.js';
import {
  asCryptoNetwork,
  readSlot,
  type CryptoNetwork,
  type SlotEnumOption,
  type SlotReadContext,
} from './validators.js';

const SETTLED: ReadonlySet<SlotStatus> = new Set(SLOT_SETTLED_STATUSES);

// ---------------------------------------------------------------------------
// The understanding call's answer, checked.
// ---------------------------------------------------------------------------

/**
 * The part of the understanding call's answer this module reads (ADR §6a).
 * `correction` says the message corrects what it gives again — every slot
 * (`true`) or the ones named.
 */
export interface SlotUnderstanding {
  readonly extracted?: unknown;
  readonly correction?: unknown;
}

/** One `extracted` item that passed the shape check. */
export interface ExtractedSlot {
  slot: string;
  raw_text: string;
  /** The model's proposal — read only when the words alone are unreadable. */
  value: unknown;
  /** 0–1, or null when the model gave none or nonsense. */
  confidence: number | null;
  correction: boolean;
}

export type ExtractedDropReason = 'malformed' | 'unknown_slot' | 'too_long';

const DROP_DETAIL: Readonly<Record<ExtractedDropReason, string>> = {
  malformed: 'not an object with a slot and its words',
  unknown_slot: 'the procedure defines no such slot',
  too_long: `its words are longer than ${SLOT_TEXT_MAX} characters`,
};

/**
 * The `extracted` items that can be read, and why the others cannot. A model
 * answer without an `extracted` list extracted nothing.
 */
export function parseExtracted(
  understanding: SlotUnderstanding,
  defs: ReadonlyMap<string, SlotDef>,
): {
  items: ExtractedSlot[];
  dropped: Array<{ index: number; reason: ExtractedDropReason; slot?: string }>;
} {
  const raw = understanding.extracted;
  const list = Array.isArray(raw) ? raw : [];
  const corrects = correctionReader(understanding.correction);
  const items: ExtractedSlot[] = [];
  const dropped: Array<{ index: number; reason: ExtractedDropReason; slot?: string }> = [];
  for (const [index, item] of list.entries()) {
    if (!isObject(item) || typeof item['slot'] !== 'string' || !nonEmpty(item['raw_text'])) {
      dropped.push({ index, reason: 'malformed' });
      continue;
    }
    const slot = item['slot'];
    if (!defs.has(slot)) {
      dropped.push({ index, reason: 'unknown_slot', slot: slot.slice(0, 40) });
      continue;
    }
    const rawText = item['raw_text'];
    if (rawText.length > SLOT_TEXT_MAX) {
      dropped.push({ index, reason: 'too_long', slot });
      continue;
    }
    const confidence = item['confidence'];
    items.push({
      slot,
      raw_text: rawText,
      value: item['value'],
      confidence:
        typeof confidence === 'number' && confidence >= 0 && confidence <= 1 ? confidence : null,
      correction: item['correction'] === true || corrects(slot),
    });
  }
  return { items, dropped };
}

function correctionReader(correction: unknown): (slot: string) => boolean {
  if (correction === true) return () => true;
  if (Array.isArray(correction)) {
    const named = new Set(correction.filter((name): name is string => typeof name === 'string'));
    return (slot) => named.has(slot);
  }
  return () => false;
}

/** Quotes and punctuation the model may wrap the player's words in. */
const WRAPPING = /^[\s"'“”‘’«»`.,;:!?()-]+|[\s"'“”‘’«»`.,;:!?()-]+$/g;

/**
 * The traceability shield (AI-04 §4): whether `rawText` occurs in what the
 * player said — compared folded (case, Turkish letters, repeated letters,
 * whitespace), so the model's "Papara" traces to the player's "papara".
 */
export function tracesTo(rawText: string, said: string): boolean {
  const needle = foldTr(rawText).replace(WRAPPING, '');
  return needle.length > 0 && foldTr(said).includes(needle);
}

// ---------------------------------------------------------------------------
// A slot's record.
// ---------------------------------------------------------------------------

/**
 * A stored slot as a full {@link SlotValue}. The state may hold less: a
 * carried slot is `{display, status}` (tm 294), an old one a bare string, a
 * slot never touched nothing at all — all read as what they say, with the
 * rest defaulted.
 */
export function slotRecord(raw: unknown): SlotValue {
  if (typeof raw === 'string' && raw.trim()) {
    return { ...emptyRecord(), value: raw.trim(), display: raw.trim(), status: 'filled' };
  }
  if (!isObject(raw)) return emptyRecord();
  const record = emptyRecord();
  const status = raw['status'];
  const source = raw['source'];
  const display = raw['display'];
  const value = raw['value'];
  const previous = raw['previous_values'];
  return {
    ...record,
    value: isScalar(value) ? value : null,
    display: typeof display === 'string' && display.trim() ? display : null,
    status: isOneOf(SLOT_STATUSES, status) ? status : record.status,
    source: isOneOf(SLOT_SOURCES, source) ? source : record.source,
    confidence: typeof raw['confidence'] === 'number' ? raw['confidence'] : null,
    turn: wholeNumber(raw['turn']),
    attempts: wholeNumber(raw['attempts']),
    previous_values: Array.isArray(previous) ? previous.filter(isScalar) : [],
    ...(raw['out_of_range'] === 'below_min' || raw['out_of_range'] === 'above_max'
      ? { out_of_range: raw['out_of_range'] }
      : {}),
    ...(typeof raw['invalid_reason'] === 'string' ? { invalid_reason: raw['invalid_reason'] } : {}),
    ...(raw['pii'] === 'high' ? { pii: 'high' as const } : {}),
  };
}

function emptyRecord(): SlotValue {
  return {
    value: null,
    display: null,
    status: 'missing',
    source: 'player',
    confidence: null,
    turn: 0,
    attempts: 0,
    previous_values: [],
  };
}

// ---------------------------------------------------------------------------
// Applying one turn's extraction.
// ---------------------------------------------------------------------------

/** An attachment the player sent in the messages the turn processes. */
export interface SlotAttachment {
  id: string;
  name: string;
}

export interface SlotTurnInput {
  /** The procedure's slots (validated at save — `validateSlotDefs`). */
  defs: readonly SlotDef[];
  /** `ai_conversations.slots` as the turn read it. */
  slots: AiStateObject;
  understanding: SlotUnderstanding;
  /** What the player wrote that this turn processes — the shield's haystack. */
  messages: readonly string[];
  attachments?: readonly SlotAttachment[];
  /** The AI turn writing (`counters.turns` after it). */
  turn: number;
  now: Date;
  /** The tenant's zone (ID-04 · tm 285); Europe/Istanbul when it has none. */
  timeZone: string;
  /** The tenant's currency (ISO 4217). */
  currency: string;
  /** A table-sourced enum slot's options, by slot name (AI-13 · #310). */
  options?: Readonly<Record<string, readonly SlotEnumOption[]>>;
}

/** How a slot moved this turn. */
export interface SlotChange {
  slot: string;
  from: SlotStatus;
  to: SlotStatus;
  via: SlotSource | 'attachment';
  /** A correction overwrote a settled value (kept in `previous_values`). */
  corrected?: true;
}

export interface SlotTurnResult {
  /** The state's slots after the turn — every key it had, plus the slots written. */
  slots: Record<string, unknown>;
  changes: SlotChange[];
  /** For the run log: slot names and statuses, never values. */
  log: SkillRunLogEntry[];
}

/** One proposal read: what the words (or, failing them, the model's value) gave. */
interface Proposal {
  reading: SlotReading;
  source: SlotSource;
  confidence: number | null;
  correction: boolean;
}

/**
 * The turn's extraction applied to the conversation's slots (AI-04 §4–§5).
 * A slot the turn says nothing usable about keeps its record untouched.
 */
export function applyExtraction(input: SlotTurnInput): SlotTurnResult {
  const defs = new Map(input.defs.map((def) => [def.name, def]));
  const slots: Record<string, unknown> = { ...input.slots };
  const changes: SlotChange[] = [];
  const log: SkillRunLogEntry[] = [];
  const note = (detail: string, ok: boolean) => log.push({ step: 'extract', detail, ok });

  const { items, dropped } = parseExtracted(input.understanding, defs);
  for (const drop of dropped) {
    note(
      `dropped item ${drop.index + 1}${drop.slot ? ` (${drop.slot})` : ''} — ${DROP_DETAIL[drop.reason]}`,
      false,
    );
  }

  const said = input.messages.join('\n');
  const traced = items.filter((item) => {
    if (tracesTo(item.raw_text, said)) return true;
    note(`${item.slot}: dropped — its words are not in the player's messages`, false);
    return false;
  });

  // A network first, so a TXID in the same message is checked against it.
  const names = [...new Set(traced.map((item) => item.slot))].sort(
    (a, b) => networkFirst(defs.get(a)) - networkFirst(defs.get(b)),
  );
  for (const name of names) {
    const def = defs.get(name) as SlotDef;
    const current = slotRecord(slots[name]);
    const ctx: SlotReadContext = {
      now: input.now,
      timeZone: input.timeZone,
      currency: input.currency,
      network: collectedNetwork(input.defs, slots),
      ...(input.options?.[name] ? { options: input.options[name] } : {}),
      completing: current.status === 'partial' && isDateTime(current.value) ? current.value : null,
    };
    const proposals = traced
      .filter((item) => item.slot === name)
      .map((item) => propose(def, item, ctx))
      .filter((proposal) => !isAttachmentOnly(proposal.reading));
    const chosen = choose(proposals);
    if (chosen === null) {
      note(`${name}: nothing usable in the words`, true);
      continue;
    }
    if (chosen === 'conflict') {
      note(`${name}: left as it was — the message gives two different values`, false);
      continue;
    }
    const outcome = settle(def, current, chosen, input.turn);
    if ('kept' in outcome) {
      note(`${name}: kept ${current.status} — ${outcome.kept}`, true);
      continue;
    }
    slots[name] = outcome.next;
    const change: SlotChange = {
      slot: name,
      from: current.status,
      to: outcome.next.status,
      via: chosen.source,
      ...(outcome.corrected ? { corrected: true as const } : {}),
    };
    changes.push(change);
    note(describeChange(change, outcome.next), true);
  }

  // A `file` slot fills with the player's attachment, one per slot, in the
  // procedure's order (AI-04 §8). Received, never read (G12).
  const attachments = [...(input.attachments ?? [])];
  for (const def of input.defs) {
    if (def.type !== 'file') continue;
    const current = slotRecord(slots[def.name]);
    if (SETTLED.has(current.status)) continue;
    const file = attachments.shift();
    if (file === undefined) break;
    const next: SlotValue = {
      ...bare(current),
      value: file.id,
      display: file.name,
      status: 'filled',
      source: 'player',
      confidence: null,
      turn: input.turn,
      ...(def.pii === 'high' ? { pii: 'high' as const } : {}),
    };
    slots[def.name] = next;
    const change: SlotChange = {
      slot: def.name,
      from: current.status,
      to: 'filled',
      via: 'attachment',
    };
    changes.push(change);
    note(describeChange(change, next), true);
  }

  return { slots, changes, log };
}

/** The words read, and the model's value read by the same reader only when the words are unreadable. */
function propose(def: SlotDef, item: ExtractedSlot, ctx: SlotReadContext): Proposal {
  const base = { confidence: item.confidence, correction: item.correction };
  const reading = readSlot(def, item.raw_text, ctx);
  if (reading.status !== 'invalid' || reading.reason !== 'unreadable') {
    return { ...base, reading, source: 'player' };
  }
  const text = modelValueText(item.value);
  if (text === null) return { ...base, reading, source: 'player' };
  const inferred = readSlot(def, text, ctx);
  if (inferred.status === 'invalid' && inferred.reason === 'unreadable') {
    return { ...base, reading, source: 'player' };
  }
  return { ...base, reading: inferred, source: 'inferred' };
}

/**
 * The model's value as words a reader can take: a string, a number, a boolean
 * as "evet"/"hayır", an amount as "2500 TRY", a moment as "2026-10-17 21:40".
 */
function modelValueText(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.trim();
    return text && text.length <= SLOT_TEXT_MAX ? text : null;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
  if (typeof value === 'boolean') return value ? 'evet' : 'hayır';
  if (!isObject(value)) return null;
  if (typeof value['amount'] === 'number' && Number.isFinite(value['amount'])) {
    return `${value['amount']} ${typeof value['currency'] === 'string' ? value['currency'] : ''}`.trim();
  }
  if (typeof value['date'] === 'string') {
    return `${value['date']} ${typeof value['time'] === 'string' ? value['time'] : ''}`.trim();
  }
  return null;
}

const READING_RANK: Readonly<Record<SlotReading['status'], number>> = {
  filled: 0,
  partial: 1,
  unknown: 2,
  invalid: 3,
};

/**
 * One slot's proposals reduced to one: the best status wins (a value over
 * "bilmiyorum" over a malformed one); two different values at that status are
 * a conflict and change nothing.
 */
function choose(proposals: readonly Proposal[]): Proposal | 'conflict' | null {
  if (proposals.length === 0) return null;
  const best = Math.min(...proposals.map((p) => READING_RANK[p.reading.status]));
  const top = proposals.filter((p) => READING_RANK[p.reading.status] === best);
  const values = new Set(
    top.map((p) => ('value' in p.reading ? JSON.stringify(p.reading.value) : '')),
  );
  if (values.size > 1) return 'conflict';
  const first = top[0] as Proposal;
  return top.some((p) => p.correction) ? { ...first, correction: true } : first;
}

/**
 * The slot's next record, or why the current one stands (AI-04 §5):
 *
 *   - a value over a settled one: the same value changes nothing; another one
 *     needs a correction, and the old value goes to `previous_values`. A carried
 *     value is yesterday's word for it — the player's new one replaces it;
 *   - a value over an unsettled slot: written; a `partial` completed is not a
 *     correction;
 *   - "bilmiyorum" or a malformed value never replaces a value: over a settled
 *     slot it is ignored, over a `partial` one it only records the reason (the
 *     day stays), elsewhere the slot becomes `unknown` / `invalid`.
 */
function settle(
  def: SlotDef,
  current: SlotValue,
  proposal: Proposal,
  turn: number,
): { kept: string } | { next: SlotValue; corrected: boolean } {
  const { reading } = proposal;
  const settled = SETTLED.has(current.status);
  const pii = def.pii === 'high' ? { pii: 'high' as const } : {};

  if (reading.status === 'filled' || reading.status === 'partial') {
    let corrected = false;
    let previous = current.previous_values;
    if (settled) {
      if (current.status === 'filled' && sameValue(current.value, reading.value)) {
        return { kept: 'the same value again' };
      }
      if (current.status === 'filled' && !proposal.correction) {
        return { kept: 'a different value without a correction' };
      }
      const old = current.value ?? current.display;
      if (old !== null) previous = [...previous, old];
      corrected = current.status === 'filled';
    }
    return {
      corrected,
      next: {
        ...bare(current),
        value: reading.value,
        display: reading.display,
        status: reading.status,
        source: proposal.source,
        confidence: proposal.confidence,
        turn,
        previous_values: previous,
        ...(reading.status === 'filled' && reading.out_of_range
          ? { out_of_range: reading.out_of_range }
          : {}),
        ...pii,
      },
    };
  }

  if (settled) {
    return {
      kept:
        reading.status === 'unknown'
          ? 'the player said they do not know, but it was given'
          : `the new words were not a value (${reading.reason})`,
    };
  }

  if (reading.status === 'unknown') {
    if (current.status === 'partial') return { kept: 'the player does not know more' };
    return {
      corrected: false,
      next: {
        ...bare(current),
        value: null,
        display: null,
        status: 'unknown',
        source: proposal.source,
        confidence: proposal.confidence,
        turn,
        ...pii,
      },
    };
  }

  if (current.status === 'partial') {
    return {
      corrected: false,
      next: { ...current, invalid_reason: reading.reason, turn, ...pii },
    };
  }
  return {
    corrected: false,
    next: {
      ...bare(current),
      value: null,
      display: null,
      status: 'invalid',
      source: proposal.source,
      confidence: proposal.confidence,
      turn,
      invalid_reason: reading.reason,
      ...pii,
    },
  };
}

function describeChange(change: SlotChange, next: SlotValue): string {
  const facts = [
    change.via,
    next.confidence !== null && change.via !== 'attachment' ? `confidence ${next.confidence}` : '',
    change.corrected ? 'corrected' : '',
    next.out_of_range ? next.out_of_range.replace('_', ' ') : '',
    next.status === 'invalid' || (next.status === 'partial' && next.invalid_reason)
      ? (next.invalid_reason ?? '')
      : '',
  ].filter(Boolean);
  return `${change.slot}: ${change.from} → ${change.to} (${facts.join(', ')})`;
}

// ---------------------------------------------------------------------------
// What to ask next.
// ---------------------------------------------------------------------------

export interface QuestionPlanInput {
  defs: readonly SlotDef[];
  /** The slots after {@link applyExtraction}. */
  slots: AiStateObject;
  /** The AI turn asking. */
  turn: number;
  /** The slots a `collect` step names (#296, at most two); every defined slot when absent. */
  only?: readonly string[];
  /** AI-07 `max_questions_per_message`. */
  maxQuestions?: number;
  /** The reply's language: the explanations and the time question are Turkish or English. */
  language?: PersonaLanguage | null;
  /**
   * Whether a slot is required now. The default reads `always` as required and
   * `never` and a condition as not — the procedure executor (#296.3) passes its
   * condition evaluator (#296.7).
   */
  required?: (def: SlotDef) => boolean;
}

/** Why a slot is asked. */
export type SlotQuestionBecause = 'missing' | 'partial' | 'invalid' | 'unknown';

export interface SlotQuestion {
  slot: string;
  /** 1 for the first time it is asked. */
  attempt: number;
  because: SlotQuestionBecause;
  /** The invalid answer the question explains. */
  reason?: SlotInvalidReason;
  text: string;
}

export interface QuestionPlan {
  /** The slots with the attempts counted and the refusals marked. */
  slots: Record<string, unknown>;
  questions: SlotQuestion[];
  /** Slots that became `refused` this turn — a required one is the procedure's hand-off. */
  refused: string[];
  log: SkillRunLogEntry[];
}

/**
 * The questions the AI's next message carries (AI-04 §6–§7). Required slots
 * not yet settled are asked in the procedure's order, at most `maxQuestions`
 * of them; each asked one has its attempt counted. A slot asked `max_attempts`
 * times is not asked again: with nothing usable (`missing`, `invalid`) it
 * becomes `refused`; a `partial` or `unknown` answer stands as given.
 */
export function planQuestions(input: QuestionPlanInput): QuestionPlan {
  const max = Math.max(0, input.maxQuestions ?? DEFAULT_MAX_QUESTIONS_PER_MESSAGE);
  const required = input.required ?? requiredWithoutConditions;
  const network = collectedNetwork(input.defs, input.slots);
  const phrases = PHRASES[input.language ?? 'tr'];
  const slots: Record<string, unknown> = { ...input.slots };
  const questions: SlotQuestion[] = [];
  const refused: string[] = [];
  const log: SkillRunLogEntry[] = [];

  const byName = new Map(input.defs.map((def) => [def.name, def]));
  const asked = input.only
    ? input.only.map((name) => byName.get(name)).filter((def): def is SlotDef => !!def)
    : input.defs;

  for (const def of asked) {
    if (!required(def)) continue;
    const current = slotRecord(slots[def.name]);
    if (SETTLED.has(current.status) || current.status === 'refused') continue;

    if (current.attempts >= def.max_attempts) {
      if (current.status === 'missing' || current.status === 'invalid') {
        slots[def.name] = {
          ...bare(current),
          value: null,
          display: null,
          status: 'refused',
          turn: input.turn,
        } satisfies SlotValue;
        refused.push(def.name);
        log.push({
          step: 'collect',
          detail: `${def.name}: refused — asked ${current.attempts} time(s) without an answer`,
          ok: true,
        });
      }
      continue;
    }
    if (questions.length >= max) continue;

    const because = current.status as SlotQuestionBecause;
    const reason = isInvalidReason(current.invalid_reason) ? current.invalid_reason : undefined;
    questions.push({
      slot: def.name,
      attempt: current.attempts + 1,
      because,
      ...(reason ? { reason } : {}),
      text: questionText(def, current, reason, phrases, network),
    });
    slots[def.name] = { ...current, attempts: current.attempts + 1 } satisfies SlotValue;
    log.push({
      step: 'collect',
      detail: `asked for ${def.name} (attempt ${current.attempts + 1} of ${def.max_attempts}, ${because}${reason ? `: ${reason}` : ''})`,
      ok: true,
    });
  }
  return { slots, questions, refused, log };
}

function requiredWithoutConditions(def: SlotDef): boolean {
  return def.required === 'always';
}

/**
 * The question: the author's wording for this attempt (`ask`, then the
 * variants); only the time for a moment that has its day ("dün akşam");
 * an invalid answer's explanation in front — in Turkish or English, else the
 * author's words alone.
 */
function questionText(
  def: SlotDef,
  current: SlotValue,
  reason: SlotInvalidReason | undefined,
  phrases: Phrases | undefined,
  network: CryptoNetwork | null,
): string {
  const wording =
    current.attempts === 0 ? def.ask : (def.ask_variants?.[current.attempts - 1] ?? def.ask);
  if (phrases === undefined) return wording;
  const question =
    current.status === 'partial' && isDateTime(current.value) && current.value.time === null
      ? phrases.whatTime(current.display ?? '')
      : wording;
  return reason ? `${phrases.because(reason, network)} ${question}` : question;
}

interface Phrases {
  whatTime: (day: string) => string;
  because: (reason: SlotInvalidReason, network: CryptoNetwork | null) => string;
  received: (label: string) => string;
  card: Readonly<Record<'refused' | 'unknown' | 'invalid', string>>;
}

const TR_REASONS: Readonly<Record<SlotInvalidReason, string>> = {
  unreadable: 'Bunu tam anlayamadım.',
  ambiguous: 'İki farklı değer gördüm.',
  not_positive: 'Değer sıfırdan büyük olmalı.',
  future: 'Bu zaman henüz gelmemiş görünüyor.',
  too_old: `Bu ${SLOT_MAX_AGE_DAYS} günden eski görünüyor.`,
  bad_format: 'Biçimi doğru görünmüyor.',
  network_mismatch: 'Bu işlem numarası seçilen ağın biçimine uymuyor.',
  address_not_txid: 'Bu bir cüzdan adresi; işlem numarası (TXID) gerekiyor.',
  pattern_mismatch: 'Beklenen biçime uymuyor.',
  not_an_option: 'Bu, seçeneklerden biri değil.',
  too_long: 'Bu biraz uzun oldu.',
  attachment_only: 'Bunu dosya olarak göndermeniz gerekiyor.',
};

const EN_REASONS: Readonly<Record<SlotInvalidReason, string>> = {
  unreadable: "I couldn't quite read that.",
  ambiguous: 'I saw two different values.',
  not_positive: 'It needs to be more than zero.',
  future: 'That time looks like it is still ahead.',
  too_old: `That looks older than ${SLOT_MAX_AGE_DAYS} days.`,
  bad_format: "The format doesn't look right.",
  network_mismatch: "That transaction ID doesn't match the network's format.",
  address_not_txid: 'That is a wallet address; the transaction ID (TXID) is needed.',
  pattern_mismatch: "It doesn't match the expected format.",
  not_an_option: "That isn't one of the options.",
  too_long: 'That was a bit long.',
  attachment_only: 'This needs to be sent as a file.',
};

/**
 * The words around a question, in the two languages the slot readers read
 * (AI-04 is Turkish-first). A reply in another persona language carries the
 * author's question alone rather than a sentence nobody wrote.
 */
const PHRASES: Partial<Record<PersonaLanguage, Phrases>> = {
  tr: {
    whatTime: (day) => `${day} — saat kaç civarıydı?`,
    because: (reason, network) =>
      reason === 'network_mismatch' && network !== null
        ? network === 'TRC20'
          ? 'TRC20 işlem numarası 0x olmadan 64 karakterdir.'
          : `${network} işlem numarası 0x ile başlar, ardından 64 karakter gelir.`
        : TR_REASONS[reason],
    received: (label) => `${label} alındı, teşekkürler.`,
    card: { refused: 'verilmedi', unknown: 'bilmiyor', invalid: 'geçersiz' },
  },
  en: {
    whatTime: (day) => `${day} — around what time was it?`,
    because: (reason, network) =>
      reason === 'network_mismatch' && network !== null
        ? network === 'TRC20'
          ? 'A TRC20 transaction ID is 64 characters, without 0x.'
          : `An ${network} transaction ID starts with 0x, followed by 64 characters.`
        : EN_REASONS[reason],
    received: (label) => `Thanks — ${label} received.`,
    card: { refused: 'not given', unknown: "doesn't know", invalid: 'invalid' },
  },
};

/**
 * What the AI says on a `file` slot filled by an attachment — that it arrived,
 * nothing about what it shows (G12 · AI-04-S1). Null outside Turkish and
 * English.
 */
export function receivedLine(def: SlotDef, language: PersonaLanguage | null = null): string | null {
  return PHRASES[language ?? 'tr']?.received(def.card_label ?? def.label) ?? null;
}

// ---------------------------------------------------------------------------
// The card.
// ---------------------------------------------------------------------------

export interface SlotCardLine {
  slot: string;
  label: string;
  status: SlotStatus;
  /** The value as collected, or what stands in for it: "verilmedi", "bilmiyor". */
  text: string;
  out_of_range?: 'below_min' | 'above_max';
}

/**
 * The slots the hand-off card shows (AI-10 · AI-04 §9): those marked
 * `show_in_card`, under their `card_label`, once there is something to say —
 * a slot never asked is left off. A refused slot reads "verilmedi".
 */
export function slotCardLines(
  defs: readonly SlotDef[],
  slots: AiStateObject,
  language: PersonaLanguage | null = null,
): SlotCardLine[] {
  const words = (PHRASES[language ?? 'tr'] ?? (PHRASES.en as Phrases)).card;
  const lines: SlotCardLine[] = [];
  for (const def of defs) {
    if (!def.show_in_card) continue;
    const record = slotRecord(slots[def.name]);
    let text: string | null;
    switch (record.status) {
      case 'filled':
      case 'carried':
      case 'partial':
        text = record.display;
        break;
      case 'refused':
      case 'unknown':
      case 'invalid':
        text = words[record.status];
        break;
      case 'missing':
        text = null;
        break;
    }
    if (text === null) continue;
    lines.push({
      slot: def.name,
      label: def.card_label ?? def.label,
      status: record.status,
      text,
      ...(record.out_of_range ? { out_of_range: record.out_of_range } : {}),
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** The crypto network the conversation has settled, for a network-aware TXID. */
function collectedNetwork(defs: readonly SlotDef[], slots: AiStateObject): CryptoNetwork | null {
  for (const def of defs) {
    if (def.type !== 'crypto_network') continue;
    const record = slotRecord(slots[def.name]);
    if (!SETTLED.has(record.status)) continue;
    const network = asCryptoNetwork(record.value ?? record.display);
    if (network !== null) return network;
  }
  return null;
}

function networkFirst(def: SlotDef | undefined): number {
  return def?.type === 'crypto_network' ? 0 : 1;
}

function isAttachmentOnly(reading: SlotReading): boolean {
  return reading.status === 'invalid' && reading.reason === 'attachment_only';
}

/** The record without what described its last value: the invalid reason, the range flag. */
function bare(record: SlotValue): SlotValue {
  const { invalid_reason: _reason, out_of_range: _range, ...rest } = record;
  return rest;
}

function sameValue(a: SlotScalar | null, b: SlotScalar): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isDateTime(value: unknown): value is SlotDateTime {
  return isObject(value) && typeof value['date'] === 'string' && 'time' in value;
}

function isInvalidReason(value: unknown): value is SlotInvalidReason {
  return isOneOf(SLOT_INVALID_REASONS, value);
}

function isScalar(value: unknown): value is SlotScalar {
  return (
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    typeof value === 'boolean' ||
    (isObject(value) &&
      ((typeof value['amount'] === 'number' && typeof value['currency'] === 'string') ||
        (typeof value['date'] === 'string' && typeof value['time_zone'] === 'string')))
  );
}

function wholeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}
