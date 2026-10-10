/**
 * The one way an Apps provider call leaves this process (tm 263).
 *
 * Every live card — Brevo, Freshdesk, Telegram — talks to its provider through
 * this client and nothing else, so the rules below hold for all of them by
 * construction rather than by each adaptor remembering them:
 *
 *   - `https:` only. A provider key never travels in the clear, and a
 *     user-supplied host (Freshdesk's subdomain) cannot downgrade it.
 *   - The host is resolved once, every answer is range-checked (no loopback,
 *     private, link-local or metadata address — `lib/ssrf.ts`), and the socket
 *     connects to exactly the checked addresses (`pinnedConnection`), so a
 *     zero-TTL record cannot answer public for the check and internal for the
 *     connection (DNS rebinding).
 *   - No redirect is followed: a 3xx is a failure. A provider that redirects an
 *     authenticated API call is either misconfigured or not the provider, and
 *     following it would carry the key somewhere nobody checked.
 *   - The whole exchange, body included, is bounded by a timeout (8 s) and the
 *     body by a size cap (256 KiB): a slow or endless answer cannot hold a
 *     request thread or fill memory.
 *   - Errors carry a kind and a code, never the URL or a header. Telegram puts
 *     the bot token in the path, so a message quoting the URL would leak it.
 *
 * `node:https` rather than `fetch` for the reason `createHttpWebhookSender`
 * gives: `fetch` takes no `lookup`, so it would ask DNS again after the check.
 */
import type http from 'node:http';
import https from 'node:https';
import { isApiError } from './api-error.js';
import {
  pinnedConnection,
  resolvePublicHttpTarget,
  type HostResolver,
  type PublicHttpTarget,
} from './ssrf.js';

export const SAFE_HTTP_DEFAULT_TIMEOUT_MS = 8_000;
export const SAFE_HTTP_DEFAULT_MAX_BYTES = 256 * 1024;
export const SAFE_HTTP_USER_AGENT = 'SiyahTus-Apps/1.0';

export interface SafeRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  /** A JSON body; sent with `content-type: application/json`. */
  json?: unknown;
}

export interface SafeResponse {
  status: number;
  /** The body as text, already capped. */
  text: string;
  /** The body parsed as JSON, or `undefined` when it is not JSON. */
  json: unknown;
}

/**
 * - `blocked`  the URL is not https, or its host is (or resolves to) an internal address
 * - `timeout`  no complete answer in time
 * - `too_large` the body passed the cap
 * - `redirect` the provider answered 3xx
 * - `network`  DNS, TCP or TLS failed
 */
export type SafeHttpErrorKind = 'blocked' | 'timeout' | 'too_large' | 'redirect' | 'network';

export class SafeHttpError extends Error {
  constructor(
    readonly kind: SafeHttpErrorKind,
    /** A Node error code (`ECONNREFUSED`, `ENOTFOUND`, `ERR_TLS_CERT_ALTNAME_INVALID`) or an HTTP status. */
    readonly code?: string,
  ) {
    super(code ? `provider request failed: ${kind} (${code})` : `provider request failed: ${kind}`);
    this.name = 'SafeHttpError';
  }
}

export interface SafeHttp {
  request(request: SafeRequest): Promise<SafeResponse>;
}

export interface SafeHttpOptions {
  timeoutMs?: number;
  maxBytes?: number;
  /** The resolver the SSRF check asks (tests stub it; production uses the system's). */
  resolver?: HostResolver;
  /** Extra trust anchor — tests only, for their local HTTPS provider. */
  ca?: string;
  /**
   * How a URL becomes a pinned target. The default is the SSRF check; a test
   * replaces it to pin its `.test` provider name to its loopback listener, the
   * way `webhook-sender.test.ts` hands the sender a pinned target directly.
   */
  resolveTarget?: (url: string) => Promise<PublicHttpTarget>;
}

export function createSafeHttp(options: SafeHttpOptions = {}): SafeHttp {
  const timeoutMs = options.timeoutMs ?? SAFE_HTTP_DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? SAFE_HTTP_DEFAULT_MAX_BYTES;
  const resolveTarget =
    options.resolveTarget ?? ((url: string) => resolvePublicHttpTarget(url, options.resolver));

  return {
    async request(request) {
      let parsed: URL;
      try {
        parsed = new URL(request.url);
      } catch {
        throw new SafeHttpError('blocked', 'invalid_url');
      }
      if (parsed.protocol !== 'https:') throw new SafeHttpError('blocked', 'not_https');

      // The timeout starts before DNS: a resolver that never answers is as
      // much a hung provider as a socket that never does.
      const deadline = Date.now() + timeoutMs;
      let target: PublicHttpTarget;
      try {
        target = await withTimeout(resolveTarget(request.url), timeoutMs);
      } catch (error) {
        if (error instanceof SafeHttpError) throw error;
        // `resolvePublicHttpTarget` refuses with a validation ApiError: an
        // internal address, or a name that does not resolve.
        if (isApiError(error)) {
          throw new SafeHttpError(
            /could not be resolved/.test(error.message) ? 'network' : 'blocked',
            /could not be resolved/.test(error.message) ? 'ENOTFOUND' : 'internal_address',
          );
        }
        throw new SafeHttpError('network');
      }
      if (target.url.protocol !== 'https:') throw new SafeHttpError('blocked', 'not_https');

      return send(target, request, Math.max(1, deadline - Date.now()), maxBytes, options.ca);
    },
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SafeHttpError('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function send(
  target: PublicHttpTarget,
  request: SafeRequest,
  timeoutMs: number,
  maxBytes: number,
  ca: string | undefined,
): Promise<SafeResponse> {
  return new Promise<SafeResponse>((resolve, reject) => {
    const controller = new AbortController();
    let settled = false;
    const fail = (error: SafeHttpError): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      controller.abort();
      reject(error);
    };
    const timer = setTimeout(() => fail(new SafeHttpError('timeout')), timeoutMs);

    const body = request.json === undefined ? undefined : JSON.stringify(request.json);
    const onResponse = (response: http.IncomingMessage): void => {
      const status = response.statusCode ?? 0;
      response.on('error', () => fail(new SafeHttpError('network', 'response_error')));
      if (status >= 300 && status < 400) {
        response.destroy();
        fail(new SafeHttpError('redirect', String(status)));
        return;
      }
      // A declared length past the cap is refused before a byte is read.
      const declared = Number(response.headers['content-length']);
      if (Number.isFinite(declared) && declared > maxBytes) {
        response.destroy();
        fail(new SafeHttpError('too_large'));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          response.destroy();
          fail(new SafeHttpError('too_large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const text = Buffer.concat(chunks).toString('utf8');
        let json: unknown;
        try {
          json = text === '' ? undefined : JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status, text, json });
      });
    };

    try {
      const { lookup, servername } = pinnedConnection(target);
      const outgoing = https.request(
        target.url,
        {
          method: request.method,
          headers: {
            'user-agent': SAFE_HTTP_USER_AGENT,
            accept: 'application/json',
            ...request.headers,
            ...(body === undefined
              ? {}
              : {
                  'content-type': 'application/json',
                  'content-length': String(Buffer.byteLength(body)),
                }),
          },
          lookup,
          // One connection per call: a pooled socket was pinned by an earlier check.
          agent: false,
          signal: controller.signal,
          ...(servername ? { servername } : {}),
          // Explicit, so NODE_TLS_REJECT_UNAUTHORIZED=0 cannot switch it off here.
          rejectUnauthorized: true,
          ...(ca ? { ca } : {}),
        },
        onResponse,
      );
      outgoing.on('error', (error: NodeJS.ErrnoException) => {
        if (error.name === 'AbortError') return; // already settled by `fail`
        fail(
          new SafeHttpError(
            'network',
            typeof error.code === 'string' && error.code !== '' ? error.code : undefined,
          ),
        );
      });
      outgoing.end(body);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      fail(new SafeHttpError(code === 'ERR_SSRF_UNPINNED' ? 'blocked' : 'network', code));
    }
  });
}
