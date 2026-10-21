/**
 * The AI-13 tables in a turn (tm 310.3 · SiyahTuş analysis AI-13 acceptance;
 * AI-03 `fact` / `fn`; AI-06 §3), on real rows read under the tenant.
 *
 * Two halves:
 *
 *   1. **The engine against Postgres** with the server's table source
 *      (`KnowledgeTableFacts`) and no facts handed in: the research §3.1
 *      deposit procedure branches on the Papara row — 20 minutes into its
 *      expected 30 is the wait, 95 minutes past its 60-minute threshold is
 *      finance, a Saturday EFT is the next window — and "Papara ile en az ne
 *      kadar yatırabilirim?" is the row's value, with no knowledge search, for
 *      the conversation's brand only (a brand's row over the every-brand one).
 *   2. **The live path**: a visitor's question answered from the row by the
 *      AI job worker (`routes/customer.ts` wires the tables), and a hand-over
 *      card that shows the row's fact.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  generateShortId,
  splitSkillProcedure,
  validateProcedure,
  type Procedure,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { ConversationEngine } from '../../src/services/ai/conversation/conversation-engine.js';
import { KnowledgeTableFacts } from '../../src/services/ai/conversation/facts.js';
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
import { depositThresholdProcedure } from '../helpers/procedure-fixtures.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const QUESTION = 'Papara ile en az ne kadar yatırabilirim?';

/** Monday to Friday, 09:00–18:00 in Istanbul. */
const WEEKDAYS_9_TO_6 = {
  timezone: 'Europe/Istanbul',
  windows: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'].map((day) => ({
    day,
    start: '09:00',
    end: '18:00',
  })),
  closed_on_bank_holidays: false,
};

/** A table answer is never a search: a turn that searched fails the test. */
const NO_KNOWLEDGE = new Proxy(
  {},
  {
    get: () => {
      throw new Error('the turn searched the knowledge base');
    },
  },
) as KnowledgeService;

async function storeSkill(
  db: PrismaClient,
  licenseId: bigint,
  aiAgentId: string,
  name: string,
  procedure: Procedure,
): Promise<string> {
  const { procedure: body, ...own } = splitSkillProcedure(procedure);
  const skill = await db.skill.create({
    data: {
      licenseId,
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

/** A one-message skill no question here is about — the agent's knowledge path stays open. */
async function storeRefunds(db: PrismaClient, licenseId: bigint, aiAgentId: string): Promise<void> {
  await db.skill.create({
    data: {
      licenseId,
      aiAgentId,
      name: 'İadeler',
      kind: 'ai_agent',
      steps: [
        { type: 'detect_intent', intent: 'refund', phrases: ['iade'] },
        { type: 'send_message', source: 'text', text: 'İadeler bir hafta sürer.' },
      ],
      active: true,
      updatedAt: new Date(),
    },
  });
}

describe('the AI-13 tables in a turn, against Postgres (tm 310.3)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;
  let aiAgentId: string;
  let brandA: string;
  let brandB: string;
  const tables = new KnowledgeTableFacts();
  const engine = new ConversationEngine({
    llm: new MockLlmProvider(),
    maxOutputTokens: 400,
    timeoutMs: 20_000,
    maxPromptChars: 16_000,
    knowledge: NO_KNOWLEDGE,
    facts: tables,
    tables,
  });

  const tenant = (): TenantContext => ({
    licenseId: fx.a.licenseId,
    organizationId: fx.a.organizationId,
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

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    const licenseId = fx.a.licenseId;
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    brandA = (
      await owner.brand.create({
        data: { licenseId, name: 'A', slug: 'a', isDefault: true },
        select: { id: true },
      })
    ).id;
    brandB = (
      await owner.brand.create({
        data: { licenseId, name: 'B', slug: 'b' },
        select: { id: true },
      })
    ).id;
    await owner.kbPaymentMethod.createMany({
      data: [
        {
          licenseId,
          name: 'Papara',
          aliases: ['PPR'],
          direction: 'deposit',
          minAmount: 100,
          maxAmount: 50000,
          expectedMinutes: 30,
          delayThresholdMinutes: 60,
          workingHours: WEEKDAYS_9_TO_6,
          requiresSiteRequest: true,
        },
        {
          licenseId,
          name: 'Havale',
          aliases: ['EFT'],
          direction: 'deposit',
          minAmount: 50,
          expectedMinutes: 30,
          delayThresholdMinutes: 60,
          workingHours: WEEKDAYS_9_TO_6,
          requiresSiteRequest: true,
        },
        // Brand A's own Papara: its limit, not the every-brand one, for A's players.
        {
          licenseId,
          brandIds: [brandA],
          name: 'Papara',
          direction: 'deposit',
          minAmount: 500,
          expectedMinutes: 30,
          delayThresholdMinutes: 60,
        },
      ],
    });
  });

  async function connection(brandId: string | null = null): Promise<ConnectionRef> {
    const customer = await owner.customer.create({
      data: { organizationId: fx.a.organizationId, name: `c-${generateShortId()}` },
      select: { id: true },
    });
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: fx.a.licenseId,
        customerId: customer.id,
        brandId,
        localDay: new Date('2026-10-19T00:00:00Z'),
        dayTz: 'Europe/Istanbul',
      },
    });
    const threadId = generateShortId();
    await owner.thread.create({ data: { id: threadId, chatId, licenseId: fx.a.licenseId } });
    return { chatId, threadId };
  }

  /** One turn as the live adapter takes it — and no facts handed in: the engine reads the tables. */
  async function turn(
    ref: ConnectionRef,
    text: string,
    now: Date,
    brandId: string | null = null,
  ): Promise<TurnResult> {
    const read = await withTenant(app, tenant(), async (tx) => ({
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
        tenant: tenant(),
        db: (fn) => withTenant(app, tenant(), fn),
        now,
        mode: 'live',
        chatId: ref.chatId,
        brandId,
        configVersionId: null,
        config: read.config.pkg,
        toolStubs: {},
        timeZone: 'Europe/Istanbul',
        // The connection is the AI's (AI-11): a question no skill takes goes to the knowledge path.
        aiMode: 'ai',
      },
    );
    const patch = turnStatePatch(state, result.nextState);
    if (Object.keys(patch).length > 0) {
      await withTenant(app, tenant(), (tx) => saveConversation(tx, read.row, patch));
    }
    return result;
  }

  const row = (ref: ConnectionRef) =>
    owner.aiConversation.findFirstOrThrow({ where: { threadId: ref.threadId } });

  describe('the §3.1 deposit procedure on the Papara row (AI-13 acceptance)', () => {
    let skillId: string;
    beforeEach(async () => {
      skillId = await storeSkill(
        owner,
        fx.a.licenseId,
        aiAgentId,
        'Yatırım geçmedi',
        depositThresholdProcedure(),
      );
    });

    it('20 minutes into the expected 30: the wait template, said with the row’s time', async () => {
      // Monday 19 October, 14:00 in Istanbul.
      const now = new Date('2026-10-19T11:00:00Z');
      const ref = await connection();
      await turn(ref, 'param yatmadı', now);
      const second = await turn(ref, 'paparayla 13:40', now);
      expect(second.reply).toContain(
        'Papara ile yapılan yatırımlar genellikle 30 dk içinde hesaba yansır. İşleminiz 20 dk önce yapılmış; hâlâ normal süre içinde.',
      );
      expect(await row(ref)).toMatchObject({
        activeSkillId: skillId,
        stepId: 'bekleme_bitti',
        stepStatus: 'awaiting_answer',
      });
    });

    it('95 minutes, past the 60-minute threshold: the threshold branch hands it to finance', async () => {
      const now = new Date('2026-10-19T11:00:00Z');
      const ref = await connection();
      await turn(ref, 'param yatmadı', now);
      const second = await turn(ref, 'papara 12:25', now);
      expect(second.reply).toContain(
        'Papara için 1 saat gecikme sınırı aşıldı (1 saat 35 dk). Sizi finans ekibimize aktarıyorum.',
      );
      expect(second.decisions.outcome).toBe('handed_off');
      expect((await row(ref)).digest).toMatchObject({
        outcome: 'handed_off',
        handoff: { reason_codes: ['expected_time_exceeded'] },
      });
    });

    it('an EFT sent on Saturday: outside the working hours, the next processing window', async () => {
      // Saturday 24 October, 11:40 in Istanbul; sent at 11:00 — past 30, under 60.
      const now = new Date('2026-10-24T08:40:00Z');
      const ref = await connection();
      await turn(ref, 'param yatmadı', now);
      const second = await turn(ref, 'eft 11:00', now);
      expect(second.reply).toMatch(/^Havale işlemleri Pazartesi 09:00–18:00/);
      expect(second.reply).toContain('bir sonraki işlem penceresinde (26.10.2026 09:00)');
      expect(await row(ref)).toMatchObject({ stepId: 'mesai_bitti' });
    });

    it('a brand’s row is the one its conversation reads; another brand’s never is', async () => {
      // Brand A's Papara has no working hours: around the clock, so a Saturday is in hours.
      const saturday = new Date('2026-10-24T08:40:00Z');
      const ofA = await connection(brandA);
      await turn(ofA, 'param yatmadı', saturday, brandA);
      const a = await turn(ofA, 'papara 11:00', saturday, brandA);
      expect(a.reply).not.toContain('işlem penceresinde');
      const ofB = await connection(brandB);
      await turn(ofB, 'param yatmadı', saturday, brandB);
      const b = await turn(ofB, 'papara 11:00', saturday, brandB);
      expect(b.reply).toContain('bir sonraki işlem penceresinde (26.10.2026 09:00)');
    });
  });

  describe('the exact answer (AI-06 §3 · AI-13 acceptance)', () => {
    beforeEach(async () => {
      await storeRefunds(owner, fx.a.licenseId, aiAgentId);
    });

    it('"Papara ile en az ne kadar yatırabilirim?" is the row’s value, and nothing is searched', async () => {
      const result = await turn(await connection(), QUESTION, new Date('2026-10-19T11:00:00Z'));
      expect(result.reply).toBe('Papara ile en az 100 TRY yatırabilirsiniz.');
      expect(result.decisions).toMatchObject({ outcome: 'answered', replyKind: 'answer' });
      expect(result.decisions.log).toContainEqual({
        step: 'knowledge',
        detail: 'answered from 1 table row(s)',
        ok: true,
      });
    });

    it('brand A hears its own row; brand B and an unknown brand hear the every-brand row, never A’s', async () => {
      const now = new Date('2026-10-19T11:00:00Z');
      expect((await turn(await connection(brandA), QUESTION, now, brandA)).reply).toBe(
        'Papara ile en az 500 TRY yatırabilirsiniz.',
      );
      expect((await turn(await connection(brandB), QUESTION, now, brandB)).reply).toBe(
        'Papara ile en az 100 TRY yatırabilirsiniz.',
      );
      expect((await turn(await connection(), QUESTION, now, null)).reply).toBe(
        'Papara ile en az 100 TRY yatırabilirsiniz.',
      );
    });

    it('reads the tables under the tenant: another workspace’s row is never the answer', async () => {
      await owner.kbPaymentMethod.create({
        data: {
          licenseId: fx.b.licenseId,
          name: 'Papara',
          direction: 'deposit',
          minAmount: 7,
        },
      });
      await owner.kbPaymentMethod.deleteMany({ where: { licenseId: fx.a.licenseId } });
      const read = await tables.read({
        db: (fn) => withTenant(app, tenant(), fn),
        brandId: null,
        now: new Date(),
      });
      expect(read.payment_methods).toEqual([]);
    });

    it('a procedure’s answer_from_knowledge step asks the row first too (AI-06 §1)', async () => {
      const result = validateProcedure({
        when_to_use: 'Oyuncu bir ödeme yönteminin alt limitini soruyor.',
        examples: [QUESTION, 'papara alt limit'],
        steps: [{ id: 'cevap', type: 'answer_from_knowledge' }],
      });
      if (!result.ok) throw new Error(JSON.stringify(result.problems));
      await storeSkill(owner, fx.a.licenseId, aiAgentId, 'Limitler', result.procedure);
      const answered = await turn(await connection(), QUESTION, new Date('2026-10-19T11:00:00Z'));
      expect(answered.reply).toContain('Papara ile en az 100 TRY yatırabilirsiniz.');
      expect(answered.decisions.log).toContainEqual({
        step: 'cevap',
        detail: 'answered from 1 table row(s)',
        ok: true,
      });
    });
  });
});

describe('the AI-13 tables on the live path (tm 310.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let token: string;

  const auth = () => ({ authorization: `Bearer ${token}` });

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  async function say(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    const bot = await owner.event.findMany({
      where: { chatId: sent.chat_id, authorType: 'bot', recipients: 'all' },
      orderBy: { createdAt: 'asc' },
      select: { text: true },
    });
    return { chatId: sent.chat_id, threadId: sent.event.thread_id, said: bot.map((e) => e.text) };
  }

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
    aiAgentId = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
        select: { id: true },
      })
    ).id;
    token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });
    const settings = await server.app.inject({
      method: 'PUT',
      url: server.url(`/ai-agents/${aiAgentId}/handoff-settings`),
      payload: { assignment_mode: 'ai_first' },
      headers: auth(),
    });
    expect(settings.statusCode).toBe(200);
    await owner.kbPaymentMethod.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'Papara',
        direction: 'deposit',
        minAmount: 100,
        expectedMinutes: 30,
      },
    });
  });

  it('a visitor’s question about a row is answered from it by the AI job worker', async () => {
    await storeRefunds(owner, fx.a.licenseId, aiAgentId);
    const turn = await say(await visitor(), QUESTION);
    expect(turn.said).toEqual(['Papara ile en az 100 TRY yatırabilirsiniz.']);
  });

  it('the preview answers a one-message skill’s knowledge reply from the row (routes/playbook.ts)', async () => {
    const response = await server.post(
      '/skills/preview',
      {
        steps: [{ type: 'send_message', source: 'knowledge' }],
        message: QUESTION,
        ai_agent_id: aiAgentId,
      },
      auth(),
    );
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      outcome: 'answered',
      reply: 'Papara ile en az 100 TRY yatırabilirsiniz.',
    });
  });

  it('the hand-over card shows the fact the procedure read from the row', async () => {
    await storeSkill(owner, fx.a.licenseId, aiAgentId, 'Yatırım geçmedi', {
      ...depositThresholdProcedure(),
      steps: [
        { id: 'sor', type: 'collect', slots: ['yontem'] },
        { id: 'devir', type: 'handoff', reason_code: 'expected_time_exceeded' },
      ],
      handoff: {
        conditions: [],
        card_fields: ['method.expected_minutes', 'method.min_amount'],
      },
    } as Procedure);
    const headers = await visitor();
    const first = await say(headers, 'param yatmadı');
    await say(headers, 'Papara');
    const card = await owner.aiHandoff.findFirstOrThrow({ where: { threadId: first.threadId } });
    expect(card.decisionFacts).toEqual([
      { field: 'method.expected_minutes', text: '30 dk' },
      { field: 'method.min_amount', text: '100' },
    ]);
  });
});
