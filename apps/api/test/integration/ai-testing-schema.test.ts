/**
 * The AI test bench's tables (tm 314.1 · SiyahTuş analysis AI-19; migration
 * 20261021200000_ai_testing; `@siyahtus/types` `ai-testing.ts`).
 *
 * tm 314.2's runner, routes and queue (migration 20261022090000) serve them;
 * what is pinned here is what they lean on:
 *
 *   - **Tenant isolation (NFR-S4).** RLS on all four tables, read and write; a
 *     row cannot name another workspace's agent, brand, run or scenario even
 *     under the writer's own licence (a foreign key alone is checked past RLS).
 *   - **What the application role may do.** A run is never deleted (the
 *     regression reads the previous one); a result is written once and only
 *     the judge's advice is added later; nothing is emptied wholesale.
 *   - **One vocabulary.** The CHECKs, `@siyahtus/types` and the contract name
 *     the same lists and bounds, and the validator refuses what the CHECKs do.
 *   - **What a row must say.** A script has a message, a simulated player a
 *     goal; a version run names its version; a pre-publish run carries the
 *     compliance pack (AI-19-S1) — its counts all or none; an ended run says
 *     when; `errored` is exactly "could not be played"; a result's key is its
 *     scenario's id or a compliance key, once per run, and outlives the scenario.
 *     The queue's (tm 314.2): a playing run holds a lease, an ended one none;
 *     one open run per agent and target, one playing run per workspace.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  PrismaClient,
  type AiSandboxSession,
  type AiTestRun,
  type AiTestRunResult,
  type AiTestScenario,
} from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  AI_TEST_JUDGE_COMMENT_MAX,
  AI_TEST_JUDGE_CRITERIA,
  AI_TEST_JUDGE_SCORE_MAX,
  AI_TEST_MAX_TURNS_DEFAULT,
  AI_TEST_MAX_TURNS_LIMIT,
  AI_TEST_REGRESSIONS,
  AI_TEST_RESULT_STATUSES,
  AI_TEST_RUN_SCENARIOS_MAX,
  AI_TEST_RUN_STATUSES,
  AI_TEST_RUN_TARGETS,
  AI_TEST_RUN_TRIGGERS,
  AI_TEST_SCENARIO_MODES,
  AI_TEST_SCENARIO_NAME_MAX,
  AI_TEST_SCENARIO_ORIGINS,
  AI_TEST_SCENARIO_TURNS_MAX,
  AI_TEST_STOP_REASONS,
  AI_TEST_CHECK_KINDS,
  SCENARIO_OUTCOMES,
  SCENARIO_PERSONAS,
  defaultAiTestExpectations,
  validateAiTestScenario,
} from '@siyahtus/types';
import { withTenant, type TenantClient } from '../../src/lib/tenant.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const ROLLBACK = new Error('rollback probe');
const TABLES = ['ai_test_scenarios', 'ai_test_runs', 'ai_test_run_results', 'ai_sandbox_sessions'];
const MIGRATION = fileURLToPath(
  new URL('../../prisma/migrations/20261021200000_ai_testing/migration.sql', import.meta.url),
);
const QUEUE_MIGRATION = fileURLToPath(
  new URL(
    '../../prisma/migrations/20261022090000_ai_test_runs_queue/migration.sql',
    import.meta.url,
  ),
);

/** As much of a JSON schema as these tests read. */
interface SchemaNode {
  enum?: Array<string | null>;
  maxLength?: number;
  maxItems?: number;
  maximum?: number;
  default?: unknown;
  properties?: Record<string, SchemaNode>;
}

type Writer = Pick<
  PrismaClient,
  'aiTestScenario' | 'aiTestRun' | 'aiTestRunResult' | 'aiSandboxSession' | '$executeRawUnsafe'
>;
/** Prisma field names; cast at the call — the XOR create types are too costly to infer per spread. */
type Data = Record<string, unknown>;

const SCRIPT = {
  name: 'Papara yatırım geçmedi',
  turns: ['Yatırımım hesaba geçmedi', 'Papara ile yatırdım'],
  expectations: { outcome: 'handoff', topic: 'finance', max_turns: 6 },
};

describe('AI test bench tables (AI-19 · tm 314.1)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  let agentA: string;
  let agentB: string;
  let brandA: string;
  let brandB: string;

  const asTenant = <T>(tenant: TenantFixture, fn: (tx: TenantClient) => Promise<T>) =>
    withTenant(app, { licenseId: tenant.licenseId, organizationId: tenant.organizationId }, fn);

  /** Run `fn` as the owner and roll it back; what it threw, or null. */
  async function attempt(fn: (tx: Writer) => Promise<unknown>): Promise<string | null> {
    try {
      await owner.$transaction(async (tx) => {
        await fn(tx);
        throw ROLLBACK;
      });
    } catch (error) {
      if (error === ROLLBACK) return null;
      return error instanceof Error ? error.message : String(error);
    }
    return null;
  }

  const scenario = (
    db: Writer,
    licenseId: bigint,
    aiAgentId: string,
    data: Data = {},
  ): Promise<AiTestScenario> =>
    db.aiTestScenario.create({
      data: { licenseId, aiAgentId, ...SCRIPT, ...data } as never,
    });

  const run = (
    db: Writer,
    licenseId: bigint,
    aiAgentId: string,
    data: Data = {},
  ): Promise<AiTestRun> =>
    db.aiTestRun.create({
      data: { licenseId, aiAgentId, configTarget: 'draft', trigger: 'manual', ...data } as never,
    });

  const result = (
    db: Writer,
    licenseId: bigint,
    runId: string,
    data: Data = {},
  ): Promise<AiTestRunResult> =>
    db.aiTestRunResult.create({
      data: {
        licenseId,
        runId,
        scenarioKey: 'compliance:G3:tr',
        scenarioName: 'G3 kriz',
        status: 'passed',
        stopReason: 'handoff',
        outcome: 'handoff',
        ...data,
      } as never,
    });

  const session = (
    db: Writer,
    licenseId: bigint,
    aiAgentId: string,
    createdBy: string,
    data: Data = {},
  ): Promise<AiSandboxSession> =>
    db.aiSandboxSession.create({
      data: {
        licenseId,
        aiAgentId,
        createdBy,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
        ...data,
      } as never,
    });

  beforeAll(() => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    const agent = (licenseId: bigint) =>
      owner.aiAgent.create({ data: { licenseId, name: 'Test AI' } }).then((a) => a.id);
    const brand = (licenseId: bigint, slug: string) =>
      owner.brand.create({ data: { licenseId, name: slug, slug } }).then((b) => b.id);
    [agentA, agentB, brandA, brandB] = await Promise.all([
      agent(fx.a.licenseId),
      agent(fx.b.licenseId),
      brand(fx.a.licenseId, 'a-one'),
      brand(fx.b.licenseId, 'b-one'),
    ]);
  });

  // =========================================================================
  // Tenant isolation
  // =========================================================================

  describe('tenant isolation (NFR-S4)', () => {
    it('turns RLS on for the four tables, each policy per licence on read and write', async () => {
      const security = await owner.$queryRaw<Array<{ relname: string; enabled: boolean }>>`
        SELECT relname, relrowsecurity AS enabled FROM pg_class
         WHERE relname = ANY(${TABLES}::text[]) AND relkind = 'r'`;
      expect(security.map((row) => row.relname).sort()).toEqual([...TABLES].sort());
      for (const row of security) expect(row.enabled, row.relname).toBe(true);

      const policies = await owner.$queryRaw<
        Array<{ tablename: string; policyname: string; qual: string; withCheck: string }>
      >`
        SELECT tablename, policyname, qual, with_check AS "withCheck" FROM pg_policies
         WHERE tablename = ANY(${TABLES}::text[])`;
      expect(policies).toHaveLength(TABLES.length);
      for (const policy of policies) {
        expect(policy.policyname).toBe(`${policy.tablename}_tenant`);
        expect(policy.qual, policy.tablename).toContain('siyahtus_current_license()');
        expect(policy.withCheck, policy.tablename).toContain('siyahtus_current_license()');
        // A scenario's brand is a label: the Test tab lists every brand's.
        expect(policy.qual, policy.tablename).not.toContain('siyahtus_current_brand()');
      }
    });

    it("never shows another licence's rows, and refuses writing one under its licence", async () => {
      const s = await scenario(owner, fx.a.licenseId, agentA);
      const r = await run(owner, fx.a.licenseId, agentA);
      await result(owner, fx.a.licenseId, r.id, { scenarioId: s.id, scenarioKey: s.id });
      await session(owner, fx.a.licenseId, agentA, fx.a.ownerAccountId);

      const counts = (t: TenantFixture) =>
        asTenant(t, async (tx) =>
          Promise.all([
            tx.aiTestScenario.count(),
            tx.aiTestRun.count(),
            tx.aiTestRunResult.count(),
            tx.aiSandboxSession.count(),
          ]),
        );
      expect(await counts(fx.a)).toEqual([1, 1, 1, 1]);
      expect(await counts(fx.b)).toEqual([0, 0, 0, 0]);

      // Licence A's own agent, written from licence B: the trigger's lookup, under
      // B's RLS, does not find it and refuses before the insert policy would.
      const writes: Array<(tx: TenantClient) => Promise<unknown>> = [
        (tx: TenantClient) => scenario(tx, fx.a.licenseId, agentA),
        (tx: TenantClient) => run(tx, fx.a.licenseId, agentA),
        (tx: TenantClient) => session(tx, fx.a.licenseId, agentA, fx.b.ownerAccountId),
      ];
      for (const write of writes) {
        await expect(asTenant(fx.b, write)).rejects.toThrow(
          /row-level security|Foreign key constraint/,
        );
      }
    });

    it("refuses another workspace's agent, brand, run or scenario under the writer's own licence", async () => {
      // The trigger raises `foreign_key_violation` (Prisma words it as a foreign
      // key error); the real foreign key would pass — every id here exists.
      const foreignAgent = /Foreign key constraint/;
      await expect(asTenant(fx.b, (tx) => scenario(tx, fx.b.licenseId, agentA))).rejects.toThrow(
        foreignAgent,
      );
      await expect(asTenant(fx.b, (tx) => run(tx, fx.b.licenseId, agentA))).rejects.toThrow(
        foreignAgent,
      );
      await expect(
        asTenant(fx.b, (tx) => session(tx, fx.b.licenseId, agentA, fx.b.ownerAccountId)),
      ).rejects.toThrow(foreignAgent);
      await expect(
        asTenant(fx.b, (tx) => scenario(tx, fx.b.licenseId, agentB, { brandId: brandA })),
      ).rejects.toThrow(/Foreign key constraint/);

      const runA = await run(owner, fx.a.licenseId, agentA);
      const scenarioA = await scenario(owner, fx.a.licenseId, agentA);
      await expect(asTenant(fx.b, (tx) => result(tx, fx.b.licenseId, runA.id))).rejects.toThrow(
        /Foreign key constraint/,
      );
      const runB = await run(owner, fx.b.licenseId, agentB);
      await expect(
        asTenant(fx.b, (tx) =>
          result(tx, fx.b.licenseId, runB.id, {
            scenarioId: scenarioA.id,
            scenarioKey: scenarioA.id,
          }),
        ),
      ).rejects.toThrow(/Foreign key constraint/);

      // Its own agent and brand pass.
      await expect(
        asTenant(fx.b, (tx) => scenario(tx, fx.b.licenseId, agentB, { brandId: brandB })),
      ).resolves.toMatchObject({ brandId: brandB });
      // Moving a row onto a foreign agent is the same write.
      const own = await scenario(owner, fx.b.licenseId, agentB);
      await expect(
        asTenant(fx.b, (tx) =>
          tx.aiTestScenario.update({ where: { id: own.id }, data: { aiAgentId: agentA } }),
        ),
      ).rejects.toThrow(foreignAgent);
    });
  });

  // =========================================================================
  // The application role's verbs
  // =========================================================================

  describe("the application role's verbs", () => {
    it('never deletes a run, never rewrites a result but its judge, never empties a table', async () => {
      const r = await run(owner, fx.a.licenseId, agentA);
      const res = await result(owner, fx.a.licenseId, r.id);

      await expect(
        asTenant(fx.a, (tx) => tx.aiTestRun.delete({ where: { id: r.id } })),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(fx.a, (tx) =>
          tx.aiTestRunResult.update({ where: { id: res.id }, data: { status: 'failed' } }),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        asTenant(fx.a, (tx) => tx.aiTestRunResult.delete({ where: { id: res.id } })),
      ).rejects.toThrow(/permission denied/);

      const judge = { score: 4, comment: 'Kibar, prosedüre uygun.' };
      await asTenant(fx.a, (tx) =>
        tx.aiTestRunResult.update({ where: { id: res.id }, data: { judge } }),
      );
      expect(
        (await owner.aiTestRunResult.findUniqueOrThrow({ where: { id: res.id } })).judge,
      ).toEqual(judge);

      // A run advances; a scenario and a session are edited and deleted.
      await asTenant(fx.a, (tx) =>
        tx.aiTestRun.update({
          where: { id: r.id },
          data: {
            status: 'running',
            startedAt: new Date(),
            leaseUntil: new Date(Date.now() + 60_000),
          },
        }),
      );
      const s = await scenario(owner, fx.a.licenseId, agentA);
      const sess = await session(owner, fx.a.licenseId, agentA, fx.a.ownerAccountId);
      await asTenant(fx.a, async (tx) => {
        await tx.aiTestScenario.update({ where: { id: s.id }, data: { active: false } });
        await tx.aiTestScenario.delete({ where: { id: s.id } });
        await tx.aiSandboxSession.delete({ where: { id: sess.id } });
      });

      for (const table of TABLES) {
        await expect(
          asTenant(fx.a, (tx) => tx.$executeRawUnsafe(`TRUNCATE ${table}`)),
          table,
        ).rejects.toThrow(/permission denied/);
      }
    });

    it('a deleted scenario leaves its results, keyed; a deleted agent takes everything', async () => {
      const s = await scenario(owner, fx.a.licenseId, agentA);
      const r = await run(owner, fx.a.licenseId, agentA);
      const res = await result(owner, fx.a.licenseId, r.id, {
        scenarioId: s.id,
        scenarioKey: s.id,
      });
      await session(owner, fx.a.licenseId, agentA, fx.a.ownerAccountId);

      await asTenant(fx.a, (tx) => tx.aiTestScenario.delete({ where: { id: s.id } }));
      const kept = await owner.aiTestRunResult.findUniqueOrThrow({ where: { id: res.id } });
      expect(kept).toMatchObject({ scenarioId: null, scenarioKey: s.id });

      await owner.aiAgent.delete({ where: { id: agentA } });
      expect(
        await Promise.all([
          owner.aiTestScenario.count({ where: { licenseId: fx.a.licenseId } }),
          owner.aiTestRun.count({ where: { licenseId: fx.a.licenseId } }),
          owner.aiTestRunResult.count({ where: { licenseId: fx.a.licenseId } }),
          owner.aiSandboxSession.count({ where: { licenseId: fx.a.licenseId } }),
        ]),
      ).toEqual([0, 0, 0, 0]);
    });

    it('a deleted brand leaves its scenarios, brandless', async () => {
      const s = await scenario(owner, fx.a.licenseId, agentA, { brandId: brandA });
      await owner.brand.delete({ where: { id: brandA } });
      expect(
        (await owner.aiTestScenario.findUniqueOrThrow({ where: { id: s.id } })).brandId,
      ).toBeNull();
    });
  });

  // =========================================================================
  // One vocabulary
  // =========================================================================

  describe('one vocabulary — the CHECKs, the types and the contract', () => {
    it('the CHECKs are the constants', () => {
      const sql = readFileSync(MIGRATION, 'utf8').replace(/\s+/g, ' ');
      const list = (values: readonly string[]) => values.map((value) => `'${value}'`).join(', ');
      expect(sql).toContain(`CHECK (origin IN (${list(AI_TEST_SCENARIO_ORIGINS)}))`);
      expect(sql).toContain(`CHECK (mode IN (${list(AI_TEST_SCENARIO_MODES)}))`);
      expect(sql).toContain(`CHECK (persona IN (${list(SCENARIO_PERSONAS)}))`);
      expect(sql).toContain(`CHECK (config_target IN (${list(AI_TEST_RUN_TARGETS)}))`);
      expect(sql).toContain(`CHECK (trigger IN (${list(AI_TEST_RUN_TRIGGERS)}))`);
      expect(sql).toContain(`CHECK (status IN (${list(AI_TEST_RUN_STATUSES)}))`);
      expect(sql).toContain(`CHECK (status IN (${list(AI_TEST_RESULT_STATUSES)}))`);
      expect(sql).toContain(`CHECK (stop_reason IN (${list(AI_TEST_STOP_REASONS)}))`);
      expect(sql).toContain(`outcome IN (${list(SCENARIO_OUTCOMES)})`);
      expect(sql).toContain(`BETWEEN 1 AND ${AI_TEST_SCENARIO_NAME_MAX}`);
      expect(sql).toContain(`jsonb_array_length(turns) <= ${AI_TEST_SCENARIO_TURNS_MAX}`);
      expect(sql).toContain(`scenario_count BETWEEN 0 AND ${AI_TEST_RUN_SCENARIOS_MAX}`);
      // The queue's (tm 314.2): the scenarios a run fixes, under the same bound.
      expect(readFileSync(QUEUE_MIGRATION, 'utf8').replace(/\s+/g, ' ')).toContain(
        `cardinality(scenario_ids) <= ${AI_TEST_RUN_SCENARIOS_MAX}`,
      );
    });

    it('the contract names the same lists and bounds', () => {
      const schemas = (
        loadOpenApiDocument() as unknown as { components: { schemas: Record<string, SchemaNode> } }
      ).components.schemas;
      const values = (name: string) => schemas[name]?.enum?.filter((v) => v !== null);
      expect(values('ScenarioPersona')).toEqual([...SCENARIO_PERSONAS]);
      expect(values('ScenarioOutcome')).toEqual([...SCENARIO_OUTCOMES]);
      expect(values('AiTestScenarioOrigin')).toEqual([...AI_TEST_SCENARIO_ORIGINS]);
      expect(values('AiTestScenarioMode')).toEqual([...AI_TEST_SCENARIO_MODES]);
      expect(values('AiTestRunTarget')).toEqual([...AI_TEST_RUN_TARGETS]);
      expect(values('AiTestRunTrigger')).toEqual([...AI_TEST_RUN_TRIGGERS]);
      expect(values('AiTestRunStatus')).toEqual([...AI_TEST_RUN_STATUSES]);
      expect(values('AiTestResultStatus')).toEqual([...AI_TEST_RESULT_STATUSES]);
      expect(values('AiTestStopReason')).toEqual([...AI_TEST_STOP_REASONS]);
      expect(values('AiTestCheckKind')).toEqual([...AI_TEST_CHECK_KINDS]);

      const input = schemas['AiTestScenarioInput']!.properties!;
      expect(input['name']!.maxLength).toBe(AI_TEST_SCENARIO_NAME_MAX);
      expect(input['turns']!.maxItems).toBe(AI_TEST_SCENARIO_TURNS_MAX);
      const maxTurns = schemas['AiTestExpectations']!.properties!['max_turns']!;
      expect(maxTurns.maximum).toBe(AI_TEST_MAX_TURNS_LIMIT);
      expect(maxTurns.default).toBe(AI_TEST_MAX_TURNS_DEFAULT);
      expect(schemas['AiTestRun']!.properties!['scenario_count']!.maximum).toBe(
        AI_TEST_RUN_SCENARIOS_MAX,
      );
      expect(schemas['AiTestRunCreate']!.properties!['scenario_ids']!.maxItems).toBe(
        AI_TEST_RUN_SCENARIOS_MAX,
      );
      // The judge's rubric and the regression report (tm 314.3).
      const judge = schemas['AiTestJudgeVerdict']!.properties!;
      expect(Object.keys(judge['criteria']!.properties!)).toEqual([...AI_TEST_JUDGE_CRITERIA]);
      expect(judge['score']!.maximum).toBe(AI_TEST_JUDGE_SCORE_MAX);
      expect(judge['comment']!.maxLength).toBe(AI_TEST_JUDGE_COMMENT_MAX);
      expect(
        schemas['AiTestRunResult']!.properties!['regression']!.enum!.filter((v) => v !== null),
      ).toEqual([...AI_TEST_REGRESSIONS]);
    });

    it.each([
      ['origin', AI_TEST_SCENARIO_ORIGINS],
      ['mode', AI_TEST_SCENARIO_MODES],
      ['persona', SCENARIO_PERSONAS],
    ] as const)(
      'a scenario admits every %s the types list, and nothing else',
      async (field, list) => {
        for (const value of list) {
          const extra = value === 'simulated' ? { goal: 'Paramı geri istiyorum' } : {};
          expect(
            await attempt((tx) =>
              scenario(tx, fx.a.licenseId, agentA, { [field]: value, ...extra }),
            ),
            `${field}=${value}`,
          ).toBeNull();
        }
        expect(
          await attempt((tx) => scenario(tx, fx.a.licenseId, agentA, { [field]: 'nope' })),
        ).toMatch(/check constraint/i);
      },
    );
  });

  // =========================================================================
  // What a row must say
  // =========================================================================

  describe('what a row must say', () => {
    const tryScenario = (data: Data) => attempt((tx) => scenario(tx, fx.a.licenseId, agentA, data));

    it('a script has a message, a simulated player a goal — the validator and the CHECK agree', async () => {
      const body = (data: Record<string, unknown>) => ({
        mode: 'scripted',
        persona: 'normal',
        language: 'tr',
        facts: {},
        tool_outputs: {},
        ...SCRIPT,
        ...data,
      });
      const cases: Array<[Record<string, unknown>, Data]> = [
        [{ turns: [] }, { turns: [] }],
        [
          { mode: 'simulated', turns: [] },
          { mode: 'simulated', turns: [] },
        ],
        [{ language: 'TUR' }, { language: 'TUR' }],
        [{ name: ' ' }, { name: ' ' }],
        [
          { turns: Array.from({ length: 31 }, () => 'a') },
          { turns: Array.from({ length: 31 }, () => 'a') },
        ],
        [{ expectations: { outcome: 'resolved' } }, { expectations: { outcome: 'resolved' } }],
        [{ facts: [] }, { facts: [] }],
      ];
      for (const [input, row] of cases) {
        expect(validateAiTestScenario(body(input)), JSON.stringify(input)).not.toEqual([]);
        expect(await tryScenario(row), JSON.stringify(row)).toMatch(/check constraint/i);
      }
      expect(validateAiTestScenario(body({}))).toEqual([]);
      expect(await tryScenario({})).toBeNull();
      expect(
        await tryScenario({ mode: 'simulated', turns: [], goal: 'Çekimimin durumunu öğrenmek' }),
      ).toBeNull();
      expect(await tryScenario({ expectations: { ...defaultAiTestExpectations() } })).toBeNull();
    });

    it('a version run names its version, and only it; a draft revision is a draft run’s', async () => {
      const tryRun = (data: Data) => attempt((tx) => run(tx, fx.a.licenseId, agentA, data));
      const version = crypto.randomUUID();
      expect(await tryRun({ configTarget: 'version' })).toMatch(/check constraint/i);
      expect(await tryRun({ configTarget: 'published', configVersionId: version })).toMatch(
        /check constraint/i,
      );
      expect(await tryRun({ configTarget: 'version', configVersionId: version })).toBeNull();
      expect(await tryRun({ configTarget: 'published', draftRevision: 3 })).toMatch(
        /check constraint/i,
      );
      expect(await tryRun({ configTarget: 'draft', draftRevision: 3 })).toBeNull();
    });

    it('a pre-publish run carries the compliance pack, its counts all or none (AI-19-S1)', async () => {
      const tryRun = (data: Data) => attempt((tx) => run(tx, fx.a.licenseId, agentA, data));
      const pack = { compliancePackVersion: '1', compliancePassed: 0, complianceFailed: 0 };
      expect(await tryRun({ trigger: 'pre_publish' })).toMatch(/check constraint/i);
      expect(await tryRun({ trigger: 'pre_publish', ...pack })).toBeNull();
      expect(await tryRun({ compliancePackVersion: '1' })).toMatch(/check constraint/i);
      // The pack's verdicts are a share of the run's.
      expect(
        await tryRun({
          ...pack,
          scenarioCount: 14,
          passed: 13,
          failed: 1,
          compliancePassed: 13,
          complianceFailed: 1,
        }),
      ).toBeNull();
      expect(
        await tryRun({ ...pack, scenarioCount: 14, passed: 12, failed: 2, compliancePassed: 13 }),
      ).toMatch(/check constraint/i);
      expect(await tryRun({ scenarioCount: 2, passed: 2, failed: 1 })).toMatch(/check constraint/i);
      expect(await tryRun({ scenarioCount: AI_TEST_RUN_SCENARIOS_MAX + 1 })).toMatch(
        /check constraint/i,
      );
    });

    it('an ended run says when, a playing one since when; only a failed run carries an error', async () => {
      const tryRun = (data: Data) => attempt((tx) => run(tx, fx.a.licenseId, agentA, data));
      const now = new Date();
      // A playing run holds its worker's lease (tm 314.2) — beside the point here.
      const lease = { leaseUntil: new Date(now.getTime() + 60_000) };
      expect(await tryRun({ status: 'completed' })).toMatch(/check constraint/i);
      expect(await tryRun({ status: 'completed', finishedAt: now })).toBeNull();
      expect(await tryRun({ status: 'queued', finishedAt: now })).toMatch(/check constraint/i);
      expect(await tryRun({ status: 'running', ...lease })).toMatch(/check constraint/i);
      expect(await tryRun({ status: 'running', startedAt: now, ...lease })).toBeNull();
      expect(
        await tryRun({ status: 'failed', finishedAt: now, error: 'provider_down' }),
      ).toBeNull();
      expect(await tryRun({ status: 'completed', finishedAt: now, error: 'x' })).toMatch(
        /check constraint/i,
      );
    });

    it('a playing run holds a lease and an ended one none; one open run per agent and target, one playing per workspace (tm 314.2)', async () => {
      const tryRun = (data: Data) => attempt((tx) => run(tx, fx.a.licenseId, agentA, data));
      const now = new Date();
      const lease = new Date(now.getTime() + 60_000);
      // `ai_test_runs_claim` skips a playing run with no lease: the workspace's queue would stop for good.
      expect(await tryRun({ status: 'running', startedAt: now })).toMatch(/check constraint/i);
      expect(await tryRun({ status: 'completed', finishedAt: now, leaseUntil: lease })).toMatch(
        /check constraint/i,
      );
      expect(await tryRun({ attempts: -1 })).toMatch(/check constraint/i);
      const ids = (n: number) => Array.from({ length: n }, () => crypto.randomUUID());
      expect(await tryRun({ scenarioIds: ids(AI_TEST_RUN_SCENARIOS_MAX) })).toBeNull();
      expect(await tryRun({ scenarioIds: ids(AI_TEST_RUN_SCENARIOS_MAX + 1) })).toMatch(
        /check constraint/i,
      );

      const playing = { status: 'running', startedAt: now, leaseUntil: lease };
      const twice = (first: Data, second: Data) =>
        attempt(async (tx) => {
          await run(tx, fx.a.licenseId, agentA, first);
          await run(tx, fx.a.licenseId, agentA, second);
        });
      expect(await twice({}, {})).toMatch(/unique constraint/i);
      expect(await twice({}, playing)).toMatch(/unique constraint/i);
      expect(await twice(playing, { configTarget: 'published', ...playing })).toMatch(
        /unique constraint/i,
      );
      // Queued beside a playing run of another target, or after an ended one of the same: fine.
      expect(await twice(playing, { configTarget: 'published' })).toBeNull();
      expect(await twice({ status: 'completed', finishedAt: now }, {})).toBeNull();
      // Another workspace's playing run is its own.
      expect(
        await attempt(async (tx) => {
          await run(tx, fx.a.licenseId, agentA, playing);
          await run(tx, fx.b.licenseId, agentB, playing);
        }),
      ).toBeNull();
    });

    it("errored is exactly 'could not be played'; a key is its scenario's id or a compliance key, once per run", async () => {
      const r = await run(owner, fx.a.licenseId, agentA);
      const s = await scenario(owner, fx.a.licenseId, agentA);
      const tryResult = (data: Data) => attempt((tx) => result(tx, fx.a.licenseId, r.id, data));

      expect(
        await tryResult({ status: 'errored', stopReason: 'timeout', outcome: null }),
      ).toBeNull();
      expect(await tryResult({ status: 'errored', stopReason: 'max_turns' })).toMatch(
        /check constraint/i,
      );
      expect(await tryResult({ status: 'failed', stopReason: 'error' })).toMatch(
        /check constraint/i,
      );
      expect(
        await tryResult({ status: 'failed', stopReason: 'max_turns', outcome: null }),
      ).toBeNull();

      expect(await tryResult({ scenarioKey: 'compliance:G20:tr' })).toMatch(/check constraint/i);
      expect(await tryResult({ scenarioKey: 'papara' })).toMatch(/check constraint/i);
      expect(await tryResult({ scenarioId: s.id, scenarioKey: 'compliance:G3:tr' })).toMatch(
        /check constraint/i,
      );
      expect(await tryResult({ scenarioId: s.id, scenarioKey: s.id })).toBeNull();
      expect(await tryResult({ judge: [] })).toMatch(/check constraint/i);

      await result(owner, fx.a.licenseId, r.id);
      await expect(result(owner, fx.a.licenseId, r.id)).rejects.toThrow(/unique/i);
    });

    it('a sandbox session expires after it starts; a version session names its version', async () => {
      const trySession = (data: Data) =>
        attempt((tx) => session(tx, fx.a.licenseId, agentA, fx.a.ownerAccountId, data));
      expect(await trySession({ expiresAt: new Date(Date.now() - 1000) })).toMatch(
        /check constraint/i,
      );
      expect(await trySession({ configTarget: 'version' })).toMatch(/check constraint/i);
      expect(
        await trySession({ configTarget: 'version', configVersionId: crypto.randomUUID() }),
      ).toBeNull();
      expect(await trySession({ transcript: {} })).toMatch(/check constraint/i);
    });
  });
});
