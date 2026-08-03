/**
 * Public knowledge base — sitemap.xml + robots.txt (PUBKB-f · PRD §5.3-Knowledge).
 *
 * The last "SEO'lu" piece of the public KB: a crawler needs a machine-readable
 * index of what to fetch (`sitemap.xml`) and what it may fetch (`robots.txt`),
 * not just indexable pages. Both reuse `kb-public-read.ts`'s resolver and
 * published-only predicate — the same tenant resolution and the same
 * "yalnız yayınlanan" filter the JSON reader (PUBKB-c) and the HTML surface
 * (PUBKB-e) enforce — so this list can never diverge from what those two
 * surfaces actually serve. A draft's slug is never written to either file.
 *
 * `resolvePublicKbWorkspace` returns one indistinguishable `null` for an unknown
 * slug, a disabled KB or a cancelled licence (NFR-S5). The two files answer that
 * miss differently, matching each format's own convention: sitemap.xml turns it
 * into a 404 (there is nothing to index), robots.txt turns it into
 * `Disallow: /` and still answers 200 — the de-facto crawler convention is that
 * this file always exists, and an absent-or-restrictive one just means "crawl
 * nothing here", not an error page.
 *
 * Route disambiguation follows PUBKB-e's precedent exactly: `sitemap.xml` and
 * `robots.txt` are two more static children beside `articles`/`categories`
 * (JSON reader) at the same depth as `:articleSlug` (HTML surface). Fastify
 * prefers a static segment over a parameter, so these two words join the
 * existing reserved set (kb.ts's `RESERVED_ARTICLE_SLUGS`) — an article can
 * never be created under an address one of these routes would shadow.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { withTenant } from '../lib/tenant.js';
import { publishedArticleWhere, resolvePublicKbWorkspace } from '../lib/kb-public-read.js';

const slugParam = z.string().trim().min(1).max(200);

/**
 * The sitemap protocol's single-file cap (50k URLs). A workspace past this
 * needs a sitemap index (v3, out of scope) — the first N by publish recency are
 * served rather than none, so the newest content stays indexable either way.
 */
const MAX_SITEMAP_URLS = 50_000;

const XML_TYPE = 'application/xml; charset=utf-8';
const TEXT_TYPE = 'text/plain; charset=utf-8';

/**
 * Escapes the five characters that are structurally significant in XML text
 * content. Applied to the whole `<loc>` value, not just the slug that feeds it:
 * a workspace or article slug is normalised to a clean ASCII token at write time
 * (`kb-slug.ts`), but the resolver only re-validates identity, not character
 * set — this is the belt for that suspenders, so a `<`/`&` reaching this file by
 * any other path still cannot break the document.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function parseSlug(value: unknown): string | null {
  const result = slugParam.safeParse(value);
  return result.success ? result.data : null;
}

interface Options {
  /** `${API_BASE_URL}${API_PREFIX}` — the same base PUBKB-e's canonical/OG links
   *  use, so a sitemap `<loc>` always points at the exact page it names. */
  canonicalBase: string;
}

export default async function publicKbSitemapRoutes(
  app: FastifyInstance,
  options: Options,
): Promise<void> {
  // Same anonymous, higher-limit `rl:pubkb:<ip>` bucket as the rest of the
  // public KB, so a crawler fetching these is not throttled by the shared limit.
  const publicRead = { public: true, publicKbRateLimit: true } as const;

  function kbHomeUrl(workspaceSlug: string): string {
    return `${options.canonicalBase}/public/kb/${workspaceSlug}`;
  }

  function articleUrl(workspaceSlug: string, articleSlug: string): string {
    return `${kbHomeUrl(workspaceSlug)}/${articleSlug}`;
  }

  app.get<{ Params: { workspaceSlug: string } }>(
    '/public/kb/:workspaceSlug/sitemap.xml',
    { config: publicRead },
    async (request, reply) => {
      const workspaceSlug = parseSlug(request.params.workspaceSlug);
      if (!workspaceSlug) throw ApiError.notFound('Not found.');

      const tenant = await resolvePublicKbWorkspace(app.db, workspaceSlug);
      if (!tenant) throw ApiError.notFound('Not found.');

      const articles = await withTenant(app.db, tenant, (tx) =>
        tx.kbArticle.findMany({
          where: publishedArticleWhere(),
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: MAX_SITEMAP_URLS,
          select: { slug: true, updatedAt: true },
        }),
      );

      const urls = articles
        .map(
          (article) =>
            '  <url>\n' +
            `    <loc>${escapeXml(articleUrl(workspaceSlug, article.slug))}</loc>\n` +
            `    <lastmod>${article.updatedAt.toISOString()}</lastmod>\n` +
            '  </url>',
        )
        .join('\n');

      const xml =
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        (urls ? `${urls}\n` : '') +
        '</urlset>\n';

      return reply.type(XML_TYPE).send(xml);
    },
  );

  app.get<{ Params: { workspaceSlug: string } }>(
    '/public/kb/:workspaceSlug/robots.txt',
    { config: publicRead },
    async (request, reply) => {
      const workspaceSlug = parseSlug(request.params.workspaceSlug);
      const tenant = workspaceSlug ? await resolvePublicKbWorkspace(app.db, workspaceSlug) : null;

      // Unknown workspace and a switched-off KB answer the same way here too
      // (resolvePublicKbWorkspace already conflates them, NFR-S5) — "there is
      // nothing to crawl", expressed as `Disallow: /` rather than a 404, since a
      // robots.txt fetch is never itself an error.
      if (!workspaceSlug || !tenant) {
        return reply.type(TEXT_TYPE).send('User-agent: *\nDisallow: /\n');
      }

      const body =
        'User-agent: *\n' +
        `Allow: /public/kb/${workspaceSlug}/\n` +
        `Sitemap: ${kbHomeUrl(workspaceSlug)}/sitemap.xml\n`;
      return reply.type(TEXT_TYPE).send(body);
    },
  );
}
