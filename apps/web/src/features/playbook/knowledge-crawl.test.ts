import { describe, expect, it } from 'vitest';
import {
  PAGE_STATUS_VIEW,
  crawlCreateBody,
  crawlErrorMessage,
  crawlErrors,
  crawlIsValid,
  crawlRefreshDays,
  defaultCrawlValue,
  pathLines,
  pathToExclude,
} from './knowledge-crawl.js';
import { KNOWLEDGE_PAGE_STATUSES } from '@siyahtus/types';
import { CATALOGUES } from '../../locales/index.js';

const { en, tr } = CATALOGUES as unknown as Record<'en' | 'tr', Record<string, string>>;

const value = (patch: Partial<ReturnType<typeof defaultCrawlValue>> = {}) => ({
  ...defaultCrawlValue(),
  authorized: true,
  ...patch,
});

describe('the add form’s crawl settings (AI-17)', () => {
  it('starts on one page, at the ceiling, and not yet authorised', () => {
    const start = defaultCrawlValue();
    expect(start).toMatchObject({ scope: 'single', pageLimit: '200', authorized: false });
    expect(crawlIsValid(start)).toBe(false);
    expect(crawlIsValid(value())).toBe(true);
  });

  it('sends the scope alone for a single page, whatever the hidden fields still hold', () => {
    expect(crawlCreateBody(value({ pageLimit: '9999', includePaths: 'nope' }))).toEqual({
      crawl_scope: 'single',
    });
    expect(crawlErrors(value({ pageLimit: '9999', includePaths: 'nope' }))).toEqual([]);
  });

  it('sends limit and path lists for a wider crawl, trimmed and without repeats', () => {
    const body = crawlCreateBody(
      value({
        scope: 'all',
        pageLimit: '50',
        includePaths: ' /yardim \n\n/yardim\n/sss',
        excludePaths: '/yardim/eski',
      }),
    );
    expect(body).toEqual({
      crawl_scope: 'all',
      page_limit: 50,
      include_paths: ['/yardim', '/sss'],
      exclude_paths: ['/yardim/eski'],
    });
  });

  it('refuses what the endpoint would: a limit outside 1–200, a path without a leading slash', () => {
    expect(crawlErrors(value({ scope: 'sitemap', pageLimit: '0' }))).toEqual(['pageLimit']);
    expect(crawlErrors(value({ scope: 'sitemap', pageLimit: '201' }))).toEqual(['pageLimit']);
    expect(crawlErrors(value({ scope: 'sitemap', pageLimit: '2.5' }))).toEqual(['pageLimit']);
    expect(
      crawlErrors(value({ scope: 'all', includePaths: 'yardim', excludePaths: '/a b' })),
    ).toEqual(['includePaths', 'excludePaths']);
    expect(crawlIsValid(value({ scope: 'all', pageLimit: '' }))).toBe(false);
  });

  it('reads the refresh interval as 5–365 days or never', () => {
    expect(crawlRefreshDays(value())).toBeNull();
    expect(crawlRefreshDays(value({ refreshDays: '30' }))).toBe(30);
    expect(crawlErrors(value({ refreshDays: '4' }))).toEqual(['refreshDays']);
    expect(crawlErrors(value({ refreshDays: '366' }))).toEqual(['refreshDays']);
    expect(crawlErrors(value({ refreshDays: '5' }))).toEqual([]);
    expect(crawlErrors(value({ refreshDays: '365' }))).toEqual([]);
  });

  it('splits a textarea into non-empty lines', () => {
    expect(pathLines('/a\r\n  \n /b ')).toEqual(['/a', '/b']);
  });
});

describe('the words for a crawl’s outcome', () => {
  it('gives every page status a tone and a catalogue sentence in both languages', () => {
    for (const status of KNOWLEDGE_PAGE_STATUSES) {
      const view = PAGE_STATUS_VIEW[status];
      expect(en[view.key], `${status} (en)`).toBeTruthy();
      expect(tr[view.key], `${status} (tr)`).toBeTruthy();
      if (view.hintKey) {
        expect(en[view.hintKey]).toBeTruthy();
        expect(tr[view.hintKey]).toBeTruthy();
      }
    }
  });

  it('words every reason code the crawler writes, an HTTP status, and a code it has never seen', () => {
    for (const code of ['ssrf_refused', 'timeout', 'robots_unreachable', 'empty_page', 'gone']) {
      const { key } = crawlErrorMessage(code);
      expect(en[key], code).toBeTruthy();
      expect(tr[key], code).toBeTruthy();
    }
    expect(crawlErrorMessage('http_503')).toEqual({
      key: 'playbook.knowledge.crawl.error.http',
      values: { status: '503' },
    });
    expect(crawlErrorMessage('brand_new_code')).toEqual({
      key: 'playbook.knowledge.crawl.error.unknown',
      values: { code: 'brand_new_code' },
    });
  });
});

describe('leaving a page out of the next crawl', () => {
  it('turns a page URL into the path prefix that excludes it', () => {
    expect(pathToExclude('https://x.example/yardim/iade')).toBe('/yardim/iade');
    expect(pathToExclude('https://x.example/yardim/iade/?utm_source=a')).toBe('/yardim/iade');
  });

  it('offers nothing for the site root or something that is not a URL', () => {
    expect(pathToExclude('https://x.example/')).toBeNull();
    expect(pathToExclude('https://x.example')).toBeNull();
    expect(pathToExclude('not a url')).toBeNull();
  });
});
