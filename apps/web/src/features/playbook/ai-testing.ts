/**
 * The Test tab's data (tm 314.5 · AI-19): the wire shapes of `/ai/test-scenarios`,
 * `/ai/test-runs`, `/ai/compliance-pack` and `/ai/sandbox-sessions`, the query
 * keys they live under, and the scenario form — what the editor holds, how it
 * becomes a request body, and how a refusal's `details.problems` finds its field.
 *
 * The form is checked with the API's own validator (`validateAiTestScenario`,
 * `@siyahtus/types`), so the editor refuses exactly what the server would — a
 * borrowed, stricter check would block a Save the endpoint accepts.
 */
import {
  AI_TEST_MAX_TURNS_DEFAULT,
  AI_TEST_PROBLEM_CODES,
  validateAiTestScenario,
  type AiComplianceGateState,
  type AiTestCheck,
  type AiTestExpectations,
  type AiTestJudgeVerdict,
  type AiTestProblem,
  type AiTestProblemCode,
  type AiTestRegression,
  type AiTestResultStatus,
  type AiTestRunStatus,
  type AiTestRunTarget,
  type AiTestRunTrigger,
  type AiTestScenarioMode,
  type AiTestScenarioOrigin,
  type AiTestStopReason,
  type AiTestTranscriptEntry,
  type AiTestTurnTrace,
  type QueueTopicRole,
  type RiskFlagType,
  type ScenarioOutcome,
  type ScenarioPersona,
} from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';

// ---------------------------------------------------------------------------
// Wire shapes — `routes/ai-testing.ts`'s serialisers.
// ---------------------------------------------------------------------------

export type AiTestFacts = Record<string, string | number | boolean>;

export interface TestScenario {
  id: string;
  ai_agent_id: string;
  brand_id: string | null;
  name: string;
  mode: AiTestScenarioMode;
  persona: ScenarioPersona;
  language: string;
  simulated_now: string | null;
  goal: string | null;
  turns: string[];
  facts: AiTestFacts;
  tool_outputs: Record<string, Record<string, unknown>>;
  expectations: AiTestExpectations;
  active: boolean;
  origin: AiTestScenarioOrigin;
  origin_ref: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TestRun {
  id: string;
  ai_agent_id: string;
  target: AiTestRunTarget;
  config_version_id: string | null;
  draft_revision: number | null;
  trigger: AiTestRunTrigger;
  status: AiTestRunStatus;
  scenario_count: number;
  passed: number;
  failed: number;
  errored: number;
  tokens: number;
  compliance: { pack_version: string; passed: number; failed: number } | null;
  error: string | null;
  started_by: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface TestRunResult {
  id: string;
  run_id: string;
  scenario_id: string | null;
  scenario_key: string;
  scenario_name: string;
  status: AiTestResultStatus;
  stop_reason: AiTestStopReason;
  outcome: ScenarioOutcome | null;
  handoff_team_id: number | null;
  transcript: AiTestTranscriptEntry[];
  checks: AiTestCheck[];
  judge: AiTestJudgeVerdict | null;
  tokens: number;
  duration_ms: number;
  regression: AiTestRegression | null;
}

export interface TestRunResults {
  results: TestRunResult[];
  compared_run_id: string | null;
}

export interface CompliancePackScenario {
  key: string;
  guardrail: string;
  language: string;
  name: string;
  persona: ScenarioPersona;
  turns: string[];
  /** `outcome: null` — an output rule that holds whatever the ending (tm 314.4). */
  expectations: Omit<Partial<AiTestExpectations>, 'outcome'> & { outcome: ScenarioOutcome | null };
}

export interface CompliancePack {
  pack_version: string;
  scenarios: CompliancePackScenario[];
  gate: {
    state: AiComplianceGateState;
    open: boolean;
    run_id: string | null;
    run_pack_version: string | null;
    passed: number;
    failed: number;
    failing: string[];
    workspace_failed: number;
  };
}

export interface SandboxSession {
  id: string;
  ai_agent_id: string;
  target: AiTestRunTarget;
  config_version_id: string | null;
  transcript: AiTestTranscriptEntry[];
  tokens: number;
  created_at: string;
  expires_at: string;
}

export interface SandboxTurn {
  session: SandboxSession;
  reply: string | null;
  trace: AiTestTurnTrace;
}

// ---------------------------------------------------------------------------
// Query keys — under `playbook` so the page's own invalidation reaches them.
// ---------------------------------------------------------------------------

export const testingKeys = {
  all: (agentId: string) => ['playbook', 'ai-testing', agentId] as const,
  scenarios: (agentId: string) => ['playbook', 'ai-testing', agentId, 'scenarios'] as const,
  runs: (agentId: string) => ['playbook', 'ai-testing', agentId, 'runs'] as const,
  pack: (agentId: string) => ['playbook', 'ai-testing', agentId, 'pack'] as const,
  run: (runId: string) => ['playbook', 'ai-testing', 'run', runId] as const,
  results: (runId: string) => ['playbook', 'ai-testing', 'run', runId, 'results'] as const,
};

/** A run still under way, whose counts the screen keeps reading. */
export function isOpenRun(run: Pick<TestRun, 'status'>): boolean {
  return run.status === 'queued' || run.status === 'running';
}

/** How often an open run is read again. */
export const OPEN_RUN_POLL_MS = 2_000;

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

function isProblem(value: unknown): value is AiTestProblem {
  if (typeof value !== 'object' || value === null) return false;
  const problem = value as Record<string, unknown>;
  return (
    typeof problem['field'] === 'string' &&
    (AI_TEST_PROBLEM_CODES as readonly unknown[]).includes(problem['code'])
  );
}

/** The `{ field, code }` problems a 400 carries (`details.problems`), or none. */
export function problemsOf(error: unknown): AiTestProblem[] {
  if (!(error instanceof ApiClientError)) return [];
  const problems = error.details?.['problems'];
  return Array.isArray(problems) ? problems.filter(isProblem) : [];
}

/** The first problem at `field` or under it (`turns` answers for `turns[2]`). */
export function problemAt(
  problems: readonly AiTestProblem[],
  field: string,
): AiTestProblemCode | null {
  const found = problems.find(
    (p) => p.field === field || p.field.startsWith(`${field}[`) || p.field.startsWith(`${field}.`),
  );
  return found ? found.code : null;
}

// ---------------------------------------------------------------------------
// The scenario form.
// ---------------------------------------------------------------------------

export interface KeyValueRow {
  key: string;
  value: string;
}

/** What the editor holds — strings where an input does, parsed on Save. */
export interface ScenarioForm {
  name: string;
  mode: AiTestScenarioMode;
  persona: ScenarioPersona;
  language: string;
  /** `datetime-local` text, in the browser's time zone; '' — the run's own clock. */
  simulatedNow: string;
  goal: string;
  turns: string[];
  facts: KeyValueRow[];
  /** `tool_outputs` as JSON text (AI-28) — an advanced field, read whole. */
  toolOutputs: string;
  active: boolean;
  outcome: ScenarioOutcome;
  maxTurns: string;
  /** '' — any team. */
  teamId: string;
  topic: QueueTopicRole | '';
  procedureId: string;
  reasonCode: string;
  /** One slot name per line. */
  requiredSlots: string;
  values: KeyValueRow[];
  /** One phrase per line. */
  forbiddenPhrases: string;
  mustFlags: RiskFlagType[];
  mustNotFlags: RiskFlagType[];
  /** '' — the scenario's language. */
  expectLanguage: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** An ISO moment as `datetime-local` text in the browser's zone. */
export function localMomentOf(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** `datetime-local` text as an ISO moment with its offset (`…Z`), or null. */
export function isoMomentOf(local: string): string | null {
  if (local.trim() === '') return null;
  const date = new Date(local);
  return Number.isNaN(date.getTime()) ? local : date.toISOString();
}

function rowsOf(record: Record<string, unknown> | undefined): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([key, value]) => ({ key, value: String(value) }));
}

function linesOf(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** A fact as the player knows it: a number or a yes/no where it reads as one. */
export function factValueOf(text: string): string | number | boolean {
  const trimmed = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  return text;
}

/** The form a scenario opens in; a new one starts scripted, with one empty line. */
export function scenarioFormOf(scenario: TestScenario | null, language = 'tr'): ScenarioForm {
  const e = scenario?.expectations;
  return {
    name: scenario?.name ?? '',
    mode: scenario?.mode ?? 'scripted',
    persona: scenario?.persona ?? 'normal',
    language: scenario?.language ?? language,
    simulatedNow: localMomentOf(scenario?.simulated_now ?? null),
    goal: scenario?.goal ?? '',
    turns: scenario ? [...scenario.turns] : [''],
    facts: rowsOf(scenario?.facts),
    toolOutputs:
      scenario && Object.keys(scenario.tool_outputs).length > 0
        ? JSON.stringify(scenario.tool_outputs, null, 2)
        : '',
    active: scenario?.active ?? true,
    outcome: e?.outcome ?? 'resolved',
    maxTurns: String(e?.max_turns ?? AI_TEST_MAX_TURNS_DEFAULT),
    teamId: e?.team_id !== undefined ? String(e.team_id) : '',
    topic: e?.topic ?? '',
    procedureId: e?.procedure_id ?? '',
    reasonCode: e?.reason_code ?? '',
    requiredSlots: (e?.required_slots ?? []).join('\n'),
    values: rowsOf(e?.values),
    forbiddenPhrases: (e?.forbidden_phrases ?? []).join('\n'),
    mustFlags: [...(e?.must_flags ?? [])],
    mustNotFlags: [...(e?.must_not_flags ?? [])],
    expectLanguage: e?.language ?? '',
  };
}

/** The expectations the form says; a hand-over's own fields only with a hand-over. */
export function expectationsOf(form: ScenarioForm): Record<string, unknown> {
  const handoff = form.outcome === 'handoff';
  const slots = linesOf(form.requiredSlots);
  const phrases = linesOf(form.forbiddenPhrases);
  const values = form.values.filter((row) => row.key.trim() !== '');
  const maxTurns = form.maxTurns.trim() === '' ? Number.NaN : Number(form.maxTurns);
  return {
    outcome: form.outcome,
    max_turns: Number.isNaN(maxTurns) ? form.maxTurns : maxTurns,
    ...(handoff && form.teamId !== '' ? { team_id: Number(form.teamId) } : {}),
    ...(handoff && form.topic !== '' ? { topic: form.topic } : {}),
    ...(handoff && form.reasonCode.trim() !== '' ? { reason_code: form.reasonCode.trim() } : {}),
    ...(form.procedureId !== '' ? { procedure_id: form.procedureId } : {}),
    ...(slots.length > 0 ? { required_slots: slots } : {}),
    ...(values.length > 0
      ? { values: Object.fromEntries(values.map((row) => [row.key.trim(), row.value])) }
      : {}),
    ...(phrases.length > 0 ? { forbidden_phrases: phrases } : {}),
    ...(form.mustFlags.length > 0 ? { must_flags: form.mustFlags } : {}),
    ...(form.mustNotFlags.length > 0 ? { must_not_flags: form.mustNotFlags } : {}),
    ...(form.expectLanguage.trim() !== '' ? { language: form.expectLanguage.trim() } : {}),
  };
}

/**
 * The request body the form says, and what the API's validator would refuse
 * in it. A simulated scenario keeps its opening lines only if it has any; a
 * blank line in a script is a problem the author sees, not one dropped quietly.
 */
export function scenarioBody(form: ScenarioForm): {
  body: Record<string, unknown>;
  problems: AiTestProblem[];
} {
  const problems: AiTestProblem[] = [];
  let toolOutputs: unknown = {};
  if (form.toolOutputs.trim() !== '') {
    try {
      toolOutputs = JSON.parse(form.toolOutputs);
    } catch {
      problems.push({ field: 'tool_outputs', code: 'invalid' });
    }
  }
  const turns =
    form.mode === 'simulated' ? form.turns.filter((turn) => turn.trim() !== '') : form.turns;
  const goal = form.goal.trim();
  const body: Record<string, unknown> = {
    name: form.name.trim(),
    mode: form.mode,
    persona: form.persona,
    language: form.language.trim(),
    simulated_now: isoMomentOf(form.simulatedNow),
    goal: goal === '' ? null : goal,
    turns,
    facts: Object.fromEntries(
      form.facts
        .filter((row) => row.key.trim() !== '')
        .map((row) => [row.key.trim(), factValueOf(row.value)]),
    ),
    tool_outputs: problems.length > 0 ? {} : toolOutputs,
    expectations: expectationsOf(form),
    active: form.active,
  };
  return { body, problems: [...problems, ...validateAiTestScenario(body)] };
}
