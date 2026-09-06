/**
 * Editing and reindexing a knowledge source (FR-MOD-06.3.3).
 *
 * Two endpoints, and the weight sits in different places for each.
 *
 * `PATCH` is judged by what happens to the *index*: an edit that changes the
 * table row but leaves the old chunks in place is worse than no edit at all,
 * because the source reads as changed and keeps answering from the text the
 * admin believes they replaced. So every content assertion here is a pair — the
 * new text is retrievable **and** the old text is not — measured through the
 * real retrieval path (`KnowledgeService.retrieve` over pgvector), not by
 * reading a column back.
 *
 * `POST …/reindex` is judged by the SSRF boundary. It turns whatever sits in
 * `source_url` into an outbound request the server makes from inside the
 * network, on a row that no longer carries the request that created it. "It was
 * validated when it was added" is precisely the assumption that must not hold,
 * so the negative cases come first and each one asserts the source survived
 * untouched: a blocked refresh keeps a stale answer rather than replacing it
 * with none.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import type { TenantClient, TenantContext } from '../../src/lib/tenant.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface SourceView {
  id: string;
  name: string;
  type: string;
  status: string;
  source_url: string | null;
  chunk_count: number;
  updated_at: string;
  added_by_name: string | null;
}

/** Distinctive enough that a nearest-neighbour hit on it cannot be a coincidence. */
const OLD_TEXT = 'Refunds are paid back to the original card within fourteen working days.';
const NEW_TEXT = 'Refunds are issued as store credit only, and never back to a card.';

describe('knowledge source — edit and reindex (FR-MOD-06.3.3)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let agentIdA: string;

  const knowledge = new KnowledgeService();

  const auth = async (tenant: 'a' | 'b') => ({
    authorization: `Bearer ${await grantToken(owner, {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
      ownerId: fx[tenant].ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    })}`,
  });

  /**
   * The real retrieval path, not a `LIKE` over `chunk_text`: what an edit has to
   * change is what the AI can find, and the only honest way to ask that is to
   * search the way the answering engine does.
   */
  async function retrievedTexts(tenant: 'a' | 'b', question: string): Promise<string[]> {
    const context: TenantContext = {
      licenseId: fx[tenant].licenseId,
      organizationId: fx[tenant].organizationId,
    };
    const hits = await knowledge.retrieve(owner as TenantClient, context, question, { limit: 10 });
    return hits.map((hit) => hit.text);
  }

  async function createArticle(name = 'Refund policy', content = OLD_TEXT): Promise<SourceView> {
    const response = await server.post(
      '/knowledge-sources',
      { ai_agent_id: agentIdA, name, type: 'article', content },
      await auth('a'),
    );
    expect(response.statusCode).toBe(201);
    return response.json() as SourceView;
  }

  async function createWebsite(url = 'https://help.example.com/refunds'): Promise<SourceView> {
    const response = await server.post(
      '/knowledge-sources',
      { ai_agent_id: agentIdA, name: 'Help centre', type: 'website', source_url: url },
      await auth('a'),
    );
    expect(response.statusCode).toBe(201);
    return response.json() as SourceView;
  }

  /** The stored row, for the "nothing changed" half of every refusal. */
  async function stored(id: string) {
    return owner.knowledgeSource.findUniqueOrThrow({
      where: { id },
      select: { name: true, content: true, sourceUrl: true, updatedAt: true },
    });
  }

  async function chunkCount(id: string): Promise<number> {
    return owner.knowledgeChunk.count({ where: { sourceId: id } });
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
    const agent = await owner.aiAgent.create({
      data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
      select: { id: true },
    });
    agentIdA = agent.id;
  });

  // === PATCH — the edit, and what it does to the index =======================

  describe('PATCH /knowledge-sources/:sourceId', () => {
    it('renames a source without rebuilding its index', async () => {
      const source = await createArticle();
      const before = await chunkCount(source.id);
      expect(before).toBeGreaterThan(0);

      const response = await server.patch(
        `/knowledge-sources/${source.id}`,
        { name: 'Refunds and returns' },
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      const updated = response.json() as SourceView;
      expect(updated.name).toBe('Refunds and returns');
      expect(updated.chunk_count).toBe(before);
      // The name is joined at retrieval time, so no chunk carries it — a rename
      // has nothing to re-embed, and re-embedding anyway would spend model
      // quota to produce identical vectors.
      expect(await retrievedTexts('a', 'How are refunds paid back?')).toContain(OLD_TEXT);
    });

    it('re-indexes changed content: the new text answers and the old one no longer does', async () => {
      const source = await createArticle();
      expect(await retrievedTexts('a', 'How are refunds paid back?')).toContain(OLD_TEXT);

      const response = await server.patch(
        `/knowledge-sources/${source.id}`,
        { content: NEW_TEXT },
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      expect((response.json() as SourceView).chunk_count).toBeGreaterThan(0);

      const found = await retrievedTexts('a', 'How are refunds paid back?');
      expect(found).toContain(NEW_TEXT);
      // The half that matters: an edit that left the old chunks would keep
      // promising a card refund the workspace no longer gives.
      expect(found).not.toContain(OLD_TEXT);
    });

    it('recrawls a website when its URL changes, and drops what the old page said', async () => {
      const source = await createWebsite('https://help.example.com/refunds');
      const oldPage = await retrievedTexts('a', 'refunds');
      expect(oldPage.join(' ')).toContain('refunds');

      const response = await server.patch(
        `/knowledge-sources/${source.id}`,
        { source_url: 'https://help.example.com/warranty' },
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      const updated = response.json() as SourceView;
      expect(updated.source_url).toBe('https://help.example.com/warranty');
      expect(updated.chunk_count).toBeGreaterThan(0);

      const text = (await stored(source.id)).content ?? '';
      expect(text).toContain('warranty');
      expect(text).not.toContain('refunds');
    });

    // --- Fields a type does not own are refused, never dropped ---------------

    it('refuses content for a website source and leaves the crawl alone', async () => {
      const source = await createWebsite();
      const before = await stored(source.id);

      const response = await server.patch(
        `/knowledge-sources/${source.id}`,
        { content: 'Hand-written text over a crawl.' },
        await auth('a'),
      );

      expect(response.statusCode).toBe(400);
      expect((await stored(source.id)).content).toBe(before.content);
    });

    it('refuses content for a file source, so "File" cannot become a label again', async () => {
      const upload = await server.post(
        '/knowledge-sources/file',
        {
          ai_agent_id: agentIdA,
          filename: 'policy.txt',
          content_type: 'text/plain',
          data: Buffer.from(OLD_TEXT, 'utf8').toString('base64'),
        },
        await auth('a'),
      );
      expect(upload.statusCode).toBe(201);
      const source = upload.json() as SourceView;

      const response = await server.patch(
        `/knowledge-sources/${source.id}`,
        { content: 'Pasted text pretending to be a file.' },
        await auth('a'),
      );

      expect(response.statusCode).toBe(400);
      expect((await stored(source.id)).content).toBe(OLD_TEXT);
    });

    it('refuses a source_url for a source that has no URL', async () => {
      const source = await createArticle();

      const response = await server.patch(
        `/knowledge-sources/${source.id}`,
        { source_url: 'https://example.com/help' },
        await auth('a'),
      );

      expect(response.statusCode).toBe(400);
      expect((await stored(source.id)).sourceUrl).toBeNull();
    });

    it('refuses an empty body rather than reporting a no-op as a save', async () => {
      const source = await createArticle();
      const response = await server.patch(`/knowledge-sources/${source.id}`, {}, await auth('a'));
      expect(response.statusCode).toBe(400);
    });

    it('renames a file source, because a title belongs to every type', async () => {
      const upload = await server.post(
        '/knowledge-sources/file',
        {
          ai_agent_id: agentIdA,
          filename: 'policy.txt',
          content_type: 'text/plain',
          data: Buffer.from(OLD_TEXT, 'utf8').toString('base64'),
        },
        await auth('a'),
      );
      const source = upload.json() as SourceView;

      const response = await server.patch(
        `/knowledge-sources/${source.id}`,
        { name: 'Refund policy (2026)' },
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      expect((response.json() as SourceView).name).toBe('Refund policy (2026)');
    });

    // --- The SSRF boundary on the way in -------------------------------------

    it('refuses to crawl a private target on edit and leaves the source untouched', async () => {
      const source = await createWebsite();
      const before = await stored(source.id);
      const chunksBefore = await chunkCount(source.id);

      const response = await server.patch(
        `/knowledge-sources/${source.id}`,
        { source_url: 'http://169.254.169.254/latest/meta-data/' },
        await auth('a'),
      );

      expect(response.statusCode).toBe(400);
      const after = await stored(source.id);
      expect(after.sourceUrl).toBe(before.sourceUrl);
      expect(after.content).toBe(before.content);
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
      expect(await chunkCount(source.id)).toBe(chunksBefore);
    });
  });

  // === POST …/reindex — refresh, and the guard that runs again ===============

  describe('POST /knowledge-sources/:sourceId/reindex', () => {
    /**
     * Every one of these is a URL that was accepted once and is a private or
     * non-http target by the time the refresh runs. The row is not the request
     * that created it: a stored value can predate a guard, come from a later
     * importer, or be written straight into the database. Whatever put it
     * there, this endpoint would turn it into an outbound request.
     */
    const BLOCKED = [
      ['loopback IP', 'http://127.0.0.1/'],
      ['loopback name', 'http://localhost/internal'],
      ['private 10/8', 'http://10.0.0.5/'],
      ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
      ['file scheme', 'file:///etc/passwd'],
      ['not a url', 'definitely not a url'],
    ] as const;

    for (const [label, url] of BLOCKED) {
      it(`re-runs the SSRF guard on the stored URL: refuses ${label}, keeps the old answer`, async () => {
        const source = await createWebsite();
        // The row now names a target the create path would have refused.
        await owner.knowledgeSource.update({ where: { id: source.id }, data: { sourceUrl: url } });
        const before = await stored(source.id);
        const chunksBefore = await chunkCount(source.id);
        expect(chunksBefore).toBeGreaterThan(0);

        const response = await server.post(
          `/knowledge-sources/${source.id}/reindex`,
          undefined,
          await auth('a'),
        );

        expect(response.statusCode).toBe(400);
        const after = await stored(source.id);
        expect(after.content).toBe(before.content);
        expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
        // A refused refresh keeps the stale answer rather than emptying the
        // index — the failure mode must not be worse than not trying.
        expect(await chunkCount(source.id)).toBe(chunksBefore);
      });
    }

    it('refuses a website source that has no URL to crawl', async () => {
      const source = await createWebsite();
      await owner.knowledgeSource.update({ where: { id: source.id }, data: { sourceUrl: null } });

      const response = await server.post(
        `/knowledge-sources/${source.id}/reindex`,
        undefined,
        await auth('a'),
      );

      expect(response.statusCode).toBe(400);
    });

    it('crawls the stored URL again and replaces what the source says', async () => {
      const source = await createWebsite();
      // Stand in for a site that changed under a source nobody touched: the row
      // holds text the URL no longer serves.
      await owner.knowledgeSource.update({
        where: { id: source.id },
        data: { content: 'Stale text nobody wrote at this address.' },
      });

      const response = await server.post(
        `/knowledge-sources/${source.id}/reindex`,
        undefined,
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      const refreshed = response.json() as SourceView;
      expect(refreshed.chunk_count).toBeGreaterThan(0);
      expect(refreshed.status).toBe('ready');

      const text = (await stored(source.id)).content ?? '';
      expect(text).toContain('refunds');
      expect(text).not.toContain('Stale text nobody wrote at this address.');
      const found = await retrievedTexts('a', 'refunds');
      expect(found.join(' ')).not.toContain('Stale text nobody wrote at this address.');
    });

    it('rebuilds a pasted source from the text it already holds', async () => {
      const source = await createArticle();
      // A source that indexed to nothing — an empty crawl, a chunker change —
      // is what this path exists to recover without retyping the content.
      await owner.knowledgeChunk.deleteMany({ where: { sourceId: source.id } });
      expect(await retrievedTexts('a', 'How are refunds paid back?')).not.toContain(OLD_TEXT);

      const response = await server.post(
        `/knowledge-sources/${source.id}/reindex`,
        undefined,
        await auth('a'),
      );

      expect(response.statusCode).toBe(200);
      expect((response.json() as SourceView).chunk_count).toBeGreaterThan(0);
      expect(await retrievedTexts('a', 'How are refunds paid back?')).toContain(OLD_TEXT);
    });
  });

  // === Cross-tenant: 404, never 403 =========================================

  describe('cross-tenant', () => {
    it("answers 404 for another workspace's source on both endpoints, and changes nothing", async () => {
      const source = await createArticle();
      const before = await stored(source.id);
      const b = await auth('b');

      const patched = await server.patch(
        `/knowledge-sources/${source.id}`,
        { name: 'Renamed by a stranger' },
        b,
      );
      const reindexed = await server.post(`/knowledge-sources/${source.id}/reindex`, undefined, b);

      // 404 rather than 403: a 403 would confirm the id names a real source
      // somewhere, which is the fact tenant B must not be able to learn.
      expect(patched.statusCode).toBe(404);
      expect(reindexed.statusCode).toBe(404);
      const after = await stored(source.id);
      expect(after.name).toBe(before.name);
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    });

    it('answers 404 for an id that names nothing at all', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      const a = await auth('a');
      expect(
        (await server.patch(`/knowledge-sources/${missing}`, { name: 'X' }, a)).statusCode,
      ).toBe(404);
      expect(
        (await server.post(`/knowledge-sources/${missing}/reindex`, undefined, a)).statusCode,
      ).toBe(404);
    });
  });
});
