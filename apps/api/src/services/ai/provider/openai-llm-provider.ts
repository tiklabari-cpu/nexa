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
import { LlmProviderError, type LlmFailureKind } from './llm-error.js';
import type {
  LlmCompletion,
  LlmCompletionRequest,
  LlmProvider,
  LlmUsage,
  OpenAiSettings,
} from './llm-provider.js';

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
 * 429 codes that mean money, not pace (ADR §3.1, OpenAI's error-code guide):
 * retrying "won't restore API access", and it would spend the customer's wait
 * on requests that cannot succeed. `insufficient_quota` is the code OpenAI's
 * API long answered the same condition with; today's guide no longer lists it,
 * and recognising it costs nothing.
 */
export const OPENAI_QUOTA_CODES: ReadonlySet<string> = new Set([
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'insufficient_quota',
]);

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
  const step = Math.min(
    LLM_RETRY_BACKOFF_CAP_MS,
    LLM_RETRY_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1),
  );
  return Math.round(step / 2 + random() * (step / 2));
}

/**
 * A `Retry-After` header in milliseconds, or `null` when absent or unreadable.
 * RFC 9110 §10.2.3 allows seconds or an HTTP-date; both are honoured.
 */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * The chat endpoint under `LLM_API_BASE_URL`, or an error for the operator.
 *
 * The base comes from configuration, not from a tenant, so `lib/ssrf.ts`'s
 * private-address rule is not the check it needs: development points this at a
 * stand-in on loopback on purpose, and production is already narrower than
 * "any public host" — `llmEndpointProblem` admits the two regional OpenAI hosts
 * and nothing else. What is checked here is what would make the adapter's own
 * request wrong: a scheme fetch cannot use, a credential in the URL (it would
 * travel outside `LLM_API_KEY`'s redaction), and a query or fragment the
 * appended path would silently drop. None of the messages repeats the URL — the
 * credential case is exactly the one where it must not be printed.
 */
export function chatCompletionsUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('LLM_API_BASE_URL is not a URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('LLM_API_BASE_URL must be an http(s) URL.');
  }
  if (url.username || url.password) {
    throw new Error(
      'LLM_API_BASE_URL must not carry credentials; the key belongs in LLM_API_KEY, which is kept out of logs.',
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      'LLM_API_BASE_URL must not have a query string or fragment: the adapter appends /chat/completions to its path.',
    );
  }
  const path = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${path}chat/completions`;
}

/** Which failure an HTTP answer is. `problem` is the error body's `code` and `type`. */
export function classifyHttpFailure(
  status: number,
  problem: { code: string | null; type: string | null },
): LlmFailureKind {
  if (status === 429) {
    const quota = [problem.code, problem.type].some(
      (value) => value !== null && OPENAI_QUOTA_CODES.has(value),
    );
    return quota ? 'quota_exhausted' : 'rate_limited';
  }
  // 408 is the server saying it gave up waiting, which RFC 9110 lets a client repeat.
  if (status >= 500 || status === 408) return 'unavailable';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 400) return 'bad_request';
  // A 3xx — refused rather than followed — or anything else that is not a completion.
  return 'bad_response';
}

type AttemptResult =
  | { ok: true; completion: LlmCompletion }
  | { ok: false; error: LlmProviderError; retryAfterMs: number | null };

const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Visible ASCII: what an HTTP header value can carry without fetch refusing it. */
const HEADER_SAFE = /^[\x21-\x7e]+$/;

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
    const problem = await readProblem(response);
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

/** `error.code` and `error.type` from an error body, when present and safe to keep. */
async function readProblem(
  response: Response,
): Promise<{ code: string | null; type: string | null }> {
  try {
    const parsed: unknown = JSON.parse(await readCapped(response, PROBLEM_MAX_BYTES));
    const error = isRecord(parsed) && isRecord(parsed['error']) ? parsed['error'] : null;
    return {
      code: safeToken(error?.['code'], SAFE_CODE),
      type: safeToken(error?.['type'], SAFE_CODE),
    };
  } catch {
    return { code: null, type: null };
  }
}

class ResponseTooLarge extends Error {}

/**
 * The body as text, refusing to hold more than `limit` bytes of it — whether
 * the server announced the size or not. Past the limit the stream is cancelled,
 * which releases the connection.
 */
async function readCapped(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLarge();
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * The socket's error code behind fetch's generic `TypeError: fetch failed`
 * (`ECONNRESET`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT` …), else the error's
 * name. Never its message: a message is prose, and prose can quote anything.
 */
function networkCode(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = isRecord(cause) ? cause['code'] : isRecord(error) ? error['code'] : undefined;
  return (
    safeToken(code, SAFE_CODE) ?? (error instanceof Error ? safeToken(error.name, SAFE_CODE) : null)
  );
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

function safeToken(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
