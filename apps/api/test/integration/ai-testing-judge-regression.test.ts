/**
 * The judge's advice, the regression report and the test allowance (tm 314.3
 * · SiyahTuş analysis AI-19 §4, §5, §7; AI-19-S2, AI-19-S3), through the real
 * server and its run worker.
 *
 *   1. **Regression.** A run's results are compared with the same scenarios
 *      in the agent's last completed published run before it: what passed and
 *      no longer does is listed first ("geçiyordu → kalıyor", AI-19 acceptance
 *      5), then a changed outcome or team, then the rest. A failed run, a
 *      draft run and a later run are no baseline; a deleted scenario's result
 *      and a compliance-pack result pair by key.
 *   2. **The judge advises.** Each played result carries the judge's advice —
 *      the stub's in every suite — and its status is the hard checks': a
 *      judge that scores a passing scenario 1 leaves it passing, one that
 *      fails leaves the result unjudged and the run completed.
 *   3. **The test allowance.** The judge's tokens are the scenario's and the
 *      run's, on `llm_test`; the live meter never moves (AI-19 acceptance 7).
 *      A judgement the test allowance refused stops the run, as a turn does.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AI_TEST_JUDGE_CRITERIA, splitSkillProcedure } from '@siyahtus/types';
import { AiDailyCapError } from '../../src/services/ai/ai-daily-budget.js';
import { AI_TEST_RUN_ERRORS } from '../../src/services/ai/simulation/run-worker.js';
import { AI_QUESTION, seedAiWorkspace, type AiWorkspace } from '../helpers/ai-workspace.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, resetDatabase } from '../helpers/fixtures.js';
import { PAPARA_LINES, paparaAcceptanceProcedure } from '../helpers/procedure-fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Json = Record<string, unknown>;

interface ResultBody {
  scenario_key: string;
  status: string;
  outcome: string | null;
  regression: string | null;
  judge: { score: number; comment: string; criteria?: Record<string, number> } | null;
  tokens: number;
}

interface ResultsBody {
  compared_run_id: string | null;
  results: ResultBody[];
}

/** Papara at 15:15 for a 13:40 deposit: past the 30 minutes — handed to Finance. */
const PAPARA_AT = '2026-10-19T15:15:00+03:00';

async function paparaWorkspace(owner: PrismaClient): Promise<{ ws: AiWorkspace; token: string }> {
  const ws = await seedAiWorkspace(owner);
  await owner.aiAgent.update({ where: { id: ws.aiAgentId }, data: { languages: ['tr', 'en'] } });
  await owner.group.create({
    data: { licenseId: ws.licenseId, name: 'Finans', topicRole: 'finance' },
  });
  await owner.kbPaymentMethod.create({
    data: { licenseId: ws.licenseId, name: 'Papara', direction: 'deposit', expectedMinutes: 30 },
  });
  const { procedure: body, ...own } = splitSkillProcedure(paparaAcceptanceProcedure());
  await owner.skill.create({
    data: {
      licenseId: ws.licenseId,
      aiAgentId: ws.aiAgentId,
      name: 'Yatırım geçmedi',
      kind: 'ai_agent',
      mode: 'procedure',
      whenToUse: own.when_to_use,
      examples: own.examples,
      priority: own.priority,
      slots: own.slots as object,
      procedure: body as object,
      active: true,
      updatedAt: new Date(),
    },
  });
  const token = await grantToken(owner, {
    licenseId: ws.licenseId,
    organizationId: ws.organizationId,
    ownerId: ws.ownerId,
    scopes: ['agents-bot--all:rw'],
    kind: 'oauth',
  });
  return { ws, token };
}

describe('the regression report and the judge’s advice (tm 314.3 · AI-19 §4, §5)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let ws: AiWorkspace;
  let token: string;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const create = async (name: string, outcome: 'handoff' | 'resolved'): Promise<string> => {
    const response = await server.post(
      '/ai/test-scenarios',
      {
        ai_agent_id: ws.aiAgentId,
        name,
        turns: PAPARA_LINES,
        simulated_now: PAPARA_AT,
        expectations: { outcome, max_turns: 4 },
      },
      auth(),
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  };
  const expect_ = (id: string, outcome: 'handoff' | 'resolved') =>
    server.patch(`/ai/test-scenarios/${id}`, { expectations: { outcome, max_turns: 4 } }, auth());
  const play = async (target: 'draft' | 'published', scenarioIds?: string[]): Promise<string> => {
    const queued = await server.post(
      '/ai/test-runs',
      { ai_agent_id: ws.aiAgentId, target, ...(scenarioIds ? { scenario_ids: scenarioIds } : {}) },
      auth(),
    );
    expect(queued.statusCode, queued.body).toBe(202);
    const id = (queued.json() as { id: string }).id;
    const run = await owner.aiTestRun.findUniqueOrThrow({ where: { id } });
    expect(run.status).toBe('completed');
    return id;
  };
  const results = async (runId: string): Promise<ResultsBody> => {
    const response = await server.get(`/ai/test-runs/${runId}/results`, auth());
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as ResultsBody;
  };

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(server.app);
    ({ ws, token } = await paparaWorkspace(owner));
  });

  it('lists what passed and now fails at the top, against the last published run (AI-19 acceptance 5)', async () => {
    const handsOver = await create('Finans’a devreder', 'handoff');
    const expectsResolved = await create('Çözüm bekler', 'resolved');
    const steady = await create('Değişmez', 'handoff');
    const baseline = await play('published');
    const before = await results(baseline);
    expect(before.compared_run_id).toBeNull();
    expect(before.results.map((r) => [r.scenario_key, r.status, r.regression])).toEqual([
      [expectsResolved, 'failed', null],
      [handsOver, 'passed', null],
      [steady, 'passed', null],
    ]);

    // The same conversations, held to the opposite ending.
    expect((await expect_(handsOver, 'resolved')).statusCode).toBe(200);
    expect((await expect_(expectsResolved, 'handoff')).statusCode).toBe(200);
    const draft = await play('draft');
    const after = await results(draft);
    expect(after.compared_run_id).toBe(baseline);
    expect(after.results.map((r) => [r.scenario_key, r.status, r.regression])).toEqual([
      [handsOver, 'failed', 'newly_failing'],
      [expectsResolved, 'passed', 'newly_passing'],
      [steady, 'passed', null],
    ]);

    // A published run compares with the published run before it, not with itself.
    const next = await play('published');
    expect((await results(next)).compared_run_id).toBe(baseline);
    // And the draft run still with the baseline: the later published run came after it.
    expect((await results(draft)).compared_run_id).toBe(baseline);
  });

  it('a changed ending or team comes next; a failed or draft run is no baseline; keys pair a deleted scenario and the pack', async () => {
    const team = await owner.group.findFirstOrThrow({
      where: { licenseId: ws.licenseId, name: 'Finans' },
    });
    const other = await owner.group.create({
      data: { licenseId: ws.licenseId, name: 'Destek' },
    });
    const kept = await create('Kalan', 'handoff');
    const gone = await create('Silinecek', 'handoff');
    const now = Date.now();
    const at = (minutes: number) => new Date(now - minutes * 60_000);
    const crafted = async (
      configTarget: 'draft' | 'published',
      status: 'completed' | 'failed',
      createdAt: Date,
      rows: Array<{ key: string; status: string; outcome: string | null; team: bigint | null }>,
    ): Promise<string> => {
      const run = await owner.aiTestRun.create({
        data: {
          licenseId: ws.licenseId,
          aiAgentId: ws.aiAgentId,
          configTarget,
          trigger: 'manual',
          status,
          scenarioCount: rows.length,
          scenarioIds: rows.map((r) => r.key).filter((key) => !key.startsWith('compliance:')),
          createdAt,
          startedAt: createdAt,
          finishedAt: createdAt,
        },
      });
      for (const row of rows) {
        await owner.aiTestRunResult.create({
          data: {
            licenseId: ws.licenseId,
            runId: run.id,
            scenarioId: row.key.startsWith('compliance:') ? null : row.key,
            scenarioKey: row.key,
            scenarioName: row.key,
            status: row.status,
            stopReason:
              row.status === 'errored'
                ? 'error'
                : row.outcome === 'handoff'
                  ? 'handoff'
                  : 'resolved',
            outcome: row.outcome,
            handoffTeamId: row.team,
          },
        });
      }
      return run.id;
    };

    const baseline = await crafted('published', 'completed', at(30), [
      { key: kept, status: 'passed', outcome: 'handoff', team: team.id },
      { key: gone, status: 'failed', outcome: 'handoff', team: team.id },
      { key: 'compliance:G3:tr', status: 'passed', outcome: 'handoff', team: team.id },
    ]);
    // Newer, but no baseline: a failed published run and a draft run.
    await crafted('published', 'failed', at(20), [
      { key: kept, status: 'failed', outcome: 'resolved', team: null },
    ]);
    await crafted('draft', 'completed', at(15), [
      { key: kept, status: 'failed', outcome: 'resolved', team: null },
    ]);
    const current = await crafted('draft', 'completed', at(10), [
      { key: kept, status: 'passed', outcome: 'handoff', team: other.id },
      { key: gone, status: 'failed', outcome: 'resolved', team: null },
      { key: 'compliance:G3:tr', status: 'errored', outcome: null, team: null },
    ]);
    // Deleted after both runs: its results keep the key, and still pair.
    expect((await server.del(`/ai/test-scenarios/${gone}`, auth())).statusCode).toBe(204);
    // Queued after the current run: never its baseline.
    await crafted('published', 'completed', at(5), [
      { key: kept, status: 'passed', outcome: 'handoff', team: team.id },
    ]);

    const body = await results(current);
    expect(body.compared_run_id).toBe(baseline);
    expect(body.results.map((r) => [r.scenario_key, r.regression])).toEqual([
      ['compliance:G3:tr', 'newly_failing'],
      [gone, 'outcome_changed'],
      [kept, 'team_changed'],
    ]);
  });

  it('every played result carries the stub judge’s advice; the status is the hard checks’', async () => {
    const passing = await create('Geçer', 'handoff');
    const failing = await create('Kalır', 'resolved');
    const body = await results(await play('draft'));
    const byKey = new Map(body.results.map((r) => [r.scenario_key, r]));
    expect(byKey.get(passing)).toMatchObject({
      status: 'passed',
      judge: {
        score: 5,
        comment: 'Stub judge: every hard check held.',
        criteria: Object.fromEntries(AI_TEST_JUDGE_CRITERIA.map((key) => [key, 5])),
      },
    });
    const failed = byKey.get(failing)!;
    expect(failed.status).toBe('failed');
    expect(failed.judge!.comment).toMatch(/^Stub judge: \d+ hard checks? failed \(.*outcome/);
    expect(failed.judge!.score).toBeLessThan(5);
  });
});

describe('the judge on the test meter (tm 314.3 · AI-19-S2, AI-19-S3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let ws: AiWorkspace;
  let token: string;
  let judge: ((request: unknown) => string) | Error | undefined;
  const llm = new FakeLlmProvider({
    scenarioJudge: (request) => {
      if (judge instanceof Error) throw judge;
      return judge
        ? judge(request)
        : JSON.stringify({
            score: 3,
            comment: 'ok',
            criteria: Object.fromEntries(AI_TEST_JUDGE_CRITERIA.map((key) => [key, null])),
          });
    },
    scenarioJudgeUsage: { inputTokens: 400, outputTokens: 40 },
  });

  const auth = () => ({ authorization: `Bearer ${token}` });
  const run = async (): Promise<{
    id: string;
    status: string;
    tokens: bigint;
    error: string | null;
  }> => {
    const created = await server.post(
      '/ai/test-scenarios',
      {
        ai_agent_id: ws.aiAgentId,
        name: 'Delivery',
        language: 'en',
        turns: [AI_QUESTION],
        expectations: { outcome: 'resolved', max_turns: 2 },
      },
      auth(),
    );
    expect(created.statusCode, created.body).toBe(201);
    const queued = await server.post(
      '/ai/test-runs',
      { ai_agent_id: ws.aiAgentId, target: 'draft' },
      auth(),
    );
    expect(queued.statusCode, queued.body).toBe(202);
    return owner.aiTestRun.findUniqueOrThrow({
      where: { id: (queued.json() as { id: string }).id },
      select: { id: true, status: true, tokens: true, error: true },
    });
  };

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({ AI_DAILY_LLM_TOKENS_PER_WORKSPACE: '1000000' }, { llm });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(server.app);
    llm.reset();
    judge = undefined;
    ws = await seedAiWorkspace(owner);
    token = await grantToken(owner, {
      licenseId: ws.licenseId,
      organizationId: ws.organizationId,
      ownerId: ws.ownerId,
      scopes: ['agents-bot--all:rw'],
      kind: 'oauth',
    });
  });

  it('a 1 from the judge leaves a passing scenario passing; its tokens are the scenario’s, on llm_test only', async () => {
    judge = () =>
      JSON.stringify({
        score: 1,
        comment: 'Curt.',
        criteria: Object.fromEntries(AI_TEST_JUDGE_CRITERIA.map((key) => [key, 1])),
      });
    const played = await run();
    expect(played.status).toBe('completed');
    expect(llm.scenarioJudgeCalls).toHaveLength(1);
    expect(llm.scenarioJudgeCalls[0]).toMatchObject({ tier: 'fast' });
    const [result] = await owner.aiTestRunResult.findMany({ where: { runId: played.id } });
    expect(result!.status).toBe('passed');
    expect(result!.judge).toMatchObject({ score: 1, comment: 'Curt.' });
    // The turn's tokens and the judge's 440.
    expect(result!.tokens).toBeGreaterThan(440);
    expect(Number(played.tokens)).toBe(result!.tokens);

    const usage = await owner.aiDailyUsage.findMany({
      where: { licenseId: ws.licenseId },
      select: { meter: true, used: true },
    });
    const used = Object.fromEntries(usage.map((row) => [row.meter, Number(row.used)]));
    expect(used['llm_test']).toBeGreaterThanOrEqual(440);
    expect(used['llm'] ?? 0).toBe(0);
    const events = await owner.aiUsageEvent.findMany({
      where: { licenseId: ws.licenseId },
      select: { surface: true, meter: true, modelTier: true },
    });
    expect(events.every((event) => event.surface === 'simulation')).toBe(true);
    expect(events.some((event) => event.meter === 'llm_test' && event.modelTier === 'fast')).toBe(
      true,
    );
  });

  it('a judge that fails leaves the result unjudged and the run completed', async () => {
    judge = new Error('judge down');
    const played = await run();
    expect(played.status).toBe('completed');
    const [result] = await owner.aiTestRunResult.findMany({ where: { runId: played.id } });
    expect(result).toMatchObject({ status: 'passed', judge: null });
  });

  it('a judgement the test allowance refused stops the run; the result stands, unjudged', async () => {
    judge = new AiDailyCapError('llm_test', 'workspace', 60);
    const played = await run();
    expect(played).toMatchObject({ status: 'failed', error: AI_TEST_RUN_ERRORS.capped });
    const [result] = await owner.aiTestRunResult.findMany({ where: { runId: played.id } });
    expect(result).toMatchObject({ status: 'passed', judge: null });
  });

  it('the results carry the advice the worker wrote', async () => {
    const played = await run();
    const body = (await server.get(`/ai/test-runs/${played.id}/results`, auth())).json() as Json;
    expect((body['results'] as ResultBody[])[0]!.judge).toEqual({ score: 3, comment: 'ok' });
  });
});
