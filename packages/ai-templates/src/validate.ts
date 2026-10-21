/**
 * The judgement a template must pass before it ships (tm 311.1 · AI-15
 * acceptance "20 şablonun tamamı prosedür doğrulayıcısından geçer") — the
 * counterpart of the web catalogue's `templates.test.ts` invariants, for
 * procedures.
 *
 * Beyond `validateProcedure` (AI-03, with the six queue topics and the
 * template's own placeholders as the context, and every warning a problem —
 * the platform ships no unreachable step) it holds what only a template has:
 *
 *   - its key is one of the twenty and its lock is the catalogue's;
 *   - it hands over by topic, never by team id, and only to a queue role;
 *   - its checklist (`tenant_must_fill`) is exact: every placeholder used and
 *     every fact read is declared, nothing declared is unused;
 *   - what the player reads — reply templates, slot questions — trips no
 *     platform output guardrail the engine would hold it to (AI-08; G4 only
 *     for a locked template, {@link templateOutputRules}), carries none of the template's own
 *     forbidden phrases, and addresses the player as "siz";
 *   - at least {@link TEMPLATE_SCENARIOS_MIN} scenarios, each one that the
 *     procedure can end as it expects.
 *
 * It imports values from `@siyahtus/types`, so it is not part of the package's
 * entry point (`index.ts`): the API image loads the catalogue without it.
 */
import {
  ADDRESS_FORMS,
  EMOJI_USES,
  FORBIDDEN_PHRASES_PER_AGENT_MAX,
  FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX,
  GUIDANCE_BODY_MAX,
  GUIDANCE_CATEGORIES,
  GUIDANCE_PRIORITY_MAX,
  GUIDANCE_PRIORITY_MIN,
  GUIDANCE_TITLE_MAX,
  KNOWLEDGE_TABLES,
  MAX_QUESTIONS_PER_MESSAGE_MAX,
  MAX_QUESTIONS_PER_MESSAGE_MIN,
  PLATFORM_GUARDRAILS,
  PROCEDURE_FACTS,
  PROCEDURE_FACT_ENTITIES,
  PROCEDURE_KEY_PATTERN,
  QUEUE_TOPIC_ROLES,
  compileForbiddenPhrase,
  matchForbiddenPhrases,
  parseProcedureReference,
  scanGuardrails,
  templateReferences,
  validateKnowledgeTableRow,
  validateProcedure,
  type CompiledForbiddenPhrase,
  type Cond,
  type CondOperand,
  type GuardrailId,
  type ProcStep,
  type ProcedureFactEntity,
} from '@siyahtus/types';
import {
  AI_TEMPLATE_INDUSTRIES,
  AI_TEMPLATE_LANGS,
  AI_TEMPLATE_NAME_MAX,
  AI_TEMPLATE_SUMMARY_MAX,
  IGAMING_TEMPLATE_KEYS,
  SCENARIO_OUTCOMES,
  SCENARIO_PERSONAS,
  TEMPLATE_SCENARIOS_MIN,
  isLockedTemplateKey,
  templatePlaceholders,
  templateTopics,
  type AiTemplate,
  type AiTemplatePack,
  type TemplateScenario,
} from './catalogue.js';

/**
 * Why a template does not ship, as a stable code:
 *
 *   - `template_unknown_key`              — not one of {@link IGAMING_TEMPLATE_KEYS}, or a key twice.
 *   - `template_bad_version`              — not a whole number from 1.
 *   - `template_bad_meta`                 — industry, language, name or summary.
 *   - `template_lock_mismatch`            — `locked` differs from {@link LOCKED_TEMPLATE_KEYS}.
 *   - `template_procedure_invalid`        — `validateProcedure` refused it; `detail` is its code.
 *   - `template_unreachable_step`         — a step no path reaches.
 *   - `template_team_by_id`               — a hand-over to a team id; a template names topics.
 *   - `template_unknown_topic`            — a hand-over topic that is no queue role.
 *   - `template_bad_placeholder`          — a placeholder key that is not snake_case, has no
 *                                           label or example, is declared twice or is a slot's name.
 *   - `template_placeholder_unused`       — declared and in no text.
 *   - `template_fact_undeclared`          — a fact the procedure reads that no `table` item lists.
 *   - `template_table_column_unused`      — a listed column the procedure never reads.
 *   - `template_guardrail_hit`            — player-facing text trips a platform output guardrail.
 *   - `template_forbidden_phrase_invalid` — a forbidden phrase that does not compile.
 *   - `template_forbidden_phrase_hit`     — the template's own text carries one of its phrases.
 *   - `template_familiar_address`         — player-facing text says "sen".
 *   - `template_too_few_scenarios`        — fewer than {@link TEMPLATE_SCENARIOS_MIN}.
 *   - `template_bad_scenario`             — a scenario the procedure cannot end as written.
 *   - `template_bad_pack`                 — a pack naming a template twice or one not in the catalogue,
 *                                           or a default rule, its persona style, a sample row or
 *                                           its templates' forbidden phrases past what a tenant may write.
 */
export const AI_TEMPLATE_PROBLEM_CODES = [
  'template_unknown_key',
  'template_bad_version',
  'template_bad_meta',
  'template_lock_mismatch',
  'template_procedure_invalid',
  'template_unreachable_step',
  'template_team_by_id',
  'template_unknown_topic',
  'template_bad_placeholder',
  'template_placeholder_unused',
  'template_fact_undeclared',
  'template_table_column_unused',
  'template_guardrail_hit',
  'template_forbidden_phrase_invalid',
  'template_forbidden_phrase_hit',
  'template_familiar_address',
  'template_too_few_scenarios',
  'template_bad_scenario',
  'template_bad_pack',
] as const;
export type AiTemplateProblemCode = (typeof AI_TEMPLATE_PROBLEM_CODES)[number];

export interface AiTemplateProblem {
  code: AiTemplateProblemCode;
  /** The template's key (or the pack's). */
  template: string;
  /** Where: `templates.normal_sure`, `slots.yontem.ask`, `scenarios.talep_yok`. */
  at?: string;
  /** The nested code — `validateProcedure`'s, a guardrail id. */
  detail?: string;
  message: string;
}

/** Every problem with one template; none means it ships. */
export function validateAiTemplate(template: AiTemplate): AiTemplateProblem[] {
  const problems: AiTemplateProblem[] = [];
  const push = (code: AiTemplateProblemCode, message: string, at?: string, detail?: string) =>
    problems.push({
      code,
      template: template.key,
      ...(at !== undefined ? { at } : {}),
      ...(detail !== undefined ? { detail } : {}),
      message,
    });

  if (!(IGAMING_TEMPLATE_KEYS as readonly string[]).includes(template.key)) {
    push('template_unknown_key', `${template.key} is not one of the iGaming topics`);
  }
  if (!Number.isInteger(template.version) || template.version < 1) {
    push('template_bad_version', 'version must be a whole number from 1');
  }
  if (!(AI_TEMPLATE_INDUSTRIES as readonly string[]).includes(template.industry)) {
    push('template_bad_meta', `unknown industry ${template.industry}`, 'industry');
  }
  if (!(AI_TEMPLATE_LANGS as readonly string[]).includes(template.lang)) {
    push('template_bad_meta', `unknown language ${template.lang}`, 'lang');
  }
  if (!filled(template.name, AI_TEMPLATE_NAME_MAX)) {
    push('template_bad_meta', `name must be 1–${AI_TEMPLATE_NAME_MAX} characters`, 'name');
  }
  if (!filled(template.summary, AI_TEMPLATE_SUMMARY_MAX)) {
    push('template_bad_meta', `summary must be 1–${AI_TEMPLATE_SUMMARY_MAX} characters`, 'summary');
  }
  if (template.locked !== isLockedTemplateKey(template.key)) {
    push(
      'template_lock_mismatch',
      template.locked
        ? `${template.key} is not a locked topic`
        : `${template.key} is a locked topic (AI-15-S2)`,
    );
  }

  const placeholders = templatePlaceholders(template);
  const result = validateProcedure(template.procedure, {
    topics: new Set(QUEUE_TOPIC_ROLES),
    placeholders: new Set(placeholders),
  });
  if (!result.ok) {
    for (const problem of result.problems) {
      const at = [problem.section, problem.step_id ?? problem.slot ?? problem.template_key]
        .filter((part) => part !== undefined)
        .join('.');
      push('template_procedure_invalid', problem.message, at, problem.code);
    }
  }
  for (const warning of result.warnings) {
    push(
      'template_unreachable_step',
      warning.message,
      `steps.${warning.step_id ?? warning.index}`,
      warning.code,
    );
  }

  for (const [at, target] of handoffTargets(template)) {
    if ('group_id' in target) {
      push('template_team_by_id', 'a template hands over to a topic, never a team id', at);
    } else if (!(QUEUE_TOPIC_ROLES as readonly string[]).includes(target.topic)) {
      push('template_unknown_topic', `${target.topic} is not a queue role (ADR-08a)`, at);
    }
  }

  checklistProblems(template, push);
  textProblems(template, push);
  scenarioProblems(template, push);
  return problems;
}

/** Every problem across a catalogue and its packs: each template's, a key twice, a pack's. */
export function validateAiCatalogue(
  templates: readonly AiTemplate[],
  packs: readonly AiTemplatePack[] = [],
): AiTemplateProblem[] {
  const problems = templates.flatMap(validateAiTemplate);
  const seen = new Set<string>();
  for (const template of templates) {
    if (seen.has(template.key)) {
      problems.push({
        code: 'template_unknown_key',
        template: template.key,
        message: `${template.key} is in the catalogue twice`,
      });
    }
    seen.add(template.key);
  }
  for (const pack of packs) {
    const named = new Set<string>();
    for (const key of pack.template_keys) {
      if (named.has(key) || !seen.has(key)) {
        problems.push({
          code: 'template_bad_pack',
          template: pack.key,
          at: key,
          message: named.has(key)
            ? `${pack.key} names ${key} twice`
            : `${pack.key} names ${key}, which is not in the catalogue`,
        });
      }
      named.add(key);
    }
    packProblems(pack, templates, (message, at) =>
      problems.push({
        code: 'template_bad_pack',
        template: pack.key,
        ...(at !== undefined ? { at } : {}),
        message,
      }),
    );
  }
  return problems;
}

/**
 * What a pack installs beside its templates, held to the limits a tenant's
 * own writes are (#311.3 writes them through the same paths): each default
 * rule as `POST /ai-guidance` would take it, the persona style's closed sets,
 * every sample row as `validateKnowledgeTableRow` accepts it — and the
 * forbidden phrases of all its templates, which land on one agent, within
 * that agent's limits.
 */
function packProblems(
  pack: AiTemplatePack,
  templates: readonly AiTemplate[],
  bad: (message: string, at?: string) => void,
): void {
  const keys = new Set<string>();
  pack.default_rules.forEach((rule, i) => {
    const at = `default_rules.${rule.key || i}`;
    if (!PROCEDURE_KEY_PATTERN.test(rule.key)) bad('a rule key must be lower snake_case', at);
    if (keys.has(rule.key)) bad(`rule key ${rule.key} is used twice`, at);
    keys.add(rule.key);
    if (!filled(rule.title, GUIDANCE_TITLE_MAX)) {
      bad(`a rule title must be 1–${GUIDANCE_TITLE_MAX} characters`, at);
    }
    if (!filled(rule.body, GUIDANCE_BODY_MAX)) {
      bad(`a rule body must be 1–${GUIDANCE_BODY_MAX} characters`, at);
    }
    if (!(GUIDANCE_CATEGORIES as readonly string[]).includes(rule.category)) {
      bad(`unknown rule category ${rule.category}`, at);
    }
    if (
      !Number.isInteger(rule.priority) ||
      rule.priority < GUIDANCE_PRIORITY_MIN ||
      rule.priority > GUIDANCE_PRIORITY_MAX
    ) {
      bad(
        `a rule priority is a whole number ${GUIDANCE_PRIORITY_MIN}–${GUIDANCE_PRIORITY_MAX}`,
        at,
      );
    }
    if (rule.template_keys !== undefined) {
      if (rule.template_keys.length === 0) bad('a scoped rule names at least one template', at);
      for (const key of rule.template_keys) {
        if (!pack.template_keys.includes(key)) bad(`a rule scoped to ${key}, not in the pack`, at);
      }
    }
  });

  const style = pack.persona_style;
  if (!(ADDRESS_FORMS as readonly string[]).includes(style.address_form)) {
    bad(`unknown address form ${style.address_form}`, 'persona_style.address_form');
  }
  if (!(EMOJI_USES as readonly string[]).includes(style.emoji)) {
    bad(`unknown emoji use ${style.emoji}`, 'persona_style.emoji');
  }
  if (
    !Number.isInteger(style.max_questions_per_message) ||
    style.max_questions_per_message < MAX_QUESTIONS_PER_MESSAGE_MIN ||
    style.max_questions_per_message > MAX_QUESTIONS_PER_MESSAGE_MAX
  ) {
    bad(
      `max_questions_per_message is ${MAX_QUESTIONS_PER_MESSAGE_MIN}–${MAX_QUESTIONS_PER_MESSAGE_MAX}`,
      'persona_style.max_questions_per_message',
    );
  }

  for (const table of KNOWLEDGE_TABLES) {
    pack.sample_rows[table].forEach((row, i) => {
      for (const problem of validateKnowledgeTableRow(table, row)) {
        bad(`${problem.field}: ${problem.code}`, `sample_rows.${table}.${i}`);
      }
    });
  }

  const installed = templates.filter((template) => pack.template_keys.includes(template.key));
  const phrases = installed.flatMap((template) => template.forbidden_phrases);
  if (phrases.length > FORBIDDEN_PHRASES_PER_AGENT_MAX) {
    bad(`${phrases.length} forbidden phrases; one agent holds ${FORBIDDEN_PHRASES_PER_AGENT_MAX}`);
  }
  const regexes = phrases.filter((phrase) => phrase.match === 'regex').length;
  if (regexes > FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX) {
    bad(`${regexes} regex phrases; one agent holds ${FORBIDDEN_PHRASE_REGEXES_PER_AGENT_MAX}`);
  }
}

// ---------------------------------------------------------------------------
// What the procedure reads.
// ---------------------------------------------------------------------------

/** The two functions that read the method's working hours. */
const HOURS_FNS: ReadonlySet<string> = new Set(['within_working_hours', 'next_window']);
const WORKING_HOURS = 'method.working_hours';

/**
 * Every fact path the procedure reads — in conditions, reply texts, the card
 * and the agent's hint — with `method.working_hours` for the two functions
 * that read it. What the template's `table` items must list.
 */
export function templateFacts(template: AiTemplate): string[] {
  const facts = new Set<string>();
  const procedure = template.procedure;
  const cond = (value: Cond | undefined) => condFacts(value, facts);
  const text = (value: string | undefined) => {
    for (const raw of templateReferences(value ?? '')) referenceFacts(raw, facts);
  };

  for (const slot of procedure.slots) {
    if (typeof slot.required === 'object') cond(slot.required.when);
  }
  for (const step of procedure.steps) {
    cond(step.when);
    if (step.type === 'check') {
      for (const branch of [step.then, step.else]) {
        if (branch !== undefined && 'instruction' in branch) text(branch.instruction);
      }
    }
  }
  for (const reply of procedure.templates) text(reply.text);
  procedure.handoff.conditions.forEach(cond);
  for (const field of procedure.handoff.card_fields) referenceFacts(field, facts);
  text(procedure.handoff.next_step_hint);
  cond(procedure.resolution_criteria);
  return [...facts];
}

function condFacts(cond: Cond | undefined, out: Set<string>): void {
  if (cond === undefined) return;
  if ('all' in cond) cond.all.forEach((inner) => condFacts(inner, out));
  else if ('any' in cond) cond.any.forEach((inner) => condFacts(inner, out));
  else if ('not' in cond) condFacts(cond.not, out);
  else if ('slot' in cond) operandFacts(cond.slot.value, out);
  else if ('fact' in cond) {
    out.add(cond.fact.path);
    operandFacts(cond.fact.value, out);
  } else if ('fn' in cond) {
    if (HOURS_FNS.has(cond.fn.name)) out.add(WORKING_HOURS);
    operandFacts(cond.fn.value, out);
  }
}

function operandFacts(operand: CondOperand | undefined, out: Set<string>): void {
  if (typeof operand === 'object' && !Array.isArray(operand) && 'fact' in operand) {
    out.add(operand.fact);
  }
}

function referenceFacts(raw: string, out: Set<string>): void {
  const reference = parseProcedureReference(raw);
  if (reference?.kind === 'fact') out.add(reference.path);
  if (reference?.kind === 'fn' && HOURS_FNS.has(reference.name)) out.add(WORKING_HOURS);
}

/** Every hand-over target, with where it is written. */
function handoffTargets(
  template: AiTemplate,
): Array<[string, { group_id: number } | { topic: string }]> {
  const out: Array<[string, { group_id: number } | { topic: string }]> = [];
  const procedure = template.procedure;
  if (procedure.handoff.target !== undefined)
    out.push(['handoff.target', procedure.handoff.target]);
  for (const step of procedure.steps) {
    if (step.type === 'handoff' && step.target !== undefined) {
      out.push([`steps.${step.id}.target`, step.target]);
    }
    if (step.type === 'check') {
      for (const [field, branch] of [
        ['then', step.then],
        ['else', step.else],
      ] as const) {
        if (branch !== undefined && 'type' in branch && branch.type === 'handoff') {
          if (branch.target !== undefined)
            out.push([`steps.${step.id}.${field}.target`, branch.target]);
        }
      }
    }
  }
  return out;
}

/** The hand-over reasons the procedure can end with, in steps and branches. */
function handoffReasons(steps: readonly ProcStep[]): Set<string> {
  const reasons = new Set<string>();
  for (const step of steps) {
    if (step.type === 'handoff') reasons.add(step.reason_code);
    if (step.type === 'check') {
      for (const branch of [step.then, step.else]) {
        if (branch !== undefined && 'type' in branch && branch.type === 'handoff') {
          reasons.add(branch.reason_code);
        }
      }
    }
  }
  return reasons;
}

/** The outcomes the procedure's `resolve` steps (and branches) close with. */
function resolveOutcomes(steps: readonly ProcStep[]): Set<string> {
  const outcomes = new Set<string>();
  for (const step of steps) {
    if (step.type === 'resolve') outcomes.add(step.outcome);
    if (step.type === 'check') {
      for (const branch of [step.then, step.else]) {
        if (branch !== undefined && 'type' in branch && branch.type === 'resolve') {
          outcomes.add(branch.outcome);
        }
      }
    }
  }
  return outcomes;
}

type Push = (code: AiTemplateProblemCode, message: string, at?: string, detail?: string) => void;

// ---------------------------------------------------------------------------
// The checklist.
// ---------------------------------------------------------------------------

const PLACEHOLDER_KEY = /^[a-z][a-z0-9_]{0,39}$/;

function checklistProblems(template: AiTemplate, push: Push): void {
  const procedure = template.procedure;
  const slotNames = new Set(procedure.slots.map((slot) => slot.name));
  const used = new Set<string>();
  for (const text of [
    ...procedure.templates.map((t) => t.text),
    procedure.handoff.next_step_hint ?? '',
  ]) {
    for (const reference of templateReferences(text)) used.add(reference);
  }

  const declared = new Set<string>();
  for (const item of template.tenant_must_fill) {
    if (item.kind !== 'placeholder') continue;
    const at = `tenant_must_fill.${item.key}`;
    if (!PLACEHOLDER_KEY.test(item.key)) {
      push('template_bad_placeholder', `${item.key} must be lower snake_case ASCII`, at);
    } else if (declared.has(item.key)) {
      push('template_bad_placeholder', `${item.key} is declared twice`, at);
    } else if (slotNames.has(item.key)) {
      push('template_bad_placeholder', `${item.key} is also a slot's name`, at);
    }
    if (!filled(item.label, 200) || !filled(item.example, 300)) {
      push('template_bad_placeholder', `${item.key} needs a label and an example value`, at);
    }
    declared.add(item.key);
    if (!used.has(item.key)) {
      push('template_placeholder_unused', `{${item.key}} is in no text`, at);
    }
  }

  const facts = new Set(templateFacts(template));
  const listed = new Set<string>();
  for (const item of template.tenant_must_fill) {
    if (item.kind !== 'table') continue;
    for (const column of item.columns) {
      const at = `tenant_must_fill.${item.table}.${column}`;
      const entity = column.split('.')[0] as ProcedureFactEntity;
      const sources = PROCEDURE_FACT_ENTITIES[entity] as readonly string[] | undefined;
      if (sources === undefined || !sources.includes(item.table)) {
        push('template_fact_undeclared', `${column} is not a column of ${item.table}`, at);
      }
      if (!facts.has(column)) {
        push('template_table_column_unused', `${column} is listed but never read`, at);
      }
      listed.add(column);
    }
  }
  for (const fact of facts) {
    if (!listed.has(fact)) {
      push('template_fact_undeclared', `${fact} is read but no table item lists it`, fact);
    }
  }
}

// ---------------------------------------------------------------------------
// What the player reads.
// ---------------------------------------------------------------------------

/** "sen" and its cases, as words — the familiar address the templates never use. */
const FAMILIAR = /(^|[^a-zçğıöşü])(sen|seni|sana|senin|sende|senden|seninle)(?=$|[^a-zçğıöşü])/;

/** The texts the player reads: reply templates and slot questions. */
function playerTexts(template: AiTemplate): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const reply of template.procedure.templates)
    out.push([`templates.${reply.key}`, reply.text]);
  for (const slot of template.procedure.slots) {
    out.push([`slots.${slot.name}.ask`, slot.ask]);
    (slot.ask_variants ?? []).forEach((variant, i) =>
      out.push([`slots.${slot.name}.ask_variants.${i}`, variant]),
    );
  }
  return out;
}

/**
 * The output rules a template's text is held to — the engine's own choice
 * (`output-check.ts` `outputRules`): every rule that applies always, and G4
 * (no promotion to a player at risk) only on a risk-flagged conversation. A
 * bonus template names a bonus; a locked template runs on exactly such a
 * conversation (G1/G2 raise the flag), so it is held to G4 as well.
 */
export function templateOutputRules(template: Pick<AiTemplate, 'locked'>): GuardrailId[] {
  return PLATFORM_GUARDRAILS.filter(
    (rule) => rule.output !== null && (rule.appliesWhen === 'always' || template.locked),
  ).map((rule) => rule.id);
}

function textProblems(template: AiTemplate, push: Push): void {
  const rules = templateOutputRules(template);
  const compiled: CompiledForbiddenPhrase[] = [];
  template.forbidden_phrases.forEach((phrase, i) => {
    const at = `forbidden_phrases.${i}`;
    const one = compileForbiddenPhrase(phrase.phrase, phrase.match);
    if (one === null) {
      push('template_forbidden_phrase_invalid', `"${phrase.phrase}" does not compile`, at);
    } else {
      compiled.push(one);
    }
    if (!filled(phrase.why, 300)) push('template_forbidden_phrase_invalid', 'needs a why', at);
  });

  for (const [at, text] of playerTexts(template)) {
    for (const match of scanGuardrails(text, 'output', { rules })) {
      push(
        'template_guardrail_hit',
        `"${match.quote}" trips ${match.rule} (${match.lang} pattern ${match.pattern})`,
        at,
        match.rule,
      );
    }
    for (const hit of matchForbiddenPhrases(text, compiled)) {
      push('template_forbidden_phrase_hit', `"${hit.quote}" is one of its forbidden phrases`, at);
    }
    if (FAMILIAR.test(text.toLocaleLowerCase('tr'))) {
      push('template_familiar_address', 'the player is addressed as "siz", never "sen"', at);
    }
  }
}

// ---------------------------------------------------------------------------
// Scenarios.
// ---------------------------------------------------------------------------

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

function scenarioProblems(template: AiTemplate, push: Push): void {
  const scenarios = template.scenarios;
  if (scenarios.length < TEMPLATE_SCENARIOS_MIN) {
    push(
      'template_too_few_scenarios',
      `${scenarios.length} scenarios; at least ${TEMPLATE_SCENARIOS_MIN}`,
      'scenarios',
    );
  }
  const procedure = template.procedure;
  const slots = new Map(procedure.slots.map((slot) => [slot.name, slot]));
  const reasons = handoffReasons(procedure.steps);
  const outcomes = resolveOutcomes(procedure.steps);
  const topics = new Set(templateTopics(template));
  const columns = template.tenant_must_fill.flatMap((item) =>
    item.kind === 'table' ? item.columns : [],
  );
  const seen = new Set<string>();

  for (const scenario of scenarios) {
    const at = `scenarios.${scenario.key}`;
    const bad = (message: string) => push('template_bad_scenario', message, at);
    if (!PROCEDURE_KEY_PATTERN.test(scenario.key)) bad('key must be lower snake_case');
    if (seen.has(scenario.key)) bad(`key ${scenario.key} is used twice`);
    seen.add(scenario.key);
    if (!filled(scenario.name, 200)) bad('needs a name');
    if (!(SCENARIO_PERSONAS as readonly string[]).includes(scenario.persona)) {
      bad(`unknown persona ${scenario.persona}`);
    }
    if (!isMoment(scenario.simulated_now)) bad('simulated_now must be ISO 8601 with an offset');
    if (scenario.next_window !== undefined && !isMoment(scenario.next_window)) {
      bad('next_window must be ISO 8601 with an offset');
    }
    if (scenario.access_info !== undefined && !filled(scenario.access_info, 1000)) {
      bad('access_info must be 1–1000 characters');
    }
    if (
      scenario.turns.length === 0 ||
      scenario.turns.length > procedure.limits.max_turns ||
      !scenario.turns.every((turn) => filled(turn, 1000))
    ) {
      bad(`needs 1–${procedure.limits.max_turns} non-empty turns`);
    }
    for (const path of Object.keys(scenario.facts)) {
      if (!Object.hasOwn(PROCEDURE_FACTS, path)) bad(`${path} is not a fact`);
    }
    for (const column of columns) {
      if (!Object.hasOwn(scenario.facts, column))
        bad(`facts lack ${column}, which the procedure reads`);
    }
    for (const name of Object.keys(scenario.options ?? {})) {
      if (slots.get(name)?.type !== 'enum') bad(`options for ${name}, which is no enum slot`);
    }
    expectationProblems(scenario, { slots, reasons, outcomes, topics }, bad);
  }
}

function expectationProblems(
  scenario: TemplateScenario,
  known: {
    slots: ReadonlyMap<string, unknown>;
    reasons: ReadonlySet<string>;
    outcomes: ReadonlySet<string>;
    topics: ReadonlySet<string>;
  },
  bad: (message: string) => void,
): void {
  const expect = scenario.expect;
  if (!(SCENARIO_OUTCOMES as readonly string[]).includes(expect.outcome)) {
    bad(`unknown outcome ${expect.outcome}`);
  } else if (expect.outcome === 'handoff') {
    if (expect.reason_code === undefined || !known.reasons.has(expect.reason_code)) {
      bad(`a hand-over expects one of the procedure's reasons: ${[...known.reasons].join(', ')}`);
    }
    if (expect.topic === undefined || !known.topics.has(expect.topic)) {
      bad(`a hand-over expects one of the template's topics: ${[...known.topics].join(', ')}`);
    }
  } else {
    if (expect.reason_code !== undefined || expect.topic !== undefined) {
      bad('only a hand-over has a reason and a topic');
    }
    if (!known.outcomes.has(expect.outcome)) bad(`no resolve step ends ${expect.outcome}`);
  }
  for (const name of expect.required_slots) {
    if (!known.slots.has(name)) bad(`${name} is not a slot`);
  }
  for (const [name, value] of Object.entries(expect.values ?? {})) {
    if (!expect.required_slots.includes(name)) bad(`a value for ${name}, which is not required`);
    if (!filled(value, 200)) bad(`the value for ${name} must be 1–200 characters`);
  }
  for (const phrase of expect.forbidden_phrases ?? []) {
    if (!filled(phrase, 200)) bad('a forbidden phrase must be 1–200 characters');
  }
}

function isMoment(value: string): boolean {
  return ISO_WITH_OFFSET.test(value) && !Number.isNaN(Date.parse(value));
}

function filled(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.trim() !== '' && value.length <= max;
}
