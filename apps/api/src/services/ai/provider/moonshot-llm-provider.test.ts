/**
 * The Kimi (Moonshot) chat adapter (tm 480 · K51 · ADR §14), through the real
 * `fetch` against a fake `chat/completions` API on 127.0.0.1
 * (`test/helpers/fake-chat-completions.ts`).
 *
 * What is pinned: the request on the wire (`/v1/chat/completions`,
 * `max_completion_tokens`, `reasoning_effort: low`, `json_schema` for
 * structured output and its `json_object` fallback — and no `temperature`,
 * `max_tokens` or `thinking`); how a reply is read (reasoning never read, the
 * bill with cached input); and Kimi's error table, whose 429 means three
 * different things. No request leaves the machine and `KEY` is a label, not a
 * credential.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  chatCompletion,
  chatError,
  startFakeChatCompletions,
  type FakeChatCompletions,
} from '../../../../test/helpers/fake-chat-completions.js';
import type { ChatCompletionsOptions } from './chat-completions-transport.js';
import type { JsonSchema } from './json-schema.js';
import { LLM_MOONSHOT_EMPTY_LENGTH_HINT, LlmProviderError } from './llm-error.js';
import type { LlmCompletionRequest, MoonshotSettings } from './llm-provider.js';
import {
  MOONSHOT_DEFAULT_BASE_URL,
  MoonshotLlmProvider,
  classifyMoonshotFailure,
  readMoonshotUsage,
} from './moonshot-llm-provider.js';
import { completeStructured } from './structured-output.js';

const KEY = 'sk-moonshot-test-only-not-a-credential-Hy3Pd6';
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

function build(settings: Partial<MoonshotSettings> = {}, options: ChatCompletionsOptions = {}) {
  const log = recordingLogger();
  const sleeps: number[] = [];
  const provider = new MoonshotLlmProvider(
    { baseUrl: `${fake.url}/v1`, model: 'kimi-k3', fastModel: null, apiKey: KEY, ...settings },
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

function systemOf(body: Record<string, unknown>): string {
  const [first] = body['messages'] as Array<{ role: string; content: string }>;
  expect(first!.role).toBe('system');
  return first!.content;
}

describe('the request on the wire', () => {
  it('posts model, messages, max_completion_tokens and reasoning_effort low, nothing else', async () => {
    const { provider } = build();
    await provider.complete(REQUEST);

    expect(fake.requests).toHaveLength(1);
    const [sent] = fake.requests;
    expect(sent!.method).toBe('POST');
    expect(sent!.path).toBe('/v1/chat/completions');
    expect(sent!.headers['authorization']).toBe(`Bearer ${KEY}`);
    expect(sent!.body).toEqual({
      model: 'kimi-k3',
      messages: [
        { role: 'system', content: REQUEST.system },
        { role: 'user', content: PROMPT },
      ],
      max_completion_tokens: 400,
      reasoning_effort: 'low',
    });
    for (const absent of [
      'temperature',
      'top_p',
      'max_tokens',
      'thinking',
      'response_format',
      'stream',
      'tools',
    ]) {
      expect(sent!.body).not.toHaveProperty(absent);
    }
  });

  it('defaults to https://api.moonshot.ai/v1, the international platform', () => {
    expect(MOONSHOT_DEFAULT_BASE_URL).toBe('https://api.moonshot.ai/v1');
  });

  it('answers a fast-tier call with LLM_MODEL_FAST', async () => {
    await build({ fastModel: 'kimi-k3-fast' }).provider.complete({ ...REQUEST, tier: 'fast' });
    expect(fake.requests[0]!.body['model']).toBe('kimi-k3-fast');
  });

  it('asks for json_schema, strict, with the schema in the system prompt too', async () => {
    fake.reply(chatCompletion('{"kind":"order"}'));
    const result = await completeStructured(build().provider, STRUCTURED);

    expect(result.value).toEqual({ kind: 'order' });
    const body = fake.requests[0]!.body;
    expect(body['response_format']).toEqual({
      type: 'json_schema',
      json_schema: { name: 'question_kind', schema: SCHEMA, strict: true },
    });
    expect(systemOf(body)).toContain(JSON.stringify(SCHEMA));
  });
});

describe('structured output: json_schema, then json_object for a model that refuses it', () => {
  it('goes on as json_object at once after invalid_request_error, and remembers the model', async () => {
    fake.reply(
      chatError(400, { type: 'invalid_request_error', message: `bad schema ${KEY}` }),
      chatCompletion('{"kind":"other"}'),
    );
    const { provider, log, sleeps } = build();
    const result = await completeStructured(provider, STRUCTURED);

    expect(result.value).toEqual({ kind: 'other' });
    expect(fake.requests).toHaveLength(2);
    expect(fake.requests[1]!.body['response_format']).toEqual({ type: 'json_object' });
    expect(systemOf(fake.requests[1]!.body)).toContain(JSON.stringify(SCHEMA));
    expect(sleeps).toEqual([]);
    expect(log.events()).toContain('llm.json_schema_unsupported');
    expect(provider.structuredOutputsRefusedBy('kimi-k3')).toBe(true);
    expectNothingLeaked(log);

    // The next structured call starts as json_object: one request.
    fake.requests.length = 0;
    fake.reply(chatCompletion('{"kind":"order"}'));
    await completeStructured(provider, STRUCTURED);
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.body['response_format']).toEqual({ type: 'json_object' });
  });

  it('does not take a content-filter 400 for a missing feature', async () => {
    fake.reply(chatError(400, { type: 'content_filter' }), chatCompletion('{"kind":"other"}'));
    const { provider } = build();
    const error = await failure(completeStructured(provider, STRUCTURED));
    expect(error.kind).toBe('bad_request');
    expect(error.code).toBe('content_filter');
    expect(fake.requests).toHaveLength(1);
    expect(provider.structuredOutputsRefusedBy('kimi-k3')).toBe(false);
  });

  it('does not fall back on a plain request: there is no mode to change', async () => {
    fake.reply(chatError(400, { type: 'invalid_request_error' }), chatCompletion('never'));
    const error = await failure(build().provider.complete(REQUEST));
    expect(error.kind).toBe('bad_request');
    expect(fake.requests).toHaveLength(1);
  });
});

describe('the reply', () => {
  it('reads the trimmed content and never reasoning_content', async () => {
    fake.reply(
      chatCompletion(' The answer. ', {
        message: { reasoning_content: 'REASONING-NEVER-READ about order 55123' },
        usage: {
          prompt_tokens: 200,
          completion_tokens: 90,
          completion_tokens_details: { reasoning_tokens: 60 },
        },
      }),
    );
    const { provider, log } = build();
    const completion = await provider.complete(REQUEST);
    expect(completion).toEqual({
      text: 'The answer.',
      usage: { inputTokens: 200, outputTokens: 90 },
    });
    expect(JSON.stringify(log.lines)).not.toContain('REASONING-NEVER-READ');
  });

  it('is no_answer / empty when only reasoning came back', async () => {
    fake.reply(chatCompletion(null, { message: { reasoning_content: 'thinking only' } }));
    const error = await failure(build().provider.complete(REQUEST));
    expect(error.kind).toBe('no_answer');
    expect(error.reason).toBe('empty');
  });

  it("says Kimi's reasoning spent the ceiling when it ran out before any text", async () => {
    fake.reply(chatCompletion('', { finish_reason: 'length' }));
    const error = await failure(build().provider.complete(REQUEST));
    expect(error.kind).toBe('no_answer');
    expect(error.reason).toBe('length');
    expect(error.hint).toBe(LLM_MOONSHOT_EMPTY_LENGTH_HINT);
  });

  it('bills prompt_tokens, cached input included; the cache counts when a body says less', () => {
    expect(
      readMoonshotUsage({
        prompt_tokens: 100,
        completion_tokens: 5,
        cached_tokens: 70,
        prompt_tokens_details: { cached_tokens: 70, cache_write_tokens: 20 },
      }),
    ).toEqual({ inputTokens: 100, outputTokens: 5 });
    expect(
      readMoonshotUsage({
        prompt_tokens: 10,
        completion_tokens: 5,
        prompt_tokens_details: { cached_tokens: 70, cache_write_tokens: 20 },
      }),
    ).toEqual({ inputTokens: 90, outputTokens: 5 });
    expect(readMoonshotUsage({ completion_tokens: 5 })).toBeNull();
  });
});

describe("Kimi's error table", () => {
  it.each([
    [400, 'invalid_request_error', 'bad_request'],
    [400, 'content_filter', 'bad_request'],
    [401, 'invalid_authentication_error', 'auth'],
    [401, 'incorrect_api_key_error', 'auth'],
    [403, 'permission_denied_error', 'forbidden'],
    [404, 'resource_not_found_error', 'not_found'],
    [429, 'exceeded_current_quota_error', 'quota_exhausted'],
    [429, 'engine_overloaded_error', 'unavailable'],
    [429, 'rate_limit_reached_error', 'rate_limited'],
    [500, 'server_error', 'unavailable'],
    [503, 'server_unavailable', 'unavailable'],
    [504, null, 'unavailable'],
  ] as const)('classifies %i %s as %s', (status, type, kind) => {
    expect(classifyMoonshotFailure(status, { code: null, type })).toBe(kind);
  });

  it('does not retry exceeded_current_quota_error: the balance is used up', async () => {
    fake.reply(
      chatError(429, { type: 'exceeded_current_quota_error', message: `${KEY} ${PROMPT}` }),
      chatCompletion('never reached'),
    );
    const { provider, log, sleeps } = build();
    const error = await failure(provider.complete(REQUEST));
    expect(error.kind).toBe('quota_exhausted');
    expect(error.transient).toBe(false);
    expect(error.code).toBe('exceeded_current_quota_error');
    expect(fake.requests).toHaveLength(1);
    expect(sleeps).toEqual([]);
    expectNothingLeaked(log, error);
  });

  it('retries engine_overloaded_error no sooner than Retry-After', async () => {
    fake.reply(
      chatError(429, { type: 'engine_overloaded_error' }, { 'retry-after': '2' }),
      chatCompletion('Back again.'),
    );
    const { provider, sleeps } = build();
    expect((await provider.complete(REQUEST)).text).toBe('Back again.');
    expect(fake.requests).toHaveLength(2);
    expect(sleeps).toEqual([2_000]);
  });

  it('retries rate_limit_reached_error, then fails as rate_limited after three attempts', async () => {
    fake.reply(chatError(429, { type: 'rate_limit_reached_error' }));
    const { provider, sleeps } = build();
    const error = await failure(provider.complete(REQUEST));
    expect(error.kind).toBe('rate_limited');
    expect(error.attempts).toBe(3);
    expect(fake.requests).toHaveLength(3);
    expect(sleeps).toHaveLength(2);
  });

  it.each([401, 403, 404])('does not retry %i', async (status) => {
    fake.reply(chatError(status, { message: `${KEY} ${PROMPT}` }), chatCompletion('never'));
    const { provider, log } = build();
    const error = await failure(provider.complete(REQUEST));
    expect(error.transient).toBe(false);
    expect(fake.requests).toHaveLength(1);
    expect(log.lines.every((line) => line.details['provider'] === 'moonshot')).toBe(true);
    expectNothingLeaked(log, error);
  });
});
