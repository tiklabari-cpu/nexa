/**
 * The seam between a website crawl and the network (tm 312.2 · AI-17).
 *
 * A crawl asks a {@link CrawlFetcher} for three kinds of document — a page,
 * a site's `robots.txt`, a sitemap — and gets back a {@link CrawlFetchResult}
 * that never throws for anything the site did: a refused target, a timeout, a
 * 404, a bot wall are all answers, each with the snake_case code
 * `knowledge_pages.error` keeps. Two implementations, chosen by
 * `CRAWLER_PROVIDER`: the real one (`http-fetcher.ts`, every hop through the
 * SSRF guard) and a deterministic one with no network (`mock-fetcher.ts`), so
 * the crawl's logic is tested without egress.
 */
import { KNOWLEDGE_CRAWL_LIMITS } from '@siyahtus/types';

/**
 * The crawler's `robots.txt` product token (RFC 9309 §2.2.1): a site writes
 * `User-agent: SiyahTusBot` to speak to it alone.
 */
export const CRAWLER_PRODUCT_TOKEN = 'SiyahTusBot';

/** Says what is asking and carries the product token a site's robots.txt names. */
export const CRAWLER_USER_AGENT = `Mozilla/5.0 (compatible; ${CRAWLER_PRODUCT_TOKEN}/1.0)`;

/** What a fetch is for — decides its `Accept`, whether a non-HTML answer is a failure, and whether a redirect may leave the site. */
export type CrawlFetchPurpose = 'page' | 'robots' | 'sitemap';

export interface CrawlFetchRequest {
  url: string;
  purpose: CrawlFetchPurpose;
  /**
   * Whether a redirect may land on this URL — the crawl's scope. Checked on
   * every hop before it is requested, so an out-of-scope target is never
   * asked for. Unset: any target the SSRF guard lets through (a `robots.txt`
   * may redirect across hosts, RFC 9309 §2.3.1.2).
   */
  allowRedirect?: (url: URL) => boolean;
  /** The body's ceiling, after decompression. Default: one page's ({@link KNOWLEDGE_CRAWL_LIMITS}). */
  maxBytes?: number;
  /**
   * Past the ceiling, keep what was read instead of failing — a `robots.txt`
   * is read up to its first 500 KiB, a sitemap up to the ceiling. A page
   * never is: half a page is a page that says something else.
   */
  truncate?: boolean;
  /** The job was cancelled: stop waiting, drop the connection. */
  signal?: AbortSignal;
}

/**
 * Why a fetch produced nothing to read — `knowledge_pages.error`:
 *
 * - `ssrf_refused` — the URL, or a redirect, names (or resolves to) a private,
 *   loopback, link-local or otherwise internal address, or carries credentials;
 * - `dns_failed` — the host does not resolve;
 * - `timeout` — no complete answer in time;
 * - `too_large` — the body passed its ceiling;
 * - `compression_ratio` — the body inflated like a decompression bomb;
 * - `unsupported_encoding` — a `Content-Encoding` this crawler does not read;
 * - `network` / `tls` — the connection or its certificate failed;
 * - `redirect_limit` — more redirects than one fetch follows;
 * - `redirect_invalid` — a redirect to no URL, or to one that is not http(s);
 * - `redirect_out_of_scope` — a redirect off the crawl's scope; not followed;
 * - `not_html` — a page that is not HTML (a PDF, an image), not downloaded;
 * - `cancelled` — the job was.
 */
export const CRAWL_FETCH_ERRORS = [
  'ssrf_refused',
  'dns_failed',
  'timeout',
  'too_large',
  'compression_ratio',
  'unsupported_encoding',
  'network',
  'tls',
  'redirect_limit',
  'redirect_invalid',
  'redirect_out_of_scope',
  'not_html',
  'cancelled',
] as const;
export type CrawlFetchError = (typeof CRAWL_FETCH_ERRORS)[number];

interface CrawlFetchAnswer {
  /** The URL that answered — the last hop's. */
  url: string;
  /** Bytes read off the wire, every hop and retry together (`knowledge_jobs.bytes_fetched`). */
  bytes: number;
}

/**
 * - `ok` — a 2xx with its body;
 * - `http_error` — any other final status (a 404/410 is how a page is gone);
 * - `blocked` — a bot wall answered instead of the site;
 * - `failed` — nothing usable came back ({@link CrawlFetchError}).
 */
export type CrawlFetchResult =
  | (CrawlFetchAnswer & {
      kind: 'ok';
      status: number;
      contentType: string | null;
      body: Buffer;
      /** The body passed its ceiling and was cut there (`truncate` requests only). */
      truncated: boolean;
      redirects: number;
    })
  | (CrawlFetchAnswer & { kind: 'http_error'; status: number })
  | (CrawlFetchAnswer & { kind: 'blocked'; status: number })
  | (CrawlFetchAnswer & { kind: 'failed'; error: CrawlFetchError; status?: number });

export interface CrawlFetcher {
  fetch(request: CrawlFetchRequest): Promise<CrawlFetchResult>;
}

/** The ceiling a request reads up to. */
export function fetchCeiling(request: CrawlFetchRequest): number {
  return request.maxBytes ?? KNOWLEDGE_CRAWL_LIMITS.pageBytes;
}

/** `Accept` per purpose. */
export function acceptFor(purpose: CrawlFetchPurpose): string {
  if (purpose === 'robots') return 'text/plain,*/*;q=0.1';
  if (purpose === 'sitemap') return 'application/xml,text/xml;q=0.9,text/plain;q=0.5,*/*;q=0.1';
  return 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1';
}

/** The media type of a `Content-Type`, lowercase, without its parameters. */
export function mediaType(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  const type = contentType.split(';', 1)[0]!.trim().toLowerCase();
  return type === '' ? null : type;
}

/**
 * Whether a page's `Content-Type` is one a page may have. No header at all is
 * given the benefit of the doubt — the parse decides what is in it.
 */
export function isHtmlContentType(contentType: string | null | undefined): boolean {
  const type = mediaType(contentType);
  return type === null || type === 'text/html' || type === 'application/xhtml+xml';
}

/** The longest a `Retry-After` is waited for; longer, and the page fails instead. */
export const RETRY_AFTER_MAX_MS = 30_000;

/**
 * A `Retry-After` in milliseconds from `now` — seconds or an HTTP date — or
 * null when there is none or it cannot be read. A date in the past is 0.
 */
export function parseRetryAfter(value: string | undefined, now: number): number | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (/^\d{1,10}$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string {
  const value = headers[name];
  return (Array.isArray(value) ? value.join(', ') : (value ?? '')).toLowerCase();
}

/** How much of a body the bot-wall check reads. */
export const BOT_WALL_SAMPLE_BYTES = 64 * 1024;

/**
 * Markers bot-protection services put in the page they answer with instead
 * of the site's — Cloudflare, DataDome, Imperva/Incapsula, HUMAN/PerimeterX,
 * Sucuri, DDoS-Guard, and the CAPTCHA widgets they embed.
 */
const WALL_MARKERS = [
  'cf-chl',
  'cf-browser-verification',
  'challenge-platform',
  'attention required! | cloudflare',
  'captcha-delivery.com',
  '_incapsula_resource',
  'px-captcha',
  '_pxappid',
  'sucuri website firewall',
  'ddos-guard',
  'g-recaptcha',
  'h-captcha',
  'cf-turnstile',
];

/** Titles of challenge pages served with a 200, where the markers above alone would overreach. */
const WALL_TITLES = ['just a moment...', 'attention required! | cloudflare', 'ddos-guard'];

/**
 * Whether an answer is a bot wall rather than the site (page status
 * `blocked`). `sample` is the start of the body ({@link BOT_WALL_SAMPLE_BYTES}).
 *
 * A refusal status (403, 429, 503) with a protection service's marker is a
 * wall; so is Cloudflare's explicit `cf-mitigated: challenge`. A 200 is a
 * wall only when its title is a challenge's: Cloudflare injects its
 * challenge-platform script into ordinary pages too, so a marker in a 200 is
 * not evidence.
 */
export function detectBotWall(answer: {
  status: number;
  headers: Headers;
  sample: string;
}): boolean {
  if (header(answer.headers, 'cf-mitigated') === 'challenge') return true;
  const body = answer.sample.toLowerCase();
  if (answer.status === 403 || answer.status === 429 || answer.status === 503) {
    if (answer.headers['x-datadome'] !== undefined) return true;
    if (answer.headers['x-sucuri-id'] !== undefined && answer.status === 403) return true;
    if (answer.headers['x-iinfo'] !== undefined) return true;
    if (WALL_MARKERS.some((marker) => body.includes(marker))) return true;
    if (
      header(answer.headers, 'server').includes('akamaighost') &&
      body.includes('access denied')
    ) {
      return true;
    }
    return false;
  }
  if (answer.status >= 200 && answer.status < 300) {
    const title = titleOf(body);
    return title !== null && WALL_TITLES.some((wall) => title.startsWith(wall));
  }
  return false;
}

/** The `<title>` of a lowercase HTML sample, trimmed, or null. */
function titleOf(body: string): string | null {
  const open = body.indexOf('<title');
  if (open === -1) return null;
  const start = body.indexOf('>', open);
  if (start === -1) return null;
  const end = body.indexOf('</title', start);
  if (end === -1) return null;
  return body
    .slice(start + 1, end)
    .replace(/\s+/g, ' ')
    .trim();
}
