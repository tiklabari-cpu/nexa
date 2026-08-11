/**
 * Public knowledge base — management surface (PUBKB-b · PRD §5.3).
 *
 * The agent-authenticated CRUD behind the reader-facing "SEO'lu self-servis" KB.
 * Two invariants carry the KK the requirement was derived from:
 *
 *   - An article is born a **draft** and turns public only through an explicit
 *     `status: published` PATCH — never on create, whatever the caller sends.
 *     That transition, and its reverse, are the moments content crosses the
 *     private/public line, so each is written to the audit log (NFR-C2).
 *   - The workspace's KB is **off** until an administrator turns it on through
 *     `/kb-settings`. Enabling it (or naming its public address) is the switch
 *     that first exposes any of this to an anonymous audience, so that one write
 *     is role-gated (`minimumRole: admin`) on top of the scope.
 *
 * Scope reuse, not a new one (§C-PUBKB-6): the Knowledge area's existing
 * `agents-bot--all` pair, the same `playbook.ts` guards its sources with. The
 * anonymous read path is PUBKB-c; nothing here is public. The body is stored
 * raw — its safe rendering is PUBKB-d — so no route here ever serves it.
 */
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { normalizeKbSlug } from '../lib/kb-slug.js';
import { writeAuditEntry } from '../services/audit/audit-log.js';

const READ = ['agents-bot--all:ro', 'agents-bot--all:rw'];
const WRITE = ['agents-bot--all:rw'];

const uuid = z.string().uuid();

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const createArticleBody = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().min(1).max(100_000),
  slug: z.string().trim().max(200).optional(),
  category_id: uuid.nullable().optional(),
  excerpt: optionalText(500),
  seo_title: optionalText(200),
  seo_description: optionalText(500),
});

const updateArticleBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().min(1).max(100_000).optional(),
    slug: z.string().trim().max(200).optional(),
    category_id: uuid.nullable().optional(),
    excerpt: optionalText(500),
    seo_title: optionalText(200),
    seo_description: optionalText(500),
    status: z.enum(['draft', 'published']).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const createCategoryBody = z.object({
  name: z.string().trim().min(1).max(120),
  slug: z.string().trim().max(200).optional(),
  position: z.number().int().optional(),
});

const updateCategoryBody = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    slug: z.string().trim().max(200).optional(),
    position: z.number().int().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

const updateSettingsBody = z
  .object({
    enabled: z.boolean().optional(),
    public_slug: z.string().trim().max(200).optional(),
    site_title: optionalText(200),
  })
  .refine((body) => Object.keys(body).length > 0, 'at least one field is required');

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

/** Prisma's unique-violation code — raised by `[license_id, slug]` and `public_slug`. */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Normalise a slug the caller supplied, or derive one from `fallback` (a title
 * or name) when they did not. A value that carries a non-ASCII letter or
 * normalises to nothing is refused rather than transliterated (KK); the message
 * points the author at supplying an explicit ASCII slug.
 */
function resolveSlug(supplied: string | undefined, fallback: string): string {
  const slug = normalizeKbSlug(supplied ?? fallback);
  if (!slug) {
    throw ApiError.validation(
      'slug: provide a non-empty ASCII slug (lower-case, hyphenated) — non-ASCII text is not transliterated.',
    );
  }
  return slug;
}

/**
 * Words that name a static route beside `{articleSlug}` on the public reader
 * surfaces (`articles`/`categories` — PUBKB-c, `sitemap.xml`/`robots.txt` —
 * PUBKB-f). Fastify resolves those statics ahead of the parameter, so an
 * article saved under one of these would be created but never reachable at its
 * own public address; refusing it here is cheaper than a silently dead page.
 */
const RESERVED_ARTICLE_SLUGS = new Set(['articles', 'categories', 'sitemap.xml', 'robots.txt']);

/** {@link resolveSlug}, plus the reserved-word check above. Categories have no
 *  URL of their own on the public surface, so only articles need it. */
function resolveArticleSlug(supplied: string | undefined, fallback: string): string {
  const slug = resolveSlug(supplied, fallback);
  if (RESERVED_ARTICLE_SLUGS.has(slug)) {
    throw ApiError.validation(`slug: "${slug}" is reserved and cannot be used for an article.`);
  }
  return slug;
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
  status: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function serialiseArticle(row: ArticleRow) {
  return {
    id: row.id,
    category_id: row.categoryId,
    slug: row.slug,
    title: row.title,
    body: row.body,
    excerpt: row.excerpt,
    seo_title: row.seoTitle,
    seo_description: row.seoDescription,
    status: row.status,
    published_at: row.publishedAt ? row.publishedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function serialiseCategory(row: {
  id: string;
  slug: string;
  name: string;
  position: number;
  createdAt: Date;
}) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    position: row.position,
    created_at: row.createdAt.toISOString(),
  };
}

function serialiseSettings(
  row: { enabled: boolean; publicSlug: string; siteTitle: string | null; updatedAt: Date } | null,
) {
  // Before the singleton is ever written, the screen still needs the off state
  // rather than a 404.
  if (!row) return { enabled: false, public_slug: null, site_title: null, updated_at: null };
  return {
    enabled: row.enabled,
    public_slug: row.publicSlug,
    site_title: row.siteTitle,
    updated_at: row.updatedAt.toISOString(),
  };
}

export default async function kbRoutes(app: FastifyInstance): Promise<void> {
  // --- Articles --------------------------------------------------------------

  app.get('/kb-articles', { config: { scopes: READ } }, async (request, reply) => {
    const items = await request.withTenant((tx) =>
      tx.kbArticle.findMany({ orderBy: { updatedAt: 'desc' } }),
    );
    return reply.send({ items: items.map(serialiseArticle), total: items.length });
  });

  app.post('/kb-articles', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(createArticleBody, request.body);
    const tenant = request.tenant();
    const principal = request.requirePrincipal();
    const slug = resolveArticleSlug(body.slug, body.title);

    const created = await request.withTenant(async (tx) => {
      // A category is validated inside the tenant context: another workspace's id
      // simply matches nothing under RLS, so a cross-tenant category is refused
      // the same way an unknown one is.
      if (body.category_id != null) {
        const category = await tx.kbCategory.findFirst({
          where: { id: body.category_id },
          select: { id: true },
        });
        if (!category) throw ApiError.validation('category_id: that category does not exist.');
      }

      try {
        return await tx.kbArticle.create({
          data: {
            licenseId: tenant.licenseId,
            slug,
            title: body.title,
            body: body.body,
            ...(body.category_id !== undefined ? { categoryId: body.category_id } : {}),
            ...(body.excerpt !== undefined ? { excerpt: body.excerpt } : {}),
            ...(body.seo_title !== undefined ? { seoTitle: body.seo_title } : {}),
            ...(body.seo_description !== undefined ? { seoDescription: body.seo_description } : {}),
            // Never public on creation (KK): publishing is a separate PATCH.
            status: 'draft',
            createdBy: principal.kind === 'agent' ? principal.accountId : null,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw ApiError.validation(`slug: an article with the slug "${slug}" already exists.`);
        }
        throw error;
      }
    });

    return reply.status(201).send(serialiseArticle(created));
  });

  app.get<{ Params: { articleId: string } }>(
    '/kb-articles/:articleId',
    { config: { scopes: READ } },
    async (request, reply) => {
      const id = parse(uuid, request.params.articleId);
      const article = await request.withTenant((tx) => tx.kbArticle.findFirst({ where: { id } }));
      if (!article) throw ApiError.notFound('Article not found.');
      return reply.send(serialiseArticle(article));
    },
  );

  app.patch<{ Params: { articleId: string } }>(
    '/kb-articles/:articleId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.articleId);
      const body = parse(updateArticleBody, request.body);

      const article = await request.withTenant(async (tx) => {
        const existing = await tx.kbArticle.findFirst({ where: { id } });
        if (!existing) throw ApiError.notFound('Article not found.');

        const data: Prisma.KbArticleUncheckedUpdateInput = {};
        if (body.title !== undefined) data.title = body.title;
        if (body.body !== undefined) data.body = body.body;
        if (body.excerpt !== undefined) data.excerpt = body.excerpt;
        if (body.seo_title !== undefined) data.seoTitle = body.seo_title;
        if (body.seo_description !== undefined) data.seoDescription = body.seo_description;
        if (body.slug !== undefined) data.slug = resolveArticleSlug(body.slug, existing.title);

        if (body.category_id !== undefined) {
          if (body.category_id !== null) {
            const category = await tx.kbCategory.findFirst({
              where: { id: body.category_id },
              select: { id: true },
            });
            if (!category) throw ApiError.validation('category_id: that category does not exist.');
          }
          data.categoryId = body.category_id;
        }

        // `status` is the publish control. Only an actual transition stamps or
        // clears `published_at` and earns an audit entry — re-publishing an
        // already-published article changes nothing and records nothing.
        let audit: 'kb.article_published' | 'kb.article_unpublished' | null = null;
        if (body.status !== undefined && body.status !== existing.status) {
          data.status = body.status;
          if (body.status === 'published') {
            data.publishedAt = new Date();
            audit = 'kb.article_published';
          } else {
            data.publishedAt = null;
            audit = 'kb.article_unpublished';
          }
        }

        let updated;
        try {
          updated = await tx.kbArticle.update({ where: { id }, data });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw ApiError.validation('slug: an article with that slug already exists.');
          }
          throw error;
        }

        if (audit) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: audit,
            target: `kb_article:${id}`,
            metadata: { slug: updated.slug },
          });
        }

        return updated;
      });

      return reply.send(serialiseArticle(article));
    },
  );

  app.delete<{ Params: { articleId: string } }>(
    '/kb-articles/:articleId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.articleId);
      const { count } = await request.withTenant((tx) =>
        tx.kbArticle.deleteMany({ where: { id } }),
      );
      if (count === 0) throw ApiError.notFound('Article not found.');
      return reply.status(204).send();
    },
  );

  // --- Categories ------------------------------------------------------------

  app.get('/kb-categories', { config: { scopes: READ } }, async (request, reply) => {
    const items = await request.withTenant((tx) =>
      tx.kbCategory.findMany({ orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] }),
    );
    return reply.send({ items: items.map(serialiseCategory), total: items.length });
  });

  app.post('/kb-categories', { config: { scopes: WRITE } }, async (request, reply) => {
    const body = parse(createCategoryBody, request.body);
    const tenant = request.tenant();
    const slug = resolveSlug(body.slug, body.name);

    const created = await request.withTenant(async (tx) => {
      try {
        return await tx.kbCategory.create({
          data: {
            licenseId: tenant.licenseId,
            slug,
            name: body.name,
            ...(body.position !== undefined ? { position: body.position } : {}),
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw ApiError.validation(`slug: a category with the slug "${slug}" already exists.`);
        }
        throw error;
      }
    });

    return reply.status(201).send(serialiseCategory(created));
  });

  app.patch<{ Params: { categoryId: string } }>(
    '/kb-categories/:categoryId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.categoryId);
      const body = parse(updateCategoryBody, request.body);

      const updated = await request.withTenant(async (tx) => {
        const existing = await tx.kbCategory.findFirst({ where: { id } });
        if (!existing) throw ApiError.notFound('Category not found.');

        const data: Prisma.KbCategoryUncheckedUpdateInput = {};
        if (body.name !== undefined) data.name = body.name;
        if (body.position !== undefined) data.position = body.position;
        if (body.slug !== undefined) data.slug = resolveSlug(body.slug, existing.name);

        try {
          return await tx.kbCategory.update({ where: { id }, data });
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw ApiError.validation('slug: a category with that slug already exists.');
          }
          throw error;
        }
      });

      return reply.send(serialiseCategory(updated));
    },
  );

  app.delete<{ Params: { categoryId: string } }>(
    '/kb-categories/:categoryId',
    { config: { scopes: WRITE } },
    async (request, reply) => {
      const id = parse(uuid, request.params.categoryId);
      // Articles filed under it are kept, their link cleared (FK ON DELETE SET
      // NULL) — deleting a category must not delete its articles.
      const { count } = await request.withTenant((tx) =>
        tx.kbCategory.deleteMany({ where: { id } }),
      );
      if (count === 0) throw ApiError.notFound('Category not found.');
      return reply.status(204).send();
    },
  );

  // --- Settings --------------------------------------------------------------

  app.get('/kb-settings', { config: { scopes: READ } }, async (request, reply) => {
    const tenant = request.tenant();
    const settings = await request.withTenant((tx) =>
      tx.kbSettings.findUnique({ where: { licenseId: tenant.licenseId } }),
    );
    return reply.send(serialiseSettings(settings));
  });

  // Administrator-only: enabling the KB, or naming its public address, is what
  // first exposes published articles to anonymous readers, so the person gate
  // (`minimumRole: admin`) sits alongside the token gate. A change to `enabled`
  // is audited (NFR-C2).
  app.put(
    '/kb-settings',
    { config: { scopes: WRITE, minimumRole: 'admin' } },
    async (request, reply) => {
      const body = parse(updateSettingsBody, request.body);
      const tenant = request.tenant();

      const saved = await request.withTenant(async (tx) => {
        const existing = await tx.kbSettings.findUnique({
          where: { licenseId: tenant.licenseId },
        });

        let publicSlug = existing?.publicSlug;
        if (body.public_slug !== undefined) {
          const normalised = normalizeKbSlug(body.public_slug);
          if (!normalised) {
            throw ApiError.validation(
              'public_slug: provide a non-empty ASCII slug (lower-case, hyphenated).',
            );
          }
          publicSlug = normalised;
        }
        // The public address is the row's only non-defaultable column, so the
        // first write must carry one; later writes may omit it.
        if (publicSlug === undefined) {
          throw ApiError.validation('public_slug is required the first time the KB is configured.');
        }

        const nextEnabled = body.enabled ?? existing?.enabled ?? false;
        const siteTitle =
          body.site_title !== undefined ? body.site_title : (existing?.siteTitle ?? null);

        let row;
        try {
          row = await tx.kbSettings.upsert({
            where: { licenseId: tenant.licenseId },
            create: {
              licenseId: tenant.licenseId,
              enabled: nextEnabled,
              publicSlug,
              siteTitle,
            },
            update: { enabled: nextEnabled, publicSlug, siteTitle },
          });
        } catch (error) {
          // `public_slug` is globally unique — another workspace already took it.
          if (isUniqueViolation(error)) {
            throw ApiError.validation('public_slug: that public address is already taken.');
          }
          throw error;
        }

        if ((existing?.enabled ?? false) !== nextEnabled) {
          await writeAuditEntry(tx, request.auditContext(), {
            action: 'kb.settings_updated',
            target: `kb_settings:${tenant.licenseId.toString()}`,
            metadata: { enabled: nextEnabled },
          });
        }

        return row;
      });

      return reply.send(serialiseSettings(saved));
    },
  );
}
