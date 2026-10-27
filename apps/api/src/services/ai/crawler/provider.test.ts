/**
 * Which fetcher a crawl uses (tm 312.3 · AI-17): `CRAWLER_PROVIDER` defaults to
 * the mock — no test or demo crawls with egress — and a production pilot on
 * the mock is told so at boot, never refused (owner, 2026-10-10).
 */
import { describe, expect, it } from 'vitest';
import { testEnv } from '../../../../test/helpers/fixtures.js';
import { createCrawlFetcher, crawlerProviderWarning } from './provider.js';

describe('CRAWLER_PROVIDER (AI-17)', () => {
  it('is the mock unless a deployment names the real crawler', () => {
    expect(testEnv().CRAWLER_PROVIDER).toBe('mock');
    expect(testEnv({ CRAWLER_PROVIDER: 'http' }).CRAWLER_PROVIDER).toBe('http');
    expect(() => testEnv({ CRAWLER_PROVIDER: 'curl' })).toThrow(/CRAWLER_PROVIDER/);
  });

  it('answers from the mock without a socket: every page the same deterministic text', async () => {
    const result = await createCrawlFetcher('mock').fetch({
      url: 'https://casino.example.com/bonus',
      purpose: 'page',
    });
    expect(result).toMatchObject({ kind: 'ok', status: 200 });
  });

  it('warns a production pilot crawling with the mock, and nobody else', () => {
    const pilot = { NODE_ENV: 'production', PILOT_MODE: true, CRAWLER_PROVIDER: 'mock' } as const;
    expect(crawlerProviderWarning(pilot)).toMatch(/CRAWLER_PROVIDER=http/);
    expect(crawlerProviderWarning({ ...pilot, CRAWLER_PROVIDER: 'http' })).toBeNull();
    expect(crawlerProviderWarning({ ...pilot, PILOT_MODE: false })).toBeNull();
    expect(crawlerProviderWarning({ ...pilot, NODE_ENV: 'development' })).toBeNull();
  });
});
