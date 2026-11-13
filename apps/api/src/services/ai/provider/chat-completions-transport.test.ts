/**
 * The shared `chat/completions` transport (tm 480): what every OpenAI-shaped
 * dialect gets for free — the reading of a body, the status table, the
 * structured-mode fallback and the provider id on every log line. The three
 * adapters' own suites (`openai-`, `deepseek-`, `moonshot-llm-provider.test.ts`)
 * pin each vendor's dialect on top of it; this file pins the part between.
 * No network: an injected `fetch`.
 */
import { describe, expect, it } from 'vitest';
import {
  ChatCompletionsTransport,
  jsonObjectInstruction,
  jsonSchemaInstruction,
  readChatCompletion,
  readPromptCompletionUsage,
  type ChatCompletionsDialect,
} from './chat-completions-transport.js';
import { LLM_EMPTY_LENGTH_HINT } from './llm-error.js';
import type { LlmCompletionRequest } from './llm-provider.js';
import { classifyHttpFailure, statusFailureKind } from './openai-http.js';

const META = { status: 200, requestId: 'req-1' };
const USAGE = { prompt_tokens: 3, completion_tokens: 2 };
const READING = { usage: readPromptCompletionUsage };

const body = (choice: Record<string, unknown>, usage: unknown = USAGE) =>
  JSON.stringify({ choices: [choice], usage });

describe('readChatCompletion', () => {
  it('reads a stopped reply with content', () => {
    const result = readChatCompletion(
      body({ message: { content: ' hi ' }, finish_reason: 'stop' }),
      META,
      READING,
    );
    expect(result).toEqual({
      ok: true,
      completion: { text: 'hi', usage: { inputTokens: 3, outputTokens: 2 } },
    });
  });

  it.each([
    ['not JSON', 'not json at all', 'not_json'],
    ['no usage', body({ message: { content: 'x' }, finish_reason: 'stop' }, null), 'shape'],
    ['no choices', JSON.stringify({ usage: USAGE }), 'shape'],
    ['a non-string finish', body({ message: { content: 'x' }, finish_reason: 1 }), 'shape'],
  ])('refuses %s as bad_response', (_label, text, reason) => {
    const result = readChatCompletion(text, META, READING);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('bad_response');
    expect(result.error.reason).toBe(reason);
  });

  it('turns a finish reason the dialect names into unavailable, with the bill', () => {
    const result = readChatCompletion(
      body({ message: { content: 'half' }, finish_reason: 'insufficient_system_resource' }),
      META,
      { ...READING, unavailableFinishes: new Set(['insufficient_system_resource']) },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('unavailable');
    expect(result.error.transient).toBe(true);
    expect(result.error.reason).toBe('insufficient_system_resource');
    expect(result.error.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it('gives the default hint for an empty length cut-off, or the dialect’s own', () => {
    const cut = body({ message: { content: '' }, finish_reason: 'length' });
    const plain = readChatCompletion(cut, META, READING);
    const own = readChatCompletion(cut, META, { ...READING, emptyLengthHint: 'raise it' });
    expect(!plain.ok && plain.error.hint).toBe(LLM_EMPTY_LENGTH_HINT);
    expect(!own.ok && own.error.hint).toBe('raise it');
  });

  it('reads only content: reasoning_content alone is an empty reply', () => {
    const result = readChatCompletion(
      body({ message: { content: null, reasoning_content: 'thoughts' }, finish_reason: 'stop' }),
      META,
      READING,
    );
    expect(!result.ok && result.error.kind).toBe('no_answer');
    expect(!result.ok && result.error.reason).toBe('empty');
  });

  it('is no_answer for a refusal and for an unsafe finish token', () => {
    const refusal = readChatCompletion(
      body({ message: { content: 'x', refusal: 'no' }, finish_reason: 'stop' }),
      META,
      READING,
    );
    expect(!refusal.ok && refusal.error.reason).toBe('refusal');
    const odd = readChatCompletion(
      body({ message: { content: 'x' }, finish_reason: 'drop table; --' }),
      META,
      READING,
    );
    expect(!odd.ok && odd.error.reason).toBe('finish_reason');
  });
});

describe('the status table every dialect starts from', () => {
  it.each([
    [301, 'bad_response'],
    [400, 'bad_request'],
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [408, 'unavailable'],
    [422, 'bad_request'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
    [504, 'unavailable'],
  ] as const)('%i is %s', (status, kind) => {
    expect(statusFailureKind(status)).toBe(kind);
  });

  it("leaves OpenAI's table as it was: quota codes on a 429, the rest by status", () => {
    const none = { code: null, type: null };
    expect(classifyHttpFailure(429, { code: 'insufficient_quota', type: null })).toBe(
      'quota_exhausted',
    );
    expect(classifyHttpFailure(429, none)).toBe('rate_limited');
    for (const status of [400, 401, 403, 404, 408, 500, 302]) {
      expect(classifyHttpFailure(status, none)).toBe(statusFailureKind(status));
    }
  });
});

describe('the JSON instructions', () => {
  it('names the schema; the json_object form also says "json" in lower case', () => {
    const schema = { type: 'object' };
    expect(jsonSchemaInstruction(schema)).toContain(JSON.stringify(schema));
    expect(jsonObjectInstruction(schema)).toContain('json');
    expect(jsonObjectInstruction(schema)).toContain(jsonSchemaInstruction(schema));
  });
});

describe('ChatCompletionsTransport', () => {
  type Mode = 'first' | 'second';
  const REQUEST: LlmCompletionRequest = {
    system: 's',
    messages: [{ role: 'user', content: 'u' }],
    maxOutputTokens: 10,
    timeoutMs: 10_000,
    responseFormat: { name: 'shape', schema: { type: 'object' } },
  };

  function transport(statuses: number[], now: () => number = () => 0) {
    const bodies: string[] = [];
    const lines: Array<Record<string, unknown>> = [];
    const log = (details: Record<string, unknown>) => lines.push(details);
    let call = 0;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      const status = statuses[Math.min(call, statuses.length - 1)]!;
      call += 1;
      return status === 200
        ? new Response(body({ message: { content: 'ok' }, finish_reason: 'stop' }), { status })
        : new Response(JSON.stringify({ error: { type: 'invalid' } }), { status });
    }) as typeof fetch;
    const dialect: ChatCompletionsDialect<Mode> = {
      structuredMode: () => 'first',
      body: (_request, model, mode) => JSON.stringify({ model, mode }),
      classify: statusFailureKind,
      read: (text, meta) => readChatCompletion(text, meta, READING),
      fallback: (_model, mode, failure) =>
        mode === 'first' && failure.kind === 'bad_request'
          ? { mode: 'second', event: 'test.fallback', message: 'switched' }
          : null,
    };
    const sender = new ChatCompletionsTransport<Mode>(
      {
        provider: 'deepseek',
        endpoint: 'https://example.test/chat/completions',
        apiKey: 'k',
        model: 'm',
      },
      dialect,
      {
        fetchImpl,
        now,
        sleep: async () => undefined,
        logger: { debug: log, info: log, warn: log, error: log },
      },
    );
    return { sender, bodies, lines };
  }

  it('sends the next attempt in the mode the dialect falls back to, at once', async () => {
    const { sender, bodies, lines } = transport([400, 200]);
    const completion = await sender.send(REQUEST);
    expect(completion.text).toBe('ok');
    expect(bodies.map((text) => JSON.parse(text).mode)).toEqual(['first', 'second']);
    expect(lines.map((line) => line['event'])).toContain('test.fallback');
    expect(lines.every((line) => line['provider'] === 'deepseek')).toBe(true);
  });

  it('does not fall back without time left for another attempt', async () => {
    let clock = 0;
    const { sender, bodies, lines } = transport([400, 200], () => clock);
    const sending = sender.send(REQUEST);
    clock = 9_500; // the first attempt's answer arrives with 500 ms of the deadline left
    await expect(sending).rejects.toMatchObject({ kind: 'bad_request' });
    expect(bodies).toHaveLength(1);
    const fallback = lines.find((line) => line['event'] === 'test.fallback');
    expect(fallback?.['retrying']).toBe(false);
  });

  it('sends a plain request in no mode', async () => {
    const { sender, bodies } = transport([200]);
    const { responseFormat: _ignored, ...plain } = REQUEST;
    await sender.send(plain);
    expect(JSON.parse(bodies[0]!).mode).toBeNull();
  });
});
