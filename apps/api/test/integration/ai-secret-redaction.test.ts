/**
 * The secret-redaction audit, in one place (tm 255.9 · ADR
 * docs/adr/pilot-llm-embedding-provider.md §10).
 *
 * Each carrier proved its own redaction when it was written (SMTP tm 255.3,
 * chat tm 255.6, embeddings tm 255.7). This suite asks the question once, of
 * the whole server with all three configured at the same time and logging at
 * `trace`: the four provider credentials never reach a log line, and neither
 * does what the customer asked, what the knowledge base said or what the model
 * answered — not in the log and not in telemetry.
 *
 * No request leaves the process: both OpenAI adapters run over `fetch`
 * recorders, and the SMTP carrier is built but never asked to send. The
 * credential values below are labels shaped like the real thing, so a leak of
 * a prefix, a suffix or a base64 form is caught too.
 */
import { InMemoryMetricExporter, AggregationTemporality } from '@opentelemetry/sdk-metrics';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-base';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed } from '@nexa/ai-mock';
import { PROVIDER_SECRET_ENV_KEYS } from '../../src/lib/log-redact.js';
import { embeddingSpace } from '../../src/services/ai/provider/embedding-provider.js';
import { createTelemetry } from '../../src/telemetry/telemetry.js';
import {
  AI_PASSAGE,
  AI_QUESTION,
  LineSink,
  customerAsks,
  runFor,
  seedAiWorkspace,
} from '../helpers/ai-workspace.js';
import {
  fakeOpenAiFetch,
  openAiCompletion,
  openAiEmbeddings,
  openAiProblem,
  type FakeOpenAiFetch,
} from '../helpers/fake-openai.js';
import { ownerClient, seedFixtures, testEnv } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer } from '../helpers/server.js';

const SECRETS = {
  LLM_API_KEY: 'sk-proj-test-only-llm-Zq81Lm4Vt7Rb2Xc9',
  EMBEDDING_API_KEY: 'sk-proj-test-only-emb-Hw35Kd8Np1Qs6Jy0',
  // A mailbox on another domain than SMTP_FROM's, so its tail is not a
  // substring of a value that is allowed in the log.
  SMTP_USERNAME: 'pilot-mailbox-3f9a@mail-7kq2.test',
  SMTP_PASSWORD: 'smtp-test-only-password-Tg72Vb5Nc',
} as const;

/** Every form a careless line could carry a credential in: whole, its ends, base64. */
const SECRET_TRACES = Object.values(SECRETS).flatMap((value) => [
  value,
  value.slice(0, 12),
  value.slice(-8),
  Buffer.from(value).toString('base64'),
]);

const MODEL_ANSWER = 'Delivery takes three to five working days (modelled reply 7340).';
/** The first line of every grounded prompt (`answer-prompt.ts`) — the instructions themselves. */
const PROMPT_OPENING = "You are this business's customer-support assistant";
const CONVERSATION = [AI_QUESTION, AI_PASSAGE, MODEL_ANSWER, PROMPT_OPENING];

const ENV = {
  LOG_LEVEL: 'trace',
  LLM_PROVIDER: 'openai',
  LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
  LLM_MODEL: 'test-model',
  LLM_API_KEY: SECRETS.LLM_API_KEY,
  EMBEDDING_PROVIDER: 'openai',
  EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_API_KEY: SECRETS.EMBEDDING_API_KEY,
  // Built, never asked to send: no mail leaves this suite.
  MAIL_PROVIDER: 'smtp',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: '587',
  SMTP_USERNAME: SECRETS.SMTP_USERNAME,
  SMTP_PASSWORD: SECRETS.SMTP_PASSWORD,
  SMTP_FROM: 'info@nolnk.test',
};

const OPENAI_SPACE = embeddingSpace('openai', 'text-embedding-3-small');

describe('provider secrets and conversation text never reach a log line or a span (tm 255.9)', () => {
  let owner: PrismaClient;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await seedFixtures(owner);
  });

  async function start(nets: { llm: FakeOpenAiFetch; embeddings: FakeOpenAiFetch }) {
    const log = new LineSink();
    const spans = new InMemorySpanExporter();
    const telemetry = createTelemetry({
      serviceName: 'nexa-api-test',
      serviceVersion: '0.0.0-test',
      spanExporter: spans,
      metricExporter: new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE),
    });
    const server = await startTestServer(ENV, {
      llmFetch: nets.llm.impl,
      embeddingFetch: nets.embeddings.impl,
      logStream: log as unknown as NodeJS.WritableStream,
      telemetry,
    });
    await clearRateLimits(server.app);
    const exported = () =>
      JSON.stringify(
        spans.getFinishedSpans().map((span) => ({
          name: span.name,
          attributes: span.attributes,
          events: span.events,
          status: span.status,
        })),
      );
    return { server, log, spans, exported };
  }

  it('names the four credentials the ADR does', () => {
    expect([...PROVIDER_SECRET_ENV_KEYS].sort()).toEqual(Object.keys(SECRETS).sort());
  });

  it('writes neither the question, the passage, the prompt nor the answer to a log line or a span (NFR-S9)', async () => {
    const llm = fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER));
    const embeddings = fakeOpenAiFetch(openAiEmbeddings((text) => embed(text)));
    const { server, log, spans, exported } = await start({ llm, embeddings });
    try {
      const ws = await seedAiWorkspace(owner, { embeddingSpace: OPENAI_SPACE });

      const { chatId, events } = await customerAsks(owner, server, ws);

      // It really ran, end to end, and the log really was listening: the
      // answer went out, and both adapters logged their calls by their cost.
      expect(events.some((e) => e.authorType === 'bot' && e.text === MODEL_ANSWER)).toBe(true);
      expect(llm.calls).toHaveLength(1);
      expect(embeddings.calls).toHaveLength(1);
      expect(log.events('llm.completed')[0]).toMatchObject({ inputTokens: 120, outputTokens: 12 });
      expect(log.events('embedding.completed')[0]).toMatchObject({ inputTokens: 7 });
      expect(log.lines.length).toBeGreaterThan(5);
      expect(spans.getFinishedSpans().length).toBeGreaterThan(0);
      expect(await runFor(owner, chatId)).toMatchObject({ llmInputTokens: 120 });

      for (const text of CONVERSATION) {
        expect(log.text).not.toContain(text);
        expect(exported()).not.toContain(text);
      }
      for (const trace of SECRET_TRACES) {
        expect(log.text).not.toContain(trace);
        expect(exported()).not.toContain(trace);
      }
    } finally {
      await server.close();
    }
  });

  it('keeps both keys and the conversation out of the log when both providers refuse and quote them back', async () => {
    // OpenAI's 401 quotes the key it refused; these quote all of it, and the
    // text they were sent, so a kept `error.message` fails the test.
    const embeddings = fakeOpenAiFetch(
      openAiProblem(401, 'invalid_api_key', {
        message: `Incorrect API key provided: ${SECRETS.EMBEDDING_API_KEY}. Input: ${AI_QUESTION}`,
      }),
      openAiEmbeddings((text) => embed(text)),
    );
    const llm = fakeOpenAiFetch(
      openAiProblem(401, 'invalid_api_key', {
        message: `Incorrect API key provided: ${SECRETS.LLM_API_KEY}. Prompt: ${AI_QUESTION} ${AI_PASSAGE}`,
      }),
    );
    const { server, log, exported } = await start({ llm, embeddings });
    try {
      const ws = await seedAiWorkspace(owner, { embeddingSpace: OPENAI_SPACE });

      const searchRefused = await customerAsks(owner, server, ws);
      const modelRefused = await customerAsks(owner, server, ws);

      // Both handed to a human, each logged by its facts.
      for (const asked of [searchRefused, modelRefused]) {
        expect(asked.events.some((e) => e.authorType === 'bot')).toBe(false);
      }
      expect(log.events('embedding.failed')[0]).toMatchObject({ kind: 'auth', status: 401 });
      expect(log.events('llm.failed')[0]).toMatchObject({ kind: 'auth', status: 401 });

      for (const text of [...CONVERSATION, 'Incorrect API key']) {
        expect(log.text).not.toContain(text);
        expect(exported()).not.toContain(text);
      }
      for (const trace of SECRET_TRACES) {
        expect(log.text).not.toContain(trace);
        expect(exported()).not.toContain(trace);
      }
    } finally {
      await server.close();
    }
  });

  it('censors all four credentials wherever someone logs the configuration or a request', async () => {
    const { server, log } = await start({
      llm: fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER)),
      embeddings: fakeOpenAiFetch(openAiEmbeddings((text) => embed(text))),
    });
    try {
      const env = testEnv(ENV);
      // The parsed values really are the secrets — otherwise a clean log proves nothing.
      expect(env.llm.openai?.apiKey).toBe(SECRETS.LLM_API_KEY);
      expect(env.embedding.openai?.apiKey).toBe(SECRETS.EMBEDDING_API_KEY);
      expect(env.mail.smtp?.password).toBe(SECRETS.SMTP_PASSWORD);

      server.app.log.info({ ...SECRETS }, 'careless: the secrets, spread');
      server.app.log.info({ env }, 'careless: the whole parsed environment');
      server.app.log.info(
        { llm: env.llm, embedding: env.embedding, mail: env.mail },
        'careless: the provider settings',
      );
      server.app.log.info(
        { init: { headers: { authorization: `Bearer ${SECRETS.EMBEDDING_API_KEY}` } } },
        'careless: an outbound request',
      );

      const lines = log.lines.filter((line) => line.includes('careless:'));
      expect(lines).toHaveLength(4);
      for (const line of lines) expect(line).toContain('[redacted]');
      for (const trace of SECRET_TRACES) expect(log.text).not.toContain(trace);
      // Only the credentials go: the hosts and the model are not secrets.
      expect(lines.join('\n')).toContain('https://eu.api.openai.com/v1');
      expect(lines.join('\n')).toContain('test-model');
    } finally {
      await server.close();
    }
  });
});
