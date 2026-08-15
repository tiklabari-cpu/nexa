/**
 * Streaming the audit trail out to a SIEM (NFR-C6 · C6-b).
 *
 * The read surface (`audit-log-reader.ts`) answers "show me the last 30 days,
 * newest first, a page at a time" — a screen's question. This answers a
 * different one: "give me everything since the last thing you gave me, forever,
 * without ever missing anything." Four choices carry that, and each of them is
 * the answer to a specific way a log feed loses entries:
 *
 *   - **Oldest first, not newest first.** A feed is a forward scan. Reading
 *     newest-first means every new entry shifts the whole sequence, and there is
 *     no position a consumer can hold on to. Ordering ascending by
 *     `(created_at, id)` gives a total order that only ever grows at the end —
 *     which is also the order C6-c's hash chain will be built over.
 *   - **A keyset cursor, exclusive, carrying the whole sort key.** An offset
 *     silently skips rows when the table grows underneath it, which is the
 *     failure this whole feature exists to make impossible.
 *   - **A horizon.** The subtle one, and the reason this module exists at all
 *     rather than a `dir: 'asc'` flag on the reader. See `exportHorizon` below.
 *   - **Redelivery over skipping, whenever the two are the only options.** A
 *     consumer replaying a cursor gets the same rows again; a consumer with a
 *     cursor this server cannot interpret gets an error rather than a guess.
 *     Duplicates in a SIEM are noise. A gap is a missing security event, and
 *     nothing downstream can tell it apart from a period when nothing happened.
 *
 * What this module does NOT do is remember where any consumer got to. The pull
 * endpoint's caller holds its own cursor; the scheduled sink (C6-d) holds one
 * in `siem_export_cursors`. Two consumers sharing a position would each skip
 * the rows the other took.
 */
import type { Prisma } from '@prisma/client';
import type { TenantClient } from '../../lib/tenant.js';

/** Rows in one response when the caller does not say. */
const DEFAULT_LIMIT = 1_000;

/**
 * The most rows one response may carry. Bounded because the whole page is
 * materialised before the first byte is written — the cursor is a response
 * *header*, so the last row has to be known before the body starts. A workspace
 * with a year of trail therefore pulls it in pages, which is what the cursor is
 * for; it does not get to ask for all of it in one request and hold a
 * transaction open while we find out how much that is.
 */
const MAX_LIMIT = 5_000;

/** `application/x-ndjson` — one complete JSON object per line, no envelope. */
export const NDJSON_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8';

/**
 * Cursor format version. Written into every cursor and checked on the way back
 * in, so a cursor from a future shape is refused rather than reinterpreted.
 */
const CURSOR_VERSION = 1;

/**
 * A position in the export stream: the last entry already delivered. Exclusive
 * — the next page starts strictly after it.
 */
export interface ExportCursor {
  /** `created_at` of the last delivered entry, ISO-8601. */
  createdAt: string;
  /** Its id, which breaks ties between entries sharing a timestamp. */
  id: string;
}

/** One line of the NDJSON body. */
export interface AuditExportRecord {
  id: string;
  license_id: string;
  action: string;
  actor_id: string | null;
  actor_type: string;
  target: string | null;
  metadata: unknown;
  ip: string | null;
  created_at: string;
}

export interface AuditExportPage {
  records: AuditExportRecord[];
  /**
   * Where to resume. The position after the last record in this page, or the
   * cursor that was passed in when the page is empty — a feed that has caught
   * up must not forget where it is.
   */
  cursor: ExportCursor | null;
  /**
   * True when more entries are already below the horizon and waiting. A
   * consumer polls again immediately rather than on its next tick.
   */
  hasMore: boolean;
}

export interface AuditExportOptions {
  /** Resume strictly after this entry. Absent = from the beginning of the trail. */
  after?: ExportCursor | null;
  /** Clamped to [1, 5000]; defaults to 1000. Over the max is clamped, not rejected. */
  limit?: number;
  /** Milliseconds behind `now` the export stops. See `exportHorizon`. */
  horizonMs: number;
  /** Injected so a test can pin the horizon; defaults to the wall clock. */
  now?: Date;
}

/**
 * The newest instant this export is willing to read up to.
 *
 * `audit_log.created_at` defaults to `CURRENT_TIMESTAMP`, which Postgres fixes
 * at the *start* of the writing transaction — not at commit. So an entry can
 * become visible carrying a timestamp that the export has already walked past:
 *
 *   t=100  transaction M starts, writes an entry stamped 100, keeps working
 *   t=120  the export runs, sees entries up to 118, advances its cursor to 118
 *   t=150  M commits; its entry, stamped 100, is now visible
 *
 * The entry at 100 is now behind a cursor at 118 and will never be returned.
 * Not delayed — lost, because the cursor only moves forward. Under any
 * concurrency at all this happens routinely, and the resulting hole is
 * indistinguishable from evidence somebody deleted; once C6-c's chain is in
 * place it would be reported as tampering, every day, on a healthy system.
 *
 * The fix is to refuse to read right up to the present. Anything older than the
 * longest a tenant transaction may live has either committed or been rolled
 * back, so nothing can still arrive behind it. The cost is latency — an entry
 * is exportable a few seconds after it happens rather than instantly — which is
 * the correct thing to trade for not losing it.
 */
export function exportHorizon(now: Date, horizonMs: number): Date {
  return new Date(now.getTime() - Math.max(0, horizonMs));
}

/**
 * One page of the export, oldest first, for the caller's tenant.
 *
 * `tx` must come from `withTenant`: as with every audit read, the RLS policy —
 * not a clause here — is what confines the result to one workspace.
 */
export async function readAuditExportPage(
  tx: TenantClient,
  options: AuditExportOptions,
): Promise<AuditExportPage> {
  const limit = clampLimit(options.limit);
  const horizon = exportHorizon(options.now ?? new Date(), options.horizonMs);
  const after = options.after ?? null;

  const where: Prisma.AuditLogEntryWhereInput = {
    createdAt: { lte: horizon },
    ...(after ? { AND: [afterPredicate(after)] } : {}),
  };

  // One extra row answers "is there more?" without a second count.
  const rows = await tx.auditLogEntry.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page.at(-1);

  return {
    records: page.map(toRecord),
    cursor: last ? { createdAt: last.createdAt.toISOString(), id: last.id } : after,
    hasMore,
  };
}

/**
 * How many entries are exportable but not yet delivered to a stored position.
 *
 * What the settings screen calls the backlog. Counted below the same horizon
 * the export reads to, so "0 pending" means genuinely caught up rather than
 * "nothing has settled yet".
 */
export async function countPendingExport(
  tx: TenantClient,
  options: { after?: ExportCursor | null; horizonMs: number; now?: Date },
): Promise<number> {
  const horizon = exportHorizon(options.now ?? new Date(), options.horizonMs);
  const after = options.after ?? null;

  return tx.auditLogEntry.count({
    where: {
      createdAt: { lte: horizon },
      ...(after ? { AND: [afterPredicate(after)] } : {}),
    },
  });
}

/** Keyset predicate for the ascending `(created_at, id)` order — exclusive. */
function afterPredicate(cursor: ExportCursor): Prisma.AuditLogEntryWhereInput {
  const at = new Date(cursor.createdAt);
  return {
    OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: cursor.id } }],
  };
}

type AuditRow = {
  id: string;
  licenseId: bigint;
  action: string;
  actorId: string | null;
  actorType: string;
  target: string | null;
  metadata: unknown;
  ip: string | null;
  createdAt: Date;
};

/**
 * The wire shape of one exported entry.
 *
 * The read surface's fields, plus `license_id`. A SIEM indexes several
 * workspaces side by side and needs the discriminator on the record itself —
 * whatever it was filed under at ingest is a property of the pipeline, not of
 * the evidence. Serialised as a string because the id is a bigint and JSON
 * numbers are doubles.
 *
 * `metadata` is passed through as stored: it was already stripped of anything
 * credential-shaped on the way in (`sanitizeAuditMetadata`), and re-filtering it
 * here would mean the exported record and the record an admin reads on screen
 * could disagree about what happened.
 */
export function toRecord(row: AuditRow): AuditExportRecord {
  return {
    id: row.id,
    license_id: row.licenseId.toString(),
    action: row.action,
    actor_id: row.actorId,
    actor_type: row.actorType,
    target: row.target,
    metadata: row.metadata,
    ip: row.ip,
    created_at: row.createdAt.toISOString(),
  };
}

/**
 * NDJSON: one record per line, each line a complete JSON object, terminated by
 * a newline — including the last one. The trailing newline is not cosmetic:
 * a consumer appending the next page to a file would otherwise splice two
 * records into one unparseable line at the seam.
 *
 * No envelope, no header line, no trailing summary. Every line is a record, so
 * a consumer can split on `\n` and parse each half independently, and a file
 * can be concatenated with the next without a merge step. It also leaves the
 * format open for C6-c, which decides where the chain and signature live.
 */
export function toNdjson(records: readonly AuditExportRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

/**
 * Cursors are opaque to the caller and tagged on the way out, so a cursor from
 * somewhere else is refused rather than misread.
 *
 * The tag matters more here than on a paged screen. The read surface's cursor
 * has the same two fields and the opposite direction: handed to this endpoint
 * and taken at face value, "everything before entry X" would be read as
 * "everything after entry X", and the export would skip the entire history
 * before X without anything looking wrong.
 */
export function encodeExportCursor(cursor: ExportCursor): string {
  return Buffer.from(
    JSON.stringify({ v: CURSOR_VERSION, d: 'fwd', at: cursor.createdAt, id: cursor.id }),
    'utf8',
  ).toString('base64url');
}

/**
 * Decode a cursor, or return null if it is not one of ours.
 *
 * Null means "refuse", not "start from the beginning" — the caller turns it
 * into a 400. Both silent alternatives are wrong in a way the consumer cannot
 * see: starting over re-delivers the entire retained trail, and treating it as
 * the end skips it. An unreadable position is a question only the operator can
 * answer, so it is asked out loud.
 */
export function decodeExportCursor(value: string): ExportCursor | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const { v, d, at, id } = parsed as Record<string, unknown>;
  if (v !== CURSOR_VERSION || d !== 'fwd') return null;
  if (typeof at !== 'string' || typeof id !== 'string') return null;
  // A timestamp that does not parse would become an `Invalid Date` in the
  // keyset predicate, which matches nothing — an empty export that looks like
  // "caught up" rather than a broken cursor.
  if (Number.isNaN(Date.parse(at))) return null;

  return { createdAt: at, id };
}

export const AUDIT_EXPORT_LIMITS = { default: DEFAULT_LIMIT, max: MAX_LIMIT } as const;
