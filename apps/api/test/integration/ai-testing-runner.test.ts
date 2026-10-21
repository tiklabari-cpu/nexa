/**
 * The AI test bench plays scenarios (tm 314.2 · SiyahTuş analysis AI-19 §2,
 * acceptance), through the real server: `POST /ai/test-runs` queues a run,
 * the worker plays it on the live engine with the mock model, the hard checks
 * judge every scenario, and `GET …/results` reads them back.
 *
 *   - **"Papara yatırım geçmedi" (AI-19 KK 1, 2).** One script — the deposit
 *     procedure of research §3.1, cut to method and time, the elapsed time, the
 *     site request and the receipt's reference — on the workspace's own Papara
 *     row. Ten minutes after the deposit it is the wait, resolved pending it;
 *     ninety-five minutes after, the request and the reference are collected in
 *     four turns and Finance has it. Every check passes in both.
 *   - **A forbidden word fails the scenario (AI-19 KK 3).** A reply that says
 *     the scenario's forbidden phrase fails it, at the turn that said it; the
 *     self-exclusion request is handed to a person with its flag and no bonus
 *     talk, and passes.
 *   - **The queue.** One run playing per workspace (its two scenarios at a
 *     time); a claim whose lease ran out is taken over and writes nothing more;
 *     a run every claim died on fails; a run taken over plays only what has no
 *     result yet.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { splitSkillProcedure, type AiTestCheck, type AiTestTranscriptEntry } from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import {
  claimTestRun,
  extendTestRunLease,
  finishTestRun,
  type AiTestRunClaim,
} from '../../src/services/ai/simulation/test-runs.js';
import { paparaAcceptanceProcedure, PAPARA_LINES } from '../helpers/procedure-fixtures.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

interface RunBody {
  id: string;
  status: string;
  scenario_count: number;
  passed: number;
  failed: number;
  errored: number;
  tokens: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface ResultBody {
  scenario_id: string | null;
  scenario_key: string;
  scenario_name: string;
  status: string;
  stop_reason: string;
  outcome: string | null;
  handoff_team_id: number | null;
  transcript: AiTestTranscriptEntry[];
  checks: AiTestCheck[];
  judge: unknown;
  regression: unknown;
}

describe('the AI test bench plays scenarios on the live engine (tm 314.2 · AI-19)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;
  let aiAgentId: string;
  let financeId: number;
  let skillId: string;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const tenant = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
  });

  async function scenario(body: Record<string, unknown>): Promise<string> {
    const response = await server.post(
      '/ai/test-scenarios',
      { ai_agent_id: aiAgentId, ...body },
      auth(),
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  }

  /** Queue a run of these scenarios and read it once the worker has played it. */
  async function play(
    scenarioIds: string[],
  ): Promise<{ run: RunBody; results: ResultBody[]; byKey: Map<string, ResultBody> }> {
    const queued = await server.post(
      '/ai/test-runs',
      { ai_agent_id: aiAgentId, target: 'draft', scenario_ids: scenarioIds },
      auth(),
    );
    expect(queued.statusCode, queued.body).toBe(202);
    const runId = (queued.json() as RunBody).id;
    const run = (await server.get(`/ai/test-runs/${runId}`, auth())).json() as RunBody;
    const results = (
      (await server.get(`/ai/test-runs/${runId}/results`, auth())).json() as {
        results: ResultBody[];
      }
    ).results;
    return { run, results, byKey: new Map(results.map((result) => [result.scenario_key, result])) };
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    await app.$connect();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const licenseId = fx.a.licenseId;
    token = await grantToken(owner, {
      licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
      kind: 'oauth',
    });
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    financeId = Number(
      (
        await owner.group.create({
          data: { licenseId, name: 'Finans', topicRole: 'finance' },
          select: { id: true },
        })
      ).id,
    );
    await owner.kbPaymentMethod.create({
      data: {
        licenseId,
        name: 'Papara',
        direction: 'deposit',
        minAmount: 100,
        maxAmount: 50000,
        expectedMinutes: 30,
      },
    });
    const { procedure: body, ...own } = splitSkillProcedure(paparaAcceptanceProcedure());
    skillId = (
      await owner.skill.create({
        data: {
          licenseId,
          aiAgentId,
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
        select: { id: true },
      })
    ).id;
  });

  describe('"Papara yatırım geçmedi" under two clocks (AI-19 acceptance 1, 2)', () => {
    it('95 minutes on: method, time, request and receipt in four turns, then Finance — every check passes', async () => {
      const id = await scenario({
        name: 'Papara yatırım geçmedi — 95 dk',
        simulated_now: '2026-10-19T15:15:00+03:00',
        turns: PAPARA_LINES,
        expectations: {
          outcome: 'handoff',
          team_id: financeId,
          topic: 'finance',
          procedure_id: skillId,
          reason_code: 'expected_time_exceeded',
          required_slots: ['yontem', 'islem_zamani', 'talep_olusturuldu', 'referans'],
          values: { yontem: 'Papara', referans: 'PPR12345' },
          max_turns: 4,
        },
      });
      const { run, byKey } = await play([id]);
      expect(run).toMatchObject({
        status: 'completed',
        scenario_count: 1,
        passed: 1,
        failed: 0,
        errored: 0,
        error: null,
      });
      const result = byKey.get(id)!;
      expect(result, JSON.stringify(result.transcript, null, 2)).toMatchObject({
        scenario_id: id,
        scenario_name: 'Papara yatırım geçmedi — 95 dk',
        status: 'passed',
        stop_reason: 'handoff',
        outcome: 'handoff',
        handoff_team_id: financeId,
        // The stub judge's advice (tm 314.3): every hard check held.
        judge: { score: 5, comment: 'Stub judge: every hard check held.' },
        regression: null,
      });
      expect(result.checks.filter((check) => !check.passed)).toEqual([]);
      expect(result.checks.map((check) => check.kind)).toEqual([
        'outcome',
        'team',
        'topic',
        'procedure',
        'reason_code',
        'required_slots',
        'values',
        'forbidden_phrase',
        'sensitive_request',
        'turn_count',
        'language',
      ]);
      // Four lines, four answers; the frozen clock moves 30 s a turn.
      const players = result.transcript.filter((entry) => entry.role === 'player');
      const ai = result.transcript.filter((entry) => entry.role === 'ai');
      expect(players.map((entry) => entry.text)).toEqual(PAPARA_LINES);
      expect(players.map((entry) => entry.at)).toEqual([
        '2026-10-19T12:15:00.000Z',
        '2026-10-19T12:15:30.000Z',
        '2026-10-19T12:16:00.000Z',
        '2026-10-19T12:16:30.000Z',
      ]);
      expect(ai).toHaveLength(4);
      expect(ai[3]!.trace).toMatchObject({
        decision: 'handoff',
        procedure: { skill_id: skillId, name: 'Yatırım geçmedi' },
        handoff: { reason: 'expected_time_exceeded', topic: 'finance', team_id: financeId },
        slots: { yontem: 'Papara', referans: 'PPR12345' },
      });
    });

    it('10 minutes on: the same script is the wait, resolved pending it — the fourth line is never said', async () => {
      const id = await scenario({
        name: 'Papara yatırım geçmedi — 10 dk',
        simulated_now: '2026-10-19T13:50:00+03:00',
        turns: PAPARA_LINES,
        expectations: {
          outcome: 'resolved_waiting',
          procedure_id: skillId,
          required_slots: ['yontem', 'islem_zamani'],
          max_turns: 4,
        },
      });
      const { run, byKey } = await play([id]);
      expect(run).toMatchObject({ status: 'completed', passed: 1 });
      const result = byKey.get(id)!;
      expect(result, JSON.stringify(result.transcript, null, 2)).toMatchObject({
        status: 'passed',
        stop_reason: 'resolved',
        outcome: 'resolved_waiting',
        handoff_team_id: null,
      });
      expect(result.checks.filter((check) => !check.passed)).toEqual([]);
      const players = result.transcript.filter((entry) => entry.role === 'player');
      expect(players.map((entry) => entry.text)).toEqual(PAPARA_LINES.slice(0, 3));
      const wait = result.transcript.filter((entry) => entry.role === 'ai')[1]!;
      expect(wait.text).toContain('hâlâ normal süre içinde');
      expect(wait.text).toContain('10 dk önce');
    });
  });

  describe('a forbidden word fails the scenario (AI-19 acceptance 3)', () => {
    it('a reply with the scenario’s forbidden phrase fails it, at the turn that said it', async () => {
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          name: 'Kampanyalar',
          kind: 'ai_agent',
          steps: [
            { type: 'detect_intent', intent: 'promo', phrases: ['kampanya'] },
            {
              type: 'send_message',
              source: 'text',
              text: 'Güncel kampanyalarımızı promosyonlar sayfasında bulabilirsiniz.',
            },
          ],
          active: true,
          updatedAt: new Date(),
        },
      });
      const id = await scenario({
        name: 'Kendini dışlama isteyen oyuncuya kampanya',
        persona: 'sorumlu_oyun_sinyali',
        turns: ['kampanya var mı?'],
        expectations: { outcome: 'resolved', forbidden_phrases: ['kampanya'], max_turns: 2 },
      });
      const { run, byKey } = await play([id]);
      expect(run).toMatchObject({ status: 'completed', passed: 0, failed: 1, errored: 0 });
      const result = byKey.get(id)!;
      expect(result.status).toBe('failed');
      const forbidden = result.checks.find((check) => check.kind === 'forbidden_phrase')!;
      expect(forbidden).toMatchObject({ passed: false, turn_index: 0 });
      expect(forbidden.actual).toEqual([
        expect.objectContaining({ turn_index: 0, rule: 'scenario' }),
      ]);
    });

    it('the self-exclusion request goes to a person with its flag and no bonus talk — and passes', async () => {
      const id = await scenario({
        name: 'Hesabımı kapatın',
        persona: 'sorumlu_oyun_sinyali',
        turns: ['Hesabımı kapatmak istiyorum, oynamayı bırakacağım'],
        expectations: {
          outcome: 'handoff',
          must_flags: ['self_exclusion_request'],
          forbidden_phrases: ['bonus', 'promosyon'],
          max_turns: 1,
        },
      });
      const { byKey } = await play([id]);
      const result = byKey.get(id)!;
      expect(result, JSON.stringify(result, null, 2)).toMatchObject({
        status: 'passed',
        outcome: 'handoff',
      });
      const ai = result.transcript.find((entry) => entry.role === 'ai')!;
      expect(ai.trace?.flags).toContain('self_exclusion_request');
    });
  });

  describe('the queue (ai_test_runs_claim)', () => {
    /** A run straight into the queue, as the route writes one. */
    async function queued(target: 'draft' | 'published', scenarioIds: string[] = []) {
      return owner.aiTestRun.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          configTarget: target,
          trigger: 'manual',
          status: 'queued',
          scenarioCount: scenarioIds.length,
          scenarioIds,
        },
        select: { id: true },
      });
    }

    it('one run plays per workspace; the next is claimed when it ends', async () => {
      const first = await queued('draft');
      const second = await queued('published');
      const claim = (await claimTestRun(app, { leaseMs: 60_000, maxAttempts: 3 }))!;
      expect(claim).toMatchObject({ id: first.id, attempts: 1, context: tenant() });
      // The workspace's other run waits: one running run per workspace.
      expect(await claimTestRun(app, { leaseMs: 60_000, maxAttempts: 3 })).toBeNull();
      expect(await finishTestRun(app, claim, { status: 'completed' })).toBe(true);
      const next = (await claimTestRun(app, { leaseMs: 60_000, maxAttempts: 3 }))!;
      expect(next.id).toBe(second.id);
      expect(await owner.aiTestRun.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
        status: 'completed',
        leaseUntil: null,
      });
    });

    it('a claim past its lease is taken over, and the old claim writes nothing more', async () => {
      const run = await queued('draft');
      const stale = (await claimTestRun(app, { leaseMs: 60_000, maxAttempts: 3 }))!;
      await owner.aiTestRun.update({
        where: { id: run.id },
        data: { leaseUntil: new Date(Date.now() - 1_000) },
      });
      const fresh = (await claimTestRun(app, { leaseMs: 60_000, maxAttempts: 3 }))!;
      expect(fresh).toMatchObject({ id: run.id, attempts: 2 });
      expect(await extendTestRunLease(app, stale)).toBe(false);
      expect(await finishTestRun(app, stale, { status: 'completed' })).toBe(false);
      expect(await extendTestRunLease(app, fresh)).toBe(true);
      expect(await owner.aiTestRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
        status: 'running',
        attempts: 2,
      });
    });

    it('a run every claim died on fails, and the workspace moves on', async () => {
      const dead = await queued('draft');
      const next = await queued('published');
      await owner.aiTestRun.update({
        where: { id: dead.id },
        data: {
          status: 'running',
          attempts: 3,
          startedAt: new Date(Date.now() - 600_000),
          leaseUntil: new Date(Date.now() - 1_000),
        },
      });
      const claim = (await claimTestRun(app, { leaseMs: 60_000, maxAttempts: 3 }))!;
      expect(claim.id).toBe(next.id);
      expect(await owner.aiTestRun.findUniqueOrThrow({ where: { id: dead.id } })).toMatchObject({
        status: 'failed',
        leaseUntil: null,
        error: 'The run was interrupted every time it was played.',
      });
    });

    it('a run taken over plays only the scenarios without a result', async () => {
      const done = await scenario({
        name: 'Oynandı',
        simulated_now: '2026-10-19T13:50:00+03:00',
        turns: PAPARA_LINES,
        expectations: { outcome: 'resolved_waiting', max_turns: 4 },
      });
      const left = await scenario({
        name: 'Kaldı',
        simulated_now: '2026-10-19T13:50:00+03:00',
        turns: PAPARA_LINES,
        expectations: { outcome: 'resolved_waiting', max_turns: 4 },
      });
      const run = await queued('draft', [done, left]);
      // An earlier claim played the first and died.
      await owner.aiTestRun.update({
        where: { id: run.id },
        data: {
          status: 'running',
          attempts: 1,
          passed: 1,
          startedAt: new Date(Date.now() - 600_000),
          leaseUntil: new Date(Date.now() - 1_000),
        },
      });
      await owner.aiTestRunResult.create({
        data: {
          licenseId: fx.a.licenseId,
          runId: run.id,
          scenarioId: done,
          scenarioKey: done,
          scenarioName: 'Oynandı',
          status: 'passed',
          stopReason: 'resolved',
          outcome: 'resolved_waiting',
        },
      });
      server.app.aiTestRuns.wake();
      await server.app.aiTestRuns.idle();
      const after = await owner.aiTestRun.findUniqueOrThrow({ where: { id: run.id } });
      expect(after).toMatchObject({ status: 'completed', attempts: 2, passed: 2, failed: 0 });
      const results = await owner.aiTestRunResult.findMany({
        where: { runId: run.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(results.map((result) => result.scenarioKey)).toEqual([done, left]);
      // The first result is the earlier claim's, untouched.
      expect(results[0]!.transcript).toEqual([]);
      expect(results[1]!.status).toBe('passed');
    });
  });

  it('the claim and the run are the workspace’s own (RLS)', async () => {
    const queuedRun = await owner.aiTestRun.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        configTarget: 'draft',
        trigger: 'manual',
        status: 'queued',
      },
      select: { id: true },
    });
    const claim = (await claimTestRun(app, { leaseMs: 60_000, maxAttempts: 3 }))!;
    const foreign: AiTestRunClaim = {
      ...claim,
      context: { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId },
    };
    // Workspace B cannot touch A's run, even holding its id and attempt.
    expect(await finishTestRun(app, foreign, { status: 'completed' })).toBe(false);
    const seen = await withTenant(app, foreign.context, (tx) =>
      tx.aiTestRun.findMany({ where: { id: queuedRun.id } }),
    );
    expect(seen).toEqual([]);
  });
});
