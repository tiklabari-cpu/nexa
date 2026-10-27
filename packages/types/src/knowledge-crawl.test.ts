import { describe, expect, it } from 'vitest';
import {
  CRAWL_SCOPES,
  DEFAULT_CRAWL_SCOPE,
  KNOWLEDGE_CRAWL_LIMITS,
  KNOWLEDGE_CRAWL_PATHS,
  KNOWLEDGE_JOB_ACTIVE_STATUSES,
  KNOWLEDGE_JOB_KINDS,
  KNOWLEDGE_JOB_STATUSES,
  KNOWLEDGE_PAGE_INDEXED_STATUSES,
  KNOWLEDGE_PAGE_LIMIT,
  KNOWLEDGE_PAGE_STATUSES,
  crawlPathInScope,
  isCrawlScope,
  isKnowledgeJobActive,
  normalizeCrawlPaths,
} from './knowledge-crawl.js';

describe('crawl vocabulary (AI-17 · tm 312.1)', () => {
  it('names three scopes, and a source that never said is a single page', () => {
    expect(CRAWL_SCOPES).toEqual(['single', 'all', 'sitemap']);
    expect(DEFAULT_CRAWL_SCOPE).toBe('single');
    expect(isCrawlScope('sitemap')).toBe(true);
    expect(isCrawlScope('deep')).toBe(false);
    expect(isCrawlScope(undefined)).toBe(false);
  });

  it('holds the ceilings the analysis set: 200 pages, depth 3, 5 MB a page, 200 MB a job', () => {
    expect(KNOWLEDGE_CRAWL_LIMITS.pagesPerSource).toBe(200);
    expect(KNOWLEDGE_CRAWL_LIMITS.pagesPerWorkspace).toBe(2000);
    expect(KNOWLEDGE_CRAWL_LIMITS.depth).toBe(3);
    expect(KNOWLEDGE_CRAWL_LIMITS.pageBytes).toBe(5 * 1024 * 1024);
    expect(KNOWLEDGE_CRAWL_LIMITS.jobBytes).toBe(200 * 1024 * 1024);
    expect(KNOWLEDGE_CRAWL_LIMITS.sitemapIndexDepth).toBe(2);
    expect(KNOWLEDGE_CRAWL_LIMITS.sitemapUrls).toBe(50_000);
    expect(KNOWLEDGE_CRAWL_LIMITS.redirects).toBe(5);
  });

  it("page_limit's ceiling and default are the per-source ceiling", () => {
    expect(KNOWLEDGE_PAGE_LIMIT.max).toBe(KNOWLEDGE_CRAWL_LIMITS.pagesPerSource);
    expect(KNOWLEDGE_PAGE_LIMIT.default).toBe(KNOWLEDGE_CRAWL_LIMITS.pagesPerSource);
    expect(KNOWLEDGE_PAGE_LIMIT.min).toBe(1);
  });

  it('names the eight page statuses; only ok and unchanged are in the store', () => {
    expect(KNOWLEDGE_PAGE_STATUSES).toEqual([
      'ok',
      'unchanged',
      'skipped_scope',
      'robots_disallowed',
      'blocked',
      'needs_js',
      'error',
      'removed',
    ]);
    expect(KNOWLEDGE_PAGE_INDEXED_STATUSES).toEqual(['ok', 'unchanged']);
  });

  it('a job is under way while queued, running or waiting for the budget', () => {
    expect(KNOWLEDGE_JOB_KINDS).toEqual(['crawl', 'refresh', 'document']);
    expect(KNOWLEDGE_JOB_STATUSES).toEqual([
      'queued',
      'running',
      'waiting_budget',
      'done',
      'failed',
      'cancelled',
    ]);
    expect(KNOWLEDGE_JOB_ACTIVE_STATUSES).toEqual(['queued', 'running', 'waiting_budget']);
    expect(KNOWLEDGE_JOB_STATUSES.filter(isKnowledgeJobActive)).toEqual(
      KNOWLEDGE_JOB_ACTIVE_STATUSES,
    );
  });
});

describe('crawl path lists (AI-17 · tm 312.1)', () => {
  it('keeps one spelling: trimmed, no repeats, first mention first', () => {
    expect(normalizeCrawlPaths([' /yardim/ ', '/bonus', '/yardim/'])).toEqual([
      '/yardim/',
      '/bonus',
    ]);
    expect(normalizeCrawlPaths([])).toEqual([]);
  });

  it.each([['yardim'], ['/a?b=1'], ['/a#x'], ['/bonus/*'], ['/a b'], ['']])(
    'refuses %j — a path prefix starts with / and holds no query, fragment, wildcard or space',
    (entry) => {
      expect(normalizeCrawlPaths([entry])).toBeNull();
    },
  );

  it('refuses a path or a list past its ceiling', () => {
    expect(normalizeCrawlPaths([`/${'a'.repeat(KNOWLEDGE_CRAWL_PATHS.maxLength - 1)}`])).not.toBe(
      null,
    );
    expect(normalizeCrawlPaths([`/${'a'.repeat(KNOWLEDGE_CRAWL_PATHS.maxLength)}`])).toBeNull();
    const many = Array.from({ length: KNOWLEDGE_CRAWL_PATHS.maxCount + 1 }, (_, i) => `/p${i}`);
    expect(normalizeCrawlPaths(many.slice(0, -1))).toHaveLength(KNOWLEDGE_CRAWL_PATHS.maxCount);
    expect(normalizeCrawlPaths(many)).toBeNull();
  });

  it('matches a prefix at a segment boundary only', () => {
    expect(crawlPathInScope('/bonus', ['/bonus'], [])).toBe(true);
    expect(crawlPathInScope('/bonus/hosgeldin', ['/bonus'], [])).toBe(true);
    expect(crawlPathInScope('/bonuslar', ['/bonus'], [])).toBe(false);
    expect(crawlPathInScope('/yardim/odeme', ['/yardim/'], [])).toBe(true);
    expect(crawlPathInScope('/yardim', ['/yardim/'], [])).toBe(false);
  });

  it('lets everything in without an include list, and exclusion wins', () => {
    expect(crawlPathInScope('/anything', [], [])).toBe(true);
    expect(crawlPathInScope('/yardim/kvkk', ['/yardim/'], ['/yardim/kvkk'])).toBe(false);
    expect(crawlPathInScope('/blog/1', [], ['/blog'])).toBe(false);
    expect(crawlPathInScope('/blogger', [], ['/blog'])).toBe(true);
  });
});
