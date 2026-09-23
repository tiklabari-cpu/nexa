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
import type { KnowledgeSearch, KnowledgeService, RetrievedChunk } from './knowledge-service.js';
import { EMBEDDING_FAILURE_KINDS, EmbeddingProviderError } from './provider/embedding-error.js';
import { LLM_FAILURE_KINDS, type LlmFailureKind } from './provider/llm-error.js';
import type { LlmProvider } from './provider/llm-provider.js';
import { MockLlmProvider } from './provider/mock-llm-provider.js';
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
  }: { chunks?: RetrievedChunk[]; chunksInScope?: number } = {},
): KnowledgeService {
  return {
    embedQuery,
    search: async (): Promise<KnowledgeSearch> => ({ strategy: 'exact', chunksInScope, chunks }),
  } as unknown as KnowledgeService;
}

const knowledge = knowledgeWith(async () => ({ space: 'test:space', vector: '[1]' }));

const quiet = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function openai(net: FakeOpenAiFetch, circuit?: { failureThreshold: number }): OpenAiLlmProvider {
  return new OpenAiLlmProvider(
    { baseUrl: 'https://eu.api.openai.com/v1', model: 'test-model', apiKey: 'sk-test-only' },
    { fetchImpl: net.impl, logger: quiet, sleep: async () => {}, ...(circuit ? { circuit } : {}) },
  );
}

function engine(
  llm: LlmProvider,
  timeoutMs = 20_000,
  knowledgeService: KnowledgeService = knowledge,
): SkillEngine {
  return new SkillEngine({ llm, maxOutputTokens: 400, timeoutMs, knowledge: knowledgeService });
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
  },
];

async function viaOpenAi(net: FakeOpenAiFetch) {
  return { provider: openai(net), net };
}

describe('a model that cannot answer hands the conversation to a human (FR-05-06.EK1)', () => {
  it('covers every failure kind', () => {
    expect(FAILURES.map((failure) => failure.kind).sort()).toEqual([...LLM_FAILURE_KINDS].sort());
  });

  it.each(FAILURES)('$kind', async ({ kind, llm, timeoutMs }) => {
    const { provider, net } = await llm();
    const before = net.calls.length;
    const { db, runs } = workspace(KNOWLEDGE_ANSWER);

    const result = await engine(provider, timeoutMs).run(db, TENANT, {
      message: MESSAGE,
      chatId: 'chat-1',
    });

    expect(result.outcome).toBe('handed_off');
    expect(result.failure).toEqual({ provider: 'llm', kind });
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

    if (kind === 'circuit_open') expect(net.calls.length).toBe(before);
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
    expect(result.failure).toEqual({ provider: 'llm', kind: 'auth' });
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
    expect(result.failure).toEqual({ provider: 'embedding', kind });
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
    const embedded = async () => ({ space: 'openai:text-embedding-3-small', vector: '[1]' });

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
});
