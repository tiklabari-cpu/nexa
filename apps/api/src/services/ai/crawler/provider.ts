/**
 * Which fetcher a website crawl uses (tm 312.2 · AI-17): `mock` — no network,
 * the default (a locked decision: every test and demo crawls without egress)
 * — or `http`, the real one behind the SSRF guard. The job runner (tm 312.3)
 * reads `CRAWLER_PROVIDER` and asks this module for its fetcher.
 *
 * The pilot crawling with the mock answers every website with the same
 * invented page, so production under `PILOT_MODE=true` is told at boot — a
 * warning, not a refusal (owner, 2026-10-10: no rule that can stop the
 * system without asking first).
 */
import type { CrawlFetcher } from './fetcher.js';
import { createHttpCrawlFetcher, type HttpCrawlFetcherOptions } from './http-fetcher.js';
import { createMockCrawlFetcher } from './mock-fetcher.js';

export const CRAWLER_PROVIDERS = ['mock', 'http'] as const;
export type CrawlerProvider = (typeof CRAWLER_PROVIDERS)[number];

export function createCrawlFetcher(
  provider: CrawlerProvider,
  options: HttpCrawlFetcherOptions = {},
): CrawlFetcher {
  return provider === 'http' ? createHttpCrawlFetcher(options) : createMockCrawlFetcher();
}

/** The boot warning for a crawler that cannot read a real site where real people use it, or null. */
export function crawlerProviderWarning(env: {
  NODE_ENV: string;
  PILOT_MODE: boolean;
  CRAWLER_PROVIDER: CrawlerProvider;
}): string | null {
  if (env.NODE_ENV !== 'production' || !env.PILOT_MODE || env.CRAWLER_PROVIDER !== 'mock') {
    return null;
  }
  return 'CRAWLER_PROVIDER is mock under PILOT_MODE=true: website knowledge sources index an invented page instead of the site. Set CRAWLER_PROVIDER=http.';
}
