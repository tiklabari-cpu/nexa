/**
 * Evaluating a procedure condition (tm 296.7 · SiyahTuş analysis AI-03 §1 ·
 * ADR-14a §2.3).
 *
 * `Cond` (`@siyahtus/types` `procedure.ts`) is a fixed language — `all`, `any`,
 * `not`, a slot, a fact, one of three functions, a yes/no question for the
 * model — and the save-time validator has already held every definition to
 * it. This module answers it against one conversation's state. Nothing here
 * evaluates author text: an operator is a `switch` arm, a function is one of
 * {@link COND_FNS}; a `matches` pattern is the only author string run, and the
 * validator refused any that could backtrack (`authorPatternProblem`).
 *
 * **Three values, not two.** A condition can ask about something the
 * conversation does not know yet: a slot the player has not given, a fact no
 * table row answers (AI-13 lands with #310), an `ai` question the
 * understanding call answered `unknown`. Each of those is *unknown*, and
 * unknown travels through the tree the way it should (Kleene logic): `not`
 * keeps it unknown, `all` is false as soon as one part is false, `any` is true
 * as soon as one part holds. Only the whole condition's unknown is turned into
 * a decision — it counts as false (AI-03 §1: "`unknown` = false") — and the run
 * log says what could not be decided. A `neq` on an empty slot is therefore
 * not true, and `not (slot eq X)` on an empty slot does not hold either.
 *
 * `exists` / `missing` never are unknown: they are the question "is it known".
 * A slot exists once it is settled (`filled` or `carried`); a `partial` moment
 * does not.
 *
 * Pure: the state, the facts, the clock and the understanding call's answers
 * go in; the decision and its log entries come out. The executor (#296.3)
 * writes the log and the decision record (ID-08 `cond_result`).
 */
import {
  COND_DEPTH_MAX,
  COND_FNS,
  PROCEDURE_FACTS,
  SLOT_SETTLED_STATUSES,
  type Cond,
  type CondFnName,
  type CondScalar,
  type ProcedureFactPath,
  type SlotDateTime,
  type SlotDef,
  type SlotValue,
} from '@siyahtus/types';
import { slotRecord } from '../slots/extract.js';
import type { AiStateObject } from '../state-store.js';
import type { SkillRunLogEntry } from '../turn.js';

// ---------------------------------------------------------------------------
// Facts — the AI-13 tables, behind an interface.
// ---------------------------------------------------------------------------

/**
 * What the structured tables (AI-13) know about the rows this conversation's
 * slots name — the payment method in `method`, the bonus, the KYC document.
 * The executor builds it once the slots are read; #310 (`conversation/facts.ts`)
 * gives the real one. Every answer may be null: no row resolved, or the column
 * is empty — a condition reading it is unknown, a template needing it is not
 * sent.
 */
export interface ProcedureFacts {
  /** A column's value: a number, a yes/no or text, per {@link PROCEDURE_FACTS}. */
  get(path: ProcedureFactPath): CondScalar | null;
  /** Whether the method processes at that moment (its working hours, in its own zone). */
  withinWorkingHours(at: Date): boolean | null;
  /** The next moment after `after` the method processes. */
  nextWindow(after: Date): Date | null;
}

/** The stub until #310: the tables know nothing, so every fact is unknown. */
export const NO_FACTS: ProcedureFacts = {
  get: () => null,
  withinWorkingHours: () => null,
  nextWindow: () => null,
};

/** Facts written out — a test's fixture, a preview's (#296.4) or a scenario's (AI-19). */
export interface FactsFixture {
  facts?: Partial<Record<ProcedureFactPath, CondScalar>>;
  withinWorkingHours?: (at: Date) => boolean | null;
  nextWindow?: (after: Date) => Date | null;
}

export function fixtureFacts(fixture: FactsFixture): ProcedureFacts {
  return {
    get: (path) => fixture.facts?.[path] ?? null,
    withinWorkingHours: (at) => fixture.withinWorkingHours?.(at) ?? null,
    nextWindow: (after) => fixture.nextWindow?.(after) ?? null,
  };
}

// ---------------------------------------------------------------------------
// The context a condition is answered in.
// ---------------------------------------------------------------------------

export interface ProcedureEvalContext {
  /** `ai_conversations.slots` — read through `slotRecord`, so a carried `{display, status}` counts. */
  slots: AiStateObject;
  facts: ProcedureFacts;
  now: Date;
  /** `inbox_settings.day_boundary_tz` — where a moment is shown (`next_window` in a template). */
  timeZone: string;
  /**
   * The understanding call's `ai_conditions` (AI-05), keyed as
   * `procedureAiQuestions` keys them: `true`, `false`, or anything else for unknown.
   */
  aiAnswers?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Values.
// ---------------------------------------------------------------------------

/** A value a condition compares or a template shows, by kind. */
export type ProcValue =
  | { kind: 'number'; value: number }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'moment'; value: Date | SlotDateTime }
  | { kind: 'file' };

/** A value, or why there is none: the conversation does not know it, or the data is not what it should be. */
export type ProcLookup =
  { known: true; value: ProcValue } | { known: false; what: string; problem?: string };

function notKnown(what: string, problem?: string): ProcLookup {
  return problem === undefined ? { known: false, what } : { known: false, what, problem };
}

/** Whether a slot is settled — what `exists` asks of a slot. */
export function slotSettled(slots: AiStateObject, name: string): boolean {
  return (SLOT_SETTLED_STATUSES as readonly string[]).includes(slotRecord(slots[name]).status);
}

/**
 * A settled slot's value. A `money` slot is its amount; a carried slot keeps
 * only its `display` (tm 294), which still answers a text comparison — an enum
 * option, a username — but not a number.
 */
export function slotValue(slots: AiStateObject, name: string): ProcLookup {
  const record: SlotValue = slotRecord(slots[name]);
  if (!(SLOT_SETTLED_STATUSES as readonly string[]).includes(record.status)) {
    return notKnown(`slot ${name}`);
  }
  const value = record.value;
  if (typeof value === 'number' && Number.isFinite(value)) return known('number', value);
  if (typeof value === 'boolean') return known('boolean', value);
  if (typeof value === 'string') return known('text', value);
  if (value !== null && typeof value === 'object') {
    if ('amount' in value && typeof value.amount === 'number') return known('number', value.amount);
    if ('date' in value && typeof value.date === 'string') {
      return { known: true, value: { kind: 'moment', value } };
    }
  }
  if (value === null && record.display !== null) return known('text', record.display);
  return notKnown(`slot ${name}`, `slot ${name} holds no usable value`);
}

/** A fact's value, held to the kind {@link PROCEDURE_FACTS} gives its column. */
export function factValue(facts: ProcedureFacts, path: string): ProcLookup {
  if (!Object.hasOwn(PROCEDURE_FACTS, path)) {
    return notKnown(`fact ${path}`, `${path} is not a known fact`);
  }
  const kind = PROCEDURE_FACTS[path as ProcedureFactPath];
  const value = facts.get(path as ProcedureFactPath);
  if (value === null || value === undefined) return notKnown(`fact ${path}`);
  if (kind === 'number' && typeof value === 'number' && Number.isFinite(value)) {
    return known('number', value);
  }
  if (kind === 'boolean' && typeof value === 'boolean') return known('boolean', value);
  if (kind === 'text' && typeof value === 'string') return known('text', value);
  return notKnown(`fact ${path}`, `fact ${path} is not a ${kind} value`);
}

/**
 * A function's value (AI-03 §1 — a fixed list):
 *
 *   - `elapsed_minutes(slot)` — whole minutes from the slot's moment to now;
 *     a moment a few minutes ahead (the reader's tolerance) is 0. Needs the time:
 *     a day alone (`partial`) is not settled, so it is unknown.
 *   - `within_working_hours(method, slot)` — the facts' answer for that moment.
 *   - `next_window(method)` — the facts' next processing moment after now.
 */
export function functionValue(
  name: string,
  args: readonly string[],
  ctx: ProcedureEvalContext,
): ProcLookup {
  const fn = name as CondFnName;
  if (!(COND_FNS as readonly string[]).includes(name)) {
    return notKnown(`fn ${name}`, `${name} is not a known function`);
  }
  switch (fn) {
    case 'elapsed_minutes': {
      const at = slotInstant(ctx.slots, args[0]);
      if (!at.known) return at;
      return known(
        'number',
        Math.max(0, Math.floor((ctx.now.getTime() - at.at.getTime()) / 60_000)),
      );
    }
    case 'within_working_hours': {
      const at = slotInstant(ctx.slots, args[1]);
      if (!at.known) return at;
      const within = ctx.facts.withinWorkingHours(at.at);
      return within === null ? notKnown(`fn ${name}`) : known('boolean', within);
    }
    case 'next_window': {
      const next = ctx.facts.nextWindow(ctx.now);
      return next === null || Number.isNaN(next.getTime())
        ? notKnown(`fn ${name}`)
        : { known: true, value: { kind: 'moment', value: next } };
    }
  }
}

function known(kind: 'number', value: number): ProcLookup;
function known(kind: 'boolean', value: boolean): ProcLookup;
function known(kind: 'text', value: string): ProcLookup;
function known(kind: 'number' | 'boolean' | 'text', value: number | boolean | string): ProcLookup {
  return { known: true, value: { kind, value } as ProcValue };
}

/** A settled `datetime` slot as an instant. */
function slotInstant(
  slots: AiStateObject,
  name: string | undefined,
): { known: true; at: Date } | { known: false; what: string; problem?: string } {
  if (name === undefined)
    return { known: false, what: 'fn', problem: 'a function argument is missing' };
  const lookup = slotValue(slots, name);
  if (!lookup.known) return lookup;
  if (lookup.value.kind !== 'moment' || lookup.value.value instanceof Date) {
    return { known: false, what: `slot ${name}`, problem: `slot ${name} is not a moment` };
  }
  const moment = lookup.value.value;
  if (moment.time === null) return { known: false, what: `slot ${name}` };
  const at = zonedInstant(moment.date, moment.time, moment.time_zone);
  return at === null
    ? { known: false, what: `slot ${name}`, problem: `slot ${name} is not a readable moment` }
    : { known: true, at };
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The zone's wall clock at an instant, as if it were UTC — its difference from the instant is the offset. */
function wallClockMs(at: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const part of zoneFormatter(timeZone).formatToParts(new Date(at))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return Date.UTC(
    parts['year'] ?? 0,
    (parts['month'] ?? 1) - 1,
    parts['day'] ?? 1,
    parts['hour'] ?? 0,
    parts['minute'] ?? 0,
  );
}

/**
 * `YYYY-MM-DD` + `HH:MM` on a zone's wall clock → the instant. The offset is
 * read at a first guess and again at the corrected instant, so a moment just
 * after a daylight-saving change lands on the right side of it. Null for a
 * zone `Intl` does not know or a malformed day.
 */
export function zonedInstant(date: string, time: string, timeZone: string): Date | null {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (day === null || clock === null) return null;
  const wall = Date.UTC(
    Number(day[1]),
    Number(day[2]) - 1,
    Number(day[3]),
    Number(clock[1]),
    Number(clock[2]),
  );
  try {
    const guess = wall - (wallClockMs(wall, timeZone) - wall);
    return new Date(wall - (wallClockMs(guess, timeZone) - guess));
  } catch {
    return null;
  }
}

/** An instant on a zone's wall clock, the way a slot keeps a moment. */
export function zonedMoment(at: Date, timeZone: string): SlotDateTime | null {
  try {
    const wall = new Date(wallClockMs(at.getTime(), timeZone)).toISOString();
    return { date: wall.slice(0, 10), time: wall.slice(11, 16), time_zone: timeZone };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Evaluation.
// ---------------------------------------------------------------------------

/** Three-valued: what the condition says, before unknown is counted as false. */
export type CondResult = boolean | 'unknown';

export interface CondEvaluation {
  /** What the executor acts on — unknown counts as false. */
  holds: boolean;
  /** For the decision record (ID-08 `cond_result`). */
  result: CondResult;
  /** What could not be decided, by name (`slot islem_zamani`, `fact method.expected_minutes`, `ai`) — never a value. */
  unknown: string[];
  /** One entry when the result is unknown, one per data fault (`ok: false`). Names, not values. */
  log: SkillRunLogEntry[];
}

interface Walk {
  ctx: ProcedureEvalContext;
  key: string;
  unknown: Set<string>;
  problems: string[];
}

/**
 * Answer `cond` against the conversation. `key` is whose condition it is —
 * the step's id, `slot.<name>`, `handoff.<n>` (`procedureAiQuestions`): an `ai`
 * question's answer is read under it, and the log names it.
 */
export function evaluateCondition(
  cond: Cond,
  ctx: ProcedureEvalContext,
  key: string,
): CondEvaluation {
  const walk: Walk = { ctx, key, unknown: new Set(), problems: [] };
  const result = evaluate(cond, walk, 0);
  const log: SkillRunLogEntry[] = walk.problems.map((detail) => ({
    step: key,
    detail: `condition: ${detail}`,
    ok: false,
  }));
  if (result === 'unknown') {
    log.push({
      step: key,
      detail: `condition unknown (${[...walk.unknown].join(', ') || 'unreadable'}) — counted as false`,
      ok: true,
    });
  }
  return { holds: result === true, result, unknown: [...walk.unknown], log };
}

/**
 * Whether a slot is required now: `always`, `never`, or its `required.when`
 * (keyed `slot.<name>`). The log entries of a conditional requirement go into
 * `log` — `planQuestions`' `required` takes `(def) => isSlotRequired(def, ctx, log)`.
 */
export function isSlotRequired(
  def: SlotDef,
  ctx: ProcedureEvalContext,
  log?: SkillRunLogEntry[],
): boolean {
  if (def.required === 'always') return true;
  if (def.required === 'never') return false;
  const evaluation = evaluateCondition(
    def.required.when as unknown as Cond,
    ctx,
    `slot.${def.name}`,
  );
  log?.push(...evaluation.log);
  return evaluation.holds;
}

function evaluate(cond: unknown, walk: Walk, depth: number): CondResult {
  if (depth > COND_DEPTH_MAX || !isObject(cond)) return fault(walk, 'malformed condition');
  const keys = Object.keys(cond);
  if (keys.length !== 1) return fault(walk, 'malformed condition');
  const body = cond[keys[0] as string];

  switch (keys[0]) {
    case 'all':
    case 'any': {
      if (!Array.isArray(body) || body.length === 0) return fault(walk, 'malformed condition');
      // Every part is evaluated, so the log names every unknown, not only the first.
      const parts = body.map((inner) => evaluate(inner, walk, depth + 1));
      const decisive = keys[0] === 'all' ? false : true;
      if (parts.includes(decisive)) return decisive;
      return parts.includes('unknown') ? 'unknown' : !decisive;
    }
    case 'not': {
      const inner = evaluate(body, walk, depth + 1);
      return inner === 'unknown' ? 'unknown' : !inner;
    }
    case 'ai': {
      const answer = walk.ctx.aiAnswers?.[walk.key];
      if (answer === true || answer === false) return answer;
      walk.unknown.add('ai');
      return 'unknown';
    }
    case 'slot': {
      if (!isObject(body) || typeof body['name'] !== 'string') {
        return fault(walk, 'malformed condition');
      }
      const name = body['name'];
      return compare(
        walk,
        `slot ${name}`,
        () => slotSettled(walk.ctx.slots, name),
        () => slotValue(walk.ctx.slots, name),
        body,
      );
    }
    case 'fact': {
      if (!isObject(body) || typeof body['path'] !== 'string') {
        return fault(walk, 'malformed condition');
      }
      const lookup = factValue(walk.ctx.facts, body['path']);
      return compare(
        walk,
        `fact ${body['path']}`,
        () => lookup.known,
        () => lookup,
        body,
      );
    }
    case 'fn': {
      if (!isObject(body) || typeof body['name'] !== 'string' || !isStringList(body['args'])) {
        return fault(walk, 'malformed condition');
      }
      const name = body['name'];
      const lookup = functionValue(name, body['args'], walk.ctx);
      if (body['op'] === undefined) {
        // A yes/no function's own answer.
        if (!lookup.known) return unknownOf(walk, lookup);
        return lookup.value.kind === 'boolean'
          ? lookup.value.value
          : fault(walk, `${name} is not a yes/no function`);
      }
      return compare(
        walk,
        `fn ${name}`,
        () => lookup.known,
        () => lookup,
        body,
      );
    }
  }
  return fault(walk, 'malformed condition');
}

/** `op` against `value`: `exists` / `missing` ask whether the left side is known; the rest compare it. */
function compare(
  walk: Walk,
  what: string,
  isKnown: () => boolean,
  left: () => ProcLookup,
  body: Record<string, unknown>,
): CondResult {
  const op = body['op'];
  if (op === 'exists') return isKnown();
  if (op === 'missing') return !isKnown();

  const subject = left();
  if (!subject.known) return unknownOf(walk, subject);
  const value = subject.value;
  const operand: unknown = body['value'];

  switch (op) {
    case 'eq':
    case 'neq': {
      const other = operandValue(walk, operand);
      if (other === null) return 'unknown';
      const same = equal(walk, what, value, other);
      return same === 'unknown' ? same : op === 'eq' ? same : !same;
    }
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte': {
      const other = operandValue(walk, operand);
      if (other === null) return 'unknown';
      if (value.kind !== 'number' || other.kind !== 'number') {
        return fault(walk, `${what}: ${op} compares numbers`);
      }
      const [a, b] = [value.value, other.value];
      return op === 'lt' ? a < b : op === 'lte' ? a <= b : op === 'gt' ? a > b : a >= b;
    }
    case 'in':
    case 'not_in': {
      if (!Array.isArray(operand)) return fault(walk, `${what}: ${op} takes a list`);
      let found: CondResult = false;
      for (const item of operand) {
        const other = literalValue(item);
        if (other === null) return fault(walk, `${what}: ${op} lists literal values`);
        const same = equal(walk, what, value, other);
        if (same === 'unknown') return same;
        if (same) found = true;
      }
      return op === 'in' ? found : !found;
    }
    case 'matches': {
      if (value.kind !== 'text') return fault(walk, `${what}: matches reads text`);
      const pattern = typeof operand === 'string' ? compiled(operand) : null;
      if (pattern === null) return fault(walk, `${what}: the pattern does not compile`);
      return pattern.test(value.value);
    }
  }
  return fault(walk, `${what}: unknown operator ${String(op)}`);
}

/** The right-hand side: a literal, or another slot's or fact's value. Null when it is unknown. */
function operandValue(walk: Walk, operand: unknown): ProcValue | null {
  if (isObject(operand)) {
    const lookup =
      typeof operand['slot'] === 'string'
        ? slotValue(walk.ctx.slots, operand['slot'])
        : typeof operand['fact'] === 'string'
          ? factValue(walk.ctx.facts, operand['fact'])
          : notKnown('value', 'a value is a literal, { slot } or { fact }');
    if (!lookup.known) {
      unknownOf(walk, lookup);
      return null;
    }
    return lookup.value;
  }
  const literal = literalValue(operand);
  if (literal === null) fault(walk, 'the comparison has no readable value');
  return literal;
}

function literalValue(value: unknown): ProcValue | null {
  if (typeof value === 'number' && Number.isFinite(value)) return { kind: 'number', value };
  if (typeof value === 'boolean') return { kind: 'boolean', value };
  if (typeof value === 'string') return { kind: 'text', value };
  return null;
}

/** Text compares the way an enum option is matched — trimmed, Turkish lower case. */
function equal(walk: Walk, what: string, a: ProcValue, b: ProcValue): CondResult {
  if (a.kind !== b.kind) return fault(walk, `${what}: compares a ${a.kind} value with a ${b.kind}`);
  switch (a.kind) {
    case 'number':
    case 'boolean':
      return a.value === (b as typeof a).value;
    case 'text':
      return foldText(a.value) === foldText((b as typeof a).value);
    default:
      return fault(walk, `${what}: a ${a.kind} value is not compared`);
  }
}

function foldText(text: string): string {
  return text.trim().toLocaleLowerCase('tr');
}

const patterns = new Map<string, RegExp | null>();

/** An author's pattern, compiled once — with the `u` flag, as the save-time check compiled it. */
function compiled(pattern: string): RegExp | null {
  if (!patterns.has(pattern)) {
    let regex: RegExp | null = null;
    try {
      regex = new RegExp(pattern, 'u');
    } catch {
      regex = null;
    }
    patterns.set(pattern, regex);
  }
  return patterns.get(pattern) ?? null;
}

function unknownOf(walk: Walk, lookup: { what: string; problem?: string }): 'unknown' {
  walk.unknown.add(lookup.what);
  if (lookup.problem !== undefined) walk.problems.push(lookup.problem);
  return 'unknown';
}

/** Data the definition or the tables should not have held: unknown, and logged as a fault. */
function fault(walk: Walk, problem: string): 'unknown' {
  walk.problems.push(problem);
  return 'unknown';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
