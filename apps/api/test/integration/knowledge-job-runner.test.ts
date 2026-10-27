/**
 * The knowledge job runner (tm 312.3 · SiyahTuş analysis AI-17): a website
 * source is crawled in the background, page by page, from the queue — never in
 * the request that asked for it.
 *
 * Every site here is a mock (`createMockCrawlFetcher`, `CRAWLER_PROVIDER=mock`'s
 * fetcher with a test's answers) except the one that proves the SSRF rule,
 * which is the real fetcher with its resolver stubbed: no test opens a socket
 * to anything. The fetcher records every URL it was asked for, which is how
 * "nothing outside the scope was requested" is measured rather than assumed.
 *
 * What has to hold:
 *
 *   - a sitemap's in-scope pages are crawled and nothing else is asked for;
 *   - a host that resolves to a private address is never connected to;
 *   - robots.txt is obeyed before a page is fetched;
 *   - a re-crawl embeds only what changed, and two 404s remove a page;
 *   - the day's AI allowance parks a crawl until midnight, and it goes on from
 *     where it stopped;
 *   - one job runs per workspace, and no job is taken by two runners;
 *   - the four routes say what the crawl did, to their own workspace only.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AiDailyCapError, nextUtcMidnight } from '../../src/services/ai/ai-daily-budget.js';
import type { CrawlFetcher } from '../../src/services/ai/crawler/fetcher.js';
import { createHttpCrawlFetcher } from '../../src/services/ai/crawler/http-fetcher.js';
import { CRAWL_NO_PAGE } from '../../src/services/ai/crawler/job-runner.js';
import { claimKnowledgeJob } from '../../src/services/ai/crawler/jobs.js';
import {
  createMockCrawlFetcher,
  type MockSiteResponse,
} from '../../src/services/ai/crawler/mock-fetcher.js';
import { FakeEmbeddingProvider } from '../helpers/fake-embedding-provider.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

interface SourceView {
  id: string;
  status: string;
  chunk_count: number;
  page_count: number;
  job_id: string | null;
}

interface PageView {
  url: string;
  status: string;
  error: string | null;
  chunk_count: number;
  changed_at: string | null;
}

interface JobView {
  id: string;
  source_id: string;
  kind: string;
  status: string;
  pages: Record<
    'discovered' | 'done' | 'ok' | 'unchanged' | 'skipped' | 'failed' | 'removed',
    number
  >;
  available_at: string;
}

/** A page a reader would call one: a title, a paragraph of text, links. */
function html(title: string, text: string, links: string[] = []): MockSiteResponse {
  const anchors = links.map((href) => `<li><a href="${href}">${href}</a></li>`).join('');
  return {
    status: 200,
    body: `<!doctype html><html lang="tr"><head><title>${title}</title></head><body><main>
<h1>${title}</h1><p>${text} This paragraph is long enough to be a page a person reads rather than an empty shell drawn by scripts.</p>
<ul>${anchors}</ul></main></body></html>`,
  };
}

function sitemap(urls: string[]): MockSiteResponse {
  return {
    status: 200,
    contentType: 'application/xml',
    body: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
      .map((url) => `<url><loc>${url}</loc></url>`)
      .join('')}</urlset>`,
  };
}

const NOT_FOUND: MockSiteResponse = { status: 404, contentType: 'text/plain', body: 'Not found' };

describe('knowledge job runner (AI-17 · tm 312.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentA: string;
  let agentB: string;

  /** What the mock site answers, by URL; anything else is a 404. */
  let site = new Map<string, MockSiteResponse>();
  /** Called as each URL is asked for — a test's hook into the crawl's middle. */
  let onRequest: (url: URL) => void = () => {};
  const mock = createMockCrawlFetcher((url) => {
    onRequest(url);
    return site.get(url.href) ?? NOT_FOUND;
  });
  /** The server's fetcher: the mock, unless a test swaps in the real one. */
  let fetcher: CrawlFetcher = mock;
  const embeddings = new FakeEmbeddingProvider();

  /** A fresh host per test: robots.txt is cached a day per origin. */
  let hostCount = 0;
  const newHost = (name: string): string => `https://${name}-${++hostCount}.example.com`;

  const auth = async (tenant: 'a' | 'b') => ({
    authorization: `Bearer ${await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    })}`,
  });

  async function addWebsite(
    url: string,
    settings: Record<string, unknown> = {},
    tenant: 'a' | 'b' = 'a',
  ): Promise<SourceView> {
    const response = await server.post(
      '/knowledge-sources',
      {
        ai_agent_id: tenant === 'a' ? agentA : agentB,
        name: 'Help centre',
        type: 'website',
        source_url: url,
        ...settings,
      },
      await auth(tenant),
    );
    expect(response.statusCode).toBe(201);
    return response.json() as SourceView;
  }

  async function source(id: string, tenant: 'a' | 'b' = 'a'): Promise<SourceView> {
    const list = (await server.get('/knowledge-sources', await auth(tenant))).json() as {
      items: SourceView[];
    };
    return list.items.find((item) => item.id === id)!;
  }

  async function pages(id: string, tenant: 'a' | 'b' = 'a'): Promise<PageView[]> {
    const response = await server.get(`/knowledge-sources/${id}/pages`, await auth(tenant));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: PageView[] }).items;
  }

  async function lastJob(sourceId: string): Promise<JobView> {
    const job = await owner.knowledgeJob.findFirstOrThrow({
      where: { sourceId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    const response = await server.get(`/knowledge-jobs/${job.id}`, await auth('a'));
    expect(response.statusCode).toBe(200);
    return response.json() as JobView;
  }

  const pageAt = (list: PageView[], path: string): PageView =>
    list.find((page) => new URL(page.url).pathname.replace(/\/$/, '') === path.replace(/\/$/, ''))!;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    server = await startTestServer(
      {},
      { crawlFetcher: { fetch: (request) => fetcher.fetch(request) }, embeddings },
    );
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    site = new Map();
    onRequest = () => {};
    fetcher = mock;
    mock.requests.length = 0;
    embeddings.failWith(undefined);
    const make = async (licenseId: bigint) =>
      (
        await owner.aiAgent.create({
          data: { licenseId, kind: 'ai_agent', name: 'Ada' },
          select: { id: true },
        })
      ).id;
    agentA = await make(fx.a.licenseId);
    agentB = await make(fx.b.licenseId);
  });

  it('crawls the 50 pages a sitemap lists and asks for nothing outside the scope (FR-MOD-06.3.2)', async () => {
    const host = newHost('docs');
    const inScope = Array.from({ length: 50 }, (_, i) => `${host}/help/page-${i + 1}`);
    const outOfScope = [`${host}/blog/launch`, `https://elsewhere.example.com/help/page-1`];
    site.set(`${host}/sitemap.xml`, sitemap([...inScope, ...outOfScope]));
    for (const [i, url] of inScope.entries())
      site.set(url, html(`Page ${i + 1}`, `Answer ${i + 1}.`));
    for (const url of outOfScope) site.set(url, html('Not ours', 'Never to be read.'));

    const created = await addWebsite(`${host}/help/`, { crawl_scope: 'sitemap' });

    expect(created).toMatchObject({ status: 'crawling', chunk_count: 0 });
    const crawled = await pages(created.id);
    expect(crawled).toHaveLength(50);
    expect(crawled.every((page) => page.status === 'ok' && page.chunk_count > 0)).toBe(true);
    expect(await source(created.id)).toMatchObject({
      status: 'ready',
      page_count: 50,
      job_id: null,
    });
    expect((await lastJob(created.id)).pages).toMatchObject({ discovered: 50, done: 50, ok: 50 });

    // Every request was the site's robots.txt, its sitemap or a page under /help/.
    for (const requested of mock.requests) {
      const url = new URL(requested);
      expect(url.origin).toBe(host);
      expect(
        ['/robots.txt', '/sitemap.xml'].includes(url.pathname) || url.pathname.startsWith('/help/'),
      ).toBe(true);
    }
    expect(mock.requests.filter((url) => url.includes('/help/page-'))).toHaveLength(50);
  });

  it('never connects to a host that resolves to a private address; the page is an error (NFR-S7)', async () => {
    const asked: string[] = [];
    fetcher = createHttpCrawlFetcher({
      resolver: async (hostname) => {
        asked.push(hostname);
        return ['10.0.0.5'];
      },
    });
    const host = newHost('intranet');

    const created = await addWebsite(`${host}/`);

    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((name) => name === new URL(host).hostname)).toBe(true);
    const [page] = await pages(created.id);
    expect(page).toMatchObject({ status: 'error', error: 'ssrf_refused', chunk_count: 0 });
    expect(await source(created.id)).toMatchObject({ status: 'failed', chunk_count: 0 });
    expect(
      (
        await owner.knowledgeSource.findUniqueOrThrow({
          where: { id: created.id },
          select: { lastRefreshError: true },
        })
      ).lastRefreshError,
    ).toBe(CRAWL_NO_PAGE);
  });

  it('follows links without a sitemap and never fetches what robots.txt forbids', async () => {
    const host = newHost('links');
    site.set(`${host}/robots.txt`, {
      status: 200,
      contentType: 'text/plain',
      body: 'User-agent: *\nDisallow: /help/private\n',
    });
    site.set(
      `${host}/help`,
      html('Help', 'Start here.', [
        '/help/a',
        '/help/private/x',
        '/blog/b',
        'https://elsewhere.example.com/help/z',
      ]),
    );
    site.set(`${host}/help/a`, html('A', 'Deposits arrive within minutes.'));
    site.set(`${host}/help/private/x`, html('Private', 'Staff only.'));

    const created = await addWebsite(`${host}/help`, { crawl_scope: 'all' });

    const crawled = await pages(created.id);
    expect(pageAt(crawled, '/help').status).toBe('ok');
    expect(pageAt(crawled, '/help/a').status).toBe('ok');
    expect(pageAt(crawled, '/help/private/x')).toMatchObject({ status: 'robots_disallowed' });
    expect(mock.requests).not.toContain(`${host}/help/private/x`);
    expect(mock.requests.some((url) => url.includes('/blog/') || url.includes('elsewhere'))).toBe(
      false,
    );
    // A page robots.txt holds back does not make the source partial: it was never the site's to give.
    expect(await source(created.id)).toMatchObject({ status: 'ready', page_count: 2 });
  });

  it('embeds only the page that changed when the site is crawled again', async () => {
    const host = newHost('refresh');
    const urls = [1, 2, 3].map((n) => `${host}/help/p${n}`);
    site.set(`${host}/sitemap.xml`, sitemap(urls));
    for (const [i, url] of urls.entries()) site.set(url, html(`P${i + 1}`, `Original ${i + 1}.`));
    const created = await addWebsite(`${host}/help/`, { crawl_scope: 'sitemap' });
    const before = embeddings.calls.length;
    const changedBefore = pageAt(await pages(created.id), '/help/p2').changed_at;

    site.set(urls[1]!, html('P2', 'Withdrawals now take one business day.'));
    const queued = await server.post(
      `/knowledge-sources/${created.id}/crawl`,
      undefined,
      await auth('a'),
    );

    expect(queued.statusCode).toBe(202);
    expect(queued.json()).toMatchObject({ source_id: created.id, kind: 'crawl' });
    expect(embeddings.calls.length - before).toBe(1);
    expect(embeddings.calls.at(-1)!.join(' ')).toContain('Withdrawals now take one business day.');
    const after = await pages(created.id);
    expect(pageAt(after, '/help/p1').status).toBe('unchanged');
    expect(pageAt(after, '/help/p2').status).toBe('ok');
    expect(pageAt(after, '/help/p3').status).toBe('unchanged');
    expect(pageAt(after, '/help/p2').changed_at).not.toBe(changedBefore);
    expect((await lastJob(created.id)).pages).toMatchObject({ ok: 1, unchanged: 2 });
    // The old text of the changed page answers no more; the others still do.
    const texts = (
      await owner.knowledgeChunk.findMany({
        where: { sourceId: created.id },
        select: { chunkText: true },
      })
    )
      .map((chunk) => chunk.chunkText)
      .join(' ');
    expect(texts).not.toContain('Original 2.');
    expect(texts).toContain('Original 1.');
    expect(texts).toContain('Withdrawals now take one business day.');
  });

  it('keeps a page through one 404 and removes it, chunks and all, on the second', async () => {
    const host = newHost('gone');
    site.set(`${host}/bonus`, html('Bonus', 'The welcome bonus is 100%.'));
    const created = await addWebsite(`${host}/bonus`);
    const chunks = () => owner.knowledgeChunk.count({ where: { sourceId: created.id } });
    const indexed = await chunks();
    expect(indexed).toBeGreaterThan(0);

    site.delete(`${host}/bonus`);
    await server.post(`/knowledge-sources/${created.id}/crawl`, undefined, await auth('a'));
    expect((await pages(created.id))[0]).toMatchObject({ status: 'error', error: 'http_404' });
    expect(await chunks()).toBe(indexed);

    await server.post(`/knowledge-sources/${created.id}/crawl`, undefined, await auth('a'));
    expect((await pages(created.id))[0]).toMatchObject({ status: 'removed', chunk_count: 0 });
    expect(await chunks()).toBe(0);
    expect(await source(created.id)).toMatchObject({ status: 'failed', chunk_count: 0 });
  });

  it("waits for the day's AI allowance mid-crawl and goes on after midnight from where it stopped", async () => {
    const host = newHost('budget');
    const urls = [1, 2, 3, 4].map((n) => `${host}/help/p${n}`);
    site.set(`${host}/sitemap.xml`, sitemap(urls));
    for (const [i, url] of urls.entries()) site.set(url, html(`P${i + 1}`, `Text ${i + 1}.`));
    // The allowance runs out as the third page is read.
    let capped = false;
    onRequest = (url) => {
      if (!capped && url.href === urls[2]) {
        capped = true;
        embeddings.failWith(new AiDailyCapError('embedding', 'workspace', 60));
      }
    };

    const created = await addWebsite(`${host}/help/`, { crawl_scope: 'sitemap' });

    const waiting = await lastJob(created.id);
    expect(waiting.status).toBe('waiting_budget');
    expect(waiting.pages).toMatchObject({ ok: 2, done: 2 });
    expect(new Date(waiting.available_at).getTime()).toBe(nextUtcMidnight(new Date()).getTime());
    // What was indexed answers meanwhile; the source says its crawl is not over.
    expect(await source(created.id)).toMatchObject({ status: 'crawling', job_id: waiting.id });
    expect(await owner.knowledgeChunk.count({ where: { sourceId: created.id } })).toBeGreaterThan(
      0,
    );

    // Past midnight, with room again: the job goes on from the third page.
    embeddings.failWith(undefined);
    await owner.knowledgeJob.update({
      where: { id: waiting.id },
      data: { availableAt: new Date(Date.now() - 1000) },
    });
    mock.requests.length = 0;
    server.app.knowledgeJobs.wake();
    await server.app.knowledgeJobs.idle();

    const done = await lastJob(created.id);
    expect(done).toMatchObject({ id: waiting.id, status: 'done' });
    expect(done.pages).toMatchObject({ ok: 4, done: 4 });
    expect(mock.requests).toEqual([urls[2], urls[3]]);
    expect(await source(created.id)).toMatchObject({ status: 'ready', page_count: 4 });
  });

  it('runs one job per workspace and never hands one job to two runners', async () => {
    const hostA = newHost('queue-a');
    const hostB = newHost('queue-b');
    for (const url of [`${hostA}/one`, `${hostA}/two`, `${hostB}/three`]) {
      site.set(url, html('Page', 'Some text.'));
    }
    const sources = [
      await addWebsite(`${hostA}/one`),
      await addWebsite(`${hostA}/two`),
      await addWebsite(`${hostB}/three`, {}, 'b'),
    ];
    // Three refreshes queued at once, as a sweep would leave them.
    await owner.knowledgeJob.createMany({
      data: sources.map((s, i) => ({
        licenseId: i < 2 ? fx.a.licenseId : fx.b.licenseId,
        organizationId: i < 2 ? fx.a.organizationId : fx.b.organizationId,
        sourceId: s.id,
        kind: 'refresh',
      })),
    });

    // Four runners on four connections, claiming at the same moment.
    const runners = Array.from({ length: 4 }, () => new PrismaClient({ datasourceUrl: APP_URL }));
    try {
      const claims = (
        await Promise.all(
          runners.map((db) => claimKnowledgeJob(db, { leaseMs: 60_000, maxAttempts: 3 })),
        )
      ).filter((claim) => claim !== null);
      expect(new Set(claims.map((claim) => claim.id)).size).toBe(claims.length);
      const perWorkspace = claims.map((claim) => String(claim.context.licenseId)).sort();
      expect(perWorkspace).toEqual([String(fx.a.licenseId), String(fx.b.licenseId)].sort());
      // Workspace A's second job waits for its first.
      expect(await claimKnowledgeJob(runners[0]!, { leaseMs: 60_000, maxAttempts: 3 })).toBeNull();
      expect(
        await owner.knowledgeJob.count({ where: { status: 'running', licenseId: fx.a.licenseId } }),
      ).toBe(1);
    } finally {
      await Promise.all(runners.map((db) => db.$disconnect()));
    }
  });

  describe('the routes', () => {
    it('queues a crawl with 202, refuses a second while one is under way, and only for a website', async () => {
      const host = newHost('routes');
      site.set(`${host}/faq`, html('FAQ', 'Answers.'));
      const created = await addWebsite(`${host}/faq`);
      const headers = await auth('a');
      const planted = await owner.knowledgeJob.create({
        data: {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          sourceId: created.id,
          kind: 'refresh',
          availableAt: new Date(Date.now() + 3_600_000),
        },
        select: { id: true },
      });

      const second = await server.post(
        `/knowledge-sources/${created.id}/crawl`,
        undefined,
        headers,
      );
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        error: { type: 'knowledge_job_in_progress', details: { job_id: planted.id } },
      });

      const article = await server.post(
        '/knowledge-sources',
        {
          ai_agent_id: agentA,
          name: 'Note',
          type: 'article',
          content: 'Opening hours are 9 to 5.',
        },
        headers,
      );
      const refused = await server.post(
        `/knowledge-sources/${(article.json() as SourceView).id}/crawl`,
        undefined,
        headers,
      );
      expect(refused.statusCode).toBe(400);
      expect(refused.json()).toMatchObject({
        error: { details: { reason: 'knowledge_source_not_website' } },
      });
    });

    it('cancels a job under way, settles its source, and answers an ended one as it is', async () => {
      const host = newHost('cancel');
      site.set(`${host}/faq`, html('FAQ', 'Answers.'));
      const created = await addWebsite(`${host}/faq`);
      const headers = await auth('a');
      const planted = await owner.knowledgeJob.create({
        data: {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          sourceId: created.id,
          kind: 'crawl',
          availableAt: new Date(Date.now() + 3_600_000),
        },
        select: { id: true },
      });
      await owner.knowledgeSource.update({
        where: { id: created.id },
        data: { status: 'crawling' },
      });

      const cancelled = await server.post(
        `/knowledge-jobs/${planted.id}/cancel`,
        undefined,
        headers,
      );
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json()).toMatchObject({ id: planted.id, status: 'cancelled' });
      // The page the first crawl indexed still answers.
      expect(await source(created.id)).toMatchObject({ status: 'ready', job_id: null });

      const again = await server.post(`/knowledge-jobs/${planted.id}/cancel`, undefined, headers);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ status: 'cancelled' });
    });

    it("never shows one workspace another's pages or jobs (NFR-S4)", async () => {
      const host = newHost('tenant');
      site.set(`${host}/faq`, html('FAQ', 'Answers.'));
      const created = await addWebsite(`${host}/faq`);
      const job = await owner.knowledgeJob.findFirstOrThrow({
        where: { sourceId: created.id },
        select: { id: true },
      });
      const other = await auth('b');

      expect((await server.get(`/knowledge-sources/${created.id}/pages`, other)).statusCode).toBe(
        404,
      );
      expect((await server.get(`/knowledge-jobs/${job.id}`, other)).statusCode).toBe(404);
      expect(
        (await server.post(`/knowledge-jobs/${job.id}/cancel`, undefined, other)).statusCode,
      ).toBe(404);
      expect(
        (await server.post(`/knowledge-sources/${created.id}/crawl`, undefined, other)).statusCode,
      ).toBe(404);
      // The owner's own view lists the page, filtered by status.
      const ok = await server.get(
        `/knowledge-sources/${created.id}/pages?status=ok`,
        await auth('a'),
      );
      expect((ok.json() as { items: PageView[] }).items).toHaveLength(1);
      const none = await server.get(
        `/knowledge-sources/${created.id}/pages?status=removed`,
        await auth('a'),
      );
      expect((none.json() as { items: PageView[] }).items).toHaveLength(0);
    });
  });
});
