/**
 * Audit log read surfaces (NFR-S12, NFR-C6).
 *
 * Both endpoints here are doubly gated, on purpose: `minimumRole: admin` (a
 * coarse "who you are") *and* a scope (a fine "what this token may do"). Either
 * alone is not enough — an admin with a narrow PAT should not read the trail,
 * and a broad PAT held by an ordinary agent should not either. Tenant isolation
 * is not a third gate here; it is the RLS policy the reader runs under (see
 * audit-log-reader.ts).
 *
 * The two are gated on *different* scopes. `/audit-log` is a screen paging
 * through the trail and holds `audit_log--all:ro`; `/audit-log/export` streams
 * the whole of it into a system Nexa does not control and holds
 * `audit_log--export:ro`. Neither implies the other, which is what stops a
 * dashboard integration acquiring the firehose by being handed the reading
 * scope (PLAN §6.1.4).
 *
 * Filters (action, actor, date range) narrow the same base list, additively —
 * a single-entry view is a separate surface (detail).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';
import { AUDIT_ACTIONS } from '../services/audit/audit-log.js';
import { listAuditLog } from '../services/audit/audit-log-reader.js';
import { deriveChainKey } from '../services/audit/audit-chain.js';
import {
  decodeExportCursor,
  encodeExportCursor,
  NDJSON_CONTENT_TYPE,
  readAuditExportPage,
  sealExportPage,
} from '../services/audit/audit-export.js';

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

/**
 * The export takes only a position and a size. No `action`, no `actor_id`, no
 * date range: a filtered export is a *selective* record of what happened, and
 * the point of shipping the trail to a SIEM is that the copy over there is
 * complete. Narrowing belongs on the reading surface, where a human is looking
 * for something; here it would only ever produce a plausible-looking export
 * that is missing exactly the entries somebody chose to leave out.
 */
const exportQuery = z.object({
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

export default async function auditLogRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
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

  /**
   * The SIEM feed (NFR-C6 · C6-b): the same trail, oldest first, as NDJSON.
   *
   * Three things are worth reading twice.
   *
   * **The cursor lives in headers, not the body.** Every line of the body is a
   * record and nothing else, so a consumer can split on `\n`, parse each half
   * independently, and append one page to the last without a merge step. It
   * also leaves the format open for C6-c, which decides where the integrity
   * chain and the export signature sit.
   *
   * **The cursor is always returned, even for an empty page.** A feed that has
   * caught up still has a position, and a consumer that forgot it would
   * re-deliver the workspace's entire retained trail on its next poll.
   *
   * **A cursor we cannot read is a 400, not a fresh start.** On a paged screen a
   * stale bookmark degrades gracefully to the top of the list. Here both silent
   * answers are wrong and invisible: starting over re-sends everything, and
   * treating it as the end skips everything. So it is refused out loud. (The
   * one place that trade-off is inverted is the horizon — see
   * `services/audit/audit-export.ts` — where redelivery is chosen over any
   * chance of a gap.)
   *
   * **The seal is detached** (NFR-C6 · C6-c). Each record carries its own chain
   * position and hash inline, so a line copied out of the file keeps its
   * evidence; the signature over the page travels in `x-nexa-export-signature`,
   * because a signature is about the whole delivery and a body line that was
   * not a record would break every consumer that splits on `\n`.
   * `x-nexa-export-chain-ok` reports whether the page verified — false is a
   * warning, not a refusal, since withholding a damaged trail is what an
   * attacker would want.
   *
   * **It is Enterprise** (`entitlement: 'siem_export'`, FR-MOD-11.5). NFR-S12
   * gives every plan the audit log — `/audit-log` above is ungated — and sells
   * the trail *leaving*: this endpoint and the scheduled sink are the
   * capability itself rather than a screen describing it. Gating the viewer as
   * well would take away something the tier below Enterprise was sold.
   */
  app.get(
    '/audit-log/export',
    {
      config: {
        scopes: ['audit_log--export:ro'],
        minimumRole: 'admin',
        entitlement: 'siem_export',
      },
    },
    async (request, reply) => {
      const query = parse(exportQuery, request.query);

      const after = query.page_id ? decodeExportCursor(query.page_id) : null;
      if (query.page_id && !after) {
        throw ApiError.validation(
          '`page_id` is not an export cursor. Resume from the `x-nexa-export-cursor` header of a previous export, or omit it to start from the beginning of the trail.',
        );
      }

      // The route's own licence, not one the caller may name: the key is what
      // the signature means, and deriving it from anything the request supplied
      // would let a caller ask for a page sealed under a workspace it does not
      // hold. RLS confines the rows to the same tenant, so the two agree by
      // construction.
      const licenseId = request.principal?.licenseId as bigint;
      const chainKey = deriveChainKey(options.env.AUDIT_CHAIN_SECRET, licenseId);

      const page = await request.withTenant((tx) =>
        readAuditExportPage(tx, {
          after,
          ...(query.limit !== undefined ? { limit: query.limit } : {}),
          horizonMs: options.env.SIEM_EXPORT_HORIZON_MS,
          chainKey,
        }),
      );
      const sealed = sealExportPage(chainKey, licenseId, page.records);

      return (
        reply
          .header('content-type', NDJSON_CONTENT_TYPE)
          // A security trail is the last thing that should be served from a
          // shared cache or sniffed into something active by a browser.
          .header('x-content-type-options', 'nosniff')
          .header('cache-control', 'no-store')
          .header('x-nexa-export-count', String(page.records.length))
          .header('x-nexa-export-has-more', page.hasMore ? 'true' : 'false')
          .header('x-nexa-export-cursor', page.cursor ? encodeExportCursor(page.cursor) : '')
          .header('x-nexa-export-signature', sealed.signature)
          .header('x-nexa-export-chain-ok', page.chain.ok ? 'true' : 'false')
          .send(sealed.body)
      );
    },
  );
}
