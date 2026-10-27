/**
 * Website crawling (tm 312 · SiyahTuş analysis AI-17) — the vocabulary the
 * schema (`20261110090000_knowledge_crawl`), the contract (`KnowledgeSource`
 * crawl fields, `KnowledgePage`, `KnowledgeJob`) and the panel share.
 *
 * A `website` source is crawled in one of three scopes: `single` — the URL
 * given and nothing else; `all` — every page under it, found from its sitemap
 * or, without one, by following links breadth-first; `sitemap` — the pages its
 * sitemap lists and nothing it would only reach by a link. Each crawled page
 * is a `knowledge_pages` row with a status, and the crawl itself is a
 * `knowledge_jobs` row a background runner works through (tm 312.3), never
 * the request that asked for it.
 *
 * Literals only: this module is part of the widget loader's import graph, and
 * a top-level call would land in its 8 KB budget.
 */

/** How far a website source reaches past the URL it was given. */
export const CRAWL_SCOPES = ['single', 'all', 'sitemap'] as const;
export type CrawlScope = (typeof CRAWL_SCOPES)[number];

/** A website source that never said — every one added before tm 312. */
export const DEFAULT_CRAWL_SCOPE: CrawlScope = 'single';

export function isCrawlScope(value: unknown): value is CrawlScope {
  return typeof value === 'string' && (CRAWL_SCOPES as readonly string[]).includes(value);
}

/**
 * The crawl's ceilings (AI-17, AI-17-S2). `pagesPerSource` is also the most a
 * source's `page_limit` may say and what it says when nobody chose;
 * `pagesPerWorkspace` counts every website source's pages together. The rest
 * bound one fetch and one job, so a hostile or broken site costs a known
 * amount and no more.
 */
export const KNOWLEDGE_CRAWL_LIMITS = {
  /** `page_limit`'s ceiling and default. */
  pagesPerSource: 200,
  /** A workspace's crawled pages, every website source together (AI-17-S2). */
  pagesPerWorkspace: 2000,
  /** Links followed from the start URL when there is no sitemap (`all`). */
  depth: 3,
  /** One page's body, read as a stream and cut off here. */
  pageBytes: 5 * 1024 * 1024,
  /** Every body one job reads, together. */
  jobBytes: 200 * 1024 * 1024,
  /** Nested sitemap indexes followed below the first. */
  sitemapIndexDepth: 2,
  /** URLs read from one site's sitemaps, together. */
  sitemapUrls: 50_000,
  /** Redirects followed for one fetch, each re-checked for SSRF and scope. */
  redirects: 5,
  /** One fetch, headers to the last byte. */
  fetchTimeoutMs: 10_000,
  /** The least time between two requests to one host. */
  hostIntervalMs: 500,
  /** Requests in flight to one host at once. */
  hostConcurrency: 2,
  /** Retries of a 429/503 that names a `Retry-After`. */
  retryAfterAttempts: 2,
} as const;

/** `page_limit`: at least one page, at most {@link KNOWLEDGE_CRAWL_LIMITS}'s per-source ceiling. */
export const KNOWLEDGE_PAGE_LIMIT = { min: 1, max: 200, default: 200 } as const;

/**
 * `include_paths` / `exclude_paths`: how many a source may list and how long
 * one may be. A path is a prefix of a URL's path (see {@link crawlPathInScope}).
 */
export const KNOWLEDGE_CRAWL_PATHS = { maxCount: 20, maxLength: 200 } as const;

/**
 * A path prefix as a source stores it: begins with `/`, no query, fragment,
 * wildcard or whitespace. The schema's CHECK holds the leading `/`; the rest
 * is the API's to refuse.
 */
export const KNOWLEDGE_CRAWL_PATH_PATTERN = /^\/[^\s?#*]*$/;

/**
 * A list of path prefixes in the one spelling a source keeps: trimmed, no
 * repeats, first mention first. Returns null when an entry is not a path
 * prefix ({@link KNOWLEDGE_CRAWL_PATH_PATTERN}) or too long, or the list too
 * long — the caller says which field.
 */
export function normalizeCrawlPaths(values: readonly string[]): string[] | null {
  const kept: string[] = [];
  for (const raw of values) {
    const path = raw.trim();
    if (path.length > KNOWLEDGE_CRAWL_PATHS.maxLength) return null;
    if (!KNOWLEDGE_CRAWL_PATH_PATTERN.test(path)) return null;
    if (!kept.includes(path)) kept.push(path);
  }
  return kept.length > KNOWLEDGE_CRAWL_PATHS.maxCount ? null : kept;
}

/**
 * Whether a URL path is one the source's path lists let in: no `include`
 * entry, or one that is a prefix of it — and no `exclude` entry that is.
 * Exclusion wins. A prefix matches at a segment boundary only, so `/bonus`
 * takes `/bonus` and `/bonus/hosgeldin` but not `/bonuslar`; a prefix ending
 * in `/` takes what is below it.
 */
export function crawlPathInScope(
  path: string,
  include: readonly string[],
  exclude: readonly string[],
): boolean {
  const under = (prefix: string) =>
    path === prefix ||
    (prefix.endsWith('/') ? path.startsWith(prefix) : path.startsWith(`${prefix}/`));
  if (exclude.some(under)) return false;
  return include.length === 0 || include.some(under);
}

/**
 * What became of one page of a crawl (`knowledge_pages.status`):
 *
 * - `ok` — fetched and indexed;
 * - `unchanged` — fetched, the text's hash matched the last crawl, nothing
 *   embedded again;
 * - `skipped_scope` — found, but outside the source's scope or path lists;
 * - `robots_disallowed` — the site's robots.txt forbids it, never fetched;
 * - `blocked` — the site answered with a bot wall;
 * - `needs_js` — the page draws its text with JavaScript, which the crawler
 *   does not run (AI-17-S3);
 * - `error` — the fetch failed (refused target, timeout, too large, 5xx);
 * - `removed` — gone (two 404/410 in a row) or out of scope since; its
 *   chunks are deleted.
 */
export const KNOWLEDGE_PAGE_STATUSES = [
  'ok',
  'unchanged',
  'skipped_scope',
  'robots_disallowed',
  'blocked',
  'needs_js',
  'error',
  'removed',
] as const;
export type KnowledgePageStatus = (typeof KNOWLEDGE_PAGE_STATUSES)[number];

/** The page statuses whose text is in the store — the pages the AI answers from. */
export const KNOWLEDGE_PAGE_INDEXED_STATUSES = [
  'ok',
  'unchanged',
] as const satisfies readonly KnowledgePageStatus[];

/**
 * What a knowledge job does: `crawl` — a website source's first or a manual
 * re-crawl; `refresh` — the freshness sweep's re-crawl; `document` — a large
 * uploaded document's parse and index (AI-18).
 */
export const KNOWLEDGE_JOB_KINDS = ['crawl', 'refresh', 'document'] as const;
export type KnowledgeJobKind = (typeof KNOWLEDGE_JOB_KINDS)[number];

/**
 * Where a knowledge job is: `queued` → `running` → `done` | `failed`, with
 * `waiting_budget` — the day's AI allowance ran out mid-job, it resumes after
 * UTC midnight from its frontier — and `cancelled` by a person.
 */
export const KNOWLEDGE_JOB_STATUSES = [
  'queued',
  'running',
  'waiting_budget',
  'done',
  'failed',
  'cancelled',
] as const;
export type KnowledgeJobStatus = (typeof KNOWLEDGE_JOB_STATUSES)[number];

/**
 * The statuses of a job still under way. A source has at most one such job
 * (`knowledge_jobs_one_active_per_source`); only these can be cancelled.
 */
export const KNOWLEDGE_JOB_ACTIVE_STATUSES = [
  'queued',
  'running',
  'waiting_budget',
] as const satisfies readonly KnowledgeJobStatus[];

export function isKnowledgeJobActive(status: string): boolean {
  return (KNOWLEDGE_JOB_ACTIVE_STATUSES as readonly string[]).includes(status);
}
