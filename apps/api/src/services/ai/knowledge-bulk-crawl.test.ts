import { describe, expect, it, vi } from 'vitest';
import {
  BulkWebsiteCrawler,
  checkWebsiteUrl,
  type BulkCrawlLimits,
  type PageCrawler,
} from './knowledge-bulk-crawl.js';

/**
 * FR-MOD-06.3.2 (NFR-S7 · NFR-S8) — website rows inside a bulk CSV import.
 *
 * The negatives lead, and they are not the usual "bad input is rejected". One
 * request here can turn into as many outbound fetches as a spreadsheet has
 * rows, so the questions that matter are: does a refused URL reach the network
 * at all, does the answer say anything about what is behind that URL, and can a
 * file buy more fetches than the budget allows by making each one slow. Only
 * after those hold is "a public page is crawled" worth asserting.
 *
 * Every test injects the crawler, so "never fetched" is a call count rather
 * than an inference from a missing side effect.
 */

const LIMITS: BulkCrawlLimits = { maxWebsiteRows: 20, totalBudgetMs: 5_000 };

/** A crawler that answers instantly and records what it was asked for. */
function spyCrawler(text = 'Delivery takes three to five working days.') {
  return vi.fn<PageCrawler>(async (url: URL) => {
    void url;
    return { text };
  });
}

describe('bulk website rows — the SSRF boundary', () => {
  // The same class of target `lib/ssrf.test.ts` pins for the single-source
  // path. Repeated here because the question is different: not "does the guard
  // know this is private" but "does the loop actually ask it, every time".
  const BLOCKED = [
    ['loopback IP', 'http://127.0.0.1/'],
    ['loopback name', 'http://localhost/internal'],
    ['private 10/8', 'http://10.0.0.1/'],
    ['private 192.168', 'http://192.168.1.1/admin'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/'],
    ['unique-local IPv6', 'http://[fd00::1]/'],
    ['file scheme', 'file:///etc/passwd'],
    ['embedded credentials', 'http://user:pass@internal.example.com/'],
    ['not a URL at all', 'definitely not a url'],
    ['empty cell', ''],
  ] as const;

  for (const [label, url] of BLOCKED) {
    it(`refuses ${label} without reaching the crawler`, async () => {
      const crawler = spyCrawler();
      const outcome = await new BulkWebsiteCrawler(LIMITS, crawler).crawl(url);

      expect(outcome.ok).toBe(false);
      expect(outcome.ok === false && outcome.reason).toBe('url_refused');
      expect(crawler).not.toHaveBeenCalled();
    });
  }

  it('gives every refused URL the same answer, so the reply is not a probe', async () => {
    const crawler = spyCrawler();
    const messages = new Set<string>();
    for (const [, url] of BLOCKED) {
      const outcome = await new BulkWebsiteCrawler(LIMITS, crawler).crawl(url);
      if (outcome.ok) throw new Error(`${url} was not refused`);
      messages.add(outcome.message);
    }

    // One sentence for eleven different reasons: a caller cannot tell a
    // malformed URL from a loopback address from a metadata endpoint.
    expect(messages.size).toBe(1);
    expect(crawler).not.toHaveBeenCalled();
  });

  it('never names the target or the network it belongs to', async () => {
    const outcome = await new BulkWebsiteCrawler(LIMITS, spyCrawler()).crawl(
      'http://169.254.169.254/latest/meta-data/',
    );
    if (outcome.ok) throw new Error('expected a refusal');

    for (const leak of ['169.254', 'meta-data', 'private', 'internal', 'localhost', 'loopback']) {
      expect(outcome.message.toLowerCase()).not.toContain(leak);
    }
    // The reason is not lost, it is just not in the reply.
    expect(outcome.detail).not.toBe('');
  });

  it('checks a dry run’s URL without fetching it', () => {
    // A preview that crawled would be a free way to probe hosts repeatedly,
    // with nothing written to show for it.
    expect(checkWebsiteUrl('http://127.0.0.1/').ok).toBe(false);
    expect(checkWebsiteUrl('https://help.example.com/delivery')).toEqual({
      ok: true,
      url: 'https://help.example.com/delivery',
    });
  });
});

describe('bulk website rows — the amplification budget', () => {
  it('refuses a row once the shared budget is gone, without fetching', async () => {
    const crawler = spyCrawler();
    const spent = new BulkWebsiteCrawler({ ...LIMITS, totalBudgetMs: 0 }, crawler);

    const outcome = await spent.crawl('https://help.example.com/delivery');

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.reason).toBe('budget_exhausted');
    expect(crawler).not.toHaveBeenCalled();
  });

  it('stops waiting on a crawl that outlives the budget, and spends nothing after it', async () => {
    // A file cannot buy extra outbound requests by pointing at slow hosts: the
    // first row eats the whole budget and the second never reaches the network.
    const crawler = vi.fn<PageCrawler>(() => new Promise<{ text: string }>(() => {}));
    const crawlers = new BulkWebsiteCrawler({ ...LIMITS, totalBudgetMs: 30 }, crawler);

    const first = await crawlers.crawl('https://slow.example.com/a');
    expect(first.ok).toBe(false);
    expect(first.ok === false && first.reason).toBe('budget_exhausted');
    expect(crawler).toHaveBeenCalledTimes(1);

    const second = await crawlers.crawl('https://slow.example.com/b');
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.reason).toBe('budget_exhausted');
    expect(crawler).toHaveBeenCalledTimes(1);
  });

  it('reports a failed fetch as that row’s verdict and keeps the budget usable', async () => {
    const crawler = vi
      .fn<PageCrawler>()
      .mockRejectedValueOnce(new Error('ECONNREFUSED 93.184.216.34:443'))
      .mockResolvedValueOnce({ text: 'Returns are accepted within thirty days.' });
    const crawlers = new BulkWebsiteCrawler(LIMITS, crawler);

    const failed = await crawlers.crawl('https://down.example.com/');
    expect(failed.ok).toBe(false);
    expect(failed.ok === false && failed.reason).toBe('crawl_failed');
    // The transport error carries an address; it goes to the log, not the reply.
    expect(failed.ok === false && failed.message).not.toContain('93.184.216.34');
    expect(failed.ok === false && failed.detail).toContain('93.184.216.34');

    const next = await crawlers.crawl('https://help.example.com/returns');
    expect(next.ok).toBe(true);
  });

  it('refuses to run two crawls at once', async () => {
    // Sequential is what makes the budget mean anything — a caller reaching for
    // Promise.all would turn one request into N simultaneous connections.
    const crawler = vi.fn<PageCrawler>(
      () => new Promise<{ text: string }>((resolve) => setTimeout(() => resolve({ text: 'ok' }), 20)),
    );
    const crawlers = new BulkWebsiteCrawler(LIMITS, crawler);

    const first = crawlers.crawl('https://help.example.com/a');
    await expect(crawlers.crawl('https://help.example.com/b')).rejects.toThrow(/one at a time/);
    await first;
  });
});

describe('bulk website rows — a public page', () => {
  it('crawls it and returns the normalised URL with the page text', async () => {
    const crawler = spyCrawler('Standard delivery takes three to five working days.');
    const outcome = await new BulkWebsiteCrawler(LIMITS, crawler).crawl(
      'https://help.example.com/delivery',
    );

    expect(outcome).toEqual({
      ok: true,
      url: 'https://help.example.com/delivery',
      content: 'Standard delivery takes three to five working days.',
    });
    expect(crawler).toHaveBeenCalledTimes(1);
    expect(crawler.mock.calls[0]?.[0]).toBeInstanceOf(URL);
  });

  it('neutralises a formula lead in the crawled text before it is stored', async () => {
    // The page is not a CSV cell, but its text lands in a knowledge source the
    // 07.7 export can write back out as one.
    const outcome = await new BulkWebsiteCrawler(LIMITS, spyCrawler(`=cmd|' /C calc'!A0`)).crawl(
      'https://help.example.com/notes',
    );

    expect(outcome.ok && outcome.content).toBe(`'=cmd|' /C calc'!A0`);
  });

  it('crawls rows one after another, in the order it was given them', async () => {
    const seen: string[] = [];
    const crawler = vi.fn<PageCrawler>(async (url: URL) => {
      seen.push(url.pathname);
      return { text: `page ${url.pathname}` };
    });
    const crawlers = new BulkWebsiteCrawler(LIMITS, crawler);

    for (const path of ['/a', '/b', '/c']) {
      await crawlers.crawl(`https://help.example.com${path}`);
    }

    expect(seen).toEqual(['/a', '/b', '/c']);
  });

  it('leaves budget for the rows after a fast one', async () => {
    const crawlers = new BulkWebsiteCrawler(LIMITS, spyCrawler());
    await crawlers.crawl('https://help.example.com/delivery');
    expect(crawlers.remainingMs).toBeGreaterThan(0);
  });
});
