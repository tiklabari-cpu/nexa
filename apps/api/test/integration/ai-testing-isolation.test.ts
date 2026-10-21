/**
 * A simulation writes nothing of the workspace's (tm 314.2 · SiyahTuş
 * analysis AI-19 §6 and its acceptance: "Taslak üzerinde koşu yapıldıktan
 * sonra canlı sohbetlerde, skill_runs tablosunda, raporlarda ve faturada
 * hiçbir değişiklik olmaz").
 *
 *   1. **The negative test.** A workspace with a live conversation the AI has
 *      answered and a webhook on every action plays a draft
 *      run — a hand-over to Finance, the wait, a self-exclusion request that
 *      raises its flag and hands over, a knowledge answer — and three sandbox
 *      turns. Every table of the database is hashed before and after: only the
 *      test bench's own rows changed. The server publishes nothing to RTM and
 *      makes no webhook attempt. What
 *      the reports and the invoice read (`chats`, `threads`, `events`,
 *      `skill_runs`, `skills.runs_count`, `usage_records`, …) is among what did
 *      not change.
 *   2. **The shield on the real tables.** Inside the simulation context a chat
 *      event, a customer, a rating, `skills.runs_count`, an AI resolution on the
 *      invoice and an RTM push each refuse, and nothing changed.
 *   3. **The test meter.** With a counted model the run's tokens are on
 *      `llm_test` and the live meter is untouched (AI-19 "Test token'ları canlı
 *      kotayı azaltmaz"); a spent test allowance is 429 on `llm_test` while the
 *      live one still has room.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { splitSkillProcedure, type AiTestTranscriptEntry } from '@siyahtus/types';
import { runInSimulation, SimulationWriteRefusedError } from '../../src/lib/simulation-context.js';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { botPrincipal } from '../../src/services/ai/handoff-service.js';
import { recordAiResolution } from '../../src/services/billing/metering.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { RealtimePublisher } from '../../src/services/realtime/publisher.js';
import { WEBHOOK_ACTIONS } from '../../src/services/webhooks/webhook-service.js';
import {
  AI_PASSAGE,
  AI_QUESTION,
  customerAsks,
  seedAiWorkspace,
  type AiWorkspace,
} from '../helpers/ai-workspace.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, resetDatabase } from '../helpers/fixtures.js';
import { PAPARA_LINES, paparaAcceptanceProcedure } from '../helpers/procedure-fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** The test bench's own tables: the only ones a run and a sandbox turn may write. */
const TEST_BENCH_TABLES = ['ai_sandbox_sessions', 'ai_test_run_results', 'ai_test_runs'];

/**
 * Columns the requests themselves stamp, whatever they ask for: authentication
 * notes when the credential was last used. The request's, not the simulation's.
 */
const REQUEST_STAMPS: Readonly<Record<string, readonly string[]>> = {
  api_tokens: ['last_used_at'],
};

/** Every table's rows, hashed — partitions through their parent; Prisma's ledger aside. */
async function snapshot(db: PrismaClient): Promise<Map<string, string>> {
  const tables = await db.$queryRaw<Array<{ name: string }>>`
    SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relispartition
       AND c.relname <> '_prisma_migrations'
     ORDER BY 1`;
  const out = new Map<string, string>();
  for (const { name } of tables) {
    const stamps = REQUEST_STAMPS[name] ?? [];
    const row =
      stamps.length > 0 ? `(to_jsonb(t) - '{${stamps.join(',')}}'::text[])::text` : 't::text';
    const rows = await db.$queryRawUnsafe<Array<{ n: bigint; hash: string }>>(
      `SELECT count(*) AS n, md5(coalesce(string_agg(${row}, E'\\n' ORDER BY ${row}), '')) AS hash FROM "${name}" t`,
    );
    out.set(name, `${rows[0]!.n}:${rows[0]!.hash}`);
  }
  return out;
}

function changedTables(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...after.keys()].filter((name) => before.get(name) !== after.get(name)).sort();
}

describe('a simulation writes nothing of the workspace’s (tm 314.2 · AI-19 §6)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  const attempts: string[] = [];
  let ws: AiWorkspace;
  let token: string;
  let financeId: number;

  const auth = () => ({ authorization: `Bearer ${token}` });
  const tenant = (): TenantContext => ({
    licenseId: ws.licenseId,
    organizationId: ws.organizationId,
  });

  async function scenario(body: Record<string, unknown>): Promise<string> {
    const response = await server.post(
      '/ai/test-scenarios',
      { ai_agent_id: ws.aiAgentId, ...body },
      auth(),
    );
    expect(response.statusCode, response.body).toBe(201);
    return (response.json() as { id: string }).id;
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    await app.$connect();
    server = await startTestServer(
      {},
      {
        webhookSender: async (_target, request) => {
          attempts.push(request.body);
          return { ok: true, statusCode: 200 };
        },
      },
    );
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await clearRateLimits(server.app);
    attempts.length = 0;
    ws = await seedAiWorkspace(owner);
    token = await grantToken(owner, {
      licenseId: ws.licenseId,
      organizationId: ws.organizationId,
      ownerId: ws.ownerId,
      scopes: ['agents-bot--all:rw'],
      kind: 'oauth',
    });
    financeId = Number(
      (
        await owner.group.create({
          data: { licenseId: ws.licenseId, name: 'Finans', topicRole: 'finance' },
          select: { id: true },
        })
      ).id,
    );
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
    for (const action of WEBHOOK_ACTIONS) {
      await owner.webhook.create({
        data: {
          licenseId: ws.licenseId,
          url: 'https://hooks.example.test/siyahtus',
          action,
          secretKey: `whsec_${action}`,
        },
      });
    }
  });

  it('a draft run and a sandbox session change only the test bench’s own rows — no RTM, no webhook (AI-19 acceptance 4)', async () => {
    // A live conversation the AI answered: chats, threads, events, skill_runs, the counters.
    const live = await customerAsks(owner, server, ws);
    expect(live.events.some((event) => event.authorType === 'bot')).toBe(true);
    const runsCount = (
      await owner.skill.findUniqueOrThrow({
        where: { id: ws.skillId },
        select: { runsCount: true },
      })
    ).runsCount;
    expect(runsCount).toBeGreaterThan(0);

    const ids = [
      await scenario({
        name: 'Papara — 95 dk',
        simulated_now: '2026-10-19T15:15:00+03:00',
        turns: PAPARA_LINES,
        expectations: { outcome: 'handoff', team_id: financeId, topic: 'finance', max_turns: 4 },
      }),
      await scenario({
        name: 'Papara — 10 dk',
        simulated_now: '2026-10-19T13:50:00+03:00',
        turns: PAPARA_LINES,
        expectations: { outcome: 'resolved_waiting', max_turns: 4 },
      }),
      await scenario({
        name: 'Hesabımı kapatın',
        persona: 'sorumlu_oyun_sinyali',
        turns: ['Hesabımı kapatmak istiyorum, oynamayı bırakacağım'],
        expectations: {
          outcome: 'handoff',
          must_flags: ['self_exclusion_request'],
          max_turns: 1,
        },
      }),
      await scenario({
        name: 'Teslimat süresi',
        language: 'en',
        turns: [AI_QUESTION],
        expectations: { outcome: 'resolved', max_turns: 2 },
      }),
    ];
    const session = (
      await server.post('/ai/sandbox-sessions', { ai_agent_id: ws.aiAgentId }, auth())
    ).json() as { id: string };

    const before = await snapshot(owner);
    // Every RTM push this server makes goes through its one Redis client
    // (`RealtimePublisher`). Watched there rather than with a `psubscribe('*')`
    // on the Redis server, which also hears the parallel shards' servers.
    const publish = vi.spyOn(server.app.redis, 'publish');
    try {
      const queued = await server.post(
        '/ai/test-runs',
        { ai_agent_id: ws.aiAgentId, target: 'draft', scenario_ids: ids },
        auth(),
      );
      expect(queued.statusCode, queued.body).toBe(202);
      const runId = (queued.json() as { id: string }).id;
      for (const message of ['param yatmadı', 'Papara 13:40', 'Hesabımı kapatmak istiyorum']) {
        const turn = await server.post(
          `/ai/sandbox-sessions/${session.id}/turns`,
          { message },
          auth(),
        );
        expect(turn.statusCode, turn.body).toBe(200);
      }

      const run = await owner.aiTestRun.findUniqueOrThrow({ where: { id: runId } });
      // Played to the end, every one. Whether each passed is beside the point
      // here: this agent speaks English (`seedAiWorkspace`), so the language
      // check fails the Turkish procedure's English hand-over line — rightly.
      expect(run).toMatchObject({ status: 'completed', scenarioCount: 4, errored: 0 });
      expect(run.passed + run.failed).toBe(4);
      // The run really played: a hand-over, a flag raised, a knowledge answer.
      const results = await owner.aiTestRunResult.findMany({ where: { runId } });
      const transcripts = results.flatMap(
        (result) => result.transcript as unknown as AiTestTranscriptEntry[],
      );
      const traces = transcripts.flatMap((entry) => (entry.trace ? [entry.trace] : []));
      expect(traces.some((trace) => trace.handoff?.team_id === financeId)).toBe(true);
      expect(traces.some((trace) => trace.flags.includes('self_exclusion_request'))).toBe(true);
      expect(
        transcripts.some((entry) => entry.role === 'ai' && entry.text.includes('Q7-courier')),
      ).toBe(true);
      expect(AI_PASSAGE).toContain('Q7-courier');
      // Read before `mockRestore`, which empties the record too.
      expect(publish.mock.calls).toEqual([]);
    } finally {
      publish.mockRestore();
    }

    const after = await snapshot(owner);
    expect(changedTables(before, after)).toEqual(TEST_BENCH_TABLES);
    expect(attempts).toEqual([]);
    expect(
      (
        await owner.skill.findUniqueOrThrow({
          where: { id: ws.skillId },
          select: { runsCount: true },
        })
      ).runsCount,
    ).toBe(runsCount);
  });

  it('inside the simulation context the live write paths refuse, and nothing changed (the shield)', async () => {
    const live = await customerAsks(owner, server, ws);
    const chat = await owner.chat.findUniqueOrThrow({
      where: { id: live.chatId },
      select: { id: true, customerId: true },
    });
    const before = await snapshot(owner);
    const chats = new ChatService(app, {
      set: async () => null,
      get: async () => null,
    });
    const publisher = new RealtimePublisher(server.app.redis, server.app.log);
    const scope = { kind: 'test_run' as const, licenseId: ws.licenseId };
    const writes: Record<string, () => Promise<unknown>> = {
      'a chat event': () =>
        chats.sendEvent(tenant(), botPrincipal(tenant()), chat.id, {
          type: 'message',
          text: 'a simulated reply',
          recipients: 'all',
        }),
      'a customer': () =>
        withTenant(app, tenant(), (tx) =>
          tx.customer.update({ where: { id: chat.customerId }, data: { name: 'Simulated' } }),
        ),
      'a rating': () =>
        withTenant(app, tenant(), (tx) =>
          tx.rating.create({ data: { chatId: chat.id, licenseId: ws.licenseId, value: 'good' } }),
        ),
      'skills.runs_count': () =>
        withTenant(app, tenant(), (tx) =>
          tx.skill.update({ where: { id: ws.skillId }, data: { runsCount: { increment: 1 } } }),
        ),
      'an AI resolution on the invoice': () =>
        withTenant(app, tenant(), (tx) => recordAiResolution(tx, tenant(), 100, 10)),
      'an RTM push': () =>
        publisher.publish(tenant(), 'incoming_chat', { allAgents: true }, { chat_id: chat.id }),
    };
    for (const [what, write] of Object.entries(writes)) {
      const refused = await runInSimulation(scope, write).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refused, what).toBeInstanceOf(SimulationWriteRefusedError);
      expect((refused as SimulationWriteRefusedError).path, what).toBe(
        what === 'an RTM push' ? 'realtime' : 'database',
      );
    }
    expect(changedTables(before, await snapshot(owner))).toEqual([]);
    // Outside the context the same write goes through — the shield is the context, not the path.
    await withTenant(app, tenant(), (tx) =>
      tx.skill.update({ where: { id: ws.skillId }, data: { runsCount: { increment: 1 } } }),
    );
    expect(changedTables(before, await snapshot(owner))).toEqual(['skills']);
  });
});

describe('a simulation is counted on the test meter alone (AI-19-S2)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  const llm = new FakeLlmProvider({ understandUsage: { inputTokens: 30, outputTokens: 5 } });

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
  });

  async function workspace(): Promise<{ ws: AiWorkspace; token: string }> {
    const ws = await seedAiWorkspace(owner);
    const token = await grantToken(owner, {
      licenseId: ws.licenseId,
      organizationId: ws.organizationId,
      ownerId: ws.ownerId,
      scopes: ['agents-bot--all:rw'],
      kind: 'oauth',
    });
    return { ws, token };
  }

  it('the run’s tokens are on llm_test; the live meter never moves (AI-19 acceptance 7)', async () => {
    const { ws, token } = await workspace();
    const auth = { authorization: `Bearer ${token}` };
    const created = await server.post(
      '/ai/test-scenarios',
      {
        ai_agent_id: ws.aiAgentId,
        name: 'Delivery',
        language: 'en',
        turns: [AI_QUESTION],
        expectations: { outcome: 'resolved', max_turns: 2 },
      },
      auth,
    );
    const queued = await server.post(
      '/ai/test-runs',
      {
        ai_agent_id: ws.aiAgentId,
        target: 'draft',
        scenario_ids: [(created.json() as { id: string }).id],
      },
      auth,
    );
    expect(queued.statusCode, queued.body).toBe(202);
    const run = await owner.aiTestRun.findUniqueOrThrow({
      where: { id: (queued.json() as { id: string }).id },
    });
    expect(run.status).toBe('completed');
    expect(llm.calls.length).toBeGreaterThan(0);

    const usage = await owner.aiDailyUsage.findMany({
      where: { licenseId: ws.licenseId },
      select: { meter: true, used: true },
    });
    const used = Object.fromEntries(usage.map((row) => [row.meter, Number(row.used)]));
    expect(used['llm_test']).toBeGreaterThan(0);
    expect(used['llm'] ?? 0).toBe(0);
    expect(Number(run.tokens)).toBeGreaterThan(0);
    const events = await owner.aiUsageEvent.findMany({
      where: { licenseId: ws.licenseId },
      select: { surface: true },
    });
    expect(new Set(events.map((event) => event.surface))).toEqual(new Set(['simulation']));
  });

  it('a spent test allowance is 429 on llm_test while the live one still has room', async () => {
    const { ws, token } = await workspace();
    const auth = { authorization: `Bearer ${token}` };
    // The test meter is a fifth of the live one; fill it.
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    await owner.aiDailyUsage.create({
      data: { licenseId: ws.licenseId, day, meter: 'llm_test', used: 200_000, reserved: 0 },
    });
    const queued = await server.post(
      '/ai/test-runs',
      { ai_agent_id: ws.aiAgentId, target: 'draft' },
      auth,
    );
    expect(queued.statusCode, queued.body).toBe(429);
    expect(queued.json()).toMatchObject({
      error: { type: 'limit_reached', details: { reason: 'ai_daily_cap', meter: 'llm_test' } },
    });
    // The live allowance is the visitors', untouched: a visitor is still answered.
    const asked = await customerAsks(owner, server, ws);
    expect(asked.events.some((event) => event.authorType === 'bot')).toBe(true);
  });
});
