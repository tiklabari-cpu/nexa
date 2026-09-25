/**
 * What an AI answer costs, where that is counted, and the per-call ceilings
 * (tm 255.9 · ADR docs/adr/pilot-llm-embedding-provider.md §8–§10).
 *
 * The real server, built from `env` with both OpenAI adapters (chat and
 * embeddings) over injected `fetch` recorders — no request leaves the process,
 * and the keys are labels. What is asked of it, end to end through the widget
 * route, Postgres and Redis:
 *
 *   1. The tokens each answer cost are written on the skill run that made the
 *      calls, and the AI Agent report — which already counted those runs —
 *      sums them. No second counter: `usage_records`, the invoice's table,
 *      gets nothing new, and ADR-09's AI resolution is counted exactly as
 *      before.
 *   2. `LLM_MAX_OUTPUT_TOKENS` reaches the provider; a prompt over
 *      `LLM_MAX_PROMPT_CHARS` does not reach it at all, and a human answers.
 *   3. A transient failure and a permanent one end the same way for the
 *      customer and are told apart in the operator's log.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { embed } from '@siyahtus/ai-mock';
import { embeddingSpace } from '../../src/services/ai/provider/embedding-provider.js';
import {
  AI_PASSAGE,
  AI_QUESTION,
  LineSink,
  customerAsks,
  reportReader,
  runFor,
  seedAiWorkspace,
  type AiWorkspace,
} from '../helpers/ai-workspace.js';
import {
  fakeOpenAiFetch,
  openAiCompletion,
  openAiEmbeddings,
  openAiProblem,
  type FakeOpenAiFetch,
} from '../helpers/fake-openai.js';
import { ownerClient, seedFixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const MODEL_ANSWER = 'Delivery takes three to five working days (modelled reply 5521).';
const OPENAI_SPACE = embeddingSpace('openai', 'text-embedding-3-small');

/**
 * What the fakes bill: `openAiCompletion` reports `prompt_tokens: 120,
 * completion_tokens: 12`; `openAiEmbeddings` reports 7 per input, and a
 * question is one input.
 */
const ANSWER_COST = { llmInputTokens: 120, llmOutputTokens: 12, embeddingTokens: 7 };

const OPENAI_ENV = {
  LOG_LEVEL: 'debug',
  LLM_PROVIDER: 'openai',
  LLM_API_BASE_URL: 'https://eu.api.openai.com/v1',
  LLM_MODEL: 'test-model',
  LLM_API_KEY: 'sk-test-only-llm-label',
  EMBEDDING_PROVIDER: 'openai',
  EMBEDDING_API_BASE_URL: 'https://eu.api.openai.com/v1',
  EMBEDDING_MODEL: 'text-embedding-3-small',
  EMBEDDING_API_KEY: 'sk-test-only-embedding-label',
};

const HANDED_OFF = 'ai model could not answer; the conversation stays with a human';

describe('AI usage and per-call limits through the real server (tm 255.9)', () => {
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

  async function start(
    nets: { llm: FakeOpenAiFetch; embeddings?: FakeOpenAiFetch },
    env: Record<string, string> = {},
  ) {
    const log = new LineSink();
    const embeddings = nets.embeddings ?? fakeOpenAiFetch(openAiEmbeddings((text) => embed(text)));
    const server = await startTestServer(
      { ...OPENAI_ENV, ...env },
      {
        llmFetch: nets.llm.impl,
        embeddingFetch: embeddings.impl,
        logStream: log as unknown as NodeJS.WritableStream,
      },
    );
    await clearRateLimits(server.app);
    return { server, log, embeddings };
  }

  async function aiAgentReport(server: TestServer, token: string) {
    const response = await server.get('/reports/ai-agent', { authorization: `Bearer ${token}` });
    expect(response.statusCode).toBe(200);
    return response.json() as {
      resolutions: number;
      skill_runs: number;
      tokens: { llm_input: number; llm_output: number; embedding_input: number };
    };
  }

  async function usageRecords(ws: AiWorkspace) {
    const rows = await owner.usageRecord.findMany({
      where: { licenseId: ws.licenseId },
      select: { metric: true, quantity: true },
      orderBy: { metric: 'asc' },
    });
    return rows.map((row) => ({ metric: row.metric, quantity: Number(row.quantity) }));
  }

  describe('the cost of an answer is counted on the run the report already counted', () => {
    it('writes each answer’s tokens on its run, sums them in the AI Agent report, and adds nothing to the invoice’s table', async () => {
      const llm = fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER));
      const { server } = await start({ llm });
      try {
        const ws = await seedAiWorkspace(owner, { embeddingSpace: OPENAI_SPACE });
        const reader = await reportReader(owner, ws);
        expect(await aiAgentReport(server, reader)).toMatchObject({
          skill_runs: 0,
          tokens: { llm_input: 0, llm_output: 0, embedding_input: 0 },
        });

        const first = await customerAsks(owner, server, ws);
        const second = await customerAsks(owner, server, ws);

        // Answered by the model, through both real adapters.
        for (const asked of [first, second]) {
          expect(asked.events.filter((e) => e.authorType === 'bot').map((e) => e.text)).toEqual([
            MODEL_ANSWER,
          ]);
          expect(await runFor(owner, asked.chatId)).toMatchObject({
            status: 'succeeded',
            ...ANSWER_COST,
          });
        }

        // The report's counter moved by the runs, and the tokens with them.
        expect(await aiAgentReport(server, reader)).toMatchObject({
          skill_runs: 2,
          tokens: {
            llm_input: 2 * ANSWER_COST.llmInputTokens,
            llm_output: 2 * ANSWER_COST.llmOutputTokens,
            embedding_input: 2 * ANSWER_COST.embeddingTokens,
          },
        });

        // No parallel counter: the invoice's table holds nothing yet — not a
        // token metric, and no resolution while both chats are open.
        expect(await usageRecords(ws)).toEqual([]);

        // ADR-09 counts exactly as it did: closing a chat the AI answered alone
        // is one AI resolution, and the token totals do not move.
        const closed = await server.post('/customer/chat/close', undefined, {
          authorization: `Bearer ${first.customerToken}`,
        });
        expect(closed.statusCode).toBe(204);
        expect(await usageRecords(ws)).toEqual([{ metric: 'ai_resolutions', quantity: 1 }]);
        expect(await aiAgentReport(server, reader)).toMatchObject({
          resolutions: 1,
          skill_runs: 2,
          tokens: {
            llm_input: 2 * ANSWER_COST.llmInputTokens,
            llm_output: 2 * ANSWER_COST.llmOutputTokens,
            embedding_input: 2 * ANSWER_COST.embeddingTokens,
          },
        });
      } finally {
        await server.close();
      }
    });

    it('keeps one workspace’s tokens out of another’s report', async () => {
      const { server } = await start({ llm: fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER)) });
      try {
        const busy = await seedAiWorkspace(owner, { embeddingSpace: OPENAI_SPACE });
        const quiet = await seedAiWorkspace(owner, { embeddingSpace: OPENAI_SPACE });

        await customerAsks(owner, server, busy);

        expect(await aiAgentReport(server, await reportReader(owner, busy))).toMatchObject({
          skill_runs: 1,
          tokens: { llm_input: 120, llm_output: 12, embedding_input: 7 },
        });
        expect(await aiAgentReport(server, await reportReader(owner, quiet))).toMatchObject({
          skill_runs: 0,
          tokens: { llm_input: 0, llm_output: 0, embedding_input: 0 },
        });
      } finally {
        await server.close();
      }
    });
  });

  describe('the per-call ceilings', () => {
    it('sends LLM_MAX_OUTPUT_TOKENS to the provider as max_completion_tokens', async () => {
      const llm = fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER));
      const { server } = await start({ llm }, { LLM_MAX_OUTPUT_TOKENS: '123' });
      try {
        const ws = await seedAiWorkspace(owner, { embeddingSpace: OPENAI_SPACE });

        await customerAsks(owner, server, ws);

        expect(llm.calls).toHaveLength(1);
        const body = JSON.parse(String(llm.calls[0]!.init.body)) as {
          max_completion_tokens: number;
        };
        expect(body.max_completion_tokens).toBe(123);
      } finally {
        await server.close();
      }
    });

    it('never sends a prompt over LLM_MAX_PROMPT_CHARS: no request, no tokens, a human answers (FR-05-06.EK1)', async () => {
      const llm = fakeOpenAiFetch(openAiCompletion(MODEL_ANSWER));
      const { server, log, embeddings } = await start({ llm }, { LLM_MAX_PROMPT_CHARS: '2000' });
      try {
        const ws = await seedAiWorkspace(owner, { embeddingSpace: OPENAI_SPACE });
        // The question, many times over: the same words, so retrieval still
        // finds the passage, and a prompt well over 2,000 characters.
        const longQuestion = Array.from({ length: 45 }, () => AI_QUESTION).join(' ');

        const { chatId, events } = await customerAsks(owner, server, ws, longQuestion);

        // The provider was never reached — the count is the proof.
        expect(llm.calls).toHaveLength(0);
        expect(embeddings.calls).toHaveLength(1);
        // The customer's message is stored and waits for a human.
        expect(events.map((e) => [e.authorType, e.text])).toEqual([['customer', longQuestion]]);
        const chat = await owner.chat.findUnique({
          where: { id: chatId },
          select: { active: true },
        });
        expect(chat?.active).toBe(true);

        const run = await runFor(owner, chatId);
        expect(run).toMatchObject({
          status: 'failed',
          llmInputTokens: 0,
          llmOutputTokens: 0,
          embeddingTokens: ANSWER_COST.embeddingTokens,
        });
        expect(run.log.outcome).toBe('handed_off');
        expect(run.log.entries.find((e) => e.step === 'send_message')?.detail).toBe(
          'the model could not answer (prompt_too_long) — handed to a human',
        );

        const [line] = log.withMessage(HANDED_OFF);
        expect(line).toMatchObject({
          chat_id: chatId,
          provider: 'llm',
          kind: 'prompt_too_long',
          transient: false,
        });
        expect(String(line!['reason'])).toMatch(/^\d+\/2000$/);
        expect(Number(String(line!['reason']).split('/')[0])).toBeGreaterThan(2000);
        expect(log.events('llm.attempt')).toHaveLength(0);
        expect(log.text).not.toContain(AI_QUESTION);
        expect(log.text).not.toContain(AI_PASSAGE);
      } finally {
        await server.close();
      }
    });
  });

  describe('a transient and a permanent failure end the same way (FR-05-06.EK1)', () => {
    it('hands both to a human, and the log tells them apart by the provider’s status and code', async () => {
      // A 503 first, then a refused key. `LLM_TIMEOUT_MS=1000` leaves no room
      // for a retry (every wait is at least 500 ms, and an attempt needs a
      // second), so the transient failure ends its call as the permanent one does.
      const llm = fakeOpenAiFetch(
        openAiProblem(503, 'server_is_overloaded', { type: 'service_unavailable_error' }),
        openAiProblem(401, 'invalid_api_key', { type: 'invalid_request_error' }),
      );
      const { server, log } = await start({ llm }, { LLM_TIMEOUT_MS: '1000' });
      try {
        const ws = await seedAiWorkspace(owner, { embeddingSpace: OPENAI_SPACE });

        const outage = await customerAsks(owner, server, ws);
        const refused = await customerAsks(owner, server, ws);
        expect(llm.calls).toHaveLength(2);

        // The customer's side: identical — stored message, no AI message, the
        // chat open for a human, a failed run whose outcome is the hand-off.
        const productSide = async (asked: typeof outage) => {
          const run = await runFor(owner, asked.chatId);
          const chat = await owner.chat.findUnique({
            where: { id: asked.chatId },
            select: { active: true },
          });
          return {
            authors: asked.events.map((e) => e.authorType),
            active: chat?.active,
            status: run.status,
            outcome: run.log.outcome,
            steps: run.log.entries.map((e) => [e.step, e.ok]),
          };
        };
        expect(await productSide(outage)).toEqual(await productSide(refused));
        expect(await productSide(outage)).toMatchObject({
          authors: ['customer'],
          active: true,
          status: 'failed',
          outcome: 'handed_off',
        });

        // The operator's side: one line per chat, and they differ exactly where
        // the failures do.
        const lines = log.withMessage(HANDED_OFF);
        expect(lines).toHaveLength(2);
        expect(lines.find((line) => line['chat_id'] === outage.chatId)).toMatchObject({
          provider: 'llm',
          kind: 'unavailable',
          transient: true,
          status: 503,
          code: 'server_is_overloaded',
          provider_request_id: 'req_abc123',
        });
        expect(lines.find((line) => line['chat_id'] === refused.chatId)).toMatchObject({
          provider: 'llm',
          kind: 'auth',
          transient: false,
          status: 401,
          code: 'invalid_api_key',
          provider_request_id: 'req_abc123',
        });
        expect(log.events('llm.failed').map((line) => [line['kind'], line['transient']])).toEqual([
          ['unavailable', true],
          ['auth', false],
        ]);
      } finally {
        await server.close();
      }
    });
  });
});
