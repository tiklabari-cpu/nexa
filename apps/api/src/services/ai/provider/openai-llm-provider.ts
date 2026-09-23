/**
 * `LLM_PROVIDER=openai` — the chat adapter (tm 255.6 · ADR
 * docs/adr/pilot-llm-embedding-provider.md §3.1 and §10).
 *
 * One request shape: `POST {LLM_API_BASE_URL}/chat/completions` carrying
 * `model`, `messages` and `max_completion_tokens` and nothing else — no
 * streaming, no tools, no response format (ADR §5, §6). The answer is
 * `choices[0].message.content`, the bill is `usage`. The network is a
 * constructor argument (`fetchImpl`, the `createHttpWebhookSender` pattern), so
 * every test of this file runs without a provider and without a key.
 *
 * ## When it fails
 *
 * Every failure leaves as an `LlmProviderError` (`llm-error.ts`) and the skill
 * engine turns every one of them into a conversation a human answers. What
 * differs is what happens before the error gets there:
 *
 * - **One deadline for the whole call.** `LLM_TIMEOUT_MS` covers every attempt
 *   and every wait between them. The call runs inside the request that stored
 *   the customer's message (`routes/customer.ts`), so the deadline is how long
 *   a customer's send can be held; a per-attempt timeout would multiply it by
 *   the attempt count. One `AbortController` spans the call and aborting it
 *   cancels whatever is in flight — the fetch, or the body read after it — so
 *   an abandoned request does not keep running behind the error.
 * - **Retried** (transient): network errors, 429 rate limits and 5xx, up to
 *   {@link LLM_MAX_ATTEMPTS} attempts, backing off with jitter (OpenAI's own
 *   advice) and never sooner than the provider's `Retry-After`. Only while the
 *   deadline still leaves {@link LLM_MIN_ATTEMPT_MS} for the next attempt: a
 *   wait that would outlast the deadline is not started, because failing later
 *   is the same result, later.
 * - **Never retried** (permanent): 400, 401, 403, 404 and every other 4xx; a
 *   429 whose code says the account is out of credit or over a spend limit —
 *   OpenAI's guide: retrying "won't restore API access"; a response that is not
 *   a completion; and a completion with no answer in it, which includes one
 *   cut off at `max_completion_tokens` — half a sentence is not a reply to send
 *   a customer.
 * - **The circuit breaker** (`circuit-breaker.ts`) stands in front of all of
 *   it, so an outage costs the first few customers a deadline each rather than
 *   every customer.
 *
 * ## The log
 *
 * Events carry the model id, the attempt, the failure kind, the HTTP status,
 * the provider's error code and its request id. Never the key, the prompt, the
 * reply or the provider's error message (`llm-error.ts` says why the last).
 * {@link LLM_SECRET_LOG_PATHS} covers the other way the key could reach a line
 * — somebody logging the configuration.
 */
import pino from 'pino';
import { CircuitBreaker, type CircuitPermit } from './circuit-breaker.js';
import { LlmProviderError } from './llm-error.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmUsage,
  OpenAiSettings,
} from './llm-provider.js';
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
  SAFE_CODE,
  SAFE_REQUEST_ID,
  safeToken,
} from './openai-http.js';

// Moved to `openai-http.ts` when the embedding adapter needed them too
// (tm 255.7); still exported from here, where 255.6 published them.
export { classifyHttpFailure, OPENAI_QUOTA_CODES, retryAfterMs } from './openai-http.js';

/**
 * Attempts per call, first included. Three, like the mail carrier and the
 * webhook burst: a customer is waiting, so what a retry can ride out is a blip.
 */
export const LLM_MAX_ATTEMPTS = 3;
export const LLM_RETRY_BACKOFF_BASE_MS = 1_000;
export const LLM_RETRY_BACKOFF_CAP_MS = 8_000;

/**
 * The least time an attempt is started with. A request given less could not
 * finish a completion, and it would still be billed for whatever the model
 * generated before the abort.
 */
export const LLM_MIN_ATTEMPT_MS = 1_000;

/** Consecutive failed calls, for reasons that are the provider's, that open the circuit. */
export const LLM_CIRCUIT_FAILURE_THRESHOLD = 5;
/** How long an open circuit refuses calls before letting one probe through. */
export const LLM_CIRCUIT_OPEN_MS = 30_000;

/**
 * Ceiling on a success body. A reply is at most `LLM_MAX_OUTPUT_TOKENS`
 * (≤ 16,384) tokens — a few tens of kilobytes of JSON — so a mebibyte is room
 * for any real completion and a cap on anything else.
 */
export const LLM_MAX_RESPONSE_BYTES = 1_048_576;
/** Ceiling on an error body: only `error.code` and `error.type` are read from it. */
const PROBLEM_MAX_BYTES = 65_536;

/**
 * Where the key would sit if anyone logged the configuration or a request: the
 * env key, `env.llm.openai.apiKey` and the adapter's `openai.apiKey`, and an
 * outbound request's `headers.authorization` — each at the top of a log object
 * and one level down, since pino paths do not recurse. Spread into the server's
 * `redact.paths` and used by {@link defaultLlmLogger}.
 */
export const LLM_SECRET_LOG_PATHS = [
  'LLM_API_KEY',
  '*.LLM_API_KEY',
  'openai.apiKey',
  '*.openai.apiKey',
  'llm.openai.apiKey',
  '*.llm.openai.apiKey',
  'headers.authorization',
  '*.headers.authorization',
];

/** The narrow log surface the adapter needs — satisfied by Fastify's logger and by pino. */
export interface LlmLogger {
  debug(details: Record<string, unknown>, message: string): void;
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

/** For a process with no Fastify logger to hand in. Stderr, like the mail carrier's. */
export function defaultLlmLogger(): LlmLogger {
  return pino(
    {
      base: { component: 'llm' },
      redact: { paths: LLM_SECRET_LOG_PATHS, censor: '[redacted]' },
    },
    pino.destination(2),
  );
}

export interface OpenAiLlmProviderOptions {
  /** How requests leave the process. Injected by every test; the global `fetch` otherwise. */
  fetchImpl?: typeof fetch;
  logger?: LlmLogger;
  /** Attempts per call; {@link LLM_MAX_ATTEMPTS} by default. */
  maxAttempts?: number;
  circuit?: { failureThreshold?: number; openMs?: number };
  /** Injectable so tests do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
  /** The jitter's source, in [0, 1). */
  random?: () => number;
  now?: () => number;
}

/**
 * Wait before the attempt after `attempt`. "Equal jitter": half of the
 * exponential step (1 s, 2 s, 4 s, capped at 8 s) is fixed and half is random —
 * random so the customers one 429 turned away do not all return in the same
 * millisecond, half fixed so a retry is never immediate.
 */
export function llmRetryBackoffMs(attempt: number, random: () => number = Math.random): number {
  return equalJitterBackoffMs(attempt, random, {
    baseMs: LLM_RETRY_BACKOFF_BASE_MS,
    capMs: LLM_RETRY_BACKOFF_CAP_MS,
  });
}

/**
 * The chat endpoint under `LLM_API_BASE_URL`, or an error for the operator —
 * `openAiEndpointUrl` says what is checked and why.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  return openAiEndpointUrl(baseUrl, {
    key: 'LLM_API_BASE_URL',
    apiKeyName: 'LLM_API_KEY',
    path: 'chat/completions',
  });
}

type AttemptResult =
  | { ok: true; completion: LlmCompletion }
  | { ok: false; error: LlmProviderError; retryAfterMs: number | null };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class OpenAiLlmProvider implements LlmProvider {
  readonly id = 'openai' as const;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #log: LlmLogger;
  readonly #maxAttempts: number;
  readonly #openMs: number;
  readonly #breaker: CircuitBreaker;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;
  readonly #now: () => number;

  constructor(settings: OpenAiSettings, options: OpenAiLlmProviderOptions = {}) {
    // Configuration errors fail at boot, where an operator reads them, rather
    // than as a failed call on the first customer message.
    this.#endpoint = chatCompletionsUrl(settings.baseUrl);
    if (!HEADER_SAFE.test(settings.apiKey)) {
      // A stray newline from an .env edit would otherwise surface as a "network"
      // failure on every call, retried and counted against the provider.
      throw new Error('LLM_API_KEY contains whitespace or characters an HTTP header cannot carry.');
    }
    this.#model = settings.model;
    this.#apiKey = settings.apiKey;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#log = options.logger ?? defaultLlmLogger();
    this.#maxAttempts = Math.max(1, options.maxAttempts ?? LLM_MAX_ATTEMPTS);
    this.#sleep = options.sleep ?? defaultSleep;
    this.#random = options.random ?? Math.random;
    this.#now = options.now ?? Date.now;
    this.#openMs = options.circuit?.openMs ?? LLM_CIRCUIT_OPEN_MS;
    this.#breaker = new CircuitBreaker({
      failureThreshold: options.circuit?.failureThreshold ?? LLM_CIRCUIT_FAILURE_THRESHOLD,
      openMs: this.#openMs,
      now: this.#now,
    });
  }

  /** Where the circuit stands — for tests and for anyone deciding what to show an operator. */
  get circuitState(): 'closed' | 'open' | 'half_open' {
    return this.#breaker.state;
  }

  async complete(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const permit = this.#breaker.acquire();
    if (!permit) {
      // Debug, not warn: the opening was logged once as an error, and a line per
      // refused call while the window lasts would bury it.
      this.#log.debug(
        { ...this.#where(), event: 'llm.short_circuited' },
        'llm circuit open, provider not called',
      );
      throw new LlmProviderError('circuit_open');
    }

    let outcome: 'healthy' | 'faulty' = 'healthy';
    try {
      return await this.#call(request);
    } catch (error) {
      if (error instanceof LlmProviderError && error.providerFault) outcome = 'faulty';
      throw error;
    } finally {
      this.#settle(permit, outcome);
    }
  }

  async #call(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const started = this.#now();
    const deadline = started + request.timeoutMs;
    const controller = new AbortController();
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, request.timeoutMs);

    // Serialised once: every attempt sends the same bytes.
    const body = JSON.stringify({
      model: this.#model,
      messages: [{ role: 'system', content: request.system }, ...request.messages],
      max_completion_tokens: request.maxOutputTokens,
    });

    try {
      for (let attempt = 1; ; attempt += 1) {
        this.#log.debug({ ...this.#where(), event: 'llm.attempt', attempt }, 'llm request');
        const result = await this.#attempt(body, controller.signal, () => expired);

        if (result.ok) {
          const { usage } = result.completion;
          this.#log.info(
            {
              ...this.#where(),
              event: 'llm.completed',
              attempts: attempt,
              durationMs: this.#now() - started,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
            },
            'llm answered',
          );
          return result.completion;
        }

        const failure = result.error;
        failure.attempts = attempt;
        const fields = { ...this.#where(), attempt, ...failureFields(failure) };
        const delayMs = this.#retryDelay(failure, attempt, result.retryAfterMs, deadline);
        if (delayMs !== null) {
          this.#log.warn(
            { ...fields, event: 'llm.retry', delayMs },
            'llm attempt failed, retrying',
          );
          await this.#sleep(delayMs);
          continue;
        }

        // Error when the provider is failing — what an operator is paged for;
        // warn when the provider answered and the request was the problem.
        const level = failure.providerFault ? 'error' : 'warn';
        this.#log[level](
          { ...fields, event: 'llm.failed', durationMs: this.#now() - started },
          'llm call failed',
        );
        throw failure;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /** How long to wait before the next attempt, or `null` when this failure ends the call. */
  #retryDelay(
    failure: LlmProviderError,
    attempt: number,
    retryAfter: number | null,
    deadline: number,
  ): number | null {
    if (!failure.transient || attempt >= this.#maxAttempts) return null;
    const delay = Math.max(llmRetryBackoffMs(attempt, this.#random), retryAfter ?? 0);
    return this.#now() + delay + LLM_MIN_ATTEMPT_MS <= deadline ? delay : null;
  }

  async #attempt(
    body: string,
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
        // Refused, not followed: the next hop would receive the conversation,
        // and nobody configured it.
        redirect: 'manual',
        signal,
      });
    } catch (error) {
      return failed(
        expired()
          ? new LlmProviderError('timeout')
          : new LlmProviderError('network', { code: networkCode(error) }),
      );
    }

    const status = response.status;
    const requestId = safeToken(response.headers.get('x-request-id'), SAFE_REQUEST_ID);

    if (status >= 200 && status < 300) {
      let text: string;
      try {
        text = await readCapped(response, LLM_MAX_RESPONSE_BYTES);
      } catch (error) {
        if (expired()) return failed(new LlmProviderError('timeout', { status, requestId }));
        if (error instanceof ResponseTooLarge) {
          return failed(
            new LlmProviderError('bad_response', { status, requestId, reason: 'too_large' }),
          );
        }
        return failed(
          new LlmProviderError('network', { status, requestId, code: networkCode(error) }),
        );
      }
      return readCompletion(text, { status, requestId });
    }

    // Every other status is a failure; the body only refines which one. It is
    // read — capped — either way, so the connection is released.
    const problem = await readProblem(response, PROBLEM_MAX_BYTES);
    const kind = classifyHttpFailure(status, problem);
    return {
      ok: false,
      error: new LlmProviderError(kind, {
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
          event: 'llm.circuit_opened',
          probe: permit.probe,
          consecutiveFailures: this.#breaker.consecutiveFailures,
          openMs: this.#openMs,
        },
        'llm circuit opened: calls fail fast and go to a human until the window ends',
      );
    } else if (transition === 'closed') {
      this.#log.info(
        { ...this.#where(), event: 'llm.circuit_closed' },
        'llm circuit closed: the probe was answered',
      );
    }
  }

  #where(): Record<string, unknown> {
    return { provider: this.id, model: this.#model };
  }
}

function failed(error: LlmProviderError): AttemptResult {
  return { ok: false, error, retryAfterMs: null };
}

/**
 * A 2xx body read as a chat completion. The shape is checked field by field —
 * the body is whatever the far end sent — and a reply is only an answer when
 * the model finished on its own (`stop`), refused nothing and wrote something.
 */
function readCompletion(
  text: string,
  meta: { status: number; requestId: string | null },
): AttemptResult {
  const malformed = (reason: string) =>
    failed(new LlmProviderError('bad_response', { ...meta, reason }));

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return malformed('not_json');
  }
  if (!isRecord(parsed)) return malformed('shape');

  // The bill is part of the answer: tm 255.9 meters these, and a completion
  // that does not say what it cost cannot be counted.
  const usage = readUsage(parsed['usage']);
  const choices: unknown = parsed['choices'];
  const choice: unknown = Array.isArray(choices) ? choices[0] : undefined;
  const message: unknown = isRecord(choice) ? choice['message'] : undefined;
  if (!usage || !isRecord(choice) || !isRecord(message)) return malformed('shape');
  const finish = choice['finish_reason'];
  const content = message['content'];
  const refusal = message['refusal'];
  if (typeof finish !== 'string' || !(content == null || typeof content === 'string')) {
    return malformed('shape');
  }

  const unanswered = (reason: string) =>
    failed(new LlmProviderError('no_answer', { ...meta, reason, usage }));
  // `length` is a reply cut off at max_completion_tokens; `content_filter` and
  // anything else are not a finished reply either.
  if (finish !== 'stop') return unanswered(safeToken(finish, SAFE_CODE) ?? 'finish_reason');
  if (typeof refusal === 'string' && refusal.trim()) return unanswered('refusal');
  const answer = typeof content === 'string' ? content.trim() : '';
  if (!answer) return unanswered('empty');

  return { ok: true, completion: { text: answer, usage } };
}

function readUsage(value: unknown): LlmUsage | null {
  if (!isRecord(value)) return null;
  const input = value['prompt_tokens'];
  const output = value['completion_tokens'];
  return isCount(input) && isCount(output) ? { inputTokens: input, outputTokens: output } : null;
}

function failureFields(error: LlmProviderError): Record<string, unknown> {
  return {
    kind: error.kind,
    transient: error.transient,
    ...(error.status ? { status: error.status } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.reason ? { reason: error.reason } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
  };
}
