/**
 * `/platform/v1/audit/*` — the root panel's audit trail (tm 389.5 ·
 * FR-ADMIN-05/06 · design.md §C audit).
 *
 *   GET  /audit                          audit.read   newest first; admin, action, license, time
 *   GET  /audit/export                   audit.read   NDJSON, oldest first, signed
 *   POST /audit/verify                   audit.read   safe — walks the whole chain
 *   GET  /audit/workspaces/{licenseId}   audit.read   a workspace's own trail, read-only
 *
 * None of them changes anything, so none writes an entry. `verify` is a POST
 * because a full walk is work, not a cacheable read; it is declared `safe`,
 * which is what lets a read permission guard it (`plugins/platform-auth.ts`).
 *
 * The export follows the tenant SIEM feed's rules (`routes/audit-log.ts`):
 * every body line is a record and nothing else, the position and the seal are
 * headers, a cursor that cannot be read is a 400, and the page is never
 * filtered — a selective copy of a trail is not evidence of it. The seal,
 * `X-Siyahtus-Signature`, is the HMAC (`signExportPage`, scope `platform`)
 * over the body's SHA-256 and the range it claims; it is checked offline with
 * the chain key, as `docs/runbooks/platform-audit.md` shows.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';
import { AUDIT_ACTIONS } from '../../services/audit/audit-log.js';
import {
  decodePlatformAuditCursor,
  PLATFORM_AUDIT_ACTIONS,
} from '../../services/platform/platform-audit.js';
import { parse } from './auth.js';

const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

const licenseIdSchema = z
  .string()
  .regex(/^[1-9]\d{0,18}$/)
  .transform((value) => BigInt(value));

const listQuery = z.object({
  admin_id: z.string().uuid().optional(),
  action: z.enum(PLATFORM_AUDIT_ACTIONS).optional(),
  license_id: licenseIdSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

const exportQuery = z.object({
  cursor: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).optional(),
});

const workspaceQuery = z.object({
  limit: z.coerce.number().int().min(1).optional(),
  page_id: z.string().max(512).optional(),
  action: z.enum(AUDIT_ACTIONS).optional(),
  actor_id: z.string().uuid().optional(),
  date_from: z.coerce.date().optional(),
  date_to: z.coerce.date().optional(),
});

export default async function platformAuditRoutes(app: FastifyInstance): Promise<void> {
  const trail = app.platformAuditLog;
  const read = { platform: { permission: 'audit.read' as const } };

  app.get('/audit', { config: read }, async (request) => {
    const query = parse(listQuery, request.query);
    if (query.from && query.to && query.from > query.to) {
      throw ApiError.validation('`from` must be before `to`.');
    }
    return trail.list({
      ...(query.admin_id ? { adminId: query.admin_id } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.license_id !== undefined ? { licenseId: query.license_id } : {}),
      ...(query.from ? { from: query.from } : {}),
      ...(query.to ? { to: query.to } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
  });

  app.get('/audit/export', { config: read }, async (request, reply) => {
    const query = parse(exportQuery, request.query);
    const after = query.cursor ? decodePlatformAuditCursor(query.cursor) : null;
    if (query.cursor && after === null) {
      throw ApiError.validation(
        '`cursor` is not an export cursor. Resume from the `x-siyahtus-export-cursor` header of a previous page, or omit it to start from the first entry.',
      );
    }
    const page = await trail.exportPage({
      after,
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
    });
    // Caught up, the position is the one asked from: a consumer polling again
    // must not start over.
    const position = page.lastSeq ?? after;
    return reply
      .header('content-type', NDJSON_CONTENT_TYPE)
      .header('x-content-type-options', 'nosniff')
      .header('cache-control', 'no-store')
      .header('x-siyahtus-signature', page.signature)
      .header('x-siyahtus-export-count', String(page.count))
      .header('x-siyahtus-export-first-seq', page.firstSeq?.toString() ?? '')
      .header('x-siyahtus-export-last-seq', page.lastSeq?.toString() ?? '')
      .header('x-siyahtus-export-has-more', page.hasMore ? 'true' : 'false')
      .header(
        'x-siyahtus-export-cursor',
        position === null ? '' : Buffer.from(position.toString(), 'utf8').toString('base64url'),
      )
      .header('x-siyahtus-export-chain-ok', page.chainOk ? 'true' : 'false')
      .send(page.body);
  });

  app.post('/audit/verify', { config: { platform: { ...read.platform, safe: true } } }, async () =>
    trail.verify(),
  );

  app.get('/audit/workspaces/:licenseId', { config: read }, async (request) => {
    const raw = (request.params as Record<string, unknown>)['licenseId'];
    const id = licenseIdSchema.safeParse(raw);
    if (!id.success) throw ApiError.notFound('Workspace not found.');
    const query = parse(workspaceQuery, request.query);
    if (query.date_from && query.date_to && query.date_from > query.date_to) {
      throw ApiError.validation('`date_from` must be before `date_to`.');
    }
    const result = await trail.workspaceTrail(id.data, {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.page_id ? { pageId: query.page_id } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.actor_id ? { actorId: query.actor_id } : {}),
      ...(query.date_from ? { dateFrom: query.date_from } : {}),
      ...(query.date_to ? { dateTo: query.date_to } : {}),
    });
    if (!result) throw ApiError.notFound('Workspace not found.');
    return {
      items: result.items,
      ...(result.nextPageId ? { next_page_id: result.nextPageId } : {}),
    };
  });
}
