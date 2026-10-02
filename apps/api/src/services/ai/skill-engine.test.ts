/**
 * The skill engine when the model cannot answer (tm 255.6).
 *
 * The real OpenAI adapter over an injected `fetch` — no network, no key — and
 * the engine over an in-memory stand-in for the two tables it touches, so each
 * failure class can be driven exactly and asserted on its own. Through the real
 * server and database the same path is covered by
 * `test/integration/llm-openai-adapter.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import {
  fakeOpenAiFetch,
  hangingRequest,
  openAiCompletion,
  openAiJson,
  openAiProblem,
  refusedConnection,
  type FakeOpenAiFetch,
} from '../../../test/helpers/fake-openai.js';
import { FakeLlmProvider } from '../../../test/helpers/fake-llm-provider.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import {
  RETRIEVAL_THRESHOLD,
  type KnowledgeSearch,
  type KnowledgeService,
  type RetrievedChunk,
} from './knowledge-service.js';
import { EMBEDDING_FAILURE_KINDS, EmbeddingProviderError } from './provider/embedding-error.js';
import { LLM_FAILURE_KINDS, type LlmFailureKind } from './provider/llm-error.js';
import { buildAnswerPrompt } from './provider/answer-prompt.js';
import { promptLength, type LlmProvider } from './provider/llm-provider.js';
import { MockLlmProvider } from './provider/mock-llm-provider.js';
import { AiDailyCapError, type AiDailyBudget } from './ai-daily-budget.js';
import { MeteredLlm } from './metered-llm.js';
import { OpenAiLlmProvider } from './provider/openai-llm-provider.js';
import { SkillEngine, type SkillRunLogEntry, type TenantRunner } from './skill-engine.js';

const TENANT: TenantContext = { licenseId: 1n, organizationId: 'org-test' };
const PASSAGE = 'Standard delivery takes 3 to 5 working days across the EU.';
const MESSAGE = 'How long does delivery take?';
const ANSWER = 'Delivery takes three to five working days.';
/** What a provider's error message may say — none of it may reach the run log. */
const PROVIDER_WORDS = 'Incorrect API key provided: sk-test-only-leak';

const KNOWLEDGE_ANSWER = [
  { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
  { type: 'send_message', source: 'knowledge' },
];

interface RecordedRun {
  status: string;
  log: { outcome: string; entries: SkillRunLogEntry[] };
  llmInputTokens: number;
  llmOutputTokens: number;
  embeddingTokens: number;
}

/** The two tables a run reads and writes, in memory, with one active skill. */
function workspace(steps: unknown[]) {
  const runs: RecordedRun[] = [];
  const tx = {
    skill: {
      findMany: async () => [
        {
          id: 'skill-1',
          name: 'Delivery',
          steps,
          aiAgentId: 'agent-1',
          aiAgent: { tone: null, languages: [], persona: null },
        },
      ],
      update: async () => ({}),
    },
    skillRun: {
      create: async ({ data }: { data: RecordedRun }) => {
        runs.push(data);
        return data;
      },
    },
  };
  const db: TenantRunner = (fn) => fn(tx as unknown as TenantClient);
  return { db, runs };
}

const HIT: RetrievedChunk = {
  id: 'chunk-1',
  sourceId: 'source-1',
  sourceName: 'Delivery',
  text: PASSAGE,
  score: 0.91,
};

/**
 * Stands in for the knowledge service's two phases: the question is embedded
 * (no transaction), then searched (inside one). `chunksInScope` is what the
 * search counted in the question's space.
 */
function knowledgeWith(
  embedQuery: KnowledgeService['embedQuery'],
  {
    chunks = [HIT],
    chunksInScope = chunks.length,
    threshold = RETRIEVAL_THRESHOLD,
  }: { chunks?: RetrievedChunk[]; chunksInScope?: number; threshold?: number } = {},
): KnowledgeService {
  return {
    threshold,
    embedQuery,
    search: async (): Promise<KnowledgeSearch> => ({ strategy: 'exact', chunksInScope, chunks }),
  } as unknown as KnowledgeService;
}

/** What the stand-in question embedding says it cost — distinct from every chat figure below. */
const QUESTION_TOKENS = 7;

const knowledge = knowledgeWith(async () => ({
  space: 'test:space',
  vector: '[1]',
  usage: { inputTokens: QUESTION_TOKENS },
}));

const quiet = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function openai(net: FakeOpenAiFetch, circuit?: { failureThreshold: number }): OpenAiLlmProvider {
  return new OpenAiLlmProvider(
    { baseUrl: 'https://eu.api.openai.com/v1', model: 'test-model', apiKey: 'sk-test-only' },
    { fetchImpl: net.impl, logger: quiet, sleep: async () => {}, ...(circuit ? { circuit } : {}) },
  );
}

/** `LLM_MAX_PROMPT_CHARS`' default — every prompt these tests build fits under it. */
const MAX_PROMPT_CHARS = 16_000;

function engine(
  llm: LlmProvider,
  timeoutMs = 20_000,
  knowledgeService: KnowledgeService = knowledge,
  maxPromptChars = MAX_PROMPT_CHARS,
): SkillEngine {
  return new SkillEngine({
    llm,
    maxOutputTokens: 400,
    timeoutMs,
    maxPromptChars,
    knowledge: knowledgeService,
  });
}

const problem = (status: number, code: string) =>
  openAiProblem(status, code, { message: PROVIDER_WORDS });

/**
 * One way to make each kind of failure happen. The list is checked against
 * `LLM_FAILURE_KINDS` below, so a kind added later cannot go without a test that
 * it still ends with a human.
 */
const FAILURES: Array<{
  kind: LlmFailureKind;
  llm: () => Promise<{ provider: LlmProvider; net: FakeOpenAiFetch }>;
  timeoutMs?: number;
  maxPromptChars?: number;
  /** Refused in this process, so no request may reach the provider. */
  refused?: boolean;
}> = [
  { kind: 'timeout', timeoutMs: 50, llm: () => viaOpenAi(fakeOpenAiFetch(hangingRequest)) },
  { kind: 'network', llm: () => viaOpenAi(fakeOpenAiFetch(refusedConnection('ECONNRESET'))) },
  {
    kind: 'rate_limited',
    llm: () => viaOpenAi(fakeOpenAiFetch(problem(429, 'rate_limit_exceeded'))),
  },
  {
    kind: 'unavailable',
    llm: () => viaOpenAi(fakeOpenAiFetch(problem(503, 'server_is_overloaded'))),
  },
  {
    kind: 'quota_exhausted',
    llm: () => viaOpenAi(fakeOpenAiFetch(problem(429, 'credit_balance_exhausted'))),
  },
  { kind: 'auth', llm: () => viaOpenAi(fakeOpenAiFetch(problem(401, 'invalid_api_key'))) },
  {
    kind: 'forbidden',
    llm: () => viaOpenAi(fakeOpenAiFetch(problem(403, 'unsupported_country_region_territory'))),
  },
  { kind: 'not_found', llm: () => viaOpenAi(fakeOpenAiFetch(problem(404, 'model_not_found'))) },
  { kind: 'bad_request', llm: () => viaOpenAi(fakeOpenAiFetch(problem(400, 'invalid_value'))) },
  {
    kind: 'bad_response',
    llm: () => viaOpenAi(fakeOpenAiFetch(() => new Response('<html>502</html>', { status: 200 }))),
  },
  {
    kind: 'no_answer',
    llm: () =>
      viaOpenAi(fakeOpenAiFetch(openAiCompletion('Delivery takes', { finish_reason: 'length' }))),
  },
  {
    kind: 'circuit_open',
    llm: async () => {
      // A circuit already open: one failure at a threshold of one.
      const net = fakeOpenAiFetch(problem(401, 'invalid_api_key'));
      const provider = openai(net, { failureThreshold: 1 });
      await provider
        .complete({ system: 's', messages: [], maxOutputTokens: 1, timeoutMs: 1_000 })
        .catch(() => undefined);
      return { provider, net };
    },
    refused: true,
  },
  {
    // A provider that would answer, behind a ceiling the prompt is over: the
    // test fails with `answered` if the ceiling is not what stops it (tm 255.9).
    kind: 'prompt_too_long',
    maxPromptChars: 2_000,
    llm: () => viaOpenAi(fakeOpenAiFetch(openAiCompletion(ANSWER))),
    refused: true,
  },
];

async function viaOpenAi(net: FakeOpenAiFetch) {
  return { provider: openai(net), net };
}

describe('a model that cannot answer hands the conversation to a human (FR-05-06.EK1)', () => {
  it('covers every failure kind', () => {
    expect(FAILURES.map((failure) => failure.kind).sort()).toEqual([...LLM_FAILURE_KINDS].sort());
  });

  it.each(FAILURES)('$kind', async ({ kind, llm, timeoutMs, maxPromptChars, refused }) => {
    const { provider, net } = await llm();
    const before = net.calls.length;
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);
    // Long enough to cross a 2,000-character ceiling with the instructions, well
    // under the default one; the other kinds are asked the usual question.
    const message = maxPromptChars
      ? `${MESSAGE} ${'Please check parcel QX-44917. '.repeat(60)}`
      : MESSAGE;

    const result = await engine(provider, timeoutMs, knowledge, maxPromptChars).run(db, TENANT, {
      message,
      chatId: 'chat-1',
    });

    expect(result.outcome).toBe('handed_off');
    expect(result.failure).toMatchObject({ provider: 'llm', kind });
    expect(result.reply).toBeNull();
    expect(result.transferTo).toBeNull();

    const sent = result.log.find((entry) => entry.step === 'send_message');
    expect(sent).toEqual({
      step: 'send_message',
      detail: `the model could not answer (${kind}) — handed to a human`,
      ok: false,
    });
    expect(JSON.stringify(result.log)).not.toContain('Incorrect API key');

    // Recorded as a failed run whose outcome is the hand-off.
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.log.outcome).toBe('handed_off');

    if (refused) expect(net.calls.length).toBe(before);
  });

  it('answers normally when the model does', async () => {
    const net = fakeOpenAiFetch(openAiCompletion(ANSWER));
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    const result = await engine(openai(net)).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(result).toMatchObject({ outcome: 'answered', reply: ANSWER, failure: null });
    expect(runs[0]!.status).toBe('succeeded');
    expect(result.log.find((entry) => entry.step === 'send_message')?.detail).toContain(
      'written by openai',
    );
  });
});

describe('after a failure the AI stops talking; the steps for the human still run (FR-05-06.EK1)', () => {
  const STEPS = [
    { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
    // Would ask for the order number — queued before the model is called.
    { type: 'request_info', field: 'order number', prompt: 'What is your order number?' },
    { type: 'send_message', source: 'knowledge' },
    { type: 'send_message', source: 'text', text: 'Anything else I can help with?' },
    { type: 'tag', tag: 'delivery' },
    { type: 'summarize' },
    { type: 'transfer_to_team', group: 'Logistics' },
  ];

  it('withdraws the queued question, skips what it would say next, and still tags, summarises and transfers', async () => {
    const net = fakeOpenAiFetch(problem(401, 'invalid_api_key'));
    const { db } = workspace(STEPS);

    const result = await engine(openai(net)).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(result.outcome).toBe('handed_off');
    expect(result.failure).toMatchObject({ provider: 'llm', kind: 'auth' });
    expect(result.reply).toBeNull();
    expect(result.tags).toEqual(['delivery']);
    expect(result.summary).toMatch(/^Customer asked: How long does delivery take\?/);
    expect(result.transferTo).toBe('Logistics');
    expect(result.log.map((entry) => [entry.step, entry.ok])).toEqual([
      ['detect_intent', true],
      ['request_info', true],
      ['send_message', false],
      ['send_message', true],
      ['tag', true],
      ['summarize', true],
      ['transfer_to_team', true],
    ]);
    expect(result.log[3]!.detail).toBe('skipped — the model could not answer, a human replies');
  });

  it('leaves the same skill untouched when the model answers', async () => {
    const net = fakeOpenAiFetch(openAiCompletion(ANSWER));
    const { db } = workspace(STEPS);

    const result = await engine(openai(net)).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    // The fixed text after the answer is the last reply, exactly as before.
    expect(result).toMatchObject({
      outcome: 'handed_off',
      failure: null,
      reply: 'Anything else I can help with?',
      transferTo: 'Logistics',
    });
  });
});

describe('what the hand-off does not swallow', () => {
  it('lets a defect propagate rather than filing it as a provider failure', async () => {
    // The stub refuses a prompt it was not built for with a plain Error — a
    // programming error, which the responder logs with its stack.
    const broken: LlmProvider = {
      id: 'mock',
      complete: async () => {
        throw new Error('not a provider failure');
      },
    };
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    await expect(engine(broken).run(db, TENANT, { message: MESSAGE, chatId: 'c' })).rejects.toThrow(
      'not a provider failure',
    );
    expect(runs).toHaveLength(0);
  });

  it('keeps the stub answering exactly as before', async () => {
    const { db } = workspace(KNOWLEDGE_ANSWER);
    const result = await engine(new MockLlmProvider()).run(db, TENANT, {
      message: MESSAGE,
      chatId: 'c',
    });
    expect(result).toMatchObject({ outcome: 'answered', reply: PASSAGE, failure: null });
  });

  it('runs a preview through the same hand-off', async () => {
    const net = fakeOpenAiFetch(openAiJson(503, { error: { code: 'server_is_overloaded' } }));
    const { db } = workspace([]);

    const preview = await engine(openai(net)).preview(db, TENANT, {
      steps: [{ type: 'send_message', source: 'knowledge' }],
      message: MESSAGE,
    });

    expect(preview).toMatchObject({
      outcome: 'handed_off',
      failure: { provider: 'llm', kind: 'unavailable' },
      reply: null,
    });
    expect(preview.errors).toEqual([]);
  });
});

/**
 * The other provider on the answer's path (tm 255.7): the question is embedded
 * before anything is searched, and when that fails there is nothing to ground
 * an answer in. The run ends the way a model failure does — and the model is
 * never asked, because an answer without passages is the silent wrong answer.
 */
describe('a knowledge search that cannot run hands the conversation to a human (FR-MOD-06.3.2)', () => {
  const failingSearch = (error: Error) =>
    knowledgeWith(async () => {
      throw error;
    });

  it.each([...EMBEDDING_FAILURE_KINDS])('%s', async (kind) => {
    const llm = new FakeLlmProvider();
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    const result = await engine(llm, 20_000, failingSearch(new EmbeddingProviderError(kind))).run(
      db,
      TENANT,
      { message: MESSAGE, chatId: 'chat-1' },
    );

    expect(result.outcome).toBe('handed_off');
    expect(result.failure).toMatchObject({ provider: 'embedding', kind });
    expect(result.reply).toBeNull();
    expect(llm.calls).toHaveLength(0);
    expect(result.log.find((entry) => entry.step === 'send_message')).toEqual({
      step: 'send_message',
      detail: `the knowledge search could not run (${kind}) — handed to a human`,
      ok: false,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.log.outcome).toBe('handed_off');
  });

  it('withdraws a queued question and still tags, summarises and transfers', async () => {
    const llm = new FakeLlmProvider();
    const { db } = workspace([
      { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
      { type: 'request_info', field: 'order number', prompt: 'What is your order number?' },
      { type: 'send_message', source: 'knowledge' },
      { type: 'send_message', source: 'text', text: 'Anything else I can help with?' },
      { type: 'tag', tag: 'delivery' },
      { type: 'summarize' },
      { type: 'transfer_to_team', group: 'Logistics' },
    ]);

    const result = await engine(
      llm,
      20_000,
      failingSearch(new EmbeddingProviderError('timeout')),
    ).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(result).toMatchObject({
      outcome: 'handed_off',
      failure: { provider: 'embedding', kind: 'timeout' },
      reply: null,
      tags: ['delivery'],
      transferTo: 'Logistics',
    });
    expect(result.summary).toMatch(/^Customer asked: How long does delivery take\?/);
    expect(llm.calls).toHaveLength(0);
  });

  it('lets a defect in the search propagate rather than filing it as a provider failure', async () => {
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    await expect(
      engine(
        new FakeLlmProvider(),
        20_000,
        failingSearch(new TypeError('a bug, not an outage')),
      ).run(db, TENANT, { message: MESSAGE, chatId: 'c' }),
    ).rejects.toThrow('a bug, not an outage');
    expect(runs).toHaveLength(0);
  });

  it('tells a knowledge base with nothing searchable apart from one that did not match', async () => {
    const embedded = async () => ({
      space: 'openai:text-embedding-3-small',
      vector: '[1]',
      usage: { inputTokens: 0 },
    });

    // Nothing in the question's space at all: empty, or still in another space.
    const unsearchable = await engine(
      new FakeLlmProvider(),
      20_000,
      knowledgeWith(embedded, { chunks: [], chunksInScope: 0 }),
    ).run(workspace(KNOWLEDGE_ANSWER).db, TENANT, { message: MESSAGE, chatId: 'c' });
    // Something to search, and none of it close enough.
    const missed = await engine(
      new FakeLlmProvider(),
      20_000,
      knowledgeWith(embedded, { chunks: [], chunksInScope: 12 }),
    ).run(workspace(KNOWLEDGE_ANSWER).db, TENANT, { message: MESSAGE, chatId: 'c' });

    // Both are a miss, not a failure: a human picks the conversation up.
    for (const result of [unsearchable, missed]) {
      expect(result).toMatchObject({ outcome: 'skipped', failure: null, reply: null });
    }
    const detail = (result: typeof missed) =>
      result.log.find((entry) => entry.step === 'send_message')!.detail;
    expect(detail(unsearchable)).toBe(
      'nothing searchable in the knowledge base — empty, or not yet re-embedded for openai:text-embedding-3-small',
    );
    expect(detail(missed)).toBe('nothing in the knowledge base above 0.25 similarity');
  });

  it('names the threshold the knowledge service searched at, not the compiled default (tm 256.6)', async () => {
    const embedded = async () => ({
      space: 'test:space',
      vector: '[1]',
      usage: { inputTokens: 0 },
    });
    const missed = await engine(
      new FakeLlmProvider(),
      20_000,
      knowledgeWith(embedded, { chunks: [], chunksInScope: 12, threshold: 0.42 }),
    ).run(workspace(KNOWLEDGE_ANSWER).db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(missed.log.find((entry) => entry.step === 'send_message')!.detail).toBe(
      'nothing in the knowledge base above 0.42 similarity',
    );
  });
});

/**
 * What a run cost, written on the run (tm 255.9). The engine is the only
 * writer of these three columns and `aiAgentTokenUsage` their only reader, so
 * each figure is pinned here at the source: which call's usage lands in which
 * column, that a billed failure is still counted, and that a call never made
 * costs nothing.
 */
describe('the run records what its provider calls cost', () => {
  it('writes the model tokens and the question embedding on the run that made them', async () => {
    const llm = new FakeLlmProvider({
      reply: ANSWER,
      usage: { inputTokens: 321, outputTokens: 54 },
    });
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    const result = await engine(llm).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(result.outcome).toBe('answered');
    expect(result.usage).toEqual({
      llmInputTokens: 321,
      llmOutputTokens: 54,
      embeddingTokens: QUESTION_TOKENS,
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      llmInputTokens: 321,
      llmOutputTokens: 54,
      embeddingTokens: QUESTION_TOKENS,
    });
  });

  it("reads the real adapter's usage — OpenAI's prompt_tokens and completion_tokens", async () => {
    // `openAiCompletion` reports 120 in / 12 out, as OpenAI's `usage` does.
    const net = fakeOpenAiFetch(openAiCompletion(ANSWER));
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    await engine(openai(net)).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(runs[0]).toMatchObject({ llmInputTokens: 120, llmOutputTokens: 12 });
  });

  it('counts a reply the model wrote but could not send — a no_answer is billed', async () => {
    const net = fakeOpenAiFetch(openAiCompletion('Delivery takes', { finish_reason: 'length' }));
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    const result = await engine(openai(net)).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(result.failure).toMatchObject({ provider: 'llm', kind: 'no_answer' });
    expect(runs[0]).toMatchObject({
      status: 'failed',
      llmInputTokens: 120,
      llmOutputTokens: 12,
      embeddingTokens: QUESTION_TOKENS,
    });
  });

  it('counts nothing for a call that was never made, and still counts the question', async () => {
    const llm = new FakeLlmProvider({ usage: { inputTokens: 999, outputTokens: 999 } });
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    await engine(llm, 20_000, knowledge, 2_000).run(db, TENANT, {
      message: 'delivery '.repeat(400),
      chatId: 'c',
    });

    expect(llm.calls).toHaveLength(0);
    expect(runs[0]).toMatchObject({
      llmInputTokens: 0,
      llmOutputTokens: 0,
      embeddingTokens: QUESTION_TOKENS,
    });
  });

  it('counts the embedding a failed search was billed for, and no model call', async () => {
    const llm = new FakeLlmProvider();
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);
    const failing = knowledgeWith(async () => {
      throw new EmbeddingProviderError('bad_response', {
        reason: 'dimensions',
        usage: { inputTokens: 11 },
      });
    });

    await engine(llm, 20_000, failing).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(runs[0]).toMatchObject({ llmInputTokens: 0, llmOutputTokens: 0, embeddingTokens: 11 });
  });

  it('adds up a skill that answers twice from knowledge', async () => {
    const llm = new FakeLlmProvider({ usage: { inputTokens: 100, outputTokens: 10 } });
    const { db, runs } = workspace([
      { type: 'send_message', source: 'knowledge' },
      { type: 'send_message', source: 'knowledge' },
    ]);

    await engine(llm).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(llm.calls).toHaveLength(2);
    expect(runs[0]).toMatchObject({
      llmInputTokens: 200,
      llmOutputTokens: 20,
      embeddingTokens: 2 * QUESTION_TOKENS,
    });
  });

  it('records 0 for the in-process stub, which bills no one', async () => {
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    await engine(new MockLlmProvider()).run(db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(runs[0]).toMatchObject({ llmInputTokens: 0, llmOutputTokens: 0 });
  });
});

/** The per-call limits `LLM_MAX_OUTPUT_TOKENS` and `LLM_MAX_PROMPT_CHARS` (tm 255.9). */
describe('the per-call ceilings reach the provider, or stop the call before it', () => {
  it('passes the output ceiling to the provider, and the adapter sends it as max_completion_tokens', async () => {
    const fake = new FakeLlmProvider();
    await new SkillEngine({
      llm: fake,
      maxOutputTokens: 123,
      timeoutMs: 20_000,
      maxPromptChars: MAX_PROMPT_CHARS,
      knowledge,
    }).run(workspace(KNOWLEDGE_ANSWER).db, TENANT, { message: MESSAGE, chatId: 'c' });
    expect(fake.calls[0]!.maxOutputTokens).toBe(123);

    const net = fakeOpenAiFetch(openAiCompletion(ANSWER));
    await new SkillEngine({
      llm: openai(net),
      maxOutputTokens: 123,
      timeoutMs: 20_000,
      maxPromptChars: MAX_PROMPT_CHARS,
      knowledge,
    }).run(workspace(KNOWLEDGE_ANSWER).db, TENANT, { message: MESSAGE, chatId: 'c' });
    const body = JSON.parse(String(net.calls[0]!.init.body)) as { max_completion_tokens: number };
    expect(body.max_completion_tokens).toBe(123);
  });

  it('never sends a prompt over the character ceiling: no call, a human answers, the length is on record (FR-05-06.EK1)', async () => {
    const llm = new FakeLlmProvider();
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);
    const message = `delivery ${'x'.repeat(3_000)}`;

    const result = await engine(llm, 20_000, knowledge, 2_000).run(db, TENANT, {
      message,
      chatId: 'c',
    });

    expect(llm.calls).toHaveLength(0);
    expect(result).toMatchObject({ outcome: 'handed_off', reply: null });
    const length = promptLength(
      buildAnswerPrompt({
        message,
        passages: [PASSAGE],
        persona: { tone: null, languages: [], answerLength: null },
        answerIn: null,
      }),
    );
    expect(length).toBeGreaterThan(2_000);
    expect(result.failure).toEqual({
      provider: 'llm',
      kind: 'prompt_too_long',
      transient: false,
      status: null,
      code: null,
      requestId: null,
      reason: `${length}/2000`,
    });
    expect(runs[0]!.status).toBe('failed');
    expect(runs[0]!.log.entries.find((entry) => entry.step === 'send_message')?.detail).toBe(
      'the model could not answer (prompt_too_long) — handed to a human',
    );
  });

  it('sends a prompt exactly at the ceiling — the limit is inclusive', async () => {
    const probe = new FakeLlmProvider();
    await engine(probe).run(workspace(KNOWLEDGE_ANSWER).db, TENANT, {
      message: MESSAGE,
      chatId: 'c',
    });
    const exact = promptLength(probe.calls[0]!);

    const llm = new FakeLlmProvider();
    const atLimit = await engine(llm, 20_000, knowledge, exact).run(
      workspace(KNOWLEDGE_ANSWER).db,
      TENANT,
      { message: MESSAGE, chatId: 'c' },
    );
    const overByOne = await engine(new FakeLlmProvider(), 20_000, knowledge, exact - 1).run(
      workspace(KNOWLEDGE_ANSWER).db,
      TENANT,
      { message: MESSAGE, chatId: 'c' },
    );

    expect(llm.calls).toHaveLength(1);
    expect(atLimit.outcome).toBe('answered');
    expect(overByOne.failure).toMatchObject({ kind: 'prompt_too_long' });
  });
});

/**
 * Transient and permanent failures, side by side (tm 255.9): one outcome for
 * the customer, told apart only by what the operator reads.
 */
describe('every failure class ends the same way for the customer (FR-05-06.EK1)', () => {
  it('hands a transient outage and a refused key to a human alike, and keeps the facts that tell them apart', async () => {
    const outage = await engine(openai(fakeOpenAiFetch(problem(503, 'server_is_overloaded')))).run(
      workspace(KNOWLEDGE_ANSWER).db,
      TENANT,
      { message: MESSAGE, chatId: 'c' },
    );
    const refusedKey = await engine(openai(fakeOpenAiFetch(problem(401, 'invalid_api_key')))).run(
      workspace(KNOWLEDGE_ANSWER).db,
      TENANT,
      { message: MESSAGE, chatId: 'c' },
    );

    // What the customer gets, and what the run log says, is the same shape…
    const productSide = (result: typeof outage) => ({
      outcome: result.outcome,
      reply: result.reply,
      transferTo: result.transferTo,
      steps: result.log.map((entry) => [entry.step, entry.ok]),
    });
    expect(productSide(outage)).toEqual(productSide(refusedKey));
    expect(outage.outcome).toBe('handed_off');

    // …and only the operator's facts differ.
    expect(outage.failure).toEqual({
      provider: 'llm',
      kind: 'unavailable',
      transient: true,
      status: 503,
      code: 'server_is_overloaded',
      requestId: 'req_abc123',
      reason: null,
    });
    expect(refusedKey.failure).toEqual({
      provider: 'llm',
      kind: 'auth',
      transient: false,
      status: 401,
      code: 'invalid_api_key',
      requestId: 'req_abc123',
      reason: null,
    });
    expect(JSON.stringify([outage.failure, refusedKey.failure])).not.toContain('Incorrect API key');
  });
});

describe('the daily AI cap (tm 257.8)', () => {
  /** A budget that refuses every reservation, as a capped workspace's would. */
  function cappedLlm(fake: FakeLlmProvider, scope: 'workspace' | 'global' = 'workspace') {
    const refusal = new AiDailyCapError('llm', scope, 120);
    const budget = {
      reserve: async () => {
        throw refusal;
      },
      settle: async () => {
        throw new Error('nothing was reserved, so nothing may be settled');
      },
    } as unknown as AiDailyBudget;
    return { llm: new MeteredLlm(fake, budget), refusal };
  }

  function cappedEngine(llm: MeteredLlm): SkillEngine {
    return new SkillEngine({
      llm,
      maxOutputTokens: 400,
      timeoutMs: 20_000,
      maxPromptChars: MAX_PROMPT_CHARS,
      knowledge,
    });
  }

  it('hands a live run to a human without asking the model, records it with the embedding it spent, and files no provider failure', async () => {
    const fake = new FakeLlmProvider();
    const { llm, refusal } = cappedLlm(fake, 'global');
    const ws = workspace([
      { type: 'request_info', field: 'order number', prompt: 'What is your order number?' },
      ...KNOWLEDGE_ANSWER,
      { type: 'send_message', source: 'knowledge' },
      { type: 'tag', tag: 'delivery' },
    ]);

    const result = await cappedEngine(llm).run(ws.db, TENANT, { message: MESSAGE, chatId: 'c' });

    expect(fake.calls).toHaveLength(0);
    expect(result.capped).toBe(refusal);
    expect(result.failure).toBeNull();
    expect(result.outcome).toBe('handed_off');
    // The question an earlier step queued is withdrawn, the second answer is
    // never attempted, and what a human needs still runs.
    expect(result.reply).toBeNull();
    expect(result.tags).toEqual(['delivery']);
    expect(result.log.map((entry) => [entry.step, entry.ok])).toEqual([
      ['detect_intent', true],
      ['request_info', true],
      ['send_message', false],
      ['send_message', true],
      ['tag', true],
    ]);
    expect(result.log[2]!.detail).toBe("today's AI cap is reached (global) — handed to a human");
    expect(result.log[3]!.detail).toBe("skipped — today's AI cap is reached, a human replies");
    expect(ws.runs).toHaveLength(1);
    expect(ws.runs[0]).toMatchObject({
      status: 'failed',
      llmInputTokens: 0,
      llmOutputTokens: 0,
      embeddingTokens: QUESTION_TOKENS,
    });
  });

  it('turns a capped preview into the refusal itself, with nothing to show', async () => {
    const fake = new FakeLlmProvider();
    const { llm, refusal } = cappedLlm(fake);
    const ws = workspace(KNOWLEDGE_ANSWER);
    await expect(
      cappedEngine(llm).preview(ws.db, TENANT, { steps: KNOWLEDGE_ANSWER, message: MESSAGE }),
    ).rejects.toBe(refusal);
    expect(fake.calls).toHaveLength(0);
    expect(ws.runs).toHaveLength(0);
  });

  it('never meets the cap with a fixed reply, which asks no model', async () => {
    const fake = new FakeLlmProvider();
    const { llm } = cappedLlm(fake);
    const ws = workspace([{ type: 'send_message', source: 'text', text: 'We are open 9 to 5.' }]);
    const result = await cappedEngine(llm).run(ws.db, TENANT, { message: MESSAGE, chatId: 'c' });
    expect(result).toMatchObject({
      outcome: 'answered',
      reply: 'We are open 9 to 5.',
      capped: null,
    });
  });
});
