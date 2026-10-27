/**
 * Sitemaps for the website crawl (tm 312.2 · AI-17): what the scanner reads
 * out of a sitemap, how far an index is followed, and that only the crawl's
 * own site is ever asked.
 */
import zlib from 'node:zlib';
import { KNOWLEDGE_CRAWL_LIMITS } from '@siyahtus/types';
import { describe, expect, it } from 'vitest';
import { createCrawlScope } from './frontier.js';
import { createMockCrawlFetcher, type MockSiteResponse } from './mock-fetcher.js';
import { discoverSitemapUrls, parseSitemap, SITEMAP_MAX_DOCUMENTS } from './sitemap.js';

const urlset = (locs: string[]) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((loc) => `<url><loc>${loc}</loc><lastmod>2026-10-01</lastmod></url>`)
    .join('')}</urlset>`;
const index = (locs: string[]) =>
  `<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((loc) => `<sitemap><loc>${loc}</loc></sitemap>`)
    .join('')}</sitemapindex>`;
const xml = (body: string | Buffer): MockSiteResponse => ({
  status: 200,
  contentType: 'application/xml',
  body,
});

describe('parseSitemap — a linear scanner over a stranger’s XML (FR-MOD-06.3.2)', () => {
  it('reads a urlset and a sitemap index', () => {
    expect(parseSitemap(urlset(['https://example.com/a', 'https://example.com/b']))).toEqual({
      kind: 'urlset',
      locs: ['https://example.com/a', 'https://example.com/b'],
    });
    expect(parseSitemap(index(['https://example.com/s1.xml']))).toEqual({
      kind: 'sitemapindex',
      locs: ['https://example.com/s1.xml'],
    });
  });

  it('decodes entities and CDATA, trims, and skips comments', () => {
    const text = `<urlset><!-- <url><loc>https://example.com/commented</loc></url> -->
      <url><loc>
        https://example.com/a?x=1&amp;y=2&#38;z=&#x33;
      </loc></url>
      <url><loc><![CDATA[https://example.com/b?x=1&y=2]]></loc></url></urlset>`;
    expect(parseSitemap(text)!.locs).toEqual([
      'https://example.com/a?x=1&y=2&z=3',
      'https://example.com/b?x=1&y=2',
    ]);
  });

  it('skips image, video and alternate-language extension locations', () => {
    const text = `<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
      <url><loc>https://example.com/page</loc>
        <image:image><image:loc>https://example.com/banner.png</image:loc></image:image>
        <xhtml:link rel="alternate" hreflang="en" href="https://example.com/en/page"/>
      </url></urlset>`;
    expect(parseSitemap(text)!.locs).toEqual(['https://example.com/page']);
  });

  it('reads a sitemap written with a namespace prefix', () => {
    const text =
      '<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://example.com/p</sm:loc></sm:url></sm:urlset>';
    expect(parseSitemap(text)!.locs).toEqual(['https://example.com/p']);
  });

  it('keeps what it read from a sitemap cut off mid-entry', () => {
    const whole = urlset(['https://example.com/a', 'https://example.com/b']);
    expect(parseSitemap(whole.slice(0, whole.indexOf('/b') + 2))!.locs).toEqual([
      'https://example.com/a',
    ]);
  });

  it('reads a text sitemap, one URL a line', () => {
    expect(parseSitemap('https://example.com/a\r\n\nnot a url\nhttps://example.com/b\n')).toEqual({
      kind: 'urlset',
      locs: ['https://example.com/a', 'https://example.com/b'],
    });
  });

  it('is not fooled by an HTML page or an RSS feed', () => {
    expect(
      parseSitemap('<!doctype html><html><body><loc>https://x</loc></body></html>'),
    ).toBeNull();
    expect(
      parseSitemap('<rss><channel><item><link>https://x</link></item></channel></rss>'),
    ).toBeNull();
    expect(parseSitemap('   ')).toBeNull();
  });

  it('stops after maxLocs entries', () => {
    const many = urlset(Array.from({ length: 100 }, (_, i) => `https://example.com/${i}`));
    expect(parseSitemap(many, 7)!.locs).toHaveLength(7);
  });

  it('scans a hostile document in linear time', () => {
    const hostile = `<urlset>${'<url><loc>'.repeat(100_000)}${'<'.repeat(200_000)}`;
    const started = process.cpuUsage();
    parseSitemap(hostile);
    const { user, system } = process.cpuUsage(started);
    expect((user + system) / 1000).toBeLessThan(2000);
  });
});

describe('discoverSitemapUrls — the pages a site lists, and only its own (FR-MOD-06.3.2)', () => {
  it('finds the 50 in-scope pages of a sitemap and asks nothing outside the site', async () => {
    const inScope = Array.from({ length: 50 }, (_, i) => `https://example.com/yardim/s${i}`);
    const elsewhere = [
      'https://example.com/blog/a',
      'https://evil.example/yardim/x',
      'http://127.0.0.1/yardim/x',
    ];
    const fetcher = createMockCrawlFetcher((url) =>
      url.pathname === '/sitemap.xml' ? xml(urlset([...inScope, ...elsewhere])) : undefined,
    );
    const scope = createCrawlScope({
      rootUrl: 'https://example.com/yardim/',
      include: [],
      exclude: [],
    });
    const found = await discoverSitemapUrls({ fetcher, scope, declared: [], want: 200 });

    expect(found.found).toBe(true);
    expect(found.urls).toEqual(inScope);
    expect(found.entries).toBe(53);
    expect(fetcher.requests).toEqual(['https://example.com/sitemap.xml']);
  });

  it('reads the sitemaps robots.txt names, but only on the crawl’s own site', async () => {
    const fetcher = createMockCrawlFetcher((url) =>
      url.pathname === '/s/pages.xml' ? xml(urlset(['https://www.example.com/a'])) : undefined,
    );
    const scope = createCrawlScope({ rootUrl: 'https://example.com/', include: [], exclude: [] });
    const found = await discoverSitemapUrls({
      fetcher,
      scope,
      declared: ['https://www.example.com/s/pages.xml', 'https://cdn.example.net/s.xml'],
    });
    expect(found.urls).toEqual(['https://www.example.com/a']);
    expect(fetcher.requests).toEqual(['https://www.example.com/s/pages.xml']);
  });

  it('follows an index two levels below the first and no further', async () => {
    const fetcher = createMockCrawlFetcher((url) => {
      switch (url.pathname) {
        case '/sitemap.xml':
          return xml(index(['/l1.xml']));
        case '/l1.xml':
          return xml(index(['https://example.com/l2.xml', 'https://example.com/l1-pages.xml']));
        case '/l1-pages.xml':
          return xml(urlset(['https://example.com/from-l1']));
        case '/l2.xml':
          return xml(index(['https://example.com/l3.xml']));
        case '/l3.xml':
          return xml(urlset(['https://example.com/from-l3']));
        default:
          return undefined;
      }
    });
    const scope = createCrawlScope({ rootUrl: 'https://example.com/', include: [], exclude: [] });
    const found = await discoverSitemapUrls({ fetcher, scope, declared: [] });
    expect(KNOWLEDGE_CRAWL_LIMITS.sitemapIndexDepth).toBe(2);
    expect(found.urls).toEqual(['https://example.com/from-l1']);
    expect(fetcher.requests).not.toContain('https://example.com/l3.xml');
  });

  it('applies the path lists and drops duplicates', async () => {
    const fetcher = createMockCrawlFetcher((url) =>
      url.pathname === '/sitemap.xml'
        ? xml(
            urlset([
              'https://example.com/bonus/a',
              'https://example.com/bonus/a#x',
              'https://www.example.com/bonus/a/',
              'https://example.com/bonus/eski/b',
              'https://example.com/odeme',
            ]),
          )
        : undefined,
    );
    const scope = createCrawlScope({
      rootUrl: 'https://example.com/',
      include: ['/bonus'],
      exclude: ['/bonus/eski'],
    });
    const found = await discoverSitemapUrls({ fetcher, scope, declared: [] });
    expect(found.urls).toEqual(['https://example.com/bonus/a']);
  });

  it('stops once it has the pages it wants', async () => {
    const fetcher = createMockCrawlFetcher((url) => {
      if (url.pathname === '/sitemap.xml') return xml(index(['/a.xml', '/b.xml']));
      if (url.pathname === '/a.xml')
        return xml(
          urlset(['https://example.com/1', 'https://example.com/2', 'https://example.com/3']),
        );
      return undefined;
    });
    const scope = createCrawlScope({ rootUrl: 'https://example.com/', include: [], exclude: [] });
    const found = await discoverSitemapUrls({ fetcher, scope, declared: [], want: 2 });
    expect(found.urls).toEqual(['https://example.com/1', 'https://example.com/2']);
    expect(fetcher.requests).not.toContain('https://example.com/b.xml');
  });

  it('reads no more documents than its cap, however long the index', async () => {
    const children = Array.from({ length: SITEMAP_MAX_DOCUMENTS * 2 }, (_, i) => `/c${i}.xml`);
    const fetcher = createMockCrawlFetcher((url) =>
      url.pathname === '/sitemap.xml' ? xml(index(children)) : xml(urlset([])),
    );
    const scope = createCrawlScope({ rootUrl: 'https://example.com/', include: [], exclude: [] });
    const found = await discoverSitemapUrls({ fetcher, scope, declared: [] });
    expect(found.documents).toBe(SITEMAP_MAX_DOCUMENTS);
    expect(fetcher.requests).toHaveLength(SITEMAP_MAX_DOCUMENTS);
  });

  it('reads a gzip sitemap, and refuses one that inflates past its ceiling', async () => {
    const small = zlib.gzipSync(urlset(['https://example.com/gz']));
    const bomb = zlib.gzipSync(Buffer.alloc(8 * 1024 * 1024, 0x20));
    const fetcher = createMockCrawlFetcher((url) => {
      if (url.pathname === '/sitemap.xml') return xml(index(['/a.xml.gz', '/bomb.xml.gz']));
      if (url.pathname === '/a.xml.gz') return xml(small);
      if (url.pathname === '/bomb.xml.gz') return xml(bomb);
      return undefined;
    });
    const scope = createCrawlScope({ rootUrl: 'https://example.com/', include: [], exclude: [] });
    const found = await discoverSitemapUrls({
      fetcher,
      scope,
      declared: [],
      maxBytes: 1024 * 1024,
    });
    expect(found.urls).toEqual(['https://example.com/gz']);
  });

  it('says it found nothing when the site has no sitemap', async () => {
    const fetcher = createMockCrawlFetcher();
    const scope = createCrawlScope({ rootUrl: 'https://example.com/', include: [], exclude: [] });
    expect(await discoverSitemapUrls({ fetcher, scope, declared: [] })).toEqual({
      urls: [],
      found: false,
      documents: 1,
      bytes: 9,
      entries: 0,
    });
  });

  it('does not follow a sitemap redirect off the site', async () => {
    const fetcher = createMockCrawlFetcher((url) =>
      url.pathname === '/sitemap.xml'
        ? { status: 301, location: 'https://elsewhere.example/sitemap.xml' }
        : undefined,
    );
    const scope = createCrawlScope({ rootUrl: 'https://example.com/', include: [], exclude: [] });
    const found = await discoverSitemapUrls({ fetcher, scope, declared: [] });
    expect(found.found).toBe(false);
    expect(fetcher.requests).toEqual(['https://example.com/sitemap.xml']);
  });
});
