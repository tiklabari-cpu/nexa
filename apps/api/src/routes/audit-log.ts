/**
 * Audit log read surface (NFR-S12).
 *
 * The one endpoint here is doubly gated, on purpose: `minimumRole: admin` (a
 * coarse "who you are") *and* `audit_log--all:ro` (a fine "what this token may
 * do"). Either alone is not enough — an admin with a narrow PAT should not read
 * the trail, and a broad PAT held by an ordinary agent should not either.
 * Tenant isolation is not a third gate here; it is the RLS policy the reader
 * runs under (see audit-log-reader.ts).
 *
 * Filters (action, actor, date range) and a single-entry view are separate
 * surfaces (08.9.7-b / detail); this is the base list.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { listAuditLog } from '../services/audit/audit-log-reader.js';

// `limit` has no upper bound in the schema — the service clamps it to the max
// rather than rejecting, so an over-large page is answered, not refused. Zero,
// negatives and non-integers are still a 400: they are wrong, not merely large.
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  page_id: z.string().max(512).optional(),
});

function parse<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw ApiError.validation(
      issue ? `${issue.path.join('.') || 'query'}: ${issue.message}` : 'Invalid request.',
    );
  }
  return result.data;
}

export default async function auditLogRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/audit-log',
    { config: { scopes: ['audit_log--all:ro'], minimumRole: 'admin' } },
    async (request, reply) => {
      const query = parse(listQuery, request.query);

      const result = await request.withTenant((tx) =>
        listAuditLog(tx, {
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          ...(query.page_id ? { pageId: query.page_id } : {}),
        }),
      );

      return reply.send({
        items: result.items,
        ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
      });
    },
  );
}
