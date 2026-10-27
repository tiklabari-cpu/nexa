/**
 * The real crawl fetcher (tm 312.2 · AI-17 · NFR-S7): a workspace names a
 * website, and the *server* goes and reads it — from inside the network. So
 * every hop of every fetch goes the way the webhook sender's does (tm 256.9):
 *
 *   - the hop's URL goes through `resolvePublicHttpTarget` — http(s) only, no
 *     credentials, no internal host by name or literal, and every address the
 *     name resolves to checked;
 *   - the socket connects through `pinnedConnection` to exactly those
 *     addresses, so a zero-TTL record cannot answer the check with a public
 *     address and the connection with `127.0.0.1`;
 *   - a redirect is never followed by the HTTP client: this code reads
 *     `Location`, refuses a non-http(s) or out-of-scope target *before* asking
 *     for it, and sends the next hop back through both steps above — at most
 *     {@link KNOWLEDGE_CRAWL_LIMITS}`.redirects` of them.
 *
 * And it reads a stranger's answer defensively: each hop has a deadline from
 * connect to last byte; the body is streamed and cut off at its ceiling
 * (declared or not); a compressed body that inflates past
 * {@link INFLATE_RATIO_MAX}× its wire size is a decompression bomb; a
 * non-HTML page is not downloaded; a 429/503 is retried only on a
 * `Retry-After` it can afford; a bot wall is `blocked`, not content. One
 * connection per hop (`agent: false`): a pooled socket was pinned by an
 * earlier check. No cookie is kept between hops.
 *
 * `node:http(s)` rather than `fetch`, for the reason `safe-fetch.ts` gives:
 * `fetch` takes no `lookup`, so it would ask DNS again after the check.
 */
import http from 'node:http';
import https from 'node:https';
import { setTimeout as delay } from 'node:timers/promises';
import zlib from 'node:zlib';
import { KNOWLEDGE_CRAWL_LIMITS } from '@siyahtus/types';
import { isApiError } from '../../../lib/api-error.js';
import {
  pinnedConnection,
  resolvePublicHttpTarget,
  UNPINNED_CODE,
  type HostResolver,
  type PublicHttpTarget,
} from '../../../lib/ssrf.js';
import {
  acceptFor,
  BOT_WALL_SAMPLE_BYTES,
  CRAWLER_USER_AGENT,
  detectBotWall,
  fetchCeiling,
  isHtmlContentType,
  parseRetryAfter,
  RETRY_AFTER_MAX_MS,
  type CrawlFetcher,
  type CrawlFetchError,
  type CrawlFetchRequest,
  type CrawlFetchResult,
} from './fetcher.js';
import { HostGate } from './host-gate.js';

/** A decompressed body may grow past this size only up to {@link INFLATE_RATIO_MAX}× its wire bytes. */
export const INFLATE_RATIO_FLOOR_BYTES = 1024 * 1024;
/** HTML compresses ~5–10×; a decompression bomb, ~1000×. */
export const INFLATE_RATIO_MAX = 100;

export interface HttpCrawlFetcherOptions {
  /** The resolver the SSRF check asks (tests stub it; production uses the system's). */
  resolver?: HostResolver;
  /**
   * How a URL becomes a pinned target. The default is the SSRF check; a test
   * replaces it to pin its `.test` site to a loopback listener, the way
   * `safe-fetch.ts` lets its tests do.
   */
  resolveTarget?: (url: string) => Promise<PublicHttpTarget>;
  /** Extra trust anchor — tests only, for their local HTTPS site. */
  ca?: string;
  /** One hop, connect to last byte. */
  timeoutMs?: number;
  /** Shared politeness; one per process unless a test brings its own. */
  gate?: HostGate;
  /** The clock and the wait for `Retry-After` — tests drive both. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  retryAfterMaxMs?: number;
}

/** One gate for every fetcher this process makes, unless told otherwise. */
const sharedGate = new HostGate();

export function createHttpCrawlFetcher(options: HttpCrawlFetcherOptions = {}): CrawlFetcher {
  const resolveTarget =
    options.resolveTarget ?? ((url: string) => resolvePublicHttpTarget(url, options.resolver));
  const settings: Settings = {
    resolveTarget,
    ca: options.ca,
    timeoutMs: options.timeoutMs ?? KNOWLEDGE_CRAWL_LIMITS.fetchTimeoutMs,
    gate: options.gate ?? sharedGate,
    now: options.now ?? Date.now,
    sleep: options.sleep ?? ((ms, signal) => delay(ms, undefined, { signal })),
    retryAfterMaxMs: options.retryAfterMaxMs ?? RETRY_AFTER_MAX_MS,
  };
  return { fetch: (request) => fetchFollowing(request, settings) };
}

interface Settings {
  resolveTarget: (url: string) => Promise<PublicHttpTarget>;
  ca: string | undefined;
  timeoutMs: number;
  gate: HostGate;
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  retryAfterMaxMs: number;
}

async function fetchFollowing(
  request: CrawlFetchRequest,
  settings: Settings,
): Promise<CrawlFetchResult> {
  const ceiling = fetchCeiling(request);
  let current = request.url;
  let bytes = 0;
  let redirects = 0;
  let retries = 0;
  const failed = (error: CrawlFetchError, status?: number): CrawlFetchResult => ({
    kind: 'failed',
    url: current,
    error,
    bytes,
    ...(status === undefined ? {} : { status }),
  });

  for (;;) {
    if (request.signal?.aborted) return failed('cancelled');

    // A fresh check on every hop and every retry: the redirect's host is a
    // new name, and the old one may resolve somewhere new by now.
    let target: PublicHttpTarget;
    try {
      target = await withDeadline(settings.resolveTarget(current), settings.timeoutMs);
    } catch (error) {
      return failed(resolveFailure(error));
    }

    let release: () => void;
    try {
      release = await settings.gate.acquire(target.url.hostname, request.signal);
    } catch {
      return failed('cancelled');
    }
    let answer: Exchange;
    try {
      answer = await exchange(target, request, ceiling, settings);
    } finally {
      release();
    }
    bytes += answer.bytes;
    if (answer.kind === 'failed') return failed(answer.error, answer.status);

    const { status, headers } = answer;
    const location = headers['location'];
    if (status >= 300 && status < 400 && typeof location === 'string' && location !== '') {
      redirects += 1;
      if (redirects > KNOWLEDGE_CRAWL_LIMITS.redirects) return failed('redirect_limit', status);
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return failed('redirect_invalid', status);
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return failed('redirect_invalid', status);
      }
      next.hash = '';
      // Refused before it is asked for: "outside the scope" means no request.
      if (request.allowRedirect && !request.allowRedirect(next)) {
        return failed('redirect_out_of_scope', status);
      }
      current = next.href;
      continue;
    }

    const contentType = headerValue(headers['content-type']);
    const sample = answer.body.subarray(0, BOT_WALL_SAMPLE_BYTES).toString('latin1');
    if (detectBotWall({ status, headers, sample })) {
      return { kind: 'blocked', url: current, status, bytes };
    }

    if ((status === 429 || status === 503) && retries < KNOWLEDGE_CRAWL_LIMITS.retryAfterAttempts) {
      const wait = parseRetryAfter(
        headerValue(headers['retry-after']) ?? undefined,
        settings.now(),
      );
      if (wait !== null && wait <= settings.retryAfterMaxMs) {
        retries += 1;
        try {
          await settings.sleep(wait, request.signal);
        } catch {
          return failed('cancelled');
        }
        continue;
      }
    }

    if (status >= 200 && status < 300) {
      return {
        kind: 'ok',
        url: current,
        status,
        contentType,
        body: answer.body,
        truncated: answer.truncated,
        redirects,
        bytes,
      };
    }
    return { kind: 'http_error', url: current, status, bytes };
  }
}

function headerValue(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** `resolvePublicHttpTarget` refuses with a validation error; a name that does not resolve is the one it words differently. */
function resolveFailure(error: unknown): CrawlFetchError {
  if (error instanceof DeadlineError) return 'timeout';
  if (isApiError(error)) {
    return /could not be resolved/.test(error.message) ? 'dns_failed' : 'ssrf_refused';
  }
  return 'network';
}

class DeadlineError extends Error {}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new DeadlineError()), ms);
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

type Exchange =
  | {
      kind: 'answer';
      status: number;
      headers: http.IncomingHttpHeaders;
      body: Buffer;
      truncated: boolean;
      bytes: number;
    }
  | { kind: 'failed'; error: CrawlFetchError; status?: number; bytes: number };

const EMPTY = Buffer.alloc(0);

/**
 * One request to one pinned target and its answer. A redirect's body is not
 * read; a 2xx's is read up to the ceiling; any other status's only as far as
 * the bot-wall check looks.
 */
function exchange(
  target: PublicHttpTarget,
  request: CrawlFetchRequest,
  ceiling: number,
  settings: Settings,
): Promise<Exchange> {
  return new Promise<Exchange>((resolve) => {
    const controller = new AbortController();
    const cleanup: Array<() => void> = [];
    let settled = false;
    let wire = 0;
    const finish = (result: Exchange): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', onCancel);
      for (const step of cleanup) step();
      // Tears down whatever is still open; after a complete read, nothing is.
      controller.abort();
      resolve(result);
    };
    const fail = (error: CrawlFetchError, status?: number): void =>
      finish({ kind: 'failed', error, bytes: wire, ...(status === undefined ? {} : { status }) });
    const onCancel = (): void => fail('cancelled');
    const timer = setTimeout(() => fail('timeout'), settings.timeoutMs);
    if (request.signal?.aborted) {
      fail('cancelled');
      return;
    }
    request.signal?.addEventListener('abort', onCancel, { once: true });

    const onResponse = (response: http.IncomingMessage): void => {
      const status = response.statusCode ?? 0;
      response.on('error', () => fail('network', status));
      response.on('close', () => {
        if (!response.complete) fail('network', status);
      });
      if (status >= 300 && status < 400) {
        finish({
          kind: 'answer',
          status,
          headers: response.headers,
          body: EMPTY,
          truncated: false,
          bytes: wire,
        });
        return;
      }

      const ok = status >= 200 && status < 300;
      if (
        ok &&
        request.purpose === 'page' &&
        !isHtmlContentType(response.headers['content-type'])
      ) {
        fail('not_html', status);
        return;
      }
      const limit = ok ? ceiling : BOT_WALL_SAMPLE_BYTES;
      const truncate = ok ? (request.truncate ?? false) : true;
      const declared = Number(response.headers['content-length']);
      if (!truncate && Number.isFinite(declared) && declared > limit) {
        fail('too_large', status);
        return;
      }
      const decoder = decoderFor(response.headers['content-encoding']);
      if (decoder === 'unsupported') {
        fail('unsupported_encoding', status);
        return;
      }
      if (decoder) cleanup.push(() => decoder.destroy());

      const chunks: Buffer[] = [];
      let decoded = 0;
      const done = (truncated: boolean): void =>
        finish({
          kind: 'answer',
          status,
          headers: response.headers,
          body: Buffer.concat(chunks),
          truncated,
          bytes: wire,
        });
      const take = (chunk: Buffer): void => {
        if (settled) return;
        const room = limit - decoded;
        decoded += chunk.length;
        if (decoder && decoded > INFLATE_RATIO_FLOOR_BYTES && decoded > wire * INFLATE_RATIO_MAX) {
          fail('compression_ratio', status);
          return;
        }
        if (chunk.length > room) {
          if (!truncate) {
            fail('too_large', status);
            return;
          }
          chunks.push(chunk.subarray(0, room));
          done(true);
          return;
        }
        chunks.push(chunk);
      };

      response.on('data', (chunk: Buffer) => {
        if (settled) return;
        wire += chunk.length;
        if (!decoder) {
          take(chunk);
          return;
        }
        // Compressed bytes past the ceiling inflate past it too.
        if (wire > limit && !truncate) {
          fail('too_large', status);
          return;
        }
        decoder.write(chunk);
      });
      if (decoder) {
        decoder.on('data', take);
        decoder.on('error', () => fail('unsupported_encoding', status));
        decoder.on('end', () => done(false));
        response.on('end', () => decoder.end());
      } else {
        response.on('end', () => done(false));
      }
    };

    try {
      const { lookup, servername } = pinnedConnection(target);
      const common: http.RequestOptions = {
        method: 'GET',
        headers: {
          'user-agent': CRAWLER_USER_AGENT,
          accept: acceptFor(request.purpose),
          'accept-encoding': 'gzip, deflate, br',
        },
        lookup,
        // One connection per hop: a pooled socket was pinned by an earlier check.
        agent: false,
        signal: controller.signal,
      };
      const outgoing =
        target.url.protocol === 'https:'
          ? https.request(
              target.url,
              {
                ...common,
                ...(servername ? { servername } : {}),
                // Explicit, so NODE_TLS_REJECT_UNAUTHORIZED=0 cannot switch it off here.
                rejectUnauthorized: true,
                ...(settings.ca ? { ca: settings.ca } : {}),
              },
              onResponse,
            )
          : http.request(target.url, common, onResponse);
      outgoing.on('error', (error: NodeJS.ErrnoException) => {
        if (settled) return;
        fail(connectionFailure(error));
      });
      outgoing.end();
    } catch (error) {
      fail((error as NodeJS.ErrnoException).code === UNPINNED_CODE ? 'ssrf_refused' : 'network');
    }
  });
}

function decoderFor(
  encoding: string | undefined,
): zlib.Gunzip | zlib.Inflate | zlib.BrotliDecompress | null | 'unsupported' {
  const value = (encoding ?? '').trim().toLowerCase();
  if (value === '' || value === 'identity') return null;
  if (value === 'gzip' || value === 'x-gzip') return zlib.createGunzip();
  if (value === 'deflate') return zlib.createInflate();
  if (value === 'br') return zlib.createBrotliDecompress();
  return 'unsupported';
}

const TLS_CODES = new Set([
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'CERT_HAS_EXPIRED',
  'CERT_NOT_YET_VALID',
]);

function connectionFailure(error: NodeJS.ErrnoException): CrawlFetchError {
  const code = typeof error.code === 'string' ? error.code : '';
  if (code === UNPINNED_CODE) return 'ssrf_refused';
  if (TLS_CODES.has(code) || code.startsWith('ERR_TLS_') || code.startsWith('ERR_SSL_')) {
    return 'tls';
  }
  return 'network';
}
