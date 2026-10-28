/**
 * The compliance pack on the test bench (tm 314.4 · SiyahTuş analysis AI-19
 * §9, AI-19-S1): the hook that puts it in front of every publish, and the gate
 * that reads what it said.
 *
 *   - **The pack as the runner plays it.** {@link complianceScenarios}: the
 *     locked scenarios of `@siyahtus/types` `ai-compliance-scenarios.ts`, each
 *     an empty scripted conversation at the run's start, keyed
 *     `compliance:G<n>:<lang>`. A workspace cannot edit or delete them — they
 *     are not rows — and they need no scenario of the workspace's to be played.
 *   - **The pre-publish hook.** {@link queuePrePublishRun}: a run of the draft
 *     with `trigger: pre_publish` that plays the pack — first — and every
 *     active scenario of the workspace's, with the pack's version and its share
 *     of the counts on the run (`compliance_*`, the root panel's, tm 389.19).
 *     `POST /ai/test-runs` with `trigger: pre_publish` calls it; tm 316's
 *     "Onaya gönder" calls it for the draft revision it submits.
 *   - **The gate.** {@link compliancePackGate}: the latest pre-publish run of
 *     the draft decides whether publishing is open — only when it completed
 *     under the pack's current version with every pack scenario passed
 *     (AI-19-S1 "%100 geçmeden yayın kapalı"). What failed of the workspace's
 *     own scenarios is counted beside it: a manager may publish over those
 *     with a reason (tm 316), never over the pack.
 */
import type { AiTestRun } from '@prisma/client';
import {
  AI_COMPLIANCE_PACK_SIZE,
  AI_COMPLIANCE_PACK_VERSION,
  AI_COMPLIANCE_SCENARIOS,
  AI_COMPLIANCE_SCENARIO_KEY_PREFIX,
  AI_TEST_RUN_SCENARIOS_MAX,
  type AiComplianceGateState,
  type AiComplianceScenarioKey,
} from '@siyahtus/types';
import { ApiError } from '../../../lib/api-error.js';
import type { TenantClient } from '../../../lib/tenant.js';
import { isOpenRunConflict, testRunInProgress } from './test-runs.js';

export { complianceScenarios } from './test-runs.js';

/** The workspace's own scenarios a pre-publish run can hold beside the pack. */
export const PRE_PUBLISH_WORKSPACE_SCENARIOS_MAX =
  AI_TEST_RUN_SCENARIOS_MAX - AI_COMPLIANCE_PACK_SIZE;

/**
 * The active scenarios of an agent a run without a list plays, oldest first —
 * at most `max`; one more is refused, so the run never plays a cut list.
 */
export async function activeScenarioIds(
  tx: TenantClient,
  aiAgentId: string,
  max: number,
): Promise<string[]> {
  const active = await tx.aiTestScenario.findMany({
    where: { aiAgentId, active: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: max + 1,
    select: { id: true },
  });
  if (active.length > max) {
    throw ApiError.validation(
      max < AI_TEST_RUN_SCENARIOS_MAX
        ? `A pre-publish run plays at most ${max} active scenarios beside the compliance pack; switch some off.`
        : `A run plays at most ${max} scenarios; name the ones to play.`,
      { problems: [{ field: 'scenario_ids', code: 'too_many' }] },
    );
  }
  return active.map((scenario) => scenario.id);
}

export interface PrePublishRunInput {
  readonly licenseId: bigint;
  readonly aiAgentId: string;
  /** The draft revision it tests (tm 316.2); null — a run recorded before revisions. */
  readonly draftRevision: number | null;
  /** The account that asked; null — the system. */
  readonly startedBy: string | null;
}

/**
 * Queue the pre-publish run of an agent's draft: the compliance pack and every
 * active scenario of the workspace's. The agent's open run against the draft
 * is `409 ai_test_run_in_progress`. The caller wakes the worker once its
 * transaction has committed.
 */
export async function queuePrePublishRun(
  tx: TenantClient,
  input: PrePublishRunInput,
): Promise<AiTestRun> {
  const scenarioIds = await activeScenarioIds(
    tx,
    input.aiAgentId,
    PRE_PUBLISH_WORKSPACE_SCENARIOS_MAX,
  );
  try {
    return await tx.aiTestRun.create({
      data: {
        licenseId: input.licenseId,
        aiAgentId: input.aiAgentId,
        configTarget: 'draft',
        draftRevision: input.draftRevision,
        trigger: 'pre_publish',
        status: 'queued',
        scenarioCount: AI_COMPLIANCE_PACK_SIZE + scenarioIds.length,
        scenarioIds,
        compliancePackVersion: AI_COMPLIANCE_PACK_VERSION,
        compliancePassed: 0,
        complianceFailed: 0,
        startedBy: input.startedBy,
      },
    });
  } catch (error) {
    if (isOpenRunConflict(error)) throw testRunInProgress();
    throw error;
  }
}

/** The run fields the gate reads. */
export type GatedRun = Pick<
  AiTestRun,
  | 'id'
  | 'status'
  | 'failed'
  | 'errored'
  | 'compliancePackVersion'
  | 'compliancePassed'
  | 'complianceFailed'
>;

/** Whether publishing is open, and why not. */
export interface CompliancePackGate {
  readonly state: AiComplianceGateState;
  /** True only when `state` is `passed`. */
  readonly open: boolean;
  /** The pre-publish run it read; null — there is none. */
  readonly runId: string | null;
  /** The pack version the run played; null — no run. */
  readonly runPackVersion: string | null;
  /** Its pack scenarios passed, and failed or errored. */
  readonly passed: number;
  readonly failed: number;
  /** The pack scenarios that did not pass, in the pack's order. */
  readonly failing: AiComplianceScenarioKey[];
  /** The workspace's own scenarios that failed or errored — publishable over, with a reason (tm 316). */
  readonly workspaceFailed: number;
}

/**
 * The gate a pre-publish run sets, from the run and its pack keys that did
 * not pass:
 *
 *   - `missing` — no pre-publish run of the draft;
 *   - `pending` — it is queued or playing;
 *   - `stale`   — it played another version of the pack: run it again;
 *   - `failed`  — a pack scenario failed or errored, or the run stopped
 *                 before it played them all (failed, cancelled);
 *   - `passed`  — it completed, under this version, every pack scenario passed.
 */
export function gateOf(run: GatedRun | null, failing: readonly string[]): CompliancePackGate {
  if (!run) {
    return {
      state: 'missing',
      open: false,
      runId: null,
      runPackVersion: null,
      passed: 0,
      failed: 0,
      failing: [],
      workspaceFailed: 0,
    };
  }
  const passed = run.compliancePassed ?? 0;
  const failed = run.complianceFailed ?? 0;
  const order = new Map(AI_COMPLIANCE_SCENARIOS.map((scenario, index) => [scenario.key, index]));
  const failingKeys = failing
    .filter((key): key is AiComplianceScenarioKey => order.has(key as AiComplianceScenarioKey))
    .sort((a, b) => order.get(a)! - order.get(b)!);
  let state: AiComplianceGateState;
  if (run.status === 'queued' || run.status === 'running') state = 'pending';
  else if (run.compliancePackVersion !== AI_COMPLIANCE_PACK_VERSION) state = 'stale';
  else if (run.status === 'completed' && failed === 0 && passed === AI_COMPLIANCE_PACK_SIZE) {
    state = 'passed';
  } else state = 'failed';
  return {
    state,
    open: state === 'passed',
    runId: run.id,
    runPackVersion: run.compliancePackVersion,
    passed,
    failed,
    failing: failingKeys,
    workspaceFailed: Math.max(0, run.failed + run.errored - failed),
  };
}

/**
 * The gate for an agent's draft: its latest pre-publish run of the given draft
 * revision (tm 316.2) — a run of an earlier revision tested another draft, and
 * submitting this one needs its own. Without a revision, the latest of the
 * draft's (the root panel's overview).
 */
export async function compliancePackGate(
  tx: TenantClient,
  input: { aiAgentId: string; draftRevision?: number | null },
): Promise<CompliancePackGate> {
  const run = await tx.aiTestRun.findFirst({
    where: {
      aiAgentId: input.aiAgentId,
      trigger: 'pre_publish',
      configTarget: 'draft',
      ...(input.draftRevision !== undefined && input.draftRevision !== null
        ? { draftRevision: input.draftRevision }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      status: true,
      failed: true,
      errored: true,
      compliancePackVersion: true,
      compliancePassed: true,
      complianceFailed: true,
    },
  });
  if (!run) return gateOf(null, []);
  const failing = await tx.aiTestRunResult.findMany({
    where: {
      runId: run.id,
      scenarioKey: { startsWith: AI_COMPLIANCE_SCENARIO_KEY_PREFIX },
      status: { not: 'passed' },
    },
    select: { scenarioKey: true },
  });
  return gateOf(
    run,
    failing.map((row) => row.scenarioKey),
  );
}

/** The gate as the API sends it (`AiComplianceGate`). */
export function serialiseGate(gate: CompliancePackGate) {
  return {
    state: gate.state,
    open: gate.open,
    run_id: gate.runId,
    run_pack_version: gate.runPackVersion,
    passed: gate.passed,
    failed: gate.failed,
    failing: gate.failing,
    workspace_failed: gate.workspaceFailed,
  };
}
