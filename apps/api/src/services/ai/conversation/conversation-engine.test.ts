/**
 * The conversation engine's turn (tm 292.2), over the scenarios the skill
 * engine was held to — the model that cannot answer (tm 255.6), the knowledge
 * search that cannot run (tm 255.7), what a run costs and the per-call
 * ceilings (tm 255.9), the daily cap (tm 257.8) — each stored skill reaching
 * the turn through the legacy adapter, as it does live.
 *
 * The real OpenAI adapter over an injected `fetch` — no network, no key — and
 * a database every table of which throws when touched: a turn reads its
 * configuration from its context and writes nothing, so the run row each test
 * checks is the one the live adapter would write (`skillRunRecord`). Through
 * the real server and database the same path is covered by
 * `test/integration/llm-openai-adapter.test.ts` and `ai-turn-adapter.test.ts`.
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
} from '../../../../test/helpers/fake-openai.js';
import { FakeLlmProvider } from '../../../../test/helpers/fake-llm-provider.js';
import { DEFAULT_HANDOFF_MESSAGES, readPersona } from '@siyahtus/types';
import type { TenantClient, TenantContext } from '../../../lib/tenant.js';
import {
  RETRIEVAL_THRESHOLD,
  type KnowledgeSearch,
  type KnowledgeService,
  type RetrievedChunk,
} from '../knowledge-service.js';
import { EMBEDDING_FAILURE_KINDS, EmbeddingProviderError } from '../provider/embedding-error.js';
import { LLM_FAILURE_KINDS, type LlmFailureKind } from '../provider/llm-error.js';
import { buildAnswerPrompt } from '../provider/answer-prompt.js';
import { promptLength, type LlmProvider } from '../provider/llm-provider.js';
import { MockLlmProvider } from '../provider/mock-llm-provider.js';
import { AiDailyCapError, type AiAttribution, type AiDailyBudget } from '../ai-daily-budget.js';
import { MeteredLlm } from '../metered-llm.js';
import { OpenAiLlmProvider } from '../provider/openai-llm-provider.js';
import { ConversationEngine } from './conversation-engine.js';
import { guardrailLayers } from './guardrails/prompt-block.js';
import { renderLayers } from './guidance.js';
import {
  describeSideEffects,
  emptyTurnState,
  skillRunRecord,
  type SkillRunRecord,
  type TenantRunner,
  type TurnConfig,
  type TurnContext,
  type TurnHistory,
  type TurnResult,
  type TurnState,
} from './turn.js';

const TENANT: TenantContext = { licenseId: 1n, organizationId: 'org-test' };
const PASSAGE = 'Standard delivery takes 3 to 5 working days across the EU.';
const MESSAGE = 'How long does delivery take?';
const ANSWER = 'Delivery takes three to five working days.';
/** The knowledge answer as the model writes it (tm 298): the reply, grounded, citing the passage. */
const ANSWER_JSON = JSON.stringify({ reply: ANSWER, grounded: 'full', cited_ids: ['P1'] });
/** What a provider's error message may say — none of it may reach the run log. */
const PROVIDER_WORDS = 'Incorrect API key provided: sk-test-only-leak';

const KNOWLEDGE_ANSWER = [
  { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
  { type: 'send_message', source: 'knowledge' },
];

/**
 * The database a turn is handed: any table it touches throws. The knowledge
 * stand-ins below take the client without using it, so a test only passes
 * while the turn reads nothing but its context and writes nothing at all.
 */
const untouchable = new Proxy(
  {},
  {
    get: (_, table) => {
      throw new Error(`a turn touched the database (${String(table)})`);
    },
  },
) as TenantClient;
const db: TenantRunner = (fn) => fn(untouchable);

/** One workspace with one active skill, and the run rows its turns are recorded as. */
interface Workspace {
  config: TurnConfig;
  runs: SkillRunRecord[];
}

function workspace(steps: unknown[]): Workspace {
  return {
    config: {
      skills: [
        {
          id: 'skill-1',
          name: 'Delivery',
          steps,
          aiAgentId: 'agent-1',
          persona: readPersona({ tone: null, languages: [], persona: null }),
        },
      ],
    },
    runs: [],
  };
}

function context(ws: Workspace, overrides: Partial<TurnContext> = {}): TurnContext {
  return {
    tenant: TENANT,
    db,
    now: new Date('2026-10-17T09:00:00Z'),
    mode: 'live',
    chatId: 'c',
    configVersionId: null,
    config: ws.config,
    toolStubs: {},
    ...overrides,
  };
}

/** A turn's result, read flat: its decisions, reply and side effects side by side. */
function flat(result: TurnResult) {
  return {
    ...result.decisions,
    reply: result.reply,
    ...describeSideEffects(result.sideEffects),
    sideEffects: result.sideEffects,
    nextState: result.nextState,
  };
}

/**
 * One live turn, the way the adapter takes it: the turn decides, and the run
 * row the adapter would write is kept on the workspace.
 */
async function live(
  engine: ConversationEngine,
  ws: Workspace,
  message: string,
  overrides: Partial<TurnContext> = {},
  state: TurnState = emptyTurnState(),
) {
  const result = await engine.runTurn(state, { text: message }, context(ws, overrides));
  const run = skillRunRecord(result.decisions);
  if (run) ws.runs.push(run);
  return flat(result);
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
): ConversationEngine {
  return new ConversationEngine({
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
    llm: () => viaOpenAi(fakeOpenAiFetch(openAiCompletion(ANSWER_JSON))),
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
    const ws = workspace(KNOWLEDGE_ANSWER);
    // Long enough to cross a 2,000-character ceiling with the instructions, well
    // under the default one; the other kinds are asked the usual question.
    const message = maxPromptChars
      ? `${MESSAGE} ${'Please check parcel QX-44917. '.repeat(60)}`
      : MESSAGE;

    const result = await live(engine(provider, timeoutMs, knowledge, maxPromptChars), ws, message, {
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
    expect(ws.runs).toHaveLength(1);
    expect(ws.runs[0]!.status).toBe('failed');
    expect(ws.runs[0]!.log.outcome).toBe('handed_off');

    if (refused) expect(net.calls.length).toBe(before);
  });

  it('answers normally when the model does', async () => {
    const net = fakeOpenAiFetch(openAiCompletion(ANSWER_JSON));
    const ws = workspace(KNOWLEDGE_ANSWER);

    const result = await live(engine(openai(net)), ws, MESSAGE);

    expect(result).toMatchObject({ outcome: 'answered', reply: ANSWER, failure: null });
    expect(ws.runs[0]!.status).toBe('succeeded');
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

    const result = await live(engine(openai(net)), workspace(STEPS), MESSAGE);

    expect(result.outcome).toBe('handed_off');
    expect(result.failure).toMatchObject({ provider: 'llm', kind: 'auth' });
    // Nothing the steps queued — the hand-over's own fixed sentence (tm 303.2 · AI-09).
    expect(result.reply).toBe(DEFAULT_HANDOFF_MESSAGES.procedure_rule.en);
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
    const net = fakeOpenAiFetch(openAiCompletion(ANSWER_JSON));

    const result = await live(engine(openai(net)), workspace(STEPS), MESSAGE);

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
    const ws = workspace(KNOWLEDGE_ANSWER);

    await expect(live(engine(broken), ws, MESSAGE)).rejects.toThrow('not a provider failure');
    expect(ws.runs).toHaveLength(0);
  });

  it('keeps the stub answering exactly as before', async () => {
    const result = await live(engine(new MockLlmProvider()), workspace(KNOWLEDGE_ANSWER), MESSAGE);
    expect(result).toMatchObject({ outcome: 'answered', reply: PASSAGE, failure: null });
  });

  it('runs a preview through the same hand-off', async () => {
    const net = fakeOpenAiFetch(openAiJson(503, { error: { code: 'server_is_overloaded' } }));

    const preview = await engine(openai(net)).preview(db, TENANT, {
      steps: [{ type: 'send_message', source: 'knowledge' }],
      message: MESSAGE,
    });

    expect(flat(preview)).toMatchObject({
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
 * an answer in. The turn ends the way a model failure does — and the model is
 * never asked, because an answer without passages is the silent wrong answer.
 */
describe('a knowledge search that cannot run hands the conversation to a human (FR-MOD-06.3.2)', () => {
  const failingSearch = (error: Error) =>
    knowledgeWith(async () => {
      throw error;
    });

  it.each([...EMBEDDING_FAILURE_KINDS])('%s', async (kind) => {
    const llm = new FakeLlmProvider();
    const ws = workspace(KNOWLEDGE_ANSWER);

    const result = await live(
      engine(llm, 20_000, failingSearch(new EmbeddingProviderError(kind))),
      ws,
      MESSAGE,
      { chatId: 'chat-1' },
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
    expect(ws.runs).toHaveLength(1);
    expect(ws.runs[0]!.status).toBe('failed');
    expect(ws.runs[0]!.log.outcome).toBe('handed_off');
  });

  it('withdraws a queued question and still tags, summarises and transfers', async () => {
    const llm = new FakeLlmProvider();
    const ws = workspace([
      { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
      { type: 'request_info', field: 'order number', prompt: 'What is your order number?' },
      { type: 'send_message', source: 'knowledge' },
      { type: 'send_message', source: 'text', text: 'Anything else I can help with?' },
      { type: 'tag', tag: 'delivery' },
      { type: 'summarize' },
      { type: 'transfer_to_team', group: 'Logistics' },
    ]);

    const result = await live(
      engine(llm, 20_000, failingSearch(new EmbeddingProviderError('timeout'))),
      ws,
      MESSAGE,
    );

    expect(result).toMatchObject({
      outcome: 'handed_off',
      failure: { provider: 'embedding', kind: 'timeout' },
      reply: DEFAULT_HANDOFF_MESSAGES.procedure_rule.en,
      tags: ['delivery'],
      transferTo: 'Logistics',
    });
    expect(result.summary).toMatch(/^Customer asked: How long does delivery take\?/);
    expect(llm.calls).toHaveLength(0);
  });

  it('lets a defect in the search propagate rather than filing it as a provider failure', async () => {
    const ws = workspace(KNOWLEDGE_ANSWER);

    await expect(
      live(
        engine(new FakeLlmProvider(), 20_000, failingSearch(new TypeError('a bug, not an outage'))),
        ws,
        MESSAGE,
      ),
    ).rejects.toThrow('a bug, not an outage');
    expect(ws.runs).toHaveLength(0);
  });

  it('tells a knowledge base with nothing searchable apart from one that did not match', async () => {
    const embedded = async () => ({
      space: 'openai:text-embedding-3-small',
      vector: '[1]',
      usage: { inputTokens: 0 },
    });

    // Nothing in the question's space at all: empty, or still in another space.
    const unsearchable = await live(
      engine(
        new FakeLlmProvider(),
        20_000,
        knowledgeWith(embedded, { chunks: [], chunksInScope: 0 }),
      ),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
    );
    // Something to search, and none of it close enough.
    const missed = await live(
      engine(
        new FakeLlmProvider(),
        20_000,
        knowledgeWith(embedded, { chunks: [], chunksInScope: 12 }),
      ),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
    );

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
    const missed = await live(
      engine(
        new FakeLlmProvider(),
        20_000,
        knowledgeWith(embedded, { chunks: [], chunksInScope: 12, threshold: 0.42 }),
      ),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
    );

    expect(missed.log.find((entry) => entry.step === 'send_message')!.detail).toBe(
      'nothing in the knowledge base above 0.42 similarity',
    );
  });
});

/**
 * What a run cost, recorded on the run (tm 255.9). The turn returns the
 * figures and the live adapter writes them; `aiAgentTokenUsage` is their only
 * reader, so each figure is pinned here at the source: which call's usage
 * lands in which column, that a billed failure is still counted, and that a
 * call never made costs nothing.
 */
describe('the run records what its provider calls cost', () => {
  it('writes the model tokens and the question embedding on the run that made them', async () => {
    const llm = new FakeLlmProvider({
      reply: ANSWER,
      usage: { inputTokens: 321, outputTokens: 54 },
    });
    const ws = workspace(KNOWLEDGE_ANSWER);

    const result = await live(engine(llm), ws, MESSAGE);

    expect(result.outcome).toBe('answered');
    expect(result.usage).toEqual({
      llmInputTokens: 321,
      llmOutputTokens: 54,
      embeddingTokens: QUESTION_TOKENS,
    });
    expect(ws.runs).toHaveLength(1);
    expect(ws.runs[0]).toMatchObject({
      llmInputTokens: 321,
      llmOutputTokens: 54,
      embeddingTokens: QUESTION_TOKENS,
    });
  });

  it("reads the real adapter's usage — OpenAI's prompt_tokens and completion_tokens", async () => {
    // `openAiCompletion` reports 120 in / 12 out, as OpenAI's `usage` does.
    const net = fakeOpenAiFetch(openAiCompletion(ANSWER_JSON));
    const ws = workspace(KNOWLEDGE_ANSWER);

    await live(engine(openai(net)), ws, MESSAGE);

    expect(ws.runs[0]).toMatchObject({ llmInputTokens: 120, llmOutputTokens: 12 });
  });

  it('counts a reply the model wrote but could not send — a no_answer is billed', async () => {
    const net = fakeOpenAiFetch(openAiCompletion('Delivery takes', { finish_reason: 'length' }));
    const ws = workspace(KNOWLEDGE_ANSWER);

    const result = await live(engine(openai(net)), ws, MESSAGE);

    expect(result.failure).toMatchObject({ provider: 'llm', kind: 'no_answer' });
    // Both tries of it: a cut-off answer is invalid and gets the structured
    // gate's one retry (ADR §6a.4.3), which was cut off and billed too.
    expect(ws.runs[0]).toMatchObject({
      status: 'failed',
      llmInputTokens: 240,
      llmOutputTokens: 24,
      embeddingTokens: QUESTION_TOKENS,
    });
  });

  it('counts nothing for a call that was never made, and still counts the question', async () => {
    const llm = new FakeLlmProvider({ usage: { inputTokens: 999, outputTokens: 999 } });
    const ws = workspace(KNOWLEDGE_ANSWER);

    await live(engine(llm, 20_000, knowledge, 2_000), ws, 'delivery '.repeat(400));

    expect(llm.calls).toHaveLength(0);
    expect(ws.runs[0]).toMatchObject({
      llmInputTokens: 0,
      llmOutputTokens: 0,
      embeddingTokens: QUESTION_TOKENS,
    });
  });

  it('counts the embedding a failed search was billed for, and no model call', async () => {
    const llm = new FakeLlmProvider();
    const ws = workspace(KNOWLEDGE_ANSWER);
    const failing = knowledgeWith(async () => {
      throw new EmbeddingProviderError('bad_response', {
        reason: 'dimensions',
        usage: { inputTokens: 11 },
      });
    });

    await live(engine(llm, 20_000, failing), ws, MESSAGE);

    expect(ws.runs[0]).toMatchObject({
      llmInputTokens: 0,
      llmOutputTokens: 0,
      embeddingTokens: 11,
    });
  });

  it('adds up a skill that answers twice from knowledge — the message embedded once (AI-05 §2)', async () => {
    const llm = new FakeLlmProvider({ usage: { inputTokens: 100, outputTokens: 10 } });
    const ws = workspace([
      { type: 'send_message', source: 'knowledge' },
      { type: 'send_message', source: 'knowledge' },
    ]);

    await live(engine(llm), ws, MESSAGE);

    expect(llm.calls).toHaveLength(2);
    // One embedding per turn (tm 297.3): the second search reuses the first's
    // vector, and the provider was asked — and billed — once.
    expect(ws.runs[0]).toMatchObject({
      llmInputTokens: 200,
      llmOutputTokens: 20,
      embeddingTokens: QUESTION_TOKENS,
    });
  });

  it('records 0 for the in-process stub, which bills no one', async () => {
    const ws = workspace(KNOWLEDGE_ANSWER);

    await live(engine(new MockLlmProvider()), ws, MESSAGE);

    expect(ws.runs[0]).toMatchObject({ llmInputTokens: 0, llmOutputTokens: 0 });
  });
});

/** The per-call limits `LLM_MAX_OUTPUT_TOKENS` and `LLM_MAX_PROMPT_CHARS` (tm 255.9). */
describe('the per-call ceilings reach the provider, or stop the call before it', () => {
  it('passes the output ceiling to the provider, and the adapter sends it as max_completion_tokens', async () => {
    const fake = new FakeLlmProvider();
    await live(
      new ConversationEngine({
        llm: fake,
        maxOutputTokens: 123,
        timeoutMs: 20_000,
        maxPromptChars: MAX_PROMPT_CHARS,
        knowledge,
      }),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
    );
    expect(fake.calls[0]!.maxOutputTokens).toBe(123);

    const net = fakeOpenAiFetch(openAiCompletion(ANSWER_JSON));
    await live(
      new ConversationEngine({
        llm: openai(net),
        maxOutputTokens: 123,
        timeoutMs: 20_000,
        maxPromptChars: MAX_PROMPT_CHARS,
        knowledge,
      }),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
    );
    const body = JSON.parse(String(net.calls[0]!.init.body)) as { max_completion_tokens: number };
    expect(body.max_completion_tokens).toBe(123);
  });

  it('never sends a prompt over the character ceiling: no call, a human answers, the length is on record (FR-05-06.EK1)', async () => {
    const llm = new FakeLlmProvider();
    const ws = workspace(KNOWLEDGE_ANSWER);
    const message = `delivery ${'x'.repeat(3_000)}`;

    const result = await live(engine(llm, 20_000, knowledge, 2_000), ws, message);

    expect(llm.calls).toHaveLength(0);
    expect(result).toMatchObject({ outcome: 'handed_off', reply: null });
    const length = promptLength(
      buildAnswerPrompt({
        message,
        passages: [PASSAGE],
        persona: { tone: null, languages: [], answerLength: null },
        answerIn: null,
        cite: { ids: ['P1'], notes: [] },
        // The platform's locked rules ride on every written call (tm 301.3).
        rules: renderLayers(
          guardrailLayers({ answerIn: null, riskFlagged: false, workspaceRules: [] }),
        ),
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
    expect(ws.runs[0]!.status).toBe('failed');
    expect(ws.runs[0]!.log.entries.find((entry) => entry.step === 'send_message')?.detail).toBe(
      'the model could not answer (prompt_too_long) — handed to a human',
    );
  });

  it('sends a prompt exactly at the ceiling — the limit is inclusive', async () => {
    const probe = new FakeLlmProvider();
    await live(engine(probe), workspace(KNOWLEDGE_ANSWER), MESSAGE);
    const exact = promptLength(probe.calls[0]!);

    const llm = new FakeLlmProvider();
    const atLimit = await live(
      engine(llm, 20_000, knowledge, exact),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
    );
    const overByOne = await live(
      engine(new FakeLlmProvider(), 20_000, knowledge, exact - 1),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
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
    const outage = await live(
      engine(openai(fakeOpenAiFetch(problem(503, 'server_is_overloaded')))),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
    );
    const refusedKey = await live(
      engine(openai(fakeOpenAiFetch(problem(401, 'invalid_api_key')))),
      workspace(KNOWLEDGE_ANSWER),
      MESSAGE,
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

  function cappedEngine(llm: MeteredLlm): ConversationEngine {
    return new ConversationEngine({
      llm,
      maxOutputTokens: 400,
      timeoutMs: 20_000,
      maxPromptChars: MAX_PROMPT_CHARS,
      knowledge,
    });
  }

  it('hands a live turn to a human without asking the model, records it with the embedding it spent, and files no provider failure', async () => {
    const fake = new FakeLlmProvider();
    const { llm, refusal } = cappedLlm(fake, 'global');
    const ws = workspace([
      { type: 'request_info', field: 'order number', prompt: 'What is your order number?' },
      ...KNOWLEDGE_ANSWER,
      { type: 'send_message', source: 'knowledge' },
      { type: 'tag', tag: 'delivery' },
    ]);

    const result = await live(cappedEngine(llm), ws, MESSAGE);

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
    await expect(
      cappedEngine(llm).preview(db, TENANT, { steps: KNOWLEDGE_ANSWER, message: MESSAGE }),
    ).rejects.toBe(refusal);
    expect(fake.calls).toHaveLength(0);
  });

  it('hands a turn to a human when the question’s embedding does not fit, asking no model and costing nothing (tm 257.20)', async () => {
    const fake = new FakeLlmProvider();
    const refusal = new AiDailyCapError('embedding', 'workspace', 120);
    const asked: unknown[] = [];
    const capped = knowledgeWith(async (_question, payer) => {
      asked.push(payer);
      throw refusal;
    });
    const ws = workspace([...KNOWLEDGE_ANSWER, { type: 'send_message', source: 'knowledge' }]);
    const run = new ConversationEngine({
      llm: fake,
      maxOutputTokens: 400,
      timeoutMs: 20_000,
      maxPromptChars: MAX_PROMPT_CHARS,
      knowledge: capped,
    });

    const result = await live(run, ws, MESSAGE);

    // Counted against the turn's own workspace.
    expect(asked).toEqual([TENANT]);
    expect(fake.calls).toHaveLength(0);
    expect(result).toMatchObject({ capped: refusal, failure: null, outcome: 'handed_off' });
    expect(result.log.find((entry) => entry.step === 'send_message')!.detail).toBe(
      "today's AI cap is reached (workspace) — handed to a human",
    );
    expect(ws.runs[0]).toMatchObject({ status: 'failed', embeddingTokens: 0, llmInputTokens: 0 });

    // A preview says why instead of showing a result.
    await expect(
      run.preview(db, TENANT, { steps: KNOWLEDGE_ANSWER, message: MESSAGE }),
    ).rejects.toBe(refusal);
  });

  it('never meets the cap with a fixed reply, which asks no model', async () => {
    const fake = new FakeLlmProvider();
    const { llm } = cappedLlm(fake);
    const ws = workspace([{ type: 'send_message', source: 'text', text: 'We are open 9 to 5.' }]);
    const result = await live(cappedEngine(llm), ws, MESSAGE);
    expect(result).toMatchObject({
      outcome: 'answered',
      reply: 'We are open 9 to 5.',
      capped: null,
    });
  });
});

/**
 * The turn contract (tm 292.2 · AI-19): `runTurn(state, message, ctx)` returns
 * the reply, the decisions, the next state and the side effects, and does
 * nothing to the conversation itself — every test here runs over the database
 * that throws when touched.
 */
describe('the turn returns what it would do and does none of it (AI-19)', () => {
  const STEPS = [
    { type: 'detect_intent', intent: 'delivery', phrases: ['delivery'] },
    { type: 'tag', tag: 'delivery' },
    { type: 'summarize' },
    { type: 'send_message', source: 'text', text: 'Passing you to logistics.' },
    { type: 'transfer_to_team', group: 'Logistics' },
    { type: 'tag', tag: 'never-applied' },
  ];

  it('hands back the reply, the side effects in step order and the next state', async () => {
    const before: TurnState = { ...emptyTurnState(), counters: { turns: 2, clarify: 1 } };
    const frozen = structuredClone(before);

    const result = await engine(new FakeLlmProvider()).runTurn(
      before,
      { text: MESSAGE },
      context(workspace(STEPS)),
    );

    expect(result.reply).toBe('Passing you to logistics.');
    expect(result.sideEffects).toEqual([
      { kind: 'tag', tag: 'delivery' },
      { kind: 'summary', text: `Customer asked: ${MESSAGE}` },
      {
        kind: 'handoff',
        team: 'Logistics',
        reason: 'procedure_rule',
        reasons: ['procedure_rule'],
        priority: 'normal',
      },
    ]);
    expect(result.decisions).toMatchObject({
      outcome: 'handed_off',
      skillId: 'skill-1',
      replyKind: 'answer',
    });
    // One more turn counted, the connection's summary rebuilt (tm 294); the
    // other counters and every other field as they were.
    expect(result.nextState).toEqual({
      ...before,
      counters: { turns: 3, clarify: 1 },
      digest: {
        procedure_key: 'skill-1',
        procedure_name: expect.any(String),
        intent_label: 'delivery',
        slots: {},
        outcome: 'handed_off',
        awaiting_answer: false,
        handoff: {
          id: null,
          team_id: null,
          team_name: 'Logistics',
          reason_codes: ['ai_handoff'],
          agent_replied: false,
        },
        risk_flags: [],
        last_ai_excerpt: 'Passing you to logistics.',
      },
    });
    // The state it was given is not touched.
    expect(before).toEqual(frozen);
  });

  it('gives the state back as it came when no skill matches — no turn was taken', async () => {
    const before: TurnState = { ...emptyTurnState(), counters: { turns: 4 } };

    const result = await engine(new FakeLlmProvider()).runTurn(
      before,
      { text: 'Hello there' },
      context(workspace(STEPS)),
    );

    expect(result).toEqual({
      reply: null,
      decisions: expect.objectContaining({ outcome: 'skipped', skillId: null, log: [] }),
      nextState: before,
      sideEffects: [],
    });
    expect(result.nextState).toBe(before);
  });

  it('marks the visitor messages it answered processed, and never moves the mark back (tm 292.4)', async () => {
    const run = (state: TurnState, text: string, throughSeq?: number) =>
      engine(new FakeLlmProvider()).runTurn(
        state,
        { text, ...(throughSeq !== undefined ? { throughSeq } : {}) },
        context(workspace(STEPS)),
      );

    expect((await run(emptyTurnState(), MESSAGE, 7)).nextState.lastProcessedEventSeq).toBe(7);
    // A turn behind the mark — or one outside a live connection — leaves it.
    const ahead: TurnState = { ...emptyTurnState(), lastProcessedEventSeq: 9 };
    expect((await run(ahead, MESSAGE, 7)).nextState.lastProcessedEventSeq).toBe(9);
    expect((await run(ahead, MESSAGE)).nextState.lastProcessedEventSeq).toBe(9);
    // A message no skill matched is not a turn: nothing is marked.
    expect((await run(emptyTurnState(), 'Hello there', 7)).nextState.lastProcessedEventSeq).toBe(0);
  });

  it('runs the first skill that matches, past a malformed one and one whose gate does not', async () => {
    const result = await engine(new FakeLlmProvider()).runTurn(
      emptyTurnState(),
      { text: MESSAGE },
      {
        ...context(workspace([])),
        config: {
          skills: [
            { ...workspace([]).config.skills[0]!, id: 'broken', steps: [{ type: 'nope' }] },
            {
              ...workspace([]).config.skills[0]!,
              id: 'refunds',
              steps: [{ type: 'detect_intent', intent: 'refund', phrases: ['refund'] }],
            },
            ...workspace([{ type: 'send_message', source: 'text', text: 'First.' }]).config.skills,
            {
              ...workspace([]).config.skills[0]!,
              id: 'second',
              steps: [{ type: 'send_message', source: 'text', text: 'Second.' }],
            },
          ],
        },
      },
    );

    expect(result.decisions.skillId).toBe('skill-1');
    expect(result.reply).toBe('First.');
  });

  it('asks rather than answers on a collect step, and says it was a question', async () => {
    const result = await engine(new FakeLlmProvider()).runTurn(
      emptyTurnState(),
      { text: 'My parcel has not arrived' },
      context(
        workspace([
          { type: 'request_info', field: 'order number', prompt: 'What is your order number?' },
        ]),
      ),
    );

    expect(result.reply).toBe('What is your order number?');
    expect(result.decisions.replyKind).toBe('question');
    expect(result.decisions.log).toEqual([
      { step: 'request_info', detail: 'asked for order number', ok: true },
    ]);
  });

  it('counts its spend on the meter its mode names, under the configuration it ran on (ADR-14b §2.7)', async () => {
    const VERSION = '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a';
    const charged: AiAttribution[] = [];
    const budget = {
      reserve: async (
        _tenant: unknown,
        _meter: unknown,
        _tokens: unknown,
        attribution: AiAttribution,
      ) => {
        charged.push(attribution);
        return {};
      },
      settle: async () => {},
    } as unknown as AiDailyBudget;
    const embeddedFor: unknown[] = [];
    const searched = knowledgeWith(async (_question, _payer, attribution) => {
      embeddedFor.push(attribution);
      return { space: 'test:space', vector: '[1]', usage: { inputTokens: 1 } };
    });
    const turnIn = (overrides: Partial<TurnContext>) =>
      new ConversationEngine({
        llm: new MeteredLlm(new FakeLlmProvider(), budget),
        maxOutputTokens: 400,
        timeoutMs: 20_000,
        maxPromptChars: MAX_PROMPT_CHARS,
        knowledge: searched,
      }).runTurn(
        emptyTurnState(),
        { text: MESSAGE },
        context(workspace(KNOWLEDGE_ANSWER), overrides),
      );

    await turnIn({ mode: 'live', chatId: 'C1', configVersionId: VERSION });
    await turnIn({ mode: 'simulation', chatId: null, configVersionId: VERSION });
    await turnIn({ mode: 'preview', chatId: null, configVersionId: null });

    const expected = [
      { surface: 'ai_agent', chatId: 'C1', configVersionId: VERSION },
      // A simulation is counted on the test meter, never against live traffic.
      { surface: 'simulation', chatId: null, configVersionId: VERSION },
      { surface: 'ai_agent', chatId: null, configVersionId: null },
    ];
    expect(charged).toEqual(expected);
    expect(embeddedFor).toEqual(expected);
  });
});

describe('the model reads the conversation, not just the message (AI-01 · tm 292.3)', () => {
  const HISTORY: TurnHistory = {
    messages: [
      { role: 'user', content: 'Param yatmadı' },
      { role: 'assistant', content: 'Hangi yöntemle ve saat kaçta yatırdınız?' },
    ],
    systemNotes: ['13:41 UTC — Chat transferred'],
    stateDigest: 'Collected so far: method = Papara',
    omitted: false,
    visitorMessages: 1,
  };
  const CATCH_ALL = [{ type: 'send_message', source: 'knowledge' }];

  it('asks with the earlier exchange before the latest message, and the events and state in the instructions', async () => {
    const model = new FakeLlmProvider({ reply: ANSWER });

    const result = await engine(model).runTurn(
      emptyTurnState(),
      { text: 'Papara 13:40', history: HISTORY },
      context(workspace(CATCH_ALL)),
    );

    expect(result.decisions.outcome).toBe('answered');
    const [request] = model.calls;
    expect(request!.messages).toEqual([
      { role: 'user', content: 'Param yatmadı' },
      { role: 'assistant', content: 'Hangi yöntemle ve saat kaçta yatırdınız?' },
      { role: 'user', content: 'Papara 13:40' },
    ]);
    expect(request!.system).toContain('Conversation events: 13:41 UTC — Chat transferred.');
    expect(request!.system).toContain('Conversation state:\nCollected so far: method = Papara');
    // The stub still finds its grounding on the last line, so it still answers.
    const stubbed = await engine(new MockLlmProvider()).runTurn(
      emptyTurnState(),
      { text: 'Papara 13:40', history: HISTORY },
      context(workspace(CATCH_ALL)),
    );
    expect(stubbed.decisions.outcome).toBe('answered');
  });

  it('joins the latest message to an unanswered one before it, so the roles alternate', async () => {
    const model = new FakeLlmProvider({ reply: ANSWER });
    await engine(model).runTurn(
      emptyTurnState(),
      {
        text: 'Papara 13:40',
        history: { ...HISTORY, messages: [{ role: 'user', content: 'Param yatmadı' }] },
      },
      context(workspace(CATCH_ALL)),
    );
    expect(model.calls[0]!.messages).toEqual([
      { role: 'user', content: 'Param yatmadı\nPapara 13:40' },
    ]);
  });

  it('shortens a history over LLM_MAX_PROMPT_CHARS rather than refusing the prompt, keeping the opening message', async () => {
    const model = new FakeLlmProvider({ reply: ANSWER });
    const long: TurnHistory = {
      ...HISTORY,
      messages: Array.from({ length: 30 }, (_, index) => ({
        role: index % 2 === 0 ? ('user' as const) : ('assistant' as const),
        content: index === 0 ? 'OPENING question' : `${index} ${'z'.repeat(300)}`,
      })),
      visitorMessages: 15,
    };

    // Room for the instructions — the platform's locked rules among them
    // (tm 301.3) — the passage and the message, and some of the history.
    const result = await engine(model, 20_000, knowledge, 6_000).runTurn(
      emptyTurnState(),
      { text: MESSAGE, history: long },
      context(workspace(CATCH_ALL)),
    );

    expect(result.decisions).toMatchObject({ outcome: 'answered', failure: null });
    const [request] = model.calls;
    expect(promptLength(request!)).toBeLessThanOrEqual(6_000);
    expect(request!.messages.length).toBeLessThan(long.messages.length);
    expect(request!.messages[0]!.content.startsWith('OPENING question')).toBe(true);
    expect(request!.messages.at(-1)!.content.endsWith(MESSAGE)).toBe(true);
  });

  it('still refuses a prompt the passages and message alone do not fit', async () => {
    const model = new FakeLlmProvider({ reply: ANSWER });
    const result = await engine(model, 20_000, knowledge, 2_000).runTurn(
      emptyTurnState(),
      { text: `${MESSAGE} ${'Please check parcel QX-44917. '.repeat(60)}`, history: HISTORY },
      context(workspace(CATCH_ALL)),
    );
    expect(result.decisions.failure).toMatchObject({ provider: 'llm', kind: 'prompt_too_long' });
    expect(model.calls).toHaveLength(0);
  });

  it('summarises from the visitor’s opening message and counts what they wrote', async () => {
    const result = await engine(new FakeLlmProvider()).runTurn(
      emptyTurnState(),
      { text: 'Papara 13:40', history: HISTORY },
      context(workspace([{ type: 'summarize' }])),
    );
    expect(describeSideEffects(result.sideEffects).summary).toBe(
      'Customer opened with: Param yatmadı (2 messages so far)',
    );
  });
});
