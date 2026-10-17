/**
 * Same-day memory (tm 294 · SiyahTuş analysis AI-02; owner decisions K4, K5),
 * on real visitor messages through the real server and the AI job worker.
 *
 * A member who wrote "Papara 2,500 TL, it has not arrived" this morning and is
 * back at noon is not asked the same questions again: the day's earlier
 * connections leave a summary each (`ai_conversations.digest`), and the next
 * connection's first turn reads them. What is pinned here:
 *
 *   - the same day, with the member's own token: the AI's first answer recalls
 *     the topic and how it ended, asks nothing collected earlier, marks the
 *     repeat contact and the card says "contact 2";
 *   - the next day: nothing is recalled;
 *   - a claimed identity (a bare `customer_id` adopted once): neither the model
 *     request nor the reply holds the earlier amount, method or topic;
 *   - a verified member's model request holds them, as internal context — and
 *     an answer that repeats them unasked is withheld (K5);
 *   - a connection the inactivity sweep closes mid-question: `abandoned`, its
 *     slots in the summary, readable by an agent;
 *   - another workspace's summaries: never read, never served;
 *   - the setting: off means nothing is read.
 *
 * Slots: nothing in the engine collects them yet (AI-04, #295). Where a test
 * needs the first connection to have collected something it writes the
 * conversation's `slots` the way #295 will, and reads what the day carries.
 */
import { PrismaClient } from '@prisma/client';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { IDENTITY_TRUSTS } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { loadDailyDigests } from '../../src/services/chat/ai-digest.js';
import type { LlmCompletionRequest } from '../../src/services/ai/provider/llm-provider.js';
import { ChatService } from '../../src/services/chat/chat-service.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  auditContextFor,
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { mintForExistingCustomer } from '../helpers/member-token.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const HOUR = 3_600_000;
const TOPIC = 'Papara yatırımı';
const FIRST = 'Papara ile 2.500 TL yatırdım, gelmedi';
const AGAIN = 'Hâlâ gelmedi';
const RECALL =
  'Bugün daha önce «Papara yatırımı» konusunda yazmıştınız; konu ekibimize iletilmişti.';
const ASK = 'Bugün daha önce de bize yazmış mıydınız?';
const CHECKING = 'Kontrol ediyorum.';
/** No amount, no method: what the knowledge answer is grounded in. */
const PASSAGE =
  'Yatırım hâlâ gelmedi mi? Yatırımlar genellikle 15 dakika içinde hesaba geçer; gecikmede finans ekibi kontrol eder.';
/** What #295 will have collected in the first connection. */
const COLLECTED = {
  amount: { value: 2500, display: '2.500 TRY', status: 'filled' },
  method: { display: 'Papara', status: 'filled' },
};
/** The earlier details, however a request or a reply might write them. */
const DETAILS = /2[.,]?500|TRY|Papara/i;

/** The send path's idempotency cache, unused here. */
const NO_REDIS = {
  set: async (): Promise<string | null> => null,
  get: async (): Promise<string | null> => null,
};

interface Visitor {
  headers: Record<string, string>;
  customerId: string;
  memberToken: string;
}

describe("the AI recalls the member's day (AI-02 · K4 · K5)", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let financeId: bigint;
  let adminToken: string;
  const model = new FakeLlmProvider({
    // An answer that repeats the earlier details whenever the prompt carried them.
    reply: (request: LlmCompletionRequest) =>
      request.system.includes('amount = 2.500 TRY')
        ? '2.500 TRY tutarındaki Papara yatırımınızı kontrol ediyorum.'
        : CHECKING,
  });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  async function mint(body: Record<string, unknown> = {}): Promise<Visitor> {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId, ...body },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    expect(response.statusCode).toBe(200);
    return visitorOf(response.json());
  }

  function visitorOf(body: unknown): Visitor {
    const { token, customer_id, member_token } = body as {
      token: string;
      customer_id: string;
      member_token: string;
    };
    return { headers: auth(token), customerId: customer_id, memberToken: member_token };
  }

  /** One visitor message; returns once the AI job it set off has run. */
  async function send(visitor: Visitor, text: string) {
    const response = await server.post('/customer/chat/events', { text }, visitor.headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  /** A skill on the deposit topic: `steps` after the gate. */
  async function skill(steps: object[]): Promise<void> {
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: TOPIC,
        kind: 'ai_agent',
        steps: [{ type: 'detect_intent', intent: 'deposit', phrases: ['gelmedi'] }, ...steps],
        active: true,
        updatedAt: new Date(),
      },
    });
  }

  /** Ask for the amount and the method, then hand over to Finance with a card. */
  const procedure = () =>
    skill([
      { type: 'request_info', field: 'amount', prompt: 'Tutar nedir?' },
      { type: 'request_info', field: 'method', prompt: 'Hangi yöntemle yatırdınız?' },
      { type: 'summarize' },
      { type: 'transfer_to_team', group: 'Finance' },
    ]);

  /** Answer from the knowledge base, then hand over to Finance. */
  const knowledge = () =>
    skill([
      { type: 'send_message', source: 'knowledge' },
      { type: 'transfer_to_team', group: 'Finance' },
    ]);

  /** What #295 will have written in the connection by the time it closes. */
  const collect = (threadId: string, slots: object = COLLECTED) =>
    owner.aiConversation.updateMany({ where: { threadId }, data: { slots } });

  async function close(chatId: string): Promise<void> {
    const response = await server.post(`/chats/${chatId}/deactivate`, {}, auth(adminToken));
    expect(response.statusCode).toBe(200);
  }

  const conversation = (threadId: string) =>
    owner.aiConversation.findFirstOrThrow({ where: { threadId } });
  const botLines = async (threadId: string) =>
    (
      await owner.event.findMany({
        where: { threadId, authorType: 'bot', type: 'message' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      })
    ).map((event) => event.text);
  const jobTrust = async (threadId: string) =>
    (
      await owner.aiJob.findFirstOrThrow({
        where: { threadId },
        orderBy: { createdAt: 'desc' },
        select: { identityTrust: true },
      })
    ).identityTrust;

  /** "It is now the next day": the chat was filed under the day before. */
  async function fileUnderYesterday(chatId: string): Promise<void> {
    const chat = await owner.chat.findUniqueOrThrow({ where: { id: chatId } });
    await owner.chat.update({
      where: { id: chatId },
      data: { localDay: new Date(chat.localDay!.getTime() - 24 * HOUR) },
    });
  }

  /** The morning: a deposit that did not arrive, handed to Finance, collected, closed. */
  async function morning(): Promise<{ member: Visitor; chatId: string; threadId: string }> {
    const member = await mint();
    const first = await send(member, FIRST);
    await collect(first.threadId);
    await close(first.chatId);
    return { member, ...first };
  }

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL is not set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer({}, { llm: model });
  });

  afterAll(async () => {
    await server.close();
    await app.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    model.reset();
    const agent = await owner.aiAgent.create({
      data: {
        licenseId: fx.a.licenseId,
        name: 'Ada',
        kind: 'ai_agent',
        active: true,
        languages: ['tr'],
      },
      select: { id: true },
    });
    aiAgentId = agent.id;
    financeId = (
      await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Finance' },
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
      scopes: ['chats--all:rw', 'agents-bot--all:rw'],
    });
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId,
        licenseId: fx.a.licenseId,
        type: 'article',
        name: 'Yatırımlar',
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
      PASSAGE,
      toVectorLiteral(embed(PASSAGE)),
    );
  });

  it('recalls the topic in its first answer, asks nothing collected earlier and marks contact 2, for a member with their token', async () => {
    await procedure();
    const { member, chatId, threadId } = await morning();
    // The morning asked and handed over; its summary says so once it closed.
    expect(await botLines(threadId)).toEqual(['Hangi yöntemle yatırdınız?']);
    const morningRow = await conversation(threadId);
    expect(morningRow.outcome).toBe('handed_off');
    expect(morningRow.closedAt).not.toBeNull();
    expect(morningRow.digest).toMatchObject({
      procedure_name: TOPIC,
      intent_label: 'deposit',
      slots: {
        amount: { display: '2.500 TRY', status: 'filled' },
        method: { display: 'Papara', status: 'filled' },
      },
      outcome: 'handed_off',
      handoff: {
        team_id: financeId.toString(),
        team_name: 'Finance',
        reason_codes: ['ai_handoff'],
        agent_replied: false,
      },
      last_ai_excerpt: 'Hangi yöntemle yatırdınız?',
    });

    // Noon, the same browser coming back with its member token.
    const verified = await mint({ member_token: member.memberToken });
    expect(verified.customerId).toBe(member.customerId);
    const noon = await send(verified, AGAIN);
    expect(noon.chatId).toBe(chatId);
    expect(noon.threadId).not.toBe(threadId);
    expect(await jobTrust(noon.threadId)).toBe('verified');

    // One line: the recall. Neither question again — both answers were carried.
    expect(await botLines(noon.threadId)).toEqual([RECALL]);
    const noonRow = await conversation(noon.threadId);
    expect(noonRow.slots).toEqual({
      amount: { display: '2.500 TRY', status: 'carried' },
      method: { display: 'Papara', status: 'carried' },
    });
    expect(noonRow.signals).toMatchObject({ repeat_same_day: true });
    const card = await owner.thread.findUniqueOrThrow({
      where: { id: noon.threadId },
      select: { summary: true },
    });
    expect(card.summary).toBe(`Same day, contact 2 · Customer asked: ${AGAIN}`);
  });

  it('recalls nothing the next day', async () => {
    await procedure();
    const { member, chatId } = await morning();
    await fileUnderYesterday(chatId);

    const verified = await mint({ member_token: member.memberToken });
    const today = await send(verified, AGAIN);
    expect(today.chatId).not.toBe(chatId);

    const lines = await botLines(today.threadId);
    expect(lines).toEqual(['Hangi yöntemle yatırdınız?']);
    expect(lines.join('\n')).not.toContain('Bugün daha önce');
    const row = await conversation(today.threadId);
    expect(row.slots).toEqual({});
    expect(row.signals).not.toHaveProperty('repeat_same_day');
    const card = await owner.thread.findUniqueOrThrow({
      where: { id: today.threadId },
      select: { summary: true },
    });
    expect(card.summary).toBe(`Customer asked: ${AGAIN}`);
  });

  it('gives a claimed identity neither the earlier amount, method nor topic — in the model request or the reply (K4)', async () => {
    await knowledge();
    const { member, chatId } = await morning();
    model.reset();

    // Another device naming the member's bare id: adopted once, proven by nothing.
    const claimed = visitorOf(
      (await mintForExistingCustomer(server, fx.a, member.customerId)).json(),
    );
    expect(claimed.customerId).toBe(member.customerId);
    const noon = await send(claimed, AGAIN);
    expect(noon.chatId).toBe(chatId);
    expect(await jobTrust(noon.threadId)).toBe('claimed');

    expect(model.calls).toHaveLength(1);
    const request = JSON.stringify(model.calls[0]);
    expect(request).toContain('who they are is not verified');
    expect(request).not.toMatch(DETAILS);
    expect(request).not.toContain(TOPIC);

    const lines = await botLines(noon.threadId);
    expect(lines).toEqual([`${ASK}\n${CHECKING}`]);
    expect(lines.join('\n')).not.toMatch(DETAILS);
    expect((await conversation(noon.threadId)).slots).toEqual({});
  });

  it("tells a verified member's model the earlier details as internal context, and withholds an answer that repeats them (K5)", async () => {
    await knowledge();
    const { member } = await morning();
    model.reset();

    const verified = await mint({ member_token: member.memberToken });
    const noon = await send(verified, AGAIN);

    expect(model.calls).toHaveLength(1);
    const { system } = model.calls[0]!;
    expect(system).toContain(`topic "${TOPIC}" (deposit)`);
    expect(system).toContain('collected: amount = 2.500 TRY; method = Papara');
    expect(system).toContain("the player's own statements, not verified");
    expect(system).toContain('Do not repeat amounts, IBANs, transaction or document numbers');
    // The model repeated the amount unasked: its answer is not sent; the
    // recall, which code wrote, is the turn's only line before the hand-over.
    expect(await botLines(noon.threadId)).toEqual([RECALL]);
    const run = await owner.skillRun.findFirstOrThrow({
      where: { threadId: noon.threadId },
      select: { log: true },
    });
    expect(JSON.stringify(run.log)).toContain('withheld — it repeated 2 detail(s)');
  });

  it('settles a connection the inactivity sweep closed mid-question as abandoned, with its slots, for the agent to read', async () => {
    await skill([{ type: 'request_info', field: 'amount', prompt: 'Tutar nedir?' }]);
    const member = await mint();
    const first = await send(member, FIRST);
    expect(await botLines(first.threadId)).toEqual(['Tutar nedir?']);
    await collect(first.threadId, { method: { display: 'Papara', status: 'filled' } });

    const chats = new ChatService(app, NO_REDIS);
    const closed = await chats.deactivateByTimeout(
      { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
      first.chatId,
      new Date(Date.now() + 60_000),
      auditContextFor(fx.a),
    );
    expect(closed).not.toBeNull();

    const row = await conversation(first.threadId);
    expect(row.outcome).toBe('abandoned');
    expect(row.digest).toMatchObject({
      outcome: 'abandoned',
      awaiting_answer: true,
      slots: { method: { display: 'Papara', status: 'filled' } },
    });

    const read = await server.get(`/chats/${first.chatId}/ai-digests`, auth(adminToken));
    expect(read.statusCode).toBe(200);
    const { items } = read.json() as { items: Array<Record<string, unknown>> };
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      connection: { chat_id: first.chatId, thread_id: first.threadId },
      procedure_name: TOPIC,
      outcome: 'abandoned',
      slots: { method: { display: 'Papara', status: 'filled' } },
    });
    expect(items[0]!['ended_at']).not.toBeNull();

    // The visitor never reads what the AI noted about them.
    const asVisitor = await server.get(`/chats/${first.chatId}/ai-digests`, member.headers);
    expect(asVisitor.statusCode).toBe(404);

    // Back the same day: the abandoned topic is recalled.
    const verified = await mint({ member_token: member.memberToken });
    const noon = await send(verified, AGAIN);
    expect(await botLines(noon.threadId)).toEqual([
      'Bugün daha önce «Papara yatırımı» konusunda yazmıştınız; konuşma yarım kalmıştı.\nTutar nedir?',
    ]);
  });

  it("never reads or serves another workspace's summaries", async () => {
    // Workspace B's chat, with a summary of its own.
    const other = await server.post(
      '/customer/token',
      { organization_id: fx.b.organizationId },
      { origin: `https://${fx.b.trustedDomain}` },
    );
    const visitorB = visitorOf(other.json());
    const inB = await send(visitorB, FIRST);
    await owner.$executeRaw`
      INSERT INTO ai_conversations (id, license_id, chat_id, thread_id, digest)
      VALUES (gen_random_uuid(), ${fx.b.licenseId}, ${inB.chatId}, ${inB.threadId},
              ${JSON.stringify({ procedure_name: TOPIC, slots: COLLECTED })}::jsonb)`;
    await close_(fx.b, inB.chatId);

    const tenant = (t: TenantFixture) => ({
      licenseId: t.licenseId,
      organizationId: t.organizationId,
    });
    expect(
      await withTenant(app, tenant(fx.b), (tx) =>
        loadDailyDigests(tx, inB.chatId, { limit: null }),
      ),
    ).toHaveLength(1);
    expect(
      await withTenant(app, tenant(fx.a), (tx) =>
        loadDailyDigests(tx, inB.chatId, { limit: null }),
      ),
    ).toEqual([]);
    const read = await server.get(`/chats/${inB.chatId}/ai-digests`, auth(adminToken));
    expect(read.statusCode).toBe(404);
  });

  /** Close a chat of another workspace by the system's hand (its sweep). */
  async function close_(t: TenantFixture, chatId: string): Promise<void> {
    const closed = await new ChatService(app, NO_REDIS).deactivateByTimeout(
      { licenseId: t.licenseId, organizationId: t.organizationId },
      chatId,
      new Date(Date.now() + 60_000),
      auditContextFor(t),
    );
    expect(closed).not.toBeNull();
  }

  it('reads nothing of the day with the memory off, and keeps the setting per agent', async () => {
    await procedure();
    const patch = (payload: object) =>
      server.app.inject({
        method: 'PATCH',
        url: server.url(`/ai-agents/${aiAgentId}`),
        payload,
        headers: auth(adminToken),
      });
    const off = await patch({ daily_memory: { enabled: false } });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({
      daily_memory: { enabled: false, recall: 'auto_if_unresolved' },
    });
    const topicOnly = await patch({ daily_memory: { recall: 'on_topic_only' } });
    expect(topicOnly.json()).toMatchObject({
      daily_memory: { enabled: false, recall: 'on_topic_only' },
    });
    expect((await patch({ daily_memory: {} })).statusCode).toBe(400);
    expect((await patch({ daily_memory: { recall: 'always' } })).statusCode).toBe(400);

    const { member } = await morning();
    const verified = await mint({ member_token: member.memberToken });
    const noon = await send(verified, AGAIN);
    expect(await botLines(noon.threadId)).toEqual(['Hangi yöntemle yatırdınız?']);
    expect((await conversation(noon.threadId)).slots).toEqual({});
  });

  it('holds the job column to the identity list (`ai_jobs_identity_trust_check` = IDENTITY_TRUSTS)', async () => {
    const [row] = await owner.$queryRaw<Array<{ def: string }>>`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conname = 'ai_jobs_identity_trust_check'`;
    const listed = [...row!.def.matchAll(/'([a-z_]+)'::text/g)].map((match) => match[1]);
    expect([...listed].sort()).toEqual([...IDENTITY_TRUSTS].sort());
  });
});
