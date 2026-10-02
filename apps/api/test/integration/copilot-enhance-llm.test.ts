/**
 * The Copilot draft rewrite written by a model (tm 257.6 · ADR
 * `docs/adr/pilot-public-readiness.md` K-h).
 *
 * `copilot.test.ts` pins the rewrite on the default `mock` provider and stays
 * as it was. This suite is the other half, the way `copilot-summary-llm.test.ts`
 * is for the summary: the same route over a recording provider standing in for a
 * remote model (`FakeLlmProvider`, id `openai`). What it holds:
 *
 *   - the model's text is the answer; the call is one user message holding the
 *     draft, under the instructions of the mode asked for and of no other, with
 *     the call's own output budget and the configured deadline;
 *   - a failed call is a 503 that records nothing, with one log line that
 *     carries no draft; any other failure is a defect (500);
 *   - a reply too long to send is refused, never offered;
 *   - the public pilot stops a draft over 2 000 characters before any call, and
 *     an ordinary deployment takes 10 000;
 *   - a covered workspace never reaches an out-of-region model;
 *   - on `mock` the rewrite is still the stub's, byte for byte.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENHANCE_MODES, enhanceText } from '@siyahtus/ai-mock';
import {
  ENHANCE_INSTRUCTIONS,
  ENHANCE_TEXT_MAX_CHARS,
} from '../../src/services/ai/copilot-enhance.js';
import { LlmProviderError } from '../../src/services/ai/provider/llm-error.js';
import { LineSink } from '../helpers/ai-workspace.js';
import { FAKE_LLM_REPLY, FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Workspace {
  organizationId: string;
  licenseId: bigint;
  ownerId: string;
}

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}

/** A Luhn-valid test card, and what `maskCardNumbers` turns it into. */
const CARD = '4111 1111 1111 1111';
const MASKED = '**** **** **** 1111';

const DRAFT = "hi, we can't ship it before friday but i'll check";

describe('copilot rewrite written by a model (tm 257.6)', () => {
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
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });

  /** An active chat assigned to the token's owner. */
  async function chatFor(server: TestServer, ws: Workspace, token: string): Promise<string> {
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
    return (started.json() as { id: string }).id;
  }

  const enhance = (server: TestServer, chatId: string, token: string, body: object) =>
    server.post(`/copilot/chats/${chatId}/enhance`, body, auth(token));

  /** What a fresh workspace's chat and token are, on `server`. */
  async function setUp(server: TestServer) {
    const ws = workspaceOf(fx.a);
    const token = await agentToken(ws);
    return { ws, token, chatId: await chatFor(server, ws, token) };
  }

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
    let reply: () => string;
    let failing: Error | null;
    const log = new LineSink();

    beforeAll(async () => {
      fake = new FakeLlmProvider({
        reply: () => {
          if (failing) throw failing;
          return reply();
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
      reply = () => FAKE_LLM_REPLY;
      log.lines.length = 0;
      await clearRateLimits(server.app);
    });

    for (const mode of ENHANCE_MODES) {
      it(`writes the model’s text for ${mode} with that mode’s instructions only (FR-MOD-12.3)`, async () => {
        const { token, chatId } = await setUp(server);

        const response = await enhance(server, chatId, token, { text: DRAFT, mode });

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ text: FAKE_LLM_REPLY, mode });
        expect(fake.calls).toHaveLength(1);
        const call = fake.calls[0]!;
        expect(call.messages).toEqual([{ role: 'user', content: DRAFT }]);
        expect(call.system).toContain(ENHANCE_INSTRUCTIONS[mode]);
        for (const other of ENHANCE_MODES.filter((m) => m !== mode)) {
          expect(call.system).not.toContain(ENHANCE_INSTRUCTIONS[other]);
        }
        // The rules every mode shares.
        expect(call.system).toContain('do not translate it');
        expect(call.system).toContain('do not add any new one');
        expect(call.system).not.toContain('friday');
        expect(call).toMatchObject({ maxOutputTokens: 400, timeoutMs: 20_000 });

        const runs = await owner.skillRun.findMany({
          where: { chatId },
          include: { skill: { select: { kind: true } } },
        });
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({
          llmInputTokens: 100,
          llmOutputTokens: 10,
          skill: { kind: 'workspace' },
        });
        expect(runs[0]!.log).toMatchObject({
          outcome: 'copilot_enhance',
          entries: [{ step: 'enhance', detail: mode }],
        });
      });
    }

    it('defaults to rephrase, as the stub does', async () => {
      const { token, chatId } = await setUp(server);

      const response = await enhance(server, chatId, token, { text: DRAFT });

      expect(response.json()).toEqual({ text: FAKE_LLM_REPLY, mode: 'rephrase' });
      expect(fake.calls[0]!.system).toContain(ENHANCE_INSTRUCTIONS.rephrase);
    });

    it('gives a long draft its own output budget, not the chat answer’s (FR-MOD-12.3)', async () => {
      const { token, chatId } = await setUp(server);

      await enhance(server, chatId, token, { text: 'a'.repeat(3_000), mode: 'grammar' });
      await enhance(server, chatId, token, { text: 'a'.repeat(10_000), mode: 'grammar' });
      await enhance(server, chatId, token, { text: 'a'.repeat(100), mode: 'grammar' });

      expect(fake.calls.map((call) => call.maxOutputTokens)).toEqual([1_500, 5_000, 400]);
    });

    it('masks a card number in what is sent and in what is returned', async () => {
      const { token, chatId } = await setUp(server);
      reply = () => `Your card ${CARD} was charged once.`;

      const response = await enhance(server, chatId, token, {
        text: `your card ${CARD} was charged once`,
        mode: 'formal',
      });

      expect(response.statusCode).toBe(200);
      expect(fake.calls[0]!.messages[0]!.content).not.toContain(CARD);
      expect(fake.calls[0]!.messages[0]!.content).toContain(MASKED);
      expect((response.json() as { text: string }).text).toBe(
        `Your card ${MASKED} was charged once.`,
      );
      const run = await owner.skillRun.findFirst({ where: { chatId } });
      expect(JSON.stringify(run?.log)).not.toContain(CARD);
    });

    it('refuses a reply too long to send, and records nothing (FR-MOD-12.3)', async () => {
      const { token, chatId } = await setUp(server);
      reply = () => 'y'.repeat(ENHANCE_TEXT_MAX_CHARS + 1);

      const response = await enhance(server, chatId, token, { text: DRAFT, mode: 'friendly' });

      expect(response.statusCode).toBe(503);
      expect((response.json() as ErrorBody).error.details).toEqual({ kind: 'bad_response' });
      expect(await owner.skillRun.count({ where: { chatId } })).toBe(0);
    });

    it('takes a reply of exactly the send limit', async () => {
      const { token, chatId } = await setUp(server);
      reply = () => 'y'.repeat(ENHANCE_TEXT_MAX_CHARS);

      const response = await enhance(server, chatId, token, { text: DRAFT, mode: 'friendly' });

      expect(response.statusCode).toBe(200);
      expect((response.json() as { text: string }).text).toHaveLength(ENHANCE_TEXT_MAX_CHARS);
    });

    for (const failure of [
      new LlmProviderError('timeout'),
      new LlmProviderError('no_answer', { reason: 'length' }),
    ]) {
      it(`answers 503 (${failure.kind}) and records nothing — no assist run`, async () => {
        const { token, chatId } = await setUp(server);
        const secret = 'order Q-91877 ships friday';
        failing = failure;

        const response = await enhance(server, chatId, token, { text: secret, mode: 'formal' });

        expect(response.statusCode).toBe(503);
        const error = (response.json() as ErrorBody).error;
        expect(error.type).toBe('service_unavailable');
        // `reason` rides along for a cut-off reply only: it tells the agent to
        // shorten the draft instead of retrying.
        expect(error.details).toEqual(
          failure.kind === 'no_answer'
            ? { kind: 'no_answer', reason: 'length' }
            : { kind: 'timeout' },
        );
        expect(await owner.skillRun.count({ where: { chatId } })).toBe(0);

        const lines = log.events('copilot.enhance.failed');
        expect(lines).toHaveLength(1);
        expect(lines[0]).toMatchObject({
          level: 40,
          chat_id: chatId,
          provider: 'openai',
          mode: 'formal',
          kind: failure.kind,
          transient: failure.transient,
        });
        const written = log.lines.filter((line) => line.includes('copilot.enhance.failed'));
        expect(written.join('\n')).not.toContain('Q-91877');
        expect(written.join('\n')).not.toContain('You rewrite a draft');
      });
    }

    it('lets a defect surface as a 500, not as a model failure', async () => {
      const { token, chatId } = await setUp(server);
      failing = new Error('boom');

      const response = await enhance(server, chatId, token, { text: DRAFT, mode: 'grammar' });

      expect(response.statusCode).toBe(500);
      expect(await owner.skillRun.count({ where: { chatId } })).toBe(0);
    });

    it('refuses an empty draft and an unknown mode before any call', async () => {
      const { token, chatId } = await setUp(server);

      expect((await enhance(server, chatId, token, { text: '   ' })).statusCode).toBe(400);
      expect(
        (await enhance(server, chatId, token, { text: DRAFT, mode: 'pirate' })).statusCode,
      ).toBe(400);
      expect(fake.calls).toHaveLength(0);
    });

    it('takes a 10 000-character draft on an ordinary deployment (the pilot flag is off)', async () => {
      const { token, chatId } = await setUp(server);

      const response = await enhance(server, chatId, token, {
        text: 'z'.repeat(10_000),
        mode: 'grammar',
      });

      expect(response.statusCode).toBe(200);
      expect(fake.calls).toHaveLength(1);
      expect((await enhance(server, chatId, token, { text: 'z'.repeat(10_001) })).statusCode).toBe(
        400,
      );
    });
  });

  it('stops a draft over 2 000 characters in the public pilot, before any model call (FR-MOD-12.3)', async () => {
    const fake = new FakeLlmProvider();
    const server = await startTestServer({ PILOT_MODE: 'true' }, { llm: fake });
    try {
      const { token, chatId } = await setUp(server);

      const refused = await enhance(server, chatId, token, { text: 'q'.repeat(2_001) });

      expect(refused.statusCode).toBe(400);
      const error = (refused.json() as ErrorBody).error;
      expect(error.type).toBe('validation');
      expect(error.details).toMatchObject({ reason: 'enhance_too_long', max_length: 2_000 });
      expect(fake.calls).toHaveLength(0);
      expect(await owner.skillRun.count({ where: { chatId } })).toBe(0);

      const accepted = await enhance(server, chatId, token, { text: 'q'.repeat(2_000) });
      expect(accepted.statusCode).toBe(200);
      expect(fake.calls).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it('keeps a covered workspace’s draft away from an out-of-region model (NFR-C4)', async () => {
    const fake = new FakeLlmProvider();
    // A US deployment whose model answers from the EU, and a US workspace that
    // signed a BAA: the one combination C4-e refuses.
    const server = await startTestServer(
      { SIYAHTUS_REGION: 'us', LLM_PROVIDER_REGION: 'eu' },
      { llm: fake },
    );
    try {
      const slug = `cov-enh-${Date.now()}`;
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
      const chatId = await chatFor(server, ws, token);

      const response = await enhance(server, chatId, token, { text: DRAFT, mode: 'formal' });

      expect(response.statusCode).toBe(403);
      expect((response.json() as ErrorBody).error.details).toEqual({
        region: 'us',
        provider_region: 'eu',
      });
      expect(fake.calls).toHaveLength(0);
      expect(await owner.skillRun.count({ where: { chatId } })).toBe(0);
    } finally {
      await server.close();
    }
  });

  it('applies the configured ceilings: LLM_MAX_OUTPUT_TOKENS as the floor, LLM_MAX_PROMPT_CHARS as a refusal, not a cut', async () => {
    const fake = new FakeLlmProvider();
    const server = await startTestServer(
      { LLM_MAX_OUTPUT_TOKENS: '1200', LLM_MAX_PROMPT_CHARS: '2000' },
      { llm: fake },
    );
    try {
      const { token, chatId } = await setUp(server);

      // 200 characters: half is 100 tokens, so the configured 1 200 is the call's.
      expect((await enhance(server, chatId, token, { text: 'k'.repeat(200) })).statusCode).toBe(
        200,
      );
      expect(fake.calls[0]!.maxOutputTokens).toBe(1_200);

      // A draft that cannot fit the prompt ceiling is not shortened silently.
      const refused = await enhance(server, chatId, token, { text: 'k'.repeat(2_500) });
      expect(refused.statusCode).toBe(503);
      expect((refused.json() as ErrorBody).error.details).toEqual({ kind: 'prompt_too_long' });
      expect(fake.calls).toHaveLength(1);
      expect(await owner.skillRun.count({ where: { chatId } })).toBe(1);
    } finally {
      await server.close();
    }
  });

  it('keeps the stub’s rewrite byte for byte on LLM_PROVIDER=mock (FR-MOD-12.3)', async () => {
    // Both the default server and a recorder that says it is the stub: neither
    // is called, and the text is `enhanceText`'s for every mode.
    const recorder = new FakeLlmProvider({ id: 'mock' });
    const injected = await startTestServer({}, { llm: recorder });
    const standard = await startTestServer();
    try {
      for (const server of [injected, standard]) {
        const { token, chatId } = await setUp(server);
        for (const mode of ENHANCE_MODES) {
          const response = await enhance(server, chatId, token, { text: DRAFT, mode });

          expect(response.statusCode).toBe(200);
          expect(response.json()).toEqual({ text: enhanceText(DRAFT, mode), mode });
        }
        const runs = await owner.skillRun.findMany({ where: { chatId } });
        expect(runs).toHaveLength(ENHANCE_MODES.length);
        for (const run of runs)
          expect(run).toMatchObject({ llmInputTokens: 0, llmOutputTokens: 0 });
      }
      expect(recorder.calls).toHaveLength(0);
    } finally {
      await injected.close();
      await standard.close();
    }
  });
});
