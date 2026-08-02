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
 * Filters (action, actor, date range) narrow the same base list, additively —
 * a single-entry view is a separate surface (detail).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { AUDIT_ACTIONS } from '../services/audit/audit-log.js';
import { listAuditLog } from '../services/audit/audit-log-reader.js';

// `limit` has no upper bound in the schema — the service clamps it to the max
// rather than rejecting, so an over-large page is answered, not refused. Zero,
// negatives and non-integers are still a 400: they are wrong, not merely large.
//
// `action` is the closed AUDIT_ACTIONS vocabulary — an unknown value is a 400,
// not a silently-empty list. `date_from`/`date_to` default to the reader's
// 30-day window when omitted; a `from > to` pair is rejected below.
const listQuery = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  page_id: z.string().max(512).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  actor_id: z.string().uuid().optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
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
      if (query.date_from && query.date_to && query.date_from > query.date_to) {
        throw ApiError.validation('`date_from` must be before `date_to`.');
      }

      const result = await request.withTenant((tx) =>
        listAuditLog(tx, {
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          ...(query.page_id ? { pageId: query.page_id } : {}),
          ...(query.action ? { action: query.action } : {}),
          ...(query.actor_id ? { actorId: query.actor_id } : {}),
          ...(query.date_from ? { dateFrom: query.date_from } : {}),
          ...(query.date_to ? { dateTo: query.date_to } : {}),
        }),
      );

      return reply.send({
        items: result.items,
        ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
      });
    },
  );
}
