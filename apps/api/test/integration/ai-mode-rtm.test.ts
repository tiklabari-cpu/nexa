/**
 * The inbox hears who answers a connection (tm 293.5 · SiyahTuş analysis
 * AI-11): every change of AI mode is pushed to the chat's agents as
 * `chat_ai_mode_changed`, and the chat itself carries the mode
 * (`Thread.ai_mode`) and, on an agent's read, whether the AI ever answered in
 * it (`ai_took_part`) — the two things the inbox's badge is drawn from.
 *
 * Real visitor messages through the real server and the AI job worker, with a
 * listener on the workspace's bus channel: what is pinned is what the gateway
 * would forward, to whom.
 */
import type { PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import { embed, toVectorLiteral } from '@siyahtus/ai-mock';
import { AI_BOT_ID, licenseChannel } from '@siyahtus/types';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PASSAGE = 'Standard delivery takes 3 to 5 working days across the EU.';
const MODEL_ANSWER = 'Delivery takes three to five working days.';
/** Matches the knowledge skill below: every one of these asks the model. */
const QUESTION = 'How long does delivery take?';

interface Envelope {
  action: string;
  audience: { groupIds?: number[]; agentIds?: string[]; customerId?: string; allAgents?: boolean };
  payload: Record<string, unknown>;
}

describe('the inbox hears who answers a connection (AI-11)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let aiAgentId: string;
  let agentToken: string;
  let adminToken: string;
  let listener: Redis;
  let pushes: Envelope[];
  const model = new FakeLlmProvider({ reply: MODEL_ANSWER });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const customerAuth = async (): Promise<Record<string, string>> => {
    const response = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const { token } = response.json() as { token: string };
    return { authorization: `Bearer ${token}` };
  };

  async function send(headers: Record<string, string>, text: string) {
    const response = await server.post('/customer/chat/events', { text }, headers);
    expect(response.statusCode).toBe(201);
    const sent = response.json() as { chat_id: string; event: { thread_id: string } };
    return { chatId: sent.chat_id, threadId: sent.event.thread_id };
  }

  async function agentWrites(chatId: string, token = agentToken): Promise<void> {
    const response = await server.post(
      `/chats/${chatId}/events`,
      { type: 'message', recipients: 'all', text: 'Let me check that for you.' },
      auth(token),
    );
    expect(response.statusCode).toBe(201);
  }

  async function readThread(chatId: string, token = agentToken) {
    const response = await server.app.inject({
      method: 'GET',
      url: server.url(`/chats/${chatId}`),
      headers: auth(token),
    });
    expect(response.statusCode).toBe(200);
    return (response.json() as { thread: Record<string, unknown> }).thread;
  }

  /** The mode pushes so far, after the bus has had a moment to deliver them. */
  async function modePushes(): Promise<Envelope[]> {
    await new Promise((resolve) => setTimeout(resolve, 150));
    return pushes.filter((p) => p.action === 'chat_ai_mode_changed');
  }

  async function seedKnowledgeSkill(): Promise<void> {
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
    await owner.$executeRawUnsafe(
      `INSERT INTO knowledge_chunks (id, source_id, license_id, chunk_text, embedding, token_count, position)
       VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, 10, 0)`,
      source.id,
      fx.a.licenseId.toString(),
      PASSAGE,
      toVectorLiteral(embed(PASSAGE)),
    );
    await owner.skill.create({
      data: {
        licenseId: fx.a.licenseId,
        aiAgentId,
        name: 'Delivery',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
          { type: 'send_message', source: 'knowledge' },
        ] as object,
        active: true,
        updatedAt: new Date(),
      },
    });
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { llm: model });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    model.reset();
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, name: 'Ada', kind: 'ai_agent', active: true },
      select: { id: true },
    });
    aiAgentId = agent.id;
    // A team for routing to seat the visitor's chat in: its agents are who hears.
    await owner.group.create({ data: { licenseId: fx.a.licenseId, name: 'Logistics' } });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['chats--all:rw'],
    });
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
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

  it('pushes the AI’s first turn to the chat’s agents, and nothing for a turn it did not take (AI-11)', async () => {
    await seedKnowledgeSkill();
    const headers = await customerAuth();

    // No skill matched: no turn, no change.
    const first = await send(headers, 'Hello there');
    expect(await modePushes()).toEqual([]);
    expect(await readThread(first.chatId)).toMatchObject({ ai_mode: null, ai_took_part: false });

    await send(headers, QUESTION);
    const sent = await modePushes();
    expect(sent.map((p) => p.payload)).toEqual([
      {
        chat_id: first.chatId,
        thread_id: first.threadId,
        ai_mode: 'ai',
        previous_ai_mode: null,
        by: AI_BOT_ID,
        reason: null,
      },
    ]);
    // Agents only: the visitor is never told.
    expect(sent[0]!.audience.customerId).toBeUndefined();
    expect(sent[0]!.audience.allAgents).toBeUndefined();
    expect(sent[0]!.audience.groupIds?.length).toBeGreaterThan(0);
    expect(await readThread(first.chatId)).toMatchObject({ ai_mode: 'ai', ai_took_part: true });
  });

  it('pushes each change a person makes: written over, given back, held back, taken over (AI-11)', async () => {
    await seedKnowledgeSkill();
    const headers = await customerAuth();
    const { chatId, threadId } = await send(headers, QUESTION);
    await modePushes();
    pushes = [];

    await agentWrites(chatId);
    expect(await readThread(chatId)).toMatchObject({ ai_mode: 'human', ai_took_part: true });

    expect(
      (await server.post(`/chats/${chatId}/return-to-ai`, { resume: 'continue' }, auth(adminToken)))
        .statusCode,
    ).toBe(200);
    expect((await server.post(`/chats/${chatId}/pause-ai`, {}, auth(adminToken))).statusCode).toBe(
      200,
    );
    expect(await readThread(chatId)).toMatchObject({ ai_mode: 'paused' });

    expect((await server.post(`/chats/${chatId}/takeover`, {}, auth(adminToken))).statusCode).toBe(
      200,
    );

    const sent = await modePushes();
    expect(sent.map((p) => p.payload)).toEqual([
      {
        chat_id: chatId,
        thread_id: threadId,
        ai_mode: 'human',
        previous_ai_mode: 'ai',
        by: fx.a.agentAccountId,
        reason: 'agent_message',
      },
      {
        chat_id: chatId,
        thread_id: threadId,
        ai_mode: 'ai',
        previous_ai_mode: 'human',
        by: fx.a.ownerAccountId,
        reason: 'return_to_ai',
      },
      {
        chat_id: chatId,
        thread_id: threadId,
        ai_mode: 'paused',
        previous_ai_mode: 'ai',
        by: fx.a.ownerAccountId,
        reason: 'pause',
      },
      {
        chat_id: chatId,
        thread_id: threadId,
        ai_mode: 'human',
        previous_ai_mode: 'paused',
        by: fx.a.ownerAccountId,
        reason: 'takeover',
      },
    ]);
    for (const push of sent) expect(push.audience.customerId).toBeUndefined();
    // Each beside the agents-only line that says the same, to the same agents.
    const lines = pushes.filter(
      (p) =>
        p.action === 'incoming_event' &&
        (p.payload['event'] as { properties?: Record<string, unknown> }).properties?.[
          'system_event'
        ] === 'ai_mode_changed',
    );
    expect(lines).toHaveLength(4);
    expect(lines.map((p) => p.audience)).toEqual(sent.map((p) => p.audience));
  });

  it('pushes nothing for a connection a person answered before the AI ever spoke, and says so on the read', async () => {
    // No skill: the AI never answers.
    const headers = await customerAuth();
    const { chatId } = await send(headers, 'Hello');

    await agentWrites(chatId);

    expect(await modePushes()).toEqual([]);
    expect(await readThread(chatId)).toMatchObject({ ai_mode: 'human', ai_took_part: false });
  });
});
