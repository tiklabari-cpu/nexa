/**
 * robots.txt for the website crawl (tm 312.2 · AI-17 · RFC 9309): which group
 * applies, which rule wins, what a missing or unreachable file means, and how
 * long an answer is kept.
 */
import { describe, expect, it } from 'vitest';
import { CRAWLER_PRODUCT_TOKEN } from './fetcher.js';
import { createMockCrawlFetcher, type MockSiteResponse } from './mock-fetcher.js';
import {
  normalizeRobotsPath,
  parseRobotsTxt,
  RobotsCache,
  robotsAllows,
  robotsPatternMatches,
  ROBOTS_TTL_MS,
  ROBOTS_UNREACHABLE_TTL_MS,
} from './robots.js';

const BASE = 'https://example.com/robots.txt';
const allows = (text: string, path: string) =>
  robotsAllows(parseRobotsTxt(text, BASE), `https://example.com${path}`);

describe('parseRobotsTxt + robotsAllows — RFC 9309 matching (FR-MOD-06.3.2)', () => {
  it('disallows what the * group disallows, and nothing else', () => {
    const text = 'User-agent: *\nDisallow: /admin\nDisallow: /tmp/\n';
    expect(allows(text, '/admin')).toBe(false);
    expect(allows(text, '/admin/users')).toBe(false);
    expect(allows(text, '/administration')).toBe(false);
    expect(allows(text, '/tmp')).toBe(true);
    expect(allows(text, '/tmp/x')).toBe(false);
    expect(allows(text, '/yardim')).toBe(true);
  });

  it("follows the crawler's own group, case-insensitively, instead of *", () => {
    const text = [
      'User-agent: *',
      'Disallow: /',
      '',
      `User-agent: ${CRAWLER_PRODUCT_TOKEN.toLowerCase()}`,
      'Disallow: /private',
    ].join('\n');
    expect(allows(text, '/yardim')).toBe(true);
    expect(allows(text, '/private/a')).toBe(false);
  });

  it('combines every group that names the crawler, and a group naming several agents', () => {
    const text = [
      'User-agent: OtherBot',
      `User-agent: ${CRAWLER_PRODUCT_TOKEN}`,
      'Disallow: /a',
      'User-agent: *',
      'Disallow: /',
      `User-agent: ${CRAWLER_PRODUCT_TOKEN}`,
      'Disallow: /b',
    ].join('\n');
    expect(allows(text, '/a')).toBe(false);
    expect(allows(text, '/b')).toBe(false);
    expect(allows(text, '/c')).toBe(true);
  });

  it('lets the longest pattern win, Allow on a tie', () => {
    const text = 'User-agent: *\nDisallow: /yardim\nAllow: /yardim/sss\nAllow: /x\nDisallow: /x\n';
    expect(allows(text, '/yardim/bonus')).toBe(false);
    expect(allows(text, '/yardim/sss/1')).toBe(true);
    expect(allows(text, '/x')).toBe(true);
  });

  it('reads * as any run and a final $ as the end', () => {
    const text = 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /*?sessionid=\nDisallow: /a*b*c\n';
    expect(allows(text, '/docs/kurallar.pdf')).toBe(false);
    expect(allows(text, '/docs/kurallar.pdf?v=2')).toBe(true);
    expect(allows(text, '/sayfa?sessionid=1')).toBe(false);
    expect(allows(text, '/a-xx-b-yy-c-zz')).toBe(false);
    expect(allows(text, '/a-xx-c-yy-b')).toBe(true);
  });

  it('compares paths and patterns with percent-encoding normalised', () => {
    const text = 'User-agent: *\nDisallow: /yardım\nDisallow: /%7euser\n';
    expect(allows(text, '/yard%C4%B1m/sss')).toBe(false);
    expect(allows(text, '/yard%c4%b1m')).toBe(false);
    expect(allows(text, '/~user/x')).toBe(false);
    expect(normalizeRobotsPath('/a%2fb')).toBe('/a%2Fb');
  });

  it('treats an empty Disallow as no rule, ignores comments, a BOM and unknown fields', () => {
    const text = `${String.fromCharCode(0xfeff)}# hi\nUser-agent: * # everyone\nDisallow:\nCrawl-delay: 10\n`;
    const policy = parseRobotsTxt(text, BASE);
    expect(policy.kind).toBe('allow_all');
    expect(allows('User-agent: *\r\nDisallow: /x # not this\r\n', '/x')).toBe(false);
  });

  it('always allows /robots.txt itself', () => {
    expect(allows('User-agent: *\nDisallow: /\n', '/robots.txt')).toBe(true);
    expect(allows('User-agent: *\nDisallow: /\n', '/')).toBe(false);
  });

  it('collects Sitemap lines from anywhere in the file, resolved, http(s) only', () => {
    const policy = parseRobotsTxt(
      'Sitemap: https://example.com/sitemap_index.xml\nUser-agent: *\nDisallow: /x\nsitemap: /s2.xml\nSitemap: ftp://example.com/s.xml\n',
      BASE,
    );
    expect(policy.sitemaps).toEqual([
      'https://example.com/sitemap_index.xml',
      'https://example.com/s2.xml',
    ]);
  });

  it('matches a hostile pattern against a long path in linear time', () => {
    const pattern = normalizeRobotsPath(`/${'*a'.repeat(2000)}$`);
    const path = `/${'a'.repeat(200_000)}b`;
    const started = process.cpuUsage();
    expect(robotsPatternMatches(pattern, path)).toBe(false);
    const { user, system } = process.cpuUsage(started);
    expect((user + system) / 1000).toBeLessThan(2000);
  });
});

function siteWith(robots: MockSiteResponse | (() => MockSiteResponse)) {
  return createMockCrawlFetcher((url) =>
    url.pathname === '/robots.txt' ? (typeof robots === 'function' ? robots() : robots) : undefined,
  );
}

describe('RobotsCache — what an answer means, and how long it is kept (FR-MOD-06.3.2)', () => {
  it('reads a 2xx, and allows everything on a 4xx', async () => {
    const parsed = new RobotsCache(
      siteWith({ status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /x\n' }),
    );
    expect(await parsed.allows('https://example.com/x')).toBe(false);
    expect(await parsed.allows('https://example.com/y')).toBe(true);

    for (const status of [401, 403, 404, 410]) {
      const missing = new RobotsCache(siteWith({ status, body: 'nope' }));
      expect(await missing.allows('https://example.com/x')).toBe(true);
    }
  });

  it('disallows everything while the file is unreachable: a 5xx, a 429, a refused target', async () => {
    for (const status of [500, 503, 429]) {
      const down = new RobotsCache(siteWith({ status, body: 'down' }));
      expect((await down.policyFor('https://example.com/')).kind).toBe('unreachable');
      expect(await down.allows('https://example.com/yardim')).toBe(false);
    }
    const internal = new RobotsCache(createMockCrawlFetcher());
    expect((await internal.policyFor('http://127.0.0.1/')).kind).toBe('unreachable');
  });

  it('follows a redirected robots.txt, even to another host', async () => {
    const fetcher = createMockCrawlFetcher((url) => {
      if (url.hostname === 'example.com' && url.pathname === '/robots.txt') {
        return { status: 301, location: 'https://cdn.example.net/robots/example.txt' };
      }
      if (url.hostname === 'cdn.example.net') {
        return { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /x' };
      }
      return undefined;
    });
    expect(await new RobotsCache(fetcher).allows('https://example.com/x')).toBe(false);
  });

  it('asks once per origin for a day, then again', async () => {
    let now = 1_000_000;
    let served = 0;
    const fetcher = siteWith(() => {
      served += 1;
      return { status: 200, contentType: 'text/plain', body: 'User-agent: *\nDisallow: /x' };
    });
    const cache = new RobotsCache(fetcher, { now: () => now });
    await Promise.all([
      cache.allows('https://example.com/a'),
      cache.allows('https://example.com/b'),
    ]);
    await cache.allows('https://example.com/c');
    expect(served).toBe(1);
    await cache.allows('https://other.example/c');
    expect(served).toBe(2);

    now += ROBOTS_TTL_MS + 1;
    await cache.allows('https://example.com/a');
    expect(served).toBe(3);
  });

  it('asks an unreachable site again after minutes, not a day', async () => {
    let now = 0;
    let status = 503;
    const cache = new RobotsCache(
      siteWith(() => ({ status, contentType: 'text/plain', body: 'User-agent: *\nDisallow:' })),
      { now: () => now },
    );
    expect(await cache.allows('https://example.com/a')).toBe(false);
    status = 200;
    now += ROBOTS_UNREACHABLE_TTL_MS - 1;
    expect(await cache.allows('https://example.com/a')).toBe(false);
    now += 2;
    expect(await cache.allows('https://example.com/a')).toBe(true);
  });

  it('keeps nothing from a cancelled fetch', async () => {
    const fetcher = siteWith({
      status: 200,
      contentType: 'text/plain',
      body: 'User-agent: *\nDisallow: /',
    });
    const cache = new RobotsCache(fetcher);
    const controller = new AbortController();
    controller.abort();
    await cache.policyFor('https://example.com/', controller.signal);
    expect(await cache.allows('https://example.com/a')).toBe(false);
    expect(fetcher.requests).toEqual(['https://example.com/robots.txt']);
  });

  it('reads only the first 500 KiB of a huge file', async () => {
    const rule = 'User-agent: *\nDisallow: /early\n';
    const body = `${rule}${'#'.repeat(600 * 1024)}\nDisallow: /late\n`;
    const cache = new RobotsCache(siteWith({ status: 200, contentType: 'text/plain', body }));
    expect(await cache.allows('https://example.com/early')).toBe(false);
    expect(await cache.allows('https://example.com/late')).toBe(true);
  });
});
