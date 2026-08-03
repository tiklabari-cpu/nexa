/**
 * Public knowledge base — server-rendered SEO HTML surface (PUBKB-e · PRD
 * §5.3-Knowledge · NFR-P2 · NFR-A11Y1 · NFR-S6).
 *
 * The first surface in this repo to answer with `text/html` rather than JSON: two
 * anonymous pages a search engine can index — the workspace KB home
 * (`GET /public/kb/{workspaceSlug}`) and a single article
 * (`GET /public/kb/{workspaceSlug}/{articleSlug}`). The data path is *not* new:
 * it reuses `kb-public-read.ts`'s resolver and published-only predicate — the
 * same tenant resolution, the same "yalnız yayınlanan" filter and the same RLS
 * boundary the JSON reader (PUBKB-c) enforces — so the two surfaces cannot drift
 * on what an anonymous caller may see. The HTML itself is built by `kb-page.ts`;
 * this file only fetches, groups and hands off.
 *
 * The 404 policy carries over intact: every miss — unknown workspace, a KB
 * switched off, a cancelled licence, a draft, another workspace's article, even a
 * malformed slug — answers one indistinguishable `text/html` 404 (`noindex`, no
 * content), so nothing about what exists leaks through the page either.
 *
 * Route disambiguation: the article path `/public/kb/{slug}/{articleSlug}` sits
 * beside the JSON reader's static children `articles` and `categories` at the
 * same depth. Fastify's router prefers a static segment over a parameter, so
 * those keep resolving to the JSON API; `articles`/`categories` are reserved slug
 * words (PUBKB-b) and cannot name a real article, so no article page is shadowed.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { withTenant } from '../lib/tenant.js';
import { publishedArticleWhere, resolvePublicKbWorkspace } from '../lib/kb-public-read.js';
import {
  renderArticlePage,
  renderIndexPage,
  renderNotFoundPage,
  type KbIndexSection,
  type KbPageLinks,
} from '../lib/kb-page.js';

const slugParam = z.string().trim().min(1).max(200);

const HTML_TYPE = 'text/html; charset=utf-8';
/** Short public cache: fresh enough for edits to show, long enough to shield a
 *  crawl. Paired with an ETag so a re-fetch is a cheap 304, not a re-render. */
const CACHE_CONTROL = 'public, max-age=60';
/** A bound on the home page so an enormous KB cannot render an unbounded page. */
const MAX_INDEX_ARTICLES = 500;

/** A bad slug is a miss, not a 400 — it answers the same 404 as any other. */
function parseSlug(value: unknown): string | null {
  const result = slugParam.safeParse(value);
  return result.success ? result.data : null;
}

interface Options {
  /** `${API_BASE_URL}${API_PREFIX}` — where these pages are served, for canonical/OG URLs. */
  canonicalBase: string;
}

export default async function publicKbHtmlRoutes(
  app: FastifyInstance,
  options: Options,
): Promise<void> {
  const links: KbPageLinks = { base: options.canonicalBase };

  // Anonymous, and on the same higher-limit `rl:pubkb:<ip>` bucket as the JSON
  // reader so a crawler indexing these pages is not throttled by the shared anon
  // limit (rate-limit.ts).
  const publicRead = { public: true, publicKbRateLimit: true } as const;

  /**
   * Send an HTML page with a short public cache and a strong ETag; a matching
   * `If-None-Match` is answered 304 without re-sending the body.
   */
  function sendHtml(request: FastifyRequest, reply: FastifyReply, html: string): FastifyReply {
    const etag = `"${createHash('sha1').update(html).digest('base64url')}"`;
    reply.header('cache-control', CACHE_CONTROL).header('etag', etag).type(HTML_TYPE);
    if (request.headers['if-none-match'] === etag) {
      return reply.code(304).send();
    }
    return reply.code(200).send(html);
  }

  /** The one HTML 404 for every miss — never cached, never indexed (NFR-S5). */
  function sendNotFound(reply: FastifyReply): FastifyReply {
    reply.header('cache-control', 'no-store').type(HTML_TYPE);
    return reply.code(404).send(renderNotFoundPage());
  }

  // KB home — categories + published articles, grouped for a readable, indexable
  // listing.
  app.get<{ Params: { workspaceSlug: string } }>(
    '/public/kb/:workspaceSlug',
    { config: publicRead },
    async (request, reply) => {
      const workspaceSlug = parseSlug(request.params.workspaceSlug);
      if (!workspaceSlug) return sendNotFound(reply);

      const tenant = await resolvePublicKbWorkspace(app.db, workspaceSlug);
      if (!tenant) return sendNotFound(reply);

      // Sequential, not Promise.all: `withTenant` is one interactive transaction,
      // and concurrent queries on a single Prisma tx client are unsafe.
      const data = await withTenant(app.db, tenant, async (tx) => {
        const settings = await tx.kbSettings.findUnique({
          where: { licenseId: tenant.licenseId },
        });
        const categories = await tx.kbCategory.findMany({
          orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        });
        const articles = await tx.kbArticle.findMany({
          where: publishedArticleWhere(),
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          take: MAX_INDEX_ARTICLES,
          select: { slug: true, title: true, categoryId: true },
        });
        return { settings, categories, articles };
      });

      const siteTitle = data.settings?.siteTitle?.trim() || workspaceSlug;

      // Group articles under their category, preserving the category display
      // order; anything uncategorised trails behind under no heading.
      const byCategory = new Map<string, Array<{ slug: string; title: string }>>();
      const uncategorised: Array<{ slug: string; title: string }> = [];
      for (const article of data.articles) {
        const target = article.categoryId
          ? (byCategory.get(article.categoryId) ??
            byCategory.set(article.categoryId, []).get(article.categoryId)!)
          : uncategorised;
        target.push({ slug: article.slug, title: article.title });
      }

      const sections: KbIndexSection[] = [];
      for (const category of data.categories) {
        const articles = byCategory.get(category.id);
        if (articles?.length) sections.push({ categoryName: category.name, articles });
      }
      if (uncategorised.length) sections.push({ categoryName: null, articles: uncategorised });

      return sendHtml(request, reply, renderIndexPage({ workspaceSlug, siteTitle, sections }, links));
    },
  );

  // A single published article. `articles`/`categories` resolve to the JSON API
  // (static beats parameter); every other slug reaches here.
  app.get<{ Params: { workspaceSlug: string; articleSlug: string } }>(
    '/public/kb/:workspaceSlug/:articleSlug',
    { config: publicRead },
    async (request, reply) => {
      const workspaceSlug = parseSlug(request.params.workspaceSlug);
      const articleSlug = parseSlug(request.params.articleSlug);
      if (!workspaceSlug || !articleSlug) return sendNotFound(reply);

      const tenant = await resolvePublicKbWorkspace(app.db, workspaceSlug);
      if (!tenant) return sendNotFound(reply);

      const result = await withTenant(app.db, tenant, async (tx) => {
        const article = await tx.kbArticle.findFirst({
          where: { slug: articleSlug, ...publishedArticleWhere() },
        });
        // A draft, or an article in another workspace, is invisible under RLS +
        // the published filter — the same 404 as a slug that never existed.
        if (!article) return null;
        const settings = await tx.kbSettings.findUnique({
          where: { licenseId: tenant.licenseId },
        });
        const category = article.categoryId
          ? await tx.kbCategory.findUnique({ where: { id: article.categoryId } })
          : null;
        return { article, settings, category };
      });

      if (!result) return sendNotFound(reply);

      const siteTitle = result.settings?.siteTitle?.trim() || workspaceSlug;
      const html = renderArticlePage(
        {
          workspaceSlug,
          siteTitle,
          categoryName: result.category?.name ?? null,
          article: {
            slug: result.article.slug,
            title: result.article.title,
            body: result.article.body,
            excerpt: result.article.excerpt,
            seoTitle: result.article.seoTitle,
            seoDescription: result.article.seoDescription,
            publishedAt: result.article.publishedAt,
            updatedAt: result.article.updatedAt,
          },
        },
        links,
      );

      return sendHtml(request, reply, html);
    },
  );
}
