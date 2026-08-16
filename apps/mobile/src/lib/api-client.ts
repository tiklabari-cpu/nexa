/**
 * The mobile app's HTTP client.
 *
 * Deliberately a sibling of `apps/web/src/lib/api-client.ts` rather than an
 * import of it: the web client is written against browser assumptions this one
 * cannot make. It resolves `/api/v1` against the serving origin (a phone has no
 * origin), it sets `credentials: 'same-origin'` (meaningless here), and it hands
 * back `Blob`s. What the two share is the part that must not diverge — the
 * ADR-06 error envelope and the contract types — and those come from
 * `@nexa/types` and `@nexa/contract`, not from copied code.
 *
 * Two things this one adds because it runs on a radio rather than a cable:
 * every request carries a timeout (a stalled mobile connection otherwise hangs
 * a screen forever with nothing to show), and a transport failure is reported as
 * one honest category instead of being guessed at.
 */
import type { ApiErrorBody, ErrorType } from '@nexa/types';

import type {
  ContractMethod,
  ContractPath,
  ContractRequestBody,
  ContractResponseBody,
} from './contract';

export class ApiClientError extends Error {
  readonly type: ErrorType | 'network' | 'timeout';
  readonly status: number;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(init: {
    type: ErrorType | 'network' | 'timeout';
    status: number;
    message: string;
    requestId: string;
    details?: Record<string, unknown>;
    retryAfterSeconds?: number;
  }) {
    super(init.message);
    this.name = 'ApiClientError';
    this.type = init.type;
    this.status = init.status;
    this.requestId = init.requestId;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  /**
   * Retrying only helps for transient conditions — never for a 4xx we caused.
   * On mobile that set is larger than on the desktop: a tunnel, a handover
   * between cells and a backgrounded app all produce timeouts that succeed on
   * the next try.
   */
  get isRetryable(): boolean {
    return (
      this.type === 'network' ||
      this.type === 'timeout' ||
      this.type === 'service_unavailable' ||
      this.type === 'internal' ||
      this.type === 'too_many_requests' ||
      this.type === 'request_timeout'
    );
  }
}

export interface ApiClientOptions {
  /** Absolute, e.g. `https://api.example.com/api/v1` — see `src/config.ts`. */
  baseUrl: string;
  getAccessToken?: () => string | null;
  /** The selected brand (PRD §5.3-Marka), or null for the license-wide default. */
  getBrandId?: () => string | null;
  /** Per-request ceiling in milliseconds. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions<P extends ContractPath, M extends ContractMethod<P>> {
  /** Path parameters, substituted into the `{placeholder}` segments. */
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: ContractRequestBody<P, M>;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class ApiClient {
  readonly #baseUrl: string;
  readonly #getAccessToken: () => string | null;
  readonly #getBrandId: () => string | null;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: ApiClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.#getAccessToken = options.getAccessToken ?? (() => null);
    this.#getBrandId = options.getBrandId ?? (() => null);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * `path` is a literal the contract declares and `method` one it declares for
   * that path, so a call the server would answer with 404 or 405 does not
   * compile. The return type is the contract's own 2xx schema — callers get it
   * without writing a single interface of their own.
   */
  async request<P extends ContractPath, M extends ContractMethod<P>>(
    method: M,
    path: P,
    options: RequestOptions<P, M> = {},
  ): Promise<ContractResponseBody<P, M>> {
    const url = this.#baseUrl + buildPath(path, options.params) + buildQuery(options.query);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    const token = this.#getAccessToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const brandId = this.#getBrandId();
    if (brandId) headers['X-Nexa-Brand'] = brandId;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    // A caller's own signal must still win: a screen that unmounts cancels its
    // request, and that is not a timeout to report to anyone.
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortFromCaller);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: method.toUpperCase(),
        headers,
        signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      if (timedOut) {
        throw new ApiClientError({
          type: 'timeout',
          status: 0,
          message: `The server did not answer within ${this.#timeoutMs}ms.`,
          requestId: '-',
        });
      }
      // Airplane mode, no bars, DNS failure, TLS rejection — the platform does
      // not tell them apart, so neither will we.
      throw new ApiClientError({
        type: 'network',
        status: 0,
        message: 'Could not reach the server.',
        requestId: '-',
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }

    if (response.status === 204) return undefined as ContractResponseBody<P, M>;

    const requestId = response.headers.get('X-Request-Id') ?? '-';
    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const errorBody = payload as ApiErrorBody | null;
      const retryAfter = response.headers.get('Retry-After');
      throw new ApiClientError({
        type: errorBody?.error?.type ?? 'internal',
        status: response.status,
        message: errorBody?.error?.message ?? `Request failed with status ${response.status}.`,
        requestId: errorBody?.error?.request_id ?? requestId,
        details: errorBody?.error?.details,
        retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
      });
    }

    return payload as ContractResponseBody<P, M>;
  }
}

/** `/chats/{chatId}` with `{ chatId: 'abc' }` becomes `/chats/abc`. */
function buildPath(path: string, params?: Record<string, string | number>): string {
  return path.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = params?.[key];
    if (value === undefined) {
      throw new Error(`Missing path parameter "${key}" for ${path}.`);
    }
    return encodeURIComponent(String(value));
  });
}

function buildQuery(query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) search.append(key, String(value));
  }
  const serialised = search.toString();
  return serialised ? `?${serialised}` : '';
}
