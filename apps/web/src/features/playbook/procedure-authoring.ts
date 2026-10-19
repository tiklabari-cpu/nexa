/**
 * Authoring a procedure skill (AI-03 · ADR-14a): the editor's model of the
 * definition, and the one function that turns it back into what `POST /skills`
 * takes.
 *
 * `step-authoring.ts` and `step-reorder.ts` answer the same questions for the
 * one-message step list; this file answers them for a procedure, in the same
 * shape — pure functions over an immutable draft, so an off-by-one in a splice
 * or a goto left pointing at a renamed step is a unit test, not a customer.
 *
 * There is no validator here. The editor gates Save on `validateSkillProcedure`
 * (@siyahtus/types), the function the API runs before storing, fed by
 * `procedureFields` — the body Save sends. One function on both sides, so the
 * editor can neither block a definition the server would take nor offer one it
 * would refuse (step-contract-parity.test.ts pins the rest).
 *
 * Invariants this file holds:
 *
 * 1. **Nothing the editor does not show is lost.** A stored definition read
 *    into a draft and written back out unchanged is the same definition —
 *    fields the forms do not edit (`ask_variants`, a tool step's inputs, a
 *    condition too rich for the simple form) ride along untouched.
 * 2. **An empty optional box is an absent field.** The validator refuses an
 *    empty `instruction` (`procedure_step_bad_option`) where it accepts none at
 *    all, so a cleared box is dropped rather than sent as `''`.
 * 3. **Renaming a step keeps the branches that go to it** — unless the new
 *    name is already another step's, where following it would silently point
 *    those branches at the wrong step.
 * 4. **Row keys are never reused** (as in `step-authoring.ts`): a step's
 *    authored `id` changes as it is typed, so React keys by a client key.
 */
import {
  COND_OPS_BY_KIND,
  DEFAULT_PROCEDURE_MAX_TURNS,
  DEFAULT_PROCEDURE_PRIORITY,
  PROCEDURE_FACTS,
  PROC_STEP_TYPES,
  SLOT_DEF_DEFAULTS,
  slotValueKind,
  validateSkillProcedure,
  type Cond,
  type CondOp,
  type CondOperand,
  type CondScalar,
  type CondValueKind,
  type ProcBranch,
  type ProcBranchStepType,
  type ProcHandoff,
  type ProcLimits,
  type ProcStep,
  type ProcStepType,
  type ProcTemplate,
  type ProcedureFactPath,
  type ProcedureValidation,
  type ProcedureValidationContext,
  type SkillProcedureBody,
  type SlotDef,
  type SlotType,
} from '@siyahtus/types';
import { moveStep } from './step-reorder.js';
import type { Skill } from './types.js';

/**
 * The step types "Add step" offers, in the order a procedure reads: speak,
 * ask, branch, answer, then the endings. `tool` is left off on purpose — F1
 * has no tools (AI-28), a tool step can only be stored passive, and offering
 * one would be offering a control that does nothing. A stored one is kept.
 */
export const EDITOR_PROC_STEP_TYPES = PROC_STEP_TYPES.filter(
  (type): type is Exclude<ProcStepType, 'tool'> => type !== 'tool',
);

/** What a `check` branch may hold besides a `goto`, in the editor's order. */
export const EDITOR_BRANCH_TYPES: readonly ProcBranchStepType[] = [
  'say',
  'answer_from_knowledge',
  'handoff',
  'resolve',
  'tag',
];

/** A step with the client key its row is rendered under (invariant 4). */
export interface ProcStepEntry {
  key: string;
  step: ProcStep;
}

/** The editor's whole procedure: the skill's selection fields and its body. */
export interface ProcedureDraft {
  when_to_use: string;
  examples: string[];
  priority: number;
  slots: SlotDef<Cond>[];
  steps: ProcStepEntry[];
  templates: ProcTemplate[];
  handoff: ProcHandoff;
  limits: ProcLimits;
  /** When the procedure may say a matter is solved (K9); absent: the agent's default. */
  resolution_criteria?: Cond;
}

/** What `POST`/`PATCH /skills` take for a procedure, besides `name` and `mode`. */
export interface ProcedureFieldsBody {
  when_to_use: string;
  examples: string[];
  priority: number;
  slots: SlotDef<Cond>[];
  procedure: SkillProcedureBody;
}

let entrySeq = 0;

function toEntry(step: ProcStep): ProcStepEntry {
  entrySeq += 1;
  return { key: `proc-step-${entrySeq}`, step };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A draft from a skill's stored fields, or from a compiled SOP draft — both
 * carry the same five. Anything missing takes the validator's default, so a
 * `single` skill switched to a procedure opens on an empty but well-formed one.
 */
export function procedureDraft(fields: {
  when_to_use?: unknown;
  examples?: unknown;
  priority?: unknown;
  slots?: unknown;
  procedure?: unknown;
}): ProcedureDraft {
  const body = isObject(fields.procedure) ? fields.procedure : {};
  const handoff = isObject(body['handoff']) ? body['handoff'] : {};
  const limits = isObject(body['limits']) ? body['limits'] : {};
  return {
    when_to_use: typeof fields.when_to_use === 'string' ? fields.when_to_use : '',
    examples: Array.isArray(fields.examples)
      ? fields.examples.filter((e): e is string => typeof e === 'string')
      : [],
    priority: typeof fields.priority === 'number' ? fields.priority : DEFAULT_PROCEDURE_PRIORITY,
    slots: Array.isArray(fields.slots) ? (structuredClone(fields.slots) as SlotDef<Cond>[]) : [],
    steps: (Array.isArray(body['steps']) ? (structuredClone(body['steps']) as ProcStep[]) : []).map(
      toEntry,
    ),
    templates: Array.isArray(body['templates'])
      ? (structuredClone(body['templates']) as ProcTemplate[])
      : [],
    handoff: {
      conditions: [],
      card_fields: [],
      ...(structuredClone(handoff) as Partial<ProcHandoff>),
    },
    limits: {
      max_turns: DEFAULT_PROCEDURE_MAX_TURNS,
      ...(structuredClone(limits) as Partial<ProcLimits>),
    },
    // Carried through untouched: a draft that dropped it would erase the
    // criteria on the next Save (invariant 1).
    ...(isObject(body['resolution_criteria'])
      ? { resolution_criteria: structuredClone(body['resolution_criteria']) as Cond }
      : {}),
  };
}

/** A skill's own draft: what the editor opens on. */
export function skillProcedureDraft(skill: Skill): ProcedureDraft {
  return procedureDraft({
    when_to_use: skill.when_to_use,
    examples: skill.examples,
    priority: skill.priority,
    slots: skill.slots,
    procedure: skill.procedure,
  });
}

/** Drop the optional string fields an author cleared (invariant 2). */
function withoutBlank<T extends object>(value: T, keys: readonly string[]): T {
  const out = { ...value } as Record<string, unknown>;
  for (const key of keys) {
    const field = out[key];
    if (typeof field === 'string' && field.trim() === '') delete out[key];
  }
  return out as T;
}

const OPTIONAL_STEP_TEXT = ['instruction', 'template_key', 'query_hint', 'followup_template'];

function cleanBranch(branch: ProcBranch | undefined): ProcBranch | undefined {
  if (branch === undefined || 'goto' in branch) return branch;
  return withoutBlank(branch, OPTIONAL_STEP_TEXT);
}

function cleanStep(step: ProcStep): ProcStep {
  const cleaned = withoutBlank(step, OPTIONAL_STEP_TEXT);
  if (cleaned.type !== 'check') return cleaned;
  const then = cleanBranch(cleaned.then);
  const otherwise = cleanBranch(cleaned.else);
  return {
    ...cleaned,
    ...(then !== undefined ? { then } : {}),
    ...(otherwise !== undefined ? { else: otherwise } : {}),
  };
}

/**
 * The body Save sends and the validator judges — the editor's one way out.
 * Example sentences and card fields arrive already split (one per line).
 */
export function procedureFields(draft: ProcedureDraft): ProcedureFieldsBody {
  return {
    when_to_use: draft.when_to_use,
    examples: draft.examples,
    priority: draft.priority,
    slots: draft.slots.map((slot) => withoutBlank(slot, ['card_label'])),
    procedure: {
      steps: draft.steps.map((entry) => cleanStep(entry.step)),
      templates: draft.templates,
      handoff: withoutBlank(draft.handoff, ['next_step_hint']),
      limits: draft.limits,
      ...(draft.resolution_criteria !== undefined
        ? { resolution_criteria: draft.resolution_criteria }
        : {}),
    },
  };
}

/** The save-time verdict on the draft, with the API's own rules (one function, both sides). */
export function validateDraft(
  draft: ProcedureDraft,
  context: ProcedureValidationContext = {},
): ProcedureValidation {
  return validateSkillProcedure(procedureFields(draft), context);
}

// ---------------------------------------------------------------------------
// Steps.
// ---------------------------------------------------------------------------

/** `say_1`, `say_2`, … — the first the procedure does not use yet. */
export function nextStepId(steps: readonly ProcStepEntry[], type: ProcStepType): string {
  const used = new Set(steps.map((entry) => entry.step.id));
  let n = 1;
  while (used.has(`${type}_${n}`)) n += 1;
  return `${type}_${n}`;
}

/**
 * A new step of `type`, with its required fields present but empty — so the
 * validator names what is missing (and Save waits) instead of the editor
 * inventing a value. `resolve` and `answer_from_knowledge` are complete as
 * they are: their one required choice has a default, or there is none.
 */
export function blankProcStep(type: ProcStepType, id: string): ProcStep {
  switch (type) {
    case 'say':
      return { id, type, instruction: '' };
    case 'collect':
      return { id, type, slots: [] };
    case 'check':
      return { id, type, when: blankCondition(), then: { goto: '' } };
    case 'answer_from_knowledge':
      return { id, type };
    case 'handoff':
      return { id, type, reason_code: '' };
    case 'resolve':
      return { id, type, outcome: 'resolved' };
    case 'tag':
      return { id, type, tag: '' };
    case 'tool':
      return { id, type, tool_key: '', inputs: {}, active: false };
  }
}

/** The condition a new check (or a new "Only if…") starts from: a slot not chosen yet. */
export function blankCondition(): Cond {
  return { slot: { name: '', op: 'exists' } };
}

export function addProcStep(steps: readonly ProcStepEntry[], type: ProcStepType): ProcStepEntry[] {
  return [...steps, toEntry(blankProcStep(type, nextStepId(steps, type)))];
}

export function removeProcStep(steps: readonly ProcStepEntry[], index: number): ProcStepEntry[] {
  if (index < 0 || index >= steps.length) return [...steps];
  return steps.filter((_entry, i) => i !== index);
}

/** Same rule as the one-message list: `moveStep`, so drag and ↑/↓ cannot disagree. */
export function moveProcStep(
  steps: readonly ProcStepEntry[],
  from: number,
  to: number,
): ProcStepEntry[] {
  return moveStep(steps, from, to);
}

/**
 * Retype a step, keeping its row, its id and its instruction. Its guard
 * (`when`) survives unless the step becomes or stops being a `check`, whose
 * `when` is the branch condition — a guard silently turned into a branch (or
 * back) would change what the step does without anyone choosing it.
 */
export function changeProcStepType(
  steps: readonly ProcStepEntry[],
  index: number,
  type: ProcStepType,
): ProcStepEntry[] {
  const entry = steps[index];
  if (!entry || entry.step.type === type) return [...steps];
  const previous = entry.step;
  const next = blankProcStep(type, previous.id) as ProcStep & Record<string, unknown>;
  if (previous.instruction !== undefined) next.instruction = previous.instruction;
  if (previous.type !== 'check' && type !== 'check' && previous.when !== undefined) {
    next.when = previous.when;
  }
  return steps.map((current, i) => (i === index ? { key: current.key, step: next } : current));
}

/**
 * Merge `patch` into the step at `index`; a key set to `undefined` is removed
 * (as `updateStep` does), so clearing an optional field leaves the JSON of a
 * step that never had it.
 */
export function updateProcStep(
  steps: readonly ProcStepEntry[],
  index: number,
  patch: Record<string, unknown>,
): ProcStepEntry[] {
  const entry = steps[index];
  if (!entry) return [...steps];
  const next: Record<string, unknown> = { ...entry.step };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return steps.map((current, i) =>
    i === index ? { key: current.key, step: next as unknown as ProcStep } : current,
  );
}

function retarget(
  branch: ProcBranch | undefined,
  from: string,
  to: string,
): ProcBranch | undefined {
  return branch !== undefined && 'goto' in branch && branch.goto === from ? { goto: to } : branch;
}

/** Give the step at `index` a new id, and the branches that went to it follow (invariant 3). */
export function renameProcStep(
  steps: readonly ProcStepEntry[],
  index: number,
  id: string,
): ProcStepEntry[] {
  const entry = steps[index];
  if (!entry) return [...steps];
  const old = entry.step.id;
  const count = (name: string) => steps.filter((current) => current.step.id === name).length;
  const follow = old !== id && count(old) === 1 && count(id) === 0;

  return steps.map((current, i) => {
    if (i === index) return { key: current.key, step: { ...current.step, id } };
    if (!follow || current.step.type !== 'check') return current;
    const step = current.step;
    const then = retarget(step.then, old, id) as ProcBranch;
    const otherwise = retarget(step.else, old, id);
    if (then === step.then && otherwise === step.else) return current;
    return {
      key: current.key,
      step: { ...step, then, ...(otherwise !== undefined ? { else: otherwise } : {}) },
    };
  });
}

/** What a branch is, as the branch control offers it. */
export type BranchKind = 'goto' | ProcBranchStepType;

export function branchKind(branch: ProcBranch): BranchKind {
  return 'goto' in branch ? 'goto' : branch.type;
}

/** A new branch of `kind`, required fields present but empty (as `blankProcStep`). */
export function blankBranch(kind: BranchKind): ProcBranch {
  if (kind === 'goto') return { goto: '' };
  const { id: _id, ...inline } = blankProcStep(kind, 'x') as ProcStep & { when?: Cond };
  return inline as ProcBranch;
}

// ---------------------------------------------------------------------------
// Slots and templates.
// ---------------------------------------------------------------------------

/** A new piece of information to collect: the validator's defaults, name and texts empty. */
export function blankSlot(): SlotDef<Cond> {
  return {
    name: '',
    label: '',
    type: 'text',
    ask: '',
    required: SLOT_DEF_DEFAULTS.required,
    pii: SLOT_DEF_DEFAULTS.pii,
    show_in_card: SLOT_DEF_DEFAULTS.show_in_card,
    max_attempts: SLOT_DEF_DEFAULTS.max_attempts,
    confirm: SLOT_DEF_DEFAULTS.confirm,
  };
}

/**
 * Retype a slot. Its checks (`validate`) belong to the old type — a `min` on a
 * number means nothing on a date — so they go; a new `enum` starts with an
 * empty list of options, which the validator names.
 */
export function changeSlotType(slot: SlotDef<Cond>, type: SlotType): SlotDef<Cond> {
  if (slot.type === type) return slot;
  const { validate: _validate, ...rest } = slot;
  return { ...rest, type, ...(type === 'enum' ? { validate: { enum_values: [] } } : {}) };
}

export function blankTemplate(): ProcTemplate {
  return { key: '', text: '' };
}

/** Replace the list item at `index`, leaving the rest as they were. */
export function replaceAt<T>(list: readonly T[], index: number, item: T): T[] {
  return list.map((current, i) => (i === index ? item : current));
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
  return list.filter((_item, i) => i !== index);
}

/** One per line, blanks ignored — example sentences, card fields, enum options. */
export function parseLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function formatLines(lines: readonly string[] | undefined): string {
  return (lines ?? []).join('\n');
}

// ---------------------------------------------------------------------------
// Conditions — the simple form ("Only if … / If …").
// ---------------------------------------------------------------------------

/**
 * A condition the one-row form can show: a slot, a table value or the time
 * since a moment compared to a value (or to a table value), or a yes/no
 * question for the AI. Anything richer — `all`/`any`/`not`, the working-hours
 * function, a comparison with another slot — is edited as JSON, and kept
 * exactly as written (invariant 1).
 */
export type SimpleCond =
  | {
      kind: 'slot' | 'fact' | 'elapsed';
      /** The slot's name, the fact's path, or the `datetime` slot for `elapsed`. */
      subject: string;
      op: CondOp;
      /** The literal as typed; a list is comma-separated. Ignored when `valueFact` is set. */
      value: string;
      /** Compare with a table value instead: `method.expected_minutes`. */
      valueFact?: string;
    }
  | { kind: 'ai'; question: string }
  /** `player_confirmed()` — the player said yes to "is it solved?" (K9); offered for resolution criteria only. */
  | { kind: 'confirmed' };

/** The conditions that compare a subject — the ones with an operator and a value. */
export type ComparisonCond = Extract<SimpleCond, { subject: string }>;

function isScalar(value: unknown): value is CondScalar {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

/** The operand as the form shows it, or null when the form cannot (another slot's value). */
function operandText(value: CondOperand | undefined): { value: string; valueFact?: string } | null {
  if (value === undefined) return { value: '' };
  if (isScalar(value)) return { value: String(value) };
  if (Array.isArray(value)) return value.every(isScalar) ? { value: value.join(', ') } : null;
  const operand = value as Record<string, unknown>;
  if (typeof operand['fact'] === 'string' && Object.keys(operand).length === 1) {
    return { value: '', valueFact: operand['fact'] };
  }
  return null;
}

/** The simple form of `cond`, or null when only the JSON editor can hold it. */
export function simpleCond(cond: Cond | undefined): SimpleCond | null {
  if (!isObject(cond) || Object.keys(cond).length !== 1) return null;
  if (
    'fn' in cond &&
    isObject(cond.fn) &&
    cond.fn['name'] === 'player_confirmed' &&
    Object.keys(cond.fn).length === 2 &&
    Array.isArray(cond.fn['args']) &&
    cond.fn['args'].length === 0
  ) {
    return { kind: 'confirmed' };
  }
  if ('ai' in cond && isObject(cond.ai) && typeof cond.ai.question === 'string') {
    return Object.keys(cond.ai).length === 1 ? { kind: 'ai', question: cond.ai.question } : null;
  }
  const comparison = (
    kind: 'slot' | 'fact' | 'elapsed',
    subject: unknown,
    body: Record<string, unknown>,
    keys: readonly string[],
  ): SimpleCond | null => {
    if (typeof subject !== 'string' || !Object.keys(body).every((key) => keys.includes(key))) {
      return null;
    }
    const op = body['op'];
    if (typeof op !== 'string') return null;
    const operand = operandText(body['value'] as CondOperand | undefined);
    return operand === null ? null : { kind, subject, op: op as CondOp, ...operand };
  };
  if ('slot' in cond && isObject(cond.slot)) {
    return comparison('slot', cond.slot['name'], cond.slot, ['name', 'op', 'value']);
  }
  if ('fact' in cond && isObject(cond.fact)) {
    return comparison('fact', cond.fact['path'], cond.fact, ['path', 'op', 'value']);
  }
  if ('fn' in cond && isObject(cond.fn) && cond.fn['name'] === 'elapsed_minutes') {
    const args = cond.fn['args'];
    if (!Array.isArray(args) || args.length !== 1) return null;
    return comparison('elapsed', args[0], cond.fn, ['name', 'args', 'op', 'value']);
  }
  return null;
}

/** What kind of value the form's subject holds — picks the operators and parses the literal. */
export function simpleValueKind(
  simple: ComparisonCond,
  slots: readonly SlotDef<Cond>[],
): CondValueKind {
  if (simple.kind === 'elapsed') return 'number';
  if (simple.kind === 'fact') {
    return (PROCEDURE_FACTS as Record<string, CondValueKind>)[simple.subject] ?? 'text';
  }
  const slot = slots.find((candidate) => candidate.name === simple.subject);
  return slot ? slotValueKind(slot.type) : 'text';
}

/** The operators the form offers for a subject: the ones the validator accepts for its kind. */
export function simpleOps(
  simple: ComparisonCond,
  slots: readonly SlotDef<Cond>[],
): readonly CondOp[] {
  return COND_OPS_BY_KIND[simpleValueKind(simple, slots)];
}

export const VALUELESS_OPS: readonly CondOp[] = ['exists', 'missing'];

function parseScalar(text: string, kind: CondValueKind): CondScalar {
  const trimmed = text.trim();
  if (kind === 'number') {
    const number = Number(trimmed.replace(',', '.'));
    // Left as text when it is not a number: the validator names the comparison.
    return trimmed !== '' && Number.isFinite(number) ? number : trimmed;
  }
  if (kind === 'boolean') {
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
  }
  return trimmed;
}

/** The condition the simple form describes, values typed by what the subject holds. */
export function condFromSimple(simple: SimpleCond, slots: readonly SlotDef<Cond>[]): Cond {
  if (simple.kind === 'ai') return { ai: { question: simple.question } };
  if (simple.kind === 'confirmed') return { fn: { name: 'player_confirmed', args: [] } };
  const kind = simpleValueKind(simple, slots);
  let value: CondOperand | undefined;
  if (VALUELESS_OPS.includes(simple.op)) value = undefined;
  else if (simple.valueFact !== undefined) value = { fact: simple.valueFact as ProcedureFactPath };
  else if (simple.op === 'in' || simple.op === 'not_in') {
    value = simple.value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)
      .map((part) => parseScalar(part, kind));
  } else value = parseScalar(simple.value, kind);

  const comparison = { op: simple.op, ...(value !== undefined ? { value } : {}) };
  switch (simple.kind) {
    case 'slot':
      return { slot: { name: simple.subject, ...comparison } };
    case 'fact':
      return { fact: { path: simple.subject as ProcedureFactPath, ...comparison } };
    case 'elapsed':
      return { fn: { name: 'elapsed_minutes', args: [simple.subject], ...comparison } };
  }
}

/**
 * Switch the form to another kind of subject. The operator is kept when the
 * new subject takes it; otherwise it falls back to `exists` (or `gt` for a
 * time comparison, which has no `exists`-shaped question worth asking).
 */
export function changeSimpleKind(
  simple: SimpleCond,
  kind: SimpleCond['kind'],
  slots: readonly SlotDef<Cond>[],
): SimpleCond {
  if (kind === 'ai') return { kind, question: simple.kind === 'ai' ? simple.question : '' };
  if (kind === 'confirmed') return { kind };
  const op =
    simple.kind === 'ai' || simple.kind === 'confirmed'
      ? kind === 'elapsed'
        ? 'gt'
        : 'exists'
      : simple.op;
  const next: SimpleCond = { kind, subject: '', op, value: '' };
  return simpleOps(next, slots).includes(op)
    ? next
    : { ...next, op: kind === 'elapsed' ? 'gt' : 'exists' };
}

// ---------------------------------------------------------------------------
// The list.
// ---------------------------------------------------------------------------

/** The steps a skill runs, in whichever mode it is — the list's count and readiness read this. */
export function skillStepCount(skill: Pick<Skill, 'mode' | 'steps' | 'procedure'>): number {
  if (skill.mode === 'procedure') {
    const steps = skill.procedure?.steps;
    return Array.isArray(steps) ? steps.length : 0;
  }
  return skill.steps.length;
}

/**
 * A one-message skill with steps and no `detect_intent` gate: it matches every
 * message, so it answers only when nothing else does (AI-05 §5) — what the
 * list warns about. Moved onto the fallback when procedures arrived (tm 297.2).
 */
export function matchesEveryMessage(skill: Pick<Skill, 'mode' | 'steps'>): boolean {
  if (skill.mode === 'procedure') return false;
  return skill.steps.length > 0 && !skill.steps.some((step) => step.type === 'detect_intent');
}
