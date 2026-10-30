/**
 * The widget's "Help" tab (WG-12 · tm 348): search and read the workspace's
 * published knowledge base articles with the visitor's customer token.
 *
 * The public KB (`public-kb.ts`) reaches the same articles by a workspace slug
 * and only while the workspace publishes its KB on the web. These routes take
 * the workspace from the token instead — nothing in the request can name
 * another one — and follow the widget's own switch (`help_enabled`), because a
 * workspace may want its players to find answers in the widget without putting
 * a help site on the web.
 *
 * Every miss is the same nothing: the search answers an empty list for a
 * workspace with the tab switched off, and the article view one 404 for a
 * draft, another workspace's article, an unknown slug and a switched-off tab.
 * Both are inside the customer token's rate limit (`rl:customer:…`). The query
 * reaches a log line only masked: `q` is one of the keys `logSafeUrl` redacts.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  KB_SEARCH_LIMIT,
  KB_SEARCH_QUERY_MAX,
  KB_SEARCH_QUERY_MIN,
  WIDGET_UI_LOCALES,
} from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import {
  publishedKbArticles,
  readCustomerHelpEnabled,
  type HelpArticleSource,
} from '../services/kb/help-articles.js';

const searchQuery = z.object({
  q: z.string().trim().min(KB_SEARCH_QUERY_MIN).max(KB_SEARCH_QUERY_MAX),
  locale: z.enum(WIDGET_UI_LOCALES as unknown as [string, ...string[]]).optional(),
  limit: z.coerce.number().int().min(1).max(KB_SEARCH_LIMIT.max).default(KB_SEARCH_LIMIT.default),
});

const slugParam = z.string().trim().min(1).max(200);

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

interface Options {
  /** Where the articles come from; the published KB unless a test says otherwise. */
  source?: HelpArticleSource;
}

export default async function customerKbRoutes(
  app: FastifyInstance,
  options: Options = {},
): Promise<void> {
  const source = options.source ?? publishedKbArticles;
  const customerOnly = { principals: ['customer' as const] };

  app.get('/customer/kb/search', { config: customerOnly }, async (request, reply) => {
    const principal = request.requirePrincipal();
    if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');
    const query = parse(searchQuery, request.query);
    const tenant = request.tenant();

    const items = await request.withTenantRead(async (tx) => {
      if (!(await readCustomerHelpEnabled(tx, principal.brandId))) return [];
      return source.search(tx, {
        licenseId: tenant.licenseId,
        query: query.q,
        limit: query.limit,
        ...(query.locale ? { locale: query.locale as (typeof WIDGET_UI_LOCALES)[number] } : {}),
      });
    });
    return reply.send({ items });
  });

  app.get<{ Params: { slug: string } }>(
    '/customer/kb/articles/:slug',
    { config: customerOnly },
    async (request, reply) => {
      const principal = request.requirePrincipal();
      if (principal.kind !== 'customer') throw ApiError.notFound('Resource not found.');
      const slug = slugParam.safeParse(request.params.slug);
      // A malformed slug is a miss like any other, not a 400.
      if (!slug.success) throw ApiError.notFound('Not found.');

      const article = await request.withTenantRead(async (tx) =>
        (await readCustomerHelpEnabled(tx, principal.brandId))
          ? source.article(tx, slug.data)
          : null,
      );
      if (!article) throw ApiError.notFound('Not found.');
      return reply.send({
        slug: article.slug,
        title: article.title,
        body: article.body,
        updated_at: article.updatedAt.toISOString(),
      });
    },
  );
}
