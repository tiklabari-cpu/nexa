/**
 * The crawl frontier (tm 312.2 · AI-17): one spelling per page, the scope a
 * crawl may not leave, and a breadth-first queue that a stopped job resumes.
 */
import { describe, expect, it } from 'vitest';
import {
  CRAWL_URL_MAX_LENGTH,
  CrawlFrontier,
  createCrawlScope,
  normalizeCrawlUrl,
  sha256Hex,
} from './frontier.js';

const scopeOf = (rootUrl: string, include: string[] = [], exclude: string[] = []) =>
  createCrawlScope({ rootUrl, include, exclude });

describe('normalizeCrawlUrl — one page, one identity (FR-MOD-06.3.2)', () => {
  it('drops the fragment and the tracking parameters, and sorts the rest', () => {
    const a = normalizeCrawlUrl(
      'https://Example.com/yardim?b=2&utm_source=x&a=1&gclid=g&fbclid=f&UTM_Medium=m#ust',
    )!;
    expect(a.url).toBe('https://example.com/yardim?a=1&b=2');
    const b = normalizeCrawlUrl('https://example.com/yardim?a=1&b=2')!;
    expect(a.key).toBe(b.key);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.hash).toBe(sha256Hex(a.key));
  });

  it('keeps two values of one parameter in their order, and their bytes as sent', () => {
    expect(normalizeCrawlUrl('https://example.com/?z=%20&a=2&a=1')!.url).toBe(
      'https://example.com/?a=2&a=1&z=%20',
    );
  });

  it('gives the trailing slash, the scheme and www. one identity, but fetches what was linked', () => {
    const slash = normalizeCrawlUrl('https://www.example.com/yardim/')!;
    const bare = normalizeCrawlUrl('http://example.com/yardim')!;
    expect(slash.url).toBe('https://www.example.com/yardim/');
    expect(bare.url).toBe('http://example.com/yardim');
    expect(slash.key).toBe(bare.key);
    expect(normalizeCrawlUrl('https://example.com')!.key).toBe('example.com/');
  });

  it('keeps a port that is not the default one in the identity', () => {
    expect(normalizeCrawlUrl('https://example.com:443/a')!.key).toBe('example.com/a');
    expect(normalizeCrawlUrl('https://example.com:8443/a')!.key).toBe('example.com:8443/a');
  });

  it('resolves a relative link against its page', () => {
    expect(normalizeCrawlUrl('../sss?x=1#a', 'https://example.com/yardim/bonus/')!.url).toBe(
      'https://example.com/yardim/sss?x=1',
    );
  });

  it('refuses what a crawl cannot fetch: other schemes, credentials, garbage, too long', () => {
    expect(normalizeCrawlUrl('mailto:a@example.com')).toBeNull();
    expect(normalizeCrawlUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeCrawlUrl('ftp://example.com/a')).toBeNull();
    expect(normalizeCrawlUrl('https://user:pass@example.com/')).toBeNull();
    expect(normalizeCrawlUrl('not a url')).toBeNull();
    const long = `https://example.com/${'a'.repeat(CRAWL_URL_MAX_LENGTH)}`;
    expect(normalizeCrawlUrl(long)).toBeNull();
  });

  it('trims a path of slashes in linear time', () => {
    const started = process.cpuUsage();
    normalizeCrawlUrl(`https://example.com/${'/'.repeat(1_000_000)}x`);
    const { user, system } = process.cpuUsage(started);
    expect((user + system) / 1000).toBeLessThan(2000);
  });
});

describe('createCrawlScope — a crawl stays on its site, under its path, inside its lists (FR-MOD-06.3.2)', () => {
  it('takes the site with or without www., and an upgrade to https', () => {
    const scope = scopeOf('http://example.com/');
    expect(scope.check('http://www.example.com/a')).toBe('in');
    expect(scope.check('https://example.com/a')).toBe('in');
    expect(scope.check('https://other.example/a')).toBe('other_site');
    expect(scope.check('https://sub.example.com/a')).toBe('other_site');
    expect(scope.check('http://example.com:8080/a')).toBe('other_site');
  });

  it('never downgrades an https site to http', () => {
    expect(scopeOf('https://example.com/').check('http://example.com/a')).toBe('other_site');
  });

  it('bounds the crawl by the start path, at a segment boundary', () => {
    const scope = scopeOf('https://example.com/yardim');
    expect(scope.check('https://example.com/yardim')).toBe('in');
    expect(scope.check('https://example.com/yardim/bonus')).toBe('in');
    expect(scope.check('https://example.com/yardimlar')).toBe('outside_root');
    expect(scope.check('https://example.com/')).toBe('outside_root');
  });

  it("takes a file's directory when the start URL names a file", () => {
    const scope = scopeOf('https://example.com/yardim/sss.html');
    expect(scope.check('https://example.com/yardim/odeme')).toBe('in');
    expect(scope.check('https://example.com/blog')).toBe('outside_root');
  });

  it('applies the include and exclude lists on the decoded path, exclusion winning', () => {
    const scope = scopeOf('https://example.com/', ['/yardım', '/bonus/'], ['/bonus/eski']);
    expect(scope.check('https://example.com/yard%C4%B1m/sss')).toBe('in');
    expect(scope.check('https://example.com/bonus/hosgeldin')).toBe('in');
    expect(scope.check('https://example.com/bonus/eski/2020')).toBe('path_rule');
    expect(scope.check('https://example.com/blog')).toBe('path_rule');
  });

  it('calls a URL it cannot fetch invalid', () => {
    expect(scopeOf('https://example.com/').check('mailto:a@example.com')).toBe('invalid');
  });

  it('lets a sitemap live anywhere on the site, and nowhere else', () => {
    const scope = scopeOf('https://example.com/yardim/');
    expect(scope.sameSite('https://www.example.com/sitemap.xml')).toBe(true);
    expect(scope.sameSite('https://cdn.example.net/sitemap.xml')).toBe(false);
    expect(scope.sameSite('::nonsense')).toBe(false);
  });
});

describe('CrawlFrontier — breadth-first, deduplicated, bounded, resumable (FR-MOD-06.3.2)', () => {
  it('queues in-scope pages once each and says why the rest were not', () => {
    const frontier = new CrawlFrontier({ scope: scopeOf('https://example.com/'), pageLimit: 10 });
    expect(frontier.add('https://example.com/', 0)).toBe('queued');
    expect(frontier.add('https://www.example.com/#top', 1)).toBe('seen');
    expect(frontier.add('/a?utm_campaign=x', 1, 'https://example.com/')).toBe('queued');
    expect(frontier.add('https://example.com/a', 1)).toBe('seen');
    expect(frontier.add('https://elsewhere.example/', 1)).toBe('other_site');
    expect(frontier.add('https://example.com/deep', 4)).toBe('too_deep');
    expect(frontier.admitted).toBe(2);
    expect(frontier.next()!.url).toBe('https://example.com/');
    expect(frontier.next()!.url).toBe('https://example.com/a');
    expect(frontier.next()).toBeUndefined();
  });

  it('lets in no more pages than the page limit, whatever the site links to', () => {
    const frontier = new CrawlFrontier({ scope: scopeOf('https://example.com/'), pageLimit: 3 });
    const verdicts = Array.from({ length: 10 }, (_, i) =>
      frontier.add(`https://example.com/p${i}`, 1),
    );
    expect(verdicts.filter((v) => v === 'queued')).toHaveLength(3);
    expect(verdicts.slice(3).every((v) => v === 'full')).toBe(true);
  });

  it('takes pages in the order they were let in — breadth-first when links come at depth + 1', () => {
    const frontier = new CrawlFrontier({ scope: scopeOf('https://example.com/'), pageLimit: 10 });
    frontier.add('https://example.com/', 0);
    const root = frontier.next()!;
    frontier.add('/a', root.depth + 1, root.url);
    frontier.add('/b', root.depth + 1, root.url);
    const a = frontier.next()!;
    frontier.add('/a/deep', a.depth + 1, a.url);
    expect([frontier.next()!.url, frontier.next()!.url]).toEqual([
      'https://example.com/b',
      'https://example.com/a/deep',
    ]);
  });

  it('saves its pending pages as an array and resumes from them, done pages not again', () => {
    const options = { scope: scopeOf('https://example.com/'), pageLimit: 5 };
    const first = new CrawlFrontier(options);
    first.add('https://example.com/', 0);
    first.add('https://example.com/a', 1);
    first.add('https://example.com/b', 1);
    const done = first.next()!;
    const saved = JSON.parse(JSON.stringify(first.toJSON())) as unknown;
    expect(saved).toEqual([
      { url: 'https://example.com/a', depth: 1 },
      { url: 'https://example.com/b', depth: 1 },
    ]);

    const resumed = CrawlFrontier.restore(options, saved, [done.key]);
    expect(resumed.admitted).toBe(3);
    expect(resumed.add('https://example.com/', 0)).toBe('seen');
    expect(resumed.next()!.url).toBe('https://example.com/a');
    expect(resumed.pending).toBe(1);
  });

  it('re-checks a saved frontier instead of trusting it', () => {
    const options = { scope: scopeOf('https://example.com/', [], ['/b']), pageLimit: 5 };
    const resumed = CrawlFrontier.restore(options, [
      { url: 'https://example.com/a', depth: 1 },
      { url: 'https://example.com/b', depth: 1 },
      { url: 'http://169.254.169.254/latest/meta-data', depth: 0 },
      { url: 'https://example.com/c', depth: -1 },
      'https://example.com/d',
      null,
    ]);
    expect(resumed.toJSON()).toEqual([{ url: 'https://example.com/a', depth: 1 }]);
    expect(CrawlFrontier.restore(options, { not: 'an array' }).pending).toBe(0);
  });

  it('adopts an in-scope canonical as the identity, and spots a duplicate of a page it already has', () => {
    const frontier = new CrawlFrontier({ scope: scopeOf('https://example.com/'), pageLimit: 10 });
    frontier.add('https://example.com/bonus?ref=menu', 1);
    frontier.add('https://example.com/odeme', 1);
    const bonus = frontier.next()!;
    const adopted = frontier.adoptCanonical(bonus, '/bonus');
    expect(adopted).toEqual({
      page: expect.objectContaining({ url: 'https://example.com/bonus', depth: 1 }),
      duplicate: false,
    });
    expect(frontier.add('https://example.com/bonus', 1)).toBe('seen');
    // Adopting did not cost a second page against the limit.
    expect(frontier.admitted).toBe(2);

    const odeme = frontier.next()!;
    expect(frontier.adoptCanonical(odeme, 'https://example.com/bonus').duplicate).toBe(true);
  });

  it('ignores a canonical outside the scope or that is no URL', () => {
    const frontier = new CrawlFrontier({ scope: scopeOf('https://example.com/'), pageLimit: 10 });
    frontier.add('https://example.com/a', 0);
    const page = frontier.next()!;
    expect(frontier.adoptCanonical(page, 'https://elsewhere.example/a')).toEqual({
      page,
      duplicate: false,
    });
    expect(frontier.adoptCanonical(page, null)).toEqual({ page, duplicate: false });
    expect(frontier.adoptCanonical(page, 'javascript:void(0)')).toEqual({
      page,
      duplicate: false,
    });
  });
});
