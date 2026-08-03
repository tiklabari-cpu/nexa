/**
 * Public KB — server-rendered SEO HTML surface (PUBKB-e · PRD §5.3-Knowledge).
 *
 * This surface is the first that answers `text/html` to an anonymous caller, so
 * the properties under test are (in the order the requirement is defended):
 *
 *   - The 404 policy carries over: every miss — unknown workspace, KB switched
 *     off, cancelled licence, draft, another workspace's article, malformed slug
 *     — is one indistinguishable `text/html` 404, and no scrap of the hidden
 *     content reaches the wire.
 *   - The stored-XSS boundary holds end-to-end: an article whose body carries
 *     `<img onerror>`/`<script>` produces *no* active tag on the page — the
 *     escape-first render (PUBKB-d) is what the HTML surface serves.
 *   - `seo_title`/`seo_description` cannot break out of an attribute.
 *   - "SEO'lu": the first bytes carry the title and full body with no script run,
 *     plus title/description/canonical/OpenGraph/`Article` JSON-LD.
 *   - a11y: a single `<h1>`, a `lang` attribute, `<main>`/`<nav>` landmarks.
 *
 * The negatives are asserted before the positives, matching public-kb.test.ts.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const A_SLUG = 'acme-support';
const B_SLUG = 'globex-help';

describe('public KB server-rendered HTML (PUBKB-e)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const home = (slug: string) => `/public/kb/${slug}`;
  const article = (slug: string, articleSlug: string) => `/public/kb/${slug}/${articleSlug}`;

  const enableKb = (licenseId: bigint, publicSlug: string, opts: { enabled?: boolean; siteTitle?: string } = {}) =>
    owner.kbSettings.create({
      data: {
        licenseId,
        enabled: opts.enabled ?? true,
        publicSlug,
        siteTitle: opts.siteTitle ?? null,
      },
    });

  const addCategory = (licenseId: bigint, slug: string, name: string, position: number) =>
    owner.kbCategory.create({ data: { licenseId, slug, name, position } });

  const publish = (
    licenseId: bigint,
    input: {
      slug: string;
      title: string;
      body: string;
      excerpt?: string;
      seoTitle?: string;
      seoDescription?: string;
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
        seoTitle: input.seoTitle ?? null,
        seoDescription: input.seoDescription ?? null,
        status,
        publishedAt: input.publishedAt ?? (status === 'published' ? new Date() : null),
        createdBy: input.createdBy ?? 'acct_secret_author',
        ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      },
    });
  };

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

  // --- 404 policy: every miss is an indistinguishable HTML 404 (NFR-S5) -------

  it('answers an HTML 404 for an unknown workspace on both the home and article paths', async () => {
    const h = await server.get(home('does-not-exist'));
    const a = await server.get(article('does-not-exist', 'whatever'));
    expect(h.statusCode).toBe(404);
    expect(a.statusCode).toBe(404);
    expect(h.headers['content-type']).toContain('text/html');
    expect(a.headers['content-type']).toContain('text/html');
    // The miss page is deliberately not indexed.
    expect(h.payload).toContain('noindex');
  });

  it('answers 404 when the workspace KB is switched off', async () => {
    await enableKb(fx.a.licenseId, A_SLUG, { enabled: false });
    await publish(fx.a.licenseId, { slug: 'p1', title: 'Published', body: 'Body.' });

    expect((await server.get(home(A_SLUG))).statusCode).toBe(404);
    expect((await server.get(article(A_SLUG, 'p1'))).statusCode).toBe(404);
  });

  it('answers 404 when the licence is cancelled even with the KB enabled', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'p1', title: 'Published', body: 'Body.' });
    await owner.license.update({ where: { id: fx.a.licenseId }, data: { status: 'canceled' } });

    expect((await server.get(home(A_SLUG))).statusCode).toBe(404);
    expect((await server.get(article(A_SLUG, 'p1'))).statusCode).toBe(404);
  });

  it('never renders a draft, and never leaks its text', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'live', title: 'Live', body: 'Public body.' });
    await publish(fx.a.licenseId, {
      slug: 'secret-draft',
      title: 'DRAFT-TITLE-SENTINEL',
      body: 'DRAFT-BODY-SENTINEL that must never reach a reader.',
      status: 'draft',
    });

    const detail = await server.get(article(A_SLUG, 'secret-draft'));
    expect(detail.statusCode).toBe(404);
    expect(detail.payload).not.toContain('DRAFT-BODY-SENTINEL');
    expect(detail.payload).not.toContain('DRAFT-TITLE-SENTINEL');

    // The home listing shows the live article and hides the draft entirely.
    const index = await server.get(home(A_SLUG));
    expect(index.statusCode).toBe(200);
    expect(index.payload).toContain('Live');
    expect(index.payload).not.toContain('DRAFT-TITLE-SENTINEL');
  });

  it("never renders an article through another workspace's slug (cross-tenant, both ways)", async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await enableKb(fx.b.licenseId, B_SLUG);
    await publish(fx.a.licenseId, { slug: 'a-only', title: 'A-ONLY', body: 'A body.' });
    await publish(fx.b.licenseId, { slug: 'b-only', title: 'B-ONLY', body: 'B body.' });

    const bViaA = await server.get(article(A_SLUG, 'b-only'));
    const aViaB = await server.get(article(B_SLUG, 'a-only'));
    expect(bViaA.statusCode).toBe(404);
    expect(aViaB.statusCode).toBe(404);
    expect(bViaA.payload).not.toContain('B-ONLY');
    expect(aViaB.payload).not.toContain('A-ONLY');

    // Each is reachable only through its own workspace.
    expect((await server.get(article(A_SLUG, 'a-only'))).statusCode).toBe(200);
    expect((await server.get(article(B_SLUG, 'b-only'))).statusCode).toBe(200);
  });

  // --- Stored-XSS boundary, end-to-end with PUBKB-d ---------------------------

  it('emits no active tag from a hostile article body (escape-first render)', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, {
      slug: 'xss',
      title: 'XSS test',
      body: '<img src=x onerror=alert(1)>\n\n<script>alert(document.cookie)</script>\n\nAfter the payload.',
    });

    const res = await server.get(article(A_SLUG, 'xss'));
    expect(res.statusCode).toBe(200);
    const html = res.payload;
    // The author's markup is inert text, not tags.
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;script&gt;');
    // The only <script> on the page is the inert JSON-LD block.
    expect(html).toContain('<script type="application/ld+json">');
    // The surrounding prose still renders, proving the body was served.
    expect(html).toContain('After the payload.');
  });

  it('keeps seo_title / seo_description from breaking out of their attributes', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, {
      slug: 'meta',
      title: 'Plain title',
      body: 'Body.',
      seoTitle: 'A "quoted" <b>title</b>',
      seoDescription: 'Desc with " quote and <tag> inside',
    });

    const res = await server.get(article(A_SLUG, 'meta'));
    expect(res.statusCode).toBe(200);
    const html = res.payload;
    // No raw quote/angle from the SEO fields survives into the markup.
    expect(html).not.toContain('<b>title</b>');
    expect(html).toContain('&lt;b&gt;title&lt;/b&gt;');
    expect(html).toContain('&quot;quoted&quot;');
    // The description is reduced to plain text (no tag), then attribute-escaped.
    expect(html).not.toContain('<tag>');
    expect(html).toMatch(/<meta name="description" content="[^"]*&quot;/);
  });

  // --- "SEO'lu": indexable first paint ---------------------------------------

  it('serves the title and full body in the first bytes with no script to run', async () => {
    await enableKb(fx.a.licenseId, A_SLUG, { siteTitle: 'Acme Help' });
    await publish(fx.a.licenseId, {
      slug: 'guide',
      title: 'Getting started',
      body: '## First steps\n\nThis is the DISTINCTIVE-BODY-PHRASE readers must see.',
    });

    const res = await server.get(article(A_SLUG, 'guide'));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const html = res.payload;

    // Title and body are present as raw bytes — no JS execution needed.
    expect(html).toContain('<title>Getting started</title>');
    expect(html).toContain('DISTINCTIVE-BODY-PHRASE');
    expect(html).toContain('<h2>First steps</h2>');
    // No script is loaded; the only <script> is inert JSON-LD.
    expect(html).not.toContain('<script src');
    expect(html).not.toContain('type="module"');
  });

  it('carries canonical, OpenGraph and Article JSON-LD matching the article', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, {
      slug: 'canon',
      title: 'Canonical Article',
      body: 'Body text.',
      excerpt: 'A short excerpt.',
    });

    const res = await server.get(article(A_SLUG, 'canon'));
    const html = res.payload;
    const expectedUrl = `http://localhost:4000/api/v1/public/kb/${A_SLUG}/canon`;

    expect(html).toContain(`<link rel="canonical" href="${expectedUrl}" />`);
    expect(html).toContain(`<meta property="og:url" content="${expectedUrl}" />`);
    expect(html).toContain('<meta property="og:type" content="article" />');
    expect(html).toContain('<meta property="og:title" content="Canonical Article" />');
    expect(html).toContain('<meta name="description" content="A short excerpt." />');

    // The JSON-LD block parses and describes this article.
    const match = /<script type="application\/ld\+json">(.+?)<\/script>/s.exec(html);
    expect(match).not.toBeNull();
    const ld = JSON.parse(match![1]!) as Record<string, unknown>;
    expect(ld['@type']).toBe('Article');
    expect(ld.headline).toBe('Canonical Article');
    expect(ld.url).toBe(expectedUrl);
  });

  it('escapes </script> inside a JSON-LD field so it cannot close the block', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, {
      slug: 'jsonld',
      title: 'Break</script><script>alert(1)</script>out',
      body: 'Body.',
    });

    const res = await server.get(article(A_SLUG, 'jsonld'));
    const html = res.payload;
    // The raw closing tag from the title never appears inside the JSON-LD.
    const match = /<script type="application\/ld\+json">(.+?)<\/script>/s.exec(html);
    expect(match).not.toBeNull();
    expect(match![1]).not.toContain('</script>');
    expect(match![1]).toContain('\\u003c');
    // And it still parses to the intended headline.
    const ld = JSON.parse(match![1]!) as Record<string, unknown>;
    expect(ld.headline).toBe('Break</script><script>alert(1)</script>out');
  });

  // --- Accessibility skeleton (NFR-A11Y1) ------------------------------------

  it('renders one h1, a lang attribute and main/nav landmarks', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    const cat = await addCategory(fx.a.licenseId, 'setup', 'Setup', 1);
    await publish(fx.a.licenseId, {
      slug: 'a11y',
      title: 'Accessible article',
      body: '## Section two\n\n### Subsection\n\nText.',
      categoryId: cat.id,
    });

    const res = await server.get(article(A_SLUG, 'a11y'));
    const html = res.payload;
    expect((html.match(/<h1/g) ?? []).length).toBe(1);
    expect(html).toMatch(/<html lang="[a-z-]+"/);
    expect(html).toContain('<main>');
    expect(html).toContain('<nav aria-label="Breadcrumb">');
    // The breadcrumb names the category between home and the article.
    expect(html).toContain('Setup');
    // Heading levels descend without skipping (h1 → h2 → h3).
    expect(html).toContain('<h2>Section two</h2>');
    expect(html).toContain('<h3>Subsection</h3>');
    expect(html).not.toContain('<h4');
  });

  // --- Home listing + route disambiguation -----------------------------------

  it('lists published articles on the home page and links to their pages', async () => {
    await enableKb(fx.a.licenseId, A_SLUG, { siteTitle: 'Acme Knowledge' });
    const cat = await addCategory(fx.a.licenseId, 'billing', 'Billing', 1);
    await publish(fx.a.licenseId, { slug: 'invoices', title: 'About invoices', body: 'x', categoryId: cat.id });
    await publish(fx.a.licenseId, { slug: 'loose', title: 'Uncategorised one', body: 'y' });

    const res = await server.get(home(A_SLUG));
    expect(res.statusCode).toBe(200);
    const html = res.payload;
    expect(html).toContain('<h1>Acme Knowledge</h1>');
    expect(html).toContain('<h2>Billing</h2>');
    expect(html).toContain(`href="http://localhost:4000/api/v1/public/kb/${A_SLUG}/invoices"`);
    expect(html).toContain('About invoices');
    expect(html).toContain('Uncategorised one');
    expect(html).toContain('<meta property="og:type" content="website" />');
  });

  it('does not shadow the JSON reader: /articles still answers JSON, not the HTML page', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'p1', title: 'P1', body: 'x' });

    const jsonList = await server.get(`${home(A_SLUG)}/articles`);
    expect(jsonList.statusCode).toBe(200);
    expect(jsonList.headers['content-type']).toContain('application/json');
    expect(() => jsonList.json()).not.toThrow();
  });

  // --- Caching: ETag + conditional request -----------------------------------

  it('sets a strong ETag and answers 304 to a matching If-None-Match', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'cached', title: 'Cached', body: 'Body.' });

    const first = await server.get(article(A_SLUG, 'cached'));
    expect(first.statusCode).toBe(200);
    const etag = first.headers['etag'];
    expect(etag).toBeDefined();
    expect(first.headers['cache-control']).toContain('max-age');

    const second = await server.get(article(A_SLUG, 'cached'), { 'if-none-match': etag as string });
    expect(second.statusCode).toBe(304);
    expect(second.payload).toBe('');
  });
});
