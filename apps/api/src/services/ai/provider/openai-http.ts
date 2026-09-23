/**
 * What the two OpenAI adapters share about talking to OpenAI (tm 255.6 wrote
 * these for chat; tm 255.7 moved them here so the embedding adapter reads a
 * response, a failure and a base URL exactly the way the chat adapter does).
 *
 * Nothing in this file decides policy — how often to retry, how long to wait,
 * when to stop. That stays with each adapter, because the two calls answer to
 * different people: a chat completion to a customer waiting on a reply, an
 * embedding to a customer's question or an admin's upload. What is here is the
 * reading of the far end, and it has to be identical: a body is whatever the
 * provider chose to send, and two parsers of it are two places for one to
 * trust something the other did not.
 */

/**
 * 429 codes that mean money, not pace (ADR §3.1, OpenAI's error-code guide):
 * retrying "won't restore API access", and it would spend the caller's wait on
 * requests that cannot succeed. `insufficient_quota` is the code OpenAI's API
 * long answered the same condition with; today's guide no longer lists it, and
 * recognising it costs nothing.
 */
export const OPENAI_QUOTA_CODES: ReadonlySet<string> = new Set([
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'insufficient_quota',
]);

/** The failures an HTTP status can say by itself — a subset of both adapters' kinds. */
export type HttpFailureKind =
  | 'rate_limited'
  | 'quota_exhausted'
  | 'unavailable'
  | 'auth'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'bad_response';

/** Which failure an HTTP answer is. `problem` is the error body's `code` and `type`. */
export function classifyHttpFailure(
  status: number,
  problem: { code: string | null; type: string | null },
): HttpFailureKind {
  if (status === 429) {
    const quota = [problem.code, problem.type].some(
      (value) => value !== null && OPENAI_QUOTA_CODES.has(value),
    );
    return quota ? 'quota_exhausted' : 'rate_limited';
  }
  // 408 is the server saying it gave up waiting, which RFC 9110 lets a client repeat.
  if (status >= 500 || status === 408) return 'unavailable';
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status >= 400) return 'bad_request';
  // A 3xx — refused rather than followed — or anything else that is not an answer.
  return 'bad_response';
}

/**
 * "Equal jitter": half of the exponential step (`baseMs`, doubling, capped at
 * `capMs`) is fixed and half is random — random so the callers one 429 turned
 * away do not all return in the same millisecond, half fixed so a retry is
 * never immediate. OpenAI's own advice for its rate limits.
 */
export function equalJitterBackoffMs(
  attempt: number,
  random: () => number,
  { baseMs, capMs }: { baseMs: number; capMs: number },
): number {
  const step = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(step / 2 + random() * (step / 2));
}

/**
 * A `Retry-After` header in milliseconds, or `null` when absent or unreadable.
 * RFC 9110 §10.2.3 allows seconds or an HTTP-date; both are honoured.
 */
export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const value = header.trim();
  if (/^\d+(\.\d+)?$/.test(value)) return Math.round(Number(value) * 1_000);
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * The endpoint `path` under a configured base URL, or an error for the operator.
 *
 * The base comes from configuration, not from a tenant, so `lib/ssrf.ts`'s
 * private-address rule is not the check it needs: development points it at a
 * stand-in on loopback on purpose, and production is already narrower than
 * "any public host" — `provider-hosts.ts` admits the two regional OpenAI hosts
 * and nothing else. What is checked here is what would make the adapter's own
 * request wrong: a scheme fetch cannot use, a credential in the URL (it would
 * travel outside the API key's redaction), and a query or fragment the appended
 * path would silently drop. None of the messages repeats the URL — the
 * credential case is exactly the one where it must not be printed. `key` is the
 * setting the value came from, so the message names what to fix.
 */
export function openAiEndpointUrl(
  baseUrl: string,
  { key, apiKeyName, path }: { key: string; apiKeyName: string; path: string },
): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error(`${key} is not a URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`${key} must be an http(s) URL.`);
  }
  if (url.username || url.password) {
    throw new Error(
      `${key} must not carry credentials; the key belongs in ${apiKeyName}, which is kept out of logs.`,
    );
  }
  if (url.search || url.hash) {
    throw new Error(
      `${key} must not have a query string or fragment: the adapter appends /${path} to its path.`,
    );
  }
  const base = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  return `${url.origin}${base}${path}`;
}

export const SAFE_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
export const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Visible ASCII: what an HTTP header value can carry without fetch refusing it. */
export const HEADER_SAFE = /^[\x21-\x7e]+$/;

/** `error.code` and `error.type` from an error body, when present and safe to keep. */
export async function readProblem(
  response: Response,
  limit: number,
): Promise<{ code: string | null; type: string | null }> {
  try {
    const parsed: unknown = JSON.parse(await readCapped(response, limit));
    const error = isRecord(parsed) && isRecord(parsed['error']) ? parsed['error'] : null;
    return {
      code: safeToken(error?.['code'], SAFE_CODE),
      type: safeToken(error?.['type'], SAFE_CODE),
    };
  } catch {
    return { code: null, type: null };
  }
}

export class ResponseTooLarge extends Error {}

/**
 * The body as text, refusing to hold more than `limit` bytes of it — whether
 * the server announced the size or not. Past the limit the stream is cancelled,
 * which releases the connection.
 */
export async function readCapped(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new ResponseTooLarge();
  }
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new ResponseTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/**
 * The socket's error code behind fetch's generic `TypeError: fetch failed`
 * (`ECONNRESET`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT` …), else the error's
 * name. Never its message: a message is prose, and prose can quote anything.
 */
export function networkCode(error: unknown): string | null {
  const cause = error instanceof Error ? error.cause : undefined;
  const code = isRecord(cause) ? cause['code'] : isRecord(error) ? error['code'] : undefined;
  return (
    safeToken(code, SAFE_CODE) ?? (error instanceof Error ? safeToken(error.name, SAFE_CODE) : null)
  );
}

export function safeToken(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
