/**
 * The widget's availability (tm 341 · SiyahTuş analysis WG-09), through the
 * real server:
 *
 *   - the setting: `availability_mode` on `/settings/widget`, `always` until
 *     saved, only the two modes accepted;
 *   - `GET /customer/chat` `can_start_chat` + `answered_by` across the
 *     decision table — an AI that would answer keeps the chat open in either
 *     mode, a paused one or one the visitor has used up does not count;
 *   - `always` with nobody there opens a chat that waits unassigned;
 *   - `agents_only` takes a message left in the widget with only the built-in
 *     fields, where `always` still wants the workspace's own questions.
 */
import { type PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

// Nothing about money, bonuses or accounts, and no promise: the AI answers it.
const AI_ANSWER = 'Evet, karanlık temayı ayarlar menüsünden açabilirsiniz.';
const QUESTION = 'Merhaba, sitenizde karanlık tema var mı?';

interface ChatState {
  online: boolean;
  can_start_chat: boolean;
  answered_by: 'human' | 'ai' | 'none';
  chat: { id: string; thread_id: string | null } | null;
}

describe('widget availability: always / agents_only (WG-09)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let brandId: string;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function visitor(): Promise<{ headers: Record<string, string>; customerId: string }> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    const minted = response.json() as { token: string; customer_id: string };
    return { headers: auth(minted.token), customerId: minted.customer_id };
  }

  async function state(headers: Record<string, string>): Promise<ChatState> {
    const response = await server.get('/customer/chat', headers);
    expect(response.statusCode).toBe(200);
    return response.json() as ChatState;
  }

  async function setMode(mode: string) {
    return server.put('/settings/widget', { availability_mode: mode }, auth(adminToken));
  }

  async function routing(status: 'accepting_chats' | 'not_accepting_chats'): Promise<void> {
    await owner.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { routingStatus: status },
    });
  }

  /** An AI agent with one active skill — one that would answer — or a paused one. */
  async function aiAgent(active = true): Promise<void> {
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active },
      select: { id: true },
    });
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId: agent.id,
        name: 'Skill',
        kind: 'ai_agent',
        steps: [{ type: 'send_message', source: 'text', text: AI_ANSWER }],
        active: true,
        updatedAt: new Date(),
      },
    });
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
    brandId = await seedDefaultBrand(owner, fx.a.licenseId);
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw', 'chats--all:rw'],
    });
  });

  describe('the setting', () => {
    it('reads `always` until saved, saves `agents_only` on the brand, and refuses anything else (FR-MOD-11.7)', async () => {
      const before = await server.get('/settings/widget', auth(adminToken));
      expect(before.json()).toMatchObject({ availability_mode: 'always' });

      const saved = await setMode('agents_only');
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ brand_id: brandId, availability_mode: 'agents_only' });
      const row = await owner.widgetSettings.findUniqueOrThrow({
        where: { licenseId_brandId: { licenseId: fx.a.licenseId, brandId } },
        select: { availabilityMode: true, fallbackLanguage: true },
      });
      // A first save fills the rest from the defaults, as any other field's does.
      expect(row).toEqual({ availabilityMode: 'agents_only', fallbackLanguage: 'tr' });

      expect((await setMode('never')).statusCode).toBe(400);
      await expect(
        owner.$executeRaw`UPDATE widget_settings SET availability_mode = 'never' WHERE brand_id = ${brandId}::uuid`,
      ).rejects.toThrow(/widget_settings_availability_mode_check/);
    });
  });

  describe('can_start_chat and answered_by', () => {
    it('with no AI: a person while anyone accepts chats; nobody — `always` opens a chat, `agents_only` does not', async () => {
      const { headers } = await visitor();

      await routing('accepting_chats');
      expect(await state(headers)).toMatchObject({
        online: true,
        can_start_chat: true,
        answered_by: 'human',
      });

      await routing('not_accepting_chats');
      expect(await state(headers)).toMatchObject({
        online: false,
        can_start_chat: true,
        answered_by: 'none',
      });

      expect((await setMode('agents_only')).statusCode).toBe(200);
      expect(await state(headers)).toMatchObject({
        online: false,
        can_start_chat: false,
        answered_by: 'none',
      });

      await routing('accepting_chats');
      expect(await state(headers)).toMatchObject({ can_start_chat: true, answered_by: 'human' });
    });

    it('an AI that would answer opens the chat with nobody there, offline form built and `agents_only` saved', async () => {
      await aiAgent();
      await routing('not_accepting_chats');
      expect((await setMode('agents_only')).statusCode).toBe(200);
      // The offline form is built: before WG-09 the widget showed it instead.
      await owner.customFieldDefinition.create({
        data: {
          licenseId: fx.a.licenseId,
          entity: 'ticket',
          label: 'Affected order',
          type: 'text',
          formPlacement: 'ticket',
        },
      });
      const { headers } = await visitor();

      expect(await state(headers)).toMatchObject({
        online: false,
        can_start_chat: true,
        answered_by: 'ai',
      });

      // …and the player does talk to the AI.
      const sent = await server.post('/customer/chat/events', { text: QUESTION }, headers);
      expect(sent.statusCode).toBe(201);
      const { chat_id: chatId } = sent.json() as { chat_id: string };
      const replies = await owner.event.findMany({
        where: { chatId, authorType: 'bot', type: 'message' },
        select: { text: true },
      });
      expect(replies.map((e) => e.text)).toEqual([AI_ANSWER]);
      expect(await state(headers)).toMatchObject({ can_start_chat: true, answered_by: 'ai' });
    });

    it('a paused AI, or one the visitor has used up today, is no AI', async () => {
      await routing('not_accepting_chats');
      expect((await setMode('agents_only')).statusCode).toBe(200);

      await aiAgent(false);
      const { headers, customerId } = await visitor();
      expect(await state(headers)).toMatchObject({ can_start_chat: false, answered_by: 'none' });

      await owner.aiAgent.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { active: true },
      });
      expect(await state(headers)).toMatchObject({ can_start_chat: true, answered_by: 'ai' });

      // One turn a day, already taken — on every day the boundary could put
      // "today" on, so the test does not care what time it runs.
      await owner.securitySettings.upsert({
        where: { licenseId_brandId: { licenseId: fx.a.licenseId, brandId } },
        create: { licenseId: fx.a.licenseId, brandId, aiTurnsPerCustomerDay: 1 },
        update: { aiTurnsPerCustomerDay: 1 },
      });
      await owner.$executeRaw`
        INSERT INTO ai_customer_daily_usage (license_id, customer_id, day, ai_turns, updated_at)
        SELECT ${fx.a.licenseId}, ${customerId}::uuid, d::date, 1, now()
          FROM generate_series(current_date - 1, current_date + 1, interval '1 day') AS d`;
      expect(await state(headers)).toMatchObject({ can_start_chat: false, answered_by: 'none' });
    });

    it('`always` with nobody there opens a chat that waits unassigned', async () => {
      await routing('not_accepting_chats');
      const { headers } = await visitor();
      expect(await state(headers)).toMatchObject({ can_start_chat: true, answered_by: 'none' });

      const sent = await server.post('/customer/chat/events', { text: 'Anyone there?' }, headers);
      expect(sent.statusCode).toBe(201);
      const { event } = sent.json() as { event: { thread_id: string } };
      const thread = await owner.thread.findUniqueOrThrow({
        where: { id: event.thread_id },
        select: { active: true, assigneeId: true },
      });
      expect(thread).toEqual({ active: true, assigneeId: null });

      // In the conversation now: nobody answers yet, and the widget stays on it.
      expect(await state(headers)).toMatchObject({
        can_start_chat: true,
        answered_by: 'none',
        chat: { thread_id: event.thread_id },
      });
    });
  });

  describe('a message left in the widget', () => {
    it('`agents_only` takes it with the built-in fields alone; `always` still wants a built form (FR-MOD-08.7.7)', async () => {
      const { headers } = await visitor();
      const leave = () =>
        server.post(
          '/customer/ticket',
          { subject: 'Çekimim nerede?', name: 'Dana', email: 'dana@example.com' },
          headers,
        );

      expect((await leave()).statusCode).toBe(400);
      expect(await owner.ticket.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);

      expect((await setMode('agents_only')).statusCode).toBe(200);
      const left = await leave();
      expect(left.statusCode).toBe(201);
      const { ticket_id } = left.json() as { ticket_id: string };
      const ticket = await owner.ticket.findUniqueOrThrow({
        where: { id: ticket_id },
        select: { subject: true, customerId: true },
      });
      expect(ticket.subject).toBe('Çekimim nerede?');
      expect(ticket.customerId).not.toBeNull();
    });
  });
});
