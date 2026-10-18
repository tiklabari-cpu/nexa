/**
 * Procedures on the database and on the live path (tm 296.3 · SiyahTuş
 * analysis AI-03 — acceptance §3.1, the pinned definition, the topic change).
 *
 * Two halves:
 *
 *   1. **The engine against Postgres.** A turn reads its configuration through
 *      the real seam (`readAndCompile`), decides with the payment-method facts
 *      as a fixture (the tables are #310), and its next state is saved with
 *      the optimistic lock the live adapter uses — so the snapshot, its hash,
 *      the step, the slots and the topic set aside all make the round trip
 *      through JSONB and the table's CHECKs, turn after turn.
 *   2. **The live path.** A procedure skill written and turned on through the
 *      API (`POST`/`PATCH /skills` — turning one on is no longer refused) is
 *      run by the AI job worker on real visitor messages: the reply, the row,
 *      the run, the decision record, and the hand-over — to a team by id, and
 *      to routing when the team cannot take it.
 *
 * Every model is the in-process stub (MASTER-PROMPT: the LLM is a
 * deterministic stub); the understanding call is answered by its reading
 * (`understand-mock.ts`, tm 297.1).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId, splitSkillProcedure, type Procedure } from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { ConversationEngine } from '../../src/services/ai/conversation/conversation-engine.js';
import {
  procedureHash,
  readSnapshot,
} from '../../src/services/ai/conversation/procedure/executor.js';
import {
  loadConversation,
  openConversation,
  saveConversation,
  type ConnectionRef,
} from '../../src/services/ai/conversation/state-store.js';
import { readAndCompile } from '../../src/services/ai/conversation/turn-config.js';
import {
  toTurnState,
  turnStatePatch,
  type TurnResult,
} from '../../src/services/ai/conversation/turn.js';
import type { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { MockLlmProvider } from '../../src/services/ai/provider/mock-llm-provider.js';
import {
  DEPOSIT_OPTIONS,
  DEPOSIT_TEMPLATES,
  depositFacts,
  depositProcedure,
} from '../helpers/procedure-fixtures.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
/** 13:50 in Istanbul. */
const NOW = new Date('2026-10-18T10:50:00Z');

/** No step here answers from the knowledge base; one that tried would fail the test. */
const NO_KNOWLEDGE = new Proxy(
  {},
  {
    get: () => {
      throw new Error('a procedure turn searched the knowledge base');
    },
  },
) as KnowledgeService;

describe('the §3.1 deposit procedure on the database (AI-03 acceptance)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  let skillId: string;
  const engine = new ConversationEngine({
    llm: new MockLlmProvider(),
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 16_000,
    knowledge: NO_KNOWLEDGE,
  });

  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    await app.$connect();
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  async function storeProcedure(name: string, procedure: Procedure, aiAgentId: string) {
    const { procedure: body, ...own } = splitSkillProcedure(procedure);
    const skill = await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name,
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
    });
    return skill.id;
  }

  let aiAgentId: string;
  beforeEach(async () => {
    fx = await seedFixtures(owner);
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    skillId = await storeProcedure('Yatırım geçmedi', depositProcedure(), aiAgentId);
  });

  async function connection(t: TenantFixture): Promise<ConnectionRef> {
    const customer = await owner.customer.create({
      data: { organizationId: t.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: customer.id,
        localDay: new Date('2026-10-18T00:00:00Z'),
        dayTz: 'Europe/Istanbul',
      },
    });
    const threadId = generateShortId();
    await owner.thread.create({ data: { id: threadId, chatId, licenseId: t.licenseId } });
    return { chatId, threadId };
  }

  /**
   * One turn as the live adapter takes it: the row and the configuration read
   * in one transaction, the turn decided outside any, the patch saved against
   * the version read.
   */
  async function turn(ref: ConnectionRef, text: string): Promise<TurnResult> {
    const tenant = ctx(fx.a);
    const read = await withTenant(app, tenant, async (tx) => ({
      row:
        (await loadConversation(tx, ref)) ??
        (await openConversation(tx, ref, { configVersionId: null })),
      config: await readAndCompile.forTurn(tx, { aiAgentId: null, pinnedVersionId: null }),
    }));
    const state = toTurnState(read.row);
    const result = await engine.runTurn(
      state,
      { text },
      {
        tenant,
        db: (fn) => withTenant(app, tenant, fn),
        now: NOW,
        mode: 'live',
        chatId: ref.chatId,
        configVersionId: null,
        config: read.config.pkg,
        toolStubs: {},
        timeZone: 'Europe/Istanbul',
        procedure: { facts: depositFacts(), options: DEPOSIT_OPTIONS },
      },
    );
    const patch = turnStatePatch(state, result.nextState);
    if (Object.keys(patch).length > 0) {
      await withTenant(app, tenant, (tx) => saveConversation(tx, read.row, patch));
    }
    return result;
  }

  const row = (ref: ConnectionRef) =>
    owner.aiConversation.findFirstOrThrow({ where: { threadId: ref.threadId } });

  it('D — six turns to finance with every slot, the definition and its hash surviving JSONB on every turn', async () => {
    const ref = await connection(fx.a);
    const replies: Array<string | null> = [];
    for (const text of [
      'param yatmadı',
      'Papara, 12:00',
      'evet oluşturdum, kendi hesabımdan gönderdim',
      '2.500 TL',
      'ahmet77',
      'REF12345',
    ]) {
      replies.push((await turn(ref, text)).reply);
      const stored = await row(ref);
      // JSONB hands the object back in its own key order: the hash is of the canonical form.
      const snapshot = readSnapshot(stored.procedureSnapshot);
      expect(snapshot?.procedure).toEqual(depositProcedure());
      expect(stored.procedureSnapshotHash).toBe(procedureHash(snapshot!.procedure));
    }
    expect(replies[0]).toBe(
      `${DEPOSIT_TEMPLATES.giris}\nHangi yöntemle yatırım yaptınız? Saat kaçta yatırdınız?`,
    );
    expect(replies[4]).toBe('İşlemin referans numarasını paylaşır mısınız?');

    const last = await row(ref);
    expect(last).toMatchObject({
      activeSkillId: skillId,
      stepId: 'finansa_devir',
      stepStatus: 'done',
      counters: { turns: 6, procedure_turns: 6 },
      version: 6,
      suspended: null,
    });
    const slots = last.slots as Record<string, { status: string; display: string | null }>;
    expect(
      Object.fromEntries(Object.entries(slots).map(([name, slot]) => [name, slot.status])),
    ).toEqual({
      yontem: 'filled',
      islem_zamani: 'filled',
      talep_olusturuldu: 'filled',
      gonderen_kendisi: 'filled',
      tutar: 'filled',
      kullanici_adi: 'filled',
      referans: 'filled',
    });
    expect(slots['tutar']!.display).toBe('2.500 TRY');
    expect(last.digest).toMatchObject({
      procedure_key: skillId,
      outcome: 'handed_off',
      handoff: { reason_codes: ['expected_time_exceeded'] },
    });
  });

  it('A — two turns, resolved waiting; a change published in between does not reach the conversation', async () => {
    const ref = await connection(fx.a);
    await turn(ref, 'param yatmadı');

    // Published mid-conversation: the stored skill changes, the pinned copy does not.
    const edited = depositProcedure((raw) => {
      for (const template of raw['templates'] as Array<{ key: string; text: string }>) {
        if (template.key === 'normal_sure') template.text = 'YENİ: {yontem} birazdan yansır.';
      }
    });
    await owner.skill.update({
      where: { id: skillId },
      data: { procedure: splitSkillProcedure(edited).procedure as object, updatedAt: new Date() },
    });

    const second = await turn(ref, 'Papara 13:40');
    expect(second.reply).toBe(
      'Papara ile yapılan yatırımlar genellikle 30 dk içinde hesaba yansır. İşleminiz 10 dk önce yapılmış; hâlâ normal süre içinde.\n30 dk dolduğunda bakiye görünmezse bu sohbete yazın.',
    );
    expect(await row(ref)).toMatchObject({
      activeSkillId: null,
      procedureSnapshot: null,
      procedureSnapshotHash: null,
      stepId: null,
      stepStatus: null,
      digest: expect.objectContaining({ outcome: 'resolved_waiting' }),
    });

    // A conversation that starts now runs on what was published.
    const fresh = await connection(fx.a);
    await turn(fresh, 'param yatmadı');
    const third = await turn(fresh, 'Papara 13:40');
    expect(third.reply).toContain('YENİ: Papara birazdan yansır.');
    expect((await row(fresh)).digest).toMatchObject({ outcome: 'resolved_waiting' });
  });

  it('a topic change sets the procedure aside in the row; "evet" takes it up with what it had collected', async () => {
    await storeProcedure(
      'Çekim',
      depositProcedure((raw) => {
        raw['when_to_use'] = 'Oyuncu çekim yapamadığını söylüyor.';
        raw['examples'] = ['para çekemiyorum'];
        raw['slots'] = [];
        raw['steps'] = [
          { id: 'bilgi', type: 'say', template_key: 'bilgi' },
          { id: 'bitti', type: 'resolve', outcome: 'resolved' },
        ];
        raw['templates'] = [{ key: 'bilgi', text: 'Çekim talepleri 24 saat içinde işlenir.' }];
        raw['handoff'] = { conditions: [], card_fields: [] };
      }),
      aiAgentId,
    );
    const ref = await connection(fx.a);
    await turn(ref, 'param yatmadı');
    await turn(ref, 'Papara ile');

    const switched = await turn(ref, 'para çekemiyorum');
    expect(switched.reply).toBe(
      'Çekim talepleri 24 saat içinde işlenir.\nÖnceki konuya dönelim mi?',
    );
    const aside = await row(ref);
    expect(aside).toMatchObject({ activeSkillId: null, stepStatus: null });
    expect(aside.suspended).toMatchObject({
      skill_id: skillId,
      step_id: 'yontem_zaman',
      step_status: 'awaiting_answer',
      offered: true,
      slots: { yontem: { status: 'filled', display: 'Papara' } },
    });

    const back = await turn(ref, 'evet');
    // The method is known: only the time is asked again.
    expect(back.reply).toBe('Saat kaçta yatırdınız?');
    expect(await row(ref)).toMatchObject({
      activeSkillId: skillId,
      stepId: 'yontem_zaman',
      stepStatus: 'awaiting_answer',
      suspended: null,
      slots: { yontem: { status: 'filled', display: 'Papara' } },
    });
  });

  it('another workspace’s procedure is never run: the configuration is read under the tenant', async () => {
    const otherAgent = await owner.aiAgent.create({
      data: { licenseId: fx.b.licenseId, name: 'B', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    await owner.skill.update({ where: { id: skillId }, data: { active: false } });
    const { procedure: body, ...own } = splitSkillProcedure(depositProcedure());
    await owner.skill.create({
      data: {
        licenseId: fx.b.licenseId,
        aiAgentId: otherAgent.id,
        name: 'B yatırım',
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
    const ref = await connection(fx.a);
    const result = await turn(ref, 'param yatmadı');
    expect(result.decisions.skillId).toBeNull();
    expect(result.reply).toBeNull();
  });
});

describe('procedure skills on the live path (AI-03)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let token: string;
  let aiAgentId: string;
  let financeId: bigint;

  const auth = () => ({ authorization: `Bearer ${token}` });

  /** Fact-free, so the live path (no tables before #310) runs it end to end. */
  function definition(target: Record<string, unknown>) {
    return {
      name: 'Yatırım geçmedi',
      mode: 'procedure',
      ai_agent_id: aiAgentId,
      when_to_use: 'Oyuncu yatırımının hesabına geçmediğini söylüyor.',
      examples: ['param yatmadı', 'yatırımım gelmedi'],
      slots: [
        {
          name: 'yontem',
          label: 'Ödeme yöntemi',
          type: 'enum',
          ask: 'Hangi yöntemle yatırdınız?',
          validate: { enum_values: ['Papara', 'Havale'] },
        },
        {
          name: 'islem_zamani',
          label: 'İşlem zamanı',
          type: 'datetime',
          ask: 'Ne zaman yatırdınız?',
        },
      ],
      procedure: {
        steps: [
          { id: 'giris', type: 'say', template_key: 'giris' },
          { id: 'sor', type: 'collect', slots: ['yontem', 'islem_zamani'] },
          {
            id: 'sure',
            type: 'check',
            when: { fn: { name: 'elapsed_minutes', args: ['islem_zamani'], op: 'lt', value: 30 } },
            then: { goto: 'bekle' },
          },
          { id: 'devir', type: 'handoff', reason_code: 'expected_time_exceeded', target },
          { id: 'bekle', type: 'say', template_key: 'bekle' },
          { id: 'bitti', type: 'resolve', outcome: 'resolved_waiting' },
        ],
        templates: [
          { key: 'giris', text: 'Hemen bakalım.' },
          { key: 'bekle', text: '{yontem} yatırımları 30 dakika içinde yansır.' },
        ],
      },
    };
  }

  async function createProcedure(target: Record<string, unknown>): Promise<string> {
    const created = await server.post('/skills', definition(target), auth());
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { id: string }).id;
    const on = await server.patch(`/skills/${id}`, { active: true }, auth());
    expect(on.statusCode).toBe(200);
    return id;
  }

  const customerAuth = async (): Promise<Record<string, string>> => {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  };

  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    return response.json() as { chat_id: string; event: { thread_id: string } };
  }

  const botTexts = async (chatId: string) =>
    (
      await owner.event.findMany({
        where: { chatId, authorType: 'bot' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      })
    ).map((event) => event.text);

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'reports_read'],
    });
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    financeId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Finans' },
        select: { id: true },
      })
    ).id;
  });

  it('turned on through the API, it answers a visitor, waits, and resolves on the answer — run and decision recorded each turn', async () => {
    const skillId = await createProcedure({ group_id: Number(financeId) });
    const headers = await customerAuth();

    const first = await send(headers, 'param yatmadı');
    expect(await botTexts(first.chat_id)).toEqual([
      'Hemen bakalım.\nHangi yöntemle yatırdınız? Ne zaman yatırdınız?',
    ]);
    const opened = await owner.aiConversation.findFirstOrThrow({
      where: { threadId: first.event.thread_id },
    });
    expect(opened).toMatchObject({
      activeSkillId: skillId,
      stepId: 'sor',
      stepStatus: 'awaiting_answer',
      counters: { turns: 1, procedure_turns: 1 },
    });
    const snapshot = readSnapshot(opened.procedureSnapshot);
    expect(snapshot).toMatchObject({ skill_name: 'Yatırım geçmedi', ai_agent_id: aiAgentId });
    expect(opened.procedureSnapshotHash).toBe(procedureHash(snapshot!.procedure));

    await send(headers, 'Papara, 10 dakika önce');
    expect((await botTexts(first.chat_id))[1]).toBe('Papara yatırımları 30 dakika içinde yansır.');
    expect(
      await owner.aiConversation.findFirstOrThrow({ where: { threadId: first.event.thread_id } }),
    ).toMatchObject({ activeSkillId: null, stepStatus: null, counters: { turns: 2 } });

    expect(await owner.skillRun.count({ where: { skillId } })).toBe(2);
    const decisions = await owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      orderBy: { createdAt: 'asc' },
      select: { decision: true, procedureId: true },
    });
    expect(decisions).toEqual([
      { decision: 'asked', procedureId: skillId },
      { decision: 'answered', procedureId: skillId },
    ]);
  });

  it('files every step decision on the turn’s decision record — turn, step, type, condition, detail, what was understood (ID-08)', async () => {
    const skillId = await createProcedure({ group_id: Number(financeId) });
    const headers = await customerAuth();
    const first = await send(headers, 'param yatmadı');
    // The definition's hash while it is pinned; resolved, the row lets it go.
    const { procedureSnapshotHash: hash } = await owner.aiConversation.findFirstOrThrow({
      where: { threadId: first.event.thread_id },
      select: { procedureSnapshotHash: true },
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    await send(headers, 'Papara, 10 dakika önce');

    const rows = await owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      orderBy: { createdAt: 'asc' },
      select: { decision: true, procedureId: true, step: true, threadId: true, details: true },
    });
    expect(rows).toEqual([
      {
        decision: 'asked',
        procedureId: skillId,
        step: 'sor',
        threadId: first.event.thread_id,
        details: expect.objectContaining({
          turn: 1,
          procedure_hash: hash,
          // What the understanding call read (tm 297.1 · AI-05 §8), mock-answered.
          understood: {
            procedure_key: skillId,
            confidence: 1,
            alternatives: [],
            language: null,
            tries: 1,
          },
          trace: [
            { step_id: 'giris', type: 'say', cond_result: null, detail: 'template giris' },
            {
              step_id: 'sor',
              type: 'collect',
              cond_result: null,
              detail: 'asked for yontem, islem_zamani — waiting for the answer',
            },
          ],
        }),
      },
      {
        decision: 'answered',
        procedureId: skillId,
        step: 'bitti',
        threadId: first.event.thread_id,
        details: expect.objectContaining({
          turn: 2,
          procedure_hash: hash,
          understood: expect.objectContaining({ procedure_key: null, tries: 1 }),
          trace: [
            { step_id: 'sor', type: 'collect', cond_result: null, detail: 'nothing left to ask' },
            { step_id: 'sure', type: 'check', cond_result: true, detail: 'then: go to bekle' },
            { step_id: 'bekle', type: 'say', cond_result: null, detail: 'template bekle' },
            {
              step_id: 'bitti',
              type: 'resolve',
              cond_result: null,
              detail: 'resolved (resolved_waiting)',
            },
          ],
        }),
      },
    ]);
    // Ids and codes only: what the player wrote and what the AI said stay in the transcript.
    expect(JSON.stringify(rows)).not.toMatch(/Papara|dakika|Hemen bakalım|yansır/);
  });

  it('writes one run per turn, which the AI Agent report counts and the run log lists (FR-MOD-07.4)', async () => {
    const skillId = await createProcedure({ group_id: Number(financeId) });
    const headers = await customerAuth();
    const first = await send(headers, 'param yatmadı');
    await send(headers, 'Papara, 10 dakika önce');
    const second = await send(await customerAuth(), 'yatırımım gelmedi');

    const runs = await owner.skillRun.findMany({
      where: { skillId },
      orderBy: { ranAt: 'asc' },
      select: { threadId: true, status: true, log: true },
    });
    expect(runs.map((run) => [run.threadId, run.status])).toEqual([
      [first.event.thread_id, 'succeeded'],
      [first.event.thread_id, 'succeeded'],
      [second.event.thread_id, 'succeeded'],
    ]);
    expect(runs.map((run) => (run.log as { outcome: string }).outcome)).toEqual([
      'answered',
      'answered',
      'answered',
    ]);
    expect((await owner.skill.findUniqueOrThrow({ where: { id: skillId } })).runsCount).toBe(3);

    const report = await server.get('/reports/ai-agent', auth());
    expect(report.statusCode).toBe(200);
    expect(report.json()).toMatchObject({
      skill_runs: 3,
      tokens: { llm_input: 0, llm_output: 0, embedding_input: 0 },
    });
    const listed = await server.get(`/skills/${skillId}/runs`, auth());
    expect(listed.statusCode).toBe(200);
    const items = (listed.json() as { items: { chat_id: string; log: { step: string }[] }[] })
      .items;
    expect(items).toHaveLength(3);
    // Newest first; the run log names the procedure's steps as the admin wrote them.
    expect(items[0]?.chat_id).toBe(second.chat_id);
    expect(items[1]?.log.map((entry) => entry.step)).toEqual(
      expect.arrayContaining(['sor', 'sure', 'bekle', 'bitti']),
    );
  });

  it('a procedure whose skill is deleted mid-conversation still answers from its snapshot; its runs went with the skill', async () => {
    // Another skill keeps the AI on: with no skill at all there is no turn to take.
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Refunds',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'refund', phrases: ['refund'] },
          { type: 'send_message', source: 'text', text: 'Refunds take 5 days.' },
        ],
        active: true,
        updatedAt: new Date(),
      },
    });
    const skillId = await createProcedure({ group_id: Number(financeId) });
    const headers = await customerAuth();
    const first = await send(headers, 'param yatmadı');
    expect(await owner.skillRun.count({ where: { skillId } })).toBe(1);

    expect((await server.del(`/skills/${skillId}`, auth())).statusCode).toBe(204);
    await send(headers, 'Papara, 10 dakika önce');

    expect(await botTexts(first.chat_id)).toEqual([
      'Hemen bakalım.\nHangi yöntemle yatırdınız? Ne zaman yatırdınız?',
      'Papara yatırımları 30 dakika içinde yansır.',
    ]);
    expect(
      await owner.aiConversation.findFirstOrThrow({ where: { threadId: first.event.thread_id } }),
    ).toMatchObject({ activeSkillId: null, stepStatus: null, counters: { turns: 2 } });
    expect(await owner.skillRun.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    const decisions = await owner.aiDecisionLog.findMany({
      where: { licenseId: fx.a.licenseId },
      orderBy: { createdAt: 'asc' },
      select: { decision: true, procedureId: true, step: true, errorType: true },
    });
    expect(decisions).toEqual([
      { decision: 'asked', procedureId: skillId, step: 'sor', errorType: null },
      { decision: 'answered', procedureId: skillId, step: 'bitti', errorType: null },
    ]);
  });

  it('a single-message skill answers beside a procedure exactly as it does alone — reply, run and record (AI-03 §10)', async () => {
    const refunds = (
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId,
          name: 'Refunds',
          kind: 'ai_agent',
          steps: [
            { type: 'detect_intent', intent: 'refund', phrases: ['refund'] },
            { type: 'tag', tag: 'refunds' },
            { type: 'send_message', source: 'text', text: 'Refunds take 5 days.' },
          ],
          active: true,
          updatedAt: new Date(),
        },
        select: { id: true },
      })
    ).id;

    /** One visitor asks; what the AI said, the run it wrote and its decision record. */
    const ask = async () => {
      const sent = await send(await customerAuth(), 'I want a refund please');
      const run = await owner.skillRun.findFirstOrThrow({
        where: { threadId: sent.event.thread_id },
        select: { skillId: true, status: true, log: true },
      });
      const record = await owner.aiDecisionLog.findFirstOrThrow({
        where: { threadId: sent.event.thread_id },
        select: {
          decision: true,
          procedureId: true,
          step: true,
          handoffReason: true,
          details: true,
        },
      });
      const tags = await owner.thread.findUniqueOrThrow({
        where: { id: sent.event.thread_id },
        select: { tags: { select: { tag: { select: { name: true } } } } },
      });
      return { texts: await botTexts(sent.chat_id), run, record, tags };
    };

    const alone = await ask();
    expect(alone.texts).toEqual(['Refunds take 5 days.']);
    expect(alone.run).toMatchObject({ skillId: refunds, status: 'succeeded' });
    expect(alone.record).toEqual({
      decision: 'answered',
      procedureId: refunds,
      step: 'send_message',
      handoffReason: null,
      details: {
        outcome: 'answered',
        steps: ['detect_intent', 'tag', 'send_message'],
        failed_steps: [],
        embedding_tokens: 0,
      },
    });

    await createProcedure({ group_id: Number(financeId) });
    // The same in every part but one: beside a procedure the understanding call
    // ran first, and the record says what it read (tm 297.1 · AI-05 §8).
    const { record, ...beside } = await ask();
    const { record: aloneRecord, ...aloneRest } = alone;
    expect(beside).toEqual(aloneRest);
    expect(record).toEqual({
      ...aloneRecord,
      details: {
        ...(aloneRecord.details as Record<string, unknown>),
        understood: {
          procedure_key: null,
          confidence: 0,
          alternatives: [],
          language: 'en',
          tries: 1,
        },
      },
    });
  });

  it('hands over to the team it names by id, and the AI stops', async () => {
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: financeId, agentId: fx.a.agentAccountId },
    });
    await createProcedure({ group_id: Number(financeId) });
    const headers = await customerAuth();
    const first = await send(headers, 'param yatmadı');
    await send(headers, 'Havale, 2 saat önce');

    const thread = await owner.thread.findUniqueOrThrow({
      where: { id: first.event.thread_id },
      select: { groupId: true, aiMode: true },
    });
    expect(thread).toEqual({ groupId: financeId, aiMode: 'human' });
    const decision = await owner.aiDecisionLog.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId, decision: 'handoff' },
      select: { handoffReason: true },
    });
    expect(decision.handoffReason).toBe('expected_time_exceeded');

    // A person has it now: a further message gets no AI turn.
    await send(headers, 'hâlâ yok');
    expect(await botTexts(first.chat_id)).toHaveLength(1);
  });

  it.each([
    ['a team nobody in it can take now', () => ({ group_id: Number(financeId) })],
    ['a routing topic (#307 resolves topics)', () => ({ topic: 'finance' })],
  ])('%s still hands over: the conversation goes to routing', async (_, target) => {
    await createProcedure(target());
    const headers = await customerAuth();
    const first = await send(headers, 'param yatmadı');
    await send(headers, 'Havale, 2 saat önce');
    const thread = await owner.thread.findUniqueOrThrow({
      where: { id: first.event.thread_id },
      select: { aiMode: true },
    });
    expect(thread.aiMode).toBe('human');
    const note = await owner.event.findFirst({
      where: {
        threadId: first.event.thread_id,
        properties: { path: ['system_event'], equals: 'ai_mode_changed' },
      },
      select: { properties: true },
    });
    expect(note?.properties).toMatchObject({ ai_mode: 'human', reason: 'ai_handoff' });
  });
});
