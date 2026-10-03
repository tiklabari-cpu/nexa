/**
 * Typed HTTP client.
 *
 * Every non-2xx response is turned into an `ApiClientError` carrying the ADR-06
 * `type` and `request_id`, so UI code branches on a stable machine-readable
 * value and support can correlate a user report with a server log line.
 */
import { isErrorType, type ApiErrorBody, type ErrorType } from '@siyahtus/types';

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

/** `details.reason` on a pilot deployment's 402 `license_expired` (tm 257.15). */
const PILOT_TRIAL_ENDED_REASON = 'pilot_trial_ended';

/** The sentence for a pilot's read-only 402 — outside `common.errors.*`, which is one key per error type. */
export const PILOT_LICENSE_EXPIRED_MESSAGE_KEY = 'common.pilot.licenseExpired';

/** The sentence for {@link isAiDailyCap}: "today's AI allowance is used up; it renews at 00:00 UTC". */
export const AI_DAILY_CAP_MESSAGE_KEY = 'common.limits.aiDailyCap';

/**
 * The other `limit_reached` reasons that are not the plan's (tm 257.14), by
 * `details.reason`: today's email allowance, and the hourly sign-up limit per
 * network. Like the AI cap, upgrading changes neither.
 */
const LIMIT_REASON_MESSAGE_KEYS: ReadonlyMap<string, string> = new Map([
  ['mail_daily_cap', 'common.limits.mailDailyCap'],
  ['signup_rate', 'common.limits.signupRate'],
]);

/**
 * Whether `error` is the daily AI cap (tm 257.8): a 429 `limit_reached` with
 * `details.reason: 'ai_daily_cap'`. `limit_reached` alone means a plan limit,
 * whose sentence ("the limit for your plan") would be wrong here — the cap is
 * the deployment's, per UTC day, and upgrading changes nothing.
 */
export function isAiDailyCap(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.type === 'limit_reached' &&
    error.details?.['reason'] === 'ai_daily_cap'
  );
}

/**
 * The `common.errors.*` key whose sentence answers `error` in the agent's
 * language (NFR-I18N2) — or, for the daily AI cap, {@link AI_DAILY_CAP_MESSAGE_KEY}.
 *
 * The ADR-06 `type` is the only part of a failure that is both stable and
 * translatable. `error.message` is English prose the API wrote for whoever
 * reads a log line, and rendering it is what makes a Turkish console answer a
 * refused save with "Chat is not active." — so the display path resolves the
 * *type* through the catalogue instead, and anything specific the user still
 * needs (which field was rejected) travels in `error.details`.
 *
 * Returns a key rather than a sentence, and takes no locale: callers hold a
 * `t()` already, and passing the key through it is what makes a banner already
 * on screen change language when the agent flips the switcher.
 * `locales/en/common.ts` carries an entry for every `ErrorType`, for the
 * client-only `network`, and for `unknown` — a thrown value that is not an
 * `ApiClientError` at all.
 */
export function errorMessageKey(error: unknown): string {
  if (!(error instanceof ApiClientError)) return 'common.errors.unknown';
  // The one `limit_reached` that is not about the plan (tm 257.8): today's AI
  // allowance is used up and comes back at UTC midnight. Outside
  // `common.errors.*`, whose keys are exactly the error types.
  if (isAiDailyCap(error)) return AI_DAILY_CAP_MESSAGE_KEY;
  // The public pilot's read-only refusal (tm 257.15): nothing there can be
  // renewed, so "renew it to continue" would point at a door that is not there.
  if (error.type === 'license_expired' && error.details?.['reason'] === PILOT_TRIAL_ENDED_REASON) {
    return PILOT_LICENSE_EXPIRED_MESSAGE_KEY;
  }
  if (error.type === 'limit_reached') {
    const reason = error.details?.['reason'];
    // A Map, not an object: a reason off the wire must not find `toString`.
    const key = typeof reason === 'string' ? LIMIT_REASON_MESSAGE_KEYS.get(reason) : undefined;
    if (key) return key;
  }
  // The type is *typed* as `ErrorType | 'network'`, but it is read straight off the
  // wire — a server ahead of this build, or a proxy writing its own envelope,
  // can put anything there. Narrowing against the real taxonomy is what keeps
  // an unmapped value from reaching the screen as the raw key `common.errors.x`.
  if (error.type !== 'network' && !isErrorType(error.type)) return 'common.errors.unknown';
  return `common.errors.${error.type}`;
}

export interface ApiClientOptions {
  baseUrl?: string;
  getAccessToken?: () => string | null;
  /** The selected brand (PRD §5.3-Marka), or null for the license-wide default. */
  getBrandId?: () => string | null;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #getAccessToken: () => string | null;
  readonly #getBrandId: () => string | null;
  readonly #fetch: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? '/api/v1').replace(/\/$/, '');
    this.#getAccessToken = options.getAccessToken ?? (() => null);
    this.#getBrandId = options.getBrandId ?? (() => null);
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

  put<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
    return this.request<T>('PUT', path, body, init);
  }

  delete<T>(path: string, init?: RequestInit): Promise<T> {
    return this.request<T>('DELETE', path, undefined, init);
  }

  /**
   * Fetch raw bytes with the session's credentials.
   *
   * Attachments are served from `/uploads/:key` behind a bearer token, so an
   * `<img src>` — which cannot set the header — would only ever get a 404. The
   * transcript fetches the blob here and renders it from an object URL instead.
   */
  async getBlob(path: string, init: RequestInit = {}): Promise<Blob> {
    const headers = new Headers(init.headers);
    const token = this.#getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const brandId = this.#getBrandId();
    if (brandId) headers.set('X-SiyahTus-Brand', brandId);

    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      method: 'GET',
      headers,
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new ApiClientError({
        type: 'internal',
        status: response.status,
        message: 'Could not load attachment.',
        requestId: response.headers.get('X-Request-Id') ?? '-',
      });
    }
    return response.blob();
  }

  /**
   * Fetch raw bytes plus the filename the server assigned via
   * `content-disposition` — a report export (FR-MOD-07.7) names itself after
   * the group and window, and a caller cannot reproduce that name correctly
   * without reading the header the server actually sent. Unlike `getBlob`,
   * a failure here carries the server's own error type/message rather than a
   * generic one: an export can fail on authorization (a group the token
   * cannot read), and "Could not load attachment." would hide exactly the
   * reason the caller needs.
   */
  async getFile(
    path: string,
    init: RequestInit = {},
  ): Promise<{ blob: Blob; filename: string | null }> {
    const headers = new Headers(init.headers);
    const token = this.#getAccessToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const brandId = this.#getBrandId();
    if (brandId) headers.set('X-SiyahTus-Brand', brandId);

    const response = await this.#fetch(`${this.#baseUrl}${path}`, {
      ...init,
      method: 'GET',
      headers,
      credentials: 'same-origin',
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiClientError({
        type: payload?.error?.type ?? 'internal',
        status: response.status,
        message: payload?.error?.message ?? `Request failed with status ${response.status}.`,
        requestId: payload?.error?.request_id ?? response.headers.get('X-Request-Id') ?? '-',
        details: payload?.error?.details,
      });
    }
    return {
      blob: await response.blob(),
      filename: filenameFromContentDisposition(response.headers.get('content-disposition')),
    };
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
    const brandId = this.#getBrandId();
    if (brandId) headers.set('X-SiyahTus-Brand', brandId);

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

/** The quoted filename out of `content-disposition: attachment; filename="…"`. */
function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? null;
}
