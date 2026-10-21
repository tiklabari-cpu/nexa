/**
 * Procedures — the multi-turn skill (tm 296.1 · SiyahTuş analysis AI-03 ·
 * ADR-14a `docs/adr/skill-procedure.md`).
 *
 * "Param yatmadı" is not answered in one message: the AI asks for the method
 * and the time, compares them with the method's expected time, then explains
 * the wait or asks for the site request, the sending account and the receipt,
 * and either settles the matter or hands it to finance. A skill with
 * `mode: 'procedure'` is that conversation written down as an ordered step
 * list — no canvas, no graph (ADR-14a §2): a step may wait for the player's
 * answer (`collect`) and may carry a condition (`when`, `check`).
 *
 * This module is the definition and the save-time judgement, shared so the
 * procedure editor (web) and the endpoint that stores a procedure (api) refuse
 * the same definitions with the same codes:
 *
 *   - `Procedure`, `ProcStep` (eight step types) and `Cond`, the condition
 *     language: a fixed operator list, four fixed functions, the AI-13 fact
 *     paths and a yes/no question for the model — no free expression, no eval.
 *     A new function is a code change here, never an author's text;
 *   - `resolution_criteria` (K9 · tm 303.4): what must hold before a `resolve`
 *     step may say the matter is solved, in the same language — and
 *     {@link validateResolutionCriteria} for the workspace's default;
 *   - templates and their `{variable}` grammar — a slot, a fact path or a
 *     function call between braces;
 *   - `validateProcedure`, every problem as a stable code: a `goto` to no step,
 *     a loop nothing in which waits for the player, a `collect` of three slots,
 *     an undefined template variable, a sensitive slot (`slots.ts`), a team the
 *     license does not have, a structural change to a locked procedure — and,
 *     as a warning, the steps nothing reaches.
 *
 * Running a procedure — the step loop, evaluating a condition, filling a
 * template — is the API's (`conversation/procedure/`, #296.3 · #296.7).
 */
import {
  type SensitiveSlotCategory,
  type SlotDef,
  type SlotEnumSource,
  type SlotProblemCode,
  type SlotType,
  SLOT_TYPES,
  authorPatternProblem,
  validateSlotDefs,
} from './slots.js';

// ---------------------------------------------------------------------------
// Steps.
// ---------------------------------------------------------------------------

/**
 * What a step does (AI-03 §1, §4).
 *
 *   - `say`                   — a template, or an instruction the reply is
 *                               written from. The `say` steps of one turn make
 *                               one message.
 *   - `collect`               — ask for whichever of its (at most two) slots are
 *                               required and still missing, and wait for the
 *                               answer; nothing missing, it passes.
 *   - `check`                 — branch: `then` when its condition holds, `else`
 *                               (or the next step) when it does not.
 *   - `answer_from_knowledge` — answer from the knowledge base (AI-06).
 *   - `handoff`               — hand over to a person (AI-09/10/12); the
 *                               procedure ends.
 *   - `resolve`               — mark the outcome; the procedure ends.
 *   - `tag`                   — tag the conversation.
 *   - `tool`                  — where a system lookup will go (AI-28, ADR-14a
 *                               §2.6). Passive in F1: skipped and logged.
 */
export const PROC_STEP_TYPES = [
  'say',
  'collect',
  'check',
  'answer_from_knowledge',
  'handoff',
  'resolve',
  'tag',
  'tool',
] as const;
export type ProcStepType = (typeof PROC_STEP_TYPES)[number];

/** The step types a `check` branch may carry in place of a `goto`. */
export const PROC_BRANCH_STEP_TYPES = [
  'say',
  'answer_from_knowledge',
  'handoff',
  'resolve',
  'tag',
] as const satisfies readonly ProcStepType[];
export type ProcBranchStepType = (typeof PROC_BRANCH_STEP_TYPES)[number];

/** The step types after which nothing in the procedure runs. */
export const PROC_TERMINAL_STEP_TYPES: readonly ProcStepType[] = ['handoff', 'resolve'];

/** How a `resolve` step closes the matter: settled, or settled pending the wait it explained. */
export const PROC_OUTCOMES = ['resolved', 'resolved_waiting'] as const;
export type ProcOutcome = (typeof PROC_OUTCOMES)[number];

interface ProcStepBase {
  /**
   * Lower snake_case and unique in the procedure: what a `goto`, the run log
   * and the decision record (ID-08) name.
   */
  id: string;
  /** Plain-language guidance for the reply this step contributes to. */
  instruction?: string;
  /** Run the step only when this holds; otherwise go on to the next one. */
  when?: Cond;
}

/** At least one of the two; a template missing a variable falls back to the instruction. */
export interface ProcSayStep extends ProcStepBase {
  type: 'say';
  template_key?: string;
}

export interface ProcCollectStep extends ProcStepBase {
  type: 'collect';
  /** One or two slot names (`PROCEDURE_COLLECT_SLOTS_MAX`). */
  slots: string[];
}

/** `when` is the branch condition here, not a guard: false takes `else`, or the next step. */
export interface ProcCheckStep extends Omit<ProcStepBase, 'when'> {
  type: 'check';
  when: Cond;
  then: ProcBranch;
  else?: ProcBranch;
}

export interface ProcAnswerStep extends ProcStepBase {
  type: 'answer_from_knowledge';
  /** What to search for, when the player's words alone would not find it. */
  query_hint?: string;
}

/**
 * Hand over. `reason_code` is the procedure's own reason, shown on the card
 * (AI-10) — `expected_time_exceeded`, `third_party_payment`; the hand-over
 * itself is recorded as a procedure rule (AI-09). Without a `target` the team
 * comes from the routes (AI-12).
 */
export interface ProcHandoffStep extends ProcStepBase {
  type: 'handoff';
  reason_code: string;
  target?: HandoffTarget;
}

export interface ProcResolveStep extends ProcStepBase {
  type: 'resolve';
  outcome: ProcOutcome;
  /** The template sent with it: "if it still has not arrived in {method.expected_minutes} minutes…". */
  followup_template?: string;
}

export interface ProcTagStep extends ProcStepBase {
  type: 'tag';
  tag: string;
}

/**
 * A system lookup (AI-28): `inputs` maps the tool's input names to slot names.
 * F1 has no tools — `active` is `false`, the engine skips the step and logs it,
 * and the card lists it as something to check.
 */
export interface ProcToolStep extends ProcStepBase {
  type: 'tool';
  tool_key: string;
  inputs: Record<string, string>;
  active: false;
}

export type ProcStep =
  | ProcSayStep
  | ProcCollectStep
  | ProcCheckStep
  | ProcAnswerStep
  | ProcHandoffStep
  | ProcResolveStep
  | ProcTagStep
  | ProcToolStep;

type Inline<S> = Omit<S, 'id' | 'when'>;

/** A step written inside a `check` branch: no id, no guard; a non-ending one goes on after the check. */
export type ProcInlineStep =
  | Inline<ProcSayStep>
  | Inline<ProcAnswerStep>
  | Inline<ProcHandoffStep>
  | Inline<ProcResolveStep>
  | Inline<ProcTagStep>;

export interface ProcGoto {
  /** The id of the step to go on from. */
  goto: string;
}

export type ProcBranch = ProcGoto | ProcInlineStep;

/**
 * Who a hand-over goes to (AI-12): a team by id — a renamed team still
 * receives it — or a routing topic (`finance`, `kyc_risk`, ADR-08a) the
 * license's routes resolve. A template names topics, never a team.
 */
export type HandoffTarget = { group_id: number } | { topic: string };

// ---------------------------------------------------------------------------
// Conditions.
// ---------------------------------------------------------------------------

/**
 * The operators. `exists` / `missing` take no value: `exists` — the slot is
 * settled (or the fact is known), `missing` — it is not. `matches` takes a
 * pattern an author wrote, held to the same rules as a slot's `regex`.
 */
export const COND_OPS = [
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'in',
  'not_in',
  'exists',
  'missing',
  'matches',
] as const;
export type CondOp = (typeof COND_OPS)[number];

/**
 * What a condition compares: a quantity, a yes/no, text, a moment, a file. A
 * `money` slot compares by its amount. A moment is not ordered by an operator —
 * `elapsed_minutes` turns it into a quantity.
 */
export type CondValueKind = 'number' | 'boolean' | 'text' | 'moment' | 'file';

/** The operators each kind of value takes. */
export const COND_OPS_BY_KIND: Readonly<Record<CondValueKind, readonly CondOp[]>> = {
  number: ['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'in', 'not_in', 'exists', 'missing'],
  boolean: ['eq', 'neq', 'exists', 'missing'],
  text: ['eq', 'neq', 'in', 'not_in', 'exists', 'missing', 'matches'],
  moment: ['exists', 'missing'],
  file: ['exists', 'missing'],
};

/** The kind of value a slot of each type holds, for its conditions. */
export function slotValueKind(type: SlotType): CondValueKind {
  switch (type) {
    case 'number':
    case 'money':
    case 'duration':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'datetime':
    case 'date':
      return 'moment';
    case 'file':
      return 'file';
    default:
      return 'text';
  }
}

/**
 * The functions — a fixed list (AI-03 §1). Adding one is a code change.
 *
 *   - `elapsed_minutes(slot)`             — minutes since a `datetime` slot's moment.
 *   - `within_working_hours(method, slot)` — whether the method processes at that moment.
 *   - `next_window(method)`               — when the method next processes.
 *   - `player_confirmed()`                — the player answered the AI's "is it
 *     solved?" with a yes (K9 · tm 303.4); no, a no; unknown until it was asked
 *     and answered either way. The default "resolved" criterion.
 */
export const COND_FNS = [
  'elapsed_minutes',
  'within_working_hours',
  'next_window',
  'player_confirmed',
] as const;
export type CondFnName = (typeof COND_FNS)[number];

/**
 * A function parameter: `moment_slot` — the name of a `datetime` slot;
 * `method` — the word `method`, the payment method the procedure collected.
 */
export type CondFnParam = 'moment_slot' | 'method';

export const COND_FN_SIGNATURES: Readonly<
  Record<CondFnName, { params: readonly CondFnParam[]; returns: CondValueKind }>
> = {
  elapsed_minutes: { params: ['moment_slot'], returns: 'number' },
  within_working_hours: { params: ['method', 'moment_slot'], returns: 'boolean' },
  next_window: { params: ['method'], returns: 'moment' },
  player_confirmed: { params: [], returns: 'boolean' },
};

/**
 * The structured tables a fact comes from (AI-13, #310): `method` is the row
 * the procedure's payment-method slot names, `bonus` the bonus slot's,
 * `kyc_document` the document slot's. A fact is known only when the procedure
 * has a slot of the entity's `enum_source`.
 */
export const PROCEDURE_FACT_ENTITIES = {
  method: ['payment_methods.deposit', 'payment_methods.withdrawal'],
  bonus: ['bonuses'],
  kyc_document: ['kyc_documents'],
} as const satisfies Record<string, readonly SlotEnumSource[]>;
export type ProcedureFactEntity = keyof typeof PROCEDURE_FACT_ENTITIES;

/**
 * The fact paths and the kind of value each holds — the AI-13 table columns a
 * condition or a template reads (`method.expected_minutes` → "30 dakika").
 * The API resolves them from the rows (`conversation/facts.ts`, tm 310.3).
 */
export const PROCEDURE_FACTS = {
  'method.name': 'text',
  'method.currency': 'text',
  'method.min_amount': 'number',
  'method.max_amount': 'number',
  'method.expected_minutes': 'number',
  'method.delay_threshold_minutes': 'number',
  'method.working_hours': 'text',
  'method.requires_site_request': 'boolean',
  'method.receipt_required': 'boolean',
  'method.third_party_allowed': 'boolean',
  'method.reference_instructions': 'text',
  'bonus.name': 'text',
  'bonus.min_deposit': 'number',
  'bonus.wagering_multiplier': 'number',
  'bonus.min_odds': 'number',
  'bonus.max_bet': 'number',
  'bonus.max_cashout': 'number',
  'bonus.validity_days': 'number',
  'bonus.claim_method': 'text',
  'bonus.promo_code': 'text',
  'kyc_document.doc_type': 'text',
  'kyc_document.review_hours': 'number',
  'kyc_document.upload_path_text': 'text',
  'kyc_document.chat_upload_allowed': 'boolean',
} as const satisfies Record<string, CondValueKind>;
export type ProcedureFactPath = keyof typeof PROCEDURE_FACTS;

export type CondScalar = string | number | boolean;

/** A literal, a list for `in` / `not_in`, or another slot's or fact's value. */
export type CondOperand =
  CondScalar | CondScalar[] | { slot: string } | { fact: ProcedureFactPath };

export interface CondComparison {
  op: CondOp;
  value?: CondOperand;
}

/**
 * A condition: exactly one key. `fn` without `op` is a yes/no function's own
 * answer. `ai` is a yes/no question the understanding call (AI-05) answers;
 * `unknown` counts as false and is logged. One `ai` question per step, per
 * hand-over condition and per slot — its answer is keyed by them
 * (`procedureAiQuestions`). A rule reads the same every time; prefer it.
 */
export type Cond =
  | { all: Cond[] }
  | { any: Cond[] }
  | { not: Cond }
  | { slot: { name: string } & CondComparison }
  | { fact: { path: ProcedureFactPath } & CondComparison }
  | { fn: { name: CondFnName; args: string[]; op?: CondOp; value?: CondOperand } }
  | { ai: { question: string } };

// ---------------------------------------------------------------------------
// The procedure.
// ---------------------------------------------------------------------------

/**
 * A reply text. `{name}` is replaced by what the procedure knows: a slot
 * (`{yontem}`), a fact (`{method.expected_minutes}`) or a function
 * (`{elapsed_minutes(islem_zamani)}`). A template with a variable the
 * conversation cannot fill is not sent (#296.7). `verbatim` text — a legal
 * notice — goes out as written; the model does not rephrase it.
 */
export interface ProcTemplate {
  key: string;
  text: string;
  verbatim?: boolean;
}

/** The procedure's hand-over (AI-09, AI-10, AI-12). */
export interface ProcHandoff {
  /** Checked every turn: any one holding hands the conversation over. */
  conditions: Cond[];
  target?: HandoffTarget;
  /** What the card shows as the decision's basis: a slot, fact or function (no braces). */
  card_fields: string[];
  /** The card's suggested next step for the agent — template text. */
  next_step_hint?: string;
}

export interface ProcLimits {
  /** AI turns before the procedure hands over with reason `max_turns`. */
  max_turns: number;
}

/**
 * A skill's procedure, every default filled in. The skill row keeps
 * `when_to_use`, `examples`, `priority` and `slots` in their own columns and
 * the rest in `procedure` (#296.2); a conversation pins the whole of it in
 * `ai_conversations.procedure_snapshot` when it starts (#296.3).
 */
export interface Procedure {
  /** When the procedure applies, in plain words — what AI-05 selects by. */
  when_to_use: string;
  /** Player sentences it should match: "param yatmadı", "havale attım gözükmüyor". */
  examples: string[];
  /** Between two equally likely procedures the smaller number wins. */
  priority: number;
  slots: SlotDef<Cond>[];
  steps: ProcStep[];
  templates: ProcTemplate[];
  handoff: ProcHandoff;
  limits: ProcLimits;
  /**
   * When the matter counts as solved (K9 · tm 303.4): a `resolve` step says so
   * only once this holds — "these slots are filled and the player said yes"
   * (`player_confirmed()`). Absent: the workspace's default, else the
   * platform's (`DEFAULT_RESOLUTION_CRITERIA`, the player's explicit yes).
   */
  resolution_criteria?: Cond;
}

export const DEFAULT_PROCEDURE_PRIORITY = 100;
export const PROCEDURE_PRIORITY_MIN = 1;
export const PROCEDURE_PRIORITY_MAX = 1000;
export const DEFAULT_PROCEDURE_MAX_TURNS = 12;
export const PROCEDURE_MAX_TURNS_MIN = 1;
export const PROCEDURE_MAX_TURNS_MAX = 50;

/** The defaults an omitted field takes. */
export const PROCEDURE_DEFAULTS = {
  examples: [],
  priority: DEFAULT_PROCEDURE_PRIORITY,
  slots: [],
  templates: [],
  handoff: { conditions: [], card_fields: [] },
  limits: { max_turns: DEFAULT_PROCEDURE_MAX_TURNS },
} as const satisfies Partial<Procedure>;

/** Lower snake_case, starting with a letter — step ids, template keys, reason and tool keys, topics. */
export const PROCEDURE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;

export const PROCEDURE_WHEN_TO_USE_MAX = 1000;
export const PROCEDURE_EXAMPLES_MAX = 30;
export const PROCEDURE_EXAMPLE_MAX = 300;
export const PROCEDURE_STEPS_MAX = 40;
/** A `collect` asks at most this many slots — the default `max_questions_per_message` (AI-07). */
export const PROCEDURE_COLLECT_SLOTS_MAX = 2;
export const PROCEDURE_INSTRUCTION_MAX = 1000;
export const PROCEDURE_QUERY_HINT_MAX = 300;
export const PROCEDURE_TAG_MAX = 64;
export const PROCEDURE_TOOL_INPUTS_MAX = 10;
export const PROCEDURE_TEMPLATES_MAX = 30;
export const PROCEDURE_TEMPLATE_TEXT_MAX = 2000;
export const PROCEDURE_HANDOFF_CONDITIONS_MAX = 10;
export const PROCEDURE_CARD_FIELDS_MAX = 20;
export const PROCEDURE_NEXT_STEP_HINT_MAX = 500;
/** How deep `all` / `any` / `not` may nest. */
export const COND_DEPTH_MAX = 5;
/** The conditions one `all` / `any` may list. */
export const COND_LIST_MAX = 10;
export const COND_IN_VALUES_MAX = 50;
export const COND_AI_QUESTION_MAX = 300;
export const COND_PATTERN_MAX = 200;
/** The workspace's default "resolved" criteria as JSON, at most — the column's CHECK too. */
export const RESOLUTION_CRITERIA_MAX_BYTES = 16384;

// ---------------------------------------------------------------------------
// References: `{variable}` in a template, a card field.
// ---------------------------------------------------------------------------

/** What a template variable or a card field names. */
export type ProcedureReference =
  | { kind: 'slot'; name: string }
  | { kind: 'fact'; path: string }
  | { kind: 'fn'; name: string; args: string[] };

const SLOT_REFERENCE = /^[a-z][a-z0-9_]*$/;
const FACT_REFERENCE = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const FN_REFERENCE = /^([a-z][a-z0-9_]*)\(([^()]*)\)$/;

/**
 * A variable as the grammar reads it — `yontem`, `method.expected_minutes`,
 * `elapsed_minutes(islem_zamani)` — or null when it is none of the three
 * (`yöntem`, `a b`). Whether the name exists is the validator's question.
 */
export function parseProcedureReference(text: string): ProcedureReference | null {
  const reference = text.trim();
  if (SLOT_REFERENCE.test(reference)) return { kind: 'slot', name: reference };
  if (FACT_REFERENCE.test(reference)) return { kind: 'fact', path: reference };
  const call = FN_REFERENCE.exec(reference);
  if (call === null) return null;
  const inner = (call[2] as string).trim();
  return {
    kind: 'fn',
    name: call[1] as string,
    args: inner === '' ? [] : inner.split(',').map((arg) => arg.trim()),
  };
}

/** The variables in a template text, in order, as written between the braces. */
export function templateReferences(text: string): string[] {
  return [...text.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1] as string);
}

/**
 * The key the `ai` question of the "resolved" criteria is answered under — a
 * dot, so no step id (lower snake_case) can be the same word.
 */
export const RESOLUTION_AI_KEY = 'resolution.criteria';

/**
 * Every `ai` condition with the key its answer comes back under: the step's
 * id, `slot.<name>` for a slot's `required.when`, `handoff.<n>` for the n-th
 * (0-based) hand-over condition, {@link RESOLUTION_AI_KEY} for the "resolved"
 * criteria. The understanding call (AI-05) asks these.
 */
export function procedureAiQuestions(
  procedure: Procedure,
): Array<{ key: string; question: string }> {
  const out: Array<{ key: string; question: string }> = [];
  const take = (cond: Cond | undefined, key: string) => {
    const question = cond === undefined ? undefined : firstAiQuestion(cond);
    if (question !== undefined) out.push({ key, question });
  };
  for (const step of procedure.steps) take(step.when, step.id);
  for (const slot of procedure.slots) {
    if (typeof slot.required === 'object') take(slot.required.when, `slot.${slot.name}`);
  }
  procedure.handoff.conditions.forEach((cond, n) => take(cond, `handoff.${n}`));
  take(procedure.resolution_criteria, RESOLUTION_AI_KEY);
  return out;
}

function firstAiQuestion(cond: Cond): string | undefined {
  if ('ai' in cond) return cond.ai.question;
  if ('all' in cond || 'any' in cond) {
    for (const inner of 'all' in cond ? cond.all : cond.any) {
      const question = firstAiQuestion(inner);
      if (question !== undefined) return question;
    }
    return undefined;
  }
  if ('not' in cond) return firstAiQuestion(cond.not);
  return undefined;
}

// ---------------------------------------------------------------------------
// Problems.
// ---------------------------------------------------------------------------

/** The part of a procedure a problem is in — the editor's sections. */
export const PROCEDURE_SECTIONS = [
  'procedure',
  'slots',
  'steps',
  'templates',
  'handoff',
  'limits',
] as const;
export type ProcedureSection = (typeof PROCEDURE_SECTIONS)[number];

/**
 * Why a procedure was refused, as a stable code the editor words in its own
 * language. A slot's problems keep their `slots.ts` codes; a step, a condition,
 * a tool input or a card field naming an undefined slot is
 * `slot_unknown_reference`.
 *
 *   - `procedure_unknown_goto`          — a branch goes to a step id that is not there.
 *   - `procedure_loop_without_collect`  — a branch jumps back and nothing on the
 *                                         way waits for the player: the turn
 *                                         would spin.
 *   - `procedure_collect_too_many_slots` — more than two slots in one `collect`.
 *   - `procedure_unknown_variable`      — a `{variable}` that is not a slot,
 *                                         a fact or a function.
 *   - `procedure_unknown_target`        — a team (or topic) the license does not have.
 *   - `procedure_tool_must_be_inactive` — a tool step marked active; F1 has none.
 *   - `procedure_locked_change`         — a locked procedure's structure changed;
 *                                         only its texts and its team may.
 *   - `procedure_fallback_taken`        — the skill is marked the fallback and
 *                                         another of the agent's skills already
 *                                         is (AI-05 §5: at most one); the
 *                                         server's check, {@link fallbackTakenProblem}.
 */
export const PROCEDURE_PROBLEM_CODES = [
  'procedure_not_object',
  'procedure_unknown_field',
  'procedure_needs_when_to_use',
  'procedure_bad_examples',
  'procedure_bad_priority',
  'procedure_bad_limits',
  'procedure_needs_steps',
  'procedure_too_many_steps',
  'procedure_step_not_object',
  'procedure_step_bad_id',
  'procedure_step_duplicate_id',
  'procedure_step_unknown_type',
  'procedure_step_bad_option',
  'procedure_say_needs_content',
  'procedure_collect_needs_slots',
  'procedure_collect_too_many_slots',
  'procedure_check_incomplete',
  'procedure_unknown_goto',
  'procedure_loop_without_collect',
  'procedure_tool_must_be_inactive',
  'procedure_bad_condition',
  'procedure_condition_too_deep',
  'procedure_bad_comparison',
  'procedure_unknown_fact',
  'procedure_fact_without_source',
  'procedure_unknown_function',
  'procedure_bad_function_args',
  'procedure_ai_condition_repeated',
  'procedure_bad_template',
  'procedure_duplicate_template',
  'procedure_unknown_template',
  'procedure_unknown_variable',
  'procedure_bad_handoff',
  'procedure_bad_target',
  'procedure_unknown_target',
  'procedure_locked_change',
  'procedure_fallback_taken',
] as const;
export type ProcedureProblemCode = (typeof PROCEDURE_PROBLEM_CODES)[number];

/** What a save allows but the editor flags: a step no path reaches. */
export const PROCEDURE_WARNING_CODES = ['procedure_unreachable_step'] as const;
export type ProcedureWarningCode = (typeof PROCEDURE_WARNING_CODES)[number];

export interface ProcedureProblem {
  code: ProcedureProblemCode | SlotProblemCode;
  section: ProcedureSection;
  /** 0-based position in the section's list (slot, step, template, hand-over condition). */
  index?: number;
  step_id?: string;
  /** The slot's name — the slot at fault, or the one a reference names. */
  slot?: string;
  template_key?: string;
  /** The field at fault: `then`, `when`, `required`, `target`, … */
  field?: string;
  /** Where inside a condition: `when.all[1].slot`. */
  path?: string;
  /** For `slot_sensitive_forbidden`: what the text reads as asking for. */
  category?: SensitiveSlotCategory;
  /** What was named and not found or not allowed: a goto target, a variable, a team. */
  reference?: string;
  /** The English sentence, for API callers. */
  message: string;
}

export interface ProcedureWarning {
  code: ProcedureWarningCode;
  section: 'steps';
  index: number;
  step_id?: string;
  message: string;
}

/** What a client needs to word a problem itself — goes in `error.details`. */
export interface ProcedureProblemDetails {
  reason: ProcedureProblemCode | SlotProblemCode | ProcedureWarningCode;
  section: ProcedureSection;
  /** 1-based position in the section's list. */
  position?: number;
  step_id?: string;
  slot?: string;
  template_key?: string;
  field?: string;
  path?: string;
  category?: SensitiveSlotCategory;
  reference?: string;
}

export function procedureProblemDetails(
  problem: ProcedureProblem | ProcedureWarning,
): ProcedureProblemDetails {
  const { code, section, index, message: _message, ...rest } = problem;
  return {
    reason: code,
    section,
    ...(index !== undefined ? { position: index + 1 } : {}),
    ...rest,
  };
}

export interface ProcedureValidationContext {
  /** The license's team ids. A hand-over to another is refused; omitted, not checked. */
  groupIds?: ReadonlySet<number>;
  /** The routing topics (ADR-08a). A hand-over to another is refused; omitted, any well-formed key. */
  topics?: ReadonlySet<string>;
  /**
   * The stored definition of a locked procedure (`self_exclusion`,
   * `responsible_gambling_signal`), as `validateProcedure` returned it: only
   * texts and the team may differ from it (ADR `ai-template-catalog.md` §4).
   */
  locked?: Procedure;
  /** Placeholders a template leaves for the tenant (AI-15 `tenant_must_fill`): allowed as variables. */
  placeholders?: ReadonlySet<string>;
}

export type ProcedureValidation =
  | { ok: true; procedure: Procedure; warnings: ProcedureWarning[] }
  | { ok: false; problems: ProcedureProblem[]; warnings: ProcedureWarning[] };

// ---------------------------------------------------------------------------
// Save-time validation.
// ---------------------------------------------------------------------------

const PROCEDURE_FIELDS: ReadonlySet<string> = new Set([
  'when_to_use',
  'examples',
  'priority',
  'slots',
  'steps',
  'templates',
  'handoff',
  'limits',
  'resolution_criteria',
]);

const STEP_FIELDS: Readonly<Record<ProcStepType, readonly string[]>> = {
  say: ['template_key'],
  collect: ['slots'],
  check: ['then', 'else'],
  answer_from_knowledge: ['query_hint'],
  handoff: ['reason_code', 'target'],
  resolve: ['outcome', 'followup_template'],
  tag: ['tag'],
  tool: ['tool_key', 'inputs', 'active'],
};

const COND_KEYS: ReadonlySet<string> = new Set(['all', 'any', 'not', 'slot', 'fact', 'fn', 'ai']);

/** One finding before it is placed in a section. */
interface Issue {
  code: ProcedureProblemCode | SlotProblemCode;
  message: string;
  path?: string;
  reference?: string;
}

/** What the rest of the procedure may name: the slots as written, the fact entities they make known. */
interface Scope {
  slots: ReadonlyMap<string, { type?: SlotType; enumValues?: string[] }>;
  entities: ReadonlySet<ProcedureFactEntity>;
  placeholders: ReadonlySet<string>;
  templateKeys: ReadonlySet<string>;
  stepIndex: ReadonlyMap<string, number>;
}

/** Where control may go from a step, for the loop and reachability checks. */
interface StepFlow {
  /** Indices control may move to; the step count means the end. */
  next: number[];
  /** A `collect` without `when` — it stops the turn while anything it asks is missing. */
  waits: boolean;
  /** The step's `goto`s that jump to itself or an earlier step. */
  backward: Array<{ field: 'then' | 'else'; target: number }>;
}

// ---------------------------------------------------------------------------
// The skill row (#296.2).
// ---------------------------------------------------------------------------

/**
 * A skill's mode (ADR-14a §1): `single` — the one-message step list, every
 * skill's before procedures and the default; `procedure` — this module's.
 */
export const SKILL_MODES = ['single', 'procedure'] as const;
export type SkillMode = (typeof SKILL_MODES)[number];
export const DEFAULT_SKILL_MODE: SkillMode = 'single';

/**
 * What a skill keeps in its `procedure` field. `when_to_use`, `examples`,
 * `priority` and `slots` are the skill's own fields — the first three select
 * a skill in either mode.
 */
export const SKILL_PROCEDURE_FIELDS = [
  'steps',
  'templates',
  'handoff',
  'limits',
  'resolution_criteria',
] as const;
export type SkillProcedureBody = Pick<Procedure, (typeof SKILL_PROCEDURE_FIELDS)[number]>;

/** A procedure skill's fields, as a request writes them or a row stores them. */
export interface SkillProcedureFields {
  when_to_use?: unknown;
  examples?: unknown;
  priority?: unknown;
  slots?: unknown;
  procedure?: unknown;
}

/**
 * Judge a procedure skill's fields as one definition: `procedure` holds only
 * its four fields, and together with the skill's own they make a `Procedure`
 * `validateProcedure` accepts. A null or omitted field takes its default
 * (`when_to_use` has none). What the API checks before storing a procedure
 * skill and the editor before saving one.
 */
export function validateSkillProcedure(
  fields: SkillProcedureFields,
  context: ProcedureValidationContext = {},
): ProcedureValidation {
  const body = fields.procedure;
  if (!isPlainObject(body)) {
    return {
      ok: false,
      problems: [
        {
          code: 'procedure_not_object',
          section: 'procedure',
          field: 'procedure',
          message: 'a procedure skill needs a procedure object',
        },
      ],
      warnings: [],
    };
  }
  const misplaced = Object.keys(body).filter(
    (key) => !(SKILL_PROCEDURE_FIELDS as readonly string[]).includes(key),
  );
  if (misplaced.length > 0) {
    return {
      ok: false,
      problems: misplaced.map((key) => ({
        code: 'procedure_unknown_field' as const,
        section: 'procedure' as const,
        field: key,
        message: PROCEDURE_FIELDS.has(key)
          ? `${key} is the skill's own field, not the procedure's`
          : `unknown field ${key}`,
      })),
      warnings: [],
    };
  }
  const joined: Record<string, unknown> = { ...body };
  for (const key of ['when_to_use', 'examples', 'priority', 'slots'] as const) {
    const value = fields[key];
    if (value !== undefined && value !== null) joined[key] = value;
  }
  return validateProcedure(joined, context);
}

/** A validated procedure as a skill stores it: its own four fields, and the rest. */
export function splitSkillProcedure(procedure: Procedure): {
  when_to_use: string;
  examples: string[];
  priority: number;
  slots: SlotDef<Cond>[];
  procedure: SkillProcedureBody;
} {
  const { when_to_use, examples, priority, slots, steps, templates, handoff, limits } = procedure;
  const criteria = procedure.resolution_criteria;
  return {
    when_to_use,
    examples,
    priority,
    slots,
    procedure: {
      steps,
      templates,
      handoff,
      limits,
      ...(criteria !== undefined ? { resolution_criteria: criteria } : {}),
    },
  };
}

/**
 * What selects a skill (AI-05) — `when_to_use`, `examples`, `priority` —
 * judged by the procedure's rules, with its codes. A `single` skill has the
 * same three fields; for it `when_to_use` may be absent (null or omitted).
 * `validateProcedure` runs this with `when_to_use` required.
 */
export function validateSkillSelection(value: {
  when_to_use?: unknown;
  examples?: unknown;
  priority?: unknown;
}): ProcedureProblem[] {
  return selectionProblems(value, false);
}

function selectionProblems(
  value: Readonly<Record<string, unknown>>,
  requireWhenToUse: boolean,
): ProcedureProblem[] {
  const problems: ProcedureProblem[] = [];
  const whenToUse = value['when_to_use'];
  if (
    (requireWhenToUse || (whenToUse !== undefined && whenToUse !== null)) &&
    (!nonEmptyString(whenToUse) || whenToUse.length > PROCEDURE_WHEN_TO_USE_MAX)
  ) {
    problems.push({
      code: 'procedure_needs_when_to_use',
      section: 'procedure',
      field: 'when_to_use',
      message: `needs a when_to_use of at most ${PROCEDURE_WHEN_TO_USE_MAX} characters`,
    });
  }

  const examples = value['examples'] ?? PROCEDURE_DEFAULTS.examples;
  if (
    !Array.isArray(examples) ||
    examples.length > PROCEDURE_EXAMPLES_MAX ||
    !examples.every((e) => nonEmptyString(e) && e.length <= PROCEDURE_EXAMPLE_MAX)
  ) {
    problems.push({
      code: 'procedure_bad_examples',
      section: 'procedure',
      field: 'examples',
      message: `examples must be at most ${PROCEDURE_EXAMPLES_MAX} sentences of at most ${PROCEDURE_EXAMPLE_MAX} characters`,
    });
  }

  const priority = value['priority'] ?? PROCEDURE_DEFAULTS.priority;
  if (!isIntegerIn(priority, PROCEDURE_PRIORITY_MIN, PROCEDURE_PRIORITY_MAX)) {
    problems.push({
      code: 'procedure_bad_priority',
      section: 'procedure',
      field: 'priority',
      message: `priority must be a whole number from ${PROCEDURE_PRIORITY_MIN} to ${PROCEDURE_PRIORITY_MAX}`,
    });
  }

  return problems;
}

/**
 * Every problem in a procedure, and the definition with its defaults filled in
 * when there are none. Unknown fields are refused rather than dropped, as in
 * `validateSlotDefs`. Warnings come back either way.
 */
export function validateProcedure(
  value: unknown,
  context: ProcedureValidationContext = {},
): ProcedureValidation {
  if (!isPlainObject(value)) {
    return {
      ok: false,
      problems: [
        {
          code: 'procedure_not_object',
          section: 'procedure',
          message: 'procedure must be an object',
        },
      ],
      warnings: [],
    };
  }
  const problems: ProcedureProblem[] = [];

  for (const key of Object.keys(value)) {
    if (!PROCEDURE_FIELDS.has(key)) {
      problems.push({
        code: 'procedure_unknown_field',
        section: 'procedure',
        field: key,
        message: `unknown field ${key}`,
      });
    }
  }

  problems.push(...selectionProblems(value, true));

  const rawSlots = value['slots'] ?? PROCEDURE_DEFAULTS.slots;
  const slotResult = validateSlotDefs(rawSlots);
  if (!slotResult.ok) {
    for (const problem of slotResult.problems) {
      problems.push({
        code: problem.code,
        section: 'slots',
        ...(problem.index >= 0 ? { index: problem.index } : {}),
        ...(problem.name !== undefined ? { slot: problem.name } : {}),
        ...(problem.field !== undefined ? { field: problem.field } : {}),
        ...(problem.category !== undefined ? { category: problem.category } : {}),
        message: problem.message,
      });
    }
  }

  const rawSteps = value['steps'];
  const scope: Scope = {
    slots: slotScope(rawSlots),
    entities: entityScope(rawSlots),
    placeholders: context.placeholders ?? new Set(),
    templateKeys: templateKeyScope(value['templates']),
    stepIndex: stepIndexScope(rawSteps),
  };

  // A slot's `required.when` is a condition of this language (`SlotDef<Cond>`).
  if (Array.isArray(rawSlots)) {
    for (const [index, raw] of rawSlots.entries()) {
      if (!isPlainObject(raw) || !isPlainObject(raw['required'])) continue;
      const when = raw['required']['when'];
      if (when === undefined) continue;
      const name = typeof raw['name'] === 'string' ? raw['name'] : undefined;
      for (const issue of condIssues(when, scope, 'required.when', 1, { count: 0 })) {
        problems.push({
          ...placeIssue(issue),
          section: 'slots',
          index,
          ...(name !== undefined ? { slot: name } : {}),
          field: 'required',
          message: `slot ${name ?? `#${index + 1}`}: ${issue.message}`,
        });
      }
    }
  }

  const templates = templatesSection(value['templates'], scope, problems);
  const { steps, flows } = stepsSection(rawSteps, scope, context, problems);
  const handoff = handoffSection(value['handoff'], scope, context, problems);
  const limits = limitsSection(value['limits'], problems);
  const resolution = resolutionSection(value['resolution_criteria'], scope, problems);

  for (const [index, flow] of flows.entries()) {
    for (const { field, target } of flow.backward) {
      if (!reachesWithoutWaiting(flows, target, index)) continue;
      const id = stepIdAt(rawSteps, index);
      const targetId = stepIdAt(rawSteps, target) ?? `#${target + 1}`;
      problems.push({
        code: 'procedure_loop_without_collect',
        section: 'steps',
        index,
        ...(id !== undefined ? { step_id: id } : {}),
        field,
        reference: targetId,
        message: `step ${id ?? `#${index + 1}`}: ${field} jumps back to ${targetId} and no collect on the way waits for the player`,
      });
    }
  }

  const warnings = unreachableWarnings(rawSteps, flows);

  if (problems.length > 0 || !slotResult.ok) return { ok: false, problems, warnings };

  const procedure: Procedure = {
    when_to_use: (value['when_to_use'] as string).trim(),
    examples: ((value['examples'] ?? PROCEDURE_DEFAULTS.examples) as string[]).map((e) => e.trim()),
    priority: (value['priority'] ?? PROCEDURE_DEFAULTS.priority) as number,
    slots: slotResult.slots as SlotDef<Cond>[],
    steps,
    templates,
    handoff,
    limits,
    // Absent unless written, so the hash of a procedure without one is unchanged.
    ...(resolution !== undefined ? { resolution_criteria: resolution } : {}),
  };

  if (context.locked !== undefined) {
    const changes = lockedChanges(context.locked, procedure);
    if (changes.length > 0) return { ok: false, problems: changes, warnings };
  }
  return { ok: true, procedure, warnings };
}

// --- scope ------------------------------------------------------------------

function slotScope(raw: unknown): Map<string, { type?: SlotType; enumValues?: string[] }> {
  const slots = new Map<string, { type?: SlotType; enumValues?: string[] }>();
  if (!Array.isArray(raw)) return slots;
  for (const slot of raw) {
    if (!isPlainObject(slot) || typeof slot['name'] !== 'string' || slots.has(slot['name'])) {
      continue;
    }
    const type = isOneOf(SLOT_TYPES, slot['type']) ? slot['type'] : undefined;
    const validate = slot['validate'];
    const enumValues =
      isPlainObject(validate) && Array.isArray(validate['enum_values'])
        ? validate['enum_values'].filter((v): v is string => typeof v === 'string')
        : undefined;
    slots.set(slot['name'], {
      ...(type !== undefined ? { type } : {}),
      ...(enumValues !== undefined ? { enumValues } : {}),
    });
  }
  return slots;
}

function entityScope(raw: unknown): Set<ProcedureFactEntity> {
  const entities = new Set<ProcedureFactEntity>();
  if (!Array.isArray(raw)) return entities;
  for (const slot of raw) {
    if (!isPlainObject(slot) || slot['type'] !== 'enum' || !isPlainObject(slot['validate'])) {
      continue;
    }
    const source = slot['validate']['enum_source'];
    for (const [entity, sources] of Object.entries(PROCEDURE_FACT_ENTITIES)) {
      if ((sources as readonly unknown[]).includes(source)) {
        entities.add(entity as ProcedureFactEntity);
      }
    }
  }
  return entities;
}

function templateKeyScope(raw: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(raw)) return keys;
  for (const template of raw) {
    if (isPlainObject(template) && typeof template['key'] === 'string') keys.add(template['key']);
  }
  return keys;
}

function stepIndexScope(raw: unknown): Map<string, number> {
  const index = new Map<string, number>();
  if (!Array.isArray(raw)) return index;
  for (const [i, step] of raw.entries()) {
    const id = isPlainObject(step) ? step['id'] : undefined;
    if (typeof id === 'string' && PROCEDURE_KEY_PATTERN.test(id) && !index.has(id))
      index.set(id, i);
  }
  return index;
}

function stepIdAt(raw: unknown, index: number): string | undefined {
  const step = Array.isArray(raw) ? raw[index] : undefined;
  const id = isPlainObject(step) ? step['id'] : undefined;
  return typeof id === 'string' && PROCEDURE_KEY_PATTERN.test(id) ? id : undefined;
}

function placeIssue(issue: Issue): Pick<ProcedureProblem, 'code' | 'path' | 'reference'> {
  return {
    code: issue.code,
    ...(issue.path !== undefined ? { path: issue.path } : {}),
    ...(issue.reference !== undefined ? { reference: issue.reference } : {}),
  };
}

// --- templates --------------------------------------------------------------

function templatesSection(
  value: unknown,
  scope: Scope,
  problems: ProcedureProblem[],
): ProcTemplate[] {
  const raw = value ?? PROCEDURE_DEFAULTS.templates;
  if (!Array.isArray(raw) || raw.length > PROCEDURE_TEMPLATES_MAX) {
    problems.push({
      code: 'procedure_bad_template',
      section: 'templates',
      message: `templates must be a list of at most ${PROCEDURE_TEMPLATES_MAX}`,
    });
    return [];
  }

  const templates: ProcTemplate[] = [];
  const seen = new Set<string>();
  for (const [index, template] of raw.entries()) {
    const key =
      isPlainObject(template) &&
      typeof template['key'] === 'string' &&
      PROCEDURE_KEY_PATTERN.test(template['key'])
        ? template['key']
        : undefined;
    const at = key ?? `#${index + 1}`;
    const push = (code: ProcedureProblemCode, message: string, extra: Partial<ProcedureProblem>) =>
      problems.push({
        code,
        section: 'templates',
        index,
        ...(key !== undefined ? { template_key: key } : {}),
        ...extra,
        message: `template ${at}: ${message}`,
      });

    if (!isPlainObject(template)) {
      push('procedure_bad_template', 'a template must be an object', {});
      continue;
    }
    for (const field of Object.keys(template)) {
      if (!['key', 'text', 'verbatim'].includes(field)) {
        push('procedure_unknown_field', `unknown field ${field}`, { field });
      }
    }
    if (key === undefined) {
      push('procedure_bad_template', 'key must be lower snake_case, at most 40 characters', {
        field: 'key',
      });
    } else if (seen.has(key)) {
      push('procedure_duplicate_template', `key ${key} is used twice`, { field: 'key' });
    }
    if (key !== undefined) seen.add(key);

    const text = template['text'];
    const verbatim = template['verbatim'];
    if (!nonEmptyString(text) || text.length > PROCEDURE_TEMPLATE_TEXT_MAX) {
      push(
        'procedure_bad_template',
        `needs a text of at most ${PROCEDURE_TEMPLATE_TEXT_MAX} characters`,
        { field: 'text' },
      );
    } else {
      for (const issue of textIssues(text, scope)) {
        push(issue.code as ProcedureProblemCode, issue.message, {
          field: 'text',
          ...placeIssue(issue),
        });
      }
    }
    if (verbatim !== undefined && typeof verbatim !== 'boolean') {
      push('procedure_bad_template', 'verbatim must be true or false', { field: 'verbatim' });
    }
    if (key !== undefined && nonEmptyString(text)) {
      templates.push({
        key,
        text: text.trim(),
        ...(typeof verbatim === 'boolean' ? { verbatim } : {}),
      });
    }
  }
  return templates;
}

/** The problems with the `{variables}` in a text. */
function textIssues(text: string, scope: Scope): Issue[] {
  return templateReferences(text).flatMap((reference) =>
    scope.placeholders.has(reference) ? [] : referenceIssues(reference, scope, 'template'),
  );
}

/**
 * What is wrong with one reference. In a template anything that names nothing
 * is an undefined variable; elsewhere the code says what kind of name it was.
 */
function referenceIssues(raw: string, scope: Scope, use: 'template' | 'field'): Issue[] {
  const reference = parseProcedureReference(raw);
  const unknown = (code: ProcedureProblemCode | SlotProblemCode, what: string): Issue[] => [
    use === 'template'
      ? {
          code: 'procedure_unknown_variable',
          reference: raw,
          message: `{${raw}} is not a slot, a fact or a function`,
        }
      : { code, reference: raw, message: `${raw} is not ${what}` },
  ];
  if (reference === null) {
    return [
      {
        code: 'procedure_unknown_variable',
        reference: raw,
        message: `${raw} is not a slot, a fact or a function`,
      },
    ];
  }
  switch (reference.kind) {
    case 'slot':
      return scope.slots.has(reference.name)
        ? []
        : unknown('slot_unknown_reference', 'a slot of this procedure');
    case 'fact':
      return isFactPath(reference.path)
        ? factSourceIssues(reference.path, scope)
        : unknown('procedure_unknown_fact', 'a known fact');
    case 'fn':
      return isOneOf(COND_FNS, reference.name)
        ? fnArgIssues(reference.name, reference.args, scope, undefined)
        : unknown('procedure_unknown_function', 'a known function');
  }
}

function factSourceIssues(path: ProcedureFactPath, scope: Scope, at?: string): Issue[] {
  return entitySourceIssues(path.split('.')[0] as ProcedureFactEntity, path, scope, at);
}

/** A fact entity is known only through a slot of its table (`PROCEDURE_FACT_ENTITIES`). */
function entitySourceIssues(
  entity: ProcedureFactEntity,
  reference: string,
  scope: Scope,
  at?: string,
): Issue[] {
  if (scope.entities.has(entity)) return [];
  return [
    {
      code: 'procedure_fact_without_source',
      reference,
      ...(at !== undefined ? { path: at } : {}),
      message: `${reference} needs a slot whose enum_source is ${PROCEDURE_FACT_ENTITIES[entity].join(' or ')}`,
    },
  ];
}

function fnArgIssues(
  name: CondFnName,
  args: unknown,
  scope: Scope,
  at: string | undefined,
): Issue[] {
  const { params } = COND_FN_SIGNATURES[name];
  const where = at !== undefined ? { path: at } : {};
  if (
    !Array.isArray(args) ||
    args.length !== params.length ||
    !args.every((arg) => typeof arg === 'string')
  ) {
    return [
      {
        code: 'procedure_bad_function_args',
        reference: name,
        ...where,
        message: `${name} takes (${params.join(', ')})`,
      },
    ];
  }
  const issues: Issue[] = [];
  for (const [i, param] of params.entries()) {
    const arg = args[i] as string;
    if (param === 'method') {
      if (arg !== 'method') {
        issues.push({
          code: 'procedure_bad_function_args',
          reference: name,
          ...where,
          message: `${name}: argument ${i + 1} must be the word method`,
        });
      } else {
        issues.push(...entitySourceIssues('method', 'method', scope, at));
      }
      continue;
    }
    const slot = scope.slots.get(arg);
    if (slot === undefined) {
      issues.push({
        code: 'slot_unknown_reference',
        reference: arg,
        ...where,
        message: `${name}: ${arg} is not a slot of this procedure`,
      });
    } else if (slot.type !== undefined && slot.type !== 'datetime') {
      issues.push({
        code: 'procedure_bad_function_args',
        reference: name,
        ...where,
        message: `${name}: ${arg} is a ${slot.type} slot, not a datetime one`,
      });
    }
  }
  return issues;
}

// --- conditions -------------------------------------------------------------

/**
 * The problems in one condition tree. `ai` counts the tree owner's `ai`
 * questions: the second one is refused, its answer would share the key.
 */
function condIssues(
  value: unknown,
  scope: Scope,
  path: string,
  depth: number,
  ai: { count: number },
): Issue[] {
  const bad = (message: string): Issue[] => [{ code: 'procedure_bad_condition', path, message }];
  if (depth > COND_DEPTH_MAX) {
    return [
      {
        code: 'procedure_condition_too_deep',
        path,
        message: `conditions nest at most ${COND_DEPTH_MAX} deep`,
      },
    ];
  }
  if (!isPlainObject(value)) return bad('a condition must be an object');
  const keys = Object.keys(value);
  const key = keys[0];
  if (keys.length !== 1 || key === undefined || !COND_KEYS.has(key)) {
    return bad('a condition has exactly one of all, any, not, slot, fact, fn, ai');
  }
  const body = value[key];

  switch (key) {
    case 'all':
    case 'any': {
      if (!Array.isArray(body) || body.length === 0 || body.length > COND_LIST_MAX) {
        return bad(`${key} lists 1 to ${COND_LIST_MAX} conditions`);
      }
      return body.flatMap((inner, i) =>
        condIssues(inner, scope, `${path}.${key}[${i}]`, depth + 1, ai),
      );
    }
    case 'not':
      return condIssues(body, scope, `${path}.not`, depth + 1, ai);
    case 'ai': {
      const at = `${path}.ai`;
      if (!isPlainObject(body) || !onlyKeys(body, ['question'])) {
        return [{ code: 'procedure_bad_condition', path: at, message: 'ai takes { question }' }];
      }
      const question = body['question'];
      if (!nonEmptyString(question) || question.length > COND_AI_QUESTION_MAX) {
        return [
          {
            code: 'procedure_bad_condition',
            path: at,
            message: `ai needs a question of at most ${COND_AI_QUESTION_MAX} characters`,
          },
        ];
      }
      ai.count += 1;
      return ai.count > 1
        ? [
            {
              code: 'procedure_ai_condition_repeated',
              path: at,
              message: 'one ai question per step, slot or hand-over condition',
            },
          ]
        : [];
    }
    case 'slot': {
      const at = `${path}.slot`;
      if (!isPlainObject(body) || !onlyKeys(body, ['name', 'op', 'value'])) {
        return [
          { code: 'procedure_bad_condition', path: at, message: 'slot takes { name, op, value? }' },
        ];
      }
      const name = body['name'];
      if (typeof name !== 'string') {
        return [{ code: 'procedure_bad_condition', path: at, message: 'slot needs a name' }];
      }
      const slot = scope.slots.get(name);
      if (slot === undefined) {
        return [
          {
            code: 'slot_unknown_reference',
            path: at,
            reference: name,
            message: `${name} is not a slot of this procedure`,
          },
        ];
      }
      return comparisonIssues(
        slot.type !== undefined ? slotValueKind(slot.type) : undefined,
        body,
        scope,
        at,
        slot.enumValues,
      );
    }
    case 'fact': {
      const at = `${path}.fact`;
      if (!isPlainObject(body) || !onlyKeys(body, ['path', 'op', 'value'])) {
        return [
          { code: 'procedure_bad_condition', path: at, message: 'fact takes { path, op, value? }' },
        ];
      }
      const factPath = body['path'];
      if (!isFactPath(factPath)) {
        return [
          {
            code: 'procedure_unknown_fact',
            path: at,
            reference: String(factPath),
            message: `${String(factPath)} is not a known fact`,
          },
        ];
      }
      return [
        ...factSourceIssues(factPath, scope, at),
        ...comparisonIssues(PROCEDURE_FACTS[factPath], body, scope, at, undefined),
      ];
    }
    case 'fn': {
      const at = `${path}.fn`;
      if (!isPlainObject(body) || !onlyKeys(body, ['name', 'args', 'op', 'value'])) {
        return [
          {
            code: 'procedure_bad_condition',
            path: at,
            message: 'fn takes { name, args, op?, value? }',
          },
        ];
      }
      const name = body['name'];
      if (!isOneOf(COND_FNS, name)) {
        return [
          {
            code: 'procedure_unknown_function',
            path: at,
            reference: String(name),
            message: `${String(name)} is not one of ${COND_FNS.join(', ')}`,
          },
        ];
      }
      const issues = fnArgIssues(name, body['args'], scope, at);
      const returns = COND_FN_SIGNATURES[name].returns;
      if (body['op'] === undefined) {
        if (body['value'] !== undefined || returns !== 'boolean') {
          issues.push({
            code: 'procedure_bad_comparison',
            path: at,
            message: `${name} returns a ${returns} value; compare it with an operator`,
          });
        }
        return issues;
      }
      return [...issues, ...comparisonIssues(returns, body, scope, at, undefined)];
    }
  }
  return bad('a condition has exactly one of all, any, not, slot, fact, fn, ai');
}

/** The problems with `op` and `value` against what is compared. */
function comparisonIssues(
  kind: CondValueKind | undefined,
  body: Record<string, unknown>,
  scope: Scope,
  at: string,
  enumValues: string[] | undefined,
): Issue[] {
  const op = body['op'];
  const value = body['value'];
  const bad = (message: string): Issue[] => [
    { code: 'procedure_bad_comparison', path: at, message },
  ];
  if (!isOneOf(COND_OPS, op)) return bad(`unknown operator ${String(op)}`);
  if (kind !== undefined && !COND_OPS_BY_KIND[kind].includes(op)) {
    return bad(`${op} does not apply to a ${kind} value`);
  }

  switch (op) {
    case 'exists':
    case 'missing':
      return value === undefined ? [] : bad(`${op} takes no value`);
    case 'lt':
    case 'lte':
    case 'gt':
    case 'gte':
      return operandIssues(value, 'number', scope, at, undefined);
    case 'eq':
    case 'neq':
      return operandIssues(value, kind, scope, at, enumValues);
    case 'in':
    case 'not_in': {
      if (!Array.isArray(value) || value.length === 0 || value.length > COND_IN_VALUES_MAX) {
        return bad(`${op} takes a list of 1 to ${COND_IN_VALUES_MAX} values`);
      }
      return value.flatMap((item) =>
        isPlainObject(item)
          ? bad(`${op} lists literal values`)
          : operandIssues(item, kind, scope, at, enumValues),
      );
    }
    case 'matches': {
      if (typeof value !== 'string' || value.length === 0 || value.length > COND_PATTERN_MAX) {
        return bad(`matches takes a pattern of 1 to ${COND_PATTERN_MAX} characters`);
      }
      const problem = authorPatternProblem(value);
      return problem === null
        ? []
        : bad(
            problem === 'does_not_compile'
              ? 'the pattern does not compile'
              : 'the pattern must not repeat a repeated group',
          );
    }
  }
}

/** One value a comparison is made against: a literal of the right kind, or a slot or fact of it. */
function operandIssues(
  value: unknown,
  kind: CondValueKind | undefined,
  scope: Scope,
  at: string,
  enumValues: string[] | undefined,
): Issue[] {
  const bad = (message: string): Issue[] => [
    { code: 'procedure_bad_comparison', path: at, message },
  ];
  if (value === undefined) return bad('the comparison needs a value');

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    const ref = keys[0];
    const target = ref !== undefined ? value[ref] : undefined;
    if (keys.length !== 1 || (ref !== 'slot' && ref !== 'fact') || typeof target !== 'string') {
      return bad('a value is a literal, { slot } or { fact }');
    }
    let other: CondValueKind | undefined;
    if (ref === 'slot') {
      const slot = scope.slots.get(target);
      if (slot === undefined) {
        return [
          {
            code: 'slot_unknown_reference',
            path: at,
            reference: target,
            message: `${target} is not a slot of this procedure`,
          },
        ];
      }
      other = slot.type !== undefined ? slotValueKind(slot.type) : undefined;
    } else {
      if (!isFactPath(target)) {
        return [
          {
            code: 'procedure_unknown_fact',
            path: at,
            reference: target,
            message: `${target} is not a known fact`,
          },
        ];
      }
      const missing = factSourceIssues(target, scope, at);
      if (missing.length > 0) return missing;
      other = PROCEDURE_FACTS[target];
    }
    return kind !== undefined && other !== undefined && kind !== other
      ? bad(`compares a ${kind} value with a ${other} one`)
      : [];
  }

  const literal = literalKind(value);
  if (literal === undefined) return bad('a value is a string, a number or true/false');
  if (kind !== undefined && literal !== kind)
    return bad(`compares a ${kind} value with a ${literal}`);
  if (
    enumValues !== undefined &&
    typeof value === 'string' &&
    !enumValues.some((option) => sameOption(option, value))
  ) {
    return bad(`${value} is not one of the slot's values`);
  }
  return [];
}

function literalKind(value: unknown): CondValueKind | undefined {
  if (typeof value === 'string') return 'text';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'number' && Number.isFinite(value)) return 'number';
  return undefined;
}

function sameOption(a: string, b: string): boolean {
  return a.trim().toLocaleLowerCase('tr') === b.trim().toLocaleLowerCase('tr');
}

function isFactPath(value: unknown): value is ProcedureFactPath {
  return typeof value === 'string' && Object.hasOwn(PROCEDURE_FACTS, value);
}

// --- steps ------------------------------------------------------------------

function stepsSection(
  raw: unknown,
  scope: Scope,
  context: ProcedureValidationContext,
  problems: ProcedureProblem[],
): { steps: ProcStep[]; flows: StepFlow[] } {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push({
      code: 'procedure_needs_steps',
      section: 'steps',
      message: 'steps must be a non-empty list',
    });
    return { steps: [], flows: [] };
  }
  if (raw.length > PROCEDURE_STEPS_MAX) {
    problems.push({
      code: 'procedure_too_many_steps',
      section: 'steps',
      message: `a procedure has at most ${PROCEDURE_STEPS_MAX} steps`,
    });
    return { steps: [], flows: [] };
  }

  const steps: ProcStep[] = [];
  const flows: StepFlow[] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    const { step, flow } = stepProblems(value, index, scope, context, seen, problems);
    flows.push(flow);
    if (step !== null) steps.push(step);
  }
  return { steps, flows };
}

function stepProblems(
  value: unknown,
  index: number,
  scope: Scope,
  context: ProcedureValidationContext,
  seen: Set<string>,
  problems: ProcedureProblem[],
): { step: ProcStep | null; flow: StepFlow } {
  const flow: StepFlow = { next: [index + 1], waits: false, backward: [] };
  if (!isPlainObject(value)) {
    problems.push({
      code: 'procedure_step_not_object',
      section: 'steps',
      index,
      message: `step #${index + 1}: a step must be an object`,
    });
    return { step: null, flow };
  }

  const before = problems.length;
  const idValue = value['id'];
  const id =
    typeof idValue === 'string' && PROCEDURE_KEY_PATTERN.test(idValue) ? idValue : undefined;
  const at = id ?? `#${index + 1}`;
  const push = (
    code: ProcedureProblemCode | SlotProblemCode,
    field: string | undefined,
    message: string,
    extra: Partial<ProcedureProblem> = {},
  ) =>
    problems.push({
      code,
      section: 'steps',
      index,
      ...(id !== undefined ? { step_id: id } : {}),
      ...(field !== undefined ? { field } : {}),
      ...extra,
      message: `step ${at}: ${message}`,
    });
  const pushIssues = (issues: Issue[], field: string) => {
    for (const issue of issues) {
      push(issue.code, field, issue.message, {
        ...placeIssue(issue),
        ...(issue.code === 'slot_unknown_reference' && issue.reference !== undefined
          ? { slot: issue.reference }
          : {}),
      });
    }
  };

  if (id === undefined) {
    push('procedure_step_bad_id', 'id', 'id must be lower snake_case, at most 40 characters');
  } else if (seen.has(id)) {
    push('procedure_step_duplicate_id', 'id', `id ${id} is used twice`);
  }
  if (id !== undefined) seen.add(id);

  const type = value['type'];
  if (!isOneOf(PROC_STEP_TYPES, type)) {
    push('procedure_step_unknown_type', 'type', `unknown step type ${String(type)}`);
    return { step: null, flow };
  }

  const allowed = new Set(['id', 'type', 'instruction', 'when', ...STEP_FIELDS[type]]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) push('procedure_unknown_field', key, `unknown field ${key}`);
  }

  const instruction = value['instruction'];
  if (
    instruction !== undefined &&
    !(nonEmptyString(instruction) && instruction.length <= PROCEDURE_INSTRUCTION_MAX)
  ) {
    push(
      'procedure_step_bad_option',
      'instruction',
      `instruction must be at most ${PROCEDURE_INSTRUCTION_MAX} characters`,
    );
  }

  const when = value['when'];
  if (type === 'check' && when === undefined) {
    push('procedure_check_incomplete', 'when', 'a check needs a condition (when)');
  } else if (when !== undefined) {
    pushIssues(condIssues(when, scope, 'when', 1, { count: 0 }), 'when');
  }

  const body = actionProblems(type, value, scope, context, (code, field, message, extra) =>
    push(code, field, message, extra),
  );

  if (type === 'collect') flow.waits = when === undefined;
  if (PROC_TERMINAL_STEP_TYPES.includes(type) && when === undefined) flow.next = [];

  let branches: Pick<ProcCheckStep, 'then' | 'else'> | null = null;
  if (type === 'check') {
    flow.next = [];
    const thenValue = value['then'];
    const elseValue = value['else'];
    if (thenValue === undefined) {
      push('procedure_check_incomplete', 'then', 'a check needs a then branch');
      flow.next.push(index + 1);
    }
    const then =
      thenValue === undefined
        ? undefined
        : branchProblems(thenValue, 'then', index, scope, context, flow, push);
    const otherwise =
      elseValue === undefined
        ? undefined
        : branchProblems(elseValue, 'else', index, scope, context, flow, push);
    if (elseValue === undefined) flow.next.push(index + 1);
    if (then !== undefined) {
      branches = { then, ...(otherwise !== undefined ? { else: otherwise } : {}) };
    }
  }

  if (problems.length > before || id === undefined) return { step: null, flow };

  const step = {
    id,
    type,
    ...(nonEmptyString(instruction) ? { instruction: instruction.trim() } : {}),
    ...(when !== undefined ? { when: when as Cond } : {}),
    ...body,
    ...(branches ?? {}),
  } as ProcStep;
  return { step, flow };
}

type PushProblem = (
  code: ProcedureProblemCode | SlotProblemCode,
  field: string | undefined,
  message: string,
  extra?: Partial<ProcedureProblem>,
) => void;

/**
 * The type-specific fields of a step (or of a step inside a branch) and their
 * problems; returns the fields as stored.
 */
function actionProblems(
  type: ProcStepType,
  value: Record<string, unknown>,
  scope: Scope,
  context: ProcedureValidationContext,
  push: PushProblem,
): Record<string, unknown> {
  switch (type) {
    case 'say': {
      const key = value['template_key'];
      if (key !== undefined && typeof key !== 'string') {
        push('procedure_step_bad_option', 'template_key', 'template_key must be a template key');
      } else if (key !== undefined && !scope.templateKeys.has(key)) {
        push('procedure_unknown_template', 'template_key', `no template ${key}`, {
          reference: key,
        });
      }
      if (key === undefined && !nonEmptyString(value['instruction'])) {
        push(
          'procedure_say_needs_content',
          undefined,
          'a say step needs a template_key or an instruction',
        );
      }
      return typeof key === 'string' ? { template_key: key } : {};
    }
    case 'collect': {
      const slots = value['slots'];
      if (!Array.isArray(slots) || slots.length === 0) {
        push('procedure_collect_needs_slots', 'slots', 'a collect step names at least one slot');
        return {};
      }
      if (slots.length > PROCEDURE_COLLECT_SLOTS_MAX) {
        push(
          'procedure_collect_too_many_slots',
          'slots',
          `a collect step asks at most ${PROCEDURE_COLLECT_SLOTS_MAX} slots`,
        );
      }
      if (
        !slots.every((slot) => typeof slot === 'string') ||
        new Set(slots).size !== slots.length
      ) {
        push('procedure_step_bad_option', 'slots', 'slots must be distinct slot names');
        return {};
      }
      for (const slot of slots as string[]) {
        if (!scope.slots.has(slot)) {
          push('slot_unknown_reference', 'slots', `${slot} is not a slot of this procedure`, {
            slot,
            reference: slot,
          });
        }
      }
      return { slots: [...(slots as string[])] };
    }
    case 'answer_from_knowledge': {
      const hint = value['query_hint'];
      if (
        hint !== undefined &&
        !(nonEmptyString(hint) && hint.length <= PROCEDURE_QUERY_HINT_MAX)
      ) {
        push(
          'procedure_step_bad_option',
          'query_hint',
          `query_hint must be at most ${PROCEDURE_QUERY_HINT_MAX} characters`,
        );
      }
      return nonEmptyString(hint) ? { query_hint: hint.trim() } : {};
    }
    case 'handoff': {
      const reason = value['reason_code'];
      if (typeof reason !== 'string' || !PROCEDURE_KEY_PATTERN.test(reason)) {
        push(
          'procedure_step_bad_option',
          'reason_code',
          'reason_code must be lower snake_case, at most 40 characters',
        );
      }
      const target = value['target'];
      if (target !== undefined) {
        for (const issue of targetIssues(target, context)) {
          push(issue.code, 'target', issue.message, placeIssue(issue));
        }
      }
      return { reason_code: reason, ...(target !== undefined ? { target } : {}) };
    }
    case 'resolve': {
      const outcome = value['outcome'];
      if (!isOneOf(PROC_OUTCOMES, outcome)) {
        push(
          'procedure_step_bad_option',
          'outcome',
          'outcome must be resolved or resolved_waiting',
        );
      }
      const followup = value['followup_template'];
      if (followup !== undefined && typeof followup !== 'string') {
        push(
          'procedure_step_bad_option',
          'followup_template',
          'followup_template must be a template key',
        );
      } else if (followup !== undefined && !scope.templateKeys.has(followup)) {
        push('procedure_unknown_template', 'followup_template', `no template ${followup}`, {
          reference: followup,
        });
      }
      return { outcome, ...(followup !== undefined ? { followup_template: followup } : {}) };
    }
    case 'tag': {
      const tag = value['tag'];
      if (!nonEmptyString(tag) || tag.length > PROCEDURE_TAG_MAX) {
        push(
          'procedure_step_bad_option',
          'tag',
          `tag must be at most ${PROCEDURE_TAG_MAX} characters`,
        );
        return {};
      }
      return { tag: tag.trim() };
    }
    case 'tool': {
      const key = value['tool_key'];
      if (typeof key !== 'string' || !PROCEDURE_KEY_PATTERN.test(key)) {
        push(
          'procedure_step_bad_option',
          'tool_key',
          'tool_key must be lower snake_case, at most 40 characters',
        );
      }
      const inputs = value['inputs'] ?? {};
      if (
        !isPlainObject(inputs) ||
        Object.keys(inputs).length > PROCEDURE_TOOL_INPUTS_MAX ||
        !Object.entries(inputs).every(
          ([name, slot]) => PROCEDURE_KEY_PATTERN.test(name) && typeof slot === 'string',
        )
      ) {
        push(
          'procedure_step_bad_option',
          'inputs',
          `inputs maps at most ${PROCEDURE_TOOL_INPUTS_MAX} input names to slot names`,
        );
      } else {
        for (const slot of Object.values(inputs) as string[]) {
          if (!scope.slots.has(slot)) {
            push('slot_unknown_reference', 'inputs', `${slot} is not a slot of this procedure`, {
              slot,
              reference: slot,
            });
          }
        }
      }
      if (value['active'] !== false) {
        push(
          'procedure_tool_must_be_inactive',
          'active',
          'a tool step is passive in F1 (active: false)',
        );
      }
      return { tool_key: key, inputs: isPlainObject(inputs) ? { ...inputs } : {}, active: false };
    }
    case 'check':
      return {};
  }
}

/**
 * A `check` branch: a `goto` (its target recorded on the flow) or a step
 * written in place. An ending step ends there; any other goes on after the check.
 */
function branchProblems(
  value: unknown,
  field: 'then' | 'else',
  index: number,
  scope: Scope,
  context: ProcedureValidationContext,
  flow: StepFlow,
  push: PushProblem,
): ProcBranch | undefined {
  if (!isPlainObject(value)) {
    push('procedure_step_bad_option', field, `${field} must be { goto } or a step`);
    flow.next.push(index + 1);
    return undefined;
  }

  if ('goto' in value) {
    const target = value['goto'];
    if (Object.keys(value).length !== 1 || typeof target !== 'string') {
      push('procedure_step_bad_option', field, `${field} must be { goto: <step id> } or a step`);
      return undefined;
    }
    const to = scope.stepIndex.get(target);
    if (to === undefined) {
      push('procedure_unknown_goto', field, `${field} goes to ${target}, which is not a step`, {
        reference: target,
      });
      return undefined;
    }
    flow.next.push(to);
    if (to <= index) flow.backward.push({ field, target: to });
    return { goto: target };
  }

  const type = value['type'];
  if (!isOneOf(PROC_BRANCH_STEP_TYPES, type)) {
    push(
      'procedure_step_bad_option',
      field,
      `${field} carries a ${PROC_BRANCH_STEP_TYPES.join(', ')} step or a goto`,
    );
    flow.next.push(index + 1);
    return undefined;
  }
  const allowed = new Set(['type', 'instruction', ...STEP_FIELDS[type]]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) push('procedure_unknown_field', field, `${field}: unknown field ${key}`);
  }
  const instruction = value['instruction'];
  if (
    instruction !== undefined &&
    !(nonEmptyString(instruction) && instruction.length <= PROCEDURE_INSTRUCTION_MAX)
  ) {
    push(
      'procedure_step_bad_option',
      field,
      `${field}: instruction must be at most ${PROCEDURE_INSTRUCTION_MAX} characters`,
    );
  }
  const body = actionProblems(type, value, scope, context, (code, _inner, message, extra) =>
    push(code, field, `${field}: ${message}`, extra),
  );
  if (!PROC_TERMINAL_STEP_TYPES.includes(type)) flow.next.push(index + 1);
  return {
    type,
    ...(nonEmptyString(instruction) ? { instruction: instruction.trim() } : {}),
    ...body,
  } as ProcInlineStep;
}

function targetIssues(value: unknown, context: ProcedureValidationContext): Issue[] {
  const bad: Issue[] = [
    {
      code: 'procedure_bad_target',
      message: 'target is { group_id: <team id> } or { topic: <routing topic> }',
    },
  ];
  if (!isPlainObject(value) || Object.keys(value).length !== 1) return bad;
  if ('group_id' in value) {
    const id = value['group_id'];
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return bad;
    return context.groupIds === undefined || context.groupIds.has(id)
      ? []
      : [
          {
            code: 'procedure_unknown_target',
            reference: String(id),
            message: `team ${id} does not exist`,
          },
        ];
  }
  if ('topic' in value) {
    const topic = value['topic'];
    if (typeof topic !== 'string' || !PROCEDURE_KEY_PATTERN.test(topic)) return bad;
    return context.topics === undefined || context.topics.has(topic)
      ? []
      : [
          {
            code: 'procedure_unknown_target',
            reference: topic,
            message: `${topic} is not a routing topic`,
          },
        ];
  }
  return bad;
}

/** Whether control can go from `from` to `to` without passing a step that waits. */
function reachesWithoutWaiting(flows: readonly StepFlow[], from: number, to: number): boolean {
  if (flows[from]?.waits !== false) return false;
  const seen = new Set<number>([from]);
  const queue = [from];
  while (queue.length > 0) {
    const at = queue.shift() as number;
    if (at === to) return true;
    for (const next of flows[at]?.next ?? []) {
      const flow = flows[next];
      if (flow === undefined || flow.waits || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return false;
}

/** The steps no path from the first one reaches — allowed, but worth telling the author. */
function unreachableWarnings(raw: unknown, flows: readonly StepFlow[]): ProcedureWarning[] {
  if (flows.length === 0) return [];
  const seen = new Set<number>([0]);
  const queue = [0];
  while (queue.length > 0) {
    const at = queue.shift() as number;
    for (const next of flows[at]?.next ?? []) {
      if (next >= flows.length || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  const warnings: ProcedureWarning[] = [];
  for (let index = 0; index < flows.length; index += 1) {
    if (seen.has(index)) continue;
    const id = stepIdAt(raw, index);
    warnings.push({
      code: 'procedure_unreachable_step',
      section: 'steps',
      index,
      ...(id !== undefined ? { step_id: id } : {}),
      message: `step ${id ?? `#${index + 1}`}: no path from the first step reaches it`,
    });
  }
  return warnings;
}

// --- hand-over and limits ---------------------------------------------------

function handoffSection(
  value: unknown,
  scope: Scope,
  context: ProcedureValidationContext,
  problems: ProcedureProblem[],
): ProcHandoff {
  const fallback: ProcHandoff = { conditions: [], card_fields: [] };
  if (value === undefined) return fallback;
  const push = (
    code: ProcedureProblemCode | SlotProblemCode,
    field: string | undefined,
    message: string,
    extra: Partial<ProcedureProblem> = {},
  ) =>
    problems.push({
      code,
      section: 'handoff',
      ...(field !== undefined ? { field } : {}),
      ...extra,
      message: `handoff: ${message}`,
    });
  if (!isPlainObject(value)) {
    push('procedure_bad_handoff', undefined, 'handoff must be an object');
    return fallback;
  }
  for (const key of Object.keys(value)) {
    if (!['conditions', 'target', 'card_fields', 'next_step_hint'].includes(key)) {
      push('procedure_unknown_field', key, `unknown field ${key}`);
    }
  }

  const conditions = value['conditions'] ?? [];
  if (!Array.isArray(conditions) || conditions.length > PROCEDURE_HANDOFF_CONDITIONS_MAX) {
    push(
      'procedure_bad_handoff',
      'conditions',
      `conditions must be a list of at most ${PROCEDURE_HANDOFF_CONDITIONS_MAX}`,
    );
  } else {
    for (const [index, cond] of conditions.entries()) {
      for (const issue of condIssues(cond, scope, `conditions[${index}]`, 1, { count: 0 })) {
        push(issue.code, 'conditions', issue.message, {
          index,
          ...placeIssue(issue),
          ...(issue.code === 'slot_unknown_reference' && issue.reference !== undefined
            ? { slot: issue.reference }
            : {}),
        });
      }
    }
  }

  const target = value['target'];
  if (target !== undefined) {
    for (const issue of targetIssues(target, context)) {
      push(issue.code, 'target', issue.message, placeIssue(issue));
    }
  }

  const cardFields = value['card_fields'] ?? [];
  if (
    !Array.isArray(cardFields) ||
    cardFields.length > PROCEDURE_CARD_FIELDS_MAX ||
    !cardFields.every((field) => typeof field === 'string') ||
    new Set(cardFields).size !== cardFields.length
  ) {
    push(
      'procedure_bad_handoff',
      'card_fields',
      `card_fields must be at most ${PROCEDURE_CARD_FIELDS_MAX} distinct slots, facts or functions`,
    );
  } else {
    for (const field of cardFields as string[]) {
      for (const issue of referenceIssues(field, scope, 'field')) {
        push(issue.code, 'card_fields', issue.message, {
          ...placeIssue(issue),
          ...(issue.code === 'slot_unknown_reference' ? { slot: field } : {}),
        });
      }
    }
  }

  const hint = value['next_step_hint'];
  if (hint !== undefined) {
    if (!nonEmptyString(hint) || hint.length > PROCEDURE_NEXT_STEP_HINT_MAX) {
      push(
        'procedure_bad_handoff',
        'next_step_hint',
        `next_step_hint must be at most ${PROCEDURE_NEXT_STEP_HINT_MAX} characters`,
      );
    } else {
      for (const issue of textIssues(hint, scope)) {
        push(issue.code, 'next_step_hint', issue.message, placeIssue(issue));
      }
    }
  }

  return {
    conditions: Array.isArray(conditions) ? (conditions as Cond[]) : [],
    ...(target !== undefined ? { target: target as HandoffTarget } : {}),
    card_fields: Array.isArray(cardFields) ? (cardFields as string[]).map((f) => f.trim()) : [],
    ...(nonEmptyString(hint) ? { next_step_hint: hint.trim() } : {}),
  };
}

/**
 * The "resolved" criteria (K9 · tm 303.4): a condition over the procedure's
 * own slots and facts. Its problems are the hand-over section's — where the
 * editor shows them — under the field `resolution_criteria`. Null is none.
 */
function resolutionSection(
  value: unknown,
  scope: Scope,
  problems: ProcedureProblem[],
): Cond | undefined {
  if (value === undefined || value === null) return undefined;
  for (const issue of condIssues(value, scope, 'resolution_criteria', 1, { count: 0 })) {
    problems.push({
      ...placeIssue(issue),
      section: 'handoff',
      field: 'resolution_criteria',
      ...(issue.code === 'slot_unknown_reference' && issue.reference !== undefined
        ? { slot: issue.reference }
        : {}),
      message: `resolution_criteria: ${issue.message}`,
    });
  }
  return value as Cond;
}

/**
 * The workspace's default "resolved" criteria (K9 · tm 303.4 ·
 * `ai_handoff_settings.resolution_criteria`), judged as a procedure's are but
 * with no procedure around it: no slot, so no slot condition, no fact and no
 * function that reads one — `player_confirmed()`, an `ai` question and
 * `all` / `any` / `not` over them.
 */
export function validateResolutionCriteria(
  value: unknown,
): { ok: true; criteria: Cond } | { ok: false; problems: ProcedureProblem[] } {
  if (isPlainObject(value) && utf8Bytes(JSON.stringify(value)) > RESOLUTION_CRITERIA_MAX_BYTES) {
    return {
      ok: false,
      problems: [
        {
          code: 'procedure_bad_condition',
          section: 'handoff',
          field: 'resolution_criteria',
          message: `resolution_criteria: at most ${RESOLUTION_CRITERIA_MAX_BYTES} bytes`,
        },
      ],
    };
  }
  const scope: Scope = {
    slots: new Map(),
    entities: new Set(),
    placeholders: new Set(),
    templateKeys: new Set(),
    stepIndex: new Map(),
  };
  const problems: ProcedureProblem[] = [];
  const criteria = resolutionSection(value, scope, problems);
  if (criteria === undefined) {
    return {
      ok: false,
      problems: [
        {
          code: 'procedure_bad_condition',
          section: 'handoff',
          field: 'resolution_criteria',
          message: 'resolution_criteria: a condition must be an object',
        },
      ],
    };
  }
  return problems.length > 0 ? { ok: false, problems } : { ok: true, criteria };
}

function limitsSection(value: unknown, problems: ProcedureProblem[]): ProcLimits {
  if (value === undefined) return { ...PROCEDURE_DEFAULTS.limits };
  const maxTurns = isPlainObject(value)
    ? (value['max_turns'] ?? PROCEDURE_DEFAULTS.limits.max_turns)
    : undefined;
  if (
    !isPlainObject(value) ||
    !onlyKeys(value, ['max_turns']) ||
    !isIntegerIn(maxTurns, PROCEDURE_MAX_TURNS_MIN, PROCEDURE_MAX_TURNS_MAX)
  ) {
    problems.push({
      code: 'procedure_bad_limits',
      section: 'limits',
      field: 'max_turns',
      message: `limits is { max_turns } — a whole number from ${PROCEDURE_MAX_TURNS_MIN} to ${PROCEDURE_MAX_TURNS_MAX}`,
    });
    return { ...PROCEDURE_DEFAULTS.limits };
  }
  return { max_turns: maxTurns as number };
}

// --- the fallback -----------------------------------------------------------

/**
 * A skill marked the fallback (`is_fallback`, AI-05 §5) while another of the
 * same agent's skills — named — already is. One fallback per agent: two would
 * leave "which answers when nothing else does" to the order they were edited
 * in. The server knows the other skill; the editor words the code.
 */
export function fallbackTakenProblem(otherSkillName: string): ProcedureProblem {
  return {
    code: 'procedure_fallback_taken',
    section: 'procedure',
    field: 'is_fallback',
    reference: otherSkillName,
    message: `“${otherSkillName}” is already this agent's fallback; an agent has at most one`,
  };
}

// --- locked procedures ------------------------------------------------------

/**
 * Where a locked procedure's structure changed. Its texts — the templates,
 * the step instructions and query hints, the slots' wording, the card's next
 * step — and its team may change; the trigger, the steps, the conditions and
 * the rest may not (ADR `ai-template-catalog.md` §4).
 */
function lockedChanges(stored: Procedure, next: Procedure): ProcedureProblem[] {
  const before = lockSkeleton(stored);
  const after = lockSkeleton(next);
  return PROCEDURE_SECTIONS.filter(
    (section) => canonical(before[section]) !== canonical(after[section]),
  ).map((section) => ({
    code: 'procedure_locked_change',
    section,
    message: `${section}: a locked procedure keeps its structure; only texts and the team change`,
  }));
}

function lockSkeleton(procedure: Procedure): Record<ProcedureSection, unknown> {
  return {
    procedure: {
      when_to_use: procedure.when_to_use,
      examples: procedure.examples,
      priority: procedure.priority,
    },
    slots: procedure.slots.map(
      ({ label: _l, ask: _a, ask_variants: _v, card_label: _c, ...rest }) => rest,
    ),
    steps: procedure.steps.map(stepSkeleton),
    templates: procedure.templates.map(({ text: _text, ...rest }) => rest),
    handoff: {
      conditions: procedure.handoff.conditions,
      card_fields: procedure.handoff.card_fields,
      resolution_criteria: procedure.resolution_criteria,
    },
    limits: procedure.limits,
  };
}

function stepSkeleton(step: ProcStep | ProcInlineStep): unknown {
  const {
    instruction: _instruction,
    query_hint: _hint,
    target: _target,
    then,
    else: otherwise,
    ...rest
  } = step as Record<string, unknown>;
  return {
    ...rest,
    ...(then !== undefined ? { then: branchSkeleton(then) } : {}),
    ...(otherwise !== undefined ? { else: branchSkeleton(otherwise) } : {}),
  };
}

function branchSkeleton(branch: unknown): unknown {
  return isPlainObject(branch) && 'goto' in branch
    ? branch
    : stepSkeleton(branch as ProcInlineStep);
}

/** JSON with every object's keys sorted, so two equal structures compare equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .filter((key) => value[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// --- helpers ----------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

/** The UTF-8 length of a text, as the database counts its bytes. */
function utf8Bytes(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function isIntegerIn(value: unknown, min: number, max: number): boolean {
  return Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}
