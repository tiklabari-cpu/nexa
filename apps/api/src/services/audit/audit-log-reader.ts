/**
 * Reading the audit trail (NFR-S12).
 *
 * The writer (`audit-log.ts`) has always existed; this is the read side. Three
 * choices matter here, and all three lean on the database rather than restating
 * a rule the schema already enforces:
 *
 *   - **RLS is the tenant boundary.** These queries carry no `license_id`
 *     filter. They run inside `withTenant`, and the `audit_log_read` policy
 *     (`USING (license_id = nexa_current_license())`) means a query can only
 *     ever see the caller's own rows. Adding a redundant `WHERE license_id = …`
 *     would suggest the filter is what protects the tenant — it is not, and a
 *     copy of it drifting out of step with the policy would be the more
 *     dangerous state.
 *   - **Keyset, not offset.** Entries arrive constantly; an offset page shifts
 *     under the reader and silently skips rows. The cursor carries the full sort
 *     key `(created_at, id)` so a page resumes exactly where the last ended.
 *   - **A default 30-day window.** The PRD keeps "temel audit … son 30 gün" in
 *     every plan, and the `(license_id, created_at DESC)` index serves that
 *     bound directly — no full-table scan. An explicit `action` filter uses the
 *     table's second index (`license_id, action, created_at DESC`) instead;
 *     `actorId` and an explicit date range narrow further, additively, with no
 *     index of their own.
 */
import type { Prisma } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';
import type { AuditAction } from './audit-log.js';

/** The default window the PRD keeps in every plan. */
const DEFAULT_WINDOW_DAYS = 30;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

export interface AuditLogListOptions {
  /** Clamped to [1, 100]; defaults to 25. Over the max is clamped, not rejected. */
  limit?: number;
  /** Opaque keyset cursor from a previous page. */
  pageId?: string;
  /** Narrows to one action from the closed AUDIT_ACTIONS vocabulary. */
  action?: AuditAction;
  actorId?: string;
  /** Replaces the 30-day default lower bound when given. */
  dateFrom?: Date;
  /** Open-ended (now) when omitted. */
  dateTo?: Date;
}

export interface AuditLogItem {
  id: string;
  action: string;
  actor_id: string | null;
  actor_type: string;
  target: string | null;
  metadata: unknown;
  ip: string | null;
  created_at: string;
}

/** Ordering is (created_at DESC, id DESC), so the cursor carries both. */
interface Cursor {
  createdAt: string;
  id: string;
}

/**
 * A page of audit entries, newest first, for the caller's tenant.
 *
 * `tx` must come from `withTenant`: the RLS policy — not any clause here — is
 * what confines the result to one workspace.
 */
export async function listAuditLog(
  tx: TenantClient,
  options: AuditLogListOptions = {},
): Promise<{ items: AuditLogItem[]; nextPageId?: string }> {
  const limit = clampLimit(options.limit);
  const cursor = decodeCursor(options.pageId);

  const filtered = buildWhere(options);
  const where = cursor ? { AND: [filtered, cursorPredicate(cursor)] } : filtered;

  // One extra row tells us whether another page exists without a second count.
  const rows = await tx.auditLogEntry.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    items: page.map(toItem),
    ...(hasMore && last
      ? { nextPageId: encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) }
      : {}),
  };
}

/**
 * The date window (30-day default, narrowed by explicit `dateFrom`/`dateTo`),
 * plus any `action`/`actorId` filter — additive, so a caller can combine them
 * freely. `created_at` is never null (schema default `now()`), so unlike the
 * customer keyset there is no nulls-last branch to worry about.
 */
function buildWhere(options: AuditLogListOptions): Prisma.AuditLogEntryWhereInput {
  const since = options.dateFrom ?? new Date(Date.now() - DEFAULT_WINDOW_DAYS * 86_400_000);
  const createdAt: Prisma.DateTimeFilter = { gte: since };
  if (options.dateTo) createdAt.lte = options.dateTo;

  const filters: Prisma.AuditLogEntryWhereInput[] = [{ createdAt }];
  if (options.action) filters.push({ action: options.action });
  if (options.actorId) filters.push({ actorId: options.actorId });

  return filters.length === 1 ? filters[0]! : { AND: filters };
}

/** Keyset predicate for (created_at DESC, id DESC). */
function cursorPredicate(cursor: Cursor): {
  OR: Array<Record<string, unknown>>;
} {
  const at = new Date(cursor.createdAt);
  return {
    OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: cursor.id } }],
  };
}

type AuditRow = {
  id: string;
  action: string;
  actorId: string | null;
  actorType: string;
  target: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: Date;
};

function toItem(row: AuditRow): AuditLogItem {
  return {
    id: row.id,
    action: row.action,
    actor_id: row.actorId,
    actor_type: row.actorType,
    target: row.target,
    metadata: row.metadata,
    ip: row.ip,
    created_at: row.createdAt.toISOString(),
  };
}

/** Clamp rather than reject: a caller asking for too many gets the maximum. */
function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(pageId: string | undefined): Cursor | null {
  if (!pageId) return null;
  try {
    const parsed = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8')) as Cursor;
    // A malformed cursor is a stale bookmark, not an error: start from the top
    // rather than failing the whole request.
    return typeof parsed?.id === 'string' && typeof parsed?.createdAt === 'string' ? parsed : null;
  } catch {
    return null;
  }
}
