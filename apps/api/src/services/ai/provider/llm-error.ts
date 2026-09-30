/**
 * How a model call fails (tm 255.6), or is refused before it is made (tm 255.9).
 *
 * One error class and a closed list of reasons. Whatever the reason, the skill
 * engine does the same thing with it — the AI stops and the conversation stays
 * with a human (`skill-engine.ts`) — so the kinds are not there to change the
 * product's behaviour. They are for the two readers who do have to tell
 * failures apart: the adapter's retry loop and circuit breaker
 * (`openai-llm-provider.ts`), and the operator reading the log afterwards.
 *
 * | kind              | what happened                                                               |
 * | ----------------- | --------------------------------------------------------------------------- |
 * | `timeout`         | `LLM_TIMEOUT_MS` passed; the request in flight was aborted                  |
 * | `network`         | no HTTP answer at all — DNS, refused or reset connection, TLS               |
 * | `rate_limited`    | 429 that pacing can fix                                                     |
 * | `unavailable`     | 5xx (or 408): the provider failed, not the request                          |
 * | `quota_exhausted` | 429 whose code says the account is out of credit or over a spend limit     |
 * | `auth`            | 401: the key was refused                                                    |
 * | `forbidden`       | 403: the provider refuses this caller (its documented case: the country)    |
 * | `not_found`       | 404: the model or the endpoint does not exist                               |
 * | `bad_request`     | any other 4xx: the provider rejected this request                           |
 * | `bad_response`    | an answer that is not a chat completion — a redirect, an unreadable body    |
 * | `no_answer`       | a well-formed completion with nothing to send: refused, filtered, cut off   |
 * | `circuit_open`    | the circuit breaker is open, so no request was made                         |
 * | `prompt_too_long` | the prompt is over `LLM_MAX_PROMPT_CHARS`, so no request was made           |
 *
 * The two refusals at the end are the only kinds no provider produced: the
 * breaker (`circuit-breaker.ts`) and the prompt ceiling (`refuseOverlongPrompt`
 * in `llm-provider.ts`) stop the call in this process. They are kinds all the
 * same, so they reach the human, the run log and the operator by the same road
 * as every failure the provider did cause.
 *
 * **What an instance never carries:** the API key, the prompt, the reply, or
 * the provider's `error.message`. The last is the one that is easy to let
 * through: OpenAI's 401 message quotes the beginning and the end of the key it
 * refused, and a moderation message can quote the input. What an instance
 * keeps is the HTTP status, a machine-readable code — the provider's
 * `error.code`, or the socket's for a network failure — and the provider's
 * request id, and the two strings are only kept after matching a narrow
 * character set, because the body is whatever the far end chose to send.
 */
import type { LlmUsage } from './llm-provider.js';

export const LLM_FAILURE_KINDS = [
  'timeout',
  'network',
  'rate_limited',
  'unavailable',
  'quota_exhausted',
  'auth',
  'forbidden',
  'not_found',
  'bad_request',
  'bad_response',
  'no_answer',
  'circuit_open',
  'prompt_too_long',
] as const;
export type LlmFailureKind = (typeof LLM_FAILURE_KINDS)[number];

/**
 * Failures another attempt could fix. The adapter retries these and nothing
 * else — and a `timeout` only in principle: the deadline belongs to the whole
 * call, so once it has passed there is no time left to try again in.
 */
const TRANSIENT: ReadonlySet<LlmFailureKind> = new Set<LlmFailureKind>([
  'timeout',
  'network',
  'rate_limited',
  'unavailable',
]);

/**
 * Failures that say something about the *provider* rather than about this one
 * request, and so count toward opening the circuit. `bad_request`, `no_answer`
 * and `prompt_too_long` stay out on purpose: all three can be caused by what a
 * customer wrote.
 * A visitor who can make the model refuse five messages in a row must not be
 * able to switch the AI off for every workspace this process serves.
 */
const PROVIDER_FAULTS: ReadonlySet<LlmFailureKind> = new Set<LlmFailureKind>([
  ...TRANSIENT,
  'quota_exhausted',
  'auth',
  'forbidden',
  'not_found',
  'bad_response',
]);

export interface LlmFailureDetails {
  /** HTTP status of the attempt that failed, when there was a response. */
  status?: number | null;
  /** Provider `error.code` / `error.type`, or a socket error code — already sanitised. */
  code?: string | null;
  /** The provider's `x-request-id` — what its support desk asks for. */
  requestId?: string | null;
  /**
   * The detail inside a kind: for `no_answer` the finish reason, `refusal` or
   * `empty`; for `bad_response` what was wrong (`redirect`, `not_json`,
   * `shape`, `too_large`); for `prompt_too_long` the length against the
   * ceiling (`20412/16000`).
   */
  reason?: string | null;
  /** Tokens the call spent anyway — a `no_answer` is billed like an answer. */
  usage?: LlmUsage | null;
  /**
   * What the operator can change when the failure is the configuration's, not
   * the conversation's. One of this module's own sentences, never provider
   * text: {@link LLM_EMPTY_LENGTH_HINT} (tm 256.6).
   */
  hint?: string | null;
}

/**
 * A reply cut off at `max_completion_tokens` before it held any text. A
 * reasoning model counts its hidden reasoning against that limit, so at the
 * default `LLM_MAX_OUTPUT_TOKENS` (400) it can spend all of it thinking and
 * answer nothing, on every question; `no_answer`/`length` alone does not say
 * so (tm 256.6).
 */
export const LLM_EMPTY_LENGTH_HINT =
  'the output limit ran out before any text; a reasoning model spends LLM_MAX_OUTPUT_TOKENS on reasoning, so choose a non-reasoning chat model for LLM_MODEL or raise LLM_MAX_OUTPUT_TOKENS';

export class LlmProviderError extends Error {
  override readonly name = 'LlmProviderError';
  readonly kind: LlmFailureKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly reason: string | null;
  readonly usage: LlmUsage | null;
  readonly hint: string | null;
  /** Requests made before giving up; 0 when the call was refused before one was made. */
  attempts = 0;

  constructor(kind: LlmFailureKind, details: LlmFailureDetails = {}) {
    // Built only from the fields above, all of them already safe to print —
    // this message is what ends up in a log line if anyone logs the error.
    const parts = [
      kind,
      details.status ? `HTTP ${details.status}` : '',
      details.code ?? '',
      details.reason ?? '',
    ].filter(Boolean);
    super(`The model did not answer (${parts.join(', ')}).`);
    this.kind = kind;
    this.status = details.status ?? null;
    this.code = details.code ?? null;
    this.requestId = details.requestId ?? null;
    this.reason = details.reason ?? null;
    this.usage = details.usage ?? null;
    this.hint = details.hint ?? null;
  }

  /** Whether another attempt could succeed — the retry loop's question. */
  get transient(): boolean {
    return TRANSIENT.has(this.kind);
  }

  /** Whether this failure is the provider's — the circuit breaker's question. */
  get providerFault(): boolean {
    return PROVIDER_FAULTS.has(this.kind);
  }
}
