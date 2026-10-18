/**
 * A workspace's own daily AI cap, the usage ledger and the test meters
 * (tm 283.2 · SiyahTuş analysis AI-16, AI-19-S2 · PLAN §D231).
 *
 * Real Postgres and Redis; the model is a scripted provider with id `openai`
 * (counted, like any real model). What is held:
 *
 *   1. Through the real server: a workspace whose licence carries a 500,000
 *      override answers past the deployment's 200,000 default while another
 *      workspace stops there (AI-16's acceptance criterion), and the answer
 *      leaves one ledger row naming the AI agent, the conversation and the
 *      tier. A cap changed on the licence is announced on `ai.caps_changed`
 *      and takes effect at once; unannounced, the cached minute holds.
 *   2. Over the application role, as the server's budget runs: the override
 *      outranks the deployment's default; a simulation is counted on
 *      `llm_test` — a fifth of the live allowance, its own row — and on the
 *      deployment's live row; ten simulations reserving at once on ten
 *      connections let exactly the ones that fit through.
 *   3. The ledger: one row per call that cost something, adding up to the
 *      counter per meter; a row the ledger refuses leaves the counter settled
 *      and is logged.
 *   4. The boundaries: a workspace reads its own ledger rows only and writes
 *      none; the application role cannot change any workspace's cap, its own
 *      included, while it still writes the licence's other columns; the
 *      tables refuse a meter, a surface or a cap they do not know.
 */
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import {
  listenForAiCapsChanges,
  publishAiCapsChanged,
} from '../../src/services/ai/ai-caps-events.js';
import {
  AiDailyBudget,
  AiDailyCapError,
  aiDailyCaps,
  utcDayKey,
  type AiReservation,
} from '../../src/services/ai/ai-daily-budget.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
} from '../../src/services/ai/provider/llm-provider.js';
import { LineSink, customerAsks, seedAiWorkspace } from '../helpers/ai-workspace.js';
import { ownerClient, seedFixtures, testEnv, type Fixtures } from '../helpers/fixtures.js';
import { asKnowledgeAnswer } from '../helpers/knowledge-answer.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** The deployment's per-workspace LLM default — `AI_DAILY_LLM_TOKENS_PER_WORKSPACE`'s. */
const DEFAULT_CAP = 200_000;
const OVERRIDE = 500_000;
const REPLY = 'Written by the scripted model.';

/** A counted model that answers every call for 100 tokens in and 10 out. */
class ScriptedLlm implements LlmProvider {
  readonly id = 'openai' as const;
  readonly calls: LlmCompletionRequest[] = [];

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    return {
      text: asKnowledgeAnswer(REPLY, request),
      usage: { inputTokens: 100, outputTokens: 10 },
    };
  }
}

const today = () => utcDayKey(new Date());

describe('a workspace’s own daily AI cap, the usage ledger and the test meters (tm 283.2)', () => {
  let owner: PrismaClient;

  /** Today's counter for a workspace, or the deployment's (`null`), on `meter`. */
  async function usage(licenseId: bigint | null, meter = 'llm') {
    const row = await owner.aiDailyUsage.findFirst({ where: { licenseId, day: today(), meter } });
    return row ? { reserved: Number(row.reserved), used: Number(row.used) } : null;
  }

  async function seedUsage(licenseId: bigint | null, used: number, meter = 'llm') {
    await owner.aiDailyUsage.create({
      data: { licenseId, day: today(), meter, used: BigInt(used) },
    });
  }

  async function ledger(licenseId: bigint) {
    const rows = await owner.aiUsageEvent.findMany({
      where: { licenseId },
      orderBy: { at: 'asc' },
      select: {
        day: true,
        surface: true,
        meter: true,
        modelTier: true,
        inputTokens: true,
        outputTokens: true,
        chatId: true,
        configVersionId: true,
      },
    });
    return rows.map((row) => ({
      ...row,
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
    }));
  }

  async function setOverride(licenseId: bigint, llm: number | null) {
    await owner.license.update({
      where: { id: licenseId },
      data: { aiDailyLlmTokensCap: llm === null ? null : BigInt(llm) },
    });
  }

  const answered = (asked: { events: Array<{ authorType: string; text: string | null }> }) =>
    asked.events.filter((e) => e.authorType === 'bot').map((e) => e.text);

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  // ==========================================================================
  // 1. Through the real server
  // ==========================================================================

  describe('through the real server, on the deployment’s default caps', () => {
    const llm = new ScriptedLlm();
    const log = new LineSink();
    let server: TestServer;

    beforeAll(async () => {
      server = await startTestServer(
        { LOG_LEVEL: 'warn' },
        { llm, logStream: log as unknown as NodeJS.WritableStream },
      );
      // Every counter emptied, the deployment's row included — once, before
      // the server has cached anyone's caps. Not per test: the reset restarts
      // the licence ids, and a workspace reusing an id would inherit the caps
      // the server cached for the last one to hold it (a test-only hazard —
      // a deployment never reuses a licence id).
      await seedFixtures(owner);
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      await clearRateLimits(server.app);
      llm.calls.length = 0;
      log.lines.length = 0;
    });

    it('answers past 200,000 for the workspace with a 500,000 override, and stops every other workspace there (AI-16)', async () => {
      const x = await seedAiWorkspace(owner);
      const y = await seedAiWorkspace(owner);
      await setOverride(x.licenseId, OVERRIDE);
      await seedUsage(x.licenseId, DEFAULT_CAP);
      await seedUsage(y.licenseId, DEFAULT_CAP);

      const fromX = await customerAsks(owner, server, x);
      const fromY = await customerAsks(owner, server, y);

      expect(answered(fromX)).toEqual([REPLY]);
      expect(answered(fromY)).toEqual([]);
      expect(llm.calls).toHaveLength(1);
      expect(await usage(x.licenseId)).toEqual({ reserved: 0, used: DEFAULT_CAP + 110 });
      expect(await usage(y.licenseId)).toEqual({ reserved: 0, used: DEFAULT_CAP });
      expect(log.events('ai.cap_reached').map((line) => line['license_id'])).toEqual([
        y.licenseId.toString(),
      ]);

      // The answer is in the ledger: the AI agent, the conversation, the tier
      // it asked for, the provider's split — on the counter's day.
      expect(await ledger(x.licenseId)).toEqual([
        {
          day: today(),
          surface: 'ai_agent',
          meter: 'llm',
          modelTier: 'default',
          inputTokens: 100,
          outputTokens: 10,
          chatId: fromX.chatId,
          configVersionId: null,
        },
      ]);
      expect(await ledger(y.licenseId)).toEqual([]);
    });

    it('takes a changed cap at once when ai.caps_changed names the workspace — and holds the cached one until then', async () => {
      const y = await seedAiWorkspace(owner);
      await seedUsage(y.licenseId, DEFAULT_CAP);
      expect(answered(await customerAsks(owner, server, y))).toEqual([]);

      // Raised on the licence; nobody said so, and the server's minute holds.
      await setOverride(y.licenseId, OVERRIDE);
      expect(answered(await customerAsks(owner, server, y))).toEqual([]);
      expect(llm.calls).toHaveLength(0);

      await publishAiCapsChanged(server.app.redis, y.licenseId);
      // Delivery is asynchronous; the minute is far longer than this wait, so
      // an answer here can only be the announcement's doing.
      const deadline = Date.now() + 5_000;
      let reply: Array<string | null> = [];
      while (Date.now() < deadline) {
        await clearRateLimits(server.app);
        reply = answered(await customerAsks(owner, server, y));
        if (reply.length > 0) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(reply).toEqual([REPLY]);
      expect(llm.calls).toHaveLength(1);
    });
  });

  // ==========================================================================
  // 2–4. Over the application role, as the server's budget runs
  // ==========================================================================

  describe('over the application role', () => {
    let app: PrismaClient;
    let fx: Fixtures;
    const warnings: Array<Record<string, unknown>> = [];
    const errors: Array<Record<string, unknown>> = [];
    const logger = {
      warn: (details: Record<string, unknown>) => warnings.push(details),
      error: (details: Record<string, unknown>) => errors.push(details),
    };

    /** The server's budget: deployment defaults from the environment, the licence and plan read per call. */
    const budgetOver = (db: PrismaClient, env: Partial<NodeJS.ProcessEnv> = {}) =>
      new AiDailyBudget(db, aiDailyCaps(testEnv(env)), { logger, capTtlMs: 0 });

    const tenantOf = (t: Fixtures['a']): TenantContext => ({
      licenseId: t.licenseId,
      organizationId: t.organizationId,
    });

    beforeAll(() => {
      if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
      app = new PrismaClient({ datasourceUrl: APP_URL });
    });

    afterAll(async () => {
      await app.$disconnect();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      warnings.length = 0;
      errors.length = 0;
    });

    it('checks a workspace against its licence’s override, and the rest against the deployment’s default', async () => {
      const budget = budgetOver(app, { AI_DAILY_LLM_TOKENS_PER_WORKSPACE: '100' });
      await setOverride(fx.a.licenseId, 1_000);

      await budget.reserve(tenantOf(fx.a), 'llm', 900, { surface: 'copilot' });
      await expect(
        budget.reserve(tenantOf(fx.b), 'llm', 101, { surface: 'copilot' }),
      ).rejects.toMatchObject({ meter: 'llm', scope: 'workspace' });
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 900, used: 0 });

      // Back to inheriting: the deployment's 100 applies to A as well.
      await setOverride(fx.a.licenseId, null);
      await expect(
        budget.reserve(tenantOf(fx.a), 'llm', 1, { surface: 'copilot' }),
      ).rejects.toBeInstanceOf(AiDailyCapError);
    });

    it('counts a simulation on llm_test, a fifth of the live allowance, and on the deployment’s live row (AI-19-S2)', async () => {
      const budget = budgetOver(app);
      await setOverride(fx.a.licenseId, 1_000);
      const a = tenantOf(fx.a);

      const simulated = await budget.reserve(a, 'llm', 200, { surface: 'simulation' }, 'fast');
      expect(simulated.meter).toBe('llm_test');
      await expect(budget.reserve(a, 'llm', 1, { surface: 'simulation' })).rejects.toMatchObject({
        meter: 'llm_test',
        scope: 'workspace',
      });
      expect(warnings.map((w) => w['meter'])).toEqual(['llm_test']);
      // The live allowance is untouched by the test spend.
      const live = await budget.reserve(a, 'llm', 1_000, { surface: 'ai_agent' });

      expect(await usage(fx.a.licenseId, 'llm_test')).toEqual({ reserved: 200, used: 0 });
      expect(await usage(fx.a.licenseId, 'llm')).toEqual({ reserved: 1_000, used: 0 });
      // One provider key, one deployment cap: both on its live row.
      expect(await usage(null, 'llm')).toEqual({ reserved: 1_200, used: 0 });
      expect(await usage(null, 'llm_test')).toBeNull();

      await budget.settle(simulated, { inputTokens: 30, outputTokens: 5 });
      await budget.settle(live, { inputTokens: 100, outputTokens: 10 });
      expect(await usage(fx.a.licenseId, 'llm_test')).toEqual({ reserved: 0, used: 35 });
      expect(await usage(null, 'llm')).toEqual({ reserved: 0, used: 145 });
      expect(
        (await ledger(fx.a.licenseId)).map((row) => [row.surface, row.meter, row.modelTier]),
      ).toEqual([
        ['simulation', 'llm_test', 'fast'],
        // No tier given: a completion is counted as the default model's.
        ['ai_agent', 'llm', 'default'],
      ]);
      expect(errors).toEqual([]);
    });

    it('lets exactly the simulations that fit through when ten reserve at once on ten connections', async () => {
      // Test allowance 200 (a fifth of 1,000), 60 a call: three fit.
      await setOverride(fx.a.licenseId, 1_000);
      const clients = Array.from(
        { length: 10 },
        () => new PrismaClient({ datasourceUrl: APP_URL }),
      );
      try {
        await Promise.all(clients.map((client) => client.$connect()));
        const budgets = clients.map((client) => budgetOver(client));
        const outcomes = await Promise.allSettled(
          budgets.map((budget) =>
            budget.reserve(tenantOf(fx.a), 'llm', 60, { surface: 'simulation' }),
          ),
        );

        const kept = outcomes.filter((o) => o.status === 'fulfilled');
        const refused = outcomes.flatMap((o) => (o.status === 'rejected' ? [o.reason] : []));
        expect(kept).toHaveLength(3);
        expect(refused).toHaveLength(7);
        for (const reason of refused) {
          expect(reason).toBeInstanceOf(AiDailyCapError);
          expect(reason).toMatchObject({ meter: 'llm_test', scope: 'workspace' });
        }
        expect(await usage(fx.a.licenseId, 'llm_test')).toEqual({ reserved: 180, used: 0 });
        expect(await usage(null, 'llm')).toEqual({ reserved: 180, used: 0 });
      } finally {
        await Promise.all(clients.map((client) => client.$disconnect()));
      }
    });

    it('writes one ledger row per call that cost something, adding up to the counter per meter', async () => {
      const budget = budgetOver(app);
      const a = tenantOf(fx.a);
      const settle = async (
        meter: 'llm' | 'embedding',
        attribution: Parameters<AiDailyBudget['reserve']>[3],
        input: number,
        output: number,
      ) =>
        budget.settle(await budget.reserve(a, meter, 1_000, attribution), {
          inputTokens: input,
          outputTokens: output,
        });

      await settle('llm', { surface: 'copilot', chatId: 'CHAT00000001' }, 120, 30);
      await settle('llm', { surface: 'ai_agent', chatId: 'CHAT00000002' }, 80, 20);
      await settle('embedding', { surface: 'knowledge_index' }, 400, 0);
      // A refusal the provider answered (rate limited, auth…) cost nothing: no row.
      await settle('llm', { surface: 'qa' }, 0, 0);

      const rows = await ledger(fx.a.licenseId);
      expect(rows.map((row) => [row.surface, row.meter, row.modelTier, row.chatId])).toEqual([
        ['copilot', 'llm', 'default', 'CHAT00000001'],
        ['ai_agent', 'llm', 'default', 'CHAT00000002'],
        ['knowledge_index', 'embedding', null, null],
      ]);
      for (const meter of ['llm', 'embedding'] as const) {
        const sum = rows
          .filter((row) => row.meter === meter)
          .reduce((total, row) => total + row.inputTokens + row.outputTokens, 0);
        expect(await usage(fx.a.licenseId, meter), meter).toEqual({ reserved: 0, used: sum });
      }
      expect(await usage(fx.a.licenseId, 'llm')).toEqual({ reserved: 0, used: 250 });
      expect(errors).toEqual([]);
    });

    it('keeps the counter settled when the ledger refuses the row, and says so once', async () => {
      const budget = budgetOver(app);
      const reservation = await budget.reserve(tenantOf(fx.a), 'llm', 500, {
        surface: 'copilot',
        // Not a chat id: thirteen characters where the column holds twelve.
        chatId: 'NOT-A-CHAT-ID',
      });

      await budget.settle(reservation, { inputTokens: 40, outputTokens: 2 });

      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: 42 });
      expect(await usage(null)).toEqual({ reserved: 0, used: 42 });
      expect(await ledger(fx.a.licenseId)).toEqual([]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({
        event: 'ai.usage_ledger_failed',
        license_id: fx.a.licenseId.toString(),
        meter: 'llm',
        surface: 'copilot',
        input_tokens: 40,
        output_tokens: 2,
      });
      expect(String(errors[0]!['reason'])).toMatch(/^22001 /);
    });

    it('settles the reservation on the meter it was counted on, never a live row for a test one', async () => {
      const budget = budgetOver(app);
      const reservation: AiReservation = await budget.reserve(tenantOf(fx.a), 'embedding', 300, {
        surface: 'simulation',
      });
      expect(reservation.meter).toBe('embedding_test');
      await budget.settle(reservation, { inputTokens: 120, outputTokens: 0 });

      expect(await usage(fx.a.licenseId, 'embedding_test')).toEqual({ reserved: 0, used: 120 });
      expect(await usage(fx.a.licenseId, 'embedding')).toBeNull();
      expect(await usage(null, 'embedding')).toEqual({ reserved: 0, used: 120 });
      expect(await ledger(fx.a.licenseId)).toMatchObject([
        { surface: 'simulation', meter: 'embedding_test', modelTier: null, inputTokens: 120 },
      ]);
    });

    it('shows a workspace its own ledger rows only, and lets the application role write none', async () => {
      const budget = budgetOver(app);
      for (const t of [fx.a, fx.b]) {
        const reservation = await budget.reserve(tenantOf(t), 'llm', 100, { surface: 'copilot' });
        await budget.settle(reservation, { inputTokens: 10, outputTokens: 1 });
      }

      const seen = await withTenant(app, tenantOf(fx.a), (tx) =>
        tx.aiUsageEvent.findMany({ select: { licenseId: true } }),
      );
      expect(seen).toEqual([{ licenseId: fx.a.licenseId }]);
      expect(await app.aiUsageEvent.count()).toBe(0);

      await expect(
        withTenant(
          app,
          tenantOf(fx.a),
          (tx) => tx.$executeRaw`
            INSERT INTO ai_usage_events (id, license_id, day, at, surface, meter, model_tier,
                                         input_tokens, output_tokens)
            VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${today()}, now(), 'copilot', 'llm',
                    'default', 1, 1)`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withTenant(
          app,
          tenantOf(fx.a),
          (tx) => tx.$executeRaw`UPDATE ai_usage_events SET input_tokens = 0`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withTenant(app, tenantOf(fx.a), (tx) => tx.$executeRaw`DELETE FROM ai_usage_events`),
      ).rejects.toThrow(/permission denied/);
      expect(await owner.aiUsageEvent.count()).toBe(2);
    });

    it('refuses the ledger’s settle without a tenant, and a meter or day it does not know', async () => {
      await expect(
        app.$queryRaw`SELECT ai_budget_settle_usage(${today()}, 'llm', ${1n}, ${1n}, ${0n},
          'copilot', 'default', NULL, NULL)`,
      ).rejects.toThrow(/needs a tenant context/);
      for (const [day, meter] of [
        [today(), 'tokens'],
        ['2026-10-15', 'llm'],
      ]) {
        await expect(
          withTenant(
            app,
            tenantOf(fx.a),
            (tx) => tx.$queryRaw`SELECT ai_budget_settle_usage(${day}, ${meter}, ${1n}, ${1n},
              ${0n}, 'copilot', 'default', NULL, NULL)`,
          ),
        ).rejects.toThrow(/invalid argument/);
      }
    });

    it('refuses the application role a change to any workspace’s cap, its own included — the platform sets it', async () => {
      await expect(
        withTenant(app, tenantOf(fx.a), (tx) =>
          tx.license.update({
            where: { id: fx.a.licenseId },
            data: { aiDailyLlmTokensCap: 5_000_000n },
          }),
        ),
      ).rejects.toThrow(/set by the platform/);
      await expect(
        withTenant(app, tenantOf(fx.a), (tx) =>
          tx.license.update({
            where: { id: fx.a.licenseId },
            data: { aiDailyEmbeddingTokensCap: 5_000_000n },
          }),
        ),
      ).rejects.toThrow(/set by the platform/);

      // The rest of the licence is still the workspace's to write.
      const at = new Date();
      await withTenant(app, tenantOf(fx.a), (tx) =>
        tx.license.update({ where: { id: fx.a.licenseId }, data: { surveyAnsweredAt: at } }),
      );
      // The owner — psql, the platform — may; and the cap is at least 1 when set.
      await setOverride(fx.a.licenseId, OVERRIDE);
      await expect(setOverride(fx.a.licenseId, 0)).rejects.toThrow(/licenses_ai_daily_caps_check/);
      expect(
        await owner.license.findUniqueOrThrow({
          where: { id: fx.a.licenseId },
          select: {
            aiDailyLlmTokensCap: true,
            aiDailyEmbeddingTokensCap: true,
            surveyAnsweredAt: true,
          },
        }),
      ).toEqual({
        aiDailyLlmTokensCap: 500_000n,
        aiDailyEmbeddingTokensCap: null,
        surveyAnsweredAt: at,
      });
    });

    it('refuses a meter, a surface or a tier the tables do not know', async () => {
      await expect(seedUsage(fx.a.licenseId, 1, 'tokens')).rejects.toThrow(
        /ai_daily_usage_meter_check/,
      );
      const row = (surface: string, meter: string, tier: string | null) =>
        owner.$executeRaw`
          INSERT INTO ai_usage_events (id, license_id, day, at, surface, meter, model_tier,
                                       input_tokens, output_tokens)
          VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${today()}, now(), ${surface}, ${meter},
                  ${tier}, 1, 1)`;
      await expect(row('widget', 'llm', 'default')).rejects.toThrow(
        /ai_usage_events_surface_check/,
      );
      await expect(row('copilot', 'tokens', 'default')).rejects.toThrow(
        /ai_usage_events_meter_check/,
      );
      await expect(row('copilot', 'llm', null)).rejects.toThrow(/ai_usage_events_model_tier_check/);
      await expect(row('copilot', 'llm', 'large')).rejects.toThrow(
        /ai_usage_events_model_tier_check/,
      );
      await expect(row('knowledge_index', 'embedding', 'fast')).rejects.toThrow(
        /ai_usage_events_model_tier_check/,
      );
      await row('knowledge_index', 'embedding', null);
      expect(await owner.aiUsageEvent.count()).toBe(1);
    });
  });

  // ==========================================================================
  // The announcement itself
  // ==========================================================================

  describe('ai.caps_changed', () => {
    let publisher: Redis;
    let subscriber: Redis;

    beforeAll(() => {
      const env = testEnv();
      publisher = new Redis(env.REDIS_URL);
      subscriber = new Redis(env.REDIS_URL);
    });

    afterEach(() => {
      subscriber.removeAllListeners('message');
    });

    afterAll(async () => {
      await publisher.quit();
      await subscriber.quit();
    });

    it('names one workspace by its licence, and every workspace with null', async () => {
      const heard: Array<bigint | undefined> = [];
      await listenForAiCapsChanges(subscriber, (licenseId) => heard.push(licenseId));

      await publishAiCapsChanged(publisher, 42n);
      await publishAiCapsChanged(publisher, null);
      const deadline = Date.now() + 5_000;
      while (heard.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(heard).toEqual([42n, undefined]);
    });
  });
});
