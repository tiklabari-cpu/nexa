/**
 * The OpenAI embedding adapter over an injected `fetch` (tm 255.7) — no
 * network, no key. What the product relies on: one request per source, the
 * vectors back in input order and exactly 1536 wide or not at all, transient
 * failures retried inside one deadline, permanent ones not, a circuit breaker
 * in front, and a log that carries neither the key nor the text.
 */
import { describe, expect, it } from 'vitest';
import { fakeEmbedding } from '../../../../test/helpers/fake-embedding-provider.js';
import {
  fakeOpenAiFetch,
  hangingRequest,
  openAiEmbeddings,
  openAiJson,
  openAiProblem,
  refusedConnection,
  type FakeOpenAiFetch,
} from '../../../../test/helpers/fake-openai.js';
import { EmbeddingProviderError } from './embedding-error.js';
import { EMBEDDING_DIMENSIONS, type OpenAiEmbeddingSettings } from './embedding-provider.js';
import {
  EMBEDDING_CIRCUIT_FAILURE_THRESHOLD,
  EMBEDDING_MAX_ATTEMPTS,
  EMBEDDING_MAX_BATCH_INPUTS,
  EMBEDDING_MAX_BATCH_TOKENS,
  EMBEDDING_SECRET_LOG_PATHS,
  OpenAiEmbeddingProvider,
  embeddingsUrl,
  planEmbeddingBatches,
  type EmbeddingLogger,
  type OpenAiEmbeddingProviderOptions,
} from './openai-embedding-provider.js';

const KEY = 'sk-test-only-not-a-credential-Wq3Tn8Jd5Ky1';
const SETTINGS: OpenAiEmbeddingSettings = {
  baseUrl: 'https://eu.api.openai.com/v1',
  model: 'text-embedding-3-small',
  apiKey: KEY,
  timeoutMs: 10_000,
};
const ENDPOINT = 'https://eu.api.openai.com/v1/embeddings';
const TEXTS = [
  'Refunds are issued within 14 days of receiving the return.',
  'Standard delivery takes three to five working days.',
  'Gift cards never expire and can be used online.',
];

interface LogLine {
  level: 'debug' | 'info' | 'warn' | 'error';
  details: Record<string, unknown>;
  message: string;
}

function recordingLogger(): EmbeddingLogger & { lines: LogLine[]; text: () => string } {
  const lines: LogLine[] = [];
  const at =
    (level: LogLine['level']) =>
    (details: Record<string, unknown>, message: string): void => {
      lines.push({ level, details, message });
    };
  return {
    lines,
    text: () => JSON.stringify(lines),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
  };
}

function adapter(
  net: FakeOpenAiFetch,
  options: OpenAiEmbeddingProviderOptions & { timeoutMs?: number } = {},
) {
  const log = recordingLogger();
  const sleeps: number[] = [];
  const { timeoutMs, ...rest } = options;
  const provider = new OpenAiEmbeddingProvider(
    { ...SETTINGS, ...(timeoutMs === undefined ? {} : { timeoutMs }) },
    {
      fetchImpl: net.impl,
      logger: log,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      random: () => 0.5,
      ...rest,
    },
  );
  return { provider, log, sleeps };
}

const ok = () => openAiEmbeddings((text) => fakeEmbedding(text));
const bodyOf = (net: FakeOpenAiFetch, call = 0) =>
  JSON.parse(String(net.calls[call]!.init.body)) as Record<string, unknown>;

async function failure(promise: Promise<unknown>): Promise<EmbeddingProviderError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EmbeddingProviderError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

describe('the request (FR-MOD-06.3.2)', () => {
  it('embeds N texts in one request carrying only the model and the inputs', async () => {
    const net = fakeOpenAiFetch(ok());
    const { provider } = adapter(net);

    const { vectors, usage } = await provider.embed(TEXTS);

    expect(net.calls).toHaveLength(1);
    expect(net.calls[0]!.url).toBe(ENDPOINT);
    expect(net.calls[0]!.init.method).toBe('POST');
    expect(net.calls[0]!.init.redirect).toBe('manual');
    expect((net.calls[0]!.init.headers as Record<string, string>)['authorization']).toBe(
      `Bearer ${KEY}`,
    );
    // No `dimensions`: the model is 1536 natively (ADR §10), and nothing else.
    expect(bodyOf(net)).toEqual({ model: 'text-embedding-3-small', input: TEXTS });
    expect(vectors).toEqual(TEXTS.map((text) => fakeEmbedding(text)));
    expect(usage).toEqual({ inputTokens: 21 });
  });

  it('places each vector by its index, not by where the list happens to put it', async () => {
    const net = fakeOpenAiFetch(
      openAiEmbeddings(
        (text) => fakeEmbedding(text),
        (inputs) => ({
          data: inputs
            .map((text, index) => ({ object: 'embedding', index, embedding: fakeEmbedding(text) }))
            .reverse(),
        }),
      ),
    );
    const { vectors } = await adapter(net).provider.embed(TEXTS);

    expect(vectors).toEqual(TEXTS.map((text) => fakeEmbedding(text)));
  });

  it('asks nothing for an empty list, and refuses a blank input before any request', async () => {
    const net = fakeOpenAiFetch(ok());
    const { provider } = adapter(net);

    expect(await provider.embed([])).toEqual({ vectors: [], usage: { inputTokens: 0 } });
    const refused = await failure(provider.embed(['fine', '   ']));
    expect(refused).toMatchObject({ kind: 'bad_request', reason: 'empty_input' });
    expect(net.calls).toHaveLength(0);
  });

  it('builds the endpoint under the base URL, and refuses one it could not use', () => {
    expect(embeddingsUrl('https://eu.api.openai.com/v1')).toBe(ENDPOINT);
    expect(embeddingsUrl('https://eu.api.openai.com/v1/')).toBe(ENDPOINT);
    expect(() => embeddingsUrl('ftp://eu.api.openai.com/v1')).toThrow(
      'EMBEDDING_API_BASE_URL must be an http(s) URL.',
    );
    expect(() => embeddingsUrl('https://eu.api.openai.com/v1?x=1')).toThrow(
      /must not have a query string or fragment: the adapter appends \/embeddings/,
    );
  });
});

describe('batching', () => {
  it('splits by input count, keeping order across requests', async () => {
    const net = fakeOpenAiFetch(ok());
    const texts = ['one', 'two', 'three', 'four', 'five'];
    const { vectors, usage } = await adapter(net, { batch: { maxInputs: 2 } }).provider.embed(
      texts,
    );

    expect(net.calls.map((_, i) => bodyOf(net, i)['input'])).toEqual([
      ['one', 'two'],
      ['three', 'four'],
      ['five'],
    ]);
    expect(vectors).toEqual(texts.map((text) => fakeEmbedding(text)));
    // Billed per request, summed.
    expect(usage).toEqual({ inputTokens: 5 * 7 });
  });

  it('counts tokens as UTF-8 bytes, an upper bound, so a batch never exceeds the limit', () => {
    // 'ğ' is two bytes: three of them are six "tokens", which a budget of ten
    // cannot take twice.
    expect(planEmbeddingBatches(['ğğğ', 'ğğğ', 'abc'], { maxInputs: 10, maxTokens: 10 })).toEqual([
      ['ğğğ'],
      ['ğğğ', 'abc'],
    ]);
    // A text over the whole budget still travels, alone: the provider judges it.
    expect(planEmbeddingBatches(['x'.repeat(12), 'y'], { maxInputs: 10, maxTokens: 10 })).toEqual([
      ['x'.repeat(12)],
      ['y'],
    ]);
  });

  it('keeps any realistic source in one request by default', () => {
    // tm 254's measured help centre: 100,000 characters, 502 chunks.
    const chunks = Array.from({ length: 502 }, (_, i) => `Paragraph ${i} `.repeat(14));
    expect(chunks.every((chunk) => chunk.length <= 600)).toBe(true);
    expect(
      planEmbeddingBatches(chunks, {
        maxInputs: EMBEDDING_MAX_BATCH_INPUTS,
        maxTokens: EMBEDDING_MAX_BATCH_TOKENS,
      }),
    ).toHaveLength(1);
  });
});

describe('a vector that is not 1536 wide is refused, never cut or padded (FR-MOD-06.3.2)', () => {
  it.each([1535, 1537, 3072, 256])('%i dimensions', async (width) => {
    const net = fakeOpenAiFetch(openAiEmbeddings(() => new Array(width).fill(0.01)));
    const refused = await failure(adapter(net).provider.embed(TEXTS));

    expect(refused).toMatchObject({
      kind: 'bad_response',
      reason: 'dimensions',
      dimensions: width,
    });
    expect(refused.transient).toBe(false);
    // Not retried: the same model would answer the same width again.
    expect(net.calls).toHaveLength(1);
  });

  it('refuses the whole batch when one vector of many is the wrong width', async () => {
    const net = fakeOpenAiFetch(
      openAiEmbeddings((text, index) =>
        index === 1 ? new Array(EMBEDDING_DIMENSIONS - 1).fill(0) : fakeEmbedding(text),
      ),
    );
    const refused = await failure(adapter(net).provider.embed(TEXTS));
    expect(refused).toMatchObject({ kind: 'bad_response', reason: 'dimensions' });
  });

  it.each([
    [
      'count',
      (inputs: string[]) => ({
        data: inputs.slice(1).map((text, index) => ({ index, embedding: fakeEmbedding(text) })),
      }),
    ],
    [
      'index',
      (inputs: string[]) => ({
        data: inputs.map((text) => ({ index: 0, embedding: fakeEmbedding(text) })),
      }),
    ],
    [
      'shape',
      (inputs: string[]) => ({
        data: inputs.map((_, index) => ({
          index,
          embedding: [...new Array<number>(EMBEDDING_DIMENSIONS - 1).fill(0), 'x'],
        })),
      }),
    ],
    ['usage', () => ({ usage: undefined })],
  ] as const)('refuses a list with a wrong %s', async (reason, extra) => {
    const net = fakeOpenAiFetch(openAiEmbeddings((text) => fakeEmbedding(text), extra));
    const refused = await failure(adapter(net).provider.embed(TEXTS));
    expect(refused).toMatchObject({ kind: 'bad_response', reason });
  });

  it('refuses a body that is not JSON', async () => {
    const net = fakeOpenAiFetch(() => new Response('<html>502</html>', { status: 200 }));
    expect(await failure(adapter(net).provider.embed(TEXTS))).toMatchObject({
      kind: 'bad_response',
      reason: 'not_json',
    });
  });
});

describe('what is retried, and what is not', () => {
  it('retries a rate limit, waiting at least as long as Retry-After asks', async () => {
    const net = fakeOpenAiFetch(
      openAiProblem(429, 'rate_limit_exceeded', { headers: { 'retry-after': '3' } }),
      ok(),
    );
    const { provider, sleeps } = adapter(net);

    await provider.embed(TEXTS);

    expect(net.calls).toHaveLength(2);
    expect(sleeps).toEqual([3_000]);
  });

  it('retries a 5xx and a dropped connection, up to the attempt limit', async () => {
    const net = fakeOpenAiFetch(
      openAiProblem(503, 'server_is_overloaded'),
      refusedConnection('ECONNRESET'),
      openAiProblem(500, null),
    );
    const refused = await failure(adapter(net).provider.embed(TEXTS));

    expect(net.calls).toHaveLength(EMBEDDING_MAX_ATTEMPTS);
    expect(refused).toMatchObject({ kind: 'unavailable', status: 500, attempts: 3 });
  });

  it.each([
    [401, 'invalid_api_key', 'auth'],
    [403, 'unsupported_country_region_territory', 'forbidden'],
    [404, 'model_not_found', 'not_found'],
    [400, 'invalid_request_error', 'bad_request'],
    [429, 'insufficient_quota', 'quota_exhausted'],
  ] as const)('does not retry %i %s', async (status, code, kind) => {
    const net = fakeOpenAiFetch(openAiProblem(status, code));
    const refused = await failure(adapter(net).provider.embed(TEXTS));

    expect(net.calls).toHaveLength(1);
    expect(refused).toMatchObject({ kind, status, code, requestId: 'req_abc123' });
  });

  it('refuses a redirect instead of following it', async () => {
    const net = fakeOpenAiFetch(
      () => new Response(null, { status: 307, headers: { location: 'https://elsewhere.test/' } }),
    );
    expect(await failure(adapter(net).provider.embed(TEXTS))).toMatchObject({
      kind: 'bad_response',
      reason: 'redirect',
    });
    expect(net.calls).toHaveLength(1);
  });

  it('gives up at EMBEDDING_TIMEOUT_MS and cancels the request in flight', async () => {
    let aborted = false;
    const net = fakeOpenAiFetch((init) => {
      init.signal?.addEventListener('abort', () => {
        aborted = true;
      });
      return hangingRequest(init);
    });
    const refused = await failure(adapter(net, { timeoutMs: 50 }).provider.embed(TEXTS));

    expect(refused.kind).toBe('timeout');
    expect(aborted).toBe(true);
    // No time left for another attempt, so none was made.
    expect(net.calls).toHaveLength(1);
  });
});

describe('the circuit breaker', () => {
  it('opens after consecutive provider faults and then asks the provider nothing', async () => {
    const net = fakeOpenAiFetch(openAiProblem(401, 'invalid_api_key'));
    const { provider, log } = adapter(net);

    for (let i = 0; i < EMBEDDING_CIRCUIT_FAILURE_THRESHOLD; i++) {
      await failure(provider.embed(TEXTS));
    }
    expect(provider.circuitState).toBe('open');
    const before = net.calls.length;

    expect(await failure(provider.embed(TEXTS))).toMatchObject({ kind: 'circuit_open' });
    expect(net.calls.length).toBe(before);
    expect(
      log.lines.filter((line) => line.details['event'] === 'embedding.circuit_opened'),
    ).toHaveLength(1);
  });

  it('does not count a request the provider refused as the caller’s — a customer can cause those', async () => {
    const net = fakeOpenAiFetch(openAiProblem(400, 'invalid_request_error'));
    const { provider } = adapter(net);

    for (let i = 0; i < EMBEDDING_CIRCUIT_FAILURE_THRESHOLD + 2; i++) {
      await failure(provider.embed(TEXTS));
    }
    expect(provider.circuitState).toBe('closed');
  });
});

describe('the log', () => {
  it('records what happened — never the key, never the text', async () => {
    const net = fakeOpenAiFetch(
      openAiProblem(503, 'server_is_overloaded', { message: `Incorrect API key provided: ${KEY}` }),
      ok(),
    );
    const { provider, log } = adapter(net);

    await provider.embed(TEXTS);

    const events = log.lines.map((line) => line.details['event']);
    expect(events).toEqual([
      'embedding.attempt',
      'embedding.retry',
      'embedding.attempt',
      'embedding.completed',
    ]);
    expect(log.lines.at(-1)!.details).toMatchObject({
      provider: 'openai',
      model: 'text-embedding-3-small',
      inputs: 3,
      requests: 1,
      inputTokens: 21,
    });
    const text = log.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain('Incorrect API key');
    for (const input of TEXTS) expect(text).not.toContain(input);
  });

  it('logs a failure with its kind, status, code and request id', async () => {
    const net = fakeOpenAiFetch(openAiProblem(401, 'invalid_api_key'));
    const { provider, log } = adapter(net);

    await failure(provider.embed(TEXTS));

    const failed = log.lines.find((line) => line.details['event'] === 'embedding.failed')!;
    expect(failed.level).toBe('error');
    expect(failed.details).toMatchObject({
      kind: 'auth',
      status: 401,
      code: 'invalid_api_key',
      requestId: 'req_abc123',
    });
  });

  it('covers the key wherever the configuration or a request could be logged', () => {
    expect(EMBEDDING_SECRET_LOG_PATHS).toEqual(
      expect.arrayContaining([
        'EMBEDDING_API_KEY',
        '*.EMBEDDING_API_KEY',
        'embedding.openai.apiKey',
        '*.embedding.openai.apiKey',
        'headers.authorization',
        '*.headers.authorization',
      ]),
    );
  });
});

describe('a failure a caller can act on', () => {
  it('is an EmbeddingProviderError whose message is safe to log', async () => {
    const net = fakeOpenAiFetch(
      openAiJson(429, { error: { code: 'rate_limit_exceeded', message: TEXTS[0] } }),
    );
    const refused = await failure(adapter(net, { maxAttempts: 1 }).provider.embed(TEXTS));

    expect(refused).toBeInstanceOf(EmbeddingProviderError);
    expect(refused.kind).toBe('rate_limited');
    expect(refused.message).toBe(
      'The embedding provider did not answer (rate_limited, HTTP 429, rate_limit_exceeded).',
    );
    expect(refused.message).not.toContain(TEXTS[0]);
  });
});
