/**
 * The `chat/completions` transport the OpenAI-shaped adapters share (tm 480).
 *
 * tm 255.6 wrote this loop inside the OpenAI chat adapter. DeepSeek and Kimi
 * (Moonshot) answer the same request shape — `POST …/chat/completions`, a
 * bearer key, `choices[0].message.content`, `usage` — but ADR §0/§3 does not
 * let "OpenAI-compatible" mean "the OpenAI adapter": each vendor is its own
 * enum value and its own adapter, because each differs where it matters (the
 * body's fields, which failure an error code is, how structured output is
 * asked for). So the part that is the same was lifted out of the OpenAI
 * adapter into this file, unchanged, and each adapter is now a **dialect** on
 * top of it.
 *
 * ## What is here (one copy for every OpenAI-shaped vendor)
 *
 * - One deadline for the whole call (`timeoutMs`), one `AbortController`
 *   cancelling whatever is in flight — the fetch or the body read.
 * - Up to {@link LLM_MAX_ATTEMPTS} attempts for transient failures, equal
 *   jitter, never sooner than `Retry-After`, never a wait the deadline cannot
 *   outlast by {@link LLM_MIN_ATTEMPT_MS}.
 * - The circuit breaker in front (`circuit-breaker.ts`).
 * - The request: bearer key, JSON, `redirect: 'manual'` (a redirect is refused,
 *   not followed — the next hop would receive the conversation).
 * - The response: a 2xx body read up to {@link LLM_MAX_RESPONSE_BYTES}, an
 *   error body up to 64 KiB of which only `error.code`, `error.type` and
 *   `error.param` are kept (`openai-http.ts` `readProblem`), `x-request-id`.
 * - {@link readChatCompletion}: a 2xx body read as a completion, field by field.
 * - The log lines: model, attempt, kind, status, code, request id — never the
 *   key, the prompt, the reply or the provider's message.
 *
 * ## What a dialect decides ({@link ChatCompletionsDialect})
 *
 * - `body` — the request body (field names differ: `max_completion_tokens`
 *   for OpenAI and Kimi, `max_tokens` for DeepSeek; vendor switches).
 * - `classify` — which failure an HTTP status and error body are: each vendor
 *   has its own table of quota, pace and outage codes.
 * - `read` — usually {@link readChatCompletion} with the vendor's `usage`.
 * - `structuredMode` / `fallback` — how a `responseFormat` is sent, and what a
 *   model that refuses it gets next (OpenAI: `json_schema` → schema in the
 *   prompt; Kimi: `json_schema` → `json_object`; DeepSeek: `json_object` only).
 *
 * Nothing here checks the reply against the schema: that is
 * `completeStructured`'s gate (`structured-output.ts`), which every provider's
 * reply passes.
 */
import pino from 'pino';
import { LLM_SECRET_LOG_PATHS } from '../../../lib/log-redact.js';
import { CircuitBreaker, type CircuitPermit } from './circuit-breaker.js';
import { LLM_EMPTY_LENGTH_HINT, LlmProviderError } from './llm-error.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProviderId,
  LlmTier,
  LlmUsage,
} from './llm-provider.js';
import {
  equalJitterBackoffMs,
  HEADER_SAFE,
  isCount,
  isRecord,
  networkCode,
  readCapped,
  readProblem,
  ResponseTooLarge,
  retryAfterMs,
  SAFE_CODE,
  SAFE_REQUEST_ID,
  safeToken,
  type HttpFailureKind,
} from './openai-http.js';

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
/** Ceiling on an error body: only `error.code`, `error.type` and `error.param` are read from it. */
const PROBLEM_MAX_BYTES = 65_536;

/** The narrow log surface the adapters need — satisfied by Fastify's logger and by pino. */
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

/** What a log line says about a failure — every adapter's, the Anthropic one included (tm 479). */
export function llmFailureFields(error: LlmProviderError): Record<string, unknown> {
  return {
    kind: error.kind,
    transient: error.transient,
    ...(error.status ? { status: error.status } : {}),
    ...(error.code ? { code: error.code } : {}),
    ...(error.reason ? { reason: error.reason } : {}),
    ...(error.requestId ? { requestId: error.requestId } : {}),
    ...(error.hint ? { hint: error.hint } : {}),
  };
}

/** How the adapters on this transport are tuned — every field has a default; tests inject them. */
export interface ChatCompletionsOptions {
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

/** `error.code`, `error.type` and `error.param` of an error body, as `readProblem` kept them. */
export interface HttpProblem {
  code: string | null;
  type: string | null;
  param: string | null;
}

export type AttemptResult =
  | { ok: true; completion: LlmCompletion }
  | {
      ok: false;
      error: LlmProviderError;
      retryAfterMs: number | null;
      /** The error body's fields, when the failure was an HTTP answer. */
      problem?: HttpProblem;
    };

/** What a 2xx body is read with — besides the body itself. */
export interface CompletionMeta {
  status: number;
  requestId: string | null;
}

/** A dialect's decision to send a structured call another way (see {@link ChatCompletionsDialect.fallback}). */
export interface StructuredFallback<Mode extends string> {
  mode: Mode;
  /** The warning's `event`, e.g. `llm.json_schema_unsupported`. */
  event: string;
  /** The warning's message — this module's sentence, never provider text. */
  message: string;
}

/** What one vendor decides on top of the shared transport. */
export interface ChatCompletionsDialect<Mode extends string> {
  /** The mode a structured request for `model` is sent in first. */
  structuredMode(model: string): Mode;
  /** The request body for one mode (`null`: no `responseFormat`). Serialised once per mode. */
  body(request: LlmCompletionRequest, model: string, mode: Mode | null): string;
  /** Which failure an HTTP status and error body are — the vendor's own table. */
  classify(status: number, problem: HttpProblem): HttpFailureKind;
  /** A 2xx body read as a completion. */
  read(text: string, meta: CompletionMeta): AttemptResult;
  /**
   * After a structured attempt in `mode` failed: the mode the same call goes
   * on in, when the failure says this model cannot be asked that way — the
   * dialect remembers it for the model's later calls — else `null`.
   */
  fallback?(
    model: string,
    mode: Mode,
    failure: LlmProviderError,
    problem: HttpProblem | null,
  ): StructuredFallback<Mode> | null;
}

/** Where a transport sends, and as whom. */
export interface ChatCompletionsTarget {
  provider: LlmProviderId;
  /** The full `…/chat/completions` URL, already checked by the adapter. */
  endpoint: string;
  /** A secret. Never logged, never echoed into an error message. */
  apiKey: string;
  model: string;
  /** `LLM_MODEL_FAST`; absent or `null` — `model` answers every tier (ADR §6a.5). */
  fastModel?: string | null;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class ChatCompletionsTransport<Mode extends string> {
  readonly #provider: LlmProviderId;
  readonly #endpoint: string;
  readonly #model: string;
  readonly #fastModel: string;
  readonly #apiKey: string;
  readonly #dialect: ChatCompletionsDialect<Mode>;
  readonly #fetch: typeof fetch;
  readonly #log: LlmLogger;
  readonly #maxAttempts: number;
  readonly #openMs: number;
  readonly #breaker: CircuitBreaker;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #random: () => number;
  readonly #now: () => number;

  constructor(
    target: ChatCompletionsTarget,
    dialect: ChatCompletionsDialect<Mode>,
    options: ChatCompletionsOptions = {},
  ) {
    if (!HEADER_SAFE.test(target.apiKey)) {
      // A stray newline from an .env edit would otherwise surface as a "network"
      // failure on every call, retried and counted against the provider.
      throw new Error('LLM_API_KEY contains whitespace or characters an HTTP header cannot carry.');
    }
    this.#provider = target.provider;
    this.#endpoint = target.endpoint;
    this.#model = target.model;
    this.#fastModel = target.fastModel || target.model;
    this.#apiKey = target.apiKey;
    this.#dialect = dialect;
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

  /** The model a tier is answered by (ADR §6a.5). */
  modelFor(tier: LlmTier = 'default'): string {
    return tier === 'fast' ? this.#fastModel : this.#model;
  }

  /** One call: the adapter's `LlmProvider` method, behind the circuit breaker. */
  async send(request: LlmCompletionRequest): Promise<LlmCompletion> {
    const permit = this.#breaker.acquire();
    if (!permit) {
      // Debug, not warn: the opening was logged once as an error, and a line per
      // refused call while the window lasts would bury it.
      this.#log.debug(
        { ...this.#where(this.modelFor(request.tier), request), event: 'llm.short_circuited' },
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
    const model = this.modelFor(request.tier);
    const where = this.#where(model, request);
    const started = this.#now();
    const deadline = started + request.timeoutMs;
    const controller = new AbortController();
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, request.timeoutMs);

    let mode: Mode | null = request.responseFormat ? this.#dialect.structuredMode(model) : null;
    let body = this.#dialect.body(request, model, mode);

    try {
      for (let attempt = 1; ; attempt += 1) {
        this.#log.debug({ ...where, event: 'llm.attempt', attempt }, 'llm request');
        const result = await this.#attempt(body, controller.signal, () => expired);

        if (result.ok) {
          const { usage } = result.completion;
          this.#log.info(
            {
              ...where,
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
        const fields = { ...where, attempt, ...llmFailureFields(failure) };

        const next =
          mode !== null && this.#dialect.fallback
            ? this.#dialect.fallback(model, mode, failure, result.problem ?? null)
            : null;
        if (next) {
          // Remembered by the dialect whether or not there is time to try again:
          // the model's next call starts in the new mode either way.
          mode = next.mode;
          body = this.#dialect.body(request, model, mode);
          const retrying =
            attempt < this.#maxAttempts && this.#now() + LLM_MIN_ATTEMPT_MS <= deadline;
          this.#log.warn({ ...fields, event: next.event, retrying }, next.message);
          if (retrying) continue;
        }
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
      return this.#dialect.read(text, { status, requestId });
    }

    // Every other status is a failure; the body only refines which one. It is
    // read — capped — either way, so the connection is released.
    const problem = await readProblem(response, PROBLEM_MAX_BYTES);
    const kind = this.#dialect.classify(status, problem);
    return {
      ok: false,
      problem,
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
          ...this.#where(this.#model),
          event: 'llm.circuit_opened',
          probe: permit.probe,
          consecutiveFailures: this.#breaker.consecutiveFailures,
          openMs: this.#openMs,
        },
        'llm circuit opened: calls fail fast and go to a human until the window ends',
      );
    } else if (transition === 'closed') {
      this.#log.info(
        { ...this.#where(this.#model), event: 'llm.circuit_closed' },
        'llm circuit closed: the probe was answered',
      );
    }
  }

  /**
   * What every line about a call carries: the provider, the model and, for a
   * call that is not a plain default one, its tier and the structured output it
   * asked for — by name; the schema is the caller's and the reply is never logged.
   */
  #where(model: string, request?: LlmCompletionRequest): Record<string, unknown> {
    return {
      provider: this.#provider,
      model,
      ...(request?.tier === 'fast' ? { tier: 'fast' } : {}),
      ...(request?.responseFormat ? { format: request.responseFormat.name } : {}),
    };
  }
}

export function failed(error: LlmProviderError): AttemptResult {
  return { ok: false, error, retryAfterMs: null };
}

/** How a vendor's 2xx body differs from the shape {@link readChatCompletion} reads. */
export interface CompletionReading {
  /** The bill, from the body's `usage`; `null` when it is not one. */
  usage(value: unknown): LlmUsage | null;
  /**
   * Finish reasons that are the provider failing rather than the reply ending —
   * `unavailable`, so retried and counted against the provider (DeepSeek's
   * `insufficient_system_resource`, tm 480).
   */
  unavailableFinishes?: ReadonlySet<string>;
  /** The operator's sentence for a reply cut off before any text; {@link LLM_EMPTY_LENGTH_HINT} by default. */
  emptyLengthHint?: string;
}

/**
 * A 2xx body read as a chat completion. The shape is checked field by field —
 * the body is whatever the far end sent — and a reply is only an answer when
 * the model finished on its own (`stop`), refused nothing and wrote something.
 *
 * Only `message.content` is read. A reasoning model's `reasoning_content`
 * (DeepSeek, Kimi) is never read: it is not the reply, and a reply whose
 * `content` is empty is `no_answer` / `empty` however much reasoning came with
 * it (tm 480).
 */
export function readChatCompletion(
  text: string,
  meta: CompletionMeta,
  reading: CompletionReading,
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
  const usage = reading.usage(parsed['usage']);
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

  if (reading.unavailableFinishes?.has(finish)) {
    return failed(
      new LlmProviderError('unavailable', {
        ...meta,
        reason: safeToken(finish, SAFE_CODE) ?? 'finish_reason',
        usage,
      }),
    );
  }

  const unanswered = (reason: string, hint?: string) =>
    failed(new LlmProviderError('no_answer', { ...meta, reason, usage, hint: hint ?? null }));
  // `length` is a reply cut off at the output ceiling; `content_filter` and
  // anything else are not a finished reply either. Cut off before any text at
  // all is the configuration's failure, not the question's: said in the log.
  if (finish === 'length' && !(typeof content === 'string' && content.trim())) {
    return unanswered('length', reading.emptyLengthHint ?? LLM_EMPTY_LENGTH_HINT);
  }
  if (finish !== 'stop') return unanswered(safeToken(finish, SAFE_CODE) ?? 'finish_reason');
  if (typeof refusal === 'string' && refusal.trim()) return unanswered('refusal');
  const answer = typeof content === 'string' ? content.trim() : '';
  if (!answer) return unanswered('empty');

  return { ok: true, completion: { text: answer, usage } };
}

/** `usage.prompt_tokens` / `usage.completion_tokens` — the OpenAI shape every dialect starts from. */
export function readPromptCompletionUsage(value: unknown): LlmUsage | null {
  if (!isRecord(value)) return null;
  const input = value['prompt_tokens'];
  const output = value['completion_tokens'];
  return isCount(input) && isCount(output) ? { inputTokens: input, outputTokens: output } : null;
}

/**
 * The plain-JSON instruction (ADR §6a.4.1), appended to the system prompt. The
 * schema is the caller's, so it is safe to send; it says nothing about the
 * conversation.
 */
export function jsonSchemaInstruction(schema: unknown): string {
  return `Reply with exactly one JSON object and nothing else — no prose, no code fence. It must match this JSON Schema:\n${JSON.stringify(schema)}`;
}

/**
 * {@link jsonSchemaInstruction} for a request sent with
 * `response_format: { type: 'json_object' }` (DeepSeek, Kimi — tm 480). JSON
 * mode guarantees an object, not the caller's object, so the schema has to be
 * in the prompt; DeepSeek's guide also requires the word "json" in it, which
 * is why the sentence names it in lower case as well.
 */
export function jsonObjectInstruction(schema: unknown): string {
  return `Answer in json. ${jsonSchemaInstruction(schema)}`;
}
