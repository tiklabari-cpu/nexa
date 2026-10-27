/**
 * The AI says what it is, and "Talk to an agent" (tm 308 · SiyahTuş analysis
 * AI-29 · G16), on real visitor messages through the real server and the AI
 * job worker:
 *
 *   - the disclosure: the AI's first reply on a connection opens with
 *     "{name}, {brand}'s AI assistant" and the agent's opening words, even when
 *     those words leave the sentence out; later replies do not repeat it;
 *   - who has the connection (`GET /customer/chat` `owner`): the AI while it
 *     answers, a person or the queue after the hand-over;
 *   - `POST /customer/chat/request-human`: a hand-over at once, reason
 *     `player_request` and `requested_via: 'button'` on the card, to the team
 *     its route names, the AI silent from then on; two presses at once hand
 *     over once; after hours the right words and the conversation waits in
 *     the queue; a connection that is not the AI's is left as it is; a
 *     per-visitor budget (GV-01).
 */
import { type PrismaClient } from '@prisma/client';
import { aiDisclosureSentence } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

// Nothing about money, bonuses or accounts, and no promise: the AI answers
// it itself rather than hand it over (AI-06, AI-08).
const AI_ANSWER = 'Evet, karanlık temayı ayarlar menüsünden açabilirsiniz.';
const QUESTION = 'Merhaba, sitenizde karanlık tema var mı?';
const PASSING_ON = 'Sizi bir temsilcimize aktarıyorum.';

describe('the AI discloses itself and hands over on "Talk to an agent" (AI-29 · G16)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let supportId: bigint;
  let logisticsId: bigint;
  let adminToken: string;
  let sentence: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function visitor(): Promise<Record<string, string>> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
  }

  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  const press = (headers: Record<string, string>) =>
    server.post('/customer/chat/request-human', { reason: 'button' }, headers);

  const botTexts = async (chatId: string) =>
    (
      await owner.event.findMany({
        where: { chatId, authorType: 'bot', type: 'message' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      })
    ).map((e) => e.text);

  const thread = (threadId: string) =>
    owner.thread.findUniqueOrThrow({
      where: { id: threadId },
      select: { active: true, assigneeId: true, queuePosition: true, aiMode: true, groupId: true },
    });

  const patchAgent = (body: object) =>
    server.patch(`/ai-agents/${aiAgentId}`, body, auth(adminToken));

  async function nobodyAccepting(): Promise<void> {
    await owner.agentMembership.updateMany({
      where: { licenseId: fx.a.licenseId },
      data: { routingStatus: 'not_accepting_chats' },
    });
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { aiDisclosure: true });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Skill',
        kind: 'ai_agent',
        steps: [{ type: 'send_message', source: 'text', text: AI_ANSWER }],
        active: true,
        updatedAt: new Date(),
      },
    });
    // `route()` takes the first team, Support (the agent's); Logistics is the owner's.
    supportId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      })
    ).id;
    logisticsId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Logistics' },
        select: { id: true },
      })
    ).id;
    await owner.groupAgent.createMany({
      data: [
        { licenseId: fx.a.licenseId, groupId: supportId, agentId: fx.a.agentAccountId },
        { licenseId: fx.a.licenseId, groupId: logisticsId, agentId: fx.a.ownerAccountId },
      ],
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'agents-bot--all:rw'],
    });
    // AI-first: the connection opens unassigned, in `ai` mode (tm 293.2).
    const mode = await server.put(
      `/ai-agents/${aiAgentId}/handoff-settings`,
      { assignment_mode: 'ai_first' },
      auth(adminToken),
    );
    expect(mode.statusCode).toBe(200);
    const organization = await owner.organization.findUniqueOrThrow({
      where: { id: fx.a.organizationId },
      select: { name: true },
    });
    sentence = aiDisclosureSentence({ name: 'Ada', brand: organization.name, language: 'tr' });
  });

  describe('the disclosure', () => {
    it('opens the first reply of a connection, and only the first (FR-MOD-11.3)', async () => {
      const headers = await visitor();
      const { chatId } = await send(headers, QUESTION);
      await send(headers, 'Peki ya telefonda?');

      expect(await botTexts(chatId)).toEqual([`${sentence}\n\n${AI_ANSWER}`, AI_ANSWER]);
    });

    it('goes in front of opening words that leave it out — the workspace cannot remove it (FR-MOD-11.3)', async () => {
      const saved = await patchAgent({ welcome_message: '  Size nasıl yardımcı olabilirim?  ' });
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({ welcome_message: 'Size nasıl yardımcı olabilirim?' });

      const { chatId } = await send(await visitor(), QUESTION);

      expect(await botTexts(chatId)).toEqual([
        `${sentence} Size nasıl yardımcı olabilirim?\n\n${AI_ANSWER}`,
      ]);
    });

    it('names the brand of the site the player came through, and the workspace for its default brand (FR-MOD-11.3)', async () => {
      // Sign-up names the default brand "Default": the workspace speaks for it.
      const defaultBrand = await seedDefaultBrand(owner, fx.a.licenseId);
      const brand = await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Kasa Bahis', slug: 'kasa' },
        select: { id: true },
      });
      const host = `b.${fx.a.trustedDomain}`;
      await owner.website.create({
        data: { licenseId: fx.a.licenseId, brandId: brand.id, domain: host },
      });
      const mint = async (site: string) => {
        const response = await server.post(
          '/customer/token',
          { organization_id: fx.a.organizationId, host_origin: `https://${site}` },
          { origin: `https://${site}` },
        );
        expect(response.statusCode).toBe(200);
        return { authorization: `Bearer ${(response.json() as { token: string }).token}` };
      };

      const branded = await send(await mint(host), QUESTION);
      expect((await botTexts(branded.chatId))[0]).toBe(
        `Ada, Kasa Bahis'in yapay zekâ asistanıyım.

${AI_ANSWER}`,
      );
      const plain = await send(await mint(fx.a.trustedDomain), QUESTION);
      const chat = await owner.chat.findUniqueOrThrow({
        where: { id: plain.chatId },
        select: { brandId: true },
      });
      expect(chat.brandId).toBe(defaultBrand);
      expect((await botTexts(plain.chatId))[0]).toBe(`${sentence}

${AI_ANSWER}`);
    });

    it('keeps opening words that carry it as written', async () => {
      const own = `Merhaba! ${sentence} Size nasıl yardımcı olabilirim?`;
      expect((await patchAgent({ welcome_message: own })).statusCode).toBe(200);

      const { chatId } = await send(await visitor(), QUESTION);

      expect(await botTexts(chatId)).toEqual([`${own}\n\n${AI_ANSWER}`]);
    });

    it('clears the opening words on null or blank, and refuses a text over 500', async () => {
      expect((await patchAgent({ welcome_message: 'Hoş geldiniz.' })).statusCode).toBe(200);
      const cleared = await patchAgent({ welcome_message: '   ' });
      expect(cleared.json()).toMatchObject({ welcome_message: null });
      expect((await patchAgent({ welcome_message: 'x'.repeat(501) })).statusCode).toBe(400);
      expect((await patchAgent({ human_button_label: 'x'.repeat(41) })).statusCode).toBe(400);
    });
  });

  describe('who has the connection', () => {
    it('is the AI while it answers, in the agent’s words for the button, and a person after the press', async () => {
      expect((await patchAgent({ human_button_label: 'Canlı destek' })).statusCode).toBe(200);
      const headers = await visitor();
      await send(headers, QUESTION);

      const before = (await server.get('/customer/chat', headers)).json() as Record<
        string,
        unknown
      >;
      expect(before).toMatchObject({
        owner: 'ai',
        human_available: true,
        human_button_label: 'Canlı destek',
      });

      expect((await press(headers)).json()).toEqual({
        owner: 'human',
        human_available: true,
        requested: true,
      });
      const after = (await server.get('/customer/chat', headers)).json() as Record<string, unknown>;
      expect(after['owner']).toBe('human');
    });

    it('words the button in the language the conversation opened in, unless the agent reworded it', async () => {
      const turkish = await visitor();
      const opened = await server.post(
        '/customer/chat/events',
        { text: QUESTION, locale: 'tr' },
        turkish,
      );
      expect(opened.statusCode).toBe(201);
      expect((await server.get('/customer/chat', turkish)).json()).toMatchObject({
        owner: 'ai',
        human_button_label: 'Temsilciyle görüş',
      });

      const english = await visitor();
      await send(english, QUESTION);
      expect((await server.get('/customer/chat', english)).json()).toMatchObject({
        human_button_label: 'Talk to an agent',
      });
    });

    it('is nobody’s before the visitor writes', async () => {
      const state = (await server.get('/customer/chat', await visitor())).json() as Record<
        string,
        unknown
      >;
      expect(state).toMatchObject({ chat: null, owner: null, human_button_label: null });
    });
  });

  describe('the press', () => {
    it('hands over at once with `player_request`, and the AI writes nothing more', async () => {
      const headers = await visitor();
      const { chatId, threadId } = await send(headers, QUESTION);

      const response = await press(headers);
      expect(response.statusCode).toBe(200);

      expect(await thread(threadId)).toMatchObject({
        aiMode: 'human',
        assigneeId: fx.a.agentAccountId,
        groupId: supportId,
      });
      const cards = await owner.aiHandoff.findMany({
        where: { threadId },
        select: { primaryReason: true, reasonCodes: true, requestedVia: true },
      });
      expect(cards).toEqual([
        {
          primaryReason: 'player_request',
          reasonCodes: ['player_request'],
          requestedVia: 'button',
        },
      ]);
      // The card as the inbox reads it.
      const served = await server.get(`/chats/${chatId}/ai-handoffs`, auth(adminToken));
      expect(served.statusCode).toBe(200);
      expect((served.json() as { items: object[] }).items[0]).toMatchObject({
        primary_reason: 'player_request',
        requested_via: 'button',
      });
      // The hand-over's lines carry it, for the reports (AI-25).
      const lines = await owner.event.count({
        where: {
          threadId,
          properties: { path: ['requested_via'], equals: 'button' },
          type: 'system_message',
        },
      });
      expect(lines).toBeGreaterThan(0);

      // No clarifying question: the press is the request. Then silence (AI-11).
      await send(headers, 'Hâlâ bekliyorum.');
      expect(await botTexts(chatId)).toEqual([`${sentence}\n\n${AI_ANSWER}`, PASSING_ON]);
    });

    it('goes to the team the `player_request` route names', async () => {
      await owner.handoffRoute.create({
        data: {
          licenseId: fx.a.licenseId,
          matchType: 'reason',
          matchKey: 'player_request',
          groupId: logisticsId,
        },
      });
      const headers = await visitor();
      const { threadId } = await send(headers, QUESTION);

      expect((await press(headers)).statusCode).toBe(200);

      expect(await thread(threadId)).toMatchObject({
        aiMode: 'human',
        groupId: logisticsId,
        assigneeId: fx.a.ownerAccountId,
      });
    });

    it('hands over once for two presses at once', async () => {
      const headers = await visitor();
      const { chatId, threadId } = await send(headers, QUESTION);

      const responses = await Promise.all([
        server.app.inject({
          method: 'POST',
          url: server.url('/customer/chat/request-human'),
          headers,
          payload: {},
        }),
        server.app.inject({
          method: 'POST',
          url: server.url('/customer/chat/request-human'),
          headers,
          payload: {},
        }),
      ]);
      await server.app.aiJobs.idle();

      expect(responses.map((r) => r.statusCode)).toEqual([200, 200]);
      expect(responses.map((r) => (r.json() as { requested: boolean }).requested).sort()).toEqual([
        false,
        true,
      ]);
      expect(await owner.aiHandoff.count({ where: { threadId } })).toBe(1);
      expect(await botTexts(chatId)).toEqual([`${sentence}\n\n${AI_ANSWER}`, PASSING_ON]);
      // A third press later: a person has it.
      expect((await press(headers)).json()).toMatchObject({ owner: 'human', requested: false });
      expect(await owner.aiHandoff.count({ where: { threadId } })).toBe(1);
    });

    it('after hours says so, and the conversation waits in the queue (AI-29-S2)', async () => {
      const headers = await visitor();
      const { chatId, threadId } = await send(headers, QUESTION);
      await nobodyAccepting();

      expect((await press(headers)).json()).toEqual({
        owner: 'queue',
        human_available: false,
        requested: true,
      });

      const texts = await botTexts(chatId);
      expect(texts.at(-1)).toBe(
        `${PASSING_ON}\nEkibimiz şu anda müsait değil. Mesajınız sırada; ekibimiz döndüğünde size yazacak.`,
      );
      const waiting = await thread(threadId);
      expect(waiting).toMatchObject({ active: true, assigneeId: null, aiMode: 'human' });
      expect(waiting.queuePosition).not.toBeNull();
    });

    it('after hours with a work schedule says when the team is back (AI-29-S2)', async () => {
      // Open only two days from now, 09:00–18:00 in Istanbul (the workspace's zone).
      const back = new Date(Date.now() + 2 * 86_400_000);
      const day = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', weekday: 'long' })
        .format(back)
        .toLowerCase();
      const weekday = new Intl.DateTimeFormat('tr-TR', {
        timeZone: 'Europe/Istanbul',
        weekday: 'long',
      }).format(back);
      await owner.workSchedule.create({
        data: {
          licenseId: fx.a.licenseId,
          agentId: fx.a.agentAccountId,
          timezone: 'Europe/Istanbul',
          schedule: [{ day, start: '09:00', end: '18:00', enabled: true }],
        },
      });
      const headers = await visitor();
      const { chatId } = await send(headers, QUESTION);
      await nobodyAccepting();

      expect((await press(headers)).statusCode).toBe(200);

      expect((await botTexts(chatId)).at(-1)).toBe(
        `${PASSING_ON}\nTemsilcilerimiz şu an çevrimdışı, ${weekday} 09:00 itibarıyla dönüş yapılacak; talebiniz kaydedildi.`,
      );
    });

    it('after hours says the workspace’s own words when it wrote some', async () => {
      const written = await server.put(
        `/ai-agents/${aiAgentId}/handoff-settings`,
        { after_hours: { text: 'Mesai saatlerimiz 09:00–18:00.' } },
        auth(adminToken),
      );
      expect(written.statusCode).toBe(200);
      const headers = await visitor();
      const { chatId } = await send(headers, QUESTION);
      await nobodyAccepting();

      expect((await press(headers)).statusCode).toBe(200);

      expect((await botTexts(chatId)).at(-1)).toBe(`${PASSING_ON}\nMesai saatlerimiz 09:00–18:00.`);
    });

    it('leaves a connection a person has as it is', async () => {
      const headers = await visitor();
      const { chatId, threadId } = await send(headers, QUESTION);
      expect((await press(headers)).statusCode).toBe(200);
      const handedOver = await thread(threadId);

      expect((await press(headers)).json()).toEqual({
        owner: 'human',
        human_available: true,
        requested: false,
      });
      expect(await thread(threadId)).toEqual(handedOver);
      expect(await botTexts(chatId)).toHaveLength(2);
    });

    it('answers 409 with no open conversation, and refuses an unknown reason', async () => {
      const headers = await visitor();
      const none = await press(headers);
      expect(none.statusCode).toBe(409);
      expect(none.json()).toMatchObject({ error: { type: 'chat_inactive' } });

      await send(headers, QUESTION);
      const odd = await server.post('/customer/chat/request-human', { reason: 'typed' }, headers);
      expect(odd.statusCode).toBe(400);
    });

    it('is limited per visitor: the eleventh press in an hour is 429 (GV-01)', async () => {
      const headers = await visitor();
      await send(headers, QUESTION);
      for (let n = 0; n < 10; n += 1) expect((await press(headers)).statusCode).toBe(200);

      const refused = await press(headers);
      expect(refused.statusCode).toBe(429);
      expect(refused.headers['retry-after']).toBeDefined();
    });

    it('is not an agent’s endpoint', async () => {
      const response = await server.post('/customer/chat/request-human', {}, auth(adminToken));
      expect([401, 404]).toContain(response.statusCode);
    });
  });
});
