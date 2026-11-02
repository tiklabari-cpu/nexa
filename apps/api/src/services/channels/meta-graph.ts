/**
 * What every Meta channel shares (tm 381 · KN-01 + KN-02): the Graph API
 * client, the webhook's signature check and its subscription handshake.
 *
 * WhatsApp (tm 380, `whatsapp-live.ts`) and Messenger / Instagram (tm 381,
 * `meta-messaging-live.ts`) are three products of one Meta app: the same app
 * secret signs every webhook delivery (`X-Hub-Signature-256`, HMAC-SHA256 of
 * the raw body), the same verify token answers the subscription handshake,
 * and every call goes to the same Graph host under the same version. So it is
 * written once, here; the channel modules keep only what differs — which ids
 * a body names, which endpoint sends, which error code means "window closed".
 *
 * Every call goes through the safe client (`lib/safe-fetch.ts`): https only,
 * no redirect, bounded, and no URL in an error — a code exchange carries the
 * app secret in its query string. A refusal never carries Meta's raw text with
 * a secret in it (`sanitiseProviderMessage`).
 */
import { createHmac } from 'node:crypto';
import { constantTimeEqual } from '../../lib/crypto.js';
import { SafeHttpError } from '../../lib/safe-fetch.js';
import { sanitiseProviderMessage } from '../apps/verifiers/provider-message.js';
import type { ProviderContext } from '../apps/verifiers/types.js';

/** Graph's "the access token is no longer valid" (expired, revoked, password changed). */
export const GRAPH_INVALID_TOKEN = 190;

/** WhatsApp's "more than 24 hours since the customer last replied". */
export const GRAPH_REENGAGEMENT_REQUIRED = 131047;

/**
 * Messenger's and Instagram's "outside the allowed window": error 10 (or 200,
 * a permission error) with one of these subcodes — Messenger's 2018278,
 * Instagram's 2534022.
 */
const OUTSIDE_WINDOW_SUBCODES = new Set([2018278, 2534022]);

/** A Graph call Meta refused, with Meta's own code (190 = the token is gone). */
export class MetaGraphError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: number | null,
    readonly providerMessage: string | undefined,
    readonly subcode: number | null = null,
  ) {
    super(`meta graph error ${code ?? 'unknown'} (http ${httpStatus})`);
    this.name = 'MetaGraphError';
  }

  get tokenInvalid(): boolean {
    return this.code === GRAPH_INVALID_TOKEN;
  }

  /** The customer's 24-hour window is over, as WhatsApp or Messenger / Instagram says it. */
  get windowClosed(): boolean {
    if (this.code === GRAPH_REENGAGEMENT_REQUIRED) return true;
    return this.subcode !== null && OUTSIDE_WINDOW_SUBCODES.has(this.subcode);
  }
}

/** Graph could not be reached at all: timeout, DNS, TLS, a redirect, too large. */
export class MetaGraphUnreachableError extends Error {
  constructor(readonly kind: string) {
    super(`meta graph unreachable: ${kind}`);
    this.name = 'MetaGraphUnreachableError';
  }
}

/**
 * `X-Hub-Signature-256: sha256=<hex>` against an HMAC-SHA256 of the raw body
 * under the app secret — the bytes Meta sent, not a re-serialised parse.
 * Compared in constant time; anything not shaped like a signature is a no.
 */
export function metaSignatureMatches(
  appSecret: string,
  rawBody: Buffer,
  header: string | undefined,
): boolean {
  if (!header || !header.startsWith('sha256=')) return false;
  const provided = header.slice('sha256='.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  return constantTimeEqual(provided, expected);
}

/**
 * The subscription handshake (`GET` with `hub.mode=subscribe`): answers the
 * challenge to echo back only when Meta presents this deployment's verify
 * token, compared in constant time.
 */
export function verifyMetaSubscription(
  verifyToken: string,
  mode: string | undefined,
  token: string | undefined,
  challenge: string | undefined,
): string | null {
  if (mode !== 'subscribe' || !token || challenge === undefined) return null;
  if (!constantTimeEqual(token, verifyToken)) return null;
  // Meta's challenge is a number; anything else is not Meta, and echoing an
  // arbitrary string back would make this an open reflector.
  return /^[0-9A-Za-z_-]{1,128}$/.test(challenge) ? challenge : null;
}

/** What a Graph answer looks like when it fails. */
interface GraphErrorEnvelope {
  error?: { message?: unknown; code?: unknown; error_subcode?: unknown };
}

/** The Graph API, as this deployment's Meta app calls it. */
export class MetaGraphClient {
  constructor(
    readonly context: ProviderContext,
    private readonly appSecret: string,
    readonly graphVersion: string,
  ) {}

  /** The Graph host (`DEFAULT_PROVIDER_ENDPOINTS.whatsapp` — one host for every Meta product). */
  get host(): string {
    return this.context.endpoints.whatsapp.replace(/\/+$/, '');
  }

  /**
   * One Graph call. `token` goes as a bearer header, never in the URL;
   * `secrets` are values that must not survive into an error text (a code,
   * a token in a query string) — the app secret and the token always are.
   */
  async call(
    method: 'GET' | 'POST',
    path: string,
    token: string | null,
    secrets: readonly string[] = [],
    json?: unknown,
  ): Promise<unknown> {
    let answer;
    try {
      answer = await this.context.http.request({
        method,
        url: `${this.host}/${this.graphVersion}${path}`,
        ...(token ? { headers: { authorization: `Bearer ${token}` } } : {}),
        ...(json !== undefined ? { json } : {}),
      });
    } catch (error) {
      throw new MetaGraphUnreachableError(error instanceof SafeHttpError ? error.kind : 'network');
    }
    if (answer.status >= 200 && answer.status < 300) return answer.json;
    throw this.error(answer.status, answer.json, [
      ...secrets,
      this.appSecret,
      ...(token ? [token] : []),
    ]);
  }

  /** A failed answer as a {@link MetaGraphError}, Meta's text cleaned of `secrets`. */
  error(status: number, body: unknown, secrets: readonly string[]): MetaGraphError {
    const envelope = body as GraphErrorEnvelope | undefined;
    const code = typeof envelope?.error?.code === 'number' ? envelope.error.code : null;
    const subcode =
      typeof envelope?.error?.error_subcode === 'number' ? envelope.error.error_subcode : null;
    return new MetaGraphError(
      status,
      code,
      sanitiseProviderMessage(envelope?.error?.message, secrets),
      subcode,
    );
  }

  /**
   * A login code → an access token: `GET /oauth/access_token` with the app's
   * id and secret and the `redirect_uri` the dialog was opened with.
   */
  async exchangeCode(appId: string, redirectUri: string, code: string): Promise<string> {
    const query = new URLSearchParams({
      client_id: appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
    });
    return this.#token(
      await this.call('GET', `/oauth/access_token?${query.toString()}`, null, [code]),
    );
  }

  /**
   * A short-lived user token → a long-lived one (about 60 days). Page tokens
   * read with a long-lived user token do not expire on their own — they end
   * when the person's access ends, which Graph says with error 190.
   */
  async longLivedUserToken(appId: string, shortLived: string): Promise<string> {
    const query = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: this.appSecret,
      fb_exchange_token: shortLived,
    });
    return this.#token(
      await this.call('GET', `/oauth/access_token?${query.toString()}`, null, [shortLived]),
    );
  }

  #token(answer: unknown): string {
    const token = (answer as { access_token?: unknown } | undefined)?.access_token;
    if (typeof token !== 'string' || !token) {
      throw new MetaGraphError(200, null, 'no access_token in the answer');
    }
    return token;
  }
}
