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

/**
 * Whether `error` is the server refusing the bearer token itself — expired,
 * revoked, never issued — rather than a 401 a handler raised about something
 * inside the request.
 *
 * The API answers both with `authentication`: a wrong password in a "confirm it
 * is you" dialog and a wrong two-factor code are 401s on an authenticated
 * route. Only the first is something a renewal can fix, so the auth plugin
 * marks it the way RFC 6750 §3.1 names it, `invalid_token`, carried in
 * `details.oauth_error` like the token endpoint's own codes (tm 259.1). The
 * marker says nothing about *why* the token was refused; that stays in the
 * server's log.
 */
export function isRefusedCredential(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    error.status === 401 &&
    error.type === 'authentication' &&
    error.details?.['oauth_error'] === 'invalid_token'
  );
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** Read per request, not captured — a renewal that happened a moment ago is already in effect. */
  getAccessToken?: () => string | null;
  /** The selected brand (PRD §5.3-Marka), or null for the license-wide default. */
  getBrandId?: () => string | null;
  /**
   * The session's answer to a refused credential (tm 259.1): a token to repeat
   * the request with, or null when the session is over — the caller then sees
   * the original 401. Called with the token that was refused, so a renewal that
   * already happened (another request's, another tab's) is reused rather than
   * repeated. Absent on clients with no session to renew, which is every one
   * but the panel's own (`lib/auth-store.ts` · `sessionClient`).
   */
  renewAccessToken?: (refused: string) => Promise<string | null>;
  /**
   * The repeated request was refused too, with a token minted a moment ago.
   * That is not a stale credential: the membership or the workspace behind it
   * is gone, and the session cannot continue.
   */
  onSessionRejected?: (token: string) => void;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  readonly #baseUrl: string;
  readonly #getAccessToken: () => string | null;
  readonly #getBrandId: () => string | null;
  readonly #renewAccessToken: ((refused: string) => Promise<string | null>) | null;
  readonly #onSessionRejected: (token: string) => void;
  readonly #fetch: typeof fetch;

  constructor(options: ApiClientOptions = {}) {
    this.#baseUrl = (options.baseUrl ?? '/api/v1').replace(/\/$/, '');
    this.#getAccessToken = options.getAccessToken ?? (() => null);
    this.#getBrandId = options.getBrandId ?? (() => null);
    this.#renewAccessToken = options.renewAccessToken ?? null;
    this.#onSessionRejected = options.onSessionRejected ?? (() => {});
    this.#fetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  /**
   * Run `attempt` with the session's token, and once more with a renewed one
   * if the server refused the credential (tm 259.1).
   *
   * Once, never twice. Repeating is safe even for a write: a refused credential
   * is turned away by the auth plugin before any handler runs, so the repeat is
   * the request's first real attempt. A second refusal of a token minted a
   * moment ago is not staleness, so it ends the session rather than looping.
   */
  async #withSession<T>(attempt: (token: string | null) => Promise<T>): Promise<T> {
    const token = this.#getAccessToken();
    try {
      return await attempt(token);
    } catch (error) {
      if (token === null || this.#renewAccessToken === null || !isRefusedCredential(error)) {
        throw error;
      }
      const renewed = await this.#renewAccessToken(token);
      if (renewed === null) throw error;
      try {
        return await attempt(renewed);
      } catch (repeated) {
        if (isRefusedCredential(repeated)) this.#onSessionRejected(renewed);
        throw repeated;
      }
    }
  }

  /** The two headers every authenticated call carries. */
  #authHeaders(init: RequestInit, token: string | null): Headers {
    const headers = new Headers(init.headers);
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const brandId = this.#getBrandId();
    if (brandId) headers.set('X-SiyahTus-Brand', brandId);
    return headers;
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
  getBlob(path: string, init: RequestInit = {}): Promise<Blob> {
    return this.#withSession(async (token) => {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        method: 'GET',
        headers: this.#authHeaders(init, token),
        credentials: 'same-origin',
      });
      if (!response.ok) {
        // The envelope is read for a 401 only — the one answer the session
        // can act on (`isRefusedCredential`); any other failure keeps the
        // generic sentence it always had.
        const refusal =
          response.status === 401
            ? ((await response.json().catch(() => null)) as ApiErrorBody | null)
            : null;
        throw new ApiClientError({
          type: refusal?.error?.type ?? 'internal',
          status: response.status,
          message: 'Could not load attachment.',
          requestId: response.headers.get('X-Request-Id') ?? '-',
          details: refusal?.error?.details,
        });
      }
      return response.blob();
    });
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
  getFile(path: string, init: RequestInit = {}): Promise<{ blob: Blob; filename: string | null }> {
    return this.#withSession(async (token) => {
      const response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        method: 'GET',
        headers: this.#authHeaders(init, token),
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
    });
  }

  request<T>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return this.#withSession((token) => this.#send<T>(method, path, body, init, token));
  }

  /** One round trip of {@link request}, with the token it was handed. */
  async #send<T>(
    method: string,
    path: string,
    body: unknown,
    init: RequestInit,
    token: string | null,
  ): Promise<T> {
    const headers = this.#authHeaders(init, token);
    headers.set('Accept', 'application/json');
    if (body !== undefined) headers.set('Content-Type', 'application/json');

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
