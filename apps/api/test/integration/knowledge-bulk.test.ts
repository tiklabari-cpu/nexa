/**
 * Bulk CSV knowledge import (FR-MOD-06.3.2 — the multi-row half).
 *
 * A loop that writes rows on an admin's behalf has two ways to go wrong that a
 * single-row endpoint does not, so both come first here.
 *
 * The first is the tenant boundary. One request now creates N rows, and the
 * question "whose agent do they belong to?" is asked once — so the tests prove
 * that the answer cannot be changed after it is given: a foreign `ai_agent_id`
 * is refused outright, and an `ai_agent_id` *column* smuggled into the file is
 * ignored, with every row landing on the agent the check approved.
 *
 * The second is budget. One request now carries a whole file, so the row, cell
 * and byte ceilings are the only thing between an authenticated caller and an
 * unbounded write — and each must refuse the request with the typed error that
 * names the limit, writing nothing, rather than importing a truncated prefix.
 *
 * Only then the positives: partial success (the normal outcome for a
 * spreadsheet), and `dry_run`, which must produce the same verdicts while
 * touching nothing.
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

/** A CSV document from its data rows — the header is the same every time. */
function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

describe('bulk knowledge import', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentIdA: string;
  let agentIdB: string;

  async function tokenFor(tenant: 'a' | 'b', scopes: string[]): Promise<string> {
    return grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes,
    });
  }

  async function writeHeaders(tenant: 'a' | 'b'): Promise<Record<string, string>> {
    return { authorization: `Bearer ${await tokenFor(tenant, ['agents-bot--all:rw'])}` };
  }

  function sourceCount(tenant: 'a' | 'b'): Promise<number> {
    return owner.knowledgeSource.count({ where: { licenseId: fx[tenant].licenseId } });
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

  // --- Negative: the tenant boundary ----------------------------------------

  it("refuses another tenant's AI agent and writes nothing on either side", async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdB, csv: csv('Refunds,faq,We refund within 30 days.,') },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
    expect(await sourceCount('a')).toBe(0);
    expect(await sourceCount('b')).toBe(0);
  });

  it('ignores an ai_agent_id column, so every row lands on the verified agent', async () => {
    // The check runs once, before the loop. This is what makes that sound: the
    // file has no way to name a different target, however it is shaped.
    const smuggled = [
      `${HEADER},ai_agent_id`,
      `Refunds,faq,We refund within 30 days.,,${agentIdB}`,
      `Delivery,article,Orders ship next day.,,${agentIdB}`,
    ].join('\n');

    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: smuggled },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(200);
    expect((response.json() as BulkResult).imported).toBe(2);

    const created = await owner.knowledgeSource.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { aiAgentId: true },
    });
    expect(created).toHaveLength(2);
    expect(created.every((source) => source.aiAgentId === agentIdA)).toBe(true);
    // And nothing reached tenant B's agent.
    expect(await owner.knowledgeSource.count({ where: { aiAgentId: agentIdB } })).toBe(0);
  });

  // --- Negative: the budget (refused whole, never truncated) -----------------

  it('refuses a file over the row ceiling instead of importing a prefix', async () => {
    const rows = Array.from({ length: 201 }, (_, i) => `Row ${i},faq,Answer number ${i}.,`);
    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: csv(...rows) },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
    expect(response.json().error.message).toMatch(/more than 200 rows/);
    expect(await sourceCount('a')).toBe(0);
  });

  it('refuses a file with a cell over the character ceiling', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: csv(`Huge,faq,${'a'.repeat(100_001)},`) },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
    expect(response.json().error.message).toMatch(/100000-character limit/);
    expect(await sourceCount('a')).toBe(0);
  });

  it('refuses a file over the byte ceiling with the typed budget error', async () => {
    // Over 5 MiB — and well over the 1 MiB body limit every other route
    // inherits. Reaching the handler at all proves the per-route ceiling is in
    // place; the message proves the *content* budget is what refused it, not an
    // opaque body-too-large before the handler ran.
    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: 'a'.repeat(5_242_881) },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
    expect(response.json().error.message).toMatch(/5242880-byte limit/);
    expect(await sourceCount('a')).toBe(0);
  });

  // --- Negative: malformed input refuses the request, not a row --------------

  it('refuses a header missing a required column, naming every missing one', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: 'name,content\nRefunds,We refund within 30 days.' },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
    expect(response.json().error.message).toMatch(/type/);
    expect(response.json().error.message).toMatch(/source_url/);
    expect(await sourceCount('a')).toBe(0);
  });

  it('refuses unparseable CSV rather than guessing at the rows', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: csv('"Refunds,faq,We refund within 30 days.,') },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(400);
    expect(response.json().error.type).toBe('validation');
    expect(await sourceCount('a')).toBe(0);
  });

  // --- Negative: authentication and scope ------------------------------------

  it('rejects a token without the write scope', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: csv('Refunds,faq,We refund within 30 days.,') },
      { authorization: `Bearer ${await tokenFor('a', ['agents-bot--all:ro'])}` },
    );

    expect(response.statusCode).toBe(403);
    expect(await sourceCount('a')).toBe(0);
  });

  it('rejects an unauthenticated request', async () => {
    const response = await server.post('/knowledge-sources/bulk', {
      ai_agent_id: agentIdA,
      csv: csv('Refunds,faq,We refund within 30 days.,'),
    });

    expect(response.statusCode).toBe(401);
    expect(await sourceCount('a')).toBe(0);
  });

  // --- A website row is crawled, under its own guard and budget --------------

  it('crawls a website row alongside a pasted-text one', async () => {
    // The row-level guard, the amplification ceiling and the transaction
    // boundary that path brings with it are `knowledge-bulk-website.test.ts`.
    // What belongs here is that the two kinds of row share one file and one
    // result envelope without either getting in the other's way.
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdA,
        csv: csv(
          'Help site,website,,https://help.example.com/delivery',
          'Refunds,faq,We refund within 30 days.,',
        ),
      },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(200);
    const body = response.json() as BulkResult;
    expect(body).toMatchObject({ imported: 2, failed: 0 });
    expect(body.results.every((row) => (row.chunk_count ?? 0) > 0)).toBe(true);

    const sources = await owner.knowledgeSource.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { name: true, type: true, sourceUrl: true },
      orderBy: { name: 'asc' },
    });
    expect(sources).toEqual([
      { name: 'Help site', type: 'website', sourceUrl: 'https://help.example.com/delivery' },
      { name: 'Refunds', type: 'faq', sourceUrl: null },
    ]);
  });

  // --- Positive: import, index, and partial success --------------------------

  it('imports every valid row and indexes each one for retrieval', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdA,
        csv: csv(
          'Refunds,faq,We refund within 30 days of delivery.,',
          'Delivery,article,Orders placed before 5pm ship the same day.,',
          // Quoted, with an embedded comma: proves the real parser is on the path.
          '"Hours, opening",faq,"We are open 9 to 5, Monday to Friday.",',
        ),
      },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(200);
    const body = response.json() as BulkResult;
    expect(body).toMatchObject({ imported: 3, failed: 0, dry_run: false });
    expect(body.results.map((row) => row.line)).toEqual([1, 2, 3]);
    expect(body.results.every((row) => row.status === 'imported')).toBe(true);
    expect(body.results.every((row) => (row.chunk_count ?? 0) > 0)).toBe(true);
    expect(body.results[2]?.name).toBe('Hours, opening');

    // Indexed, not merely created: the chunks the response claims exist.
    const chunks = await owner.knowledgeChunk.count({ where: { licenseId: fx.a.licenseId } });
    expect(chunks).toBe(body.results.reduce((total, row) => total + (row.chunk_count ?? 0), 0));
    expect(await sourceCount('a')).toBe(3);
  });

  it('imports the good rows and reports the bad ones by line', async () => {
    const response = await server.post(
      '/knowledge-sources/bulk',
      {
        ai_agent_id: agentIdA,
        csv: csv(
          'Refunds,faq,We refund within 30 days.,',
          'Broken,workflow,Not a known type.,',
          'Delivery,article,Orders ship next day.,',
          'Empty,faq,,',
        ),
      },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(200);
    const body = response.json() as BulkResult;
    expect(body).toMatchObject({ imported: 2, failed: 2 });

    expect(body.results[1]).toMatchObject({ line: 2, name: 'Broken', type: 'workflow', status: 'skipped', id: null });
    expect(body.results[1]?.error).toMatch(/^type: /);
    expect(body.results[3]).toMatchObject({ line: 4, status: 'skipped' });
    expect(body.results[3]?.error).toMatch(/^content: /);

    // Only the two valid rows exist, and the response's ids are the real ones.
    const stored = await owner.knowledgeSource.findMany({
      where: { licenseId: fx.a.licenseId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    expect(stored.map((source) => source.name)).toEqual(['Delivery', 'Refunds']);
    expect(new Set(stored.map((source) => source.id))).toEqual(
      new Set([body.results[0]?.id, body.results[2]?.id]),
    );
  });

  it('stores an imported cell with its formula lead already neutralised', async () => {
    // End-to-end proof that the guarded reader is the one on this path: the
    // stored text carries the prefix `parseCsv` added, not the raw payload.
    const response = await server.post(
      '/knowledge-sources/bulk',
      { ai_agent_id: agentIdA, csv: csv(`Payload,faq,"=cmd|' /C calc'!A0",`) },
      await writeHeaders('a'),
    );

    expect(response.statusCode).toBe(200);
    const source = await owner.knowledgeSource.findFirstOrThrow({
      where: { licenseId: fx.a.licenseId },
      select: { content: true },
    });
    expect(source.content).toBe(`'=cmd|' /C calc'!A0`);
  });

  // --- Positive: dry run reports without writing -----------------------------

  it('reports the same verdicts on a dry run and writes nothing', async () => {
    const payload = {
      ai_agent_id: agentIdA,
      csv: csv(
        'Refunds,faq,We refund within 30 days.,',
        'Broken,workflow,Not a known type.,',
      ),
    };

    const preview = await server.post(
      '/knowledge-sources/bulk',
      { ...payload, dry_run: true },
      await writeHeaders('a'),
    );

    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json() as BulkResult;
    expect(previewBody).toMatchObject({ imported: 1, failed: 1, dry_run: true });
    expect(previewBody.results[0]).toMatchObject({ line: 1, status: 'imported', id: null, chunk_count: null });
    expect(await sourceCount('a')).toBe(0);

    // The preview's verdicts are the import's verdicts — same rules, same code.
    const real = await server.post('/knowledge-sources/bulk', payload, await writeHeaders('a'));
    const realBody = real.json() as BulkResult;
    expect(realBody).toMatchObject({ imported: 1, failed: 1, dry_run: false });
    expect(realBody.results.map((row) => [row.line, row.status, row.error])).toEqual(
      previewBody.results.map((row) => [row.line, row.status, row.error]),
    );
    expect(await sourceCount('a')).toBe(1);
  });
});
