/**
 * The crawl fetcher with no network (`CRAWLER_PROVIDER=mock`, the default —
 * tm 312.2 · AI-17): every test and every demo crawls through it.
 *
 * It answers like a small, well-behaved site: no `robots.txt` and no
 * sitemap (both 404 — so `all` follows links and nothing is disallowed), and
 * every other URL the deterministic page `web-crawler.ts`'s `mockFetcher`
 * has always returned. A test hands it a `site` that answers some URLs
 * itself — a sitemap with fifty entries, a robots.txt that disallows, a page
 * that changed, one that is gone — and it follows that site's redirects with
 * the real fetcher's rules: at most {@link KNOWLEDGE_CRAWL_LIMITS}`.redirects`,
 * each refused before it is requested when it leaves the scope or names an
 * internal host. The literal SSRF guard runs on every hop; no name is
 * resolved, because nothing is connected to.
 *
 * `requests` records every URL asked for, in order — what a test reads to
 * say "nothing outside the scope was requested".
 */
import { KNOWLEDGE_CRAWL_LIMITS } from '@siyahtus/types';
import { assertPublicHttpUrl } from '../../../lib/ssrf.js';
import { mockFetcher } from '../web-crawler.js';
import {
  BOT_WALL_SAMPLE_BYTES,
  detectBotWall,
  fetchCeiling,
  isHtmlContentType,
  type CrawlFetcher,
  type CrawlFetchError,
  type CrawlFetchRequest,
  type CrawlFetchResult,
} from './fetcher.js';

/** One answer a mock site gives. */
export interface MockSiteResponse {
  status: number;
  /** Default `text/html; charset=utf-8` for a 2xx. */
  contentType?: string;
  body?: string | Buffer;
  /** For a 3xx: where it points. */
  location?: string;
  headers?: Record<string, string>;
}

/** A mock site: an answer for a URL, or undefined for the default one. */
export type MockSite = (url: URL) => MockSiteResponse | undefined;

export interface MockCrawlFetcher extends CrawlFetcher {
  /** Every URL requested, every hop, in order. */
  readonly requests: string[];
}

export function createMockCrawlFetcher(site?: MockSite): MockCrawlFetcher {
  const requests: string[] = [];
  return {
    requests,
    async fetch(request) {
      return answer(request, site, requests);
    },
  };
}

async function answer(
  request: CrawlFetchRequest,
  site: MockSite | undefined,
  requests: string[],
): Promise<CrawlFetchResult> {
  let current = request.url;
  let redirects = 0;
  let bytes = 0;
  const failed = (error: CrawlFetchError, status?: number): CrawlFetchResult => ({
    kind: 'failed',
    url: current,
    error,
    bytes,
    ...(status === undefined ? {} : { status }),
  });

  for (;;) {
    if (request.signal?.aborted) return failed('cancelled');
    let url: URL;
    try {
      url = assertPublicHttpUrl(current);
    } catch {
      return failed('ssrf_refused');
    }
    requests.push(url.href);
    const response = site?.(url) ?? (await defaultResponse(url));
    const body =
      typeof response.body === 'string'
        ? Buffer.from(response.body, 'utf8')
        : (response.body ?? Buffer.alloc(0));
    const status = response.status;

    if (status >= 300 && status < 400 && response.location) {
      redirects += 1;
      if (redirects > KNOWLEDGE_CRAWL_LIMITS.redirects) return failed('redirect_limit', status);
      let next: URL;
      try {
        next = new URL(response.location, url);
      } catch {
        return failed('redirect_invalid', status);
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        return failed('redirect_invalid', status);
      }
      next.hash = '';
      if (request.allowRedirect && !request.allowRedirect(next)) {
        return failed('redirect_out_of_scope', status);
      }
      current = next.href;
      continue;
    }

    const ok = status >= 200 && status < 300;
    const contentType = response.contentType ?? (ok ? 'text/html; charset=utf-8' : null);
    if (ok && request.purpose === 'page' && !isHtmlContentType(contentType)) {
      return failed('not_html', status);
    }
    const ceiling = fetchCeiling(request);
    let truncated = false;
    let kept = body;
    if (ok && body.length > ceiling) {
      if (!request.truncate) return failed('too_large', status);
      kept = body.subarray(0, ceiling);
      truncated = true;
    }
    bytes += kept.length;
    const headers = { ...(response.headers ?? {}) };
    const sample = kept.subarray(0, BOT_WALL_SAMPLE_BYTES).toString('latin1');
    if (detectBotWall({ status, headers, sample })) {
      return { kind: 'blocked', url: url.href, status, bytes };
    }
    if (!ok) return { kind: 'http_error', url: url.href, status, bytes };
    return {
      kind: 'ok',
      url: url.href,
      status,
      contentType,
      body: kept,
      truncated,
      redirects,
      bytes,
    };
  }
}

/** A site with no robots.txt, no sitemap, and the deterministic page everywhere else. */
async function defaultResponse(url: URL): Promise<MockSiteResponse> {
  if (url.pathname === '/robots.txt' || /\/sitemap[^/]*\.xml(\.gz)?$/.test(url.pathname)) {
    return { status: 404, contentType: 'text/plain', body: 'Not found' };
  }
  return { status: 200, body: (await mockFetcher(url)).html };
}
