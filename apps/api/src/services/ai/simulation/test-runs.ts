/**
 * The test runs in the database (tm 314.2 · SiyahTuş analysis AI-19 §2, §7;
 * migrations 20261021200000_ai_testing, 20261022090000_ai_test_runs_queue).
 *
 * A run is queued with the scenarios it plays fixed (`scenario_ids`), claimed
 * by one worker at a time across every workspace (`ai_test_runs_claim`), and
 * written scenario by scenario: each result goes in with the run's counts in
 * one transaction. Every write after the claim is fenced by it — the run must
 * still be `running` under this claim's attempt — so a worker whose lease ran
 * out, or that was stopped, writes nothing more, and the claim that took the
 * run over plays only the scenarios that have no result yet.
 */
import { Prisma, type AiTestScenario, type PrismaClient } from '@prisma/client';
import {
  AI_COMPLIANCE_SCENARIO_KEY_PREFIX,
  AI_TEST_RUN_ERROR_MAX,
  AI_TEST_SCENARIO_NAME_MAX,
  type AiTestExpectations,
  type AiTestFactValue,
  type AiTestRunTarget,
  type AiTestScenarioMode,
  type ScenarioPersona,
} from '@siyahtus/types';
import { ApiError } from '../../../lib/api-error.js';
import { withTenant, type TenantClient, type TenantContext } from '../../../lib/tenant.js';
import type { ScenarioPlay, SimulatedScenario } from './runner.js';

/**
 * How long a claim holds its run: three scenarios' worth of time limit, moved
 * on with every result and by the worker's own beat in between.
 */
export const AI_TEST_RUN_LEASE_MS = 180_000;
/** Claims a run may have; one that died with every one of them fails. */
export const AI_TEST_RUN_MAX_ATTEMPTS = 3;

/** A run a worker holds: its id, its workspace and the claim's number — the fence. */
export interface AiTestRunClaim {
  readonly id: string;
  readonly context: TenantContext;
  readonly attempts: number;
}

/** The claimed run, as its worker plays it. */
export interface ClaimedTestRun {
  readonly id: string;
  readonly aiAgentId: string;
  readonly target: AiTestRunTarget;
  readonly configVersionId: string | null;
  readonly scenarioIds: readonly string[];
  /** When it first started — a scenario without a moment of its own starts here. */
  readonly startedAt: Date;
}

interface ClaimRow {
  id: string;
  license_id: bigint;
  organization_id: string;
  attempts: number;
}

/** The oldest run that is due, leased to the caller — or null. Across workspaces. */
export async function claimTestRun(
  db: PrismaClient,
  options: { leaseMs: number; maxAttempts: number },
): Promise<AiTestRunClaim | null> {
  const rows = await db.$queryRaw<ClaimRow[]>`
    SELECT id, license_id, organization_id, attempts
      FROM ai_test_runs_claim(${Math.ceil(options.leaseMs / 1000)}::int, ${options.maxAttempts}::int)`;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    context: { licenseId: row.license_id, organizationId: row.organization_id },
    attempts: row.attempts,
  };
}

/** What the claim plays, or null when the run is no longer this claim's. */
export async function readClaimedRun(
  tx: TenantClient,
  claim: AiTestRunClaim,
): Promise<ClaimedTestRun | null> {
  const row = await tx.aiTestRun.findFirst({
    where: { id: claim.id, status: 'running', attempts: claim.attempts },
    select: {
      id: true,
      aiAgentId: true,
      configTarget: true,
      configVersionId: true,
      scenarioIds: true,
      startedAt: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    aiAgentId: row.aiAgentId,
    target: row.configTarget as AiTestRunTarget,
    configVersionId: row.configVersionId,
    scenarioIds: row.scenarioIds,
    startedAt: row.startedAt ?? new Date(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored scenario as the runner plays it. The API validated it on the way in. */
export function simulatedScenarioOf(row: AiTestScenario): SimulatedScenario {
  const turns = Array.isArray(row.turns)
    ? row.turns.filter((turn): turn is string => typeof turn === 'string')
    : [];
  const facts: Record<string, AiTestFactValue> = {};
  if (isRecord(row.facts)) {
    for (const [key, value] of Object.entries(row.facts)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        facts[key] = value;
      }
    }
  }
  return {
    key: row.id,
    name: row.name,
    mode: row.mode as AiTestScenarioMode,
    persona: row.persona as ScenarioPersona,
    language: row.language,
    turns,
    goal: row.goal,
    facts,
    expectations: row.expectations as unknown as AiTestExpectations,
    simulatedNow: row.simulatedNow,
    toolOutputs: isRecord(row.toolOutputs) ? row.toolOutputs : {},
    brandId: row.brandId,
  };
}

/** The run's scenarios that have no result yet, in the run's order. One deleted meanwhile is not played. */
export async function scenariosToPlay(
  tx: TenantClient,
  run: ClaimedTestRun,
): Promise<SimulatedScenario[]> {
  const rows = await tx.aiTestScenario.findMany({
    where: { id: { in: [...run.scenarioIds] }, aiAgentId: run.aiAgentId },
  });
  const played = await tx.aiTestRunResult.findMany({
    where: { runId: run.id },
    select: { scenarioKey: true },
  });
  const done = new Set(played.map((row) => row.scenarioKey));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return run.scenarioIds.flatMap((id) => {
    const row = byId.get(id);
    return row && !done.has(id) ? [simulatedScenarioOf(row)] : [];
  });
}

/** The claim no longer holds the run: what it was writing rolls back. */
class ClaimLost extends Error {
  constructor() {
    super('the test run is no longer this claim’s');
    this.name = 'ClaimLost';
  }
}

/** The run is still `running` under this claim: every write after the claim says so. */
function fence(claim: AiTestRunClaim): Prisma.Sql {
  return Prisma.sql`id = ${claim.id}::uuid AND status = 'running' AND attempts = ${claim.attempts}`;
}

function leaseInterval(leaseMs: number): Prisma.Sql {
  return Prisma.sql`make_interval(secs => ${Math.ceil(leaseMs / 1000)})`;
}

/**
 * One scenario's result, with the run's counts and its lease moved on, in one
 * transaction. False: the claim lost the run, and nothing was written.
 */
export async function recordScenarioResult(
  db: PrismaClient,
  claim: AiTestRunClaim,
  scenario: SimulatedScenario,
  play: ScenarioPlay,
  leaseMs: number = AI_TEST_RUN_LEASE_MS,
): Promise<boolean> {
  const own = !scenario.key.startsWith(AI_COMPLIANCE_SCENARIO_KEY_PREFIX);
  try {
    return await withTenant(db, claim.context, async (tx) => {
      // A scenario deleted while it was played keeps its key and name (the
      // regression pairs them), not its id.
      const exists = own
        ? (await tx.aiTestScenario.findFirst({
            where: { id: scenario.key },
            select: { id: true },
          })) !== null
        : false;
      const { count } = await tx.aiTestRunResult.createMany({
        data: [
          {
            licenseId: claim.context.licenseId,
            runId: claim.id,
            scenarioId: exists ? scenario.key : null,
            scenarioKey: scenario.key,
            scenarioName: scenario.name.slice(0, AI_TEST_SCENARIO_NAME_MAX),
            status: play.status,
            stopReason: play.stopReason,
            outcome: play.outcome,
            handoffTeamId: play.handoffTeamId === null ? null : BigInt(play.handoffTeamId),
            transcript: play.transcript as unknown as Prisma.InputJsonValue,
            checks: play.checks as unknown as Prisma.InputJsonValue,
            ...(play.judge ? { judge: play.judge as unknown as Prisma.InputJsonValue } : {}),
            tokens: play.tokens,
            durationMs: play.durationMs,
          },
        ],
        skipDuplicates: true,
      });
      // Counted already, with the result an earlier claim wrote.
      if (count === 0) return true;
      const moved = await tx.$executeRaw`
        UPDATE ai_test_runs
           SET passed = passed + ${play.status === 'passed' ? 1 : 0},
               failed = failed + ${play.status === 'failed' ? 1 : 0},
               errored = errored + ${play.status === 'errored' ? 1 : 0},
               tokens = tokens + ${BigInt(play.tokens)},
               lease_until = now() + ${leaseInterval(leaseMs)}
         WHERE ${fence(claim)}`;
      if (moved === 0) throw new ClaimLost();
      return true;
    });
  } catch (error) {
    if (error instanceof ClaimLost) return false;
    throw error;
  }
}

/** Move the lease on. False: the claim lost the run. */
export async function extendTestRunLease(
  db: PrismaClient,
  claim: AiTestRunClaim,
  leaseMs: number = AI_TEST_RUN_LEASE_MS,
): Promise<boolean> {
  const moved = await withTenant(
    db,
    claim.context,
    (tx) => tx.$executeRaw`
      UPDATE ai_test_runs SET lease_until = now() + ${leaseInterval(leaseMs)} WHERE ${fence(claim)}`,
  );
  return moved > 0;
}

/**
 * The run is over: `completed` whatever its scenarios said, or `failed` with
 * what stopped it — for the operator, never a provider's words.
 */
export async function finishTestRun(
  db: PrismaClient,
  claim: AiTestRunClaim,
  end: { status: 'completed' } | { status: 'failed'; error: string },
): Promise<boolean> {
  const error = end.status === 'failed' ? end.error.slice(0, AI_TEST_RUN_ERROR_MAX) : null;
  const moved = await withTenant(
    db,
    claim.context,
    (tx) => tx.$executeRaw`
      UPDATE ai_test_runs
         SET status = ${end.status}, finished_at = now(), lease_until = NULL, error = ${error}
       WHERE ${fence(claim)}`,
  );
  return moved > 0;
}

/** Hand the run back to the queue — a worker stopping — for the next claim to go on with. */
export async function releaseTestRun(db: PrismaClient, claim: AiTestRunClaim): Promise<boolean> {
  const moved = await withTenant(
    db,
    claim.context,
    (tx) => tx.$executeRaw`
      UPDATE ai_test_runs SET status = 'queued', lease_until = NULL WHERE ${fence(claim)}`,
  );
  return moved > 0;
}

/** 409 `ai_test_run_in_progress`: the agent's run against that configuration is still under way. */
export function testRunInProgress(): ApiError {
  return new ApiError(
    'ai_test_run_in_progress',
    'A run of this AI agent against this configuration is still queued or playing; wait for it to finish.',
  );
}

/** Whether `error` is the open-run index refusing a second run (`ai_test_runs_open_key`). */
export function isOpenRunConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
