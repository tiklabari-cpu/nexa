/**
 * The OpenAI chat adapter, built by the real server from `env` (tm 255.6).
 *
 * `LLM_PROVIDER=openai` with its keys, and `buildServer({ llmFetch })` in place
 * of the network: the server constructs the real adapter — its logger, its
 * redaction, its circuit breaker — and every request it makes lands in a
 * recorder. No request leaves the process; `KEY` is a label, not a credential.
 *
 * What is asked of it, end to end through the widget route, Postgres and Redis:
 *
 *   1. A customer's question is answered with the model's text, and the model
 *      was sent exactly what ADR §10 allows.
 *   2. A model that fails leaves the conversation with a human — no AI message,
 *      a failed run whose outcome is `handed_off` — and neither the key nor the
 *      conversation reaches a log line or a span.
 *   3. After enough failures the circuit opens and the provider is not called
 *      at all.
 *   4. The residency gate still stands in front of the adapter (NFR-C4): a
 *      covered workspace on an out-of-region provider costs zero requests.
 */
import { InMemoryMetricExporter, AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed, toVectorLiteral } from '@nexa/ai-mock';
import { createTelemetry } from '../../src/telemetry/telemetry.js';
import { LLM_CIRCUIT_FAILURE_THRESHOLD } from '../../src/services/ai/provider/openai-llm-provider.js';
import {
  fakeOpenAiFetch,
  openAiCompletion,
  openAiProblem,
  type FakeOpenAiFetch,
} from '../helpers/fake-openai.js';
import { grantToken, ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const KEY = 'sk-test-only-not-a-credential-Hx4Tn8Qw2Pz6';
/** The ends OpenAI's 401 quotes, and the forms a careless log might use. */
const KEY_TRACES = [KEY, KEY.slice(0, 12), KEY.slice(-8), Buffer.from(KEY).toString('base64')];

const PASSAGE = 'Standard delivery takes 3 to 5 working days across the EU, tracked by Q7-courier.';
const QUESTION = 'How long does delivery take for parcel QX-44917?';
const MODEL_ANSWER = 'Delivery takes three to five working days (modelled reply 8812).';
const ENDPOINT = 'https://eu.api.openai.com/v1/chat/completions';

const OPENAI_ENV = {
  LOG_LEVEL: 'debug',
  LLM_PROVIDER: 'openai',
  LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
  LLM_MODEL: 'test-model',
  LLM_API_KEY: KEY,
};

/** A real provider configured for Europe on a US deployment — the refusing shape (NFR-C4). */
const OUT_OF_REGION_ENV = { ...OPENAI_ENV, NEXA_REGION: 'us', LLM_PROVIDER_REGION: 'eu' };

/** Every line the server wrote, so a test can say what never appeared. */
class LineSink {
  readonly lines: string[] = [];
  write(chunk: string): boolean {
    this.lines.push(chunk);
    return true;
  }
  end(): void {}
  on(): void {}
  once(): void {}
  emit(): boolean {
    return false;
  }
  get text(): string {
    return this.lines.join('\n');
  }
  events(name: string): Array<Record<string, unknown>> {
    return this.lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry['event'] === name);
  }
}

describe('OpenAI chat adapter through the real server (tm 255.6)', () => {
  let owner: PrismaClient;
  let seq = 0;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  /** A workspace with an AI agent, one knowledge passage and an active knowledge skill. */
  async function seedWorkspace(options: { region?: 'eu' | 'us'; baaSigned?: boolean } = {}) {
    seq += 1;
    const slug = `oai${seq}-${Date.now()}`;
    const organization = await owner.organization.create({
      data: { name: `Org ${slug}`, region: options.region ?? 'eu' },
      select: { id: true },
    });
    const license = await owner.license.create({
      data: {
        organizationId: organization.id,
        plan: 'growth',
        status: 'active',
        ...(options.baaSigned ? { hipaaBaaSignedAt: new Date() } : {}),
      },
      select: { id: true },
    });
    const ownerAccount = await owner.account.create({
      data: { email: `owner-${slug}@example.test`, name: `Owner ${slug}` },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: license.id, agentId: ownerAccount.id, role: 'owner' },
    });
    const trustedDomain = `shop-${slug}.example.test`;
    await owner.trustedDomain.create({
      data: {
        organizationId: organization.id,
        licenseId: license.id,
        domain: trustedDomain,
        includeSubdomains: true,
      },
    });
    const aiAgent = await owner.aiAgent.create({
      data: {
        licenseId: license.id,
        kind: 'ai_agent',
        name: 'Ada',
        active: true,
        tone: 'formal',
        languages: ['en'],
      },
      select: { id: true },
    });
    const source = await owner.knowledgeSource.create({
      data: {
        aiAgentId: aiAgent.id,
        licenseId: license.id,
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
      license.id.toString(),
      PASSAGE,
      toVectorLiteral(embed(PASSAGE)),
    );
    const skill = await owner.skill.create({
      data: {
        licenseId: license.id,
        aiAgentId: aiAgent.id,
        name: 'Delivery',
        kind: 'ai_agent',
        steps: [
          { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
          { type: 'send_message', source: 'knowledge' },
        ],
        active: true,
        updatedAt: new Date(),
      },
      select: { id: true },
    });
    const token = await grantToken(owner, {
      licenseId: license.id,
      organizationId: organization.id,
      ownerId: ownerAccount.id,
      scopes: ['agents-bot--all:rw', 'agents-bot--all:ro', 'chats--all:rw'],
    });
    return {
      organizationId: organization.id,
      licenseId: license.id,
      trustedDomain,
      aiAgentId: aiAgent.id,
      skillId: skill.id,
      token,
    };
  }

  type Workspace = Awaited<ReturnType<typeof seedWorkspace>>;

  /** A visitor writes in through the widget; returns the chat and its stored events. */
  async function customerAsks(server: TestServer, ws: Workspace, text = QUESTION) {
    const minted = await server.post(
      '/customer/token',
      { organization_id: ws.organizationId },
      { origin: `https://${ws.trustedDomain}` },
    );
    expect(minted.statusCode).toBe(200);
    const { token } = minted.json() as { token: string };
    const sent = await server.post(
      '/customer/chat/events',
      { text },
      { authorization: `Bearer ${token}` },
    );
    expect(sent.statusCode).toBe(201);
    const chatId = (sent.json() as { chat_id: string }).chat_id;
    const events = await owner.event.findMany({
      where: { chatId },
      orderBy: { createdAt: 'asc' },
      select: { text: true, authorType: true },
    });
    return { chatId, events };
  }

  async function lastRun(ws: Workspace) {
    const run = await owner.skillRun.findFirst({
      where: { skillId: ws.skillId },
      orderBy: { ranAt: 'desc' },
    });
    return run as unknown as {
      status: string;
      log: { outcome: string; entries: Array<{ step: string; detail: string; ok: boolean }> };
    } | null;
  }

  async function start(
    net: FakeOpenAiFetch,
    env: Record<string, string> = OPENAI_ENV,
    extra: { telemetry?: ReturnType<typeof createTelemetry> } = {},
  ) {
    const log = new LineSink();
    const server = await startTestServer(env, {
      llmFetch: net.impl,
      logStream: log as unknown as NodeJS.WritableStream,
      ...extra,
    });
    await clearRateLimits(server.app);
    return { server, log };
  }

  beforeEach(async () => {
    await seedFixtures(owner);
  });

  describe('a question answered by the model (FR-05-06.EK1)', () => {
    it('sends the customer the model text, having sent the model only model, messages and max_completion_tokens (FR-MOD-06.4)', async () => {
      const net = fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER));
      const { server, log } = await start(net);
      try {
        const ws = await seedWorkspace();

        const { events } = await customerAsks(server, ws);

        expect(events.filter((e) => e.authorType === 'bot').map((e) => e.text)).toEqual([
          MODEL_ANSWER,
        ]);
        expect(net.calls).toHaveLength(1);
        const { url, init } = net.calls[0]!;
        expect(url).toBe(ENDPOINT);
        expect((init.headers as Record<string, string>)['authorization']).toBe(`Bearer ${KEY}`);
        const body = JSON.parse(String(init.body)) as {
          model: string;
          max_completion_tokens: number;
          messages: Array<{ role: string; content: string }>;
        };
        expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model']);
        expect(body.model).toBe('test-model');
        expect(body.max_completion_tokens).toBe(400);
        expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
        expect(body.messages[0]!.content).toContain(PASSAGE);
        expect(body.messages[0]!.content).toContain('Tone: formal.');
        expect(body.messages[1]!.content).toBe(QUESTION);

        const run = await lastRun(ws);
        expect(run?.status).toBe('succeeded');
        expect(run?.log.outcome).toBe('answered');

        // Logged by its cost, never by what was said.
        expect(log.events('llm.completed')).toHaveLength(1);
        expect(log.events('llm.completed')[0]).toMatchObject({
          component: 'llm',
          model: 'test-model',
          inputTokens: 120,
          outputTokens: 12,
        });
        for (const trace of [...KEY_TRACES, PASSAGE, QUESTION, MODEL_ANSWER]) {
          expect(log.text).not.toContain(trace);
        }
      } finally {
        await server.close();
      }
    });

    it('rides out a transient 503 with a retry', async () => {
      const net = fakeOpenAiFetch(
        openAiProblem(503, 'server_is_overloaded', { type: 'service_unavailable_error' }),
        openAiCompletion(MODEL_ANSWER),
      );
      const { server, log } = await start(net);
      try {
        const ws = await seedWorkspace();

        const { events } = await customerAsks(server, ws);

        expect(net.calls).toHaveLength(2);
        expect(events.some((e) => e.authorType === 'bot' && e.text === MODEL_ANSWER)).toBe(true);
        expect(log.events('llm.retry')[0]).toMatchObject({
          kind: 'unavailable',
          status: 503,
          code: 'server_is_overloaded',
        });
      } finally {
        await server.close();
      }
    });
  });

  describe('a model that fails leaves the conversation with a human (FR-05-06.EK1)', () => {
    it('sends no AI message, records the hand-off, and writes neither the key nor the conversation anywhere', async () => {
      // OpenAI's 401 quotes the key it refused; this one quotes all of it, and
      // the prompt too, so the test fails if any part of the body is kept.
      const net = fakeOpenAiFetch(
        openAiProblem(401, 'invalid_api_key', {
          type: 'invalid_request_error',
          message: `Incorrect API key provided: ${KEY}. Prompt: ${QUESTION} ${PASSAGE}`,
        }),
      );
      const spans = new InMemorySpanExporter();
      const telemetry = createTelemetry({
        serviceName: 'nexa-api-test',
        serviceVersion: '0.0.0-test',
        spanExporter: spans,
        metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
      });
      const { server, log } = await start(net, OPENAI_ENV, { telemetry });
      try {
        const ws = await seedWorkspace();

        const { chatId, events } = await customerAsks(server, ws);

        // Stored before the AI ran, and nothing from the AI after it.
        expect(events.map((e) => [e.authorType, e.text])).toContainEqual(['customer', QUESTION]);
        expect(events.some((e) => e.authorType === 'bot')).toBe(false);
        const chat = await owner.chat.findUnique({
          where: { id: chatId },
          select: { active: true },
        });
        expect(chat?.active).toBe(true);
        expect(net.calls).toHaveLength(1);

        const run = await lastRun(ws);
        expect(run?.status).toBe('failed');
        expect(run?.log.outcome).toBe('handed_off');
        expect(run?.log.entries.find((e) => e.step === 'send_message')).toEqual({
          step: 'send_message',
          detail: 'the model could not answer (auth) — handed to a human',
          ok: false,
        });

        // The operator gets the facts: kind, status, the provider's code, the
        // chat it concerned.
        expect(log.events('llm.failed')[0]).toMatchObject({
          component: 'llm',
          kind: 'auth',
          status: 401,
          code: 'invalid_api_key',
          requestId: 'req_abc123',
        });
        expect(log.text).toContain(
          'ai model could not answer; the conversation stays with a human',
        );
        expect(log.text).toContain(chatId);

        // …and nothing else. Not in a log line:
        for (const trace of [...KEY_TRACES, PASSAGE, QUESTION, 'Incorrect API key']) {
          expect(log.text).not.toContain(trace);
        }
        // …not in the run log an admin reads:
        const runLog = JSON.stringify(run?.log);
        for (const trace of [...KEY_TRACES, 'Incorrect API key']) {
          expect(runLog).not.toContain(trace);
        }
        // …and not in telemetry.
        const exported = JSON.stringify(
          spans.getFinishedSpans().map((span) => ({
            name: span.name,
            attributes: span.attributes,
            events: span.events,
            status: span.status,
          })),
        );
        expect(spans.getFinishedSpans().length).toBeGreaterThan(0);
        for (const trace of KEY_TRACES) expect(exported).not.toContain(trace);
      } finally {
        await server.close();
      }
    });

    it('redacts the key wherever someone logs the configuration (log-redact paths)', async () => {
      const { server, log } = await start(fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER)));
      try {
        server.app.log.info(
          {
            env: { LLM_API_KEY: KEY },
            llm: { openai: { apiKey: KEY, baseUrl: 'https://eu.api.openai.com/v1' } },
          },
          'configuration dump',
        );
        server.app.log.info({ init: { headers: { authorization: `Bearer ${KEY}` } } }, 'request');

        const lines = log.lines.filter((line) => /configuration dump|"msg":"request"/.test(line));
        expect(lines).toHaveLength(2);
        for (const line of lines) {
          expect(line).toContain('[redacted]');
          expect(line).not.toContain(KEY);
        }
        // Only the secret goes: the base URL is not one.
        expect(lines[0]).toContain('https://eu.api.openai.com/v1');
      } finally {
        await server.close();
      }
    });

    it(`opens the circuit after ${LLM_CIRCUIT_FAILURE_THRESHOLD} failed calls, and then no request is made`, async () => {
      const net = fakeOpenAiFetch(openAiProblem(401, 'invalid_api_key'));
      const { server, log } = await start(net);
      try {
        const ws = await seedWorkspace();

        for (let i = 0; i < LLM_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
          await customerAsks(server, ws);
        }
        expect(net.calls).toHaveLength(LLM_CIRCUIT_FAILURE_THRESHOLD);
        expect(log.events('llm.circuit_opened')).toHaveLength(1);

        const { events } = await customerAsks(server, ws);

        // The count is the proof: the open circuit never reached the provider.
        expect(net.calls).toHaveLength(LLM_CIRCUIT_FAILURE_THRESHOLD);
        expect(events.some((e) => e.authorType === 'bot')).toBe(false);
        const run = await lastRun(ws);
        expect(run?.log.outcome).toBe('handed_off');
        expect(run?.log.entries.find((e) => e.step === 'send_message')?.detail).toBe(
          'the model could not answer (circuit_open) — handed to a human',
        );
      } finally {
        await server.close();
      }
    });
  });

  describe('the residency gate stands in front of the real adapter (NFR-C4)', () => {
    it('makes no request at all for a covered workspace on an out-of-region provider', async () => {
      const net = fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER));
      const { server } = await start(net, OUT_OF_REGION_ENV);
      try {
        const covered = await seedWorkspace({ region: 'us', baaSigned: true });

        const refused = await server.post(
          '/skills/preview',
          {
            steps: [{ type: 'send_message', source: 'knowledge' }],
            message: QUESTION,
            ai_agent_id: covered.aiAgentId,
          },
          { authorization: `Bearer ${covered.token}` },
        );
        expect(refused.statusCode).toBe(403);
        const { events } = await customerAsks(server, covered);
        expect(events.some((e) => e.authorType === 'bot')).toBe(false);

        expect(net.calls).toHaveLength(0);

        // The pair that makes the refusal mean "covered", not "broken".
        const plain = await seedWorkspace({ region: 'us', baaSigned: false });
        const answered = await customerAsks(server, plain);
        expect(net.calls).toHaveLength(1);
        expect(answered.events.some((e) => e.authorType === 'bot' && e.text === MODEL_ANSWER)).toBe(
          true,
        );
      } finally {
        await server.close();
      }
    });
  });
});
