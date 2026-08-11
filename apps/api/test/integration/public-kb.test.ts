/**
 * Public knowledge base — anonymous reader surface (PUBKB-c · PRD §5.3).
 *
 * This is the first surface that serves org-scoped content with no `principal`,
 * so the properties under test are the security boundary itself:
 *
 *   - The tenant is derived from the `{workspaceSlug}` path segment through the
 *     SECURITY DEFINER resolver, and only an *opted-in* workspace resolves
 *     (`enabled = true`, licence not `canceled`).
 *   - Only *published* articles are served — a draft is invisible, and its text
 *     never reaches the wire.
 *   - Every miss is one indistinguishable 404 (NFR-S5): unknown slug, KB off,
 *     cancelled licence, draft, another workspace's article — same status, same
 *     body. Nothing about what exists can be enumerated, and a valid agent token
 *     grants no elevation.
 *   - The body carries no `license_id`/`created_by` or other internal identity.
 *
 * The negatives are written and asserted before the positives, the order the
 * requirement is actually defended in.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const A_SLUG = 'acme-support';
const B_SLUG = 'globex-help';

interface ArticleDetail {
  id: string;
  category_id: string | null;
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  published_at: string | null;
  updated_at: string;
}

describe('public KB anonymous read (PUBKB-c)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const pub = (slug: string) => `/public/kb/${slug}`;

  const enableKb = (licenseId: bigint, publicSlug: string, enabled = true) =>
    owner.kbSettings.create({ data: { licenseId, enabled, publicSlug } });

  const publish = (
    licenseId: bigint,
    input: {
      slug: string;
      title: string;
      body: string;
      excerpt?: string;
      status?: 'draft' | 'published';
      publishedAt?: Date | null;
      createdBy?: string;
      categoryId?: string;
    },
  ) => {
    const status = input.status ?? 'published';
    return owner.kbArticle.create({
      data: {
        licenseId,
        slug: input.slug,
        title: input.title,
        body: input.body,
        excerpt: input.excerpt ?? null,
        status,
        publishedAt: input.publishedAt ?? (status === 'published' ? new Date() : null),
        createdBy: input.createdBy ?? 'acct_secret_author',
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      },
    });
  };

  const addCategory = (licenseId: bigint, slug: string, name: string, position: number) =>
    owner.kbCategory.create({ data: { licenseId, slug, name, position } });

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
  });

  // --- 404 policy: every miss is indistinguishable (NFR-S5) ------------------

  it('answers 404 for an unknown workspace slug on every path', async () => {
    const articles = await server.get(`${pub('does-not-exist')}/articles`);
    const article = await server.get(`${pub('does-not-exist')}/articles/whatever`);
    const categories = await server.get(`${pub('does-not-exist')}/categories`);
    expect(articles.statusCode).toBe(404);
    expect(article.statusCode).toBe(404);
    expect(categories.statusCode).toBe(404);
  });

  it('answers 404 on every path when the workspace KB is switched off', async () => {
    // Enabled = false: a public address is set, but nothing is served through it.
    await enableKb(fx.a.licenseId, A_SLUG, false);
    await publish(fx.a.licenseId, { slug: 'p1', title: 'Published', body: 'Body.' });

    expect((await server.get(`${pub(A_SLUG)}/articles`)).statusCode).toBe(404);
    expect((await server.get(`${pub(A_SLUG)}/articles/p1`)).statusCode).toBe(404);
    expect((await server.get(`${pub(A_SLUG)}/categories`)).statusCode).toBe(404);
  });

  it('answers 404 when the licence is cancelled even with the KB enabled', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'p1', title: 'Published', body: 'Body.' });
    await owner.license.update({ where: { id: fx.a.licenseId }, data: { status: 'canceled' } });

    expect((await server.get(`${pub(A_SLUG)}/articles`)).statusCode).toBe(404);
    expect((await server.get(`${pub(A_SLUG)}/articles/p1`)).statusCode).toBe(404);
  });

  it('never serves a draft, and never leaks its text', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'live', title: 'Live', body: 'Public body.' });
    await publish(fx.a.licenseId, {
      slug: 'secret-draft',
      title: 'Secret',
      body: 'DRAFT-ONLY-SENTINEL text that must never reach a reader.',
      status: 'draft',
    });

    const detail = await server.get(`${pub(A_SLUG)}/articles/secret-draft`);
    expect(detail.statusCode).toBe(404);
    expect(detail.payload).not.toContain('DRAFT-ONLY-SENTINEL');

    const list = await server.get(`${pub(A_SLUG)}/articles`);
    const slugs = (list.json() as { items: ArticleDetail[] }).items.map((a) => a.slug);
    expect(slugs).toContain('live');
    expect(slugs).not.toContain('secret-draft');
  });

  it("never resolves an article through another workspace's slug (cross-tenant, both directions)", async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await enableKb(fx.b.licenseId, B_SLUG);
    await publish(fx.a.licenseId, { slug: 'a-only', title: 'A', body: 'A body.' });
    await publish(fx.b.licenseId, { slug: 'b-only', title: 'B', body: 'B body.' });

    // B's article via A's workspace, and A's via B's — both 404.
    expect((await server.get(`${pub(A_SLUG)}/articles/b-only`)).statusCode).toBe(404);
    expect((await server.get(`${pub(B_SLUG)}/articles/a-only`)).statusCode).toBe(404);

    // Each is reachable only through its own workspace.
    expect((await server.get(`${pub(A_SLUG)}/articles/a-only`)).statusCode).toBe(200);
    expect((await server.get(`${pub(B_SLUG)}/articles/b-only`)).statusCode).toBe(200);
  });

  it('returns an identical 404 envelope for every kind of miss (un-enumerable)', async () => {
    // Four different reasons a lookup fails, all through the article-detail path.
    await enableKb(fx.a.licenseId, A_SLUG); // enabled workspace, for the draft case
    await enableKb(fx.b.licenseId, 'off-co', false); // a switched-off workspace
    await publish(fx.a.licenseId, { slug: 'a-draft', title: 'D', body: 'x', status: 'draft' });
    await publish(fx.b.licenseId, { slug: 'b-live', title: 'B', body: 'y' }); // B's, cross-tenant

    const misses = await Promise.all([
      server.get(`${pub('no-such-workspace')}/articles/x`), // unknown workspace
      server.get(`${pub('off-co')}/articles/x`), // KB switched off
      server.get(`${pub(A_SLUG)}/articles/a-draft`), // a draft
      server.get(`${pub(A_SLUG)}/articles/b-live`), // another workspace's article
    ]);

    const shapes = misses.map((r) => {
      const body = r.json() as { error: { type: string; message: string } };
      return { status: r.statusCode, type: body.error.type, message: body.error.message };
    });

    // Every reason answers the same status, type and message — only the
    // per-request id (which we exclude) differs.
    expect(shapes.every((s) => s.status === 404)).toBe(true);
    expect(new Set(shapes.map((s) => s.type)).size).toBe(1);
    expect(new Set(shapes.map((s) => s.message)).size).toBe(1);
  });

  // --- No elevation from a token on a public route ---------------------------

  it('gives a valid agent token exactly the same view as an anonymous reader', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'live', title: 'Live', body: 'Public.' });
    await publish(fx.a.licenseId, { slug: 'draft', title: 'Draft', body: 'x', status: 'draft' });
    const agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['agents-bot--all:rw'],
    });
    const auth = { authorization: `Bearer ${agentToken}` };

    // The published article is public with or without the token; the draft stays
    // a 404 — the public path grants no visibility the anonymous one lacks.
    const anon = await server.get(`${pub(A_SLUG)}/articles/live`);
    const withToken = await server.get(`${pub(A_SLUG)}/articles/live`, auth);
    expect(anon.statusCode).toBe(200);
    expect(withToken.statusCode).toBe(200);
    expect(withToken.json()).toEqual(anon.json());
    expect((await server.get(`${pub(A_SLUG)}/articles/draft`, auth)).statusCode).toBe(404);
  });

  // --- Reader-facing body only: no internal identity -------------------------

  it('never includes license_id or created_by in a served article', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, {
      slug: 'live',
      title: 'Live',
      body: 'Public body.',
      createdBy: 'acct_author_9999',
    });

    const res = await server.get(`${pub(A_SLUG)}/articles/live`);
    expect(res.statusCode).toBe(200);
    const article = res.json() as ArticleDetail & Record<string, unknown>;
    expect(article).not.toHaveProperty('license_id');
    expect(article).not.toHaveProperty('created_by');
    expect(article).not.toHaveProperty('status');
    // The author's account id is nowhere in the wire bytes either.
    expect(res.payload).not.toContain('acct_author_9999');
    // What a reader does get.
    expect(article.slug).toBe('live');
    expect(article.body).toBe('Public body.');
  });

  // --- Positives: ordering, detail, categories, keyset pagination ------------

  it('lists categories in display order without leaking internals', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await addCategory(fx.a.licenseId, 'second', 'Second', 2);
    await addCategory(fx.a.licenseId, 'first', 'First', 1);

    const res = await server.get(`${pub(A_SLUG)}/categories`);
    expect(res.statusCode).toBe(200);
    const items = (res.json() as { items: Array<Record<string, unknown>> }).items;
    expect(items.map((c) => c.name)).toEqual(['First', 'Second']);
    expect(items[0]).not.toHaveProperty('license_id');
  });

  it('paginates published articles newest-first by keyset', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, {
      slug: 'a1',
      title: 'A1',
      body: '1',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    await publish(fx.a.licenseId, {
      slug: 'a2',
      title: 'A2',
      body: '2',
      publishedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    await publish(fx.a.licenseId, {
      slug: 'a3',
      title: 'A3',
      body: '3',
      publishedAt: new Date('2026-01-03T00:00:00.000Z'),
    });

    const first = await server.get(`${pub(A_SLUG)}/articles?limit=2`);
    expect(first.statusCode).toBe(200);
    const firstPage = first.json() as { items: ArticleDetail[]; next_page_id?: string };
    expect(firstPage.items.map((a) => a.slug)).toEqual(['a3', 'a2']);
    expect(firstPage.next_page_id).toBeDefined();
    // The summary is body-less; the detail endpoint is where the body lives.
    expect(firstPage.items[0]).not.toHaveProperty('body');

    const second = await server.get(
      `${pub(A_SLUG)}/articles?limit=2&page_id=${encodeURIComponent(firstPage.next_page_id!)}`,
    );
    const secondPage = second.json() as { items: ArticleDetail[]; next_page_id?: string };
    expect(secondPage.items.map((a) => a.slug)).toEqual(['a1']);
    expect(secondPage.next_page_id).toBeUndefined();
  });

  it('serves the full body only on the detail endpoint', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, {
      slug: 'guide',
      title: 'Guide',
      body: 'The full body text.',
      excerpt: 'A short excerpt.',
    });

    const detail = (await server.get(`${pub(A_SLUG)}/articles/guide`)).json() as ArticleDetail;
    expect(detail.body).toBe('The full body text.');
    expect(detail.excerpt).toBe('A short excerpt.');
    expect(detail.published_at).not.toBeNull();
  });
});

// --- Rate limiting: a separate, higher bucket than the anon one --------------

describe('public KB rate limiting (PUBKB-c)', () => {
  let owner: PrismaClient;

  beforeAll(() => {
    owner = ownerClient();
  });

  afterAll(async () => {
    await owner.$disconnect();
  });

  it('uses the pubkb bucket (higher than anon) and 429s past it, without touching the anon bucket', async () => {
    const fx = await seedFixtures(owner);
    await owner.kbSettings.create({
      data: { licenseId: fx.a.licenseId, enabled: true, publicSlug: A_SLUG },
    });
    await owner.kbArticle.create({
      data: {
        licenseId: fx.a.licenseId,
        slug: 'p1',
        title: 'P1',
        body: 'x',
        status: 'published',
        publishedAt: new Date(),
      },
    });

    // A tiny pubkb limit makes the boundary cheap to reach; anon stays at 30.
    const limited = await startTestServer({ RATE_LIMIT_PUBKB_PER_MIN: '2' });
    try {
      await clearRateLimits(limited.app);

      const r1 = await limited.get(`/public/kb/${A_SLUG}/articles`);
      const r2 = await limited.get(`/public/kb/${A_SLUG}/articles`);
      const r3 = await limited.get(`/public/kb/${A_SLUG}/articles`);

      expect(r1.statusCode).toBe(200);
      // The limit header proves the bucket is pubkb (2), not the shared anon 30.
      expect(r1.headers['x-ratelimit-limit']).toBe('2');
      expect(r2.statusCode).toBe(200);
      expect(r3.statusCode).toBe(429);
      expect(r3.headers['retry-after']).toBeDefined();

      // The anon bucket is a different key entirely: a sign-in is not swept up by
      // the exhausted pubkb bucket (never 429), and its limit is not the tiny
      // pubkb override — proving the two buckets neither share a key nor a limit.
      const login = await limited.post('/auth/login', {
        email: 'nobody@example.test',
        password: 'nope',
      });
      expect(login.statusCode).not.toBe(429);
      expect(login.headers['x-ratelimit-limit']).not.toBe('2');
    } finally {
      await limited.close();
    }
  });
});
