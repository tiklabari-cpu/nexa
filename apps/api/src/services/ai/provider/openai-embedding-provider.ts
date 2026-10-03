/**
 * `EMBEDDING_PROVIDER=openai` — the embedding adapter (tm 255.7 · ADR
 * docs/adr/pilot-llm-embedding-provider.md §4.2 and §10).
 *
 * One request shape: `POST {EMBEDDING_API_BASE_URL}/embeddings` carrying
 * `model` and `input: string[]` and nothing else. No `dimensions`: the pilot's
 * model (`text-embedding-3-small`) is 1536 natively, and asking a model to
 * shorten its vectors would be the kind of silent reshaping this adapter
 * refuses from the provider too. No `encoding_format`: the default is floats.
 * The network is a constructor argument (`fetchImpl`), so every test of this
 * file runs without a provider and without a key.
 *
 * ## Batching
 *
 * `embed(texts)` sends as few requests as the provider's documented limits
 * allow and never one per text: at most {@link EMBEDDING_MAX_BATCH_INPUTS}
 * inputs and {@link EMBEDDING_MAX_BATCH_TOKENS} tokens per request, the texts
 * kept in order, the batches sent one after another. Tokens are counted as
 * UTF-8 bytes, which is an upper bound for a byte-level BPE tokenizer — every
 * token is at least one byte — so a batch planned here can never exceed the
 * provider's limit, only undershoot it. A source (at most 100,000 characters,
 * chunked at 600) is one request; a question is one request.
 *
 * ## When it fails
 *
 * Every failure leaves as an `EmbeddingProviderError` and the whole call fails
 * with it — a source is indexed whole or not at all, so there is no use for
 * the batches that did come back.
 *
 * - **One deadline per request.** `EMBEDDING_TIMEOUT_MS` covers a batch's
 *   attempts and the waits between them, and one `AbortController` cancels
 *   whatever is in flight. A question is one batch, so for the customer
 *   waiting on an answer this is the whole call.
 * - **Retried** (transient): network errors, 429 rate limits and 5xx, up to
 *   {@link EMBEDDING_MAX_ATTEMPTS} attempts with jitter, never sooner than
 *   `Retry-After`, and only while the deadline leaves room for another attempt.
 * - **Never retried** (permanent): other 4xx, the quota 429s, redirects, and a
 *   response that is not a list of 1536-long vectors — one per input.
 * - **The circuit breaker** counts calls, not requests, and opens after
 *   {@link EMBEDDING_CIRCUIT_FAILURE_THRESHOLD} consecutive provider faults;
 *   while open every call fails at once with `circuit_open`.
 *
 * ## The log
 *
 * Events carry the model, the attempt, the batch size, the failure kind, the
 * HTTP status, the provider's error code and request id. Never the key, the
 * text or the provider's error message. {@link EMBEDDING_SECRET_LOG_PATHS}
 * covers the configuration and the outbound request, as the chat adapter's do.
 */
import pino from 'pino';
import { EMBEDDING_SECRET_LOG_PATHS } from '../../../lib/log-redact.js';
import { CircuitBreaker, type CircuitPermit } from './circuit-breaker.js';
import { EmbeddingProviderError } from './embedding-error.js';
import {
  EMBEDDING_DIMENSIONS,
  embeddingSpace,
  type EmbeddingProvider,
  type Embeddings,
  type EmbeddingUsage,
  type OpenAiEmbeddingSettings,
} from './embedding-provider.js';
import {
  classifyHttpFailure,
  equalJitterBackoffMs,
  HEADER_SAFE,
  isCount,
  isRecord,
  networkCode,
  openAiEndpointUrl,
  readCapped,
  readProblem,
  ResponseTooLarge,
  retryAfterMs,
  SAFE_REQUEST_ID,
  safeToken,
} from './openai-http.js';

/** Attempts per request, first included — the chat adapter's number, for its reason. */
export const EMBEDDING_MAX_ATTEMPTS = 3;
export const EMBEDDING_RETRY_BACKOFF_BASE_MS = 1_000;
export const EMBEDDING_RETRY_BACKOFF_CAP_MS = 8_000;

/** The least time an attempt is started with; less could not finish a batch. */
export const EMBEDDING_MIN_ATTEMPT_MS = 1_000;

/** Consecutive failed calls, for reasons that are the provider's, that open the circuit. */
export const EMBEDDING_CIRCUIT_FAILURE_THRESHOLD = 5;
/** How long an open circuit refuses calls before letting one probe through. */
export const EMBEDDING_CIRCUIT_OPEN_MS = 30_000;

/**
 * Inputs per request. OpenAI accepts 2,048; the answer to 2,048 inputs is
 * about 60 MB of JSON — 1,536 numbers of ~20 characters each per input — held
 * in memory by a process that is also serving requests. A quarter of that is
 * still one request for a realistic source at the product's 100,000-character
 * ceiling: tm 254's measured help centre of that size chunked into 502 pieces.
 */
export const EMBEDDING_MAX_BATCH_INPUTS = 512;
/** Tokens per request — OpenAI's own ceiling for the embeddings endpoint (ADR §8). */
export const EMBEDDING_MAX_BATCH_TOKENS = 300_000;

/** Ceiling on a success body, per input: 1,536 numbers at up to ~25 bytes each, doubled. */
const RESPONSE_BYTES_PER_INPUT = 81_920;
/** Room for the envelope around the vectors: `object`, `model`, `usage`. */
const RESPONSE_ENVELOPE_BYTES = 65_536;
/** Ceiling on an error body: only `error.code` and `error.type` are read from it. */
const PROBLEM_MAX_BYTES = 65_536;

/**
 * Where the key would sit if anyone logged the configuration or a request.
 * Kept with every other provider credential in `lib/log-redact.ts` (tm 255.9),
 * which the server's `redact.paths` spreads; used here by the fallback logger.
 */
export { EMBEDDING_SECRET_LOG_PATHS };

/** The narrow log surface the adapter needs — satisfied by Fastify's logger and by pino. */
export interface EmbeddingLogger {
  debug(details: Record<string, unknown>, message: string): void;
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/** For a process with no Fastify logger to hand in — the sweeps' CLIs, `knowledge:reembed`. */
export function defaultEmbeddingLogger(): EmbeddingLogger {
  return pino(
    {
      base: { component: 'embedding' },
      redact: { paths: EMBEDDING_SECRET_LOG_PATHS, censor: '[redacted]' },
    },
    pino.destination(2),
  );
}

export interface OpenAiEmbeddingProviderOptions {
  /** How requests leave the process. Injected by every test; the global `fetch` otherwise. */
  fetchImpl?: typeof fetch;
  logger?: EmbeddingLogger;
  /** Attempts per request; {@link EMBEDDING_MAX_ATTEMPTS} by default. */
  maxAttempts?: number;
  circuit?: { failureThreshold?: number; openMs?: number };
  /** Batch limits, lowered by tests to exercise batching with a handful of texts. */
  batch?: { maxInputs?: number; maxTokens?: number };
  sleep?: (ms: number) => Promise<void>;
  /** The jitter's source, in [0, 1). */
  random?: () => number;
  now?: () => number;
}

/** Wait before the attempt after `attempt` — equal jitter, 1 s / 2 s / 4 s steps capped at 8 s. */
export function embeddingRetryBackoffMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  return equalJitterBackoffMs(attempt, random, {
    baseMs: EMBEDDING_RETRY_BACKOFF_BASE_MS,
    capMs: EMBEDDING_RETRY_BACKOFF_CAP_MS,
  });
}

/** The embeddings endpoint under `EMBEDDING_API_BASE_URL`, or an error for the operator. */
export function embeddingsUrl(baseUrl: string): string {
  return openAiEndpointUrl(baseUrl, {
    key: 'EMBEDDING_API_BASE_URL',
    apiKeyName: 'EMBEDDING_API_KEY',
    path: 'embeddings',
  });
}

/**
 * The texts split into requests, in order: each batch at most `maxInputs`
 * texts and `maxTokens` estimated tokens, where a text's estimate is its UTF-8
 * byte length (see the file header). A text that alone exceeds the token
 * budget still gets a batch of its own — the provider, not this function, is
 * the judge of a single input, and it answers 400.
 */
export function planEmbeddingBatches(
  texts: readonly string[],
  { maxInputs, maxTokens }: { maxInputs: number; maxTokens: number },
): string[][] {
  const encoder = new TextEncoder();
  const batches: string[][] = [];
  let current: string[] = [];
  let tokens = 0;
  for (const text of texts) {
    const estimate = encoder.encode(text).byteLength;
    if (current.length > 0 && (current.length >= maxInputs || tokens + estimate > maxTokens)) {
      batches.push(current);
      current = [];
      tokens = 0;
    }
    current.push(text);
    tokens += estimate;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

type AttemptResult =
  | { ok: true; embeddings: Embeddings }
  | { ok: false; error: EmbeddingProviderError; retryAfterMs: number | null };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'openai' as const;
  readonly space: string;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #apiKey: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #log: EmbeddingLogger;
  readonly #maxAttempts: number;
  readonly #batch: { maxInputs: number; maxTokens: number };
  readonly #openMs: number;
  readonly #breaker: CircuitBreaker;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;
  readonly #now: () => number;

  constructor(settings: OpenAiEmbeddingSettings, options: OpenAiEmbeddingProviderOptions = {}) {
    // Configuration errors fail at boot, where an operator reads them, rather
    // than as a failed call on the first question or the first upload.
    this.#endpoint = embeddingsUrl(settings.baseUrl);
    if (!HEADER_SAFE.test(settings.apiKey)) {
      throw new Error(
        'EMBEDDING_API_KEY contains whitespace or characters an HTTP header cannot carry.',
      );
    }
    this.#model = settings.model;
    this.#apiKey = settings.apiKey;
    this.#timeoutMs = settings.timeoutMs;
    this.space = embeddingSpace(this.id, settings.model);
    this.#fetch = options.fetchImpl ?? fetch;
    this.#log = options.logger ?? defaultEmbeddingLogger();
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? EMBEDDING_MAX_ATTEMPTS);
    this.#batch = {
      maxInputs: Math.max(1, options.batch?.maxInputs ?? EMBEDDING_MAX_BATCH_INPUTS),
      maxTokens: Math.max(1, options.batch?.maxTokens ?? EMBEDDING_MAX_BATCH_TOKENS),
    };
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
    this.#now = options.now ?? Date.now;
    this.#openMs = options.circuit?.openMs ?? EMBEDDING_CIRCUIT_OPEN_MS;
    this.#breaker = new CircuitBreaker({
      failureThreshold: options.circuit?.failureThreshold ?? EMBEDDING_CIRCUIT_FAILURE_THRESHOLD,
      openMs: this.#openMs,
      now: this.#now,
    });
  }

  /** Where the circuit stands — for tests and for anyone deciding what to show an operator. */
  get circuitState(): 'closed' | 'open' | 'half_open' {
    return this.#breaker.state;
  }

  async embed(texts: readonly string[]): Promise<Embeddings> {
    if (texts.length === 0) return { vectors: [], usage: { inputTokens: 0 } };
    // OpenAI answers an empty input with a 400. Refused here instead, before
    // the circuit is consulted: it is the caller's defect, not the provider's,
    // and the knowledge service never sends one (it has nothing to search for).
    if (texts.some((text) => text.trim() === '')) {
      throw new EmbeddingProviderError('bad_request', { reason: 'empty_input' });
    }

    const permit = this.#breaker.acquire();
    if (!permit) {
      this.#log.debug(
        { ...this.#where(), event: 'embedding.short_circuited' },
        'embedding circuit open, provider not called',
      );
      throw new EmbeddingProviderError('circuit_open');
    }

    let outcome: 'healthy' | 'faulty' = 'healthy';
    let inputTokens = 0;
    try {
      const started = this.#now();
      const batches = planEmbeddingBatches(texts, this.#batch);
      const vectors: number[][] = [];
      for (const batch of batches) {
        const result = await this.#embedBatch(batch);
        vectors.push(...result.vectors);
        inputTokens += result.usage.inputTokens;
      }
      this.#log.info(
        {
          ...this.#where(),
          event: 'embedding.completed',
          inputs: texts.length,
          requests: batches.length,
          durationMs: this.#now() - started,
          inputTokens,
        },
        'embedding answered',
      );
      return { vectors, usage: { inputTokens } };
    } catch (error) {
      if (error instanceof EmbeddingProviderError) {
        if (error.providerFault) outcome = 'faulty';
        // The batches that answered before this one were billed, and the
        // daily AI cap counts what was billed (tm 257.20, `metered-embeddings.ts`).
        if (inputTokens > 0 && error.usage === null) error.usage = { inputTokens };
      }
      throw error;
    } finally {
      this.#settle(permit, outcome);
    }
  }

  async #embedBatch(batch: string[]): Promise<Embeddings> {
    const started = this.#now();
    const deadline = started + this.#timeoutMs;
    const controller = new AbortController();
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, this.#timeoutMs);

    // Serialised once: every attempt sends the same bytes.
    const body = JSON.stringify({ model: this.#model, input: batch });

    try {
      for (let attempt = 1; ; attempt += 1) {
        this.#log.debug(
          { ...this.#where(), event: 'embedding.attempt', attempt, inputs: batch.length },
          'embedding request',
        );
        const result = await this.#attempt(body, batch.length, controller.signal, () => expired);
        if (result.ok) return result.embeddings;

        const failure = result.error;
        failure.attempts = attempt;
        const fields = {
          ...this.#where(),
          attempt,
          inputs: batch.length,
          ...failureFields(failure),
        };
        const delayMs = this.#retryDelay(failure, attempt, result.retryAfterMs, deadline);
        if (delayMs !== null) {
          this.#log.warn(
            { ...fields, event: 'embedding.retry', delayMs },
            'embedding attempt failed, retrying',
          );
          await this.#sleep(delayMs);
          continue;
        }

        const level = failure.providerFault ? 'error' : 'warn';
        this.#log[level](
          { ...fields, event: 'embedding.failed', durationMs: this.#now() - started },
          'embedding call failed',
        );
        throw failure;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** How long to wait before the next attempt, or `null` when this failure ends the call. */
  #retryDelay(
    failure: EmbeddingProviderError,
    attempt: number,
    retryAfter: number | null,
    deadline: number,
  ): number | null {
    if (!failure.transient || attempt >= this.#maxAttempts) return null;
    const delay = Math.max(embeddingRetryBackoffMs(attempt, this.#random), retryAfter ?? 0);
    return this.#now() + delay + EMBEDDING_MIN_ATTEMPT_MS <= deadline ? delay : null;
  }

  async #attempt(
    body: string,
    expected: number,
    signal: AbortSignal,
    expired: () => boolean,
  ): Promise<AttemptResult> {
    let response: Response;
    try {
      response = await this.#fetch(this.#endpoint, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body,
        // Refused, not followed: the next hop would receive the text, and
        // nobody configured it.
        redirect: 'manual',
        signal,
      });
    } catch (error) {
      return failed(
        expired()
          ? new EmbeddingProviderError('timeout')
          : new EmbeddingProviderError('network', { code: networkCode(error) }),
      );
    }

    const status = response.status;
    const requestId = safeToken(response.headers.get('x-request-id'), SAFE_REQUEST_ID);

    if (status >= 200 && status < 300) {
      let text: string;
      try {
        text = await readCapped(
          response,
          RESPONSE_ENVELOPE_BYTES + expected * RESPONSE_BYTES_PER_INPUT,
        );
      } catch (error) {
        if (expired()) return failed(new EmbeddingProviderError('timeout', { status, requestId }));
        if (error instanceof ResponseTooLarge) {
          return failed(
            new EmbeddingProviderError('bad_response', { status, requestId, reason: 'too_large' }),
          );
        }
        return failed(
          new EmbeddingProviderError('network', { status, requestId, code: networkCode(error) }),
        );
      }
      return readEmbeddings(text, expected, { status, requestId });
    }

    const problem = await readProblem(response, PROBLEM_MAX_BYTES);
    const kind = classifyHttpFailure(status, problem);
    return {
      ok: false,
      error: new EmbeddingProviderError(kind, {
        status,
        requestId,
        code: problem.code ?? problem.type,
        ...(kind === 'bad_response'
          ? { reason: status >= 300 && status < 400 ? 'redirect' : 'status' }
          : {}),
      }),
      retryAfterMs: retryAfterMs(response.headers.get('retry-after'), this.#now()),
    };
  }

  #settle(permit: CircuitPermit, outcome: 'healthy' | 'faulty'): void {
    const transition = this.#breaker.release(permit, outcome);
    if (transition === 'opened') {
      this.#log.error(
        {
          ...this.#where(),
          event: 'embedding.circuit_opened',
          probe: permit.probe,
          consecutiveFailures: this.#breaker.consecutiveFailures,
          openMs: this.#openMs,
        },
        'embedding circuit opened: indexing fails and questions go to a human until the window ends',
      );
    } else if (transition === 'closed') {
      this.#log.info(
        { ...this.#where(), event: 'embedding.circuit_closed' },
        'embedding circuit closed: the probe was answered',
      );
    }
  }

  #where(): Record<string, unknown> {
    return { provider: this.id, model: this.#model };
  }
}

function failed(error: EmbeddingProviderError): AttemptResult {
  return { ok: false, error, retryAfterMs: null };
}

/**
 * A 2xx body read as an embedding list, field by field — the body is whatever
 * the far end sent. One vector per input, placed by its `index` (the position
 * OpenAI documents it as) rather than by where it sits in the array, each
 * exactly {@link EMBEDDING_DIMENSIONS} finite numbers. Anything else fails the
 * whole batch: a list with a vector missing, doubled or the wrong length
 * cannot be written, and guessing which input it belonged to would be worse.
 */
function readEmbeddings(
  text: string,
  expected: number,
  meta: { status: number; requestId: string | null },
): AttemptResult {
  const malformed = (reason: string, extra: { dimensions?: number } = {}) =>
    failed(new EmbeddingProviderError('bad_response', { ...meta, reason, ...extra }));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return malformed('not_json');
  }
  if (!isRecord(parsed)) return malformed('shape');

  // The bill is part of the answer, as it is for chat: tm 255.9 meters it.
  const usage = readUsage(parsed['usage']);
  if (!usage) return malformed('usage');

  const data = parsed['data'];
  if (!Array.isArray(data)) return malformed('shape');
  if (data.length !== expected) return malformed('count');

  const vectors = new Array<number[] | undefined>(expected).fill(undefined);
  for (const item of data) {
    if (!isRecord(item)) return malformed('shape');
    const index = item['index'];
    if (!isCount(index) || index >= expected || vectors[index] !== undefined) {
      return malformed('index');
    }
    const embedding = item['embedding'];
    if (!Array.isArray(embedding)) return malformed('shape');
    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      return malformed('dimensions', { dimensions: embedding.length });
    }
    if (!embedding.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      return malformed('shape');
    }
    vectors[index] = embedding as number[];
  }

  return { ok: true, embeddings: { vectors: vectors as number[][], usage } };
}

function readUsage(value: unknown): EmbeddingUsage | null {
  if (!isRecord(value)) return null;
  const input = value['prompt_tokens'];
  return isCount(input) ? { inputTokens: input } : null;
}

function failureFields(error: EmbeddingProviderError): Record<string, unknown> {
  return {
    kind: error.kind,
    transient: error.transient,
    ...(error.status ? { status: error.status } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.reason ? { reason: error.reason } : {}),
    ...(error.dimensions !== null ? { dimensions: error.dimensions } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
  };
}
