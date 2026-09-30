/**
 * The OpenAI chat adapter (tm 255.6), against an injected `fetch`.
 *
 * No request leaves the process and no key exists: `KEY` below is a label the
 * redaction tests look for, not a credential. The one test that uses the real
 * `fetch` talks to a server this file starts on 127.0.0.1 — it is there to show
 * that an abandoned request is cancelled on the wire, which a fake cannot show.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Persona } from '@siyahtus/types';
import {
  fakeOpenAiFetch as fakeFetch,
  hangingRequest as hang,
  openAiCompletion as completion,
  openAiJson as json,
  openAiProblem,
  refusedConnection as refused,
  type OpenAiHandler as Handler,
} from '../../../../test/helpers/fake-openai.js';
import { buildAnswerPrompt } from './answer-prompt.js';
import { LLM_EMPTY_LENGTH_HINT, LlmProviderError, type LlmFailureKind } from './llm-error.js';
import type { LlmCompletionRequest, OpenAiSettings } from './llm-provider.js';
import {
  LLM_CIRCUIT_FAILURE_THRESHOLD,
  LLM_MAX_ATTEMPTS,
  LLM_MAX_RESPONSE_BYTES,
  LLM_SECRET_LOG_PATHS,
  OPENAI_QUOTA_CODES,
  OpenAiLlmProvider,
  chatCompletionsUrl,
  llmRetryBackoffMs,
  retryAfterMs,
  type OpenAiLlmProviderOptions,
} from './openai-llm-provider.js';

const KEY = 'sk-test-only-not-a-credential-Zq7Rv2Lm9Xw4';
const SETTINGS: OpenAiSettings = {
  baseUrl: 'https://eu.api.openai.com/v1',
  model: 'test-model',
  apiKey: KEY,
};
const ENDPOINT = 'https://eu.api.openai.com/v1/chat/completions';
const ANSWER = 'Parcels arrive in three to five working days.';

const REQUEST: LlmCompletionRequest = {
  system: 'You are the support assistant. Only use the passage: Parcels travel by courier.',
  messages: [{ role: 'user', content: 'Where is my parcel, order 55123?' }],
  maxOutputTokens: 400,
  timeoutMs: 20_000,
};

// --- fakes -------------------------------------------------------------------

/**
 * An OpenAI-shaped error whose message quotes the key and the prompt, the way a
 * real one can — OpenAI's 401 quotes the refused key's ends — so every test
 * built on it is also a test that the message goes nowhere.
 */
function problem(
  status: number,
  code: string | null,
  type: string | null = null,
  headers: Record<string, string> = {},
): Handler {
  return openAiProblem(status, code, {
    type,
    headers,
    message: `Incorrect API key provided: ${KEY}. Input was: ${REQUEST.messages[0]!.content}`,
  });
}

function recordingLogger() {
  const lines: Array<{ level: string; details: Record<string, unknown>; message: string }> = [];
  const at = (level: string) => (details: Record<string, unknown>, message: string) => {
    lines.push({ level, details, message });
  };
  return {
    lines,
    events: () => lines.map((line) => line.details['event']),
    logger: { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') },
  };
}

function adapter(
  fetchImpl: typeof fetch,
  options: Partial<OpenAiLlmProviderOptions> = {},
  settings: OpenAiSettings = SETTINGS,
) {
  const log = recordingLogger();
  const sleeps: number[] = [];
  const instance = new OpenAiLlmProvider(settings, {
    fetchImpl,
    logger: log.logger,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    // The middle of the jitter range: backoff 750 ms, then 1500 ms.
    random: () => 0.5,
    // Read per call, so `vi.useFakeTimers()` moves it.
    now: () => Date.now(),
    ...options,
  });
  return { instance, log, sleeps };
}

async function failure(promise: Promise<unknown>): Promise<LlmProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof LlmProviderError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

afterEach(() => {
  vi.useRealTimers();
});

// --- the request and the reply -------------------------------------------------

describe('the request and the reply (FR-05-06.EK1)', () => {
  it('posts model, messages and max_completion_tokens — nothing else — with the bearer key (FR-MOD-06.4)', async () => {
    // The persona travels in the system prompt; the adapter has to deliver it
    // byte for byte, since with a real model it is the only place it lives.
    const persona: Persona = { tone: 'formal', languages: ['tr'], answerLength: 'short' };
    const prompt = buildAnswerPrompt({
      message: 'Kargom nerede?',
      passages: ['Kargo üç ila beş iş gününde ulaşır.'],
      persona,
      answerIn: 'tr',
    });
    const net = fakeFetch(completion(`  ${ANSWER}\n`));
    const { instance } = adapter(net.impl);

    const result = await instance.complete({ ...prompt, maxOutputTokens: 321, timeoutMs: 20_000 });

    expect(result).toEqual({ text: ANSWER, usage: { inputTokens: 120, outputTokens: 12 } });
    expect(net.calls).toHaveLength(1);
    const { url, init } = net.calls[0]!;
    expect(url).toBe(ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('manual');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.headers).toEqual({
      authorization: `Bearer ${KEY}`,
      'content-type': 'application/json',
      accept: 'application/json',
    });

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['max_completion_tokens', 'messages', 'model']);
    expect(body['model']).toBe('test-model');
    expect(body['max_completion_tokens']).toBe(321);
    expect(body['messages']).toEqual([
      { role: 'system', content: prompt.system },
      { role: 'user', content: 'Kargom nerede?' },
    ]);
    const system = (body['messages'] as Array<{ content: string }>)[0]!.content;
    expect(system).toContain('Tone: formal.');
    expect(system).toContain('Length (short)');
    expect(system).toContain('Reply in this language: tr.');
    expect(system).toContain('Kargo üç ila beş iş gününde ulaşır.');
  });

  it('logs the answer by its size and cost, not its text', async () => {
    const { instance, log } = adapter(fakeFetch(completion(ANSWER)).impl);
    await instance.complete(REQUEST);

    const done = log.lines.find((line) => line.details['event'] === 'llm.completed');
    expect(done?.level).toBe('info');
    expect(done?.details).toMatchObject({
      provider: 'openai',
      model: 'test-model',
      attempts: 1,
      inputTokens: 120,
      outputTokens: 12,
    });
  });
});

describe('chatCompletionsUrl — the base URL is checked at boot, never echoed', () => {
  it('appends the chat path to the base, with or without a trailing slash', () => {
    expect(chatCompletionsUrl('https://eu.api.openai.com/v1')).toBe(ENDPOINT);
    expect(chatCompletionsUrl('https://eu.api.openai.com/v1/')).toBe(ENDPOINT);
    expect(chatCompletionsUrl('http://127.0.0.1:9999/v1')).toBe(
      'http://127.0.0.1:9999/v1/chat/completions',
    );
  });

  it('refuses what would make the request wrong, without printing the URL', () => {
    expect(() => chatCompletionsUrl('not a url')).toThrow('LLM_API_BASE_URL is not a URL.');
    expect(() => chatCompletionsUrl('ftp://eu.api.openai.com/v1')).toThrow(/http\(s\) URL/);
    expect(() => chatCompletionsUrl('https://eu.api.openai.com/v1?api-version=1')).toThrow(
      /query string or fragment/,
    );
    expect(() => chatCompletionsUrl('https://eu.api.openai.com/v1#x')).toThrow(
      /query string or fragment/,
    );

    let message = '';
    try {
      chatCompletionsUrl(`https://user:${KEY}@eu.api.openai.com/v1`);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/must not carry credentials/);
    expect(message).not.toContain(KEY);
  });

  it('refuses a key an HTTP header cannot carry, at construction and without echoing it', () => {
    for (const apiKey of [`${KEY}\n`, `${KEY} `, 'sk-ü']) {
      let message = '';
      try {
        new OpenAiLlmProvider({ ...SETTINGS, apiKey }, { fetchImpl: fakeFetch().impl });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toMatch(/LLM_API_KEY contains whitespace/);
      expect(message).not.toContain(KEY);
    }
  });
});

// --- the deadline ----------------------------------------------------------------

describe('LLM_TIMEOUT_MS — one deadline, really enforced', () => {
  it('aborts a request that never answers exactly at the deadline, and does not retry it', async () => {
    vi.useFakeTimers();
    const net = fakeFetch(hang);
    const { instance, log } = adapter(net.impl);

    const settled = failure(instance.complete({ ...REQUEST, timeoutMs: 5_000 }));
    await vi.advanceTimersByTimeAsync(4_999);
    const signal = net.calls[0]!.init.signal!;
    expect(signal.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;

    // The signal handed to fetch is the one that fired — that is what cancels
    // the request rather than merely giving up waiting for it.
    expect(signal.aborted).toBe(true);
    expect(error.kind).toBe('timeout');
    expect(error.transient).toBe(true);
    expect(error.attempts).toBe(1);
    expect(net.calls).toHaveLength(1);
    expect(log.events()).toContain('llm.failed');
  });

  it('aborts a body that stalls after the headers arrived', async () => {
    vi.useFakeTimers();
    const stalled: Handler = (init) =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"choices":['));
            init.signal?.addEventListener('abort', () =>
              controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          },
        }),
        { status: 200 },
      );
    const net = fakeFetch(stalled);
    const { instance } = adapter(net.impl);

    const settled = failure(instance.complete({ ...REQUEST, timeoutMs: 3_000 }));
    await vi.advanceTimersByTimeAsync(3_000);
    const error = await settled;

    expect(error.kind).toBe('timeout');
    expect(net.calls[0]!.init.signal!.aborted).toBe(true);
  });

  it('does not start a retry that could not finish before the deadline', async () => {
    // 503 is transient, but the backoff (750 ms) plus the least an attempt is
    // given (1 s) does not fit in what is left of 1.5 s: fail now, not later.
    const net = fakeFetch(problem(503, 'server_is_overloaded'));
    const { instance, sleeps } = adapter(net.impl);

    const error = await failure(instance.complete({ ...REQUEST, timeoutMs: 1_500 }));

    expect(error.kind).toBe('unavailable');
    expect(net.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('really closes the connection of a request it abandons', async () => {
    // Real fetch, real socket, loopback only: the server accepts the request
    // and never answers. What is asserted is on the server's side — the socket
    // closes when the deadline passes — so nothing keeps running behind the
    // error the caller already has.
    let server: Server | undefined;
    const socketClosed = new Promise<void>((resolve) => {
      server = createServer((request: IncomingMessage) => {
        request.socket.on('close', () => resolve());
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    try {
      const { port } = server!.address() as AddressInfo;
      const { instance } = adapter(
        fetch,
        {},
        { ...SETTINGS, baseUrl: `http://127.0.0.1:${port}/v1` },
      );

      const error = await failure(instance.complete({ ...REQUEST, timeoutMs: 300 }));
      expect(error.kind).toBe('timeout');

      await Promise.race([
        socketClosed,
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('the abandoned request is still connected')), 5_000),
        ),
      ]);
    } finally {
      server!.closeAllConnections();
      await new Promise((resolve) => server!.close(resolve));
    }
  });
});

describe('over a real socket — loopback only', () => {
  /** A stand-in on 127.0.0.1 that answers with `respond` and records every path it was asked for. */
  async function standIn(respond: (path: string, response: ServerResponse) => void) {
    const paths: string[] = [];
    const server = createServer((request, response) => {
      paths.push(request.url ?? '');
      request.resume();
      request.on('end', () => respond(request.url ?? '', response));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
      paths,
      settings: { ...SETTINGS, baseUrl: `http://127.0.0.1:${port}/v1` },
      close: async () => {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      },
    };
  }

  it('reads a chunked completion the way the real fetch delivers it', async () => {
    const body = JSON.stringify({
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: ANSWER, refusal: null },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 9 },
    });
    // No content-length: the body arrives chunked, in two pieces.
    const stand = await standIn((_path, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.write(body.slice(0, 20));
      setTimeout(() => response.end(body.slice(20)), 20);
    });
    try {
      const { instance } = adapter(fetch, {}, stand.settings);
      await expect(instance.complete(REQUEST)).resolves.toEqual({
        text: ANSWER,
        usage: { inputTokens: 7, outputTokens: 9 },
      });
      expect(stand.paths).toEqual(['/v1/chat/completions']);
    } finally {
      await stand.close();
    }
  });

  it('does not follow a redirect, not even to the same host', async () => {
    const stand = await standIn((path, response) => {
      if (path === '/v1/chat/completions') {
        response.writeHead(307, { location: '/elsewhere/chat/completions' });
        response.end();
      } else {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      }
    });
    try {
      const { instance } = adapter(fetch, {}, stand.settings);
      const error = await failure(instance.complete(REQUEST));
      expect(error).toMatchObject({ kind: 'bad_response', status: 307, reason: 'redirect' });
      // The redirect target was never asked for — the conversation went nowhere else.
      expect(stand.paths).toEqual(['/v1/chat/completions']);
    } finally {
      await stand.close();
    }
  });
});

// --- retries -------------------------------------------------------------------

describe('retries — transient failures only', () => {
  it('waits what Retry-After asks on a 429, not less, then succeeds', async () => {
    const net = fakeFetch(
      problem(429, 'rate_limit_exceeded', 'requests', { 'retry-after': '3' }),
      completion(ANSWER),
    );
    const { instance, sleeps, log } = adapter(net.impl);

    const result = await instance.complete(REQUEST);

    expect(result.text).toBe(ANSWER);
    expect(net.calls).toHaveLength(2);
    expect(sleeps).toEqual([3_000]);
    const retry = log.lines.find((line) => line.details['event'] === 'llm.retry');
    expect(retry?.details).toMatchObject({
      kind: 'rate_limited',
      status: 429,
      code: 'rate_limit_exceeded',
      requestId: 'req_abc123',
      delayMs: 3_000,
      attempt: 1,
    });
  });

  it('keeps its own backoff when Retry-After asks for less', async () => {
    const net = fakeFetch(
      problem(429, 'slow_down', null, { 'retry-after': '0' }),
      completion(ANSWER),
    );
    const { instance, sleeps } = adapter(net.impl);
    await instance.complete(REQUEST);
    expect(sleeps).toEqual([llmRetryBackoffMs(1, () => 0.5)]);
  });

  it('does not wait at all when Retry-After is past the deadline', async () => {
    const net = fakeFetch(problem(429, 'rate_limit_exceeded', null, { 'retry-after': '60' }));
    const { instance, sleeps } = adapter(net.impl);

    const error = await failure(instance.complete(REQUEST));

    expect(error.kind).toBe('rate_limited');
    expect(net.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it(`stops at ${LLM_MAX_ATTEMPTS} attempts when the rate limit does not lift`, async () => {
    const net = fakeFetch(problem(429, 'rate_limit_exceeded'));
    const { instance, sleeps, log } = adapter(net.impl);

    const error = await failure(instance.complete(REQUEST));

    expect(error.kind).toBe('rate_limited');
    expect(error.attempts).toBe(LLM_MAX_ATTEMPTS);
    expect(net.calls).toHaveLength(LLM_MAX_ATTEMPTS);
    expect(sleeps).toEqual([750, 1_500]);
    expect(log.lines.filter((line) => line.details['event'] === 'llm.retry')).toHaveLength(2);
    expect(log.lines.find((line) => line.details['event'] === 'llm.failed')?.level).toBe('error');
  });

  it.each([500, 502, 503, 504, 408])('treats %i as transient and retries it', async (status) => {
    const net = fakeFetch(problem(status, null), completion(ANSWER));
    const { instance } = adapter(net.impl);
    await expect(instance.complete(REQUEST)).resolves.toMatchObject({ text: ANSWER });
    expect(net.calls).toHaveLength(2);
  });

  it('gives up on a 5xx that persists, as unavailable', async () => {
    const net = fakeFetch(problem(503, 'server_is_overloaded', 'service_unavailable_error'));
    const { instance } = adapter(net.impl);
    const error = await failure(instance.complete(REQUEST));
    expect(error).toMatchObject({ kind: 'unavailable', status: 503, attempts: LLM_MAX_ATTEMPTS });
    expect(error.code).toBe('server_is_overloaded');
  });

  it('retries a dropped connection and reports the socket code, not the message', async () => {
    const net = fakeFetch(refused('ECONNRESET'), completion(ANSWER));
    const { instance } = adapter(net.impl);
    await expect(instance.complete(REQUEST)).resolves.toMatchObject({ text: ANSWER });

    const dead = fakeFetch(refused('ECONNREFUSED'));
    const error = await failure(adapter(dead.impl).instance.complete(REQUEST));
    expect(error).toMatchObject({ kind: 'network', code: 'ECONNREFUSED', status: null });
    expect(dead.calls).toHaveLength(LLM_MAX_ATTEMPTS);
    expect(error.message).not.toContain('10.0.0.1');
  });

  it.each<[number, LlmFailureKind]>([
    [400, 'bad_request'],
    [401, 'auth'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [422, 'bad_request'],
  ])('never retries a %i — it is %s, and permanent', async (status, kind) => {
    const net = fakeFetch(problem(status, 'some_code'), completion(ANSWER));
    const { instance, sleeps } = adapter(net.impl);

    const error = await failure(instance.complete(REQUEST));

    expect(error.kind).toBe(kind);
    expect(error.transient).toBe(false);
    expect(net.calls).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it.each([...OPENAI_QUOTA_CODES])(
    'never retries a 429 whose code is %s — no wait restores a spent budget',
    async (code) => {
      const net = fakeFetch(problem(429, code, null, { 'retry-after': '1' }), completion(ANSWER));
      const { instance, sleeps } = adapter(net.impl);

      const error = await failure(instance.complete(REQUEST));

      expect(error).toMatchObject({ kind: 'quota_exhausted', status: 429, code });
      expect(net.calls).toHaveLength(1);
      expect(sleeps).toEqual([]);
    },
  );

  it('recognises the quota condition from the error type as well', async () => {
    const net = fakeFetch(problem(429, null, 'insufficient_quota'));
    const error = await failure(adapter(net.impl).instance.complete(REQUEST));
    expect(error.kind).toBe('quota_exhausted');
    expect(net.calls).toHaveLength(1);
  });

  it('refuses a redirect instead of following it', async () => {
    const net = fakeFetch(
      () =>
        new Response(null, {
          status: 307,
          headers: { location: 'https://elsewhere.example.test/' },
        }),
    );
    const error = await failure(adapter(net.impl).instance.complete(REQUEST));
    expect(error).toMatchObject({ kind: 'bad_response', status: 307, reason: 'redirect' });
    expect(net.calls).toHaveLength(1);
  });
});

describe('a reply that is not an answer is a failure, never a message', () => {
  it.each<[string, Handler, LlmFailureKind, string]>([
    [
      'cut off at max_completion_tokens',
      completion('Refunds are issued within', { finish_reason: 'length' }),
      'no_answer',
      'length',
    ],
    [
      'filtered',
      completion(null, { finish_reason: 'content_filter' }),
      'no_answer',
      'content_filter',
    ],
    [
      'a refusal',
      completion(null, {
        message: { role: 'assistant', content: null, refusal: 'I cannot help with that.' },
      }),
      'no_answer',
      'refusal',
    ],
    ['empty', completion('   \n'), 'no_answer', 'empty'],
    [
      'not JSON',
      () => new Response('<html>gateway</html>', { status: 200 }),
      'bad_response',
      'not_json',
    ],
    [
      'without choices',
      json(200, { choices: [], usage: { prompt_tokens: 1, completion_tokens: 0 } }),
      'bad_response',
      'shape',
    ],
    ['without usage', completion(ANSWER, {}, { usage: undefined }), 'bad_response', 'shape'],
    [
      'with content that is not text',
      completion(ANSWER, { message: { role: 'assistant', content: 42 } }),
      'bad_response',
      'shape',
    ],
  ])('%s', async (_label, handler, kind, reason) => {
    const net = fakeFetch(handler, completion(ANSWER));
    const error = await failure(adapter(net.impl).instance.complete(REQUEST));

    expect(error).toMatchObject({ kind, reason });
    // Neither is retried: the same prompt would get the same reply.
    expect(net.calls).toHaveLength(1);
  });

  // A reasoning model spends max_completion_tokens thinking and can answer
  // nothing at all, on every question; the log says what to change (tm 256.6).
  it.each<[string, string | null]>([
    ['no content', null],
    ['blank content', '  \n'],
  ])(
    'says in llm.failed what to change when a reply is cut off with %s',
    async (_label, content) => {
      const net = fakeFetch(
        completion(
          content,
          { finish_reason: 'length' },
          { usage: { prompt_tokens: 120, completion_tokens: 400 } },
        ),
      );
      const { instance, log } = adapter(net.impl);
      const error = await failure(instance.complete(REQUEST));

      expect(error).toMatchObject({
        kind: 'no_answer',
        reason: 'length',
        hint: LLM_EMPTY_LENGTH_HINT,
      });
      const failed = log.lines.find((line) => line.details['event'] === 'llm.failed');
      expect(failed?.level).toBe('warn');
      expect(failed?.details).toMatchObject({ reason: 'length', hint: LLM_EMPTY_LENGTH_HINT });
      expect(LLM_EMPTY_LENGTH_HINT).toMatch(/LLM_MAX_OUTPUT_TOKENS/);
      expect(LLM_EMPTY_LENGTH_HINT).toMatch(/non-reasoning/);
    },
  );

  it('gives no hint when a cut-off reply held text — that is a long answer, not a setting', async () => {
    const { instance, log } = adapter(
      fakeFetch(completion('Refunds are issued within', { finish_reason: 'length' })).impl,
    );
    const error = await failure(instance.complete(REQUEST));

    expect(error).toMatchObject({ kind: 'no_answer', reason: 'length', hint: null });
    const failed = log.lines.find((line) => line.details['event'] === 'llm.failed');
    expect(failed?.details).not.toHaveProperty('hint');
  });

  it('gives no hint for an empty reply that finished on its own', async () => {
    const error = await failure(
      adapter(fakeFetch(completion('   ')).impl).instance.complete(REQUEST),
    );
    expect(error).toMatchObject({ kind: 'no_answer', reason: 'empty', hint: null });
  });

  it('still reports what a no-answer cost', async () => {
    const net = fakeFetch(completion('Half an', { finish_reason: 'length' }));
    const error = await failure(adapter(net.impl).instance.complete(REQUEST));
    expect(error.usage).toEqual({ inputTokens: 120, outputTokens: 12 });
  });

  it('will not hold a body larger than any completion', async () => {
    const declared = fakeFetch(
      () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(LLM_MAX_RESPONSE_BYTES + 1) },
        }),
    );
    await expect(adapter(declared.impl).instance.complete(REQUEST)).rejects.toMatchObject({
      kind: 'bad_response',
      reason: 'too_large',
    });

    // …and when the size was not announced, it stops reading at the limit.
    const undeclared = fakeFetch(
      () => new Response(`{"x":"${'a'.repeat(LLM_MAX_RESPONSE_BYTES)}"}`, { status: 200 }),
    );
    await expect(adapter(undeclared.impl).instance.complete(REQUEST)).rejects.toMatchObject({
      kind: 'bad_response',
      reason: 'too_large',
    });
  });
});

describe('Retry-After and the backoff curve', () => {
  it('reads seconds, fractions and an HTTP-date; ignores what it cannot read', () => {
    const now = Date.parse('2026-09-23T10:00:00Z');
    expect(retryAfterMs('7', now)).toBe(7_000);
    expect(retryAfterMs('1.5', now)).toBe(1_500);
    expect(retryAfterMs('Wed, 23 Sep 2026 10:00:04 GMT', now)).toBe(4_000);
    expect(retryAfterMs('Wed, 23 Sep 2026 09:00:00 GMT', now)).toBe(0);
    expect(retryAfterMs('soon', now)).toBeNull();
    expect(retryAfterMs(null, now)).toBeNull();
  });

  it('doubles, caps, and keeps at least half of each step', () => {
    expect([1, 2, 3, 4, 5].map((attempt) => llmRetryBackoffMs(attempt, () => 0))).toEqual([
      500, 1_000, 2_000, 4_000, 4_000,
    ]);
    expect([1, 2, 3, 4, 5].map((attempt) => llmRetryBackoffMs(attempt, () => 0.999_999))).toEqual([
      1_000, 2_000, 4_000, 8_000, 8_000,
    ]);
  });
});

// --- the circuit breaker ---------------------------------------------------------

describe('the circuit breaker', () => {
  function clock(start = Date.parse('2026-09-23T10:00:00Z')) {
    let now = start;
    return { now: () => now, advance: (ms: number) => (now += ms) };
  }

  it(`opens after ${LLM_CIRCUIT_FAILURE_THRESHOLD} failed calls; then no request is made at all`, async () => {
    const net = fakeFetch(problem(401, 'invalid_api_key'));
    const time = clock();
    const { instance, log } = adapter(net.impl, { now: time.now });

    for (let i = 0; i < LLM_CIRCUIT_FAILURE_THRESHOLD; i += 1) {
      expect((await failure(instance.complete(REQUEST))).kind).toBe('auth');
    }
    expect(instance.circuitState).toBe('open');
    expect(log.events().filter((event) => event === 'llm.circuit_opened')).toHaveLength(1);

    const refusedCall = await failure(instance.complete(REQUEST));
    expect(refusedCall.kind).toBe('circuit_open');
    expect(refusedCall.attempts).toBe(0);
    // The count is the proof: the open circuit did not reach the provider.
    expect(net.calls).toHaveLength(LLM_CIRCUIT_FAILURE_THRESHOLD);
  });

  it('lets one probe through after the window, and closes on its answer', async () => {
    let healthy = false;
    const net = fakeFetch((init) =>
      healthy ? completion(ANSWER)(init) : problem(503, null)(init),
    );
    const time = clock();
    const { instance, log } = adapter(net.impl, {
      now: time.now,
      maxAttempts: 1,
      circuit: { failureThreshold: 2, openMs: 10_000 },
    });

    await failure(instance.complete(REQUEST));
    await failure(instance.complete(REQUEST));
    expect(instance.circuitState).toBe('open');

    time.advance(9_999);
    expect((await failure(instance.complete(REQUEST))).kind).toBe('circuit_open');
    expect(net.calls).toHaveLength(2);

    time.advance(1);
    expect(instance.circuitState).toBe('half_open');
    healthy = true;
    await expect(instance.complete(REQUEST)).resolves.toMatchObject({ text: ANSWER });
    expect(net.calls).toHaveLength(3);
    expect(instance.circuitState).toBe('closed');
    expect(log.events()).toContain('llm.circuit_closed');

    await instance.complete(REQUEST);
    expect(net.calls).toHaveLength(4);
  });

  it('reopens for a whole new window when the probe fails', async () => {
    const net = fakeFetch(problem(503, null));
    const time = clock();
    const { instance } = adapter(net.impl, {
      now: time.now,
      maxAttempts: 1,
      circuit: { failureThreshold: 1, openMs: 10_000 },
    });

    await failure(instance.complete(REQUEST));
    time.advance(10_000);
    expect((await failure(instance.complete(REQUEST))).kind).toBe('unavailable');
    expect(net.calls).toHaveLength(2);
    expect(instance.circuitState).toBe('open');

    time.advance(9_999);
    expect((await failure(instance.complete(REQUEST))).kind).toBe('circuit_open');
    expect(net.calls).toHaveLength(2);
  });

  it('refuses everyone else while the probe is in flight', async () => {
    let release: (response: Response) => void = () => undefined;
    let probing = false;
    const net = fakeFetch((init) =>
      probing
        ? new Promise<Response>((resolve) => {
            release = resolve;
          })
        : problem(503, null)(init),
    );
    const time = clock();
    const { instance } = adapter(net.impl, {
      now: time.now,
      maxAttempts: 1,
      circuit: { failureThreshold: 1, openMs: 1_000 },
    });

    await failure(instance.complete(REQUEST));
    time.advance(1_000);
    probing = true;
    const probe = instance.complete(REQUEST);
    await vi.waitFor(() => expect(net.calls).toHaveLength(2));

    expect((await failure(instance.complete(REQUEST))).kind).toBe('circuit_open');
    expect(net.calls).toHaveLength(2);

    release(completion(ANSWER)({}) as Response);
    await expect(probe).resolves.toMatchObject({ text: ANSWER });
    expect(instance.circuitState).toBe('closed');
  });

  it.each<[string, Handler]>([
    ['a filtered reply', completion(null, { finish_reason: 'content_filter' })],
    ['a reply cut off', completion('Refunds are', { finish_reason: 'length' })],
    ['a refusal', completion(null, { message: { content: null, refusal: 'No.' } })],
    ['a rejected request', problem(400, 'invalid_request_error')],
  ])(
    'is not opened by failures a customer can cause: %s, again and again',
    async (_label, handler) => {
      // Each on its own: a success-like failure in between would reset the count
      // and hide one that was wrongly counted.
      const net = fakeFetch(handler);
      const { instance } = adapter(net.impl, { circuit: { failureThreshold: 2 } });

      for (let i = 0; i < 6; i += 1) await failure(instance.complete(REQUEST));

      expect(instance.circuitState).toBe('closed');
      expect(net.calls).toHaveLength(6);
    },
  );

  it('counts calls, not attempts: a call that recovered on a retry is healthy', async () => {
    // Two failed attempts would reach the threshold if attempts were counted.
    const net = fakeFetch(problem(503, null), problem(503, null), completion(ANSWER));
    const { instance } = adapter(net.impl, { circuit: { failureThreshold: 2 } });

    await instance.complete(REQUEST);
    expect(net.calls).toHaveLength(3);
    expect(instance.circuitState).toBe('closed');
  });

  it('is reset by a success between failures', async () => {
    let answer = false;
    const net = fakeFetch((init) => (answer ? completion(ANSWER)(init) : problem(401, null)(init)));
    const { instance } = adapter(net.impl, { circuit: { failureThreshold: 3 } });

    await failure(instance.complete(REQUEST));
    await failure(instance.complete(REQUEST));
    answer = true;
    await instance.complete(REQUEST);
    answer = false;
    await failure(instance.complete(REQUEST));
    await failure(instance.complete(REQUEST));

    expect(instance.circuitState).toBe('closed');
  });
});

// --- secrets and content ----------------------------------------------------------

describe('the key, the prompt and the reply stay out of logs and errors', () => {
  /** Anything that could identify the key: the whole, and the ends a 401 quotes. */
  const KEY_TRACES = [KEY, KEY.slice(0, 12), KEY.slice(-8), Buffer.from(KEY).toString('base64')];
  const CONTENT = ['Parcels travel by courier', 'Where is my parcel, order 55123?', ANSWER];

  const scenarios: Array<[string, Handler[]]> = [
    ['an answer', [completion(ANSWER)]],
    ['a refused key', [problem(401, 'invalid_api_key', 'invalid_request_error')]],
    ['a spent budget', [problem(429, 'credit_balance_exhausted')]],
    ['a rate limit, retried', [problem(429, 'rate_limit_exceeded'), completion(ANSWER)]],
    ['a server error, exhausted', [problem(500, 'server_error')]],
    ['a dead connection', [refused('ECONNRESET')]],
    ['a filtered reply', [completion(ANSWER, { finish_reason: 'content_filter' })]],
  ];

  it.each(scenarios)('%s', async (_label, handlers) => {
    const { instance, log } = adapter(fakeFetch(...handlers).impl);

    let error: unknown = null;
    await instance.complete(REQUEST).catch((caught: unknown) => {
      error = caught;
    });

    const written = [
      ...log.lines.map((line) => `${line.message} ${JSON.stringify(line.details)}`),
      ...(error instanceof Error
        ? [error.message, String(error), JSON.stringify(error), error.stack ?? '']
        : []),
    ].join('\n');

    for (const trace of [...KEY_TRACES, ...CONTENT]) {
      expect(written).not.toContain(trace);
    }
    // …while the facts an operator needs are there.
    expect(written).toContain('test-model');
    if (error instanceof LlmProviderError && error.status) {
      expect(written).toContain(String(error.status));
    }
  });

  it('writes the provider error code to the log', async () => {
    const { instance, log } = adapter(fakeFetch(problem(401, 'invalid_api_key')).impl);
    await failure(instance.complete(REQUEST));
    const failed = log.lines.find((line) => line.details['event'] === 'llm.failed');
    expect(failed?.details).toMatchObject({ kind: 'auth', status: 401, code: 'invalid_api_key' });
  });

  it('drops a provider code or request id that is not a plain token', async () => {
    const { instance } = adapter(
      fakeFetch(
        json(
          401,
          { error: { code: `bad code ${KEY}`, type: 'x'.repeat(200) } },
          { 'x-request-id': `id with spaces ${KEY}` },
        ),
      ).impl,
    );
    const error = await failure(instance.complete(REQUEST));
    expect(error.code).toBeNull();
    expect(error.requestId).toBeNull();
  });

  it('redacts the key wherever someone logs the configuration or the request (LLM_SECRET_LOG_PATHS)', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: LLM_SECRET_LOG_PATHS, censor: '[redacted]' } },
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          lines.push(chunk.toString());
          done();
        },
      }),
    );

    logger.info({ LLM_API_KEY: KEY }, 'env, top level');
    logger.info({ env: { LLM_API_KEY: KEY } }, 'env, one level down');
    logger.info({ llm: { openai: { apiKey: KEY } } }, 'env.llm');
    logger.info({ openai: { apiKey: KEY } }, 'adapter settings');
    logger.info({ headers: { authorization: `Bearer ${KEY}` } }, 'request init');
    logger.info({ init: { headers: { authorization: `Bearer ${KEY}` } } }, 'request init, nested');

    expect(lines).toHaveLength(6);
    for (const line of lines) {
      expect(line).toContain('[redacted]');
      expect(line).not.toContain(KEY);
    }
  });
});
