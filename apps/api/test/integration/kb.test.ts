/**
 * Public knowledge base — management surface (PUBKB-b · PRD §5.3).
 *
 * The KK derived for the public KB (PLAN §5.3) has three halves and this suite
 * proves each end-to-end:
 *
 *   - "yalnız yetkili bir eylemle yayınlanır" — a new article is a draft with no
 *     `published_at`; only an explicit `status: published` PATCH makes it public
 *     (and records an audit entry), and the reverse clears it.
 *   - "yalnız yönetici açar" — turning the workspace's KB on through
 *     `/kb-settings` is administrator-only: an agent-role token with the write
 *     scope is still refused, and enabling it is audited.
 *   - the slug is a clean ASCII token — normalised on save, and a duplicate or a
 *     non-ASCII value is a 400, not a stored surprise.
 *
 * Around them sit the guards most easily shipped unseen: one tenant never sees,
 * edits or deletes another's articles (a 404, never a 403 — NFR-S5), and the
 * read/write scope split holds.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Article {
  id: string;
  category_id: string | null;
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  status: 'draft' | 'published';
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

interface Category {
  id: string;
  slug: string;
  name: string;
  position: number;
  created_at: string;
}

interface Settings {
  enabled: boolean;
  public_slug: string | null;
  site_title: string | null;
  updated_at: string | null;
}

describe('public KB management (PUBKB-b)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const auditEntries = (licenseId: bigint, action: string) =>
    owner.auditLogEntry.findMany({ where: { licenseId, action } });

  const createArticle = (token: string, body: unknown) =>
    server.post('/kb-articles', body, auth(token));

  const validArticle = { title: 'How to pay', body: 'Pay with a card at checkout.' };

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
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
  });

  // --- Articles: create defaults to draft (KK) -------------------------------

  it('creates an article as a draft with no published_at and a normalised slug', async () => {
    const created = await createArticle(adminToken, { ...validArticle, slug: 'How To Pay' });
    expect(created.statusCode).toBe(201);
    const article = created.json() as Article;
    expect(article.status).toBe('draft');
    expect(article.published_at).toBeNull();
    expect(article.slug).toBe('how-to-pay');

    const got = await server.get(`/kb-articles/${article.id}`, auth(adminToken));
    expect(got.statusCode).toBe(200);
    expect((got.json() as Article).id).toBe(article.id);

    const list = await server.get('/kb-articles', auth(adminToken));
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: Article[] }).items.map((a) => a.id)).toContain(article.id);
  });

  it('derives a slug from the title when none is given', async () => {
    const created = await createArticle(adminToken, { title: 'Refund Policy', body: 'x' });
    expect((created.json() as Article).slug).toBe('refund-policy');
  });

  // --- Publish / unpublish is the one public-making action (KK + audit) ------

  it('publishes and unpublishes, stamping published_at and auditing each way', async () => {
    const { id } = (await createArticle(adminToken, validArticle)).json() as Article;

    const published = await server.patch(`/kb-articles/${id}`, { status: 'published' }, auth(adminToken));
    expect(published.statusCode).toBe(200);
    const pub = published.json() as Article;
    expect(pub.status).toBe('published');
    expect(pub.published_at).not.toBeNull();
    expect(await auditEntries(fx.a.licenseId, 'kb.article_published')).toHaveLength(1);

    const unpublished = await server.patch(`/kb-articles/${id}`, { status: 'draft' }, auth(adminToken));
    expect((unpublished.json() as Article).status).toBe('draft');
    expect((unpublished.json() as Article).published_at).toBeNull();
    expect(await auditEntries(fx.a.licenseId, 'kb.article_unpublished')).toHaveLength(1);
  });

  it('does not re-audit a status PATCH that changes nothing', async () => {
    const { id } = (await createArticle(adminToken, validArticle)).json() as Article;
    await server.patch(`/kb-articles/${id}`, { status: 'published' }, auth(adminToken));
    // Publishing again is a no-op — no second entry, no re-stamp churn.
    await server.patch(`/kb-articles/${id}`, { status: 'published' }, auth(adminToken));
    expect(await auditEntries(fx.a.licenseId, 'kb.article_published')).toHaveLength(1);
  });

  it('edits a body and title without touching publish state', async () => {
    const { id } = (await createArticle(adminToken, validArticle)).json() as Article;
    const edited = await server.patch(
      `/kb-articles/${id}`,
      { title: 'How to pay us', body: 'Updated body.' },
      auth(adminToken),
    );
    expect(edited.statusCode).toBe(200);
    const article = edited.json() as Article;
    expect(article.title).toBe('How to pay us');
    expect(article.status).toBe('draft');
  });

  it('deletes an article', async () => {
    const { id } = (await createArticle(adminToken, validArticle)).json() as Article;
    const removed = await server.del(`/kb-articles/${id}`, auth(adminToken));
    expect(removed.statusCode).toBe(204);
    expect((await server.get(`/kb-articles/${id}`, auth(adminToken))).statusCode).toBe(404);
  });

  // --- Slug validation (KK) --------------------------------------------------

  it('refuses a duplicate slug with a validation error', async () => {
    await createArticle(adminToken, { ...validArticle, slug: 'dup' });
    const clash = await createArticle(adminToken, { title: 'Other', body: 'y', slug: 'dup' });
    expect(clash.statusCode).toBe(400);
    expect((clash.json() as { error: { type: string } }).error.type).toBe('validation');
  });

  it('refuses an empty or non-ASCII slug rather than transliterating it', async () => {
    expect((await createArticle(adminToken, { ...validArticle, slug: '   ' })).statusCode).toBe(400);
    expect((await createArticle(adminToken, { ...validArticle, slug: 'Ürünler' })).statusCode).toBe(
      400,
    );
    // A non-ASCII title with no explicit slug cannot auto-derive one either.
    expect((await createArticle(adminToken, { title: 'Ürünler', body: 'x' })).statusCode).toBe(400);
  });

  it('refuses a reserved slug that would shadow a public static route (PUBKB-f)', async () => {
    for (const reserved of ['articles', 'categories', 'sitemap.xml', 'robots.txt']) {
      const res = await createArticle(adminToken, { ...validArticle, slug: reserved });
      expect(res.statusCode).toBe(400);
    }
    // A rename onto a reserved word is refused the same way.
    const created = await createArticle(adminToken, { ...validArticle, slug: 'renamable' });
    const { id } = created.json() as Article;
    const renamed = await server.patch(`/kb-articles/${id}`, { slug: 'robots.txt' }, auth(adminToken));
    expect(renamed.statusCode).toBe(400);
  });

  // --- Categories: CRUD + article filing -------------------------------------

  it('creates a category, files an article under it, and clears the link on delete', async () => {
    const category = (
      await server.post('/kb-categories', { name: 'Billing' }, auth(adminToken))
    ).json() as Category;
    expect(category.slug).toBe('billing');

    const article = (
      await createArticle(adminToken, { ...validArticle, category_id: category.id })
    ).json() as Article;
    expect(article.category_id).toBe(category.id);

    const removed = await server.del(`/kb-categories/${category.id}`, auth(adminToken));
    expect(removed.statusCode).toBe(204);

    // The article survives; only its category link is cleared (FK SET NULL).
    const after = (await server.get(`/kb-articles/${article.id}`, auth(adminToken))).json() as Article;
    expect(after.category_id).toBeNull();
  });

  it('lists categories in position order and edits one', async () => {
    await server.post('/kb-categories', { name: 'Second', position: 2 }, auth(adminToken));
    await server.post('/kb-categories', { name: 'First', position: 1 }, auth(adminToken));
    const listed = (
      await server.get('/kb-categories', auth(adminToken))
    ).json() as { items: Category[] };
    expect(listed.items.map((c) => c.name)).toEqual(['First', 'Second']);

    const edit = await server.patch(
      `/kb-categories/${listed.items[0]!.id}`,
      { name: 'Renamed' },
      auth(adminToken),
    );
    expect((edit.json() as Category).name).toBe('Renamed');
  });

  it('rejects a category referenced on an article that does not exist', async () => {
    const missing = await createArticle(adminToken, {
      ...validArticle,
      category_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(missing.statusCode).toBe(400);
  });

  // --- Cross-tenant isolation: 404, never 403 (NFR-S5) -----------------------

  it("never exposes one tenant's article to another (404 on GET/PATCH/DELETE)", async () => {
    const { id } = (await createArticle(adminToken, validArticle)).json() as Article;
    const bToken = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });

    expect((await server.get(`/kb-articles/${id}`, auth(bToken))).statusCode).toBe(404);
    expect(
      (await server.patch(`/kb-articles/${id}`, { title: 'hijack' }, auth(bToken))).statusCode,
    ).toBe(404);
    expect((await server.del(`/kb-articles/${id}`, auth(bToken))).statusCode).toBe(404);

    // Still there for its owner, untouched.
    expect(((await server.get(`/kb-articles/${id}`, auth(adminToken))).json() as Article).title).toBe(
      validArticle.title,
    );
  });

  // --- Scope split -----------------------------------------------------------

  it('lets a read-only holder list but not create', async () => {
    const readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:ro'],
    });
    expect((await server.get('/kb-articles', auth(readToken))).statusCode).toBe(200);
    expect((await createArticle(readToken, validArticle)).statusCode).toBe(403);
  });

  it('rejects a caller with no knowledge scope', async () => {
    const token = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
    expect((await server.get('/kb-articles', auth(token))).statusCode).toBe(403);
  });

  // --- Settings: singleton, admin-only, audited (KK) -------------------------

  it('returns the off default before the KB is ever configured', async () => {
    const settings = (await server.get('/kb-settings', auth(adminToken))).json() as Settings;
    expect(settings).toEqual({
      enabled: false,
      public_slug: null,
      site_title: null,
      updated_at: null,
    });
  });

  it('lets an administrator configure and enable the KB, auditing the switch', async () => {
    const put = await server.put(
      '/kb-settings',
      { enabled: true, public_slug: 'Acme Support', site_title: 'Acme Help' },
      auth(adminToken),
    );
    expect(put.statusCode).toBe(200);
    const settings = put.json() as Settings;
    expect(settings.enabled).toBe(true);
    expect(settings.public_slug).toBe('acme-support');
    expect(await auditEntries(fx.a.licenseId, 'kb.settings_updated')).toHaveLength(1);

    // Re-reads through GET, and an update that leaves `enabled` unchanged writes
    // no second audit entry.
    const again = await server.put('/kb-settings', { site_title: 'Acme Docs' }, auth(adminToken));
    expect((again.json() as Settings).site_title).toBe('Acme Docs');
    expect(await auditEntries(fx.a.licenseId, 'kb.settings_updated')).toHaveLength(1);
  });

  it('requires a public_slug the first time settings are written', async () => {
    const put = await server.put('/kb-settings', { enabled: true }, auth(adminToken));
    expect(put.statusCode).toBe(400);
  });

  it('refuses a public_slug already taken by another workspace (globally unique)', async () => {
    await server.put('/kb-settings', { public_slug: 'shared-address' }, auth(adminToken));
    const bAdmin = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    const clash = await server.put('/kb-settings', { public_slug: 'shared-address' }, auth(bAdmin));
    expect(clash.statusCode).toBe(400);
  });

  it('refuses an agent-role token even with the write scope (KK: yönetici açar)', async () => {
    const agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    const put = await server.put(
      '/kb-settings',
      { public_slug: 'nope', enabled: true },
      auth(agentToken),
    );
    expect(put.statusCode).toBe(403);
  });

  it('lets any knowledge scope read settings, admin or not', async () => {
    const agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['agents-bot--all:ro'],
    });
    expect((await server.get('/kb-settings', auth(agentToken))).statusCode).toBe(200);
  });
});
