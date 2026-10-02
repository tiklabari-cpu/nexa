/**
 * The Copilot summary written by a model (tm 257.5 · ADR
 * `docs/adr/pilot-public-readiness.md` K-h).
 *
 * `copilot.test.ts` pins the summary on the default `mock` provider — its
 * assertions read the stub's own words and stay as they were. This suite is
 * the other half: the same route over a recording provider standing in for a
 * remote model (`FakeLlmProvider`, id `openai`), and over the real `openai`
 * adapter with an injected `fetch` where the circuit breaker is the point.
 * What it holds:
 *
 *   - the model's text is the summary and the note, and the call carries the
 *     configured output ceiling and deadline;
 *   - the prompt is one user message of JSON, in the requested language, with
 *     internal notes left out, card numbers masked, and a long conversation
 *     fitted under `LLM_MAX_PROMPT_CHARS` by dropping its oldest middle;
 *   - a failed call is a 503 that writes nothing — no note, no assist — and one
 *     log line that carries no conversation;
 *   - Copilot's failures open Copilot's circuit, not the visitors';
 *   - on `mock` the summary is still the stub's, byte for byte.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { summariseConversation, type ConversationTurn } from '@siyahtus/ai-mock';
import { LlmProviderError } from '../../src/services/ai/provider/llm-error.js';
import { promptLength } from '../../src/services/ai/provider/llm-provider.js';
import { LLM_CIRCUIT_FAILURE_THRESHOLD } from '../../src/services/ai/provider/openai-llm-provider.js';
import { LineSink, customerAsks, seedAiWorkspace } from '../helpers/ai-workspace.js';
import { FAKE_LLM_REPLY, FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { fakeOpenAiFetch, openAiProblem } from '../helpers/fake-openai.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Workspace {
  organizationId: string;
  licenseId: bigint;
  ownerId: string;
}

interface Turn {
  author: 'customer' | 'agent';
  text: string;
  /** `agents` is an internal note — never part of what is summarised. */
  recipients?: 'all' | 'agents';
}

interface Transcript {
  total: number;
  from_customer: number;
  from_team: number;
  omitted: number;
  turns: Array<{ role: 'customer' | 'team'; text: string }>;
}

/** A Luhn-valid test card, and what `maskCardNumbers` turns it into. */
const CARD = '4111 1111 1111 1111';
const MASKED = '**** **** **** 1111';

describe('copilot summary written by a model (tm 257.5)', () => {
  let owner: PrismaClient;
  let fx: Fixtures;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const workspaceOf = (tenant: Fixtures['a']): Workspace => ({
    organizationId: tenant.organizationId,
    licenseId: tenant.licenseId,
    ownerId: tenant.ownerAccountId,
  });

  const agentToken = (ws: Workspace) =>
    grantToken(owner, {
      licenseId: ws.licenseId,
      organizationId: ws.organizationId,
      ownerId: ws.ownerId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw', 'reports_read'],
    });

  /** An active chat assigned to the token's owner, holding `turns` in order. */
  async function chatWith(
    server: TestServer,
    ws: Workspace,
    token: string,
    turns: Turn[],
  ): Promise<string> {
    const customer = await owner.customer.create({
      data: { organizationId: ws.organizationId, name: 'Visitor' },
      select: { id: true },
    });
    const started = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: true },
      auth(token),
    );
    expect([200, 201]).toContain(started.statusCode);
    const chatId = (started.json() as { id: string }).id;
    const thread = await owner.thread.findFirstOrThrow({ where: { chatId } });
    // A second apart, so `createdAt` alone fixes the order the route reads.
    const base = Date.now() - turns.length * 1_000;
    await owner.event.createMany({
      data: turns.map((turn, index) => ({
        id: `${thread.id}_${100 + index}`,
        threadId: thread.id,
        chatId,
        licenseId: ws.licenseId,
        type: 'message',
        text: turn.text,
        authorType: turn.author,
        recipients: turn.recipients ?? 'all',
        createdAt: new Date(base + index * 1_000),
      })),
    });
    return chatId;
  }

  const summarise = (server: TestServer, chatId: string, token: string, body?: object) =>
    server.post(`/copilot/chats/${chatId}/summary`, body, auth(token));

  const transcriptOf = (fake: FakeLlmProvider, call = 0): Transcript =>
    JSON.parse(fake.calls[call]!.messages[0]!.content) as Transcript;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  describe('over a recording provider', () => {
    let server: TestServer;
    let fake: FakeLlmProvider;
    let failing: LlmProviderError | null;
    const log = new LineSink();

    beforeAll(async () => {
      fake = new FakeLlmProvider({
        reply: () => {
          if (failing) throw failing;
          return FAKE_LLM_REPLY;
        },
      });
      server = await startTestServer(
        { LOG_LEVEL: 'warn' },
        { llm: fake, logStream: log as unknown as NodeJS.WritableStream },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fake.reset();
      failing = null;
      log.lines.length = 0;
      await clearRateLimits(server.app);
    });

    it('writes the model’s text as the summary and as the internal note (FR-MOD-12.3 · FR-MOD-02.5)', async () => {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const chatId = await chatWith(server, ws, token, [
        { author: 'customer', text: 'My order has not arrived yet.' },
      ]);

      const response = await summarise(server, chatId, token);

      expect(response.statusCode).toBe(201);
      const body = response.json() as { summary: string; note_event_id: string };
      expect(body.summary).toBe(FAKE_LLM_REPLY);
      expect(fake.calls).toHaveLength(1);
      const note = await owner.event.findFirst({ where: { chatId, recipients: 'agents' } });
      expect(note?.id).toBe(body.note_event_id);
      expect(note?.text).toBe(FAKE_LLM_REPLY);
      expect(note?.authorType).toBe('agent');
    });

    it('asks for at most LLM_MAX_OUTPUT_TOKENS within LLM_TIMEOUT_MS', async () => {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const chatId = await chatWith(server, ws, token, [{ author: 'customer', text: 'Hello?' }]);

      await summarise(server, chatId, token);

      expect(fake.calls[0]).toMatchObject({ maxOutputTokens: 400, timeoutMs: 20_000 });
    });

    it('writes in the requested panel language, English by default, with no conversation in the instructions', async () => {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const question = 'Can I change the delivery address on order 7731?';
      const chatId = await chatWith(server, ws, token, [{ author: 'customer', text: question }]);

      expect((await summarise(server, chatId, token)).statusCode).toBe(201);
      expect((await summarise(server, chatId, token, { language: 'tr' })).statusCode).toBe(201);

      const [english, turkish] = fake.calls;
      expect(english!.system.split('\n').at(-1)).toBe('Write the summary in English.');
      expect(turkish!.system.split('\n').at(-1)).toBe('Write the summary in Turkish.');
      for (const call of fake.calls) {
        expect(call.system).not.toContain('7731');
        expect(call.messages[0]!.content).toContain(question);
      }
    });

    it('refuses a language the panel does not have, before any call', async () => {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const chatId = await chatWith(server, ws, token, [{ author: 'customer', text: 'Hi' }]);

      const response = await summarise(server, chatId, token, { language: 'de' });

      expect(response.statusCode).toBe(400);
      expect(fake.calls).toHaveLength(0);
    });

    it('sends the transcript as one user message of JSON, without internal notes', async () => {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const chatId = await chatWith(server, ws, token, [
        { author: 'customer', text: 'The parcel   arrived\n\ndamaged.' },
        { author: 'agent', text: 'Sorry to hear that — sending a replacement.' },
        { author: 'agent', text: 'NOTE-ONLY: check the courier claim', recipients: 'agents' },
        { author: 'customer', text: 'Thanks, when will it ship?' },
      ]);

      await summarise(server, chatId, token);

      const call = fake.calls[0]!;
      expect(call.messages).toHaveLength(1);
      expect(call.messages[0]!.role).toBe('user');
      expect(call.messages[0]!.content).not.toContain('NOTE-ONLY');
      expect(transcriptOf(fake)).toEqual({
        total: 3,
        from_customer: 2,
        from_team: 1,
        omitted: 0,
        turns: [
          { role: 'customer', text: 'The parcel arrived damaged.' },
          { role: 'team', text: 'Sorry to hear that — sending a replacement.' },
          { role: 'customer', text: 'Thanks, when will it ship?' },
        ],
      });
    });

    it('fits a long conversation under the ceiling: the opening, then the newest, the oldest middle left out (FR-MOD-12.3)', async () => {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const turns: Turn[] = [];
      for (let i = 0; i < 40; i += 1) {
        const tag = String(i).padStart(2, '0');
        turns.push({ author: 'customer', text: `[c${tag}] ${'x'.repeat(10_000 - 6)}` });
        turns.push({ author: 'agent', text: `[a${tag}] noted, looking into it` });
      }
      const chatId = await chatWith(server, ws, token, turns);

      const response = await summarise(server, chatId, token);

      expect(response.statusCode).toBe(201);
      expect(fake.calls).toHaveLength(1);
      expect(promptLength(fake.calls[0]!)).toBeLessThanOrEqual(16_000);
      const sent = transcriptOf(fake);
      expect(sent).toMatchObject({ total: 80, from_customer: 40, from_team: 40 });
      expect(sent.omitted).toBe(80 - sent.turns.length);
      expect(sent.omitted).toBeGreaterThan(0);
      // The opening, cut to one message's share.
      expect(sent.turns[0]!.text.startsWith('[c00] ')).toBe(true);
      expect(sent.turns[0]!.text).toHaveLength(1_000);
      expect(sent.turns[0]!.text.endsWith('…')).toBe(true);
      // Then an unbroken run ending at the newest message, in order — more than
      // the newest alone: at 16 000 characters a dozen 1 000-character turns fit.
      expect(sent.turns.length).toBeGreaterThan(10);
      const tags = sent.turns.slice(1).map((turn) => turn.text.slice(0, 5));
      const tail = turns.slice(-tags.length).map((turn) => turn.text.slice(0, 5));
      expect(tags).toEqual(tail);
      expect(tags.at(-1)).toBe('[a39]');
    });

    it('masks a card number in what is sent and in what is written', async () => {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const chatId = await chatWith(server, ws, token, [
        { author: 'customer', text: `I was charged twice on ${CARD}, please refund one.` },
      ]);
      // A model that quotes the card number back.
      const echoing = new FakeLlmProvider({ reply: `Double charge on ${CARD}; refund one.` });
      const echoServer = await startTestServer({}, { llm: echoing });
      try {
        const response = await summarise(echoServer, chatId, token);

        expect(response.statusCode).toBe(201);
        const content = echoing.calls[0]!.messages[0]!.content;
        expect(content).not.toContain(CARD);
        expect(content).toContain(MASKED);
        const body = response.json() as { summary: string };
        expect(body.summary).toBe(`Double charge on ${MASKED}; refund one.`);
        const note = await owner.event.findFirst({ where: { chatId, recipients: 'agents' } });
        expect(note?.text).toBe(body.summary);
        const run = await owner.skillRun.findFirst({ where: { chatId } });
        expect(JSON.stringify(run?.log)).not.toContain(CARD);
      } finally {
        await echoServer.close();
      }
    });

    it('records the call’s tokens on the Copilot assist run', async () => {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const chatId = await chatWith(server, ws, token, [{ author: 'customer', text: 'Hi' }]);

      await summarise(server, chatId, token);

      const run = await owner.skillRun.findFirst({
        where: { chatId },
        include: { skill: { select: { kind: true } } },
      });
      expect(run).toMatchObject({
        llmInputTokens: 100,
        llmOutputTokens: 10,
        skill: { kind: 'workspace' },
      });
    });

    for (const failure of [
      new LlmProviderError('timeout'),
      new LlmProviderError('no_answer', { reason: 'length' }),
    ]) {
      it(`answers 503 (${failure.kind}) and writes nothing — no note, no assist`, async () => {
        const ws = workspaceOf(fx.a);
        const token = await agentToken(ws);
        const secret = 'Q-91877 is my order';
        const chatId = await chatWith(server, ws, token, [
          { author: 'customer', text: secret },
          { author: 'agent', text: 'Checking now.' },
        ]);
        const before = await owner.event.count({ where: { chatId } });
        failing = failure;

        const response = await summarise(server, chatId, token);

        expect(response.statusCode).toBe(503);
        const error = (response.json() as { error: { type: string; details: { kind: string } } })
          .error;
        expect(error.type).toBe('service_unavailable');
        expect(error.details.kind).toBe(failure.kind);
        expect(await owner.event.count({ where: { chatId } })).toBe(before);
        expect(await owner.skillRun.count({ where: { chatId } })).toBe(0);

        // Not "assisted" either: the chat closes as the human's.
        await server.post(`/chats/${chatId}/deactivate`, undefined, auth(token));
        const totals = (await server.get('/reports/overview', auth(token))).json().totals as {
          assisted: number;
          manual: number;
        };
        expect(totals).toMatchObject({ assisted: 0, manual: 1 });

        const lines = log.events('copilot.summary.failed');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
          level: 40,
          chat_id: chatId,
          provider: 'openai',
          kind: failure.kind,
          transient: failure.transient,
        });
        const written = log.lines.filter((line) => line.includes('copilot.summary.failed'));
        expect(written.join('\n')).not.toContain('Q-91877');
        expect(written.join('\n')).not.toContain('Write the summary');
      });
    }
  });

  it('keeps a covered workspace’s summary away from an out-of-region model (NFR-C4)', async () => {
    const fake = new FakeLlmProvider();
    // A US deployment whose model answers from the EU, and a US workspace that
    // signed a BAA: the one combination C4-e refuses.
    const server = await startTestServer(
      { SIYAHTUS_REGION: 'us', LLM_PROVIDER_REGION: 'eu' },
      { llm: fake },
    );
    try {
      const slug = `cov-sum-${Date.now()}`;
      const organization = await owner.organization.create({
        data: { name: `Org ${slug}`, region: 'us' },
        select: { id: true },
      });
      const license = await owner.license.create({
        data: {
          organizationId: organization.id,
          plan: 'growth',
          status: 'active',
          hipaaBaaSignedAt: new Date(),
        },
        select: { id: true },
      });
      const account = await owner.account.create({
        data: { email: `owner-${slug}@example.test`, name: `Owner ${slug}` },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: license.id, agentId: account.id, role: 'owner' },
      });
      const ws = { organizationId: organization.id, licenseId: license.id, ownerId: account.id };
      const token = await agentToken(ws);
      const chatId = await chatWith(server, ws, token, [{ author: 'customer', text: 'Hi' }]);

      const response = await summarise(server, chatId, token);

      expect(response.statusCode).toBe(403);
      expect((response.json() as { error: { details: unknown } }).error.details).toEqual({
        region: 'us',
        provider_region: 'eu',
      });
      expect(fake.calls).toHaveLength(0);
      expect(await owner.event.count({ where: { chatId, recipients: 'agents' } })).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('applies the configured ceilings: output tokens, and a 2 000-character prompt holding the opening and the newest message', async () => {
    const fake = new FakeLlmProvider();
    const server = await startTestServer(
      { LLM_MAX_OUTPUT_TOKENS: '123', LLM_MAX_PROMPT_CHARS: '2000' },
      { llm: fake },
    );
    try {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const turns: Turn[] = [];
      for (let i = 0; i < 40; i += 1) {
        const tag = String(i).padStart(2, '0');
        turns.push({ author: 'customer', text: `[c${tag}] ${'"'.repeat(10_000 - 6)}` });
        turns.push({ author: 'agent', text: `[a${tag}] ${'y'.repeat(10_000 - 6)}` });
      }
      const chatId = await chatWith(server, ws, token, turns);

      const response = await summarise(server, chatId, token);

      // Fitted, not refused: no `prompt_too_long`, and the call is made.
      expect(response.statusCode).toBe(201);
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0]!.maxOutputTokens).toBe(123);
      expect(promptLength(fake.calls[0]!)).toBeLessThanOrEqual(2_000);
      const sent = transcriptOf(fake);
      expect(sent.omitted).toBe(78);
      expect(sent.turns.map((turn) => turn.text.slice(0, 5))).toEqual(['[c00]', '[a39]']);
      for (const turn of sent.turns) expect(turn.text.endsWith('…')).toBe(true);
    } finally {
      await server.close();
    }
  });

  it('keeps the stub’s summary byte for byte on LLM_PROVIDER=mock (FR-MOD-12.3 · FR-MOD-02.5)', async () => {
    const server = await startTestServer();
    try {
      const ws = workspaceOf(fx.a);
      const token = await agentToken(ws);
      const turns: Turn[] = [
        { author: 'customer', text: 'My order   has not arrived yet.' },
        { author: 'agent', text: 'Let me check the courier.' },
        { author: 'agent', text: 'internal: courier lost it', recipients: 'agents' },
        { author: 'customer', text: 'It has been two weeks now.' },
      ];
      const chatId = await chatWith(server, ws, token, turns);

      const response = await summarise(server, chatId, token, { language: 'tr' });

      expect(response.statusCode).toBe(201);
      const expected = summariseConversation(
        turns
          .filter((turn) => turn.recipients !== 'agents')
          .map((turn): ConversationTurn => ({ role: turn.author, text: turn.text })),
      );
      const body = response.json() as { summary: string; note_event_id: string };
      expect(body.summary).toBe(expected);
      const note = await owner.event.findFirst({ where: { chatId, id: body.note_event_id } });
      expect(note?.text).toBe(expected);
      const run = await owner.skillRun.findFirst({ where: { chatId } });
      expect(run).toMatchObject({ llmInputTokens: 0, llmOutputTokens: 0 });
    } finally {
      await server.close();
    }
  });

  it('opens Copilot’s own circuit after repeated failures, and leaves the visitors’ closed', async () => {
    const net = fakeOpenAiFetch(openAiProblem(401, 'invalid_api_key'));
    const log = new LineSink();
    const server = await startTestServer(
      {
        LOG_LEVEL: 'debug',
        LLM_PROVIDER: 'openai',
        LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
        LLM_MODEL: 'test-model',
        LLM_API_KEY: 'sk-test-only-llm-label',
      },
      { llmFetch: net.impl, logStream: log as unknown as NodeJS.WritableStream },
    );
    try {
      await clearRateLimits(server.app);
      const ws = await seedAiWorkspace(owner);
      const token = await agentToken({
        organizationId: ws.organizationId,
        licenseId: ws.licenseId,
        ownerId: ws.ownerId,
      });
      const chatId = await chatWith(
        server,
        { organizationId: ws.organizationId, licenseId: ws.licenseId, ownerId: ws.ownerId },
        token,
        [{ author: 'customer', text: 'Where is my parcel?' }],
      );

      for (let i = 0; i < LLM_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
        const failed = await summarise(server, chatId, token);
        expect(failed.statusCode).toBe(503);
        expect((failed.json() as { error: { details: { kind: string } } }).error.details.kind).toBe(
          'auth',
        );
      }
      expect(net.calls).toHaveLength(LLM_CIRCUIT_FAILURE_THRESHOLD);
      const opened = log.events('llm.circuit_opened');
      expect(opened).toHaveLength(1);
      expect(opened[0]).toMatchObject({ component: 'llm', surface: 'copilot' });

      const refused = await summarise(server, chatId, token);
      expect(refused.statusCode).toBe(503);
      expect((refused.json() as { error: { details: { kind: string } } }).error.details.kind).toBe(
        'circuit_open',
      );
      expect(net.calls).toHaveLength(LLM_CIRCUIT_FAILURE_THRESHOLD);

      // A visitor's question still reaches the provider: their circuit is closed.
      await customerAsks(owner, server, ws);
      expect(net.calls).toHaveLength(LLM_CIRCUIT_FAILURE_THRESHOLD + 1);
    } finally {
      await server.close();
    }
  });
});
