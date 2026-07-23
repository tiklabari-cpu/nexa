/**
 * The skill engine, running on real customer messages.
 *
 * Two properties carry the weight. First, the AI must answer as a *bot*: ADR-09
 * counts a thread that closes with no agent-authored event as an AI resolution,
 * and Reports only starts its first-response clock on a human — writing the
 * AI's reply as an agent would break the invoice and the response times at
 * once. Second, a broken or failing skill must never cost the customer their
 * message; the worst acceptable outcome is the conversation a human would have
 * got anyway.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed, toVectorLiteral } from '@nexa/ai-mock';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('ai skills', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let supportGroupId: bigint;
  let aiAgentId: string;

  const customerAuth = async (): Promise<Record<string, string>> => {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const { token } = response.json() as { token: string };
    return { authorization: `Bearer ${token}` };
  };

  async function createSkill(steps: unknown[], options: { active?: boolean } = {}) {
    return owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Order status',
        kind: 'ai_agent',
        steps: steps as object,
        active: options.active ?? true,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
  }

  async function events(chatId: string) {
    return owner.event.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorType: true, recipients: true },
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

    const support = await owner.group.create({
      data: { licenseId: fx.a.licenseId, name: 'Support' },
      select: { id: true },
    });
    supportGroupId = support.id;

    await owner.routingRule.create({
      data: {
        licenseId: fx.a.licenseId,
        kind: 'chat',
        isFallback: true,
        targetGroupId: support.id,
        priority: 100,
      },
    });

    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
  });

  // --- Answering ------------------------------------------------------------

  it('answers from the knowledge base and records the reply as a bot', async () => {
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId,
        licenseId: fx.a.licenseId,
        type: 'article',
        name: 'Delivery',
        status: 'ready',
        updatedAt: new Date(),
      },
      select: { id: true },
    });

    const answer = 'Standard delivery takes 3 to 5 working days across the EU.';
    for (const text of [answer, 'Refunds are issued to the original payment method.']) {
      await owner.$executeRawUnsafe(
        `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
         VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
        source.id,
        fx.a.licenseId.toString(),
        text,
        toVectorLiteral(embed(text)),
      );
    }

    await createSkill([
      { type: 'detect_intent', intent: 'delivery', phrases: ['delivery times', 'delivery'] },
      { type: 'send_message', source: 'knowledge' },
    ]);

    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text: 'How long does delivery take?' },
      headers,
    );
    expect(response.statusCode).toBe(201);
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const written = await events(chatId);
    const botReply = written.find((e) => e.authorType === 'bot');

    // Retrieved the delivery chunk, not the refunds one — the whole point of
    // deriving embeddings from text.
    expect(botReply?.text).toBe(answer);
    // Not 'agent': the invoice and the response-time report both read this.
    expect(written.some((e) => e.authorType === 'agent')).toBe(false);
  });

  it('does not start the human first-response clock', async () => {
    // Reports would otherwise credit a human with a reply they never wrote.
    await createSkill([{ type: 'send_message', source: 'text', text: 'One moment.' }]);

    const headers = await customerAuth();
    const response = await server.post('/customer/chat/events', { text: 'Hello?' }, headers);
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const thread = await owner.thread.findFirst({ where: { chatId } });
    expect(thread?.firstResponseAt).toBeNull();
  });

  it('leaves the conversation for a human when nothing in the knowledge base is close', async () => {
    // Answering from an unrelated article is worse than admitting there is no
    // answer.
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId,
        licenseId: fx.a.licenseId,
        type: 'article',
        name: 'Returns',
        status: 'ready',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    const text = 'Returns are accepted within 30 days if unused.';
    await owner.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
      source.id,
      fx.a.licenseId.toString(),
      text,
      toVectorLiteral(embed(text)),
    );

    await createSkill([{ type: 'send_message', source: 'knowledge' }]);

    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text: 'Do you sell titanium bicycle frames wholesale?' },
      headers,
    );
    const { chat_id: chatId } = response.json() as { chat_id: string };

    expect((await events(chatId)).some((e) => e.authorType === 'bot')).toBe(false);
  });

  // --- Intent gating --------------------------------------------------------

  it('does not fire on a message the intent does not match', async () => {
    await createSkill([
      { type: 'detect_intent', intent: 'refunds', phrases: ['refund policy'] },
      { type: 'send_message', source: 'text', text: 'We refund within 14 days.' },
    ]);

    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text: 'What are your opening hours?' },
      headers,
    );
    const { chat_id: chatId } = response.json() as { chat_id: string };

    expect((await events(chatId)).some((e) => e.authorType === 'bot')).toBe(false);
  });

  it('ignores an inactive skill and an inactive AI agent', async () => {
    await createSkill([{ type: 'send_message', source: 'text', text: 'Should not send.' }], {
      active: false,
    });

    const headers = await customerAuth();
    const first = await server.post('/customer/chat/events', { text: 'Hello' }, headers);
    const firstChat = (first.json() as { chat_id: string }).chat_id;
    expect((await events(firstChat)).some((e) => e.authorType === 'bot')).toBe(false);

    // Now an active skill under a deactivated agent — turning the agent off is
    // how an admin stops all of its skills at once.
    await owner.aiAgent.update({ where: { id: aiAgentId }, data: { active: false } });
    await createSkill([{ type: 'send_message', source: 'text', text: 'Should not send either.' }]);

    await server.post('/customer/chat/close', undefined, headers);
    const second = await server.post('/customer/chat/events', { text: 'Hello again' }, headers);
    const secondChat = (second.json() as { chat_id: string }).chat_id;
    expect((await events(secondChat)).some((e) => e.authorType === 'bot')).toBe(false);
  });

  // --- Steps ----------------------------------------------------------------

  it('applies tags and writes a summary', async () => {
    await createSkill([
      { type: 'tag', tag: 'shipping' },
      { type: 'summarize' },
      { type: 'send_message', source: 'text', text: 'Looking into it.' },
    ]);

    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text: 'Where is my parcel?' },
      headers,
    );
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const thread = await owner.thread.findFirst({
      where: { chatId },
      include: { tags: { include: { tag: true } } },
    });
    expect(thread?.tags.map((t) => t.tag.name)).toContain('shipping');
    expect(thread?.summary).toContain('Where is my parcel?');
  });

  it('does not ask for something the customer already gave', async () => {
    // Asking for an order number they just typed is the single most irritating
    // thing an automated agent does.
    await createSkill([
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
    ]);

    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text: 'My order AB12345 has not arrived' },
      headers,
    );
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const bot = (await events(chatId)).filter((e) => e.authorType === 'bot');
    expect(bot).toHaveLength(0);
  });

  it('asks when the information really is missing', async () => {
    await createSkill([
      { type: 'request_info', field: 'order_number', prompt: 'What is your order number?' },
    ]);

    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text: 'My parcel has not arrived' },
      headers,
    );
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const bot = (await events(chatId)).filter((e) => e.authorType === 'bot');
    expect(bot[0]?.text).toBe('What is your order number?');
  });

  it('hands off to a team and stops running steps after that', async () => {
    await createSkill([
      { type: 'transfer_to_team', group: 'Support' },
      { type: 'send_message', source: 'text', text: 'This must not be sent.' },
    ]);

    const headers = await customerAuth();
    const response = await server.post('/customer/chat/events', { text: 'I need help' }, headers);
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const access = await owner.chatAccess.findMany({ where: { chatId } });
    expect(access.map((a) => a.groupId)).toContain(supportGroupId);

    // Everything after the handover would act on a conversation the AI no
    // longer owns.
    const texts = (await events(chatId)).map((e) => e.text);
    expect(texts).not.toContain('This must not be sent.');
  });

  it('leaves the conversation alone when the skill names a team that is gone', async () => {
    await createSkill([{ type: 'transfer_to_team', group: 'Deleted Team' }]);

    const headers = await customerAuth();
    const response = await server.post('/customer/chat/events', { text: 'I need help' }, headers);

    // The message still landed; a human still sees it.
    expect(response.statusCode).toBe(201);
    const { chat_id: chatId } = response.json() as { chat_id: string };
    expect((await events(chatId)).some((e) => e.authorType === 'customer')).toBe(true);
  });

  // --- Failure containment --------------------------------------------------

  it('never costs the customer their message when a skill is malformed', async () => {
    // An admin saving a broken step list must not take the inbox down.
    await createSkill([{ type: 'send_message' }, { type: 'not_a_real_step' }]);

    const headers = await customerAuth();
    const response = await server.post('/customer/chat/events', { text: 'Hello there' }, headers);

    expect(response.statusCode).toBe(201);
    const { chat_id: chatId } = response.json() as { chat_id: string };
    const written = await events(chatId);
    expect(written.some((e) => e.text === 'Hello there')).toBe(true);
  });

  it('runs one skill per message, not every matching skill', async () => {
    // Two skills replying to one question leaves an admin with no way to see
    // which fired first.
    await createSkill([{ type: 'send_message', source: 'text', text: 'First skill.' }]);
    await createSkill([{ type: 'send_message', source: 'text', text: 'Second skill.' }]);

    const headers = await customerAuth();
    const response = await server.post('/customer/chat/events', { text: 'Hello' }, headers);
    const { chat_id: chatId } = response.json() as { chat_id: string };

    expect((await events(chatId)).filter((e) => e.authorType === 'bot')).toHaveLength(1);
  });

  it('does not answer twice for an idempotent replay', async () => {
    await createSkill([{ type: 'send_message', source: 'text', text: 'On it.' }]);

    const headers = await customerAuth();
    const body = { text: 'Hello', idempotency_key: 'replay-key-1' };

    const first = await server.post('/customer/chat/events', body, headers);
    const replayed = await server.post('/customer/chat/events', body, headers);
    expect(replayed.statusCode).toBe(200);

    const { chat_id: chatId } = first.json() as { chat_id: string };
    expect((await events(chatId)).filter((e) => e.authorType === 'bot')).toHaveLength(1);
  });

  // --- Tenant isolation -----------------------------------------------------

  it("never runs another tenant's skill", async () => {
    const otherAgent = await owner.aiAgent.create({
      data: { licenseId: fx.b.licenseId, name: 'Theirs', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    await owner.skill.create({
      data: {
        licenseId: fx.b.licenseId,
        aiAgentId: otherAgent.id,
        name: 'Other tenant skill',
        kind: 'ai_agent',
        steps: [{ type: 'send_message', source: 'text', text: 'Leaked across tenants.' }] as object,
        active: true,
        updatedAt: new Date(),
      },
    });

    const headers = await customerAuth();
    const response = await server.post('/customer/chat/events', { text: 'Hello' }, headers);
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const texts = (await events(chatId)).map((e) => e.text);
    expect(texts).not.toContain('Leaked across tenants.');
  });

  it("never retrieves another tenant's knowledge", async () => {
    const otherAgent = await owner.aiAgent.create({
      data: { licenseId: fx.b.licenseId, name: 'Theirs', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    const otherSource = await owner.knowledgeSource.create({
      data: {
        aiAgentId: otherAgent.id,
        licenseId: fx.b.licenseId,
        type: 'article',
        name: 'Their secrets',
        status: 'ready',
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    const secret = 'Our confidential wholesale price is 40 percent off list.';
    await owner.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
      otherSource.id,
      fx.b.licenseId.toString(),
      secret,
      toVectorLiteral(embed(secret)),
    );

    await createSkill([{ type: 'send_message', source: 'knowledge' }]);

    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text: 'What is your confidential wholesale price?' },
      headers,
    );
    const { chat_id: chatId } = response.json() as { chat_id: string };

    const texts = (await events(chatId)).map((e) => e.text);
    expect(texts).not.toContain(secret);
  });

  // --- The billing loop -----------------------------------------------------

  it('counts a conversation the AI handled alone as an AI resolution', async () => {
    // The reason the bot/agent distinction matters, end to end.
    //
    // This is also the regression guard for a real defect: `start` used to
    // record the *customer's* opening message as agent-authored, so every
    // thread had an agent event from its first line and ADR-09 could never
    // count one. Reports showed 0% automated and nothing was ever billed.
    await createSkill([{ type: 'send_message', source: 'text', text: 'Here is your answer.' }]);

    const headers = await customerAuth();
    const response = await server.post(
      '/customer/chat/events',
      { text: 'What are your opening hours?' },
      headers,
    );
    const { chat_id: chatId } = response.json() as { chat_id: string };

    // The visitor closes the conversation; no human ever touched it.
    await server.post('/customer/chat/close', undefined, headers);

    const usage = await owner.usageRecord.findFirst({
      where: { licenseId: fx.a.licenseId, metric: 'ai_resolutions' },
    });
    expect(Number(usage?.quantity ?? 0)).toBe(1);

    // And the same predicate drives the Reports figure (ADR-09: one definition).
    const reportToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['reports_read'],
    });
    const report = await server.get('/reports/overview', {
      authorization: `Bearer ${reportToken}`,
    });
    expect((report.json() as { totals: { automated: number } }).totals.automated).toBe(1);
    expect(chatId).toBeTruthy();
  });

  it('does not count a conversation a human replied to', async () => {
    await createSkill([{ type: 'send_message', source: 'text', text: 'One moment.' }]);

    const headers = await customerAuth();
    const started = await server.post('/customer/chat/events', { text: 'Hello' }, headers);
    const { chat_id: chatId } = started.json() as { chat_id: string };

    const agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw'],
    });
    await server.post(
      `/chats/${chatId}/events`,
      { type: 'message', text: 'A human here.' },
      { authorization: `Bearer ${agentToken}` },
    );

    await server.post('/customer/chat/close', undefined, headers);

    const usage = await owner.usageRecord.findFirst({
      where: { licenseId: fx.a.licenseId, metric: 'ai_resolutions' },
    });
    // A human did the work; billing the customer for automation would be wrong.
    expect(Number(usage?.quantity ?? 0)).toBe(0);
  });

  // --- Run log --------------------------------------------------------------

  it('records a run with its log and increments the count', async () => {
    const skill = await createSkill([
      { type: 'tag', tag: 'shipping' },
      { type: 'send_message', source: 'text', text: 'On it.' },
    ]);

    const headers = await customerAuth();
    await server.post('/customer/chat/events', { text: 'Where is my parcel?' }, headers);

    const run = await owner.skillRun.findFirst({ where: { skillId: skill.id } });
    // `status` is whether the run completed; what it did to the conversation is
    // a separate fact and lives in the log.
    expect(run?.status).toBe('succeeded');
    expect((run?.log as { outcome: string }).outcome).toBe('answered');
    const entries = (run?.log as { entries: Array<{ step: string; detail: string }> }).entries;
    expect(entries.map((e) => e.step)).toContain('tag');
    expect(entries.find((e) => e.step === 'tag')?.detail).toContain('shipping');

    const after = await owner.skill.findUnique({ where: { id: skill.id } });
    expect(after?.runsCount).toBe(1);
  });
});
