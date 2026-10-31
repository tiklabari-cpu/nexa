/**
 * Copilot's drawer question — `POST /copilot/ask` (IN-09, tm 366.1).
 *
 * Real Fastify, Postgres and Redis. On the `mock` provider (most of the suite)
 * the question is sorted by the BI dictionary and the stub's word rule; a
 * second server with a scripted, counted model checks that the model's sorting
 * is what routes the question, that a model which does not answer falls back
 * to the rule, and that today's AI allowance refuses a question before
 * anything is read. What is held:
 *
 *   - a knowledge question is answered from the store with the source's name
 *     and when it was last reviewed; nothing found is "I don't know";
 *   - a report question needs `reports_read` — a Team Member is told they may
 *     not ask it, an admin gets the Overview figure;
 *   - another workspace's sources never answer, nor its chats;
 *   - one `copilot.ask` audit entry per question, with no words in it.
 */
import type { PrismaClient } from '@prisma/client';
import { defaultScopesForRole } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUESTION_KIND_RESPONSE_NAME } from '../../src/services/ai/copilot-question-kind.js';
import { utcDayKey } from '../../src/services/ai/ai-daily-budget.js';
import { LlmProviderError } from '../../src/services/ai/provider/llm-error.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
} from '../../src/services/ai/provider/llm-provider.js';
import { asKnowledgeAnswer } from '../helpers/knowledge-answer.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const PAPARA =
  'Papara ile günlük çekim limiti 50.000 TL, tek seferde en fazla 10.000 TL çekilebilir.';
const PAPARA_QUESTION = 'Papara çekim limiti ne kadar?';

interface AskBody {
  answer: string;
  sources: Array<{ id: string; title: string; reviewed_at: string }>;
  kind: 'kb' | 'bi' | 'unknown';
  reason?: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('POST /copilot/ask (IN-09)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  /** An admin's token: Copilot knowledge, chats and reports. */
  const adminToken = (tenant: TenantFixture) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw', 'reports_read'],
    });

  /** A Team Member's panel session: the role's default set, no `reports_read`. */
  const memberToken = (tenant: TenantFixture) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.agentAccountId,
      kind: 'oauth',
      clientId: tenant.clientId,
      scopes: defaultScopesForRole('agent'),
    });

  async function addSource(token: string, name: string, content: string): Promise<string> {
    const created = await server.post('/copilot/knowledge', { name, content }, auth(token));
    expect(created.statusCode, created.body).toBe(201);
    return (created.json() as { id: string }).id;
  }

  const ask = (token: string, body: Record<string, unknown>) =>
    server.post('/copilot/ask', body, auth(token));

  async function asked(token: string, question: string, context?: Record<string, unknown>) {
    const response = await ask(token, { question, ...(context ? { context } : {}) });
    expect(response.statusCode, response.body).toBe(200);
    return response.json() as AskBody;
  }

  const askAudits = (tenant: TenantFixture) =>
    owner.auditLogEntry.findMany({
      where: { licenseId: tenant.licenseId, action: 'copilot.ask' },
      orderBy: { chainSeq: 'asc' },
      select: { metadata: true, target: true, actorId: true },
    });

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
  });

  it('answers a knowledge question from the store, naming the source and when it was reviewed', async () => {
    const admin = await adminToken(fx.a);
    const sourceId = await addSource(admin, 'Papara çekim kuralları', PAPARA);
    await addSource(admin, 'Kargo', 'Kargo iki iş gününde teslim edilir.');
    const reviewedAt = new Date('2026-09-01T10:00:00.000Z');
    await owner.knowledgeSource.update({ where: { id: sourceId }, data: { reviewedAt } });

    const body = await asked(await memberToken(fx.a), PAPARA_QUESTION, { route: '/reports' });

    expect(body.kind).toBe('kb');
    expect(body.reason).toBeUndefined();
    expect(body.answer).toContain('50.000 TL');
    expect(body.sources).toEqual([
      { id: sourceId, title: 'Papara çekim kuralları', reviewed_at: reviewedAt.toISOString() },
    ]);
  });

  it('says it does not know when nothing in the store answers, citing nothing', async () => {
    const admin = await adminToken(fx.a);
    await addSource(admin, 'Papara çekim kuralları', PAPARA);

    const body = await asked(admin, 'Kripto cüzdan adresi nasıl değiştirilir?');

    expect(body).toMatchObject({ kind: 'unknown', reason: 'no_answer', sources: [] });
    expect(body.answer).toMatch(/don't know/);
  });

  it('tells a Team Member without reports_read they may not ask a report question, and reads no report', async () => {
    const member = await memberToken(fx.a);

    // Placed by the BI dictionary…
    const known = await asked(member, 'bu hafta kaç sohbet kapandı');
    expect(known).toMatchObject({ kind: 'bi', reason: 'not_permitted', sources: [] });
    expect(known.answer).toMatch(/permission/);
    expect(known.answer).not.toMatch(/\d/);
    // …and by the word rule, a figure the BI command does not know.
    const unknown = await asked(member, 'bugün kaç çekim şikâyeti geldi?');
    expect(unknown).toMatchObject({ kind: 'bi', reason: 'not_permitted' });
  });

  it('answers a report question with the Overview figure for a caller who may read reports', async () => {
    const admin = await adminToken(fx.a);

    const closed = await asked(admin, 'bu hafta kaç sohbet kapandı');
    expect(closed.kind).toBe('bi');
    expect(closed.reason).toBeUndefined();
    expect(closed.answer).toMatch(/^\d+ chats? closed this week\.$/);

    const unplaced = await asked(admin, 'bugün kaç çekim şikâyeti geldi?');
    expect(unplaced).toMatchObject({ kind: 'bi', reason: 'not_understood', sources: [] });

    const unrated = await asked(admin, 'müşteri memnuniyeti dün');
    expect(unrated).toMatchObject({ kind: 'bi', reason: 'no_data' });
  });

  it("never answers from another workspace's sources (NFR-S1)", async () => {
    await addSource(await adminToken(fx.b), 'Papara çekim kuralları', PAPARA);

    const body = await asked(await adminToken(fx.a), PAPARA_QUESTION);

    expect(body).toMatchObject({ kind: 'unknown', reason: 'no_answer', sources: [] });
  });

  it("will not take another workspace's chat as its context — a 404, nothing asked", async () => {
    const adminB = await adminToken(fx.b);
    const customer = await owner.customer.create({
      data: { organizationId: fx.b.organizationId, name: 'Visitor' },
      select: { id: true },
    });
    const started = await server.post(
      '/chats',
      { customer_id: customer.id, assign_to_me: true },
      auth(adminB),
    );
    expect([200, 201]).toContain(started.statusCode);
    const chatOfB = (started.json() as { id: string }).id;

    const response = await ask(await adminToken(fx.a), {
      question: PAPARA_QUESTION,
      context: { chat_id: chatOfB },
    });

    expect(response.statusCode).toBe(404);
    expect(await askAudits(fx.a)).toEqual([]);
  });

  it('writes one copilot.ask audit entry per question, with its kind and none of its words', async () => {
    const admin = await adminToken(fx.a);
    await addSource(admin, 'Papara çekim kuralları', PAPARA);
    const member = await memberToken(fx.a);

    await asked(member, PAPARA_QUESTION);
    await asked(member, 'bu hafta kaç sohbet kapandı');

    const entries = await askAudits(fx.a);
    expect(entries.map((entry) => entry.metadata)).toEqual([
      expect.objectContaining({ kind: 'kb' }),
      expect.objectContaining({ kind: 'bi', reason: 'not_permitted' }),
    ]);
    expect(entries.every((entry) => entry.actorId === fx.a.agentAccountId)).toBe(true);
    const written = JSON.stringify(entries);
    expect(written).not.toMatch(/Papara|sohbet|50\.000/);
    expect(await askAudits(fx.b)).toEqual([]);
  });

  it('refuses an empty question and one past 2 000 characters, and a customer token outright', async () => {
    const admin = await adminToken(fx.a);
    expect((await ask(admin, { question: '   ' })).statusCode).toBe(400);
    expect((await ask(admin, { question: 'x'.repeat(2_001) })).statusCode).toBe(400);
    expect(
      (await ask(admin, { question: 'ok', context: { chat_id: 'not a chat' } })).statusCode,
    ).toBe(400);

    const customer = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId },
      { origin: `https://${fx.a.trustedDomain}` },
    );
    const customerToken = (customer.json() as { token: string }).token;
    expect((await ask(customerToken, { question: PAPARA_QUESTION })).statusCode).toBe(404);
    expect(await askAudits(fx.a)).toEqual([]);
  });
});

/** A counted model whose sorting the test sets; it writes knowledge answers as the stub would. */
class SortingLlm implements LlmProvider {
  readonly id = 'openai' as const;
  readonly calls: LlmCompletionRequest[] = [];
  kind: 'bi' | 'kb' = 'kb';
  failSorting = false;

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    const usage = { inputTokens: 50, outputTokens: 5 };
    if (request.responseFormat?.name === QUESTION_KIND_RESPONSE_NAME) {
      if (this.failSorting) throw new LlmProviderError('timeout');
      return { text: JSON.stringify({ kind: this.kind }), usage };
    }
    return { text: asKnowledgeAnswer('Günlük çekim limiti 50.000 TL.', request), usage };
  }
}

describe('POST /copilot/ask over a counted model (IN-09)', () => {
  const CAP = 50_000;
  const llm = new SortingLlm();
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const adminToken = (tenant: TenantFixture) =>
    grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw', 'reports_read'],
    });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer(
      { LOG_LEVEL: 'silent', AI_DAILY_LLM_TOKENS_PER_WORKSPACE: String(CAP) },
      { llm },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    llm.calls.length = 0;
    llm.kind = 'kb';
    llm.failSorting = false;
  });

  const ask = async (token: string, question: string) => {
    const response = await server.post('/copilot/ask', { question }, auth(token));
    return response;
  };

  it('routes on the model’s sorting, on the fast tier, once the dictionary has not placed it', async () => {
    const admin = await adminToken(fx.a);
    const created = await server.post(
      '/copilot/knowledge',
      { name: 'Papara çekim kuralları', content: PAPARA },
      auth(admin),
    );
    expect(created.statusCode).toBe(201);

    llm.kind = 'bi';
    const asBi = (await ask(admin, PAPARA_QUESTION)).json() as AskBody;
    expect(asBi).toMatchObject({ kind: 'bi', reason: 'not_understood' });
    expect(llm.calls.map((call) => [call.responseFormat?.name, call.tier])).toEqual([
      [QUESTION_KIND_RESPONSE_NAME, 'fast'],
    ]);

    llm.calls.length = 0;
    llm.kind = 'kb';
    const asKb = (await ask(admin, PAPARA_QUESTION)).json() as AskBody;
    expect(asKb).toMatchObject({ kind: 'kb', answer: 'Günlük çekim limiti 50.000 TL.' });
    expect(asKb.sources.map((source) => source.title)).toEqual(['Papara çekim kuralları']);
    expect(llm.calls.map((call) => [call.responseFormat?.name, call.tier])).toEqual([
      [QUESTION_KIND_RESPONSE_NAME, 'fast'],
      ['knowledge_answer', 'default'],
    ]);
    // The answer is written for an agent, not a player.
    expect(llm.calls[1]!.system).toContain('An agent is asking you a question');

    // A question the dictionary places asks no model to sort it.
    llm.calls.length = 0;
    expect(((await ask(admin, 'bu hafta kaç sohbet kapandı')).json() as AskBody).kind).toBe('bi');
    expect(llm.calls).toEqual([]);
  });

  it('falls back to the word rule when the model does not sort the question', async () => {
    const admin = await adminToken(fx.a);
    llm.failSorting = true;

    const body = (await ask(admin, 'bugün kaç çekim şikâyeti geldi?')).json() as AskBody;

    expect(body).toMatchObject({ kind: 'bi', reason: 'not_understood' });
  });

  it('answers 429 ai_daily_cap once today’s allowance is used up — no model call, no audit entry', async () => {
    const admin = await adminToken(fx.a);
    await owner.aiDailyUsage.create({
      data: {
        licenseId: fx.a.licenseId,
        day: utcDayKey(new Date()),
        meter: 'llm',
        used: BigInt(CAP),
      },
    });

    const response = await ask(admin, PAPARA_QUESTION);

    expect(response.statusCode).toBe(429);
    expect((response.json() as { error: { type: string; details?: unknown } }).error).toMatchObject(
      {
        type: 'limit_reached',
        details: { reason: 'ai_daily_cap', meter: 'llm', scope: 'workspace' },
      },
    );
    expect(llm.calls).toEqual([]);
    expect(
      await owner.auditLogEntry.count({
        where: { licenseId: fx.a.licenseId, action: 'copilot.ask' },
      }),
    ).toBe(0);
  });
});
