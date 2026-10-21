/**
 * The single knowledge store, expand step (tm 309.1 · SiyahTuş analysis AI-14,
 * owner decision K11 · `docs/adr/single-knowledge-store.md`; migrations
 * 20261020220000–0400).
 *
 * Retrieval reads none of the new scope columns yet — tm 309.2 moves it onto
 * them. What is pinned here is what that release leans on:
 *
 *   - **One vocabulary.** The CHECKs, the column defaults, `@siyahtus/types`
 *     and the contract name the same audiences, review interval and language
 *     shape, and a set of audiences has one spelling.
 *   - **Every row already in the store's terms.** Each way a source is written
 *     files its `audiences` and `ai_agent_ids` from the agent record it is
 *     filed under — Copilot's for agents only — so the release that reads them
 *     never meets a row this one left at the defaults.
 *   - **Review (AI-14-S3).** A new source is reviewed as it is added and due
 *     again after its interval; only `POST …/review` moves `reviewed_at`;
 *     `?stale=` lists the sources due; the older ones count their last edit.
 *   - **What the filter needs exists.** The GIN indexes are built and valid,
 *     and a KB article has at most one source, which goes with it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadOpenApiDocument } from '@siyahtus/contract';
import {
  DEFAULT_KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_AUDIENCES,
  KNOWLEDGE_LANGUAGE_PATTERN,
  KNOWLEDGE_REVIEW_INTERVAL_DAYS,
} from '@siyahtus/types';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const DAY_MS = 86_400_000;

interface SourceView {
  id: string;
  ai_agent_id: string;
  status: string;
  chunk_count: number;
  updated_at: string;
  language: string | null;
  owner_id: string | null;
  owner_name: string | null;
  reviewed_at: string;
  review_interval_days: number;
  review_due_at: string;
}

interface ArticleView {
  id: string;
  ai_audiences: string[];
}

interface SchemaNode {
  enum?: string[];
  required?: string[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
  properties?: Record<string, SchemaNode>;
}

const ROLLBACK = new Error('rollback probe');

/** The sets a `col = '{…}'::text[] OR …` CHECK admits, each in its stored order. */
async function admittedSets(db: PrismaClient, name: string): Promise<string[][]> {
  const [row] = await db.$queryRaw<Array<{ def: string }>>`
    SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = ${name}`;
  return [...row!.def.matchAll(/'\{([a-z_,]*)\}'::text\[\]/g)]
    .map((m) => (m[1] === '' ? [] : m[1]!.split(',')))
    .sort((a, b) => a.join().localeCompare(b.join()));
}

/** Every set of audiences in its one spelling: the non-empty subsets, in `KNOWLEDGE_AUDIENCES` order. */
function canonicalSets(withEmpty: boolean): string[][] {
  const sets: string[][] = withEmpty ? [[]] : [];
  for (let mask = 1; mask < 1 << KNOWLEDGE_AUDIENCES.length; mask++) {
    sets.push(KNOWLEDGE_AUDIENCES.filter((_, i) => mask & (1 << i)));
  }
  return sets.sort((a, b) => a.join().localeCompare(b.join()));
}

async function columnDefault(db: PrismaClient, table: string, column: string): Promise<string> {
  const [row] = await db.$queryRaw<Array<{ value: string }>>`
    SELECT column_default AS value FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = ${table} AND column_name = ${column}`;
  return row!.value;
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

describe('the single knowledge store — expand (AI-14 · K11 · tm 309.1)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let writeA: string;
  let readA: string;
  let writeB: string;
  let aiAgentA: string;
  let aiAgentB: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const token = (t: Fixtures['a'], scopes: string[]) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes,
    });

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
    writeA = await token(fx.a, ['agents-bot--all:rw']);
    readA = await token(fx.a, ['agents-bot--all:ro']);
    writeB = await token(fx.b, ['agents-bot--all:rw']);
    aiAgentA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada' },
        select: { id: true },
      })
    ).id;
    aiAgentB = (
      await owner.aiAgent.create({
        data: { licenseId: fx.b.licenseId, kind: 'ai_agent', name: 'Bea' },
        select: { id: true },
      })
    ).id;
  });

  const addSource = async (body: Record<string, unknown> = {}, as = writeA, agent = aiAgentA) => {
    const response = await server.post(
      '/knowledge-sources',
      { ai_agent_id: agent, name: 'Shipping', type: 'faq', content: 'We ship worldwide.', ...body },
      auth(as),
    );
    expect(response.statusCode).toBe(201);
    return response.json() as SourceView;
  };

  const list = async (query = '', as = writeA) => {
    const response = await server.get(`/knowledge-sources${query}`, auth(as));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: SourceView[] }).items;
  };

  const scopeOf = (id: string) =>
    owner.knowledgeSource.findUniqueOrThrow({
      where: { id },
      select: { audiences: true, aiAgentIds: true, brandIds: true },
    });

  /** "It was last looked at `days` ago" — moved as the owner, past the API. */
  const reviewedDaysAgo = (id: string, days: number) =>
    owner.knowledgeSource.update({
      where: { id },
      data: { reviewedAt: new Date(Date.now() - days * DAY_MS) },
    });

  // ==========================================================================

  describe('one vocabulary — schema, types and contract', () => {
    const schemas = () =>
      (loadOpenApiDocument() as unknown as { components: { schemas: Record<string, SchemaNode> } })
        .components.schemas;

    it('admits the three sets of audiences in one spelling, never empty, both by default', async () => {
      expect(await admittedSets(owner, 'knowledge_sources_audiences_check')).toEqual(
        canonicalSets(false),
      );
      expect(await columnDefault(owner, 'knowledge_sources', 'audiences')).toBe(
        `ARRAY[${DEFAULT_KNOWLEDGE_AUDIENCES.map((a) => `'${a}'::text`).join(', ')}]`,
      );
      expect(schemas()['KnowledgeAudience']!.enum).toEqual([...KNOWLEDGE_AUDIENCES]);

      const source = await addSource();
      for (const bad of ['{}', '{copilot,ai_agent}', '{copilot,copilot}', '{public_kb}']) {
        const refused = await attempt(owner, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE knowledge_sources SET audiences = '${bad}' WHERE id = $1::uuid`,
            source.id,
          ),
        );
        expect(refused, bad).toMatch(/knowledge_sources_audiences_check/);
      }
    });

    it("admits a KB article's audiences and the empty set — open to both by default (AI-14-S2)", async () => {
      expect(await admittedSets(owner, 'kb_articles_ai_audiences_check')).toEqual(
        canonicalSets(true),
      );
      expect(await columnDefault(owner, 'kb_articles', 'ai_audiences')).toBe(
        `ARRAY[${DEFAULT_KNOWLEDGE_AUDIENCES.map((a) => `'${a}'::text`).join(', ')}]`,
      );
      const article = schemas()['KbArticle']!;
      expect(article.required).toContain('ai_audiences');
    });

    it('reviews every 90 days unless set, 1 to 365 — the CHECK, the types and the contract', async () => {
      expect(await columnDefault(owner, 'knowledge_sources', 'review_interval_days')).toBe(
        String(KNOWLEDGE_REVIEW_INTERVAL_DAYS.default),
      );
      const [row] = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'knowledge_sources_review_interval_days_check'`;
      expect(row!.def).toContain(`review_interval_days >= ${KNOWLEDGE_REVIEW_INTERVAL_DAYS.min}`);
      expect(row!.def).toContain(`review_interval_days <= ${KNOWLEDGE_REVIEW_INTERVAL_DAYS.max}`);
      const interval = schemas()['KnowledgeSource']!.properties!['review_interval_days']!;
      expect([interval.minimum, interval.maximum]).toEqual([
        KNOWLEDGE_REVIEW_INTERVAL_DAYS.min,
        KNOWLEDGE_REVIEW_INTERVAL_DAYS.max,
      ]);
    });

    it("holds a language to the types' primary-subtag pattern", async () => {
      const [row] = await owner.$queryRaw<Array<{ def: string }>>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
         WHERE conname = 'knowledge_sources_language_check'`;
      expect(row!.def).toContain(`'${KNOWLEDGE_LANGUAGE_PATTERN.source}'`);
      expect(schemas()['KnowledgeSource']!.properties!['language']!.pattern).toBe(
        KNOWLEDGE_LANGUAGE_PATTERN.source,
      );
    });

    it("keeps NULL out of the id lists and a table row's address whole", async () => {
      const source = await addSource();
      const update = (set: string) =>
        attempt(owner, (tx) =>
          tx.$executeRawUnsafe(
            `UPDATE knowledge_sources SET ${set} WHERE id = $1::uuid`,
            source.id,
          ),
        );
      expect(await update(`ai_agent_ids = ARRAY[NULL]::uuid[]`)).toMatch(/scope_ids_check/);
      expect(await update(`brand_ids = ARRAY[gen_random_uuid(), NULL]`)).toMatch(/scope_ids_check/);
      expect(await update(`source_table = 'bonuses'`)).toMatch(/source_row_check/);
      expect(await update(`source_row_id = gen_random_uuid()`)).toMatch(/source_row_check/);
      // A row's address makes a `table_row` source, and only that (tm 310.2).
      expect(
        await update(`source_table = 'kb_bonuses', source_row_id = gen_random_uuid()`),
      ).toMatch(/table_row_check/);
      expect(await update(`type = 'table_row'`)).toMatch(/table_row_check/);
      expect(
        await update(
          `type = 'table_row', source_table = 'kb_bonuses', source_row_id = gen_random_uuid()`,
        ),
      ).toBeNull();
      expect(await update(`language = 'Turkish'`)).toMatch(/language_check/);
      expect(await update(`review_interval_days = 0`)).toMatch(/review_interval_days_check/);
    });

    it("has the knowledge filter's indexes built and valid — GIN on audiences and brands, one source per article", async () => {
      const indexes = await owner.$queryRaw<
        Array<{ name: string; method: string; valid: boolean; unique: boolean }>
      >`
        SELECT c.relname AS name, am.amname AS method, i.indisvalid AS valid, i.indisunique AS unique
          FROM pg_index i
          JOIN pg_class c ON c.oid = i.indexrelid
          JOIN pg_am am ON am.oid = c.relam
         WHERE c.relname IN ('knowledge_sources_audiences_idx', 'knowledge_sources_brand_ids_idx',
                             'knowledge_sources_kb_article_id_key')
         ORDER BY c.relname`;
      expect(indexes).toEqual([
        { name: 'knowledge_sources_audiences_idx', method: 'gin', valid: true, unique: false },
        { name: 'knowledge_sources_brand_ids_idx', method: 'gin', valid: true, unique: false },
        { name: 'knowledge_sources_kb_article_id_key', method: 'btree', valid: true, unique: true },
      ]);
    });

    it('mirrors a KB article by one source at most, and the source goes with the article', async () => {
      const article = await owner.kbArticle.create({
        data: { licenseId: fx.a.licenseId, slug: 'limits', title: 'Limits', body: 'Daily limit.' },
        select: { id: true },
      });
      const mirror = await owner.knowledgeSource.create({
        data: {
          aiAgentId: aiAgentA,
          licenseId: fx.a.licenseId,
          type: 'article',
          name: 'Limits',
          content: 'Daily limit.',
          kbArticleId: article.id,
        },
        select: { id: true },
      });
      await owner.knowledgeChunk.create({
        data: { sourceId: mirror.id, licenseId: fx.a.licenseId, chunkText: 'Daily limit.' },
      });

      await expect(
        owner.knowledgeSource.create({
          data: {
            aiAgentId: aiAgentA,
            licenseId: fx.a.licenseId,
            type: 'article',
            name: 'Limits again',
            kbArticleId: article.id,
          },
        }),
      ).rejects.toThrow(/Unique constraint/);

      await owner.kbArticle.delete({ where: { id: article.id } });
      expect(await owner.knowledgeSource.count({ where: { id: mirror.id } })).toBe(0);
      expect(await owner.knowledgeChunk.count({ where: { sourceId: mirror.id } })).toBe(0);
    });

    it("dates an older source's review from its last edit — the backfill, replayed", async () => {
      const source = await addSource();
      const lastEdit = new Date('2026-03-01T10:00:00Z');
      const statement = readFileSync(
        join(
          process.cwd(),
          'prisma',
          'migrations',
          '20261020220100_knowledge_sources_reviewed_at_backfill',
          'migration.sql',
        ),
        'utf8',
      )
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('--'))
        .join('\n')
        .trim()
        .replace(/;$/, '');
      expect(statement).not.toContain(';');

      let replayed: Date | null = null;
      await owner
        .$transaction(async (tx) => {
          // As the source stood when the column arrived: the migration's moment.
          await tx.$executeRaw`
            UPDATE knowledge_sources SET updated_at = ${lastEdit}, reviewed_at = now()
             WHERE id = ${source.id}::uuid`;
          await tx.$executeRawUnsafe(statement);
          const row = await tx.knowledgeSource.findUniqueOrThrow({
            where: { id: source.id },
            select: { reviewedAt: true },
          });
          replayed = row.reviewedAt;
          throw ROLLBACK;
        })
        .catch((error: unknown) => {
          if (error !== ROLLBACK) throw error;
        });
      expect(replayed).toEqual(lastEdit);
    });
  });

  // ==========================================================================

  describe('every write files the scope the source has today', () => {
    it("files an AI agent's source for the AI and Copilot, that agent alone — on all three ways in", async () => {
      const single = await addSource();
      const file = await server.post(
        '/knowledge-sources/file',
        {
          ai_agent_id: aiAgentA,
          filename: 'shipping.txt',
          content_type: 'text/plain',
          data: Buffer.from('We ship worldwide.', 'utf8').toString('base64'),
        },
        auth(writeA),
      );
      expect(file.statusCode).toBe(201);
      const bulk = await server.post(
        '/knowledge-sources/bulk',
        {
          ai_agent_id: aiAgentA,
          csv: 'name,type,content,source_url\nReturns,faq,Within 30 days.,',
        },
        auth(writeA),
      );
      expect(bulk.statusCode).toBe(200);
      const bulkId = (bulk.json() as { results: Array<{ id: string }> }).results[0]!.id;

      for (const id of [single.id, (file.json() as SourceView).id, bulkId]) {
        expect(await scopeOf(id)).toEqual({
          audiences: ['ai_agent', 'copilot'],
          aiAgentIds: [aiAgentA],
          brandIds: [],
        });
      }
    });

    it('files a Copilot source for agents only, whichever route files it under the Copilot record (FR-MOD-12.2)', async () => {
      const viaCopilot = await server.post(
        '/copilot/knowledge',
        { name: 'Escalations', type: 'article', content: 'Ask the duty lead first.' },
        auth(writeA),
      );
      expect(viaCopilot.statusCode).toBe(201);
      const copilotId = (viaCopilot.json() as { id: string }).id;
      expect(await scopeOf(copilotId)).toEqual({
        audiences: ['copilot'],
        aiAgentIds: [],
        brandIds: [],
      });

      // The AI agent route takes any agent record; filed under Copilot's, the
      // source is Copilot's — never the players'.
      const copilotAgent = await owner.aiAgent.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, kind: 'copilot' },
        select: { id: true },
      });
      const viaPlaybook = await addSource({}, writeA, copilotAgent.id);
      expect(await scopeOf(viaPlaybook.id)).toEqual({
        audiences: ['copilot'],
        aiAgentIds: [],
        brandIds: [],
      });
    });
  });

  // ==========================================================================

  describe('owner, language and review (AI-14-S3)', () => {
    it('reviews a new source as it is added and names it due 90 days later', async () => {
      const before = Date.now();
      const source = await addSource();
      const reviewedAt = Date.parse(source.reviewed_at);
      expect(reviewedAt).toBeGreaterThanOrEqual(before - 1000);
      expect(reviewedAt).toBeLessThanOrEqual(Date.now() + 1000);
      expect(source).toMatchObject({
        review_interval_days: 90,
        owner_id: null,
        owner_name: null,
        language: null,
      });
      expect(Date.parse(source.review_due_at) - reviewedAt).toBe(90 * DAY_MS);
      // The list says the same.
      expect((await list()).find((s) => s.id === source.id)).toMatchObject({
        reviewed_at: source.reviewed_at,
        review_due_at: source.review_due_at,
      });
    });

    it('keeps the owner and the language a create names — a tag as its primary subtag', async () => {
      const source = await addSource({
        owner_id: fx.a.agentAccountId,
        language: 'tr-TR',
        review_interval_days: 30,
      });
      expect(source).toMatchObject({
        owner_id: fx.a.agentAccountId,
        owner_name: 'Agent a',
        language: 'tr',
        review_interval_days: 30,
      });
      expect(Date.parse(source.review_due_at) - Date.parse(source.reviewed_at)).toBe(30 * DAY_MS);
    });

    it('refuses an owner from another workspace and a value that is no language tag, writing nothing', async () => {
      const stranger = await server.post(
        '/knowledge-sources',
        {
          ai_agent_id: aiAgentA,
          name: 'Shipping',
          type: 'faq',
          content: 'We ship worldwide.',
          owner_id: fx.b.ownerAccountId,
        },
        auth(writeA),
      );
      expect(stranger.statusCode).toBe(400);
      expect(stranger.json().error.message).toMatch(/^owner_id:/);

      const babble = await server.post(
        '/knowledge-sources',
        {
          ai_agent_id: aiAgentA,
          name: 'Shipping',
          type: 'faq',
          content: 'We ship worldwide.',
          language: 'Turkish please',
        },
        auth(writeA),
      );
      expect(babble.statusCode).toBe(400);
      expect(babble.json().error.message).toMatch(/^language:/);

      const interval = await server.post(
        '/knowledge-sources',
        {
          ai_agent_id: aiAgentA,
          name: 'Shipping',
          type: 'faq',
          content: 'We ship worldwide.',
          review_interval_days: 366,
        },
        auth(writeA),
      );
      expect(interval.statusCode).toBe(400);
      expect(await owner.knowledgeSource.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('sets and clears owner, language and interval on an edit of any type — and an edit is not a review', async () => {
      const website = await addSource({
        type: 'website',
        content: undefined,
        source_url: 'https://help.example.com/shipping',
      });
      await reviewedDaysAgo(website.id, 10);
      const reviewedAt = (
        await owner.knowledgeSource.findUniqueOrThrow({ where: { id: website.id } })
      ).reviewedAt.toISOString();

      const edited = await server.patch(
        `/knowledge-sources/${website.id}`,
        { owner_id: fx.a.agentAccountId, language: 'EN', review_interval_days: 7 },
        auth(writeA),
      );
      expect(edited.statusCode).toBe(200);
      const view = edited.json() as SourceView;
      expect(view).toMatchObject({
        owner_id: fx.a.agentAccountId,
        owner_name: 'Agent a',
        language: 'en',
        review_interval_days: 7,
        reviewed_at: reviewedAt,
      });
      // A new interval counts from the last review, not from now: due already.
      expect(Date.parse(view.review_due_at)).toBe(Date.parse(reviewedAt) + 7 * DAY_MS);
      expect(Date.parse(view.review_due_at)).toBeLessThan(Date.now());

      const cleared = await server.patch(
        `/knowledge-sources/${website.id}`,
        { owner_id: null, language: null },
        auth(writeA),
      );
      expect(cleared.json()).toMatchObject({ owner_id: null, owner_name: null, language: null });

      const stranger = await server.patch(
        `/knowledge-sources/${website.id}`,
        { owner_id: fx.b.ownerAccountId },
        auth(writeA),
      );
      expect(stranger.statusCode).toBe(400);
    });

    it('moves reviewed_at only on a review — a reindex fetches the text again and leaves it', async () => {
      const source = await addSource();
      await reviewedDaysAgo(source.id, 100);
      const stale = await owner.knowledgeSource.findUniqueOrThrow({ where: { id: source.id } });

      const reindexed = await server.post(
        `/knowledge-sources/${source.id}/reindex`,
        {},
        auth(writeA),
      );
      expect(reindexed.statusCode).toBe(200);
      expect((reindexed.json() as SourceView).reviewed_at).toBe(stale.reviewedAt.toISOString());

      const before = Date.now();
      const reviewed = await server.post(
        `/knowledge-sources/${source.id}/review`,
        {},
        auth(writeA),
      );
      expect(reviewed.statusCode).toBe(200);
      const view = reviewed.json() as SourceView;
      expect(Date.parse(view.reviewed_at)).toBeGreaterThanOrEqual(before - 1000);
      expect(Date.parse(view.review_due_at) - Date.parse(view.reviewed_at)).toBe(90 * DAY_MS);
      // Nothing about what it says changed.
      expect(view).toMatchObject({
        id: source.id,
        status: 'ready',
        chunk_count: source.chunk_count,
      });
      const after = await owner.knowledgeSource.findUniqueOrThrow({ where: { id: source.id } });
      expect(after.content).toBe(stale.content);
      expect(after.updatedAt.getTime()).toBe(Date.parse(view.reviewed_at));
    });

    it("refuses to review what it cannot see — another workspace's source, an unknown id, a read-only token", async () => {
      const source = await addSource();
      expect(
        (await server.post(`/knowledge-sources/${source.id}/review`, {}, auth(writeB))).statusCode,
      ).toBe(404);
      expect(
        (
          await server.post(
            '/knowledge-sources/00000000-0000-4000-8000-000000000000/review',
            {},
            auth(writeA),
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await server.post(`/knowledge-sources/${source.id}/review`, {}, auth(readA))).statusCode,
      ).toBe(403);
    });

    it('lists the sources due a review with ?stale=true and the rest with false, composing with ?owner_id', async () => {
      const mine = await addSource({ name: 'Mine, stale', owner_id: fx.a.agentAccountId });
      const nobodys = await addSource({ name: 'Unowned, stale' });
      const fresh = await addSource({ name: 'Mine, fresh', owner_id: fx.a.agentAccountId });
      await reviewedDaysAgo(mine.id, 91);
      await reviewedDaysAgo(nobodys.id, 200);
      const ids = (items: SourceView[]) => items.map((s) => s.id).sort();

      expect(ids(await list('?stale=true'))).toEqual([mine.id, nobodys.id].sort());
      expect(ids(await list('?stale=false'))).toEqual([fresh.id]);
      expect(ids(await list(`?owner_id=${fx.a.agentAccountId}`))).toEqual(
        [mine.id, fresh.id].sort(),
      );
      expect(ids(await list(`?stale=true&owner_id=${fx.a.agentAccountId}`))).toEqual([mine.id]);
      // Licence B sees none of it.
      expect(await list('?stale=true', writeB)).toEqual([]);

      // Reviewed, it is no longer due.
      await server.post(`/knowledge-sources/${mine.id}/review`, {}, auth(writeA));
      expect(ids(await list('?stale=true'))).toEqual([nobodys.id]);

      expect((await server.get('/knowledge-sources?stale=maybe', auth(writeA))).statusCode).toBe(
        400,
      );
    });
  });

  // ==========================================================================

  describe("a KB article's AI audiences (AI-14-S2)", () => {
    const article = async (body: Record<string, unknown>) => {
      const response = await server.post(
        '/kb-articles',
        { title: 'Withdrawals', body: 'Paid within a day.', ...body },
        auth(writeA),
      );
      expect(response.statusCode).toBe(201);
      return response.json() as ArticleView;
    };
    const patch = (id: string, ai_audiences: unknown) =>
      server.patch(`/kb-articles/${id}`, { ai_audiences }, auth(writeA));

    it('opens an article to the AI agent and Copilot unless switched off, kept in one spelling', async () => {
      const open = await article({});
      expect(open.ai_audiences).toEqual(['ai_agent', 'copilot']);
      const off = await article({ slug: 'off', ai_audiences: [] });
      expect(off.ai_audiences).toEqual([]);

      const reordered = await patch(open.id, ['copilot', 'ai_agent']);
      expect(reordered.statusCode).toBe(200);
      expect((reordered.json() as ArticleView).ai_audiences).toEqual(['ai_agent', 'copilot']);
      expect(
        ((await patch(open.id, ['copilot', 'copilot'])).json() as ArticleView).ai_audiences,
      ).toEqual(['copilot']);
      expect(
        (await server.get(`/kb-articles/${open.id}`, auth(writeA))).json() as ArticleView,
      ).toMatchObject({ ai_audiences: ['copilot'] });

      expect((await patch(open.id, ['public_kb'])).statusCode).toBe(400);
      expect((await patch(open.id, ['ai_agent', 'copilot', 'copilot'])).statusCode).toBe(400);
    });
  });
});
