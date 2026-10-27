/**
 * The single knowledge store — move and read (tm 309.2 · SiyahTuş analysis
 * AI-14, owner decision K11 · `docs/adr/single-knowledge-store.md`; migration
 * 20261021000000).
 *
 * Retrieval reads who a source is for — audiences, AI agents, brands, end
 * date — instead of the agent record it is filed under. Pinned here:
 *
 *   - **One filter, said twice.** `knowledgeSourceServes` (`@siyahtus/types`)
 *     and `KnowledgeService.search`'s SQL agree on every combination, on the
 *     exact search and the approximate one.
 *   - **Audiences (AI-14 acceptance 1).** A source for the AI and Copilot
 *     answers the player and drafts the agent's reply; a source for agents
 *     only drafts the reply and never reaches the player.
 *   - **Brands (acceptance 2).** A brand's source answers that brand's chat,
 *     never another brand's nor one whose brand is not known — the player's
 *     answer and Copilot's draft alike.
 *   - **KB articles (acceptance 3, AI-14-S2).** Published, an article is found
 *     by the AI and Copilot; unpublished, switched off or deleted, it is not;
 *     edited, its new text replaces the old; a text the provider cannot embed
 *     leaves the article saved and its source answering nothing until the
 *     sweep indexes it; articles published before this release are indexed by
 *     the sweep.
 *   - **The move (acceptance 4 and 5).** The backfill, replayed on rows the
 *     column defaults left: both old views list the same items before and
 *     after, the sources answer with their chunks untouched, and a replay
 *     writes nothing.
 *   - **Writes.** The scope on create and edit, the filing that follows it,
 *     the refusals, the list's views, the item routes over the whole store,
 *     and a KB article's source being the article's.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toVectorLiteral } from '@siyahtus/ai-mock';
import {
  knowledgeSourceServes,
  splitSkillProcedure,
  type KnowledgeReader,
  type KnowledgeSourceScope,
} from '@siyahtus/types';
import { withTenant, type TenantContext } from '../../src/lib/tenant.js';
import { resolveEmbeddingInferenceProvider } from '../../src/services/ai/inference.js';
import { KbArticleKnowledgeSweeper } from '../../src/services/ai/kb-article-knowledge.js';
import { KnowledgeService } from '../../src/services/ai/knowledge-service.js';
import { EmbeddingProviderError } from '../../src/services/ai/provider/embedding-error.js';
import {
  FAKE_EMBEDDING_SPACE,
  FakeEmbeddingProvider,
  fakeEmbedding,
} from '../helpers/fake-embedding-provider.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { depositProcedure } from '../helpers/procedure-fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** For the AI and Copilot — the question below is answered from it. */
const SHARED = 'Çekim talepleri genellikle 24 saat içinde işlenir.';
const ASK_SHARED = 'Çekim talepleri ne kadar sürede işlenir?';
/** For agents only. */
const AGENTS_ONLY = 'Mobil uygulama güncellemesi mağazadan otomatik yüklenir.';
const ASK_AGENTS_ONLY = 'Mobil uygulama güncellemesi nasıl yüklenir?';
/** For one brand only. */
const BRAND_ONLY = 'Canlı destek hattımız her gün sabah dokuzdan gece on bire kadar açıktır.';
const ASK_BRAND_ONLY = 'Canlı destek hattı her gün hangi saatlerde açık?';
/** A KB article, before and after an edit. */
const KB_TITLE = 'Hesap kapatma';
const KB_BODY = 'Hesap kapatma isteği e-posta ile iletilir.';
const KB_BODY_EDITED = 'Hesap kapatma isteği yalnız yazılı dilekçe ile alınır.';
const ASK_KB = 'Hesap kapatma isteği nasıl iletilir?';

interface SourceView {
  id: string;
  ai_agent_id: string;
  name: string;
  status: string;
  chunk_count: number;
  audiences: string[];
  ai_agent_ids: string[];
  brand_ids: string[];
  valid_until: string | null;
  kb_article_id: string | null;
  last_refresh_error: string | null;
  reviewed_at: string;
}

describe('the single knowledge store — move and read (AI-14 · K11 · tm 309.2)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let tenant: TenantContext;
  let writeA: string;
  let writeB: string;
  let aiAgentA: string;
  let copilotA: string;
  let brandA: string;
  let brandB: string;
  let brandBHost: string;
  /** The server's one provider: every source and question here is in its space. */
  const embeddings = new FakeEmbeddingProvider();
  /** Exact whatever the scope, and approximate whatever the scope — the filter on both paths. */
  const exact = new KnowledgeService({ embeddings, exactSearchCeiling: 1_000_000 });
  const approximate = new KnowledgeService({ embeddings, exactSearchCeiling: 0 });

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const token = (t: Fixtures['a'], scopes: string[]) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes,
    });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer({}, { embeddings });
  });

  afterAll(async () => {
    await server.close();
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    embeddings.failWith(undefined);
    tenant = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };
    writeA = await token(fx.a, ['agents-bot--all:rw', 'chats--all:rw']);
    writeB = await token(fx.b, ['agents-bot--all:rw']);
    aiAgentA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'ai_agent', name: 'Ada', active: true },
        select: { id: true },
      })
    ).id;
    copilotA = (
      await owner.aiAgent.create({
        data: { licenseId: fx.a.licenseId, kind: 'copilot', name: 'Copilot', active: true },
        select: { id: true },
      })
    ).id;
    // The licence's default brand speaks for its trusted domain; a second
    // brand has a website of its own (WG-01, as in `chat-brand.test.ts`).
    brandA = await seedDefaultBrand(owner, fx.a.licenseId);
    brandB = (
      await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Second', slug: 'second' },
        select: { id: true },
      })
    ).id;
    brandBHost = `b.${fx.a.trustedDomain}`;
    await owner.website.create({
      data: { licenseId: fx.a.licenseId, brandId: brandB, domain: brandBHost },
    });
  });

  /** A source through the API, as the panel adds one. */
  const addSource = async (body: Record<string, unknown>, as = writeA) => {
    const response = await server.post(
      '/knowledge-sources',
      { ai_agent_id: aiAgentA, type: 'faq', ...body },
      auth(as),
    );
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as SourceView;
  };

  const list = async (query = '') => {
    const response = await server.get(`/knowledge-sources${query}`, auth(writeA));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: SourceView[] }).items.map((item) => item.id).sort();
  };

  const copilotList = async () => {
    const response = await server.get('/copilot/knowledge', auth(writeA));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: Array<{ id: string }> }).items
      .map((item) => item.id)
      .sort();
  };

  /** The sources `reader` would draw on for `question`, by the shipped exact search. */
  async function found(
    question: string,
    reader: KnowledgeReader,
    service: KnowledgeService = exact,
  ): Promise<Array<{ sourceId: string; text: string }>> {
    const asked = await service.embedQuery(question);
    const { chunks } = await withTenant(app, tenant, (tx) =>
      service.search(tx, tenant, asked, { reader, limit: 500 }),
    );
    return chunks.map((chunk) => ({ sourceId: chunk.sourceId, text: chunk.text }));
  }

  const player = (brandId: string | null = null): KnowledgeReader => ({
    audience: 'ai_agent',
    aiAgentId: aiAgentA,
    brandId,
  });

  // ==========================================================================

  describe('one filter, said twice — the types and the SQL agree', () => {
    it('admits exactly the sources knowledgeSourceServes admits, for every reader, on both searches', async () => {
      // Another agent's id for the filter to tell apart. A workspace has one AI
      // agent (tm 390.1), so Bea is a record of another kind; the filter reads ids.
      const bea = (
        await owner.aiAgent.create({
          data: { licenseId: fx.a.licenseId, kind: 'copilot', name: 'Bea' },
          select: { id: true },
        })
      ).id;
      const now = new Date();
      const ended = new Date(now.getTime() - 60_000);
      const later = new Date(now.getTime() + 86_400_000);
      const TEXT = 'Ortak bilgi kaynağı süzgeç eşleşme denemesi metni.';
      const planted: Array<{ id: string; scope: KnowledgeSourceScope }> = [];
      for (const audiences of [['ai_agent'], ['copilot'], ['ai_agent', 'copilot']]) {
        for (const aiAgentIds of [[], [aiAgentA], [bea]]) {
          for (const brandIds of [[], [brandA], [brandB], [brandA, brandB]]) {
            for (const validUntil of [null, later, ended]) {
              const source = await owner.knowledgeSource.create({
                data: {
                  aiAgentId: audiences.includes('ai_agent') ? aiAgentA : copilotA,
                  licenseId: fx.a.licenseId,
                  type: 'faq',
                  name: 'Matrix',
                  status: 'ready',
                  audiences,
                  aiAgentIds,
                  brandIds,
                  validUntil,
                },
                select: { id: true },
              });
              await owner.$executeRawUnsafe(
                `INSERT INTO knowledge_chunks
                   (id, source_id, license_id, chunk_text, embedding, embedding_space, token_count, position)
                 VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, $5, 7, 0)`,
                source.id,
                fx.a.licenseId.toString(),
                TEXT,
                toVectorLiteral(fakeEmbedding(TEXT)),
                FAKE_EMBEDDING_SPACE,
              );
              planted.push({
                id: source.id,
                scope: { audiences, aiAgentIds, brandIds, validUntil },
              });
            }
          }
        }
      }
      expect(planted).toHaveLength(108);

      const readers: KnowledgeReader[] = [];
      for (const aiAgentId of [aiAgentA, bea, null]) {
        for (const brandId of [brandA, brandB, null]) {
          readers.push({ audience: 'ai_agent', aiAgentId, brandId });
        }
      }
      for (const brandId of [brandA, brandB, null]) readers.push({ audience: 'copilot', brandId });
      readers.push({ audience: 'copilot' });

      for (const reader of readers) {
        const expected = planted
          .filter((source) => knowledgeSourceServes(source.scope, reader, new Date()))
          .map((source) => source.id)
          .sort();
        expect(expected.length, JSON.stringify(reader)).toBeGreaterThan(0);
        for (const service of [exact, approximate]) {
          const got = [...new Set((await found(TEXT, reader, service)).map((hit) => hit.sourceId))];
          expect(
            got.sort(),
            `${JSON.stringify(reader)} · ${service === exact ? 'exact' : 'approximate'}`,
          ).toEqual(expected);
        }
      }
    });
  });

  // ==========================================================================

  describe('who answers from what — the live turn and Copilot (AI-14 acceptance 1 and 2)', () => {
    beforeEach(async () => {
      // "Önce AI" (AI-11): the connection is the AI's from its first message,
      // and a procedure the questions are not about, so they reach the
      // knowledge path (as in `ai-knowledge-answer.test.ts`).
      const settings = await server.app.inject({
        method: 'PUT',
        url: server.url(`/ai-agents/${aiAgentA}/handoff-settings`),
        payload: { assignment_mode: 'ai_first' },
        headers: auth(writeA),
      });
      expect(settings.statusCode).toBe(200);
      const { procedure: body, ...own } = splitSkillProcedure(depositProcedure());
      await owner.skill.create({
        data: {
          licenseId: fx.a.licenseId,
          aiAgentId: aiAgentA,
          name: 'Yatırım geçmedi',
          kind: 'ai_agent',
          mode: 'procedure',
          whenToUse: own.when_to_use,
          examples: own.examples,
          priority: own.priority,
          slots: own.slots as object,
          procedure: body as object,
          active: true,
          updatedAt: new Date(),
        },
      });
    });

    /** A visitor on `host`'s site: a brand's member, a new one each time. */
    async function visitor(host = fx.a.trustedDomain): Promise<string> {
      const response = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: `https://${host}` },
        { origin: `https://${host}` },
      );
      expect(response.statusCode).toBe(200);
      return (response.json() as { token: string }).token;
    }

    /** One visitor message, answered: what the bot said and the sources the turn's record names. */
    async function say(visitorToken: string, text: string) {
      const response = await server.post('/customer/chat/events', { text }, auth(visitorToken));
      expect(response.statusCode).toBe(201);
      const chatId = (response.json() as { chat_id: string }).chat_id;
      const bot = await owner.event.findMany({
        where: { chatId, authorType: 'bot' },
        orderBy: { createdAt: 'asc' },
        select: { text: true },
      });
      const decisions = await owner.aiDecisionLog.findMany({
        where: { chatId },
        orderBy: { createdAt: 'asc' },
        select: { details: true },
      });
      const sourceIds = decisions.flatMap((row) => {
        const knowledge = (row.details as { knowledge?: { source_ids?: string[] } } | null)
          ?.knowledge;
        return knowledge?.source_ids ?? [];
      });
      return { chatId, said: bot.map((event) => event.text ?? ''), sourceIds };
    }

    /** Copilot's draft on a chat — from its latest customer message. */
    async function draft(chatId: string) {
      const response = await server.post(`/copilot/chats/${chatId}/reply`, undefined, auth(writeA));
      expect(response.statusCode, response.body).toBe(200);
      return response.json() as { draft: string; sources: Array<{ name: string }> };
    }

    it('answers the player and drafts the agent from a source for both; a source for agents only drafts, never answers (AI-14 acceptance 1 · FR-MOD-12.2)', async () => {
      const shared = await addSource({ name: 'Çekim', content: SHARED });
      expect(shared.audiences).toEqual(['ai_agent', 'copilot']);
      const agentsOnly = await addSource({
        name: 'Uygulama',
        content: AGENTS_ONLY,
        audiences: ['copilot'],
      });
      expect(agentsOnly).toMatchObject({ audiences: ['copilot'], ai_agent_id: copilotA });

      const answered = await say(await visitor(), ASK_SHARED);
      expect(answered.said).toEqual([SHARED]);
      expect(answered.sourceIds).toEqual([shared.id]);
      expect((await draft(answered.chatId)).draft).toContain(SHARED);

      const withheld = await say(await visitor(), ASK_AGENTS_ONLY);
      expect(withheld.sourceIds).not.toContain(agentsOnly.id);
      expect(withheld.said.join(' ')).not.toContain('mağazadan');
      // The agent's assistant still has it, on the very same chat.
      const drafted = await draft(withheld.chatId);
      expect(drafted.draft).toContain(AGENTS_ONLY);
      expect(drafted.sources[0]?.name).toBe('Uygulama');

      // And the preview — a player's answer too — never reads it either.
      expect((await found(ASK_AGENTS_ONLY, player())).map((hit) => hit.sourceId)).not.toContain(
        agentsOnly.id,
      );
    });

    it("keeps a brand's source to that brand's chats — never another brand's, nor one whose brand is not known (AI-14 acceptance 2)", async () => {
      await addSource({ name: 'Çekim', content: SHARED });
      const brandOnly = await addSource({
        name: 'Destek saatleri',
        content: BRAND_ONLY,
        brand_ids: [brandB],
      });
      expect(brandOnly.brand_ids).toEqual([brandB]);

      const inBrandB = await say(await visitor(brandBHost), ASK_BRAND_ONLY);
      expect(inBrandB.said).toEqual([BRAND_ONLY]);
      expect(inBrandB.sourceIds).toEqual([brandOnly.id]);
      expect((await draft(inBrandB.chatId)).draft).toContain(BRAND_ONLY);

      // The default brand's site: brand A's player gets nothing of brand B's.
      const inBrandA = await say(await visitor(), ASK_BRAND_ONLY);
      expect(
        await owner.chat.findUniqueOrThrow({
          where: { id: inBrandA.chatId },
          select: { brandId: true },
        }),
      ).toEqual({ brandId: brandA });
      expect(inBrandA.sourceIds).not.toContain(brandOnly.id);
      expect(inBrandA.said.join(' ')).not.toContain('dokuzdan');
      expect((await draft(inBrandA.chatId)).draft).not.toContain('dokuzdan');

      // A chat whose brand is not known — brand B's member, the chat's brand
      // gone (as a day through two brands leaves it): the every-brand sources only.
      const member = await visitor(brandBHost);
      const opened = await say(member, ASK_SHARED);
      expect(opened.said).toEqual([SHARED]);
      await owner.chat.update({ where: { id: opened.chatId }, data: { brandId: null } });
      const unknown = await say(member, ASK_BRAND_ONLY);
      expect(unknown.chatId).toBe(opened.chatId);
      expect(unknown.sourceIds).not.toContain(brandOnly.id);
      expect(unknown.said.join(' ')).not.toContain('dokuzdan');
      expect((await draft(unknown.chatId)).draft).not.toContain('dokuzdan');
    });

    it('answers nothing from a source past its end, and again once the end is lifted', async () => {
      const source = await addSource({
        name: 'Çekim',
        content: SHARED,
        valid_until: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(source.valid_until).not.toBeNull();
      expect(await found(ASK_SHARED, player())).toEqual([]);
      const lifted = await server.patch(
        `/knowledge-sources/${source.id}`,
        { valid_until: null },
        auth(writeA),
      );
      expect(lifted.statusCode).toBe(200);
      expect((await found(ASK_SHARED, player())).map((hit) => hit.sourceId)).toEqual([source.id]);
    });
  });

  // ==========================================================================

  describe('a published KB article in the knowledge store (AI-14 acceptance 3 · AI-14-S2)', () => {
    const article = async (body: Record<string, unknown> = {}) => {
      const response = await server.post(
        '/kb-articles',
        { title: KB_TITLE, body: KB_BODY, ...body },
        auth(writeA),
      );
      expect(response.statusCode).toBe(201);
      return (response.json() as { id: string }).id;
    };
    const patchArticle = async (id: string, body: Record<string, unknown>) => {
      const response = await server.patch(`/kb-articles/${id}`, body, auth(writeA));
      expect(response.statusCode, response.body).toBe(200);
    };
    const sourceOf = (articleId: string) =>
      owner.knowledgeSource.findUnique({
        where: { kbArticleId: articleId },
        include: { _count: { select: { chunks: true } } },
      });

    it('is found by the AI and Copilot once published, and no longer once unpublished, switched off or deleted', async () => {
      const id = await article();
      expect(await sourceOf(id)).toBeNull();

      await patchArticle(id, { status: 'published' });
      const published = await sourceOf(id);
      expect(published).toMatchObject({
        type: 'article',
        name: KB_TITLE,
        status: 'ready',
        audiences: ['ai_agent', 'copilot'],
        aiAgentIds: [],
        brandIds: [],
        validUntil: null,
        aiAgentId: aiAgentA,
      });
      expect(published!._count.chunks).toBeGreaterThan(0);
      // The publish is the source's review (ADR §2.6).
      const row = await owner.kbArticle.findUniqueOrThrow({ where: { id } });
      expect(published!.reviewedAt).toEqual(row.updatedAt);
      for (const reader of [player(brandA), player(null), { audience: 'copilot' } as const]) {
        expect((await found(ASK_KB, reader)).map((hit) => hit.sourceId)).toEqual([published!.id]);
      }

      await patchArticle(id, { status: 'draft' });
      expect(await sourceOf(id)).toBeNull();
      expect(await found(ASK_KB, { audience: 'copilot' })).toEqual([]);

      await patchArticle(id, { status: 'published' });
      expect(await sourceOf(id)).not.toBeNull();
      await patchArticle(id, { ai_audiences: [] });
      expect(await sourceOf(id)).toBeNull();
      expect(await found(ASK_KB, player())).toEqual([]);

      await patchArticle(id, { ai_audiences: ['ai_agent', 'copilot'] });
      expect(await sourceOf(id)).not.toBeNull();
      const deleted = await server.del(`/kb-articles/${id}`, auth(writeA));
      expect(deleted.statusCode).toBe(204);
      expect(await owner.knowledgeSource.count({ where: { kbArticleId: id } })).toBe(0);
      expect(await found(ASK_KB, { audience: 'copilot' })).toEqual([]);
    });

    it('answers from the edited text, never the old one, and keeps Copilot-only articles from players', async () => {
      const id = await article();
      await patchArticle(id, { status: 'published' });
      const before = (await sourceOf(id))!;

      await patchArticle(id, { body: KB_BODY_EDITED });
      const after = (await sourceOf(id))!;
      expect(after.id).toBe(before.id);
      expect(after.content).toBe(`${KB_TITLE}\n${KB_BODY_EDITED}`);
      const texts = (await found(ASK_KB, player())).map((hit) => hit.text).join(' ');
      expect(texts).toContain('dilekçe');
      expect(texts).not.toContain('e-posta');

      await patchArticle(id, { ai_audiences: ['copilot'] });
      const agentsOnly = (await sourceOf(id))!;
      expect(agentsOnly).toMatchObject({ audiences: ['copilot'], aiAgentId: copilotA });
      expect(await found(ASK_KB, player())).toEqual([]);
      expect((await found(ASK_KB, { audience: 'copilot' })).map((h) => h.sourceId)).toEqual([
        after.id,
      ]);
      // The old Copilot view lists what was added there, not an article's source.
      expect(await copilotList()).not.toContain(after.id);
    });

    it('saves the article when its text cannot be embedded, answers nothing from the old text, and the sweep indexes it', async () => {
      const id = await article();
      await patchArticle(id, { status: 'published' });

      embeddings.failWith(new EmbeddingProviderError('unavailable'));
      await patchArticle(id, { body: KB_BODY_EDITED });
      const row = await owner.kbArticle.findUniqueOrThrow({ where: { id } });
      expect(row.body).toBe(KB_BODY_EDITED);
      const held = (await sourceOf(id))!;
      expect(held).toMatchObject({
        status: 'indexing',
        content: `${KB_TITLE}\n${KB_BODY_EDITED}`,
      });
      expect(held._count.chunks).toBe(0);
      expect(held.lastRefreshError).toMatch(/embedding provider did not answer/);
      embeddings.failWith(undefined);
      expect(await found(ASK_KB, { audience: 'copilot' })).toEqual([]);

      const report = await new KbArticleKnowledgeSweeper(app, {
        knowledge: exact,
        embeddingInference: resolveEmbeddingInferenceProvider(testEnv()),
      }).run();
      expect(report.totals).toMatchObject({ synced: 1, deferred: 0 });
      const indexed = (await sourceOf(id))!;
      expect(indexed).toMatchObject({ status: 'ready', lastRefreshError: null });
      expect((await found(ASK_KB, player())).map((hit) => hit.text).join(' ')).toContain('dilekçe');

      // A pass with nothing behind writes nothing.
      const quiet = await new KbArticleKnowledgeSweeper(app, {
        knowledge: exact,
        embeddingInference: resolveEmbeddingInferenceProvider(testEnv()),
      }).run();
      expect(quiet.totals).toMatchObject({ checked: 0, synced: 0 });
    });

    it('indexes the articles published before this release, and removes a source its article no longer wants', async () => {
      // As a release without the hook left them: published, no source.
      const old = await owner.kbArticle.create({
        data: {
          licenseId: fx.a.licenseId,
          slug: 'hesap-kapatma',
          title: KB_TITLE,
          body: KB_BODY,
          status: 'published',
          publishedAt: new Date(),
        },
        select: { id: true },
      });
      const off = await owner.kbArticle.create({
        data: {
          licenseId: fx.a.licenseId,
          slug: 'kapali',
          title: 'Kapalı',
          body: 'Bu makale AI için kapalı.',
          status: 'published',
          publishedAt: new Date(),
          aiAudiences: [],
        },
        select: { id: true },
      });
      const sweeper = new KbArticleKnowledgeSweeper(app, {
        knowledge: exact,
        embeddingInference: resolveEmbeddingInferenceProvider(testEnv()),
      });
      expect((await sweeper.run()).totals).toMatchObject({ checked: 1, synced: 1 });
      expect(await sourceOf(off.id)).toBeNull();
      expect((await found(ASK_KB, player())).map((hit) => hit.sourceId)).toEqual([
        (await sourceOf(old.id))!.id,
      ]);

      // Unpublished by a release that wrote no hook: the sweep takes it out.
      await owner.kbArticle.update({ where: { id: old.id }, data: { status: 'draft' } });
      expect((await sweeper.run()).totals).toMatchObject({ checked: 1, synced: 1 });
      expect(await sourceOf(old.id)).toBeNull();
    });
  });

  // ==========================================================================

  describe('the move — the backfill on the rows the defaults left (AI-14 acceptance 4 and 5)', () => {
    const backfill = readFileSync(
      join(
        process.cwd(),
        'prisma',
        'migrations',
        '20261021000000_knowledge_sources_scope_backfill',
        'migration.sql',
      ),
      'utf8',
    )
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('--'))
      .join('\n')
      .trim()
      .replace(/;$/, '');

    /** A source as the release before tm 309.1 wrote one: filed, scope columns at their defaults. */
    async function legacySource(aiAgentId: string, name: string, text: string): Promise<string> {
      const source = await owner.knowledgeSource.create({
        data: { aiAgentId, licenseId: fx.a.licenseId, type: 'faq', name, status: 'ready' },
        select: { id: true },
      });
      await owner.$executeRawUnsafe(
        `INSERT INTO knowledge_chunks
           (id, source_id, license_id, chunk_text, embedding, embedding_space, token_count, position)
         VALUES (gen_random_uuid(), $1::uuid, $2::bigint, $3, $4::vector, $5, 7, 0)`,
        source.id,
        fx.a.licenseId.toString(),
        text,
        toVectorLiteral(fakeEmbedding(text)),
        FAKE_EMBEDDING_SPACE,
      );
      return source.id;
    }

    const chunkPrints = () =>
      owner.$queryRaw<Array<{ id: string; print: string }>>`
        SELECT id::text, md5(embedding::text) AS print FROM knowledge_chunks
         WHERE license_id = ${fx.a.licenseId} ORDER BY id`;

    it('is one statement, and lists the same sources in both old views before and after (acceptance 4)', async () => {
      expect(backfill).not.toContain(';');
      const shared = await legacySource(aiAgentA, 'Çekim', SHARED);
      const agentsOnly = await legacySource(copilotA, 'Uygulama', AGENTS_ONLY);
      const otherTenant = await owner.knowledgeSource.create({
        data: {
          aiAgentId: (
            await owner.aiAgent.create({
              data: { licenseId: fx.b.licenseId, kind: 'copilot', name: 'Copilot' },
              select: { id: true },
            })
          ).id,
          licenseId: fx.b.licenseId,
          type: 'faq',
          name: 'B',
          status: 'ready',
        },
        select: { id: true },
      });

      // What the release before this one listed: by the record each is filed under.
      const before = {
        aiAgent: (
          await owner.knowledgeSource.findMany({
            where: { licenseId: fx.a.licenseId, aiAgent: { kind: 'ai_agent' } },
            select: { id: true },
          })
        )
          .map((s) => s.id)
          .sort(),
        copilot: (
          await owner.knowledgeSource.findMany({
            where: { licenseId: fx.a.licenseId, aiAgent: { kind: 'copilot' } },
            select: { id: true },
          })
        )
          .map((s) => s.id)
          .sort(),
      };
      expect(before).toEqual({ aiAgent: [shared], copilot: [agentsOnly] });
      const updatedAt = await owner.knowledgeSource.findMany({
        select: { id: true, updatedAt: true, reviewedAt: true },
        orderBy: { id: 'asc' },
      });

      expect(await owner.$executeRawUnsafe(backfill)).toBe(3);
      expect(await list()).toEqual(before.aiAgent);
      expect(await copilotList()).toEqual(before.copilot);
      expect(
        await owner.knowledgeSource.findUniqueOrThrow({
          where: { id: agentsOnly },
          select: { audiences: true, aiAgentIds: true },
        }),
      ).toEqual({ audiences: ['copilot'], aiAgentIds: [] });
      expect(
        await owner.knowledgeSource.findUniqueOrThrow({
          where: { id: shared },
          select: { audiences: true, aiAgentIds: true },
        }),
      ).toEqual({ audiences: ['ai_agent', 'copilot'], aiAgentIds: [aiAgentA] });
      expect(
        (
          await owner.knowledgeSource.findUniqueOrThrow({
            where: { id: otherTenant.id },
            select: { audiences: true },
          })
        ).audiences,
      ).toEqual(['copilot']);
      // Nothing about the sources changed but who they are for.
      expect(
        await owner.knowledgeSource.findMany({
          select: { id: true, updatedAt: true, reviewedAt: true },
          orderBy: { id: 'asc' },
        }),
      ).toEqual(updatedAt);
      // A replay finds nothing left to write.
      expect(await owner.$executeRawUnsafe(backfill)).toBe(0);
    });

    it('answers from the moved sources with the chunks they had — nothing embedded again (acceptance 5)', async () => {
      const shared = await legacySource(aiAgentA, 'Çekim', SHARED);
      const agentsOnly = await legacySource(copilotA, 'Uygulama', AGENTS_ONLY);
      const prints = await chunkPrints();
      const calls = embeddings.calls.length;

      await owner.$executeRawUnsafe(backfill);

      expect(await chunkPrints()).toEqual(prints);
      expect(embeddings.calls.length).toBe(calls);
      expect((await found(ASK_SHARED, player())).map((h) => h.sourceId)).toEqual([shared]);
      expect(await found(ASK_AGENTS_ONLY, player())).toEqual([]);
      expect(
        (await found(ASK_AGENTS_ONLY, { audience: 'copilot', brandId: null })).map(
          (h) => h.sourceId,
        ),
      ).toEqual([agentsOnly]);
    });
  });

  // ==========================================================================

  describe('writing who a source is for', () => {
    it('files a source for agents only under Copilot, and moves the filing with the audiences', async () => {
      const source = await addSource({
        name: 'Uygulama',
        content: AGENTS_ONLY,
        audiences: ['copilot', 'copilot'],
      });
      expect(source).toMatchObject({
        audiences: ['copilot'],
        ai_agent_ids: [aiAgentA],
        ai_agent_id: copilotA,
      });
      expect(await copilotList()).toContain(source.id);
      expect(await list()).not.toContain(source.id);
      expect(await list('?audience=all')).toContain(source.id);
      expect(await list('?audience=copilot')).toContain(source.id);

      const widened = await server.patch(
        `/knowledge-sources/${source.id}`,
        { audiences: ['ai_agent', 'copilot'] },
        auth(writeA),
      );
      expect(widened.statusCode).toBe(200);
      expect(widened.json()).toMatchObject({
        audiences: ['ai_agent', 'copilot'],
        ai_agent_id: aiAgentA,
      });
      expect(await copilotList()).not.toContain(source.id);
      expect(await list()).toContain(source.id);

      // For every AI agent: filed under the workspace's oldest.
      const every = await server.patch(
        `/knowledge-sources/${source.id}`,
        { ai_agent_ids: [] },
        auth(writeA),
      );
      expect(every.json()).toMatchObject({ ai_agent_ids: [], ai_agent_id: aiAgentA });
    });

    it("lists a brand's view — its sources and every brand's — and refuses what is not this workspace's, writing nothing", async () => {
      const everyBrand = await addSource({ name: 'Çekim', content: SHARED });
      const brandOnly = await addSource({
        name: 'Saatler',
        content: BRAND_ONLY,
        brand_ids: [brandA],
      });
      expect(await list(`?brand_id=${brandA}`)).toEqual([everyBrand.id, brandOnly.id].sort());
      expect(await list(`?brand_id=${brandB}`)).toEqual([everyBrand.id]);

      const foreignBrand = await seedDefaultBrand(owner, fx.b.licenseId);
      const foreignAgent = (
        await owner.aiAgent.create({
          data: { licenseId: fx.b.licenseId, kind: 'ai_agent', name: 'Yabancı' },
          select: { id: true },
        })
      ).id;
      const count = await owner.knowledgeSource.count();
      for (const [body, reason] of [
        [{ ai_agent_ids: [copilotA] }, 'knowledge_source_unknown_ai_agent'],
        [{ ai_agent_ids: [foreignAgent] }, 'knowledge_source_unknown_ai_agent'],
        [{ brand_ids: [foreignBrand] }, 'knowledge_source_unknown_brand'],
      ] as const) {
        const refused = await server.post(
          '/knowledge-sources',
          { ai_agent_id: aiAgentA, type: 'faq', name: 'X', content: SHARED, ...body },
          auth(writeA),
        );
        expect(refused.statusCode).toBe(400);
        expect(refused.json()).toMatchObject({ error: { details: { reason } } });
        const edit = await server.patch(`/knowledge-sources/${everyBrand.id}`, body, auth(writeA));
        expect(edit.statusCode).toBe(400);
      }
      const empty = await server.post(
        '/knowledge-sources',
        { ai_agent_id: aiAgentA, type: 'faq', name: 'X', content: SHARED, audiences: [] },
        auth(writeA),
      );
      expect(empty.statusCode).toBe(400);
      expect(await owner.knowledgeSource.count()).toBe(count);
      expect(
        (await owner.knowledgeSource.findUniqueOrThrow({ where: { id: everyBrand.id } })).brandIds,
      ).toEqual([]);
    });

    it('edits, reviews and reindexes any source of the store — the ones for agents only too — and still 404s another workspace', async () => {
      const agentsOnly = await addSource({
        name: 'Uygulama',
        content: AGENTS_ONLY,
        audiences: ['copilot'],
      });
      const renamed = await server.patch(
        `/knowledge-sources/${agentsOnly.id}`,
        { name: 'Mobil' },
        auth(writeA),
      );
      expect(renamed.statusCode).toBe(200);
      expect(
        (await server.post(`/knowledge-sources/${agentsOnly.id}/review`, undefined, auth(writeA)))
          .statusCode,
      ).toBe(200);
      expect(
        (await server.post(`/knowledge-sources/${agentsOnly.id}/reindex`, undefined, auth(writeA)))
          .statusCode,
      ).toBe(200);
      expect(
        (await server.patch(`/knowledge-sources/${agentsOnly.id}`, { name: 'B' }, auth(writeB)))
          .statusCode,
      ).toBe(404);
      expect(
        (await server.del(`/knowledge-sources/${agentsOnly.id}`, auth(writeB))).statusCode,
      ).toBe(404);
      expect(
        (await server.del(`/knowledge-sources/${agentsOnly.id}`, auth(writeA))).statusCode,
      ).toBe(204);
    });

    it("leaves a KB article's source to the article: its title, text and reach are refused here, its meta fields are not", async () => {
      const created = await server.post(
        '/kb-articles',
        { title: KB_TITLE, body: KB_BODY },
        auth(writeA),
      );
      const articleId = (created.json() as { id: string }).id;
      expect(
        (await server.patch(`/kb-articles/${articleId}`, { status: 'published' }, auth(writeA)))
          .statusCode,
      ).toBe(200);
      const source = (
        await owner.knowledgeSource.findUniqueOrThrow({ where: { kbArticleId: articleId } })
      ).id;

      for (const body of [
        { name: 'Başka' },
        { content: 'Başka metin.' },
        { audiences: ['copilot'] },
        { brand_ids: [brandA] },
        { ai_agent_ids: [aiAgentA] },
        { valid_until: null },
      ]) {
        const refused = await server.patch(`/knowledge-sources/${source}`, body, auth(writeA));
        expect(refused.statusCode, JSON.stringify(body)).toBe(400);
        expect(refused.json()).toMatchObject({
          error: {
            details: { reason: 'knowledge_source_from_kb_article', kb_article_id: articleId },
          },
        });
      }
      const deleted = await server.del(`/knowledge-sources/${source}`, auth(writeA));
      expect(deleted.statusCode).toBe(400);
      const meta = await server.patch(
        `/knowledge-sources/${source}`,
        { language: 'tr', review_interval_days: 30 },
        auth(writeA),
      );
      expect(meta.statusCode).toBe(200);
      expect(meta.json()).toMatchObject({
        kb_article_id: articleId,
        language: 'tr',
        review_interval_days: 30,
        name: KB_TITLE,
      });
      expect(await list('?audience=all')).toContain(source);
      expect(await copilotList()).not.toContain(source);
    });
  });
});
