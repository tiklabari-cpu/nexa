/**
 * Website crawling, schema and contract half (tm 312.1 · SiyahTuş analysis
 * AI-17; migration 20261110090000_knowledge_crawl).
 *
 * The crawl still runs in the request (the job runner is tm 312.3). What is
 * pinned here is what the runner and the panel will lean on:
 *
 *   - **One vocabulary.** The CHECKs, `@siyahtus/types` and the contract name
 *     the same scopes, page statuses, job kinds and statuses, and limits.
 *   - **Settings belong to a website.** A create and an edit take the crawl
 *     settings for a website, fill in what was left out, keep one spelling
 *     of a path list, and refuse them — never drop them — for any other type.
 *   - **Pages and jobs stay in their tenant**, a page is one per source and
 *     URL, its chunks go with it, and a source has at most one job under way.
 *   - **`job_id`** on a source reply is the job under way, or null.
 */
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  CRAWL_SCOPES,
  KNOWLEDGE_JOB_KINDS,
  KNOWLEDGE_JOB_STATUSES,
  KNOWLEDGE_PAGE_LIMIT,
  KNOWLEDGE_PAGE_STATUSES,
} from '@siyahtus/types';
import { withTenant, type TenantClient, type TenantContext } from '../../src/lib/tenant.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const ROLLBACK = new Error('rollback probe');

interface SourceView {
  id: string;
  type: string;
  status: string;
  brand_ids: string[];
  crawl_scope: string | null;
  page_limit: number | null;
  include_paths: string[];
  exclude_paths: string[];
  last_crawled_at: string | null;
  page_count: number;
  job_id: string | null;
}

interface SchemaNode {
  enum?: string[];
  maximum?: number;
  properties?: Record<string, SchemaNode>;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** The values an `IN (…)` CHECK admits, in its own order. */
async function admitted(db: PrismaClient, name: string): Promise<string[]> {
  const [row] = await db.$queryRaw<Array<{ def: string }>>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
  const list = /ARRAY\[(.*?)\]/.exec(row!.def)?.[1] ?? '';
  return [...list.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]!);
}

/** Run `fn` as the owner and roll it back whatever it did; returns what it threw, or null. */
async function attempt(
  db: PrismaClient,
  fn: (tx: Pick<PrismaClient, '$executeRawUnsafe'>) => Promise<unknown>,
): Promise<string | null> {
  try {
    await db.$transaction(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error === ROLLBACK) return null;
    return error instanceof Error ? error.message : String(error);
  }
  return null;
}

describe('website crawling — schema and contract (AI-17 · tm 312.1)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let writeA: string;
  let agentA: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const ctx = (t: TenantFixture): TenantContext => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    writeA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    agentA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      })
    ).id;
  });

  const create = (body: Record<string, unknown>) =>
    server.post(
      '/knowledge-sources',
      {
        ai_agent_id: agentA,
        name: 'Help centre',
        type: 'website',
        source_url: 'https://example.com/yardim/',
        ...body,
      },
      auth(writeA),
    );

  const addWebsite = async (body: Record<string, unknown> = {}) => {
    const response = await create(body);
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as SourceView;
  };

  /** A source planted as the owner, under the given tenant's agent. */
  const plantSource = (t: TenantFixture, agentId: string) =>
    owner.knowledgeSource.create({
      data: {
        licenseId: t.licenseId,
        aiAgentId: agentId,
        type: 'website',
        name: 'Site',
        sourceUrl: 'https://example.com/',
      },
      select: { id: true },
    });

  const plantJob = (t: TenantFixture, sourceId: string, data: Record<string, unknown> = {}) =>
    owner.knowledgeJob.create({
      data: {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        sourceId,
        kind: 'crawl',
        ...data,
      },
      select: { id: true },
    });

  const plantPage = (t: TenantFixture, sourceId: string, url: string) =>
    owner.knowledgePage.create({
      data: { licenseId: t.licenseId, sourceId, url, urlHash: sha256(url), status: 'ok' },
      select: { id: true },
    });

  // ==========================================================================

  describe('one vocabulary — schema, types and contract', () => {
    const schemas = () =>
      (loadOpenApiDocument() as unknown as { components: { schemas: Record<string, SchemaNode> } })
        .components.schemas;

    it('names the same scopes, page statuses, job kinds and statuses everywhere', async () => {
      expect(await admitted(owner, 'knowledge_sources_crawl_scope_check')).toEqual([
        ...CRAWL_SCOPES,
      ]);
      expect(await admitted(owner, 'knowledge_pages_status_check')).toEqual([
        ...KNOWLEDGE_PAGE_STATUSES,
      ]);
      expect(await admitted(owner, 'knowledge_jobs_kind_check')).toEqual([...KNOWLEDGE_JOB_KINDS]);
      expect(await admitted(owner, 'knowledge_jobs_status_check')).toEqual([
        ...KNOWLEDGE_JOB_STATUSES,
      ]);

      const s = schemas();
      expect(s['CrawlScope']!.enum).toEqual([...CRAWL_SCOPES]);
      expect(s['KnowledgePageStatus']!.enum).toEqual([...KNOWLEDGE_PAGE_STATUSES]);
      expect(s['KnowledgeJobKind']!.enum).toEqual([...KNOWLEDGE_JOB_KINDS]);
      expect(s['KnowledgeJobStatus']!.enum).toEqual([...KNOWLEDGE_JOB_STATUSES]);
      expect(s['KnowledgeSource']!.properties!['page_limit']!.maximum).toBe(
        KNOWLEDGE_PAGE_LIMIT.max,
      );
      expect(await admitted(owner, 'knowledge_sources_status_check')).toEqual(
        expect.arrayContaining(['crawling', 'partial']),
      );
    });

    it('holds a page limit of 1–200 and path lists of website sources only', async () => {
      const { id } = await addWebsite();
      const faq = await owner.knowledgeSource.create({
        data: { licenseId: fx.a.licenseId, aiAgentId: agentA, type: 'faq', name: 'F' },
        select: { id: true },
      });
      const set = (sourceId: string, assignment: string) =>
        attempt(owner, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE knowledge_sources SET ${assignment} WHERE id = $1::uuid`,
            sourceId,
          ),
        );

      expect(await set(id, 'page_limit = 0')).toMatch(/knowledge_sources_page_limit_check/);
      expect(await set(id, 'page_limit = 201')).toMatch(/knowledge_sources_page_limit_check/);
      expect(await set(id, 'page_limit = 200')).toBeNull();
      expect(await set(id, `crawl_scope = 'deep'`)).toMatch(/knowledge_sources_crawl_scope_check/);
      for (const bad of [`'{yardim}'`, `'{/a,b}'`, `'{""}'`, `ARRAY[NULL]::text[]`]) {
        expect(await set(id, `include_paths = ${bad}`), bad).toMatch(
          /knowledge_sources_crawl_paths_check/,
        );
      }
      expect(await set(id, `exclude_paths = '{/a,/b/}'`)).toBeNull();
      const many = `ARRAY(SELECT '/p' || g FROM generate_series(1, 21) g)`;
      expect(await set(id, `exclude_paths = ${many}`)).toMatch(
        /knowledge_sources_crawl_paths_check/,
      );

      expect(await set(faq.id, `crawl_scope = 'single'`)).toMatch(
        /knowledge_sources_crawl_scope_check/,
      );
      expect(await set(faq.id, 'page_limit = 10')).toMatch(/knowledge_sources_page_limit_check/);
      expect(await set(faq.id, `include_paths = '{/a}'`)).toMatch(
        /knowledge_sources_crawl_paths_check/,
      );
    });

    it('holds what each job status carries, and codes rather than prose', async () => {
      const { id: sourceId } = await plantSource(fx.a, agentA);
      const insert = (columns: string, values: string) =>
        attempt(owner, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO knowledge_jobs (id, license_id, organization_id, source_id, kind, updated_at${columns})
             VALUES (gen_random_uuid(), $1, $2::uuid, $3::uuid, 'crawl', now()${values})`,
            fx.a.licenseId,
            fx.a.organizationId,
            sourceId,
          ),
        );
      expect(await insert('', '')).toBeNull();
      expect(await insert(', status', `, 'running'`)).toMatch(/knowledge_jobs_status_shape_check/);
      expect(
        await insert(', status, lease_until, started_at', `, 'running', now(), now()`),
      ).toBeNull();
      expect(await insert(', status', `, 'done'`)).toMatch(/knowledge_jobs_status_shape_check/);
      expect(await insert(', status, finished_at', `, 'cancelled', now()`)).toBeNull();
      expect(await insert(', frontier', `, '{}'::jsonb`)).toMatch(/knowledge_jobs_frontier_check/);
      expect(await insert(', error', `, 'The site said no'`)).toMatch(/knowledge_jobs_error_check/);

      const page = (columns: string, values: string) =>
        attempt(owner, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO knowledge_pages (id, license_id, source_id, url, url_hash, status, updated_at${columns})
             VALUES (gen_random_uuid(), $1, $2::uuid, 'https://example.com/a', $3, 'ok', now()${values})`,
            fx.a.licenseId,
            sourceId,
            sha256('https://example.com/a'),
          ),
        );
      expect(await page('', '')).toBeNull();
      expect(await page(', error', `, 'Connection refused by 10.0.0.1'`)).toMatch(
        /knowledge_pages_error_check/,
      );
      expect(await page(', http_status', ', 42')).toMatch(/knowledge_pages_http_status_check/);
      expect(await page(', content_hash', `, 'NOT-A-HASH'`)).toMatch(
        /knowledge_pages_content_hash_check/,
      );
      expect(await page(', lang', `, 'tr-TR'`)).toMatch(/knowledge_pages_lang_check/);
    });
  });

  // ==========================================================================

  describe('crawl settings through the API', () => {
    it('fills in a website left without settings: a single page, 200 pages, every path (FR-MOD-06.3.2)', async () => {
      const source = await addWebsite();
      expect(source).toMatchObject({
        status: 'ready',
        crawl_scope: 'single',
        page_limit: KNOWLEDGE_PAGE_LIMIT.default,
        include_paths: [],
        exclude_paths: [],
        last_crawled_at: null,
        page_count: 0,
        job_id: null,
      });
      expect(
        await owner.knowledgeSource.findUniqueOrThrow({
          where: { id: source.id },
          select: { crawlScope: true, pageLimit: true },
        }),
      ).toEqual({ crawlScope: 'single', pageLimit: 200 });
    });

    it('keeps what a website names, path lists in one spelling, and lists it so (FR-MOD-06.3.2)', async () => {
      const source = await addWebsite({
        crawl_scope: 'sitemap',
        page_limit: 50,
        include_paths: [' /yardim/ ', '/bonus', '/yardim/'],
        exclude_paths: ['/yardim/kvkk'],
      });
      expect(source).toMatchObject({
        crawl_scope: 'sitemap',
        page_limit: 50,
        include_paths: ['/yardim/', '/bonus'],
        exclude_paths: ['/yardim/kvkk'],
      });
      const response = await server.get('/knowledge-sources', auth(writeA));
      const listed = (response.json() as { items: SourceView[] }).items.find(
        (s) => s.id === source.id,
      );
      expect(listed).toMatchObject({ crawl_scope: 'sitemap', page_limit: 50, job_id: null });
    });

    it.each([
      [{ crawl_scope: 'deep' }, 'crawl_scope'],
      [{ page_limit: 0 }, 'page_limit'],
      [{ page_limit: 201 }, 'page_limit'],
      [{ include_paths: ['yardim'] }, 'include_paths'],
      [{ exclude_paths: ['/a?b=1'] }, 'exclude_paths'],
      [{ include_paths: Array.from({ length: 21 }, (_, i) => `/p${i}`) }, 'include_paths'],
    ])('refuses %j with a 400 naming the field and creates nothing', async (body, field) => {
      const response = await create(body);
      expect(response.statusCode).toBe(400);
      expect(response.body).toContain(field);
      expect(await owner.knowledgeSource.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('refuses crawl settings for a source that is not a website — on a create and an edit', async () => {
      const refused = await server.post(
        '/knowledge-sources',
        { ai_agent_id: agentA, name: 'FAQ', type: 'faq', content: 'We ship.', page_limit: 5 },
        auth(writeA),
      );
      expect(refused.statusCode).toBe(400);
      expect(refused.body).toContain('page_limit');

      const faq = await server.post(
        '/knowledge-sources',
        { ai_agent_id: agentA, name: 'FAQ', type: 'faq', content: 'We ship.' },
        auth(writeA),
      );
      expect(faq.statusCode).toBe(201);
      expect(faq.json()).toMatchObject({ crawl_scope: null, page_limit: null, include_paths: [] });
      const id = (faq.json() as SourceView).id;
      const edit = await server.patch(
        `/knowledge-sources/${id}`,
        { exclude_paths: ['/x'] },
        auth(writeA),
      );
      expect(edit.statusCode).toBe(400);
      expect(edit.body).toContain('exclude_paths: only a website source is crawled');
    });

    it("edits a website's settings without fetching or re-indexing anything", async () => {
      const source = await addWebsite();
      const before = await owner.knowledgeChunk.findMany({
        where: { sourceId: source.id },
        select: { id: true },
      });
      const edit = await server.patch(
        `/knowledge-sources/${source.id}`,
        { crawl_scope: 'all', page_limit: 20, exclude_paths: ['/blog', '/blog'] },
        auth(writeA),
      );
      expect(edit.statusCode, edit.body).toBe(200);
      expect(edit.json()).toMatchObject({
        crawl_scope: 'all',
        page_limit: 20,
        include_paths: [],
        exclude_paths: ['/blog'],
        job_id: null,
      });
      expect(
        await owner.knowledgeChunk.findMany({
          where: { sourceId: source.id },
          select: { id: true },
        }),
      ).toEqual(before);
    });

    it('reads brand_id as brand_ids: [brand_id], and refuses the two disagreeing', async () => {
      const brand = { id: await seedDefaultBrand(owner, fx.a.licenseId) };
      const other = await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Vale', slug: 'vale' },
        select: { id: true },
      });

      expect((await addWebsite({ brand_id: brand.id })).brand_ids).toEqual([brand.id]);
      expect(
        (await addWebsite({ brand_id: brand.id, brand_ids: [brand.id.toUpperCase()] })).brand_ids,
      ).toEqual([brand.id]);

      const clash = await create({ brand_id: brand.id, brand_ids: [other.id] });
      expect(clash.statusCode).toBe(400);
      expect(clash.body).toContain('brand_id and brand_ids name different brands');

      // Another workspace's brand is as unknown as no brand at all.
      const foreign = await seedDefaultBrand(owner, fx.b.licenseId);
      const stranger = await create({ brand_id: foreign });
      expect(stranger.statusCode).toBe(400);
      expect(stranger.body).toContain('knowledge_source_unknown_brand');
    });

    it('names the job under way as job_id, and none once it has ended', async () => {
      const source = await addWebsite();
      const job = await plantJob(fx.a, source.id);
      const listed = async () =>
        (
          (await server.get('/knowledge-sources', auth(writeA))).json() as { items: SourceView[] }
        ).items.find((s) => s.id === source.id)!;
      expect((await listed()).job_id).toBe(job.id);

      const review = await server.post(`/knowledge-sources/${source.id}/review`, {}, auth(writeA));
      expect((review.json() as SourceView).job_id).toBe(job.id);

      await owner.knowledgeJob.update({
        where: { id: job.id },
        data: { status: 'done', finishedAt: new Date() },
      });
      expect((await listed()).job_id).toBeNull();
    });
  });

  // ==========================================================================

  describe('pages and jobs', () => {
    it("never shows one workspace another workspace's pages or jobs (NFR-S4)", async () => {
      const { id: sourceId } = await plantSource(fx.a, agentA);
      const page = await plantPage(fx.a, sourceId, 'https://example.com/a');
      const job = await plantJob(fx.a, sourceId);

      const seenByB = await withTenant(appRole, ctx(fx.b), (tx) =>
        Promise.all([
          tx.knowledgePage.findUnique({ where: { id: page.id } }),
          tx.knowledgeJob.findUnique({ where: { id: job.id } }),
          tx.knowledgePage.count(),
          tx.knowledgeJob.count(),
        ]),
      );
      expect(seenByB).toEqual([null, null, 0, 0]);

      const seenByA = await withTenant(appRole, ctx(fx.a), (tx) =>
        Promise.all([
          tx.knowledgePage.findUnique({ where: { id: page.id }, select: { id: true } }),
          tx.knowledgeJob.findUnique({ where: { id: job.id }, select: { id: true } }),
        ]),
      );
      expect(seenByA).toEqual([{ id: page.id }, { id: job.id }]);
    });

    it("writes pages and jobs into the caller's own tenant and nowhere else (NFR-S4)", async () => {
      const { id: sourceId } = await plantSource(fx.a, agentA);
      const inA = <T>(fn: (tx: TenantClient) => Promise<T>) => withTenant(appRole, ctx(fx.a), fn);

      await expect(
        inA((tx) =>
          tx.knowledgeJob.createMany({
            data: [
              {
                licenseId: fx.a.licenseId,
                organizationId: fx.a.organizationId,
                sourceId,
                kind: 'crawl',
              },
            ],
          }),
        ),
      ).resolves.toEqual({ count: 1 });
      for (const foreign of [
        { licenseId: fx.b.licenseId, organizationId: fx.a.organizationId },
        { licenseId: fx.a.licenseId, organizationId: fx.b.organizationId },
      ]) {
        await expect(
          inA((tx) =>
            tx.knowledgeJob.createMany({
              data: [
                {
                  ...foreign,
                  sourceId,
                  kind: 'refresh',
                  status: 'cancelled',
                  finishedAt: new Date(),
                },
              ],
            }),
          ),
        ).rejects.toThrow(/row-level security/);
      }
      await expect(
        inA((tx) =>
          tx.knowledgePage.createMany({
            data: [
              {
                licenseId: fx.b.licenseId,
                sourceId,
                url: 'https://example.com/b',
                urlHash: sha256('https://example.com/b'),
                status: 'ok',
              },
            ],
          }),
        ),
      ).rejects.toThrow(/row-level security/);

      // The runtime role moves a job along (a cancel, the runner's progress)
      // but never deletes one: jobs leave with their source.
      const [row] = await withTenant(appRole, ctx(fx.a), (tx) =>
        tx.knowledgeJob.findMany({ select: { id: true } }),
      );
      await expect(
        inA((tx) =>
          tx.knowledgeJob.update({
            where: { id: row!.id },
            data: { status: 'cancelled', finishedAt: new Date() },
          }),
        ),
      ).resolves.toMatchObject({ status: 'cancelled' });
      await expect(
        inA((tx) => tx.knowledgeJob.deleteMany({ where: { id: row!.id } })),
      ).rejects.toThrow(/permission denied/);
    });

    it('keeps one job under way per source; an ended job makes room for the next', async () => {
      const { id: sourceId } = await plantSource(fx.a, agentA);
      const first = await plantJob(fx.a, sourceId);
      await expect(plantJob(fx.a, sourceId, { kind: 'refresh' })).rejects.toThrow(
        /knowledge_jobs_one_active_per_source|Unique constraint/,
      );
      await expect(plantJob(fx.a, sourceId, { status: 'waiting_budget' })).rejects.toThrow(
        /knowledge_jobs_one_active_per_source|Unique constraint/,
      );
      // Ended jobs are history, as many as there were.
      await plantJob(fx.a, sourceId, { status: 'failed', finishedAt: new Date() });
      await plantJob(fx.a, sourceId, { status: 'done', finishedAt: new Date() });

      await owner.knowledgeJob.update({
        where: { id: first.id },
        data: { status: 'cancelled', finishedAt: new Date() },
      });
      await expect(plantJob(fx.a, sourceId)).resolves.toMatchObject({ id: expect.any(String) });

      const [index] = await owner.$queryRaw<Array<{ valid: boolean; unique: boolean }>>`
        SELECT i.indisvalid AS valid, i.indisunique AS unique
          FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE c.relname = 'knowledge_jobs_one_active_per_source'`;
      expect(index).toEqual({ valid: true, unique: true });
    });

    it("keeps one page per source and URL; a page's chunks go with it, and all go with the source", async () => {
      const { id: sourceId } = await plantSource(fx.a, agentA);
      const page = await plantPage(fx.a, sourceId, 'https://example.com/a');
      await expect(plantPage(fx.a, sourceId, 'https://example.com/a')).rejects.toThrow(
        /Unique constraint/,
      );
      const { id: otherSource } = await plantSource(fx.a, agentA);
      await expect(plantPage(fx.a, otherSource, 'https://example.com/a')).resolves.toMatchObject({
        id: expect.any(String),
      });

      const chunk = (pageId: string | null, position: number) =>
        owner.knowledgeChunk.create({
          data: { licenseId: fx.a.licenseId, sourceId, pageId, chunkText: 'text', position },
          select: { id: true },
        });
      await chunk(page.id, 0);
      await chunk(page.id, 1);
      const untouched = await chunk(null, 2);

      await owner.knowledgePage.delete({ where: { id: page.id } });
      expect(
        await owner.knowledgeChunk.findMany({ where: { sourceId }, select: { id: true } }),
      ).toEqual([untouched]);

      await plantPage(fx.a, sourceId, 'https://example.com/b');
      await plantJob(fx.a, sourceId);
      await owner.knowledgeSource.delete({ where: { id: sourceId } });
      expect(
        await Promise.all([
          owner.knowledgePage.count({ where: { sourceId } }),
          owner.knowledgeJob.count({ where: { sourceId } }),
          owner.knowledgeChunk.count({ where: { sourceId } }),
        ]),
      ).toEqual([0, 0, 0]);
    });

    it('a job planted for workspace B is never named as job_id in workspace A', async () => {
      const source = await addWebsite();
      // Planted past RLS, as if B's runner had filed a job against A's source.
      await owner.knowledgeJob.create({
        data: {
          licenseId: fx.b.licenseId,
          organizationId: fx.b.organizationId,
          sourceId: source.id,
          kind: 'crawl',
        },
      });
      const listed = (
        (await server.get('/knowledge-sources', auth(writeA))).json() as { items: SourceView[] }
      ).items.find((s) => s.id === source.id)!;
      expect(listed.job_id).toBeNull();
    });
  });
});
