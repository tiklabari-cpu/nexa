/**
 * The daily AI caps through the real server (tm 257.8 · ADR
 * `docs/adr/pilot-public-readiness.md` K-e(3)).
 *
 * Real Fastify, Postgres and Redis; the model is a scripted provider with id
 * `openai` (counted, like any real model) or the real OpenAI adapter over a
 * `fetch` recorder, and the caps are shrunk through the environment. What is
 * held, end to end:
 *
 *   1. Under the workspace cap a visitor is answered and the call's real cost
 *      lands on today's UTC row; at the cap the message is left for a human —
 *      no provider call, no run, one `ai.cap_reached` line. A call that passes
 *      the early check but does not fit is refused at its reservation.
 *   2. The deployment cap is shared: one workspace's spend refuses another.
 *   3. Preview and the Copilot summary and rewrite answer 429 `limit_reached`
 *      with `reason: ai_daily_cap` and a `Retry-After` to UTC midnight.
 *   4. A call reserves its estimate and settles what it cost, so the next one
 *      fits; a billed `no_answer` is counted.
 *   5. Ten concurrent calls with room for one: one goes, nine are refused, the
 *      counter never passes the cap.
 *   6. The `mock` provider is never counted and never refused.
 *   7. Rows are keyed by the UTC day.
 *   8. A refusal never reaches the provider's circuit breaker.
 *
 * And the table's own boundary: the application role reads only its own
 * workspace's row, writes none, and the counting functions need a tenant.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { secondsUntilUtcMidnight, utcDayKey } from '../../src/services/ai/ai-daily-budget.js';
import { buildEnhancePrompt, enhanceOutputBudget } from '../../src/services/ai/copilot-enhance.js';
import { LlmProviderError } from '../../src/services/ai/provider/llm-error.js';
import {
  promptLength,
  type LlmCompletion,
  type LlmCompletionRequest,
  type LlmProvider,
  type LlmUsage,
} from '../../src/services/ai/provider/llm-provider.js';
import {
  AI_QUESTION,
  LineSink,
  customerAsks,
  runFor,
  seedAiWorkspace,
  type AiWorkspace,
} from '../helpers/ai-workspace.js';
import { fakeOpenAiFetch, openAiCompletion } from '../helpers/fake-openai.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** `LLM_MAX_OUTPUT_TOKENS`' default — the early check's minimum. */
const MIN = 400;
/** The workspace cap most of this suite runs under. */
const CAP = 50_000;
const REPLY = 'Written by the scripted model.';
const DRAFT = 'thanks for waiting, the parcel left our warehouse this morning';
/** What a rewrite of `DRAFT` reserves: its prompt's characters plus its own output budget. */
const ENHANCE_ESTIMATE =
  promptLength(buildEnhancePrompt(DRAFT, 'rephrase')) + enhanceOutputBudget(DRAFT.length, MIN);

/** A counted model whose cost, failure and pace the test sets per call. */
class ScriptedLlm implements LlmProvider {
  readonly id = 'openai' as const;
  readonly calls: LlmCompletionRequest[] = [];
  inFlight = 0;
  usage: LlmUsage = { inputTokens: 100, outputTokens: 10 };
  failWith: Error | null = null;
  #gate: Promise<void> | null = null;
  #open: (() => void) | null = null;

  /** Every call from now waits until `release()`. */
  hold(): void {
    this.#gate = new Promise((resolve) => {
      this.#open = resolve;
    });
  }

  release(): void {
    this.#open?.();
    this.#gate = null;
    this.#open = null;
  }

  reset(): void {
    this.release();
    this.calls.length = 0;
    this.inFlight = 0;
    this.usage = { inputTokens: 100, outputTokens: 10 };
    this.failWith = null;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    this.calls.push(request);
    this.inFlight += 1;
    try {
      if (this.#gate) await this.#gate;
      if (this.failWith) throw this.failWith;
      return { text: REPLY, usage: this.usage };
    } finally {
      this.inFlight -= 1;
    }
  }
}

async function until(condition: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface ErrorBody {
  error: { type: string; details?: Record<string, unknown> };
}

describe('daily AI caps through the real server (tm 257.8)', () => {
  let owner: PrismaClient;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const today = () => utcDayKey(new Date());

  /** Today's `llm` row for a workspace, or the deployment's (`null`). */
  async function usage(licenseId: bigint | null) {
    const row = await owner.aiDailyUsage.findFirst({
      where: { licenseId, day: today(), meter: 'llm' },
    });
    return row ? { reserved: Number(row.reserved), used: Number(row.used) } : null;
  }

  async function seedUsage(licenseId: bigint | null, used: number): Promise<void> {
    await owner.aiDailyUsage.create({
      data: { licenseId, day: today(), meter: 'llm', used: BigInt(used) },
    });
  }

  function expectDailyCap(
    response: { statusCode: number; headers: Record<string, unknown>; json: () => unknown },
    scope: 'workspace' | 'global',
  ): void {
    expect(response.statusCode).toBe(429);
    expect((response.json() as ErrorBody).error).toMatchObject({
      type: 'limit_reached',
      details: { reason: 'ai_daily_cap', meter: 'llm', scope },
    });
    const retryAfter = Number(response.headers['retry-after']);
    expect(Math.abs(retryAfter - secondsUntilUtcMidnight(new Date()))).toBeLessThanOrEqual(2);
  }

  function capLines(log: LineSink) {
    return log.events('ai.cap_reached').map((line) => ({
      license_id: line['license_id'],
      meter: line['meter'],
      scope: line['scope'],
    }));
  }

  /** A token that may run Preview and the Copilot assists. */
  const tokenFor = (ws: { licenseId: bigint; organizationId: string; ownerId: string }) =>
    grantToken(owner, {
      licenseId: ws.licenseId,
      organizationId: ws.organizationId,
      ownerId: ws.ownerId,
      scopes: ['agents-bot--all:rw', 'chats--all:rw'],
    });

  const preview = (server: TestServer, ws: AiWorkspace, token: string) =>
    server.post(
      '/skills/preview',
      {
        steps: [{ type: 'send_message', source: 'knowledge' }],
        message: AI_QUESTION,
        ai_agent_id: ws.aiAgentId,
      },
      auth(token),
    );

  /** An active chat in the fixture workspace, with two turns a summary can read. */
  async function chatIn(server: TestServer, tenant: Fixtures['a'], token: string) {
    const customer = await owner.customer.create({
      data: { organizationId: tenant.organizationId, name: 'Visitor' },
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
    const base = Date.now() - 2_000;
    await owner.event.createMany({
      data: [
        ['customer', 'Where is my parcel?'],
        ['agent', 'Let me check that for you.'],
      ].map(([author, text], index) => ({
        id: `${thread.id}_${100 + index}`,
        threadId: thread.id,
        chatId,
        licenseId: tenant.licenseId,
        type: 'message',
        text: text!,
        authorType: author!,
        recipients: 'all',
        createdAt: new Date(base + index * 1_000),
      })),
    });
    return chatId;
  }

  const fixtureWorkspace = (tenant: Fixtures['a']) => ({
    licenseId: tenant.licenseId,
    organizationId: tenant.organizationId,
    ownerId: tenant.ownerAccountId,
  });

  const summarise = (server: TestServer, chatId: string, token: string) =>
    server.post(`/copilot/chats/${chatId}/summary`, { language: 'en' }, auth(token));
  const enhance = (server: TestServer, chatId: string, token: string) =>
    server.post(`/copilot/chats/${chatId}/enhance`, { text: DRAFT, mode: 'rephrase' }, auth(token));

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  describe('over a counted model, workspace cap shrunk', () => {
    const llm = new ScriptedLlm();
    const log = new LineSink();
    let server: TestServer;
    let fx: Fixtures;

    beforeAll(async () => {
      server = await startTestServer(
        { LOG_LEVEL: 'warn', AI_DAILY_LLM_TOKENS_PER_WORKSPACE: String(CAP) },
        { llm, logStream: log as unknown as NodeJS.WritableStream },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
      llm.reset();
      log.lines.length = 0;
    });

    it('answers a visitor under the cap and counts the call’s real cost on today’s UTC rows', async () => {
      const ws = await seedAiWorkspace(owner);
      const asked = await customerAsks(owner, server, ws);

      expect(asked.events.filter((e) => e.authorType === 'bot').map((e) => e.text)).toEqual([
        REPLY,
      ]);
      expect(llm.calls).toHaveLength(1);
      // 100 in + 10 out, the estimate handed back — on the workspace's row and
      // the deployment's, both under today's UTC key.
      expect(await usage(ws.licenseId)).toEqual({ reserved: 0, used: 110 });
      expect(await usage(null)).toEqual({ reserved: 0, used: 110 });
      const days = await owner.aiDailyUsage.findMany({ select: { day: true } });
      expect(days.map((row) => row.day)).toEqual([today(), today()]);
      expect(capLines(log)).toEqual([]);
    });

    it('leaves a visitor’s message for a human at the cap — no provider call, no run, one warning', async () => {
      const ws = await seedAiWorkspace(owner);
      await seedUsage(ws.licenseId, CAP);

      const asked = await customerAsks(owner, server, ws);

      expect(asked.events.filter((e) => e.authorType === 'bot')).toEqual([]);
      expect(asked.events.filter((e) => e.authorType === 'customer').map((e) => e.text)).toEqual([
        AI_QUESTION,
      ]);
      expect(llm.calls).toHaveLength(0);
      expect(await owner.skillRun.count({ where: { chatId: asked.chatId } })).toBe(0);
      expect(capLines(log)).toEqual([
        { license_id: ws.licenseId.toString(), meter: 'llm', scope: 'workspace' },
      ]);
      expect(
        log.withMessage('ai model could not answer; the conversation stays with a human'),
      ).toEqual([]);
      expect(await usage(ws.licenseId)).toEqual({ reserved: 0, used: CAP });
      expect(await usage(null)).toBeNull();
    });

    it('refuses at the reservation a call that passed the early check but does not fit — the run is recorded, nothing is sent', async () => {
      const ws = await seedAiWorkspace(owner);
      // Room for the reply's ceiling, not for a prompt as well.
      await seedUsage(ws.licenseId, CAP - MIN);

      const asked = await customerAsks(owner, server, ws);

      expect(asked.events.filter((e) => e.authorType === 'bot')).toEqual([]);
      expect(llm.calls).toHaveLength(0);
      const run = await runFor(owner, asked.chatId);
      expect(run.status).toBe('failed');
      expect(run.log.outcome).toBe('handed_off');
      expect(run.log.entries.map((entry) => entry.detail)).toContain(
        "today's AI cap is reached (workspace) — handed to a human",
      );
      expect(run).toMatchObject({ llmInputTokens: 0, llmOutputTokens: 0 });
      expect(capLines(log)).toEqual([
        { license_id: ws.licenseId.toString(), meter: 'llm', scope: 'workspace' },
      ]);
      expect(await usage(ws.licenseId)).toEqual({ reserved: 0, used: CAP - MIN });
      expect(await usage(null)).toBeNull();
    });

    it('answers Preview and the Copilot summary and rewrite with 429 ai_daily_cap at the cap, writing nothing', async () => {
      const ws = await seedAiWorkspace(owner);
      const wsToken = await tokenFor(ws);
      const agent = await tokenFor(fixtureWorkspace(fx.a));
      const chatId = await chatIn(server, fx.a, agent);
      const eventsBefore = await owner.event.count({ where: { chatId } });
      await seedUsage(ws.licenseId, CAP);
      await seedUsage(fx.a.licenseId, CAP);

      expectDailyCap(await preview(server, ws, wsToken), 'workspace');
      expectDailyCap(await summarise(server, chatId, agent), 'workspace');
      expectDailyCap(await enhance(server, chatId, agent), 'workspace');
      // Answered before the handler runs: a chat that does not exist is not
      // even looked up.
      expectDailyCap(await summarise(server, 'NOSUCHCHAT', agent), 'workspace');

      expect(llm.calls).toHaveLength(0);
      expect(await owner.event.count({ where: { chatId } })).toBe(eventsBefore);
      expect(await owner.skillRun.count({ where: { chatId } })).toBe(0);
      expect(capLines(log)).toEqual([
        { license_id: ws.licenseId.toString(), meter: 'llm', scope: 'workspace' },
        { license_id: fx.a.licenseId.toString(), meter: 'llm', scope: 'workspace' },
        { license_id: fx.a.licenseId.toString(), meter: 'llm', scope: 'workspace' },
        { license_id: fx.a.licenseId.toString(), meter: 'llm', scope: 'workspace' },
      ]);
    });

    it('answers the same 429 when the early check passes and the call itself does not fit', async () => {
      const ws = await seedAiWorkspace(owner);
      const wsToken = await tokenFor(ws);
      const agent = await tokenFor(fixtureWorkspace(fx.a));
      const chatId = await chatIn(server, fx.a, agent);
      await seedUsage(ws.licenseId, CAP - MIN);
      await seedUsage(fx.a.licenseId, CAP - MIN);

      expectDailyCap(await preview(server, ws, wsToken), 'workspace');
      expectDailyCap(await summarise(server, chatId, agent), 'workspace');
      expectDailyCap(await enhance(server, chatId, agent), 'workspace');

      expect(llm.calls).toHaveLength(0);
      expect(await owner.skillRun.count({ where: { chatId } })).toBe(0);
      expect(log.events('ai.cap_reached')).toHaveLength(3);
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: CAP - MIN });
    });

    it('lets exactly the calls that fit through when ten arrive at once, and never counts past the cap', async () => {
      const agent = await tokenFor(fixtureWorkspace(fx.a));
      const chatId = await chatIn(server, fx.a, agent);
      // Room for exactly one rewrite.
      await seedUsage(fx.a.licenseId, CAP - ENHANCE_ESTIMATE);

      llm.hold();
      const done: number[] = [];
      const all = Array.from({ length: 10 }, () =>
        enhance(server, chatId, agent).then((response) => {
          done.push(response.statusCode);
          return response;
        }),
      );
      // Every request has either reached the model or been answered.
      await until(() => llm.calls.length + done.length === 10, 'ten requests to be decided');

      expect(llm.calls).toHaveLength(1);
      expect(done).toEqual(Array(9).fill(429));
      const peak = await usage(fx.a.licenseId);
      expect(peak).toEqual({ reserved: ENHANCE_ESTIMATE, used: CAP - ENHANCE_ESTIMATE });
      expect(peak!.reserved + peak!.used).toBeLessThanOrEqual(CAP);

      llm.release();
      const responses = await Promise.all(all);
      expect(responses.map((r) => r.statusCode).sort()).toEqual([200, ...Array(9).fill(429)]);
      expect(await usage(fx.a.licenseId)).toEqual({
        reserved: 0,
        used: CAP - ENHANCE_ESTIMATE + 110,
      });
      expect(log.events('ai.cap_reached')).toHaveLength(9);
    });
  });

  describe('reserve, then settle what the call cost', () => {
    const llm = new ScriptedLlm();
    let server: TestServer;
    let fx: Fixtures;

    beforeAll(async () => {
      // Two estimates cannot fit at once; two calls can, once the first one's
      // estimate is handed back.
      server = await startTestServer(
        { AI_DAILY_LLM_TOKENS_PER_WORKSPACE: String(2 * ENHANCE_ESTIMATE - 1) },
        { llm },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
      llm.reset();
    });

    it('reserves the estimate while the call runs, hands it back after, and so lets the next call fit', async () => {
      const agent = await tokenFor(fixtureWorkspace(fx.a));
      const chatId = await chatIn(server, fx.a, agent);
      llm.usage = { inputTokens: 1, outputTokens: 1 };

      llm.hold();
      const first = enhance(server, chatId, agent);
      await until(() => llm.inFlight === 1, 'the first call to reach the model');
      const request = llm.calls[0]!;
      expect(promptLength(request) + request.maxOutputTokens).toBe(ENHANCE_ESTIMATE);
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: ENHANCE_ESTIMATE, used: 0 });
      expect(await usage(null)).toEqual({ reserved: ENHANCE_ESTIMATE, used: 0 });
      llm.release();
      expect((await first).statusCode).toBe(200);
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: 2 });
      expect(await usage(null)).toEqual({ reserved: 0, used: 2 });

      expect((await enhance(server, chatId, agent)).statusCode).toBe(200);
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: 4 });
      expect(llm.calls).toHaveLength(2);
    });

    it('counts what a billed failure cost, and what an unbilled one did not', async () => {
      const agent = await tokenFor(fixtureWorkspace(fx.a));
      const chatId = await chatIn(server, fx.a, agent);

      llm.failWith = new LlmProviderError('no_answer', {
        reason: 'length',
        usage: { inputTokens: 50, outputTokens: 400 },
      });
      expect((await enhance(server, chatId, agent)).statusCode).toBe(503);
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: 450 });

      llm.failWith = new LlmProviderError('rate_limited', { status: 429 });
      expect((await enhance(server, chatId, agent)).statusCode).toBe(503);
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 0, used: 450 });
      expect(await usage(null)).toEqual({ reserved: 0, used: 450 });
    });
  });

  describe('the deployment cap, shared by every workspace', () => {
    const llm = new ScriptedLlm();
    const log = new LineSink();
    let server: TestServer;
    /** One answer costs this much; after it, less than the smallest call is left. */
    const SPEND = 20_000;

    beforeAll(async () => {
      server = await startTestServer(
        {
          LOG_LEVEL: 'warn',
          AI_DAILY_LLM_TOKENS_PER_WORKSPACE: '10000000',
          AI_DAILY_LLM_TOKENS_GLOBAL: String(SPEND + MIN - 1),
        },
        { llm, logStream: log as unknown as NodeJS.WritableStream },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      await seedFixtures(owner);
      await clearRateLimits(server.app);
      llm.reset();
      log.lines.length = 0;
    });

    it('refuses workspace B once workspace A has spent the deployment’s allowance', async () => {
      const a = await seedAiWorkspace(owner);
      const b = await seedAiWorkspace(owner);
      llm.usage = { inputTokens: SPEND - 12, outputTokens: 12 };

      const answered = await customerAsks(owner, server, a);
      expect(answered.events.filter((e) => e.authorType === 'bot').map((e) => e.text)).toEqual([
        REPLY,
      ]);
      expect(await usage(null)).toEqual({ reserved: 0, used: SPEND });

      const refused = await customerAsks(owner, server, b);
      expect(refused.events.filter((e) => e.authorType === 'bot')).toEqual([]);
      expect(llm.calls).toHaveLength(1);
      expect(await owner.skillRun.count({ where: { chatId: refused.chatId } })).toBe(0);
      expect(capLines(log)).toEqual([
        { license_id: b.licenseId.toString(), meter: 'llm', scope: 'global' },
      ]);
      // B spent nothing and the early check wrote nothing for it.
      expect(await usage(b.licenseId)).toBeNull();
    });
  });

  describe('the mock provider', () => {
    const log = new LineSink();
    let server: TestServer;
    let fx: Fixtures;

    beforeAll(async () => {
      // Caps no call could fit under: the stub must neither meet them nor count.
      server = await startTestServer(
        {
          LOG_LEVEL: 'warn',
          AI_DAILY_LLM_TOKENS_PER_WORKSPACE: '1',
          AI_DAILY_LLM_TOKENS_GLOBAL: '1',
        },
        { logStream: log as unknown as NodeJS.WritableStream },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
      await clearRateLimits(server.app);
      log.lines.length = 0;
    });

    it('answers every AI surface and writes no counter row', async () => {
      const ws = await seedAiWorkspace(owner);
      const asked = await customerAsks(owner, server, ws);
      expect(asked.events.filter((e) => e.authorType === 'bot')).toHaveLength(1);

      expect((await preview(server, ws, await tokenFor(ws))).statusCode).toBe(200);
      const agent = await tokenFor(fixtureWorkspace(fx.a));
      const chatId = await chatIn(server, fx.a, agent);
      expect((await summarise(server, chatId, agent)).statusCode).toBe(201);
      expect((await enhance(server, chatId, agent)).statusCode).toBe(200);

      expect(await owner.aiDailyUsage.count()).toBe(0);
      expect(log.events('ai.cap_reached')).toEqual([]);
    });
  });

  describe('the circuit breaker', () => {
    let server: TestServer;
    const net = fakeOpenAiFetch(openAiCompletion('The model’s own answer.'));

    beforeAll(async () => {
      server = await startTestServer(
        {
          LLM_PROVIDER: 'openai',
          LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
          LLM_MODEL: 'test-model',
          LLM_API_KEY: 'sk-test-only-llm-label',
          AI_DAILY_LLM_TOKENS_PER_WORKSPACE: String(CAP),
        },
        { llmFetch: net.impl },
      );
    });

    afterAll(async () => {
      await server.close();
    });

    beforeEach(async () => {
      await seedFixtures(owner);
      await clearRateLimits(server.app);
      net.calls.length = 0;
    });

    it('is not opened by refusals: after six in one workspace, another workspace’s call reaches the provider', async () => {
      const capped = await seedAiWorkspace(owner);
      const open = await seedAiWorkspace(owner);
      // Past the early check, refused at the reservation — the closest a
      // refusal comes to the provider.
      await seedUsage(capped.licenseId, CAP - MIN);

      for (let i = 0; i < 6; i += 1) {
        const asked = await customerAsks(owner, server, capped);
        expect(asked.events.filter((e) => e.authorType === 'bot')).toEqual([]);
      }
      expect(net.calls).toHaveLength(0);

      const answered = await customerAsks(owner, server, open);
      expect(net.calls).toHaveLength(1);
      expect(answered.events.filter((e) => e.authorType === 'bot').map((e) => e.text)).toEqual([
        'The model’s own answer.',
      ]);
    });
  });

  describe('the table and its functions', () => {
    let app: PrismaClient;
    let fx: Fixtures;

    beforeAll(() => {
      if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
      app = new PrismaClient({ datasourceUrl: APP_URL });
    });

    afterAll(async () => {
      await app.$disconnect();
    });

    beforeEach(async () => {
      fx = await seedFixtures(owner);
    });

    const tenantOf = (t: Fixtures['a']) => ({
      licenseId: t.licenseId,
      organizationId: t.organizationId,
    });

    it('shows a workspace its own row only — never another’s, never the deployment’s', async () => {
      await seedUsage(fx.a.licenseId, 10);
      await seedUsage(fx.b.licenseId, 20);
      await seedUsage(null, 30);

      const seen = await withTenant(app, tenantOf(fx.a), (tx) =>
        tx.aiDailyUsage.findMany({ select: { licenseId: true, used: true } }),
      );
      expect(seen).toEqual([{ licenseId: fx.a.licenseId, used: 10n }]);
      expect(await app.aiDailyUsage.count()).toBe(0);
    });

    it('lets the application role write nothing but through the functions', async () => {
      await expect(
        withTenant(
          app,
          tenantOf(fx.a),
          (tx) =>
            tx.$executeRaw`INSERT INTO ai_daily_usage (id, license_id, day, meter, updated_at)
            VALUES (gen_random_uuid(), ${fx.a.licenseId}, ${today()}, 'llm', now())`,
        ),
      ).rejects.toThrow(/permission denied/);
      await seedUsage(fx.a.licenseId, 10);
      await expect(
        withTenant(app, tenantOf(fx.a), (tx) => tx.$executeRaw`UPDATE ai_daily_usage SET used = 0`),
      ).rejects.toThrow(/permission denied/);
    });

    it('refuses to count without a tenant, and counts only the tenant’s own row with one', async () => {
      await expect(
        app.$queryRaw`SELECT ai_budget_reserve(${today()}, 'llm', ${10n}, ${100n}, ${100n})`,
      ).rejects.toThrow(/needs a tenant context/);

      const scope = await withTenant(
        app,
        tenantOf(fx.a),
        (tx) =>
          tx.$queryRaw<Array<{ scope: string | null }>>`
          SELECT ai_budget_reserve(${today()}, 'llm', ${10n}, ${100n}, ${100n}) AS scope`,
      );
      expect(scope).toEqual([{ scope: null }]);
      expect(await usage(fx.a.licenseId)).toEqual({ reserved: 10, used: 0 });
      expect(await usage(null)).toEqual({ reserved: 10, used: 0 });
      expect(await usage(fx.b.licenseId)).toBeNull();

      // Over the deployment's cap: the workspace's reservation is handed back too.
      const refused = await withTenant(
        app,
        tenantOf(fx.b),
        (tx) =>
          tx.$queryRaw<Array<{ scope: string | null }>>`
          SELECT ai_budget_reserve(${today()}, 'llm', ${95n}, ${100n}, ${100n}) AS scope`,
      );
      expect(refused).toEqual([{ scope: 'global' }]);
      expect(await usage(fx.b.licenseId)).toEqual({ reserved: 0, used: 0 });
      expect(await usage(null)).toEqual({ reserved: 10, used: 0 });
    });

    it('rejects a meter or a day it does not know', async () => {
      for (const [day, meter] of [
        [today(), 'tokens'],
        ['2026-10-02', 'llm'],
      ]) {
        await expect(
          withTenant(
            app,
            tenantOf(fx.a),
            (tx) =>
              tx.$queryRaw`SELECT ai_budget_reserve(${day}, ${meter}, ${1n}, ${100n}, ${100n})`,
          ),
        ).rejects.toThrow(/invalid argument/);
      }
    });
  });
});
