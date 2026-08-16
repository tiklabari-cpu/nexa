/**
 * The client every screen uses.
 *
 * Deliberately separate from `lib/api-client.ts`, which is the transport: base
 * URL, timeout, the ADR-06 error envelope, the contract types. This is the layer
 * that knows there is a *session* — it attaches the credential, and it is the
 * one place that decides what a 401 means.
 *
 * It lives beside `auth/` rather than beside the transport (§C-A31 · 13.7-b)
 * because attaching a token and renewing one are the same responsibility seen
 * from two ends. The first cut of the mobile breakdown put this file under the
 * first screen's subtask, which would have meant the code that holds the session
 * open belonged to whoever happened to need a list of chats first.
 *
 * The whole behaviour is four lines of policy:
 *
 *   - Every request carries the session's current access token, read at call
 *     time rather than captured, so a renewal that happened one line ago is
 *     already in effect.
 *   - A 401 triggers exactly one renewal attempt, shared with every other
 *     request that got a 401 at the same time (`MobileSession.refresh`).
 *   - If the renewal produces a token, the request is retried once. Once — a
 *     second 401 with a token minted seconds ago is not a stale credential, it
 *     is a scope or a tenant answer, and retrying it is a loop.
 *   - If the renewal produces nothing, the session is already gone and the
 *     original 401 is what the caller sees.
 */
import { ApiClient, ApiClientError } from '../lib/api-client';
import type {
  ContractMethod,
  ContractPath,
  ContractRequestBody,
  ContractResponseBody,
} from '../lib/contract';
import type { MobileSession } from '../auth/session';

export interface SessionApiClientOptions {
  session: MobileSession;
  /** Absolute, from `readMobileConfig().apiBaseUrl`. */
  baseUrl: string;
  /** The selected brand (PRD §5.3-Marka), or null for the license-wide default. */
  getBrandId?: () => string | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface SessionRequestOptions<P extends ContractPath, M extends ContractMethod<P>> {
  params?: Record<string, string | number>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: ContractRequestBody<P, M>;
  signal?: AbortSignal;
}

export class SessionApiClient {
  readonly #session: MobileSession;
  readonly #transport: ApiClient;

  constructor(options: SessionApiClientOptions) {
    this.#session = options.session;
    this.#transport = new ApiClient({
      baseUrl: options.baseUrl,
      // Read per request, not bound once: the token this returns changes under
      // the client every time a renewal completes, and a captured copy is how a
      // screen ends up retrying with the credential that just failed.
      getAccessToken: () => options.session.getAccessToken(),
      ...(options.getBrandId ? { getBrandId: options.getBrandId } : {}),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    });
  }

  /**
   * Retrying after a renewal is safe even for a `POST`. A 401 is refused at the
   * door — the request never reached anything that could have had an effect — so
   * the retry is a first attempt, not a second one. That is not true of a 500,
   * which is why nothing else here is retried.
   */
  async request<P extends ContractPath, M extends ContractMethod<P>>(
    method: M,
    path: P,
    options: SessionRequestOptions<P, M> = {},
  ): Promise<ContractResponseBody<P, M>> {
    try {
      return await this.#transport.request(method, path, options);
    } catch (error) {
      if (!isExpiredCredential(error)) throw error;

      const renewed = await this.#session.refresh();
      // `null` means the session is over and `MobileSession` has already told
      // every subscriber; the shell is on its way to the sign-in screen. Letting
      // the original error through is what stops the caller from rendering an
      // empty list as though the request had succeeded.
      if (renewed === null) throw error;

      return await this.#transport.request(method, path, options);
    }
  }
}

/**
 * A 401 the session can do something about.
 *
 * Matched on the ADR-06 `type` rather than the status alone: the same 401 is
 * returned for a token that expired and for one whose family was revoked, but
 * `license_expired` and the residency refusal are not credentials problems and
 * a renewal would answer none of them.
 */
function isExpiredCredential(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 401 && error.type === 'authentication';
}
