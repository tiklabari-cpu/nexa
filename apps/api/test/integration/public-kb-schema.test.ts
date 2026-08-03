/**
 * Public KB data model (PUBKB-a · PRD §5.3, v2).
 *
 * Schema-only slice — no routes yet (the CRUD contract is PUBKB-b, the
 * anonymous read path PUBKB-c). This proves the migration on its own against
 * the KK derived for it (PLAN §5.3):
 *
 *   - "self-servis" — an article can be filed under a category and read back
 *     joined; deleting a category clears the link rather than the article.
 *   - "SEO'lu" — seo_title/seo_description round-trip alongside status and
 *     published_at, and status is confined to draft/published.
 *   - "public" — kb_settings is a per-license singleton, and its public_slug
 *     is unique across the whole table, not just within one license.
 *
 * RLS isolation is proven the same way every other tenant table's is: a
 * license-A context sees zero rows of license B's, for SELECT, UPDATE and
 * DELETE alike (v2-04 §7.1). `knowledge_sources` is untouched by this
 * migration (§C-PUBKB-1) — nothing here reads or writes that table.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { ownerClient, seedFixtures, type Fixtures, type TenantFixture } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

describe('public KB schema (PUBKB-a)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;

  const under = (fixture: TenantFixture) => ({
    licenseId: fixture.licenseId,
    organizationId: fixture.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  // === KK "self-servis gezinme": category taxonomy ==========================
  describe('category taxonomy', () => {
    it('files an article under a category and reads the link back', async () => {
      const category = await owner.kbCategory.create({
        data: { licenseId: fx.a.licenseId, slug: 'billing', name: 'Billing', position: 1 },
      });
      const article = await owner.kbArticle.create({
        data: {
          licenseId: fx.a.licenseId,
          categoryId: category.id,
          slug: 'how-to-pay',
          title: 'How to pay',
          body: 'Body text.',
        },
      });

      const read = await withTenant(app, under(fx.a), (tx) =>
        tx.kbArticle.findUniqueOrThrow({ where: { id: article.id }, include: { category: true } }),
      );
      expect(read.category?.slug).toBe('billing');
      expect(read.category?.name).toBe('Billing');
    });

    it('keeps the article when its category is deleted, clearing the link', async () => {
      const category = await owner.kbCategory.create({
        data: { licenseId: fx.a.licenseId, slug: 'billing', name: 'Billing' },
      });
      const article = await owner.kbArticle.create({
        data: {
          licenseId: fx.a.licenseId,
          categoryId: category.id,
          slug: 'how-to-pay',
          title: 'How to pay',
          body: 'Body text.',
        },
      });

      await owner.kbCategory.delete({ where: { id: category.id } });

      const read = await owner.kbArticle.findUniqueOrThrow({ where: { id: article.id } });
      expect(read.categoryId).toBeNull();
    });
  });

  // === KK "SEO'lu": seo/publication columns round-trip =======================
  describe('SEO and publication columns', () => {
    it('writes and reads seo_title/seo_description/status/published_at', async () => {
      const publishedAt = new Date();
      const article = await owner.kbArticle.create({
        data: {
          licenseId: fx.a.licenseId,
          slug: 'refunds',
          title: 'Refund policy',
          body: 'Body text.',
          excerpt: 'How refunds work.',
          seoTitle: 'Refund Policy | Acme',
          seoDescription: 'Learn how refunds are processed at Acme.',
          status: 'published',
          publishedAt,
        },
      });

      const read = await owner.kbArticle.findUniqueOrThrow({ where: { id: article.id } });
      expect(read.seoTitle).toBe('Refund Policy | Acme');
      expect(read.seoDescription).toBe('Learn how refunds are processed at Acme.');
      expect(read.status).toBe('published');
      expect(read.publishedAt?.toISOString()).toBe(publishedAt.toISOString());
    });

    it('defaults a new article to draft with no published_at', async () => {
      const article = await owner.kbArticle.create({
        data: { licenseId: fx.a.licenseId, slug: 'draft-only', title: 'WIP', body: 'x' },
      });
      expect(article.status).toBe('draft');
      expect(article.publishedAt).toBeNull();
    });

    it('rejects a status outside draft/published', async () => {
      await expect(
        owner.kbArticle.create({
          data: {
            licenseId: fx.a.licenseId,
            slug: 'bad-status',
            title: 'Bad',
            body: 'x',
            status: 'archived',
          },
        }),
      ).rejects.toThrow(/kb_articles_status_check/i);
    });
  });

  // === KK "slug": uniqueness ==================================================
  describe('slug uniqueness', () => {
    it('refuses a second article with the same slug in the same license', async () => {
      await owner.kbArticle.create({
        data: { licenseId: fx.a.licenseId, slug: 'dup', title: 'First', body: 'x' },
      });
      await expect(
        owner.kbArticle.create({
          data: { licenseId: fx.a.licenseId, slug: 'dup', title: 'Second', body: 'y' },
        }),
      ).rejects.toThrow(/unique constraint/i);
    });

    it('allows the same slug reused in a different license', async () => {
      await owner.kbArticle.create({
        data: { licenseId: fx.a.licenseId, slug: 'shared', title: 'A', body: 'x' },
      });
      await expect(
        owner.kbArticle.create({
          data: { licenseId: fx.b.licenseId, slug: 'shared', title: 'B', body: 'y' },
        }),
      ).resolves.toMatchObject({ slug: 'shared' });
    });

    it('refuses a second category with the same slug in the same license', async () => {
      await owner.kbCategory.create({
        data: { licenseId: fx.a.licenseId, slug: 'dup', name: 'First' },
      });
      await expect(
        owner.kbCategory.create({
          data: { licenseId: fx.a.licenseId, slug: 'dup', name: 'Second' },
        }),
      ).rejects.toThrow(/unique constraint/i);
    });
  });

  // === kb_settings: license-singleton + globally-unique public_slug ==========
  describe('kb_settings', () => {
    it('rejects a second settings row for the same license', async () => {
      await owner.kbSettings.create({
        data: { licenseId: fx.a.licenseId, publicSlug: `kb-${fx.a.licenseId}` },
      });
      await expect(
        owner.kbSettings.create({
          data: { licenseId: fx.a.licenseId, publicSlug: `kb-${fx.a.licenseId}-again` },
        }),
      ).rejects.toThrow(/unique constraint/i);
    });

    it('refuses the same public_slug reused by a different license', async () => {
      await owner.kbSettings.create({ data: { licenseId: fx.a.licenseId, publicSlug: 'shared-kb' } });
      await expect(
        owner.kbSettings.create({ data: { licenseId: fx.b.licenseId, publicSlug: 'shared-kb' } }),
      ).rejects.toThrow(/unique constraint/i);
    });

    it('defaults enabled to false', async () => {
      const settings = await owner.kbSettings.create({
        data: { licenseId: fx.a.licenseId, publicSlug: `kb-${fx.a.licenseId}` },
      });
      expect(settings.enabled).toBe(false);
    });
  });

  // === RLS cross-tenant isolation (NFR-S5) ====================================
  describe('RLS cross-tenant isolation', () => {
    let articleB: { id: string };

    beforeEach(async () => {
      articleB = await owner.kbArticle.create({
        data: { licenseId: fx.b.licenseId, slug: 'b-only', title: 'B only', body: 'x' },
      });
    });

    it("hides another license's article from SELECT", async () => {
      const rows = await withTenant(app, under(fx.a), (tx) =>
        tx.kbArticle.findMany({ where: { id: articleB.id } }),
      );
      expect(rows).toHaveLength(0);
    });

    it('touches zero rows on UPDATE across licenses', async () => {
      const result = await withTenant(app, under(fx.a), (tx) =>
        tx.kbArticle.updateMany({ where: { id: articleB.id }, data: { title: 'hijacked' } }),
      );
      expect(result.count).toBe(0);
      const stillThere = await owner.kbArticle.findUniqueOrThrow({ where: { id: articleB.id } });
      expect(stillThere.title).toBe('B only');
    });

    it('touches zero rows on DELETE across licenses', async () => {
      const result = await withTenant(app, under(fx.a), (tx) =>
        tx.kbArticle.deleteMany({ where: { id: articleB.id } }),
      );
      expect(result.count).toBe(0);
      await expect(
        owner.kbArticle.findUniqueOrThrow({ where: { id: articleB.id } }),
      ).resolves.toBeDefined();
    });

    it("hides another license's category and settings the same way", async () => {
      const categoryB = await owner.kbCategory.create({
        data: { licenseId: fx.b.licenseId, slug: 'b-cat', name: 'B cat' },
      });
      await owner.kbSettings.create({ data: { licenseId: fx.b.licenseId, publicSlug: 'b-public' } });

      const categories = await withTenant(app, under(fx.a), (tx) =>
        tx.kbCategory.findMany({ where: { id: categoryB.id } }),
      );
      expect(categories).toHaveLength(0);

      const settings = await withTenant(app, under(fx.a), (tx) =>
        tx.kbSettings.findMany({ where: { licenseId: fx.b.licenseId } }),
      );
      expect(settings).toHaveLength(0);
    });
  });
});
