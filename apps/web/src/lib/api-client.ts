/**
 * Typed HTTP client.
 *
 * Every non-2xx response is turned into an `ApiClientError` carrying the ADR-06
 * `type` and `request_id`, so UI code branches on a stable machine-readable
 * value and support can correlate a user report with a server log line.
 */
import type { ApiErrorBody, ErrorType } from '@nexa/types';

export class ApiClientError extends Error {
  readonly type: ErrorType | 'network';
  readonly status: number;
  readonly requestId: string;
  readonly details?: Record<string, unknown>;
  readonly retryAfterSeconds?: number;

  constructor(init: {
    type: ErrorType | 'network';
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

  /** Retrying only helps for transient conditions — never for a 4xx we caused. */
  get isRetryable(): boolean {
    return (
      this.type === 'network' ||
      this.type === 'service_unavailable' ||
      this.type === 'internal' ||
      this.type === 'too_many_requests' ||
      this.type === 'request_timeout'
    );
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #getAccessToken: () => string | null;
  readonly #fetch: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? '/api/v1').replace(/\/$/, '');
    this.#getAccessToken = options.getAccessToken ?? (() => null);
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>('GET', path, undefined, init);
  }

  post<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>('POST', path, body, init);
  }

  patch<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>('PATCH', path, body, init);
  }

  delete<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>('DELETE', path, undefined, init);
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');

    const token = this.#getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        method,
        headers,
        credentials: 'same-origin',
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      // Offline, DNS failure, CORS rejection — indistinguishable from the
      // browser, so surface one honest category rather than guessing.
      throw new ApiClientError({
        type: 'network',
        status: 0,
        message: 'Could not reach the server.',
        requestId: '-',
      });
    }

    if (response.status === 204) return undefined as T;

    const requestId = response.headers.get('X-Request-Id') ?? '-';
    const payload = await response.json().catch(() => null);

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

    return payload as T;
  }
}

export const apiClient = new ApiClient();
