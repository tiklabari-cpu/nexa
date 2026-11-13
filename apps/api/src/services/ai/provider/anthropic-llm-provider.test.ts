/**
 * The Claude chat adapter (tm 479 · K51 · ADR §13), through the official SDK
 * against a fake Messages API on 127.0.0.1 (`test/helpers/fake-anthropic.ts`).
 *
 * What is pinned: the request the SDK puts on the wire (what is in it — model,
 * `max_tokens`, `system`, `output_config`, `inference_geo`, the fallback beta —
 * and what is not: `temperature`, `top_p`, `top_k`, `thinking`, `stream`), how
 * a reply is read (text after the last fallback switch, thinking dropped, the
 * bill with both cache counts and every attempt), and how each failure is
 * classified, retried and kept out of the log. No request leaves the machine
 * and `KEY` is a label, not a credential.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  anthropicError,
  anthropicMessage,
  DEFAULT_USAGE,
  startFakeAnthropic,
  type FakeAnthropic,
} from '../../../../test/helpers/fake-anthropic.js';
import { KNOWLEDGE_ANSWER_SCHEMA } from '../conversation/knowledge-answer.js';
import { SOP_DRAFT_SCHEMA } from '../conversation/procedure/sop-draft.js';
import { UNDERSTAND_SCHEMA } from '../conversation/understand.js';
import { QUESTION_KIND_SCHEMA } from '../copilot-question-kind.js';
import { GUIDANCE_CHECK_SCHEMA } from '../guidance-check.js';
import {
  ANTHROPIC_FALLBACK_BETA,
  AnthropicLlmProvider,
  anthropicConversation,
  anthropicOutputSchema,
  type AnthropicLlmProviderOptions,
} from './anthropic-llm-provider.js';
import type { JsonSchema } from './json-schema.js';
import { LLM_ANTHROPIC_EMPTY_LENGTH_HINT, LlmProviderError } from './llm-error.js';
import type { AnthropicSettings, LlmCompletionRequest } from './llm-provider.js';
import { completeStructured } from './structured-output.js';

const KEY = 'sk-ant-test-only-not-a-credential-Qw8Zr4';
const PROMPT = 'Where is my parcel, order 55123?';
const REQUEST: LlmCompletionRequest = {
  system: 'You are the support assistant. Only use the passage: Parcels travel by courier.',
  messages: [{ role: 'user', content: PROMPT }],
  maxOutputTokens: 400,
  timeoutMs: 20_000,
};

let fake: FakeAnthropic;
beforeAll(async () => {
  fake = await startFakeAnthropic();
});
afterAll(async () => {
  await fake.close();
});
afterEach(() => {
  fake.requests.length = 0;
  fake.reply(anthropicMessage('OK'));
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

function build(
  settings: Partial<AnthropicSettings> = {},
  options: AnthropicLlmProviderOptions = {},
) {
  const log = recordingLogger();
  const sleeps: number[] = [];
  const provider = new AnthropicLlmProvider(
    {
      baseUrl: fake.url,
      model: 'claude-opus-5-5',
      fastModel: 'claude-haiku-5-5',
      apiKey: KEY,
      region: 'us',
      effort: 'low',
      fallback: true,
      ...settings,
    },
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
  it('sends model, max_tokens, system, messages, effort, cache_control, inference_geo and the fallback beta', async () => {
    const { provider } = build();
    await provider.complete(REQUEST);

    expect(fake.requests).toHaveLength(1);
    const [sent] = fake.requests;
    expect(sent!.method).toBe('POST');
    expect(sent!.path).toBe('/v1/messages');
    expect(sent!.headers['anthropic-beta']).toBe(ANTHROPIC_FALLBACK_BETA);
    expect(sent!.headers['anthropic-version']).toBeTruthy();
    expect(sent!.headers['authorization'] ?? sent!.headers['x-api-key']).toContain(KEY);
    expect(sent!.body).toEqual({
      model: 'claude-opus-5-5',
      max_tokens: 400,
      system: REQUEST.system,
      messages: [{ role: 'user', content: PROMPT }],
      output_config: { effort: 'low' },
      cache_control: { type: 'ephemeral' },
      inference_geo: 'us',
      fallbacks: 'default',
    });
  });

  it('never sends temperature, top_p, top_k, thinking, stream or tools', async () => {
    const { provider } = build();
    await provider.complete({ ...REQUEST, tier: 'fast' });
    const body = fake.requests[0]!.body;
    for (const field of ['temperature', 'top_p', 'top_k', 'thinking', 'stream', 'tools']) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it('uses LLM_MODEL_FAST for the fast tier and LLM_MODEL otherwise', async () => {
    const { provider } = build();
    await provider.complete({ ...REQUEST, tier: 'fast' });
    await provider.complete(REQUEST);
    expect(fake.requests.map((request) => request.body['model'])).toEqual([
      'claude-haiku-5-5',
      'claude-opus-5-5',
    ]);
  });

  it('with the fallback off: the plain endpoint, no beta header, no fallbacks', async () => {
    const { provider } = build({ fallback: false, effort: 'high' });
    await provider.complete(REQUEST);
    const [sent] = fake.requests;
    expect(sent!.path).toBe('/v1/messages');
    expect(sent!.headers['anthropic-beta']).toBeUndefined();
    expect(sent!.body).not.toHaveProperty('fallbacks');
    expect(sent!.body).not.toHaveProperty('betas');
    expect(sent!.body['output_config']).toEqual({ effort: 'high' });
  });

  it('pins nothing for eu (there is no EU pin) and says so once, at construction', async () => {
    const { provider, log } = build({ region: 'eu' });
    expect(log.events()).toEqual(['llm.inference_geo_unpinned']);
    await provider.complete(REQUEST);
    expect(fake.requests[0]!.body).not.toHaveProperty('inference_geo');
    expect(log.events()).not.toContain('llm.inference_geo_mismatch');
  });

  it('sends a structured request as output_config.format with an API-shaped schema', async () => {
    const { provider } = build();
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        note: { type: ['string', 'null'] },
        tags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      },
      required: ['confidence', 'note', 'tags'],
      additionalProperties: false,
    };
    fake.reply(anthropicMessage('{"confidence":0.4,"note":null,"tags":["a"]}'));
    const result = await completeStructured(provider, {
      ...REQUEST,
      responseFormat: { name: 'check', schema },
    });
    expect(result).toMatchObject({ value: { confidence: 0.4, note: null, tags: ['a'] }, tries: 1 });

    const config = fake.requests[0]!.body['output_config'] as Record<string, unknown>;
    expect(config['effort']).toBe('low');
    expect(config['format']).toEqual({
      type: 'json_schema',
      schema: {
        type: 'object',
        properties: {
          confidence: { type: 'number', description: '{minimum: 0, maximum: 1}' },
          note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          tags: { type: 'array', items: { type: 'string' }, description: '{maxItems: 3}' },
        },
        required: ['confidence', 'note', 'tags'],
        additionalProperties: false,
      },
    });
  });

  it('refuses a prompt that ends with an assistant turn — no request, not the provider’s fault', async () => {
    const { provider, log } = build();
    const error = await failure(
      provider.complete({
        ...REQUEST,
        messages: [...REQUEST.messages, { role: 'assistant', content: 'Sure,' }],
      }),
    );
    expect(error).toMatchObject({ kind: 'bad_request', reason: 'prompt_invalid', status: null });
    expect(error.providerFault).toBe(false);
    expect(fake.requests).toHaveLength(0);
    expectNothingLeaked(log, error);
  });

  it('moves assistant turns before the first customer turn into the system prompt', () => {
    expect(
      anthropicConversation('Rules.', [
        { role: 'assistant', content: 'Hi! How can I help?' },
        { role: 'user', content: 'My deposit' },
        { role: 'assistant', content: 'Which one?' },
        { role: 'user', content: 'Yesterday' },
      ]),
    ).toEqual({
      system:
        "Rules.\n\nBefore the customer's first message, the conversation opened with this message from you:\nHi! How can I help?",
      messages: [
        { role: 'user', content: 'My deposit' },
        { role: 'assistant', content: 'Which one?' },
        { role: 'user', content: 'Yesterday' },
      ],
    });
    expect(anthropicConversation('Rules.', [])).toBeNull();
  });
});

describe('reading the reply', () => {
  it('joins the text blocks, drops thinking, and counts input with both cache counts', async () => {
    const { provider, log } = build();
    fake.reply(
      anthropicMessage(
        [
          { type: 'thinking', thinking: '', signature: 'sig' },
          { type: 'text', text: 'Parcels arrive ' },
          { type: 'text', text: 'in three days.' },
        ],
        {
          usage: {
            input_tokens: 50,
            cache_creation_input_tokens: 400,
            cache_read_input_tokens: 1_000,
            output_tokens: 90,
            inference_geo: 'us',
          },
        },
      ),
    );
    const completion = await provider.complete(REQUEST);
    expect(completion).toEqual({
      text: 'Parcels arrive in three days.',
      usage: { inputTokens: 1_450, outputTokens: 90 },
    });
    const done = log.lines.find((line) => line.details['event'] === 'llm.completed');
    expect(done?.details).toMatchObject({
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      attempts: 1,
      inputTokens: 1_450,
      outputTokens: 90,
    });
    expect(log.events()).not.toContain('llm.inference_geo_mismatch');
    expectNothingLeaked(log);
  });

  it('a fallback: text after the switch only, every attempt billed, the serving model logged', async () => {
    const { provider, log } = build();
    fake.reply(
      anthropicMessage(
        [
          { type: 'text', text: 'Partial from the declined model' },
          {
            type: 'fallback',
            from: { model: 'claude-opus-5-5' },
            to: { model: 'claude-opus-4-8' },
            trigger: { type: 'refusal' },
          },
          { type: 'text', text: 'The answer.' },
        ],
        {
          model: 'claude-opus-4-8',
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            inference_geo: 'us',
            iterations: [
              {
                type: 'message',
                model: 'claude-opus-5-5',
                input_tokens: 100,
                output_tokens: 7,
                cache_creation_input_tokens: 10,
                cache_read_input_tokens: 0,
              },
              {
                type: 'fallback_message',
                model: 'claude-opus-4-8',
                input_tokens: 100,
                output_tokens: 20,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            ],
          },
        },
      ),
    );
    const completion = await provider.complete(REQUEST);
    expect(completion).toEqual({
      text: 'The answer.',
      usage: { inputTokens: 210, outputTokens: 27 },
    });
    const served = log.lines.find((line) => line.details['event'] === 'llm.fallback_served');
    expect(served?.details).toMatchObject({
      model: 'claude-opus-5-5',
      servedModel: 'claude-opus-4-8',
    });
  });

  it('warns when the reply was not inferred in the pinned geography', async () => {
    const { provider, log } = build();
    fake.reply(anthropicMessage('OK', { usage: { ...DEFAULT_USAGE, inference_geo: 'global' } }));
    await provider.complete(REQUEST);
    const line = log.lines.find((entry) => entry.details['event'] === 'llm.inference_geo_mismatch');
    expect(line).toMatchObject({ level: 'warn', details: { expected: 'us', reported: 'global' } });
  });

  it('a refusal is no_answer/refusal with its category — billed, not retried, not the provider’s fault', async () => {
    const { provider, log } = build();
    fake.reply(
      anthropicMessage([], {
        stop_reason: 'refusal',
        stop_details: { type: 'refusal', category: 'cyber', explanation: 'quotes the prompt' },
        usage: { ...DEFAULT_USAGE, output_tokens: 0 },
      }),
    );
    const error = await failure(provider.complete(REQUEST));
    expect(error).toMatchObject({
      kind: 'no_answer',
      reason: 'refusal',
      code: 'cyber',
      usage: { inputTokens: 120, outputTokens: 0 },
    });
    expect(error.providerFault).toBe(false);
    expect(fake.requests).toHaveLength(1);
    expect(JSON.stringify(log.lines)).not.toContain('quotes the prompt');
  });

  it('max_tokens before any text is no_answer/length with the Claude hint; with text, length alone', async () => {
    const { provider } = build();
    fake.reply(
      anthropicMessage([{ type: 'thinking', thinking: '', signature: 's' }], {
        stop_reason: 'max_tokens',
      }),
    );
    expect(await failure(provider.complete(REQUEST))).toMatchObject({
      kind: 'no_answer',
      reason: 'length',
      hint: LLM_ANTHROPIC_EMPTY_LENGTH_HINT,
    });

    fake.reply(anthropicMessage('Parcels arri', { stop_reason: 'max_tokens' }));
    expect(await failure(provider.complete(REQUEST))).toMatchObject({
      kind: 'no_answer',
      reason: 'length',
      hint: null,
    });
  });

  it('an empty answer and an unexpected shape fail as no_answer and bad_response', async () => {
    const { provider } = build();
    fake.reply(anthropicMessage('   '));
    expect(await failure(provider.complete(REQUEST))).toMatchObject({
      kind: 'no_answer',
      reason: 'empty',
    });
    fake.reply({ status: 200, body: { type: 'message', content: [{ type: 'text', text: 'x' }] } });
    expect(await failure(provider.complete(REQUEST))).toMatchObject({
      kind: 'bad_response',
      reason: 'shape',
    });
  });

  it('a structured reply the model refused gets completeStructured’s one retry', async () => {
    const { provider } = build();
    fake.reply(
      anthropicMessage([], { stop_reason: 'refusal', stop_details: null }),
      anthropicMessage('{"ok":true}'),
    );
    const schema: JsonSchema = {
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
      additionalProperties: false,
    };
    const result = await completeStructured(provider, {
      ...REQUEST,
      responseFormat: { name: 'ok', schema },
    });
    expect(result).toMatchObject({ value: { ok: true }, tries: 2 });
    expect(fake.requests).toHaveLength(2);
  });
});

describe('failures', () => {
  it('retries a 429 no sooner than retry-after, then answers', async () => {
    const { provider, sleeps, log } = build();
    fake.reply(
      anthropicError(429, 'rate_limit_error', { headers: { 'retry-after': '3' } }),
      anthropicMessage('OK'),
    );
    await expect(provider.complete(REQUEST)).resolves.toMatchObject({ text: 'OK' });
    expect(fake.requests).toHaveLength(2);
    expect(sleeps).toEqual([3_000]);
    const retry = log.lines.find((line) => line.details['event'] === 'llm.retry');
    expect(retry?.details).toMatchObject({
      kind: 'rate_limited',
      transient: true,
      status: 429,
      code: 'rate_limit_error',
      requestId: 'req_011CTest',
    });
  });

  it('retries 529 overloaded and 500 as unavailable', async () => {
    const { provider } = build();
    fake.reply(
      anthropicError(529, 'overloaded_error'),
      anthropicError(500, 'api_error'),
      anthropicMessage('OK'),
    );
    await expect(provider.complete(REQUEST)).resolves.toMatchObject({ text: 'OK' });
    expect(fake.requests).toHaveLength(3);
  });

  it('gives up after the attempts with the last failure', async () => {
    const { provider } = build();
    fake.reply(anthropicError(529, 'overloaded_error'));
    const error = await failure(provider.complete(REQUEST));
    expect(error).toMatchObject({ kind: 'unavailable', status: 529, attempts: 3 });
    expect(fake.requests).toHaveLength(3);
  });

  it.each([
    [401, 'authentication_error', 'auth'],
    [403, 'permission_error', 'forbidden'],
    [404, 'not_found_error', 'not_found'],
    [400, 'invalid_request_error', 'bad_request'],
    [413, 'request_too_large', 'bad_request'],
    [402, 'billing_error', 'quota_exhausted'],
  ] as const)(
    '%i %s is %s — never retried, the key and the message nowhere',
    async (status, type, kind) => {
      const { provider, log } = build();
      fake.reply(anthropicError(status, type, { message: `Invalid key ${KEY}. Input: ${PROMPT}` }));
      const error = await failure(provider.complete(REQUEST));
      expect(error).toMatchObject({ kind, status, code: type, attempts: 1, transient: false });
      expect(fake.requests).toHaveLength(1);
      expectNothingLeaked(log, error);
      expect(JSON.stringify(log.lines)).not.toContain('Invalid key');
    },
  );

  it('a redirect is refused, not followed', async () => {
    const { provider } = build();
    fake.reply({ status: 307, headers: { location: `${fake.url}/elsewhere` }, raw: '' });
    expect(await failure(provider.complete(REQUEST))).toMatchObject({
      kind: 'bad_response',
      reason: 'redirect',
      status: 307,
    });
    expect(fake.requests).toHaveLength(1);
  });

  it('a body over the cap is not read: bad_response/too_large', async () => {
    const { provider } = build();
    fake.reply(anthropicMessage('x'.repeat(1_100_000)));
    expect(await failure(provider.complete(REQUEST))).toMatchObject({
      kind: 'bad_response',
      reason: 'too_large',
    });
  });

  it('the deadline covers the call: a provider that does not answer in time is a timeout', async () => {
    const { provider } = build();
    fake.reply({ ...anthropicMessage('late'), delayMs: 5_000 });
    const started = Date.now();
    const error = await failure(provider.complete({ ...REQUEST, timeoutMs: 1_200 }));
    expect(error.kind).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it('a refused connection is network, retried', async () => {
    const closed = await startFakeAnthropic();
    const url = closed.url;
    await closed.close();
    const { provider } = build({ baseUrl: url }, { maxAttempts: 2 });
    const error = await failure(provider.complete(REQUEST));
    expect(error).toMatchObject({ kind: 'network', attempts: 2 });
  });

  it('opens the circuit after consecutive provider failures and stops calling', async () => {
    const { provider, log } = build({}, { maxAttempts: 1, circuit: { failureThreshold: 2 } });
    fake.reply(anthropicError(500, 'api_error'));
    await failure(provider.complete(REQUEST));
    await failure(provider.complete(REQUEST));
    expect(provider.circuitState).toBe('open');
    expect(await failure(provider.complete(REQUEST))).toMatchObject({ kind: 'circuit_open' });
    expect(fake.requests).toHaveLength(2);
    expect(log.events()).toContain('llm.circuit_opened');
  });

  it('refuses a key an HTTP header cannot carry, at construction', () => {
    expect(() => build({ apiKey: 'sk-ant\nbroken' })).toThrow(/LLM_API_KEY contains whitespace/);
  });
});

/**
 * The strict subset (`json-schema.ts`) against what the Messages API takes:
 * after the conversion every node uses only keywords the API constrains on,
 * `type` is one name, objects close with `additionalProperties: false`, and
 * `minItems` is 0 or 1. Run over a schema with every keyword of the subset and
 * over the product's own structured-output schemas.
 */
describe('anthropicOutputSchema', () => {
  const ALLOWED = new Set([
    'type',
    'description',
    'enum',
    'anyOf',
    'properties',
    'required',
    'additionalProperties',
    'items',
    'minItems',
  ]);

  function expectApiShaped(node: unknown, path = '$'): void {
    expect(typeof node, path).toBe('object');
    const record = node as Record<string, unknown>;
    for (const key of Object.keys(record)) expect(ALLOWED.has(key), `${path}.${key}`).toBe(true);
    if ('type' in record) expect(typeof record['type'], `${path}.type`).toBe('string');
    if (record['type'] === 'object') {
      expect(record['additionalProperties'], path).toBe(false);
      for (const [key, child] of Object.entries(record['properties'] as object)) {
        expectApiShaped(child, `${path}.${key}`);
      }
    }
    if ('minItems' in record) expect([0, 1], path).toContain(record['minItems']);
    if (record['items']) expectApiShaped(record['items'], `${path}[]`);
    for (const branch of (record['anyOf'] as unknown[] | undefined) ?? []) {
      expectApiShaped(branch, `${path}|`);
    }
  }

  const EVERY_KEYWORD: JsonSchema = {
    type: 'object',
    description: 'every keyword of the strict subset',
    properties: {
      kind: { enum: ['a', 'b', null], description: 'enum with null' },
      score: { type: 'integer', minimum: 1, maximum: 5 },
      ratio: { type: ['number', 'null'], minimum: 0, maximum: 1 },
      list: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4 },
      one: { type: 'array', items: { type: 'boolean' }, minItems: 1 },
      maybe: {
        type: ['object', 'null'],
        properties: { x: { type: 'string' } },
        required: ['x'],
        additionalProperties: false,
      },
      either: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }] },
    },
    required: ['kind', 'score', 'ratio', 'list', 'one', 'maybe', 'either'],
    additionalProperties: false,
  };

  it.each([
    ['every keyword', EVERY_KEYWORD],
    ['knowledge answer', KNOWLEDGE_ANSWER_SCHEMA],
    ['understand', UNDERSTAND_SCHEMA],
    ['SOP draft', SOP_DRAFT_SCHEMA],
    ['question kind', QUESTION_KIND_SCHEMA],
    ['guidance check', GUIDANCE_CHECK_SCHEMA],
  ])('%s converts to the API shape', (_name, schema) => {
    expectApiShaped(anthropicOutputSchema(schema));
  });

  it('keeps what it cannot send as a description, and the object branch of a union whole', () => {
    const out = anthropicOutputSchema(EVERY_KEYWORD) as {
      properties: Record<string, Record<string, unknown>>;
    };
    expect(out.properties['score']).toEqual({
      type: 'integer',
      description: '{minimum: 1, maximum: 5}',
    });
    expect(out.properties['list']).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: '{maxItems: 4, minItems: 2}',
    });
    expect(out.properties['one']).toEqual({
      type: 'array',
      items: { type: 'boolean' },
      minItems: 1,
    });
    expect(out.properties['maybe']).toEqual({
      anyOf: [
        {
          type: 'object',
          properties: { x: { type: 'string' } },
          required: ['x'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    });
    expect(out.properties['kind']).toEqual({
      enum: ['a', 'b', null],
      description: 'enum with null',
    });
  });
});
