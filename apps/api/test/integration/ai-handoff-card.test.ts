/**
 * The AI's hand-over card (tm 304.1 · SiyahTuş analysis AI-10), through the
 * real server and the real database:
 *
 *   - a deposit hand-over on a live conversation writes one card, keyed by the
 *     hand-over's id: the procedure's name, the slots, the decision's basis,
 *     the AI's messages, the reasons, the target, the suggested step — the
 *     connection's summary becomes its line ("Customer asked: …" is gone), its
 *     text an agents-only line, and the player is told what they gave
 *     (AI-10-S1);
 *   - `ai_handoff_created` and `thread_summary_set` reach the agents and the
 *     target team within a second of the card;
 *   - a knowledge hand-over's card shows the question and why there was no
 *     answer;
 *   - `GET /chats/{chatId}/ai-handoffs`, `latest_ai_handoff` on the chat, the
 *     feedback (one verdict, the last click's, no second row), the agent's
 *     first message taking the card up — behind the conversation's visibility;
 *     never to the visitor, never an internal note;
 *   - the table: RLS, the grants, the trigger and the CHECKs.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import {
  AI_HANDOFF_CARD_SYSTEM_EVENT,
  licenseChannel,
  splitSkillProcedure,
  type AiHandoffCardView,
} from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { depositProcedure } from '../helpers/procedure-fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Envelope {
  action: string;
  audience: { groupIds?: number[]; agentIds?: string[]; customerId?: string };
  payload: Record<string, unknown>;
  at: number;
}

const NEXT_STEP = '{yontem} referansı ile ödeme sağlayıcı panelinde eşleştirme.';
const NOTE = 'IC-NOT-7731 oyuncu daha önce şikâyet etmişti';

describe('the AI hand-over card (AI-10 · tm 304.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let financeId: bigint;
  let adminToken: string;
  let agentToken: string;
  let otherToken: string;
  let listener: Redis;
  let pushes: Envelope[];

  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  /** The live §3.1 shape, fact-free (the tables are #310): method and time, then finance. */
  function definition() {
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
          {
            id: 'devir',
            type: 'handoff',
            reason_code: 'expected_time_exceeded',
            target: { group_id: Number(financeId) },
          },
          { id: 'bekle', type: 'say', template_key: 'bekle' },
          { id: 'bitti', type: 'resolve', outcome: 'resolved_waiting' },
        ],
        templates: [
          { key: 'giris', text: 'Hemen bakalım.' },
          { key: 'bekle', text: '{yontem} yatırımları genellikle 30 dakika içinde yansır.' },
        ],
        handoff: {
          conditions: [],
          card_fields: ['elapsed_minutes(islem_zamani)', 'yontem'],
          next_step_hint: NEXT_STEP,
        },
      },
    };
  }

  async function createProcedure(): Promise<void> {
    const created = await server.post('/skills', definition(), as(adminToken));
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { id: string }).id;
    const on = await server.patch(`/skills/${id}`, { active: true }, as(adminToken));
    expect(on.statusCode, on.body).toBe(200);
  }

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return as((response.json() as { token: string }).token);
  }

  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  async function cards(chatId: string, token = agentToken): Promise<AiHandoffCardView[]> {
    const response = await server.get(`/chats/${chatId}/ai-handoffs`, as(token));
    expect(response.statusCode, response.body).toBe(200);
    return (response.json() as { items: AiHandoffCardView[] }).items;
  }

  /** A deposit conversation handed to finance: the chat, the connection, the card. */
  async function depositHandoff() {
    await createProcedure();
    const headers = await visitor();
    const first = await send(headers, 'param yatmadı');
    await send(headers, 'Havale, 2 saat önce');
    const [card] = await cards(first.chatId);
    expect(card).toBeDefined();
    return { ...first, headers, card: card! };
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
    financeId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Finans' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.create({
      data: { licenseId: fx.a.licenseId, groupId: financeId, agentId: fx.a.agentAccountId },
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--all:rw'],
    });
    otherToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['chats--all:rw'],
    });
    pushes = [];
    listener = server.app.redis.duplicate();
    listener.on('message', (_channel: string, message: string) => {
      pushes.push(JSON.parse(message) as Envelope);
    });
    await listener.subscribe(licenseChannel(fx.a.licenseId));
  });

  afterEach(async () => {
    await listener.quit();
  });

  describe('a deposit hand-over', () => {
    it('writes one card with every field, keyed by the hand-over’s id; the summary is its line, not "Customer asked"', async () => {
      const { chatId, threadId, card } = await depositHandoff();

      expect(card).toMatchObject({
        chat_id: chatId,
        thread_id: threadId,
        topic: 'Yatırım geçmedi',
        question: null,
        reason_codes: ['procedure_rule'],
        primary_reason: 'procedure_rule',
        priority: 'normal',
        target_group_id: Number(financeId),
        suggested_next_step: 'Havale referansı ile ödeme sağlayıcı panelinde eşleştirme.',
        output_check_flags: [],
        accepted_at: null,
        feedback: null,
        player: { basis: 'declared', recognized_device: false },
      });
      expect(card.summary).toMatch(/^Yatırım geçmedi: Havale, .+\.$/);
      expect(card.slots.map((line) => [line.slot, line.status, line.source])).toEqual([
        ['yontem', 'filled', 'player'],
        ['islem_zamani', 'filled', 'player'],
      ]);
      expect(card.slots[0]?.text).toBe('Havale');
      expect(card.decision_facts).toEqual([
        { field: 'elapsed_minutes(islem_zamani)', text: expect.stringMatching(/saat/) },
        { field: 'yontem', text: 'Havale' },
      ]);
      // The AI's two messages, the hand-over's own last — with what the player gave.
      expect(card.ai_statements).toHaveLength(2);
      expect(card.ai_statements[1]?.text).toContain('Şu bilgileri ilettim: Havale');
      expect(card.card_text.split('\n')[0]).toBe('Konu: Yatırım geçmedi');
      expect(card.card_text).toContain('Önerilen adım: Havale referansı');

      // The hand-over's id, on its transfer line and its decision record.
      const transfer = await owner.event.findFirstOrThrow({
        where: { threadId, properties: { path: ['system_event'], equals: 'chat_transferred' } },
        select: { properties: true },
      });
      expect(transfer.properties).toMatchObject({ handoff_id: card.id });
      const record = await owner.aiDecisionLog.findFirstOrThrow({
        where: { chatId, decision: 'handoff' },
        select: { details: true },
      });
      expect(record.details).toMatchObject({ handoff_id: card.id });

      // The connection's summary is the card's line (AI-10 §4).
      const thread = await owner.thread.findUniqueOrThrow({
        where: { id: threadId },
        select: { summary: true },
      });
      expect(thread.summary).toBe(card.summary);
      expect(thread.summary).not.toMatch(/Customer asked/);
      expect(await owner.aiHandoff.count({ where: { chatId } })).toBe(1);
    });

    it('tells the player what they gave, in one message (AI-10-S1)', async () => {
      const { chatId } = await depositHandoff();
      const said = await owner.event.findMany({
        where: { chatId, authorType: 'bot' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      });
      expect(said.at(-1)?.text).toMatch(
        /\nŞu bilgileri ilettim: Havale, .+\. Yanlış bir bilgi varsa yazabilirsiniz\.$/,
      );
    });

    it('leaves the card’s text in the transcript for the agents only — never the visitor', async () => {
      const { chatId, threadId, headers, card } = await depositHandoff();
      const line = await owner.event.findFirstOrThrow({
        where: {
          threadId,
          properties: { path: ['system_event'], equals: AI_HANDOFF_CARD_SYSTEM_EVENT },
        },
        select: { text: true, recipients: true, authorType: true, properties: true },
      });
      expect(line).toMatchObject({
        text: card.card_text,
        recipients: 'agents',
        authorType: 'system',
        properties: { ai_handoff_id: card.id },
      });
      const widget = await server.get('/customer/chat', headers);
      expect(widget.statusCode).toBe(200);
      expect(widget.body).not.toContain('Konu: Yatırım geçmedi');
      expect(widget.body).not.toContain(AI_HANDOFF_CARD_SYSTEM_EVENT);
      const own = await server.get(`/chats/${chatId}`, headers);
      expect(own.statusCode).toBe(200);
      expect(own.json()).not.toHaveProperty('latest_ai_handoff');
    });

    it('pushes `ai_handoff_created` and the summary to the agents and the target team within a second (AI-10 acceptance)', async () => {
      const { chatId, threadId, card } = await depositHandoff();
      const created = pushes.filter((push) => push.action === 'ai_handoff_created');
      expect(created).toHaveLength(1);
      expect(created[0]!.payload).toEqual({
        chat_id: chatId,
        thread_id: threadId,
        handoff_id: card.id,
        primary_reason: 'procedure_rule',
        priority: 'normal',
        target_group_id: Number(financeId),
      });
      expect(created[0]!.audience.groupIds).toContain(Number(financeId));
      expect(created[0]!.audience.customerId).toBeUndefined();
      expect(created[0]!.at - Date.parse(card.created_at)).toBeLessThan(1000);

      const summary = pushes.find((push) => push.action === 'thread_summary_set');
      expect(summary?.payload).toEqual({
        chat_id: chatId,
        thread_id: threadId,
        summary: card.summary,
      });
      const line = pushes.find(
        (push) =>
          push.action === 'incoming_event' &&
          (push.payload['event'] as { properties?: Record<string, unknown> }).properties?.[
            'system_event'
          ] === AI_HANDOFF_CARD_SYSTEM_EVENT,
      );
      expect(line?.audience.customerId).toBeUndefined();
    });

    it('serves the newest card on the agent’s chat read, and none to another workspace', async () => {
      const { chatId, card } = await depositHandoff();
      const detail = await server.get(`/chats/${chatId}`, as(agentToken));
      expect(detail.statusCode).toBe(200);
      expect((detail.json() as { latest_ai_handoff: AiHandoffCardView }).latest_ai_handoff).toEqual(
        card,
      );
      const elsewhere = await server.get(`/chats/${chatId}/ai-handoffs`, as(otherToken));
      expect(elsewhere.statusCode).toBe(404);
      const byConnection = await server.get(
        `/chats/${chatId}/ai-handoffs?thread_id=${card.thread_id}`,
        as(agentToken),
      );
      expect((byConnection.json() as { items: unknown[] }).items).toHaveLength(1);
      const otherConnection = await server.get(
        `/chats/${chatId}/ai-handoffs?thread_id=XXXXXXXXXX`,
        as(agentToken),
      );
      expect((otherConnection.json() as { items: unknown[] }).items).toEqual([]);
    });

    it('never carries an internal note an agent wrote before the hand-over', async () => {
      await createProcedure();
      const headers = await visitor();
      const first = await send(headers, 'param yatmadı');
      const note = await server.post(
        `/chats/${first.chatId}/events`,
        { type: 'message', text: NOTE, recipients: 'agents' },
        as(adminToken),
      );
      expect(note.statusCode, note.body).toBe(201);
      await send(headers, 'Havale, 2 saat önce');
      const [card] = await cards(first.chatId);
      expect(card).toBeDefined();
      expect(JSON.stringify(card)).not.toContain('IC-NOT-7731');
      const row = await owner.aiHandoff.findFirstOrThrow({ where: { chatId: first.chatId } });
      expect(
        JSON.stringify(row, (_, v: unknown) => (typeof v === 'bigint' ? `${v}` : v)),
      ).not.toContain('IC-NOT-7731');
    });
  });

  describe('a knowledge hand-over', () => {
    it('shows the question and why there was no answer (AI-10 acceptance)', async () => {
      // A procedure the question is not about, and a passage that does not answer it.
      const { procedure: body, ...own } = splitSkillProcedure(depositProcedure());
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
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
      });
      const faq = 'Çekim talepleri genellikle 24 saat içinde işlenir.';
      const source = await owner.knowledgeSource.create({
        data: {
          aiAgentId,
          licenseId: fx.a.licenseId,
          type: 'faq',
          name: 'Çekim SSS',
          status: 'ready',
          updatedAt: new Date(),
        },
        select: { id: true },
      });
      await owner.$executeRawUnsafe(
        `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
         VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
        source.id,
        fx.a.licenseId.toString(),
        faq,
        toVectorLiteral(embed(faq)),
      );

      const question = 'USDT cüzdan adresimi nasıl değiştiririm?';
      const { chatId } = await send(await visitor(), question);
      const [card] = await cards(chatId);
      expect(card).toMatchObject({
        topic: null,
        question,
        summary: `Soru: ${question}`,
        primary_reason: 'no_knowledge',
        slots: [],
        decision_facts: [{ field: 'knowledge', text: 'no_passages' }],
      });
      expect(card!.card_text).toContain(`Soru: ${question}`);
      expect(card!.card_text).toContain('Devir nedeni: no_knowledge');
    });
  });

  describe('the agent’s side', () => {
    it('keeps one verdict per card — a second click overwrites it, no row is added (AI-10 acceptance)', async () => {
      const { chatId, card } = await depositHandoff();
      const first = await server.post(
        `/ai-handoffs/${card.id}/feedback`,
        { value: 'sufficient' },
        as(agentToken),
      );
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json()).toMatchObject({
        feedback: 'sufficient',
        feedback_reason: null,
        feedback_by: fx.a.agentAccountId,
      });
      const again = await server.post(
        `/ai-handoffs/${card.id}/feedback`,
        { value: 'insufficient', reason: 'IBAN eksik' },
        as(agentToken),
      );
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({
        feedback: 'insufficient',
        feedback_reason: 'IBAN eksik',
      });
      expect(await owner.aiHandoff.count({ where: { chatId } })).toBe(1);
      const row = await owner.aiHandoff.findUniqueOrThrow({ where: { id: card.id } });
      expect(row).toMatchObject({ feedback: 'insufficient', feedbackReason: 'IBAN eksik' });
      expect(row.feedbackAt).toBeInstanceOf(Date);
    });

    it('refuses a verdict outside the list, another workspace’s agent and the visitor', async () => {
      const { card, headers } = await depositHandoff();
      const bad = await server.post(
        `/ai-handoffs/${card.id}/feedback`,
        { value: 'meh' },
        as(agentToken),
      );
      expect(bad.statusCode).toBe(400);
      const extra = await server.post(
        `/ai-handoffs/${card.id}/feedback`,
        { value: 'sufficient', note: 'x' },
        as(agentToken),
      );
      expect(extra.statusCode).toBe(400);
      const elsewhere = await server.post(
        `/ai-handoffs/${card.id}/feedback`,
        { value: 'sufficient' },
        as(otherToken),
      );
      expect(elsewhere.statusCode).toBe(404);
      const unknown = await server.post(
        '/ai-handoffs/00000000-0000-4000-8000-000000000000/feedback',
        { value: 'sufficient' },
        as(agentToken),
      );
      expect(unknown.statusCode).toBe(404);
      const fromWidget = await server.post(
        `/ai-handoffs/${card.id}/feedback`,
        { value: 'sufficient' },
        headers,
      );
      expect([401, 403, 404]).toContain(fromWidget.statusCode);
      expect(
        (await owner.aiHandoff.findUniqueOrThrow({ where: { id: card.id } })).feedback,
      ).toBeNull();
    });

    it('is taken up by the agent’s first message to the player after it — once', async () => {
      const { chatId, card } = await depositHandoff();
      const reply = await server.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'Merhaba, inceliyorum.' },
        as(agentToken),
      );
      expect(reply.statusCode, reply.body).toBe(201);
      const taken = await owner.aiHandoff.findUniqueOrThrow({ where: { id: card.id } });
      expect(taken.acceptedBy).toBe(fx.a.agentAccountId);
      expect(taken.acceptedAt).toBeInstanceOf(Date);

      await server.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'Bir dakika lütfen.' },
        as(adminToken),
      );
      const still = await owner.aiHandoff.findUniqueOrThrow({ where: { id: card.id } });
      expect(still.acceptedBy).toBe(fx.a.agentAccountId);
      expect(still.acceptedAt).toEqual(taken.acceptedAt);
    });
  });

  describe('the table', () => {
    it('is behind RLS; the app may read, write and update, never delete or empty it', async () => {
      const [rls] = await owner.$queryRaw<Array<{ enabled: boolean }>>`
        SELECT relrowsecurity AS enabled FROM pg_class WHERE relname = 'ai_handoffs'`;
      expect(rls?.enabled).toBe(true);
      const [grants] = await owner.$queryRaw<
        Array<{
          select: boolean;
          insert: boolean;
          update: boolean;
          delete: boolean;
          truncate: boolean;
        }>
      >`
        SELECT has_table_privilege('siyahtus_app', 'ai_handoffs', 'SELECT') AS select,
               has_table_privilege('siyahtus_app', 'ai_handoffs', 'INSERT') AS insert,
               has_table_privilege('siyahtus_app', 'ai_handoffs', 'UPDATE') AS update,
               has_table_privilege('siyahtus_app', 'ai_handoffs', 'DELETE') AS delete,
               has_table_privilege('siyahtus_app', 'ai_handoffs', 'TRUNCATE') AS truncate`;
      expect(grants).toEqual({
        select: true,
        insert: true,
        update: true,
        delete: false,
        truncate: false,
      });
    });

    it('is written once: the card is not rewritten, taken up twice, or judged outside the list', async () => {
      const { card } = await depositHandoff();
      await expect(
        owner.aiHandoff.update({ where: { id: card.id }, data: { summary: 'başka' } }),
      ).rejects.toThrow(/not rewritten/);
      await owner.aiHandoff.update({
        where: { id: card.id },
        data: { acceptedBy: fx.a.agentAccountId, acceptedAt: new Date() },
      });
      await expect(
        owner.aiHandoff.update({
          where: { id: card.id },
          data: { acceptedBy: fx.a.ownerAccountId, acceptedAt: new Date() },
        }),
      ).rejects.toThrow(/taken up once/);
      await expect(
        owner.aiHandoff.update({
          where: { id: card.id },
          data: { feedback: 'maybe', feedbackBy: fx.a.agentAccountId, feedbackAt: new Date() },
        }),
      ).rejects.toThrow(/ai_handoffs_feedback_check/);
      await expect(
        owner.aiHandoff.update({ where: { id: card.id }, data: { feedback: 'sufficient' } }),
      ).rejects.toThrow(/ai_handoffs_feedback_fields_check/);
    });

    it('refuses a card filed on another workspace’s conversation', async () => {
      const { chatId, threadId } = await depositHandoff();
      await expect(
        owner.aiHandoff.create({
          data: {
            id: '00000000-0000-4000-8000-000000000001',
            licenseId: fx.b.licenseId,
            chatId,
            threadId,
            summary: 'x',
            reasonCodes: ['procedure_rule'],
            primaryReason: 'procedure_rule',
            priority: 'normal',
            cardText: 'x',
          },
        }),
      ).rejects.toThrow(/Foreign key constraint/);
      await expect(
        owner.aiHandoff.create({
          data: {
            id: '00000000-0000-4000-8000-000000000002',
            licenseId: fx.a.licenseId,
            chatId,
            threadId,
            summary: 'x',
            reasonCodes: ['procedure_rule', 'ai_failure'],
            primaryReason: 'ai_failure',
            priority: 'normal',
            cardText: 'x',
          },
        }),
      ).rejects.toThrow(/ai_handoffs_reasons_check/);
    });
  });
});
