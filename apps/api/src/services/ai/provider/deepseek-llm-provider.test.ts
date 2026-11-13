/**
 * The DeepSeek chat adapter (tm 480 · K51 · ADR §14), through the real
 * `fetch` against a fake `chat/completions` API on 127.0.0.1
 * (`test/helpers/fake-chat-completions.ts`).
 *
 * What is pinned: the request on the wire (DeepSeek's path without `/v1`,
 * `max_tokens`, thinking switched off, `json_object` for structured output —
 * and no `temperature`, `max_completion_tokens`, tools or `stream`); how a
 * reply is read (reasoning never read, blank keep-alive lines, the bill with
 * cached input); and DeepSeek's error table — which failures are retried and
 * which are not. No request leaves the machine and `KEY` is a label, not a
 * credential.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  chatCompletion,
  chatError,
  DEFAULT_CHAT_USAGE,
  startFakeChatCompletions,
  type FakeChatCompletions,
} from '../../../../test/helpers/fake-chat-completions.js';
import type { ChatCompletionsOptions } from './chat-completions-transport.js';
import {
  DEEPSEEK_DEFAULT_BASE_URL,
  DeepSeekLlmProvider,
  classifyDeepSeekFailure,
  readDeepSeekUsage,
} from './deepseek-llm-provider.js';
import type { JsonSchema } from './json-schema.js';
import { LLM_EMPTY_LENGTH_HINT, LlmProviderError } from './llm-error.js';
import type { DeepSeekSettings, LlmCompletionRequest } from './llm-provider.js';
import { completeStructured } from './structured-output.js';

const KEY = 'sk-deepseek-test-only-not-a-credential-Tq5Wn8';
const PROMPT = 'Where is my parcel, order 55123?';
const REQUEST: LlmCompletionRequest = {
  system: 'You are the support assistant. Only use the passage: Parcels travel by courier.',
  messages: [{ role: 'user', content: PROMPT }],
  maxOutputTokens: 400,
  timeoutMs: 20_000,
};
const SCHEMA: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['kind'],
  properties: { kind: { type: 'string', enum: ['order', 'other'] } },
};
const STRUCTURED: LlmCompletionRequest & { responseFormat: { name: string; schema: JsonSchema } } =
  { ...REQUEST, responseFormat: { name: 'question_kind', schema: SCHEMA } };

let fake: FakeChatCompletions;
beforeAll(async () => {
  fake = await startFakeChatCompletions();
});
afterAll(async () => {
  await fake.close();
});
afterEach(() => {
  fake.requests.length = 0;
  fake.reply(chatCompletion('OK'));
});

function recordingLogger() {
  const lines: Array<{ level: string; details: Record<string, unknown>; message: string }> = [];
  const at = (level: string) => (details: Record<string, unknown>, message: string) => {
    lines.push({ level, details, message });
  };
  return {
    lines,
    logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') },
    events: () => lines.map((line) => line.details['event']),
  };
}

function build(settings: Partial<DeepSeekSettings> = {}, options: ChatCompletionsOptions = {}) {
  const log = recordingLogger();
  const sleeps: number[] = [];
  const provider = new DeepSeekLlmProvider(
    { baseUrl: fake.url, model: 'deepseek-flash', fastModel: null, apiKey: KEY, ...settings },
    {
      logger: log.logger,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0,
      ...options,
    },
  );
  return { provider, log, sleeps };
}

async function failure(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(LlmProviderError);
    return error as LlmProviderError;
  }
  throw new Error('expected the call to fail');
}

/** Nothing the log or the error carries may hold the key or the prompt. */
function expectNothingLeaked(log: ReturnType<typeof recordingLogger>, error?: Error) {
  const text = JSON.stringify(log.lines) + (error ? `${error.message}${String(error.stack)}` : '');
  expect(text).not.toContain(KEY);
  expect(text).not.toContain(PROMPT);
}

describe('the request on the wire', () => {
  it('posts model, messages, max_tokens and thinking off to /chat/completions, nothing else', async () => {
    const { provider } = build();
    await provider.complete(REQUEST);

    expect(fake.requests).toHaveLength(1);
    const [sent] = fake.requests;
    expect(sent!.method).toBe('POST');
    // DeepSeek's base URL has no /v1: the endpoint is the host's /chat/completions.
    expect(sent!.path).toBe('/chat/completions');
    expect(sent!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(sent!.headers['content-type']).toBe('application/json');
    expect(sent!.body).toEqual({
      model: 'deepseek-flash',
      messages: [
        { role: 'system', content: REQUEST.system },
        { role: 'user', content: PROMPT },
      ],
      max_tokens: 400,
      thinking: { type: 'disabled' },
    });
    for (const absent of [
      'temperature',
      'top_p',
      'max_completion_tokens',
      'response_format',
      'stream',
      'tools',
    ]) {
      expect(sent!.body).not.toHaveProperty(absent);
    }
  });

  it('defaults to https://api.deepseek.com, the documented base URL without /v1', () => {
    expect(DEEPSEEK_DEFAULT_BASE_URL).toBe('https://api.deepseek.com');
  });

  it('answers a fast-tier call with LLM_MODEL_FAST, and with LLM_MODEL when that is unset', async () => {
    await build({ fastModel: 'deepseek-flash-lite' }).provider.complete({
      ...REQUEST,
      tier: 'fast',
    });
    await build().provider.complete({ ...REQUEST, tier: 'fast' });
    expect(fake.requests.map((request) => request.body['model'])).toEqual([
      'deepseek-flash-lite',
      'deepseek-flash',
    ]);
  });

  it('asks for json_object with the schema and the word "json" in the system prompt', async () => {
    fake.reply(chatCompletion('{"kind":"order"}'));
    const { provider } = build();
    const result = await completeStructured(provider, STRUCTURED);

    expect(result).toEqual({
      value: { kind: 'order' },
      usage: { inputTokens: 120, outputTokens: 30 },
      tries: 1,
    });
    const body = fake.requests[0]!.body;
    expect(body['response_format']).toEqual({ type: 'json_object' });
    const system = (body['messages'] as Array<{ role: string; content: string }>)[0]!;
    expect(system.role).toBe('system');
    expect(system.content.startsWith(REQUEST.system)).toBe(true);
    expect(system.content).toContain('json');
    expect(system.content).toContain(JSON.stringify(SCHEMA));
  });
});

describe('the reply', () => {
  it('reads the trimmed content and the bill', async () => {
    fake.reply(chatCompletion('  Parcels arrive in three days.  '));
    const completion = await build().provider.complete(REQUEST);
    expect(completion).toEqual({
      text: 'Parcels arrive in three days.',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
  });

  it('never reads reasoning_content: the reply is content alone', async () => {
    fake.reply(
      chatCompletion('The answer.', {
        message: { reasoning_content: 'REASONING-NEVER-READ about order 55123' },
      }),
    );
    const { provider, log } = build();
    const completion = await provider.complete(REQUEST);
    expect(completion.text).toBe('The answer.');
    expect(JSON.stringify(log.lines)).not.toContain('REASONING-NEVER-READ');
  });

  it('is no_answer / empty when only reasoning came back, and billed', async () => {
    fake.reply(chatCompletion('', { message: { reasoning_content: 'thinking only' } }));
    const error = await failure(build().provider.complete(REQUEST));
    expect(error.kind).toBe('no_answer');
    expect(error.reason).toBe('empty');
    expect(error.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
  });

  it('is no_answer / length with the operator hint when the ceiling ran out before any text', async () => {
    fake.reply(
      chatCompletion(null, { finish_reason: 'length', message: { reasoning_content: 'long' } }),
    );
    const error = await failure(build().provider.complete(REQUEST));
    expect(error.kind).toBe('no_answer');
    expect(error.reason).toBe('length');
    expect(error.hint).toBe(LLM_EMPTY_LENGTH_HINT);
  });

  it('reads a body that starts with keep-alive blank lines', async () => {
    const reply = chatCompletion('Kept alive.');
    fake.reply({ ...reply, raw: `\n\n\n${JSON.stringify(reply.body)}` });
    const completion = await build().provider.complete(REQUEST);
    expect(completion.text).toBe('Kept alive.');
  });

  it('bills cached input: prompt_tokens, or the cache counts when a body says less', () => {
    expect(
      readDeepSeekUsage({
        prompt_tokens: 100,
        completion_tokens: 7,
        prompt_cache_hit_tokens: 60,
        prompt_cache_miss_tokens: 40,
      }),
    ).toEqual({ inputTokens: 100, outputTokens: 7 });
    expect(
      readDeepSeekUsage({
        prompt_tokens: 10,
        completion_tokens: 7,
        prompt_cache_hit_tokens: 60,
        prompt_cache_miss_tokens: 40,
      }),
    ).toEqual({ inputTokens: 100, outputTokens: 7 });
    expect(readDeepSeekUsage(DEFAULT_CHAT_USAGE)).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(readDeepSeekUsage({ prompt_tokens: 'x', completion_tokens: 1 })).toBeNull();
  });

  it('gives JSON mode its one retry when it answers whitespace only, as DeepSeek warns it can', async () => {
    fake.reply(chatCompletion('   '), chatCompletion('{"kind":"other"}'));
    const result = await completeStructured(build().provider, STRUCTURED);
    expect(result.value).toEqual({ kind: 'other' });
    expect(result.tries).toBe(2);
    expect(result.usage).toEqual({ inputTokens: 240, outputTokens: 60 });
  });
});

describe("DeepSeek's error table", () => {
  it.each([
    [400, 'bad_request'],
    [401, 'auth'],
    [402, 'quota_exhausted'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [422, 'bad_request'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [503, 'unavailable'],
  ] as const)('classifies %i as %s', (status, kind) => {
    expect(classifyDeepSeekFailure(status)).toBe(kind);
  });

  it('does not retry 402 Insufficient Balance: no retry tops the balance up', async () => {
    fake.reply(
      chatError(402, { message: `Insufficient Balance for ${KEY}: ${PROMPT}` }),
      chatCompletion('never reached'),
    );
    const { provider, log, sleeps } = build();
    const error = await failure(provider.complete(REQUEST));
    expect(error.kind).toBe('quota_exhausted');
    expect(error.transient).toBe(false);
    expect(error.status).toBe(402);
    expect(fake.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expectNothingLeaked(log, error);
  });

  it.each([400, 401, 422])('does not retry %i', async (status) => {
    fake.reply(chatError(status, { message: `${KEY} ${PROMPT}` }), chatCompletion('never'));
    const { provider, log } = build();
    const error = await failure(provider.complete(REQUEST));
    expect(error.transient).toBe(false);
    expect(fake.requests).toHaveLength(1);
    expectNothingLeaked(log, error);
  });

  it('retries 429 Rate Limit Reached, no sooner than Retry-After', async () => {
    fake.reply(chatError(429, {}, { 'retry-after': '3' }), chatCompletion('After the wait.'));
    const { provider, sleeps, log } = build();
    const completion = await provider.complete(REQUEST);
    expect(completion.text).toBe('After the wait.');
    expect(fake.requests).toHaveLength(2);
    expect(sleeps).toEqual([3_000]);
    expect(log.events()).toContain('llm.retry');
  });

  it('retries 500 and 503 up to three attempts, then fails as unavailable', async () => {
    fake.reply(chatError(500), chatError(503));
    const { provider, sleeps } = build();
    const error = await failure(provider.complete(REQUEST));
    expect(error.kind).toBe('unavailable');
    expect(error.transient).toBe(true);
    expect(error.attempts).toBe(3);
    expect(fake.requests).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it('retries a finish_reason of insufficient_system_resource as DeepSeek failing', async () => {
    fake.reply(
      chatCompletion('half', { finish_reason: 'insufficient_system_resource' }),
      chatCompletion('Whole answer.'),
    );
    const { provider } = build();
    const completion = await provider.complete(REQUEST);
    expect(completion.text).toBe('Whole answer.');
    expect(fake.requests).toHaveLength(2);
  });

  it('refuses a redirect rather than follow it with the conversation', async () => {
    fake.reply({ status: 302, headers: { location: 'http://127.0.0.1:1/elsewhere' } });
    const error = await failure(build().provider.complete(REQUEST));
    expect(error.kind).toBe('bad_response');
    expect(error.reason).toBe('redirect');
    expect(fake.requests).toHaveLength(1);
  });

  it('keeps the key and the prompt out of every log line and error', async () => {
    fake.reply(chatError(401, { message: `Authentication Fails, your api key: ${KEY} ${PROMPT}` }));
    const { provider, log } = build();
    const error = await failure(provider.complete(REQUEST));
    expect(error.kind).toBe('auth');
    expect(log.lines.every((line) => line.details['provider'] === 'deepseek')).toBe(true);
    expectNothingLeaked(log, error);
  });
});

describe('configuration', () => {
  it('refuses a key an HTTP header cannot carry, and a base URL with a query', () => {
    expect(() => build({ apiKey: 'sk-with\nnewline' })).toThrow(
      'LLM_API_KEY contains whitespace or characters an HTTP header cannot carry.',
    );
    expect(() => build({ baseUrl: 'https://api.deepseek.com/?x=1' })).toThrow(
      /must not have a query string or fragment/,
    );
  });
});
