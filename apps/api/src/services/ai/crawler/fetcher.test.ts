/**
 * The crawl fetcher seam (tm 312.2 · AI-17): the helpers both fetchers share,
 * the network-free one every test crawls through, and which one a deployment
 * gets.
 */
import { describe, expect, it } from 'vitest';
import {
  CRAWLER_PRODUCT_TOKEN,
  CRAWLER_USER_AGENT,
  detectBotWall,
  isHtmlContentType,
  mediaType,
  parseRetryAfter,
} from './fetcher.js';
import { createMockCrawlFetcher } from './mock-fetcher.js';
import { createCrawlFetcher, crawlerProviderWarning } from './provider.js';

describe('crawl fetcher helpers (FR-MOD-06.3.2)', () => {
  it('names the crawler by the token robots.txt addresses it with', () => {
    expect(CRAWLER_USER_AGENT).toContain(`${CRAWLER_PRODUCT_TOKEN}/1.0`);
  });

  it('reads a Retry-After in seconds or as a date', () => {
    const now = Date.parse('2026-10-27T12:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120_000);
    expect(parseRetryAfter(' 0 ', now)).toBe(0);
    expect(parseRetryAfter('Tue, 27 Oct 2026 12:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('Tue, 27 Oct 2026 11:00:00 GMT', now)).toBe(0);
    expect(parseRetryAfter('later', now)).toBeNull();
    expect(parseRetryAfter(undefined, now)).toBeNull();
  });

  it('takes HTML, XHTML and no Content-Type as a page, and nothing else', () => {
    expect(isHtmlContentType('text/html; charset=windows-1254')).toBe(true);
    expect(isHtmlContentType('application/xhtml+xml')).toBe(true);
    expect(isHtmlContentType(null)).toBe(true);
    expect(isHtmlContentType('application/pdf')).toBe(false);
    expect(isHtmlContentType('image/png')).toBe(false);
    expect(mediaType(' Text/HTML ; charset=utf-8')).toBe('text/html');
  });

  it('knows a bot wall by its service’s marks on a refusal', () => {
    const wall = (status: number, headers: Record<string, string>, sample = '') =>
      detectBotWall({ status, headers, sample });
    expect(wall(200, { 'cf-mitigated': 'challenge' })).toBe(true);
    expect(wall(403, { server: 'cloudflare' }, '<div id="cf-chl-widget">')).toBe(true);
    expect(wall(403, { 'x-datadome': '1' })).toBe(true);
    expect(wall(403, {}, '<script src="https://geo.captcha-delivery.com/x.js">')).toBe(true);
    expect(wall(503, {}, 'var _Incapsula_Resource')).toBe(true);
    expect(wall(429, {}, '<div id="px-captcha">')).toBe(true);
    expect(wall(403, { 'x-sucuri-id': '1' })).toBe(true);
    expect(wall(403, { server: 'AkamaiGHost' }, '<h1>Access Denied</h1>')).toBe(true);
    expect(wall(403, {}, '<div class="g-recaptcha">')).toBe(true);
  });

  it('does not call an ordinary page, or an ordinary refusal, a wall', () => {
    const wall = (status: number, headers: Record<string, string>, sample = '') =>
      detectBotWall({ status, headers, sample });
    // Cloudflare injects its challenge script into ordinary pages too.
    expect(
      wall(
        200,
        { server: 'cloudflare' },
        '<title>Bonuslar</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js">',
      ),
    ).toBe(false);
    expect(wall(200, {}, '<title>Just a moment...</title>')).toBe(true);
    expect(wall(403, {}, '<h1>Forbidden</h1>')).toBe(false);
    expect(wall(404, {}, 'captcha')).toBe(false);
    expect(wall(503, { 'retry-after': '10' }, 'Maintenance')).toBe(false);
  });
});

describe('mock crawl fetcher — a site with no network (FR-MOD-06.3.2)', () => {
  it('answers like a small site: no robots.txt, no sitemap, the deterministic page elsewhere', async () => {
    const fetcher = createMockCrawlFetcher();
    expect(
      await fetcher.fetch({ url: 'https://example.com/robots.txt', purpose: 'robots' }),
    ).toMatchObject({ kind: 'http_error', status: 404 });
    expect(
      await fetcher.fetch({ url: 'https://example.com/sitemap.xml', purpose: 'sitemap' }),
    ).toMatchObject({ kind: 'http_error', status: 404 });
    const page = await fetcher.fetch({ url: 'https://example.com/teslimat', purpose: 'page' });
    expect(page.kind).toBe('ok');
    expect(page.kind === 'ok' && page.body.toString()).toContain('<h1>teslimat</h1>');
    expect(fetcher.requests).toEqual([
      'https://example.com/robots.txt',
      'https://example.com/sitemap.xml',
      'https://example.com/teslimat',
    ]);
  });

  it('refuses an internal target on every hop, and an out-of-scope redirect before asking for it', async () => {
    const fetcher = createMockCrawlFetcher((url) => {
      if (url.pathname === '/to-internal') return { status: 302, location: 'http://10.0.0.1/' };
      if (url.pathname === '/to-other') return { status: 302, location: 'https://other.example/' };
      return undefined;
    });
    expect(await fetcher.fetch({ url: 'http://169.254.169.254/', purpose: 'page' })).toMatchObject({
      kind: 'failed',
      error: 'ssrf_refused',
    });
    expect(
      await fetcher.fetch({ url: 'https://example.com/to-internal', purpose: 'page' }),
    ).toMatchObject({ kind: 'failed', error: 'ssrf_refused' });
    expect(
      await fetcher.fetch({
        url: 'https://example.com/to-other',
        purpose: 'page',
        allowRedirect: (url) => url.hostname === 'example.com',
      }),
    ).toMatchObject({ kind: 'failed', error: 'redirect_out_of_scope' });
    expect(fetcher.requests).toEqual([
      'https://example.com/to-internal',
      'https://example.com/to-other',
    ]);
  });

  it('applies the ceiling, the HTML check and the bot-wall check like the real one', async () => {
    const fetcher = createMockCrawlFetcher((url) => {
      if (url.pathname === '/big') return { status: 200, body: 'x'.repeat(100) };
      if (url.pathname === '/pdf')
        return { status: 200, contentType: 'application/pdf', body: '%PDF' };
      if (url.pathname === '/wall')
        return { status: 403, headers: { 'cf-mitigated': 'challenge' } };
      if (url.pathname === '/loop') return { status: 301, location: '/loop' };
      return undefined;
    });
    expect(
      await fetcher.fetch({ url: 'https://example.com/big', purpose: 'page', maxBytes: 10 }),
    ).toMatchObject({ kind: 'failed', error: 'too_large' });
    expect(
      await fetcher.fetch({
        url: 'https://example.com/big',
        purpose: 'sitemap',
        maxBytes: 10,
        truncate: true,
      }),
    ).toMatchObject({ kind: 'ok', truncated: true, bytes: 10 });
    expect(await fetcher.fetch({ url: 'https://example.com/pdf', purpose: 'page' })).toMatchObject({
      kind: 'failed',
      error: 'not_html',
    });
    expect(await fetcher.fetch({ url: 'https://example.com/wall', purpose: 'page' })).toMatchObject(
      { kind: 'blocked', status: 403 },
    );
    expect(await fetcher.fetch({ url: 'https://example.com/loop', purpose: 'page' })).toMatchObject(
      { kind: 'failed', error: 'redirect_limit' },
    );
  });
});

describe('crawler provider — mock by default, a warning where it matters (FR-MOD-06.3.2)', () => {
  it('gives the mock unless http is asked for', async () => {
    const mock = createCrawlFetcher('mock');
    const page = await mock.fetch({ url: 'https://example.com/', purpose: 'page' });
    expect(page.kind).toBe('ok');
    expect(createCrawlFetcher('http')).not.toHaveProperty('requests');
  });

  it('warns — never refuses — when the pilot crawls with the mock in production', () => {
    const env = { NODE_ENV: 'production', PILOT_MODE: true, CRAWLER_PROVIDER: 'mock' as const };
    expect(crawlerProviderWarning(env)).toMatch(/CRAWLER_PROVIDER is mock under PILOT_MODE=true/);
    expect(crawlerProviderWarning({ ...env, CRAWLER_PROVIDER: 'http' })).toBeNull();
    expect(crawlerProviderWarning({ ...env, PILOT_MODE: false })).toBeNull();
    expect(crawlerProviderWarning({ ...env, NODE_ENV: 'development' })).toBeNull();
  });
});
