/**
 * How an embedding call fails (tm 255.7).
 *
 * The chat adapter's taxonomy (`llm-error.ts`) minus the one kind that only a
 * completion can have — an answer with nothing in it (`no_answer`). An
 * embedding either comes back as vectors of the right length or it is
 * `bad_response`; there is no half-written embedding to refuse. What each
 * caller does with a failure is the caller's decision, and there are two:
 *
 * - **Indexing** fails and says so. Nothing is written — the text is embedded
 *   before the transaction opens — and the admin gets a 503 naming the kind
 *   (`routes/playbook.ts`, `routes/copilot.ts`); a bulk row, the freshness sweep
 *   and `knowledge:reembed` record it against the one source.
 * - **Searching** returns nothing and hands the conversation to a human
 *   (`skill-engine.ts`): no retrieval means no grounded answer, and a model
 *   asked without passages is exactly the silent wrong answer this rules out.
 *
 * | kind              | what happened                                                        |
 * | ----------------- | -------------------------------------------------------------------- |
 * | `timeout`         | `EMBEDDING_TIMEOUT_MS` passed; the request in flight was aborted      |
 * | `network`         | no HTTP answer at all — DNS, refused or reset connection, TLS         |
 * | `rate_limited`    | 429 that pacing can fix                                              |
 * | `unavailable`     | 5xx (or 408): the provider failed, not the request                   |
 * | `quota_exhausted` | 429 whose code says the account is out of credit or over a limit     |
 * | `auth`            | 401: the key was refused                                             |
 * | `forbidden`       | 403: the provider refuses this caller                                |
 * | `not_found`       | 404: the model or the endpoint does not exist                        |
 * | `bad_request`     | any other 4xx, or an input the adapter refused before sending it     |
 * | `bad_response`    | not an embedding list: a redirect, a wrong length, a missing vector  |
 * | `circuit_open`    | the circuit breaker is open, so no request was made                  |
 *
 * `bad_response` with reason `dimensions` is the one tm 255.7's test strategy
 * names: a vector that is not {@link import('./embedding-provider.js').EMBEDDING_DIMENSIONS}
 * long is refused whole — never cut to fit or padded — because `vector(1536)`
 * would either reject it or, worse, store a point in a different space.
 *
 * **What an instance never carries:** the API key, the text that was embedded,
 * or the provider's `error.message` (which can quote the key or the input). It
 * keeps the HTTP status, a machine-readable code and the provider's request id,
 * each only after matching a narrow character set.
 */
import type { EmbeddingUsage } from './embedding-provider.js';

export const EMBEDDING_FAILURE_KINDS = [
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
  'circuit_open',
] as const;
export type EmbeddingFailureKind = (typeof EMBEDDING_FAILURE_KINDS)[number];

/** Failures another attempt could fix — the only ones the adapter retries. */
const TRANSIENT: ReadonlySet<EmbeddingFailureKind> = new Set<EmbeddingFailureKind>([
  'timeout',
  'network',
  'rate_limited',
  'unavailable',
]);

/**
 * Failures that say something about the provider rather than one request, and
 * so count toward opening the circuit. `bad_request` stays out, as it does for
 * chat: a customer's message is embedded on the query path, and a message the
 * provider refuses (too long for the model's input limit) must not let one
 * visitor switch retrieval off for every workspace this process serves.
 */
const PROVIDER_FAULTS: ReadonlySet<EmbeddingFailureKind> = new Set<EmbeddingFailureKind>([
  ...TRANSIENT,
  'quota_exhausted',
  'auth',
  'forbidden',
  'not_found',
  'bad_response',
]);

export interface EmbeddingFailureDetails {
  status?: number | null;
  /** Provider `error.code` / `error.type`, or a socket error code — already sanitised. */
  code?: string | null;
  requestId?: string | null;
  /**
   * The detail inside a kind: for `bad_response` what was wrong (`redirect`,
   * `not_json`, `shape`, `count`, `dimensions`, `usage`, `too_large`); for a
   * `bad_request` the adapter raised itself, `empty_input`.
   */
  reason?: string | null;
  /** For `dimensions`: how many values the provider actually returned — a count, safe to log. */
  dimensions?: number | null;
  /** Tokens the provider billed before the call failed, when it said. */
  usage?: EmbeddingUsage | null;
}

export class EmbeddingProviderError extends Error {
  override readonly name = 'EmbeddingProviderError';
  readonly kind: EmbeddingFailureKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
  readonly reason: string | null;
  readonly dimensions: number | null;
  /**
   * Tokens billed before the call failed: set by the adapter when earlier
   * batches of the same call had answered (tm 257.20).
   */
  usage: EmbeddingUsage | null;
  /** Requests made for the failing batch before giving up; 0 when the circuit refused the call. */
  attempts = 0;

  constructor(kind: EmbeddingFailureKind, details: EmbeddingFailureDetails = {}) {
    // Built only from fields that are already safe to print — this message is
    // what a log line shows if anyone logs the error.
    const parts = [
      kind,
      details.status ? `HTTP ${details.status}` : '',
      details.code ?? '',
      details.reason ?? '',
    ].filter(Boolean);
    super(`The embedding provider did not answer (${parts.join(', ')}).`);
    this.kind = kind;
    this.status = details.status ?? null;
    this.code = details.code ?? null;
    this.requestId = details.requestId ?? null;
    this.reason = details.reason ?? null;
    this.dimensions = details.dimensions ?? null;
    this.usage = details.usage ?? null;
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
