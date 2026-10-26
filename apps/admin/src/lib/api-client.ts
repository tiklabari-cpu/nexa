/**
 * Typed HTTP client for the platform API (`/platform/v1`, tm 389.6).
 *
 * Copied from apps/web and cut down to what this surface has: one opaque session token as a
 * bearer, no brand header, no token renewal (a session simply ends — 8 h absolute, 15 min idle
 * — and the operator signs in again), no blob downloads yet (the audit export, 389.14, adds
 * its own). Every non-2xx response is turned into an `ApiClientError` carrying the ADR-06
 * `type` and `request_id`, so UI code branches on a stable machine-readable value and a report
 * from an operator can be matched to a server log line.
 */
import { isErrorType, type ApiErrorBody, type ErrorType } from '@siyahtus/types';
import { getLocale } from './i18n.js';

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

/**
 * The `common.errors.*` key whose sentence answers `error` in the operator's language.
 *
 * The ADR-06 `type` is the only part of a failure that is both stable and translatable;
 * `error.message` is English prose the API wrote for whoever reads a log line, and rendering it
 * is what makes a Turkish console answer a refused save in English. Returns a key, not a
 * sentence, so a banner already on screen changes language when the switcher flips.
 */
export function errorMessageKey(error: unknown): string {
  if (!(error instanceof ApiClientError)) return 'common.errors.unknown';
  // Read straight off the wire: a server ahead of this build, or a proxy writing its own
  // envelope, can put anything here. Narrowing against the real taxonomy keeps an unmapped
  // value from reaching the screen as the raw key.
  if (error.type !== 'network' && !isErrorType(error.type)) return 'common.errors.unknown';
  return `common.errors.${error.type}`;
}

/**
 * Whether `error` is the server refusing this operator's *role* (403 `authorization`). The page
 * then says so instead of showing an error banner: the menu hides what a role cannot open, but
 * that is courtesy — the server's gate is the rule, and a route opened by hand meets it.
 */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 403 && error.type === 'authorization';
}

/**
 * Paths whose 401 is a handler's answer about the *request* (wrong password, wrong code, a spent
 * invitation), not the server turning the bearer token away. This surface marks neither kind
 * (`apps/web` has `details.oauth_error`), so the path decides: anywhere else a 401 with a token
 * in hand means the session is over.
 */
const CREDENTIAL_PATHS: ReadonlySet<string> = new Set([
  '/auth/login',
  '/auth/invite/accept',
  '/auth/totp/activate',
  '/auth/totp/verify',
  '/auth/totp/reverify',
]);

export interface ApiClientOptions {
  baseUrl?: string;
  /** Read per request, not captured — a token minted a moment ago is already in effect. */
  getAccessToken?: () => string | null;
  /** The server turned the bearer token away: the session is over (see {@link CREDENTIAL_PATHS}). */
  onSessionEnded?: (token: string) => void;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #getAccessToken: () => string | null;
  readonly #onSessionEnded: (token: string) => void;
  /** Absent means `globalThis.fetch`, looked up per request so a test (or a polyfill) can replace it. */
  readonly #fetch: typeof fetch | undefined;

  constructor(options: ApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? '/platform/v1').replace(/\/$/, '');
    this.#getAccessToken = options.getAccessToken ?? (() => null);
    this.#onSessionEnded = options.onSessionEnded ?? (() => {});
    this.#fetch = options.fetchImpl;
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

  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>('PUT', path, body, init);
  }

  delete<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>('DELETE', path, undefined, init);
  }

  /**
   * A download (an invoice CSV): the same headers, errors and session handling as {@link request},
   * the body handed back as bytes instead of parsed.
   */
  async getBlob(path: string, init: RequestInit = {}): Promise<Blob> {
    const response = await this.#send('GET', path, undefined, init, '*/*');
    return response.blob();
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.#send(method, path, body, init, 'application/json');
    if (response.status === 204) return undefined as T;
    return (await response.json().catch(() => null)) as T;
  }

  /** The request, sent; a refusal thrown as an {@link ApiClientError}, an accepted response returned unread. */
  async #send(
    method: string,
    path: string,
    body: unknown,
    init: RequestInit,
    accept: string,
  ): Promise<Response> {
    const token = this.#getAccessToken();
    const headers = new Headers(init.headers);
    headers.set('Accept', accept);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // The language the panel is showing, so mail a request sets off (an invitation) can follow it.
    if (!headers.has('X-SiyahTus-Locale')) headers.set('X-SiyahTus-Locale', getLocale());
    if (body !== undefined) headers.set('Content-Type', 'application/json');

    let response: Response;
    try {
      response = await (this.#fetch ?? globalThis.fetch.bind(globalThis))(
        `${this.#baseUrl}${path}`,
        {
          ...init,
          method,
          headers,
          // The token travels in a header; no cookie is ever sent to or accepted from this API.
          credentials: 'omit',
          body: body === undefined ? undefined : JSON.stringify(body),
        },
      );
    } catch {
      // Offline, DNS failure, CORS rejection — indistinguishable from the browser, so surface
      // one honest category rather than guessing.
      throw new ApiClientError({
        type: 'network',
        status: 0,
        message: 'Could not reach the server.',
        requestId: '-',
      });
    }

    if (!response.ok) {
      const requestId = response.headers.get('X-Request-Id') ?? '-';
      const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null;
      const retryAfter = response.headers.get('Retry-After');
      const error = new ApiClientError({
        type: errorBody?.error?.type ?? 'internal',
        status: response.status,
        message: errorBody?.error?.message ?? `Request failed with status ${response.status}.`,
        requestId: errorBody?.error?.request_id ?? requestId,
        details: errorBody?.error?.details,
        retryAfterSeconds: retryAfter ? Number(retryAfter) : undefined,
      });
      if (response.status === 401 && token !== null && !CREDENTIAL_PATHS.has(path)) {
        this.#onSessionEnded(token);
      }
      throw error;
    }

    return response;
  }
}
