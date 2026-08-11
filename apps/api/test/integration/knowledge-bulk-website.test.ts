/**
 * Website rows inside a bulk CSV import (FR-MOD-06.3.2 · NFR-S7 · NFR-S8).
 *
 * `knowledge-crawl.test.ts` pins the SSRF boundary for one URL per request.
 * This is the same boundary after it has been put in a loop, which is a
 * different risk: one authenticated call now decides how many outbound requests
 * the server makes and where they go. So the negatives lead and they ask three
 * questions the single-source suite cannot.
 *
 * Does the guard actually run on *every* row, or only until the first one
 * passes? Nothing here reaches a fetcher, so a blocked row must leave no source
 * and no chunk — the mock fetcher answers any URL it is handed, which is what
 * makes "no source" proof that it was never handed one.
 *
 * Can a file buy more outbound requests than the budget allows? The website-row
 * ceiling is separate from, and far below, the 200-row ceiling on writes, and
 * exceeding it refuses the request whole rather than crawling the first twenty.
 *
 * And is the crawl held inside a database transaction? Rows written in one
 * transaction share an identical `created_at` (Postgres freezes `now()` per
 * transaction); rows written in their own do not. That is the assertion at the
 * bottom of this file.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface RowResult {
  line: number;
  name: string | null;
  type: string | null;
  status: 'imported' | 'skipped';
  id: string | null;
  chunk_count: number | null;
  error: string | null;
}

interface BulkResult {
  imported: number;
  failed: number;
  dry_run: boolean;
  results: RowResult[];
}

const HEADER = 'name,type,content,source_url';

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

/** A `website` row: everything but the URL is fixed, since only the URL is on trial. */
function websiteRow(name: string, url: string): string {
  return `${name},website,,${url}`;
}

describe('bulk knowledge import — website rows', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentIdA: string;
  let agentIdB: string;

  async function writeHeaders(tenant: 'a' | 'b'): Promise<Record<string, string>> {
    return {
      authorization: `Bearer ${await grantToken(owner, {
        licenseId: fx[tenant].licenseId,
        organizationId: fx[tenant].organizationId,
        ownerId: fx[tenant].ownerAccountId,
        scopes: ['agents-bot--all:rw'],
      })}`,
    };
  }

  function sourceCount(tenant: 'a' | 'b'): Promise<number> {
    return owner.knowledgeSource.count({ where: { licenseId: fx[tenant].licenseId } });
  }

  function chunkCount(tenant: 'a' | 'b'): Promise<number> {
    return owner.knowledgeChunk.count({ where: { licenseId: fx[tenant].licenseId } });
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const [a, b] = await Promise.all([
      owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      }),
      owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, kind: 'ai_agent', name: 'Bea' },
        select: { id: true },
      }),
    ]);
    agentIdA = a.id;
    agentIdB = b.id;
  });

  // --- Negative: the guard runs on every row ---------------------------------

  const BLOCKED = [
    ['loopback IP', 'http://127.0.0.1/'],
    ['loopback name', 'http://localhost/internal'],
    ['private 10/8', 'http://10.0.0.1/'],
    ['private 192.168', 'http://192.168.0.1/admin'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/'],
    ['file scheme', 'file:///etc/passwd'],
    ['not a URL', 'definitely not a url'],
  ] as const;

  it('refuses every blocked target in one file and fetches none of them', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdA,
        csv: csv(...BLOCKED.map(([label, url], i) => websiteRow(`Probe ${i} ${label}`, url))),
      },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(200);
    const body = response.json() as BulkResult;
    expect(body).toMatchObject({ imported: 0, failed: BLOCKED.length });
    expect(body.results.every((row) => row.status === 'skipped')).toBe(true);

    // The mock fetcher answers *any* URL it is given, so a row that had reached
    // it would have produced a source with chunks. Neither exists.
    expect(await sourceCount('a')).toBe(0);
    expect(await chunkCount('a')).toBe(0);
  });

  it('answers every refused row identically, so the reply is not a network map', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdA,
        csv: csv(
          websiteRow('Metadata', 'http://169.254.169.254/latest/meta-data/'),
          websiteRow('Nonsense', 'definitely not a url'),
        ),
      },
      await writeHeaders('a'),
    );

    const body = response.json() as BulkResult;
    const messages = new Set(body.results.map((row) => row.error));
    expect(messages.size).toBe(1);

    const message = [...messages][0] ?? '';
    for (const leak of ['169.254', 'meta-data', 'private', 'internal', 'localhost']) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });

  // --- Negative: the amplification ceiling -----------------------------------

  it('refuses a file over the website-row ceiling without fetching anything', async () => {
    // Well under the 200-row ceiling on writes: fetches get their own, smaller
    // budget, because they are a different kind of cost.
    const rows = Array.from({ length: 21 }, (_, i) =>
      websiteRow(`Page ${i}`, `https://help.example.com/page-${i}`),
    );

    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: csv(...rows) },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
    expect(response.json().error.message).toMatch(/at most 20/);
    // Not "the first twenty were crawled and then we stopped".
    expect(await sourceCount('a')).toBe(0);
  });

  it('applies the ceiling to a dry run too, so the preview shows the same refusal', async () => {
    const rows = Array.from({ length: 21 }, (_, i) =>
      websiteRow(`Page ${i}`, `https://help.example.com/page-${i}`),
    );

    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: csv(...rows), dry_run: true },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
  });

  // --- Negative: the tenant boundary still holds for a crawled row -----------

  it("will not crawl a website row into another tenant's agent", async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdB,
        csv: csv(websiteRow('Help site', 'https://help.example.com/delivery')),
      },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
    expect(await sourceCount('a')).toBe(0);
    expect(await sourceCount('b')).toBe(0);
  });

  // --- Positive: a blocked row does not stop the file ------------------------

  it('imports the public rows and skips the blocked one, by line', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdA,
        csv: csv(
          websiteRow('Delivery', 'https://help.example.com/delivery'),
          websiteRow('Metadata', 'http://169.254.169.254/latest/meta-data/'),
          websiteRow('Returns', 'https://help.example.com/returns'),
        ),
      },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(200);
    const body = response.json() as BulkResult;
    expect(body).toMatchObject({ imported: 2, failed: 1 });
    expect(body.results[1]).toMatchObject({
      line: 2,
      name: 'Metadata',
      status: 'skipped',
      id: null,
    });

    // Crawled *and* indexed — the KK's "crawl/parse" and "RAG indeksleme" halves.
    expect(body.results[0]?.chunk_count).toBeGreaterThan(0);
    expect(body.results[2]?.chunk_count).toBeGreaterThan(0);

    const stored = await owner.knowledgeSource.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { name: true, type: true, sourceUrl: true, content: true },
      orderBy: { name: 'asc' },
    });
    expect(stored.map((source) => [source.name, source.type, source.sourceUrl])).toEqual([
      ['Delivery', 'website', 'https://help.example.com/delivery'],
      ['Returns', 'website', 'https://help.example.com/returns'],
    ]);
    // The page was parsed to text, not stored as HTML.
    expect(stored[0]?.content).not.toContain('<');
    expect(stored[0]?.content).toContain('delivery');

    expect(await chunkCount('a')).toBe(
      body.results.reduce((total, row) => total + (row.chunk_count ?? 0), 0),
    );
  });

  it('mixes website and pasted-text rows in one file', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdA,
        csv: csv(
          'Refunds,faq,We refund within 30 days.,',
          websiteRow('Delivery', 'https://help.example.com/delivery'),
        ),
      },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json() as BulkResult).toMatchObject({ imported: 2, failed: 0 });

    const stored = await owner.knowledgeSource.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { type: true, sourceUrl: true },
      orderBy: { type: 'asc' },
    });
    expect(stored).toEqual([
      { type: 'faq', sourceUrl: null },
      { type: 'website', sourceUrl: 'https://help.example.com/delivery' },
    ]);
  });

  // --- Positive: a dry run reports without fetching ---------------------------

  it('previews a website row without crawling it and writes nothing', async () => {
    const payload = {
      ai_agent_id: agentIdA,
      csv: csv(
        websiteRow('Delivery', 'https://help.example.com/delivery'),
        websiteRow('Metadata', 'http://169.254.169.254/'),
      ),
    };

    const preview = await server.post(
      '/knowledge-sources/bulk',
      { ...payload, dry_run: true },
      await writeHeaders('a'),
    );

    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as BulkResult;
    // The guard still runs, so the verdict a preview exists to give is real.
    expect(previewBody).toMatchObject({ imported: 1, failed: 1, dry_run: true });
    expect(previewBody.results[0]).toMatchObject({
      status: 'imported',
      id: null,
      chunk_count: null,
    });
    expect(previewBody.results[1]?.status).toBe('skipped');
    expect(await sourceCount('a')).toBe(0);

    // And the preview's verdicts are the import's verdicts.
    const real = await server.post('/knowledge-sources/bulk', payload, await writeHeaders('a'));
    const realBody = real.json() as BulkResult;
    expect(realBody.results.map((row) => [row.line, row.status])).toEqual(
      previewBody.results.map((row) => [row.line, row.status]),
    );
    expect(await sourceCount('a')).toBe(1);
  });

  // --- The transaction boundary ----------------------------------------------

  it('writes each crawled row in its own transaction, so no fetch is held inside one', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdA,
        csv: csv(
          websiteRow('Delivery', 'https://help.example.com/delivery'),
          websiteRow('Returns', 'https://help.example.com/returns'),
          websiteRow('Hours', 'https://help.example.com/hours'),
        ),
      },
      await writeHeaders('a'),
    );

    expect((response.json() as BulkResult).imported).toBe(3);

    // `created_at` defaults to now(), and Postgres freezes now() at the start of
    // a transaction. Three identical timestamps would mean one transaction wrapped
    // all three crawls — the thing this endpoint must never do, because a fetch
    // inside a transaction holds a connection open for as long as a remote host
    // feels like taking. Three distinct timestamps mean three transactions, each
    // opened after its own crawl had already finished.
    const created = await owner.knowledgeSource.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { createdAt: true },
    });
    expect(created).toHaveLength(3);
    expect(new Set(created.map((source) => source.createdAt.toISOString())).size).toBe(3);
  });
});
