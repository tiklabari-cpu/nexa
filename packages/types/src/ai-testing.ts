/**
 * The AI test bench's vocabulary (tm 314.1 · SiyahTuş analysis AI-19) —
 * shared by the four tables' CHECKs (`20261021200000_ai_testing`), the API
 * that will run scenarios (tm 314.2 runner, 314.6 checks and simulated player,
 * 314.3 judge and regression, 314.4 compliance pack) and the Test tab (314.5).
 *
 *   - A **scenario** is a conversation the workspace wants its AI to get right:
 *     scripted (the player's messages, in order) or simulated (a model plays a
 *     persona who knows `facts` and wants `goal`), at a frozen moment, with
 *     what a tool step would have returned (AI-28) and what must come out
 *     (`expectations`).
 *   - A **run** plays a set of scenarios against one configuration — the
 *     draft, the published one or a named version — and keeps the counts. The
 *     platform's locked compliance pack (AI-19-S1) joins every pre-publish
 *     run; its version and counts sit on the run so the root panel (tm 389.19)
 *     reads them without opening the results.
 *   - A **result** is one scenario of one run: its transcript with the
 *     decision trace of every AI turn, the hard checks that decide pass or
 *     fail, and the judge's advice, which never does (AI-19-S3).
 *   - A **sandbox session** is "talk like a player": the same turn, kept for
 *     `AI_SANDBOX_SESSION_TTL_HOURS`.
 *
 * Scenario text is synthetic by rule; the editor says so and the API masks it
 * (AI-26) — no real player's data belongs here.
 */
import type { AiDecision } from './ai-decision.js';
import { PROCEDURE_KEY_PATTERN } from './procedure.js';
import { RISK_FLAG_TYPES, type RiskFlagType } from './risk-flags.js';
import { QUEUE_TOPIC_ROLES, type QueueTopicRole } from './team-queues.js';

// ---------------------------------------------------------------------------
// Closed lists — each is a CHECK in the migration.
// ---------------------------------------------------------------------------

/**
 * The player a scenario plays (05 § AI-19 "Tipler"). The simulated player
 * (tm 314.6) writes in the persona's manner; a scripted scenario names one for
 * the list and the regression report. `@siyahtus/ai-templates` keeps its own
 * copy (it loads without this package at run time) and a test holds the two equal.
 */
export const SCENARIO_PERSONAS = [
  'normal',
  'sabirsiz',
  'kizgin',
  'eksik_bilgi',
  'sorumlu_oyun_sinyali',
  'resit_olmayan',
  'insan_istiyor',
  'yabanci_dil',
] as const;
export type ScenarioPersona = (typeof SCENARIO_PERSONAS)[number];

/**
 * How a scenario must end: the procedure resolved the matter, resolved it
 * pending the wait it explained, or handed it to a person.
 */
export const SCENARIO_OUTCOMES = ['resolved', 'resolved_waiting', 'handoff'] as const;
export type ScenarioOutcome = (typeof SCENARIO_OUTCOMES)[number];

/**
 * Where a scenario came from: a template's seed (AI-15), written by hand,
 * suggested by the fast model, saved from a sandbox session or a live chat,
 * or opened from a QA finding (AI-24).
 */
export const AI_TEST_SCENARIO_ORIGINS = [
  'template',
  'manual',
  'generated',
  'from_chat',
  'from_qa',
] as const;
export type AiTestScenarioOrigin = (typeof AI_TEST_SCENARIO_ORIGINS)[number];

export const AI_TEST_SCENARIO_MODES = ['scripted', 'simulated'] as const;
export type AiTestScenarioMode = (typeof AI_TEST_SCENARIO_MODES)[number];

/** Which configuration a run plays against; `version` names one (tm 316). */
export const AI_TEST_RUN_TARGETS = ['draft', 'published', 'version'] as const;
export type AiTestRunTarget = (typeof AI_TEST_RUN_TARGETS)[number];

/** Who started a run: a person, the publish gate (AI-20), the nightly job. */
export const AI_TEST_RUN_TRIGGERS = ['manual', 'pre_publish', 'nightly'] as const;
export type AiTestRunTrigger = (typeof AI_TEST_RUN_TRIGGERS)[number];

/**
 * A run's life: waiting in the queue, being played, done (whatever its
 * scenarios said), stopped by an error of its own, or called off.
 */
export const AI_TEST_RUN_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export type AiTestRunStatus = (typeof AI_TEST_RUN_STATUSES)[number];

/** The runs still under way — at most one per agent and target (tm 314.2). */
export const AI_TEST_RUN_OPEN_STATUSES = [
  'queued',
  'running',
] as const satisfies readonly AiTestRunStatus[];

/**
 * One scenario's verdict: every hard check held, one did not, or the
 * scenario could not be played (a provider error, the 60 s limit).
 */
export const AI_TEST_RESULT_STATUSES = ['passed', 'failed', 'errored'] as const;
export type AiTestResultStatus = (typeof AI_TEST_RESULT_STATUSES)[number];

/**
 * Why a scenario's conversation stopped (05 § AI-19 "Koşu döngüsü"): the
 * engine resolved it or handed it over, `max_turns` ran out, the script ran
 * out, the scenario's time ran out, or a turn failed.
 */
export const AI_TEST_STOP_REASONS = [
  'resolved',
  'handoff',
  'max_turns',
  'script_end',
  'timeout',
  'error',
] as const;
export type AiTestStopReason = (typeof AI_TEST_STOP_REASONS)[number];

/** The hard checks (tm 314.6); each passes or fails, and they alone decide. */
export const AI_TEST_CHECK_KINDS = [
  'outcome',
  'team',
  'topic',
  'procedure',
  'reason_code',
  'required_slots',
  'values',
  'forbidden_phrase',
  'sensitive_request',
  'must_flags',
  'must_not_flags',
  'turn_count',
  'language',
] as const;
export type AiTestCheckKind = (typeof AI_TEST_CHECK_KINDS)[number];

export const AI_TEST_TRANSCRIPT_ROLES = ['player', 'ai', 'system'] as const;
export type AiTestTranscriptRole = (typeof AI_TEST_TRANSCRIPT_ROLES)[number];

// ---------------------------------------------------------------------------
// Bounds — the CHECKs and the validator below say the same numbers.
// ---------------------------------------------------------------------------

export const AI_TEST_SCENARIO_NAME_MAX = 120;
/** What the simulated player wants, in a sentence or two. */
export const AI_TEST_SCENARIO_GOAL_MAX = 500;
/** A scripted scenario's player messages. */
export const AI_TEST_SCENARIO_TURNS_MAX = 30;
export const AI_TEST_TURN_TEXT_MAX = 2000;
/** `expectations.max_turns`: the default, and the most a scenario may ask for. */
export const AI_TEST_MAX_TURNS_DEFAULT = 12;
export const AI_TEST_MAX_TURNS_LIMIT = 30;
/** Keys of `facts`, keys of `tool_outputs`, entries of each expectation list. */
export const AI_TEST_FACTS_MAX = 40;
export const AI_TEST_FACT_TEXT_MAX = 500;
export const AI_TEST_TOOL_OUTPUTS_MAX = 20;
export const AI_TEST_LIST_MAX = 30;
/** A scenario's or the conversation's language, ISO 639-1. */
export const AI_TEST_LANG = /^[a-z]{2}$/;
/** `ai_test_runs.error`: what stopped a run, for the operator — never a provider's words. */
export const AI_TEST_RUN_ERROR_MAX = 500;

// The budget (AI-19-S2; the test meter itself is `AI_TEST_CAP_PERCENT`, ai-usage.ts).
/** Scenarios one run may hold, the compliance pack included. */
export const AI_TEST_RUN_SCENARIOS_MAX = 200;
/** Scenarios a workspace plays at the same time, across its runs. */
export const AI_TEST_CONCURRENT_SCENARIOS = 2;
/** One scenario's wall-clock limit; past it the result is `errored` / `timeout`. */
export const AI_TEST_SCENARIO_TIMEOUT_MS = 60_000;
/** The frozen clock moves this much per turn: `simulated_now + turn × 30 s`. */
export const AI_TEST_TURN_SPACING_SECONDS = 30;
/** A sandbox session's life from its last turn (`expires_at`). */
export const AI_SANDBOX_SESSION_TTL_HOURS = 24;

/**
 * A compliance-pack scenario's `scenario_key` (tm 314.4): the prefix, the
 * guardrail and the language — `compliance:G3:tr`. A workspace scenario's key
 * is its id. The two never meet: an id is a UUID.
 */
export const AI_COMPLIANCE_SCENARIO_KEY_PREFIX = 'compliance:';
export const AI_TEST_SCENARIO_KEY_PATTERN =
  /^(compliance:G([1-9]|1[0-9]):[a-z]{2}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// ---------------------------------------------------------------------------
// Shapes of the JSON columns.
// ---------------------------------------------------------------------------

/**
 * What must come out of a scenario (05 § AI-19 "Beklentiler"). Only
 * `outcome` and `max_turns` are always checked; every other key is a check
 * only when given.
 */
export interface AiTestExpectations {
  outcome: ScenarioOutcome;
  /** A hand-over's team (`groups.id`). */
  team_id?: number;
  /** A hand-over's routing topic (AI-12). */
  topic?: QueueTopicRole;
  /** The procedure (skill id) the AI must pick. */
  procedure_id?: string;
  /** A hand-over's `reason_code` — one of the procedure's. */
  reason_code?: string;
  /** Slots filled when the conversation ends. */
  required_slots?: string[];
  /** What some of them hold, as the hand-over card shows it. */
  values?: Record<string, string>;
  /** Phrases no AI message may carry, beyond the workspace's own (AI-08). */
  forbidden_phrases?: string[];
  /** Risk flags the conversation must have raised (AI-27), and must not have. */
  must_flags?: RiskFlagType[];
  must_not_flags?: RiskFlagType[];
  /** The conversation ends within this many AI turns. */
  max_turns: number;
  /** The language every AI message is in; absent: the scenario's. */
  language?: string;
}

/** A value the player knows (05 § AI-19: `{ yontem: 'Papara', tutar: 2500 }`). */
export type AiTestFactValue = string | number | boolean;

/**
 * Why the AI said what it said on one turn (05 § AI-19 §8 "karar izi"): the
 * procedure and why, what it collected, which knowledge it used, which
 * guardrails fired, the hand-over and the flags, and what it cost.
 */
export interface AiTestTurnTrace {
  decision: AiDecision;
  procedure: { skill_id: string; name: string; reason: string } | null;
  slots: Record<string, string>;
  sources: Array<{ source_id: string; title: string; page: number | null }>;
  guardrails: Array<{ rule_key: string; action: string }>;
  handoff: { reason: string; topic: QueueTopicRole | null; team_id: number | null } | null;
  flags: RiskFlagType[];
  tokens: number;
}

/** One message of a played conversation; an AI message carries its trace. */
export interface AiTestTranscriptEntry {
  role: AiTestTranscriptRole;
  text: string;
  /** The frozen clock's moment, ISO 8601. */
  at: string;
  trace?: AiTestTurnTrace;
}

/** One hard check's verdict. */
export interface AiTestCheck {
  kind: AiTestCheckKind;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  /** Which message broke it, for `forbidden_phrase` / `sensitive_request` / `language`. */
  turn_index?: number;
  detail?: string;
}

/** The judge's advice (AI-19-S3, tm 314.3): a score and a comment, never a verdict. */
export interface AiTestJudgeVerdict {
  /** 1–5. */
  score: number;
  comment: string;
  criteria?: Record<string, number>;
}

// ---------------------------------------------------------------------------
// The validator — the API's request check and the editor's form check.
// ---------------------------------------------------------------------------

export const AI_TEST_PROBLEM_CODES = [
  'required',
  'invalid',
  'too_long',
  'too_many',
  'out_of_range',
  'not_allowed',
] as const;
export type AiTestProblemCode = (typeof AI_TEST_PROBLEM_CODES)[number];

/** One refused field; `field` is a path (`turns[2]`, `expectations.must_flags[0]`). */
export interface AiTestProblem {
  field: string;
  code: AiTestProblemCode;
}

type Fields = Readonly<Record<string, unknown>>;
type Report = (field: string, code: AiTestProblemCode) => void;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A moment with its offset: `2026-10-18T13:42:00+03:00`, `…Z`. */
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkText(report: Report, field: string, value: unknown, max: number): void {
  if (typeof value !== 'string' || value.trim() === '') report(field, 'required');
  else if (value.length > max) report(field, 'too_long');
}

function checkEnum(report: Report, field: string, value: unknown, list: readonly string[]): void {
  if (typeof value !== 'string' || !list.includes(value)) report(field, 'invalid');
}

/** A list of distinct non-empty strings, each passing `ok`. */
function checkList(
  report: Report,
  field: string,
  value: unknown,
  ok: (item: string) => boolean,
): void {
  if (!Array.isArray(value)) return report(field, 'invalid');
  if (value.length > AI_TEST_LIST_MAX) report(field, 'too_many');
  value.forEach((item, i) => {
    if (typeof item !== 'string' || item.trim() === '' || !ok(item))
      report(`${field}[${i}]`, 'invalid');
  });
}

/** Whether `value` is a moment the frozen clock can start from. */
export function isAiTestMoment(value: unknown): value is string {
  return typeof value === 'string' && MOMENT.test(value) && !Number.isNaN(Date.parse(value));
}

/** The problems of a scenario's `expectations`, paths under `expectations.`. */
export function validateAiTestExpectations(input: unknown): AiTestProblem[] {
  const problems: AiTestProblem[] = [];
  const at = (field: string) => (field ? `expectations.${field}` : 'expectations');
  const report: Report = (field, code) => void problems.push({ field: at(field), code });
  if (!isRecord(input)) return [{ field: 'expectations', code: 'invalid' }];
  const e = input;
  const known = new Set([
    'outcome',
    'team_id',
    'topic',
    'procedure_id',
    'reason_code',
    'required_slots',
    'values',
    'forbidden_phrases',
    'must_flags',
    'must_not_flags',
    'max_turns',
    'language',
  ]);
  for (const key of Object.keys(e)) if (!known.has(key)) report(key, 'not_allowed');

  if (e['outcome'] === undefined) report('outcome', 'required');
  else checkEnum(report, 'outcome', e['outcome'], SCENARIO_OUTCOMES);
  if (e['max_turns'] === undefined) report('max_turns', 'required');
  else if (typeof e['max_turns'] !== 'number' || !Number.isInteger(e['max_turns'])) {
    report('max_turns', 'invalid');
  } else if (e['max_turns'] < 1 || e['max_turns'] > AI_TEST_MAX_TURNS_LIMIT) {
    report('max_turns', 'out_of_range');
  }
  if (
    e['team_id'] !== undefined &&
    (typeof e['team_id'] !== 'number' || !Number.isSafeInteger(e['team_id']) || e['team_id'] < 1)
  ) {
    report('team_id', 'invalid');
  }
  if (e['topic'] !== undefined) checkEnum(report, 'topic', e['topic'], QUEUE_TOPIC_ROLES);
  if (e['procedure_id'] !== undefined) {
    if (typeof e['procedure_id'] !== 'string' || !UUID.test(e['procedure_id'])) {
      report('procedure_id', 'invalid');
    }
  }
  if (e['reason_code'] !== undefined) {
    if (typeof e['reason_code'] !== 'string' || !PROCEDURE_KEY_PATTERN.test(e['reason_code'])) {
      report('reason_code', 'invalid');
    }
  }
  // A hand-over's target and reason say nothing about a conversation that resolved.
  if (e['outcome'] !== 'handoff') {
    for (const key of ['team_id', 'topic', 'reason_code'] as const) {
      if (e[key] !== undefined) report(key, 'not_allowed');
    }
  }
  if (e['required_slots'] !== undefined) {
    checkList(report, 'required_slots', e['required_slots'], (s) => PROCEDURE_KEY_PATTERN.test(s));
  }
  if (e['values'] !== undefined) {
    const values = e['values'];
    if (!isRecord(values)) report('values', 'invalid');
    else {
      const keys = Object.keys(values);
      if (keys.length > AI_TEST_LIST_MAX) report('values', 'too_many');
      for (const key of keys) {
        const value = values[key];
        if (!PROCEDURE_KEY_PATTERN.test(key) || typeof value !== 'string' || value.trim() === '') {
          report(`values.${key}`, 'invalid');
        } else if (value.length > AI_TEST_FACT_TEXT_MAX) report(`values.${key}`, 'too_long');
      }
    }
  }
  if (e['forbidden_phrases'] !== undefined) {
    checkList(
      report,
      'forbidden_phrases',
      e['forbidden_phrases'],
      (s) => s.length <= AI_TEST_FACT_TEXT_MAX,
    );
  }
  const flags = RISK_FLAG_TYPES as readonly string[];
  for (const key of ['must_flags', 'must_not_flags'] as const) {
    if (e[key] !== undefined) checkList(report, key, e[key], (s) => flags.includes(s));
  }
  if (Array.isArray(e['must_flags']) && Array.isArray(e['must_not_flags'])) {
    const must = new Set(e['must_flags']);
    if ((e['must_not_flags'] as unknown[]).some((flag) => must.has(flag))) {
      report('must_not_flags', 'invalid');
    }
  }
  if (e['language'] !== undefined) {
    if (typeof e['language'] !== 'string' || !AI_TEST_LANG.test(e['language'])) {
      report('language', 'invalid');
    }
  }
  return problems;
}

/**
 * The problems of a scenario as written — the create body, or a whole row
 * after a change is merged over it. The editable fields only: `origin` is
 * the API's to set, `active` and `brand_id` are checked where they are read.
 */
export function validateAiTestScenario(input: unknown): AiTestProblem[] {
  const problems: AiTestProblem[] = [];
  const report: Report = (field, code) => void problems.push({ field, code });
  if (!isRecord(input)) return [{ field: '', code: 'invalid' }];
  const s = input;

  checkText(report, 'name', s['name'], AI_TEST_SCENARIO_NAME_MAX);
  checkEnum(report, 'mode', s['mode'], AI_TEST_SCENARIO_MODES);
  checkEnum(report, 'persona', s['persona'], SCENARIO_PERSONAS);
  if (typeof s['language'] !== 'string' || !AI_TEST_LANG.test(s['language'])) {
    report('language', 'invalid');
  }
  if (s['simulated_now'] !== undefined && s['simulated_now'] !== null) {
    if (!isAiTestMoment(s['simulated_now'])) report('simulated_now', 'invalid');
  }

  const turns = s['turns'];
  if (!Array.isArray(turns)) report('turns', 'invalid');
  else {
    if (turns.length > AI_TEST_SCENARIO_TURNS_MAX) report('turns', 'too_many');
    // A script is what the player says; a simulated player may open with a
    // line of its own or let the model start.
    if (s['mode'] === 'scripted' && turns.length === 0) report('turns', 'required');
    turns.forEach((turn, i) => {
      if (typeof turn !== 'string' || turn.trim() === '') report(`turns[${i}]`, 'required');
      else if (turn.length > AI_TEST_TURN_TEXT_MAX) report(`turns[${i}]`, 'too_long');
    });
  }

  const goal = s['goal'];
  if (s['mode'] === 'simulated') checkText(report, 'goal', goal, AI_TEST_SCENARIO_GOAL_MAX);
  else if (goal !== undefined && goal !== null) {
    checkText(report, 'goal', goal, AI_TEST_SCENARIO_GOAL_MAX);
  }

  const facts = s['facts'];
  if (!isRecord(facts)) report('facts', 'invalid');
  else {
    const keys = Object.keys(facts);
    if (keys.length > AI_TEST_FACTS_MAX) report('facts', 'too_many');
    for (const key of keys) {
      const value = facts[key];
      if (key.trim() === '' || key.length > 64) report(`facts.${key}`, 'invalid');
      else if (typeof value === 'string') {
        if (value.length > AI_TEST_FACT_TEXT_MAX) report(`facts.${key}`, 'too_long');
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) report(`facts.${key}`, 'invalid');
      } else if (typeof value !== 'boolean') report(`facts.${key}`, 'invalid');
    }
  }

  const tools = s['tool_outputs'];
  if (!isRecord(tools)) report('tool_outputs', 'invalid');
  else {
    const keys = Object.keys(tools);
    if (keys.length > AI_TEST_TOOL_OUTPUTS_MAX) report('tool_outputs', 'too_many');
    for (const key of keys) {
      if (!PROCEDURE_KEY_PATTERN.test(key) || !isRecord(tools[key])) {
        report(`tool_outputs.${key}`, 'invalid');
      }
    }
  }

  problems.push(...validateAiTestExpectations(s['expectations']));
  return problems;
}

/** The expectations a new scenario starts from. */
export function defaultAiTestExpectations(): AiTestExpectations {
  return { outcome: 'resolved', max_turns: AI_TEST_MAX_TURNS_DEFAULT };
}

/** Whether a result's `scenario_key` names a compliance-pack scenario. */
export function isComplianceScenarioKey(key: string): boolean {
  return key.startsWith(AI_COMPLIANCE_SCENARIO_KEY_PREFIX);
}
