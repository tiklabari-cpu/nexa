/**
 * Public knowledge base — anonymous reader surface (PUBKB-c · PRD §5.3, v2).
 *
 * The first surface in this repo that serves org-scoped *content* to callers
 * with no `principal`: these routes are `public: true`, so the tenant cannot
 * come from a token — it is derived from the `{workspaceSlug}` path segment,
 * resolved through the SECURITY DEFINER `kb_resolve_public_slug` (the sibling of
 * `auth_resolve_organization_license`, mirroring how the hosted Chat page and
 * inbound email resolve a licence before any session exists). Every read then
 * runs inside `withTenant`, so RLS — not a hand-written WHERE — is what keeps one
 * workspace's articles out of another's response.
 *
 * Two rules carry the requirement and the security boundary:
 *
 *   - Only *published* articles are ever served (`status = 'published'` AND a
 *     stamped `published_at`) — a draft is invisible here, the KK's "yalnız
 *     yayınlanan public" half.
 *   - One indistinguishable **404** for every miss (NFR-S5): an unknown
 *     workspace slug, a workspace whose KB is switched off, a cancelled licence,
 *     a draft article, an article that belongs to another workspace — all answer
 *     the same status with the same body, so nothing about what exists can be
 *     enumerated. There is no 403 and no per-case message. The path is uniform
 *     on purpose (resolve slug → one scoped lookup → 404), so it does not leak
 *     which miss occurred through timing either.
 *
 * The response body is reader-facing only: it never carries `license_id`,
 * `created_by` or any other agent/account identity, nor internal columns beyond
 * the article's own fields. A valid agent token presented here changes nothing —
 * the handler ignores `principal` entirely, so the public path grants no
 * elevation over what an anonymous reader sees.
 */
import type { FastifyInstance } from 'fastify';
import { type Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { withTenant, type TenantContext } from '../lib/tenant.js';
import { publishedArticleWhere, resolvePublicKbWorkspace } from '../lib/kb-public-read.js';

const slugParam = z.string().trim().min(1).max(200);

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  page_id: z.string().max(512).optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'param'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

/** The single answer for every miss — see the 404 policy in the file header. */
function notFound(): never {
  throw ApiError.notFound('Not found.');
}

interface ArticleRow {
  id: string;
  categoryId: string | null;
  slug: string;
  title: string;
  body: string;
  excerpt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
}

/** List item: everything a reader needs to find an article, minus its body. */
function serialiseSummary(row: ArticleRow) {
  return {
    id: row.id,
    category_id: row.categoryId,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    seo_title: row.seoTitle,
    seo_description: row.seoDescription,
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
    updated_at: row.updatedAt.toISOString(),
  };
}

/** Article detail: the summary plus the raw body (rendered safely in PUBKB-d). */
function serialiseArticle(row: ArticleRow) {
  return { ...serialiseSummary(row), body: row.body };
}

function serialiseCategory(row: { id: string; slug: string; name: string; position: number }) {
  return { id: row.id, slug: row.slug, name: row.name, position: row.position };
}

/**
 * Keyset pagination over (published_at DESC, id DESC). Only published articles
 * are listed, so `published_at` is never null within the page and the cursor can
 * carry it as a plain timestamp. A malformed cursor is treated as no cursor
 * rather than an error — a truncated URL should reopen page one, not 400.
 */
interface Cursor {
  publishedAt: string;
  id: string;
}

function encodeCursor(row: ArticleRow): string {
  const cursor: Cursor = {
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : '',
    id: row.id,
  };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(pageId: string | undefined): Cursor | null {
  if (!pageId) return null;
  try {
    const parsed = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8')) as Cursor;
    if (typeof parsed.publishedAt !== 'string' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function cursorPredicate(cursor: Cursor): Prisma.KbArticleWhereInput {
  const at = new Date(cursor.publishedAt);
  // Strictly after the cursor in the (published_at DESC, id DESC) order.
  return {
    OR: [{ publishedAt: { lt: at } }, { AND: [{ publishedAt: at }, { id: { lt: cursor.id } }] }],
  };
}

export default async function publicKbRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Turn a public slug into a tenant context, or 404. The resolver itself lives
   * in `kb-public-read.ts` and is shared with the SEO HTML surface (PUBKB-e) so
   * the one cross-tenant read the public KB performs has a single definition; a
   * miss comes back as `null` and is answered the same indistinguishable 404 as
   * an unknown slug.
   */
  async function resolveWorkspace(slug: string): Promise<TenantContext> {
    const tenant = await resolvePublicKbWorkspace(app.db, slug);
    if (!tenant) notFound();
    return tenant;
  }

  // Anonymous surface: `public: true` (no token needed) and its own, higher
  // rate-limit bucket so a crawler indexing the SEO pages is not throttled by the
  // shared anon limit (`rl:pubkb:<ip>`, rate-limit.ts).
  const publicRead = { public: true, publicKbRateLimit: true } as const;

  app.get<{ Params: { workspaceSlug: string } }>(
    '/public/kb/:workspaceSlug/articles',
    { config: publicRead },
    async (request, reply) => {
      const workspaceSlug = parse(slugParam, request.params.workspaceSlug);
      const query = parse(listQuery, request.query);
      const tenant = await resolveWorkspace(workspaceSlug);
      const cursor = decodeCursor(query.page_id);

      const rows = await withTenant(app.db, tenant, (tx) =>
        tx.kbArticle.findMany({
          where: {
            AND: [publishedArticleWhere(), cursor ? cursorPredicate(cursor) : {}],
          },
          orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
          // One extra row tells us whether a next page exists without a count.
          take: query.limit + 1,
        }),
      );

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;

      return reply.send({
        items: page.map(serialiseSummary),
        ...(hasMore ? { next_page_id: encodeCursor(page[page.length - 1]!) } : {}),
      });
    },
  );

  app.get<{ Params: { workspaceSlug: string; articleSlug: string } }>(
    '/public/kb/:workspaceSlug/articles/:articleSlug',
    { config: publicRead },
    async (request, reply) => {
      const workspaceSlug = parse(slugParam, request.params.workspaceSlug);
      const articleSlug = parse(slugParam, request.params.articleSlug);
      const tenant = await resolveWorkspace(workspaceSlug);

      const article = await withTenant(app.db, tenant, (tx) =>
        tx.kbArticle.findFirst({
          where: { slug: articleSlug, ...publishedArticleWhere() },
        }),
      );
      // A draft, or an article that lives in another workspace, is invisible
      // under RLS + the published filter — both answer the same 404 as a slug
      // that never existed.
      if (!article) notFound();

      return reply.send(serialiseArticle(article));
    },
  );

  app.get<{ Params: { workspaceSlug: string } }>(
    '/public/kb/:workspaceSlug/categories',
    { config: publicRead },
    async (request, reply) => {
      const workspaceSlug = parse(slugParam, request.params.workspaceSlug);
      const tenant = await resolveWorkspace(workspaceSlug);

      const rows = await withTenant(app.db, tenant, (tx) =>
        tx.kbCategory.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
      );

      return reply.send({ items: rows.map(serialiseCategory) });
    },
  );
}
