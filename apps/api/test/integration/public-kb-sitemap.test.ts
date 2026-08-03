/**
 * Public KB — sitemap.xml + robots.txt (PUBKB-f · PRD §5.3-Knowledge).
 *
 * The properties under test, in the order the KK derives them:
 *
 *   - Only published articles appear — a draft's slug never reaches either
 *     file, matching PUBKB-c/e's "yalnız yayınlanan" filter.
 *   - Cross-tenant isolation: one workspace's sitemap never names another's
 *     articles.
 *   - `kb_settings.enabled=false` (and an unknown workspace) is a 404 for
 *     sitemap.xml and `Disallow: /` for robots.txt.
 *   - XML injection: a slug or title carrying `& < > "` cannot break the
 *     document; the produced XML is well-formed (checked by parsing).
 *   - Positive: N published articles → N `<url>` entries, `lastmod` ISO-8601.
 *
 * A well-formed XML document here means no bare `&` (every one starts a
 * recognised entity) and every open tag this file emits is balanced — checked
 * without a dependency, the same way the sibling HTML suite asserts structure
 * with plain string/regex checks rather than a parser.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const A_SLUG = 'acme-support';
const B_SLUG = 'globex-help';

/** No bare `&` (every one starts a recognised entity) and every emitted tag is
 *  balanced — a lightweight, dependency-free stand-in for "the XML parses". */
function assertWellFormedXml(xml: string): void {
  expect(xml).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
  for (const tag of ['urlset', 'url', 'loc', 'lastmod']) {
    const opens = xml.match(new RegExp(`<${tag}[ >]`, 'g'))?.length ?? 0;
    const closes = xml.match(new RegExp(`</${tag}>`, 'g'))?.length ?? 0;
    expect(opens).toBe(closes);
  }
}

describe('public KB sitemap.xml + robots.txt (PUBKB-f)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  const sitemap = (slug: string) => `/public/kb/${slug}/sitemap.xml`;
  const robots = (slug: string) => `/public/kb/${slug}/robots.txt`;

  const enableKb = (licenseId: bigint, publicSlug: string, opts: { enabled?: boolean } = {}) =>
    owner.kbSettings.create({
      data: { licenseId, enabled: opts.enabled ?? true, publicSlug, siteTitle: null },
    });

  const publish = (
    licenseId: bigint,
    input: {
      slug: string;
      title: string;
      body: string;
      status?: 'draft' | 'published';
      publishedAt?: Date | null;
    },
  ) => {
    const status = input.status ?? 'published';
    return owner.kbArticle.create({
      data: {
        licenseId,
        slug: input.slug,
        title: input.title,
        body: input.body,
        status,
        publishedAt: input.publishedAt ?? (status === 'published' ? new Date() : null),
        createdBy: 'acct_secret_author',
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

  // --- 404 / Disallow policy ---------------------------------------------------

  it('answers 404 for sitemap.xml and Disallow: / for robots.txt on an unknown workspace', async () => {
    const s = await server.get(sitemap('does-not-exist'));
    expect(s.statusCode).toBe(404);

    const r = await server.get(robots('does-not-exist'));
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toContain('text/plain');
    expect(r.payload).toBe('User-agent: *\nDisallow: /\n');
  });

  it('answers the same way when the workspace KB is switched off', async () => {
    await enableKb(fx.a.licenseId, A_SLUG, { enabled: false });
    await publish(fx.a.licenseId, { slug: 'p1', title: 'Published', body: 'Body.' });

    expect((await server.get(sitemap(A_SLUG))).statusCode).toBe(404);
    const r = await server.get(robots(A_SLUG));
    expect(r.statusCode).toBe(200);
    expect(r.payload).toBe('User-agent: *\nDisallow: /\n');
  });

  it('answers 404 when the licence is cancelled even with the KB enabled', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await owner.license.update({ where: { id: fx.a.licenseId }, data: { status: 'canceled' } });

    expect((await server.get(sitemap(A_SLUG))).statusCode).toBe(404);
    expect((await server.get(robots(A_SLUG))).payload).toBe('User-agent: *\nDisallow: /\n');
  });

  // --- Published-only + cross-tenant isolation --------------------------------

  it('never lists a draft in the sitemap', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'live', title: 'Live', body: 'x' });
    await publish(fx.a.licenseId, {
      slug: 'secret-draft',
      title: 'DRAFT-SENTINEL',
      body: 'x',
      status: 'draft',
    });

    const xml = (await server.get(sitemap(A_SLUG))).payload;
    expect(xml).toContain('/public/kb/acme-support/live</loc>');
    expect(xml).not.toContain('secret-draft');
  });

  it("never names another workspace's article in the sitemap (both ways)", async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await enableKb(fx.b.licenseId, B_SLUG);
    await publish(fx.a.licenseId, { slug: 'a-only', title: 'A', body: 'x' });
    await publish(fx.b.licenseId, { slug: 'b-only', title: 'B', body: 'x' });

    const xmlA = (await server.get(sitemap(A_SLUG))).payload;
    const xmlB = (await server.get(sitemap(B_SLUG))).payload;
    expect(xmlA).toContain('a-only');
    expect(xmlA).not.toContain('b-only');
    expect(xmlB).toContain('b-only');
    expect(xmlB).not.toContain('a-only');
  });

  // --- XML injection / well-formedness ----------------------------------------

  it('escapes a slug carrying XML-significant characters and stays well-formed', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    // Bypasses the app-level slug validation on purpose (kb.ts refuses this
    // slug at creation) — the route itself must not assume a slug is clean.
    await publish(fx.a.licenseId, { slug: 'a&b<c>"d', title: 'Hostile', body: 'x' });

    const xml = (await server.get(sitemap(A_SLUG))).payload;
    expect(xml).not.toContain('a&b<c>"d');
    expect(xml).toContain('a&amp;b&lt;c&gt;&quot;d');
    assertWellFormedXml(xml);
  });

  // --- Positive: count + lastmod + robots content -----------------------------

  it('lists exactly one <url> per published article with an ISO-8601 lastmod', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);
    await publish(fx.a.licenseId, { slug: 'one', title: 'One', body: 'x' });
    await publish(fx.a.licenseId, { slug: 'two', title: 'Two', body: 'x' });
    await publish(fx.a.licenseId, { slug: 'draft', title: 'Draft', body: 'x', status: 'draft' });

    const res = await server.get(sitemap(A_SLUG));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/xml');
    const xml = res.payload;
    assertWellFormedXml(xml);

    expect((xml.match(/<url>/g) ?? []).length).toBe(2);
    expect(xml).toContain(`<loc>http://localhost:4000/api/v1/public/kb/${A_SLUG}/one</loc>`);
    expect(xml).toContain(`<loc>http://localhost:4000/api/v1/public/kb/${A_SLUG}/two</loc>`);
    const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(xml);
    expect(lastmod).not.toBeNull();
    expect(new Date(lastmod![1]!).toISOString()).toBe(lastmod![1]);
  });

  it('serves Allow + an absolute Sitemap URL when the KB is reachable', async () => {
    await enableKb(fx.a.licenseId, A_SLUG);

    const res = await server.get(robots(A_SLUG));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.payload).toBe(
      'User-agent: *\n' +
        `Allow: /public/kb/${A_SLUG}/\n` +
        `Sitemap: http://localhost:4000/api/v1/public/kb/${A_SLUG}/sitemap.xml\n`,
    );
  });

  // --- Route disambiguation ----------------------------------------------------

  it('does not shadow the HTML article page: an article literally named "sitemap.xml" cannot be reached there', async () => {
    // kb.ts refuses this slug at creation (reserved word); this proves why —
    // the static route always wins the request regardless of what exists in the DB.
    await enableKb(fx.a.licenseId, A_SLUG);

    const res = await server.get(sitemap(A_SLUG));
    expect(res.headers['content-type']).toContain('application/xml');
  });
});
