/**
 * The AI test bench (tm 314.2 · SiyahTuş analysis AI-19 · `paths/ai-testing.yaml`):
 * scenarios, runs and "talk like a player".
 *
 *   - `GET|POST /ai/test-scenarios`, `GET|PATCH|DELETE /ai/test-scenarios/{id}`
 *     — one AI agent's scenarios, every brand's. A scenario is synthetic by
 *     rule: the player's words, the goal, the facts and the expected values are
 *     masked (AI-26) before they are stored, and `validateAiTestScenario` — the
 *     editor's check too — refuses a malformed one with `details.problems`.
 *   - `POST /ai/test-runs` queues a run against the draft or the published
 *     configuration and answers 202; the worker plays it
 *     (`services/ai/simulation/run-worker.ts`). A named version is tm 316's:
 *     none exists yet, so none is found. One open run per agent and target
 *     (409 `ai_test_run_in_progress`), at most 200 scenarios, and today's test
 *     allowance spent is 429 on the test meter (`aiBudget: 'simulation'`) —
 *     never on the live one. `GET /ai/test-runs`, `…/{id}` and `…/{id}/results`
 *     read them back; the regression against the previous published version
 *     (`regression`, `compared_run_id`) is tm 314.3's and null here.
 *   - `POST /ai/sandbox-sessions`, `GET …/{id}`, `POST …/{id}/turns`,
 *     `POST …/{id}/save-as-scenario` — one person's conversation with the AI on
 *     the live engine; each reply comes with its decision trace, and the
 *     session lives 24 hours past its last turn (`AI_SANDBOX_SESSION_TTL_HOURS`)
 *     and takes at most `AI_SANDBOX_MESSAGES_MAX` messages.
 *
 * Who: whoever configures the AI (`agents-bot--all:rw` writes, `:ro` reads) —
 * owners and admins in the default matrix; an agent has neither, so the Test
 * tab is not theirs ("Ekip Üyesi varsayılan göremez"). A sandbox session is
 * its starter's alone: anyone else's is 404.
 *
 * None of this writes a conversation. A run's turns and a sandbox turn are
 * played inside the simulation context (`lib/simulation-context.ts`); what
 * these routes write is the test bench's own tables, after the turn.
 */
import type { AiSandboxSession, AiTestRun, AiTestRunResult, AiTestScenario } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  AI_SANDBOX_MESSAGES_MAX,
  AI_SANDBOX_SESSION_TTL_HOURS,
  AI_TEST_MAX_TURNS_LIMIT,
  AI_TEST_RUN_SCENARIOS_MAX,
  AI_TEST_RUN_TARGETS,
  AI_TEST_SCENARIO_NAME_MAX,
  AI_TEST_SCENARIO_TURNS_MAX,
  AI_TEST_TURN_TEXT_MAX,
  PROCEDURE_KEY_PATTERN,
  detectLanguage,
  isRiskFlagType,
  validateAiTestExpectations,
  validateAiTestScenario,
  type AiTestExpectations,
  type AiTestProblem,
  type AiTestTranscriptEntry,
  type RiskFlagType,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import { maskDeep, maskSensitive } from '../lib/sensitive-mask.js';
import type { TenantClient } from '../lib/tenant.js';
import {
  TURN_STATE_FIELDS,
  emptyTurnState,
  tookTurn,
  type TurnState,
} from '../services/ai/conversation/turn.js';
import { readSimulationSetting } from '../services/ai/simulation/runner.js';
import { isOpenRunConflict, testRunInProgress } from '../services/ai/simulation/test-runs.js';
import { turnTokens } from '../services/ai/simulation/trace.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();
const SESSION_TTL_MS = AI_SANDBOX_SESSION_TTL_HOURS * 60 * 60 * 1000;

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

const listScenariosQuery = z.object({
  ai_agent_id: uuid,
  active: z.enum(['true', 'false']).optional(),
});

const listRunsQuery = z.object({
  ai_agent_id: uuid,
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const runBody = z
  .object({
    ai_agent_id: uuid,
    target: z.enum(AI_TEST_RUN_TARGETS),
    config_version_id: uuid.optional(),
    scenario_ids: z
      .array(uuid)
      .min(1)
      .max(AI_TEST_RUN_SCENARIOS_MAX)
      .refine((ids) => new Set(ids).size === ids.length, 'must not repeat a scenario')
      .optional(),
  })
  .strict();

const sessionBody = z
  .object({
    ai_agent_id: uuid,
    target: z.enum(AI_TEST_RUN_TARGETS).default('draft'),
    config_version_id: uuid.optional(),
  })
  .strict();

const turnBody = z.object({ message: z.string().min(1).max(AI_TEST_TURN_TEXT_MAX) }).strict();

const saveBody = z
  .object({
    name: z.string().min(1).max(AI_TEST_SCENARIO_NAME_MAX),
    expectations: z.unknown().optional(),
  })
  .strict();

/** The scenario fields a body may write; `ai_agent_id` only on create. */
const SCENARIO_FIELDS = [
  'brand_id',
  'name',
  'mode',
  'persona',
  'language',
  'simulated_now',
  'goal',
  'turns',
  'facts',
  'tool_outputs',
  'expectations',
  'active',
] as const;
type ScenarioField = (typeof SCENARIO_FIELDS)[number];
type ScenarioFields = Partial<Record<ScenarioField, unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 400 `validation` with the problems, `{ field, code }`, the editor shows by its fields. */
function refused(problems: readonly AiTestProblem[]): ApiError {
  return ApiError.validation(
    `The scenario was refused: ${problems.map((p) => `${p.field || 'body'} ${p.code}`).join(', ')}.`,
    { problems },
  );
}

/** The fields the shared validator does not read: unknown keys, the brand, the switch. */
function fieldProblems(body: Record<string, unknown>, allowed: readonly string[]): AiTestProblem[] {
  const problems: AiTestProblem[] = [];
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) problems.push({ field: key, code: 'not_allowed' });
  }
  const brand = body['brand_id'];
  if (brand !== undefined && brand !== null && (typeof brand !== 'string' || !UUID.test(brand))) {
    problems.push({ field: 'brand_id', code: 'invalid' });
  }
  if (body['active'] !== undefined && typeof body['active'] !== 'boolean') {
    problems.push({ field: 'active', code: 'invalid' });
  }
  return problems;
}

/**
 * What the scenario stores of the player's side, masked like a visitor's
 * message (AI-26): its lines, its goal, its facts and the slot values it
 * expects — the last so a masked line and its expectation still read alike.
 */
function maskedScenario(fields: ScenarioFields): ScenarioFields {
  const out: ScenarioFields = { ...fields };
  if (Array.isArray(out.turns)) out.turns = maskDeep(out.turns, 'customer');
  if (typeof out.goal === 'string') out.goal = maskSensitive(out.goal, { author: 'customer' }).text;
  if (isRecord(out.facts)) out.facts = maskDeep(out.facts, 'customer');
  if (isRecord(out.expectations) && isRecord(out.expectations['values'])) {
    out.expectations = {
      ...out.expectations,
      values: maskDeep(out.expectations['values'], 'customer'),
    };
  }
  return out;
}

/** A scenario's fields as the API names them, from its row. */
function scenarioFieldsOf(row: AiTestScenario): Required<ScenarioFields> {
  return {
    brand_id: row.brandId,
    name: row.name,
    mode: row.mode,
    persona: row.persona,
    language: row.language,
    simulated_now: row.simulatedNow?.toISOString() ?? null,
    goal: row.goal,
    turns: row.turns,
    facts: row.facts,
    tool_outputs: row.toolOutputs,
    expectations: row.expectations,
    active: row.active,
  };
}

/** The fields as Prisma writes them. Validated already. */
function scenarioData(fields: Required<ScenarioFields>) {
  return {
    brandId: (fields.brand_id as string | null) ?? null,
    name: (fields.name as string).trim(),
    mode: fields.mode as string,
    persona: fields.persona as string,
    language: fields.language as string,
    simulatedNow:
      fields.simulated_now === null || fields.simulated_now === undefined
        ? null
        : new Date(fields.simulated_now as string),
    goal: typeof fields.goal === 'string' ? fields.goal.trim() : null,
    turns: fields.turns as string[],
    facts: fields.facts as object,
    toolOutputs: fields.tool_outputs as object,
    expectations: fields.expectations as object,
    active: fields.active as boolean,
  };
}

function serialiseScenario(row: AiTestScenario) {
  return {
    id: row.id,
    ai_agent_id: row.aiAgentId,
    ...scenarioFieldsOf(row),
    origin: row.origin,
    origin_ref: row.originRef,
    created_by: row.createdBy,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function serialiseRun(row: AiTestRun) {
  return {
    id: row.id,
    ai_agent_id: row.aiAgentId,
    target: row.configTarget,
    config_version_id: row.configVersionId,
    draft_revision: row.draftRevision,
    trigger: row.trigger,
    status: row.status,
    scenario_count: row.scenarioCount,
    passed: row.passed,
    failed: row.failed,
    errored: row.errored,
    tokens: Number(row.tokens),
    compliance:
      row.compliancePackVersion !== null
        ? {
            pack_version: row.compliancePackVersion,
            passed: row.compliancePassed ?? 0,
            failed: row.complianceFailed ?? 0,
          }
        : null,
    error: row.error,
    started_by: row.startedBy,
    created_at: row.createdAt.toISOString(),
    started_at: row.startedAt?.toISOString() ?? null,
    finished_at: row.finishedAt?.toISOString() ?? null,
  };
}

function serialiseResult(row: AiTestRunResult) {
  return {
    id: row.id,
    run_id: row.runId,
    scenario_id: row.scenarioId,
    scenario_key: row.scenarioKey,
    scenario_name: row.scenarioName,
    status: row.status,
    stop_reason: row.stopReason,
    outcome: row.outcome,
    handoff_team_id: row.handoffTeamId === null ? null : Number(row.handoffTeamId),
    transcript: row.transcript,
    checks: row.checks,
    judge: row.judge,
    tokens: row.tokens,
    duration_ms: row.durationMs,
    // Against the previous published version's last run: tm 314.3.
    regression: null,
  };
}

function serialiseSession(row: AiSandboxSession) {
  return {
    id: row.id,
    ai_agent_id: row.aiAgentId,
    target: row.configTarget,
    config_version_id: row.configVersionId,
    transcript: row.transcript,
    tokens: row.tokens,
    created_at: row.createdAt.toISOString(),
    expires_at: row.expiresAt.toISOString(),
  };
}

/** Failed and errored first — what a person opens the results for — then in play order. */
const RESULT_ORDER: Readonly<Record<string, number>> = { failed: 0, errored: 1, passed: 2 };

/** The customer-facing AI agent named, or 404 — a Copilot record is no scenario's. */
async function requireAgent(tx: TenantClient, aiAgentId: string): Promise<void> {
  const agent = await tx.aiAgent.findFirst({
    where: { id: aiAgentId, kind: 'ai_agent' },
    select: { id: true },
  });
  if (!agent) throw ApiError.notFound('AI agent not found.');
}

async function requireBrand(tx: TenantClient, brandId: unknown): Promise<void> {
  if (typeof brandId !== 'string') return;
  const brand = await tx.brand.findFirst({ where: { id: brandId }, select: { id: true } });
  if (!brand) throw new ApiError('brand_not_found', 'Brand not found.');
}

/** A named version is tm 316's: none exists, so none is found. */
function versionNotFound(): ApiError {
  return ApiError.notFound(
    'Configuration version not found — versions arrive with publishing (tm 316).',
  );
}

/** `config_version_id` exactly when the target is `version`. */
function checkTarget(target: string, versionId: string | undefined): void {
  if ((target === 'version') !== (versionId !== undefined)) {
    throw ApiError.validation('config_version_id is required with target version, and only then.');
  }
  if (target === 'version') throw versionNotFound();
}

function accountOf(request: FastifyRequest): string | null {
  const principal = request.requirePrincipal();
  return principal.kind === 'agent' ? principal.accountId : null;
}

/** A session's stored state as a turn reads it; anything else is a fresh conversation's. */
function readTurnState(raw: unknown): TurnState {
  const state = emptyTurnState() as Record<string, unknown>;
  if (isRecord(raw)) {
    for (const field of TURN_STATE_FIELDS) if (field in raw) state[field] = raw[field];
  }
  return state as unknown as TurnState;
}

function readTranscript(raw: unknown): AiTestTranscriptEntry[] {
  return Array.isArray(raw) ? (raw as AiTestTranscriptEntry[]) : [];
}

/** The flags the conversation's turns raised so far (AI-27): they hold for the next. */
function raisedFlags(transcript: readonly AiTestTranscriptEntry[]): Set<RiskFlagType> {
  const raised = new Set<RiskFlagType>();
  for (const entry of transcript) {
    for (const flag of entry.trace?.flags ?? []) if (isRiskFlagType(flag)) raised.add(flag);
  }
  return raised;
}

/**
 * What a saved session should be held to, from how it went (AI-19 §8 "beklentiler
 * son durumdan önerilir"): the first hand-over and where it went, or the
 * summary's resolution; the procedure that answered last, the slots it had
 * settled, and the AI turns it took. A person edits them before trusting them.
 */
function suggestedExpectations(
  transcript: readonly AiTestTranscriptEntry[],
  state: TurnState,
): AiTestExpectations {
  const traced = transcript.flatMap((entry) =>
    entry.role === 'ai' && entry.trace ? [entry.trace] : [],
  );
  const ended = traced.findIndex((trace) => trace.decision === 'handoff');
  const taken = ended === -1 ? traced : traced.slice(0, ended + 1);
  const last = taken[taken.length - 1];
  const maxTurns = Math.min(AI_TEST_MAX_TURNS_LIMIT, Math.max(1, taken.length));
  const digest = isRecord(state.digest) ? state.digest : null;
  const base: AiTestExpectations =
    ended !== -1
      ? { outcome: 'handoff', max_turns: maxTurns }
      : {
          outcome: digest?.['outcome'] === 'resolved_waiting' ? 'resolved_waiting' : 'resolved',
          max_turns: maxTurns,
        };
  const handoff = ended !== -1 ? traced[ended]!.handoff : null;
  const slots = Object.keys(last?.slots ?? {})
    .filter((name) => PROCEDURE_KEY_PATTERN.test(name))
    .slice(0, 30);
  const suggested: AiTestExpectations = {
    ...base,
    ...(handoff?.team_id ? { team_id: handoff.team_id } : {}),
    ...(handoff?.topic ? { topic: handoff.topic } : {}),
    ...(handoff && PROCEDURE_KEY_PATTERN.test(handoff.reason)
      ? { reason_code: handoff.reason }
      : {}),
    ...(last?.procedure && UUID.test(last.procedure.skill_id)
      ? { procedure_id: last.procedure.skill_id }
      : {}),
    ...(slots.length > 0 ? { required_slots: slots } : {}),
  };
  return validateAiTestExpectations(suggested).length === 0 ? suggested : base;
}

export default async function aiTestingRoutes(app: FastifyInstance): Promise<void> {
  // ------------------------------------------------------------------ scenarios

  app.get('/ai/test-scenarios', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(listScenariosQuery, request.query);
    const rows = await request.withTenant((tx) =>
      tx.aiTestScenario.findMany({
        where: {
          aiAgentId: query.ai_agent_id,
          ...(query.active !== undefined ? { active: query.active === 'true' } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
    return reply.send({ scenarios: rows.map(serialiseScenario) });
  });

  app.post('/ai/test-scenarios', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = request.body;
    if (!isRecord(body)) throw refused([{ field: '', code: 'invalid' }]);
    const aiAgentId = body['ai_agent_id'];
    if (typeof aiAgentId !== 'string' || !UUID.test(aiAgentId)) {
      throw refused([{ field: 'ai_agent_id', code: 'invalid' }]);
    }
    const { ai_agent_id: _agent, ...rest } = body;
    const fields: Required<ScenarioFields> = {
      brand_id: null,
      mode: 'scripted',
      persona: 'normal',
      language: 'tr',
      simulated_now: null,
      goal: null,
      turns: [],
      facts: {},
      tool_outputs: {},
      active: true,
      name: undefined,
      expectations: undefined,
      ...(rest as ScenarioFields),
    };
    const problems = [...fieldProblems(rest, SCENARIO_FIELDS), ...validateAiTestScenario(fields)];
    if (problems.length > 0) throw refused(problems);
    const account = accountOf(request);
    const row = await request.withTenant(async (tx) => {
      await requireAgent(tx, aiAgentId);
      await requireBrand(tx, fields.brand_id);
      const now = new Date();
      return tx.aiTestScenario.create({
        data: {
          licenseId: request.tenant().licenseId,
          aiAgentId,
          origin: 'manual',
          ...scenarioData(maskedScenario(fields) as Required<ScenarioFields>),
          createdBy: account,
          updatedBy: account,
          createdAt: now,
          updatedAt: now,
        },
      });
    });
    return reply.code(201).send(serialiseScenario(row));
  });

  app.get<{ Params: { scenarioId: string } }>(
    '/ai/test-scenarios/:scenarioId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const scenarioId = parse(uuid, request.params.scenarioId);
      const row = await request.withTenant((tx) =>
        tx.aiTestScenario.findFirst({ where: { id: scenarioId } }),
      );
      if (!row) throw ApiError.notFound('Scenario not found.');
      return reply.send(serialiseScenario(row));
    },
  );

  app.patch<{ Params: { scenarioId: string } }>(
    '/ai/test-scenarios/:scenarioId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const scenarioId = parse(uuid, request.params.scenarioId);
      const body = request.body;
      if (!isRecord(body) || Object.keys(body).length === 0) {
        throw refused([{ field: '', code: 'required' }]);
      }
      const own = fieldProblems(body, SCENARIO_FIELDS);
      if (own.length > 0) throw refused(own);
      const account = accountOf(request);
      const row = await request.withTenant(async (tx) => {
        const current = await tx.aiTestScenario.findFirst({ where: { id: scenarioId } });
        if (!current) throw ApiError.notFound('Scenario not found.');
        // The change is merged over the scenario and the result judged whole.
        const merged = { ...scenarioFieldsOf(current), ...(body as ScenarioFields) };
        const problems = validateAiTestScenario(merged);
        if (problems.length > 0) throw refused(problems);
        if ('brand_id' in body) await requireBrand(tx, merged.brand_id);
        return tx.aiTestScenario.update({
          where: { id: scenarioId },
          data: {
            ...scenarioData(maskedScenario(merged) as Required<ScenarioFields>),
            updatedBy: account,
            updatedAt: new Date(),
          },
        });
      });
      return reply.send(serialiseScenario(row));
    },
  );

  app.delete<{ Params: { scenarioId: string } }>(
    '/ai/test-scenarios/:scenarioId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const scenarioId = parse(uuid, request.params.scenarioId);
      // Its results keep their key and name (`scenario_id` goes null).
      const { count } = await request.withTenant((tx) =>
        tx.aiTestScenario.deleteMany({ where: { id: scenarioId } }),
      );
      if (count === 0) throw ApiError.notFound('Scenario not found.');
      return reply.code(204).send();
    },
  );

  // ----------------------------------------------------------------------- runs

  app.get('/ai/test-runs', { config: { scopes: READ } }, async (request, reply) => {
    const query = parse(listRunsQuery, request.query);
    const rows = await request.withTenant((tx) =>
      tx.aiTestRun.findMany({
        where: { aiAgentId: query.ai_agent_id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit,
      }),
    );
    return reply.send({ runs: rows.map(serialiseRun) });
  });

  app.post(
    '/ai/test-runs',
    { config: { scopes: WRITE, aiInference: true, aiBudget: 'simulation' } },
    async (request, reply) => {
      const body = parse(runBody, request.body);
      const account = accountOf(request);
      const row = await request.withTenant(async (tx) => {
        await requireAgent(tx, body.ai_agent_id);
        checkTarget(body.target, body.config_version_id);
        let scenarioIds: string[];
        if (body.scenario_ids) {
          const found = await tx.aiTestScenario.findMany({
            where: { id: { in: body.scenario_ids }, aiAgentId: body.ai_agent_id },
            select: { id: true },
          });
          if (found.length !== body.scenario_ids.length)
            throw ApiError.notFound('Scenario not found.');
          scenarioIds = body.scenario_ids;
        } else {
          const active = await tx.aiTestScenario.findMany({
            where: { aiAgentId: body.ai_agent_id, active: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            take: AI_TEST_RUN_SCENARIOS_MAX + 1,
            select: { id: true },
          });
          if (active.length > AI_TEST_RUN_SCENARIOS_MAX) {
            throw ApiError.validation(
              `A run plays at most ${AI_TEST_RUN_SCENARIOS_MAX} scenarios; name the ones to play.`,
              { problems: [{ field: 'scenario_ids', code: 'too_many' }] },
            );
          }
          scenarioIds = active.map((scenario) => scenario.id);
        }
        if (scenarioIds.length === 0) {
          throw ApiError.validation('There is no active scenario to play.', {
            problems: [{ field: 'scenario_ids', code: 'required' }],
          });
        }
        try {
          return await tx.aiTestRun.create({
            data: {
              licenseId: request.tenant().licenseId,
              aiAgentId: body.ai_agent_id,
              configTarget: body.target,
              trigger: 'manual',
              status: 'queued',
              scenarioCount: scenarioIds.length,
              scenarioIds,
              startedBy: account,
            },
          });
        } catch (error) {
          if (isOpenRunConflict(error)) throw testRunInProgress();
          throw error;
        }
      });
      // Committed: the worker may take it now — this process's, or any other's.
      app.aiTestRuns.wake();
      return reply.code(202).send(serialiseRun(row));
    },
  );

  app.get<{ Params: { runId: string } }>(
    '/ai/test-runs/:runId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const runId = parse(uuid, request.params.runId);
      const row = await request.withTenant((tx) =>
        tx.aiTestRun.findFirst({ where: { id: runId } }),
      );
      if (!row) throw ApiError.notFound('Test run not found.');
      return reply.send(serialiseRun(row));
    },
  );

  app.get<{ Params: { runId: string } }>(
    '/ai/test-runs/:runId/results',
    { config: { scopes: READ } },
    async (request, reply) => {
      const runId = parse(uuid, request.params.runId);
      const { run, results } = await request.withTenant(async (tx) => ({
        run: await tx.aiTestRun.findFirst({ where: { id: runId }, select: { scenarioIds: true } }),
        results: await tx.aiTestRunResult.findMany({ where: { runId } }),
      }));
      if (!run) throw ApiError.notFound('Test run not found.');
      const order = new Map(run.scenarioIds.map((id, index) => [id, index]));
      const sorted = [...results].sort(
        (a, b) =>
          (RESULT_ORDER[a.status] ?? 3) - (RESULT_ORDER[b.status] ?? 3) ||
          (order.get(a.scenarioKey) ?? order.size) - (order.get(b.scenarioKey) ?? order.size) ||
          a.scenarioKey.localeCompare(b.scenarioKey),
      );
      return reply.send({ results: sorted.map(serialiseResult), compared_run_id: null });
    },
  );

  // ------------------------------------------------------------ sandbox sessions

  /** The caller's own session, while it lives — anyone else's is 404. */
  async function ownSession(tx: TenantClient, request: FastifyRequest, sessionId: string) {
    const account = accountOf(request);
    const row = account
      ? await tx.aiSandboxSession.findFirst({
          where: { id: sessionId, createdBy: account, expiresAt: { gt: new Date() } },
        })
      : null;
    if (!row) throw ApiError.notFound('Sandbox session not found.');
    return row;
  }

  app.post('/ai/sandbox-sessions', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(sessionBody, request.body);
    const account = accountOf(request);
    if (!account) throw ApiError.authorization('A sandbox session is a person’s: sign in as one.');
    const row = await request.withTenant(async (tx) => {
      await requireAgent(tx, body.ai_agent_id);
      checkTarget(body.target, body.config_version_id);
      const now = new Date();
      return tx.aiSandboxSession.create({
        data: {
          licenseId: request.tenant().licenseId,
          aiAgentId: body.ai_agent_id,
          configTarget: body.target,
          state: emptyTurnState() as unknown as object,
          transcript: [],
          createdBy: account,
          createdAt: now,
          updatedAt: now,
          expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
        },
      });
    });
    return reply.code(201).send(serialiseSession(row));
  });

  app.get<{ Params: { sessionId: string } }>(
    '/ai/sandbox-sessions/:sessionId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const sessionId = parse(uuid, request.params.sessionId);
      const row = await request.withTenant((tx) => ownSession(tx, request, sessionId));
      return reply.send(serialiseSession(row));
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/ai/sandbox-sessions/:sessionId/turns',
    { config: { scopes: WRITE, aiInference: true, aiBudget: 'simulation' } },
    async (request, reply) => {
      const sessionId = parse(uuid, request.params.sessionId);
      const body = parse(turnBody, request.body);
      // The person's words as a visitor's reach a turn: masked (AI-26).
      const text = maskSensitive(body.message.trim(), { author: 'customer' }).text.slice(
        0,
        AI_TEST_TURN_TEXT_MAX,
      );
      if (text === '') throw ApiError.validation('message: must not be blank');
      const tenant = request.tenant();
      const { session, setting } = await request.withTenant(async (tx) => {
        const session = await ownSession(tx, request, sessionId);
        // Refused before the turn, which would cost the test meter for nothing.
        const said = readTranscript(session.transcript).filter((entry) => entry.role === 'player');
        if (said.length >= AI_SANDBOX_MESSAGES_MAX) {
          throw ApiError.validation(
            `A sandbox session takes at most ${AI_SANDBOX_MESSAGES_MAX} messages; start another.`,
            { problems: [{ field: 'message', code: 'too_many' }] },
          );
        }
        const target = session.configTarget === 'published' ? 'published' : 'draft';
        const workspace = { licenseId: tenant.licenseId, organizationId: tenant.organizationId };
        return {
          session,
          setting: await readSimulationSetting(tx, workspace, {
            aiAgentId: session.aiAgentId,
            target,
          }),
        };
      });
      const transcript = readTranscript(session.transcript);
      const at = new Date();
      const turn = await app.aiSimulation.turn(setting, {
        state: readTurnState(session.state),
        transcript,
        text,
        at,
        // The brand the console works under, as a preview's (TurnContext.brandId).
        brandId: tenant.brandId ?? null,
        toolStubs: {},
        raised: raisedFlags(transcript),
      });
      const { result, trace } = turn;
      // A turn the allowance or the model stopped is no turn: nothing is kept.
      if (result.decisions.capped) throw result.decisions.capped;
      const failure = result.decisions.failure;
      if (failure) {
        throw new ApiError(
          'service_unavailable',
          `The AI could not answer: the ${failure.provider} provider failed (${failure.kind}). Nothing was kept — try again in a moment.`,
          { details: { kind: failure.kind, provider: failure.provider } },
        );
      }
      const moment = at.toISOString();
      const next: AiTestTranscriptEntry[] = [
        ...transcript,
        { role: 'player', text, at: moment },
        ...(tookTurn(result)
          ? [{ role: 'ai' as const, text: result.reply ?? '', at: moment, trace }]
          : []),
      ];
      const saved = await request.withTenant(async (tx) => {
        const now = new Date();
        // The session as this turn read it: one saved meanwhile wins.
        const { count } = await tx.aiSandboxSession.updateMany({
          where: { id: session.id, updatedAt: session.updatedAt },
          data: {
            state: result.nextState as unknown as object,
            transcript: next as unknown as object,
            tokens: { increment: turnTokens(result) },
            updatedAt: now,
            expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
          },
        });
        if (count === 0) {
          throw new ApiError(
            'too_many_requests',
            'This session answered another message meanwhile — send yours again.',
          );
        }
        return tx.aiSandboxSession.findFirstOrThrow({ where: { id: session.id } });
      });
      return reply.send({ session: serialiseSession(saved), reply: result.reply, trace });
    },
  );

  app.post<{ Params: { sessionId: string } }>(
    '/ai/sandbox-sessions/:sessionId/save-as-scenario',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const sessionId = parse(uuid, request.params.sessionId);
      const body = parse(saveBody, request.body);
      const account = accountOf(request);
      const row = await request.withTenant(async (tx) => {
        const session = await ownSession(tx, request, sessionId);
        const transcript = readTranscript(session.transcript);
        const turns = transcript.flatMap((entry) => (entry.role === 'player' ? [entry.text] : []));
        if (turns.length === 0) throw refused([{ field: 'turns', code: 'required' }]);
        if (turns.length > AI_TEST_SCENARIO_TURNS_MAX) {
          throw refused([{ field: 'turns', code: 'too_many' }]);
        }
        const expectations =
          body.expectations ?? suggestedExpectations(transcript, readTurnState(session.state));
        const fields: Required<ScenarioFields> = {
          brand_id: null,
          name: body.name,
          mode: 'scripted',
          persona: 'normal',
          language: detectLanguage(turns.join('\n')) ?? 'tr',
          simulated_now: null,
          goal: null,
          turns,
          facts: {},
          tool_outputs: {},
          expectations,
          active: true,
        };
        const problems = validateAiTestScenario(fields);
        if (problems.length > 0) throw refused(problems);
        const now = new Date();
        return tx.aiTestScenario.create({
          data: {
            licenseId: request.tenant().licenseId,
            aiAgentId: session.aiAgentId,
            origin: 'from_chat',
            originRef: session.id,
            ...scenarioData(maskedScenario(fields) as Required<ScenarioFields>),
            createdBy: account,
            updatedBy: account,
            createdAt: now,
            updatedAt: now,
          },
        });
      });
      return reply.code(201).send(serialiseScenario(row));
    },
  );
}
