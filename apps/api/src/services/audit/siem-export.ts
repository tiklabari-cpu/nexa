/**
 * The SIEM export's configuration and its delivery position (NFR-C6 · C6-b).
 *
 * One row per (licence, target) in `siem_export_cursors`, holding both halves:
 * where the trail is shipped, and how far it has been shipped. They live
 * together because they cannot be allowed to disagree — repointing the export
 * at a new destination while the old position carried on would leave the trail
 * looking delivered to somewhere it had never reached.
 *
 * Only the configuration half is written in this slice. The position is
 * advanced by the scheduled sink (C6-d), which is also the only thing that may:
 * this module deliberately offers no "move the cursor" function, because the
 * one rule that makes the feed lossless — write the file, close it, *then*
 * advance — belongs to the job that does both, not to a helper any caller could
 * reach for in the wrong order.
 */
import type { SiemExportTarget } from '@nexa/types';
import type { TenantClient } from '../../lib/tenant.js';
import { countPendingExport, type ExportCursor } from './audit-export.js';

/**
 * The target a workspace gets when it turns the export on without naming one.
 * The mock file sink — the only destination this deployment can reach.
 */
export const DEFAULT_SIEM_TARGET: SiemExportTarget = 'file';

export interface SiemExportSettings {
  enabled: boolean;
  /** Null when the workspace has never configured an export. */
  target: SiemExportTarget | null;
}

export interface SiemExportStatus extends SiemExportSettings {
  /** When a delivery last completed, or null if one never has. */
  last_run_at: string | null;
  /** `created_at` of the last entry delivered — the cursor, not the run time. */
  last_exported_at: string | null;
  /** Entries delivered to this target, ever. Survives retention pruning them. */
  exported_count: number;
  /** Exportable entries not yet delivered — the backlog. */
  pending_count: number;
  /**
   * Whether the delivered stream has a hole in it.
   *
   * `null` — "not answerable yet" — until C6-c chains the entries and gives
   * this a way to be computed. Deliberately not `false`: an unchained log
   * cannot demonstrate its own completeness, and reporting "no gaps detected"
   * from a system that cannot detect gaps is the exact false assurance an audit
   * control exists to prevent.
   */
  chain_gap_detected: boolean | null;
}

type CursorRow = {
  target: string;
  enabled: boolean;
  lastExportedId: string | null;
  lastExportedAt: Date | null;
  lastRunAt: Date | null;
  exportedCount: bigint;
};

/**
 * The workspace's export row, or null when it has never configured one.
 *
 * `findFirst`, not a lookup by target: this version gives a workspace one
 * destination, and asking "which one" would mean the caller inventing an answer
 * before the row exists. The unique `(license_id, target)` index still holds the
 * shape open for several later.
 */
export async function readSiemExportRow(tx: TenantClient): Promise<CursorRow | null> {
  return tx.siemExportCursor.findFirst({
    select: {
      target: true,
      enabled: true,
      lastExportedId: true,
      lastExportedAt: true,
      lastRunAt: true,
      exportedCount: true,
    },
    orderBy: { createdAt: 'asc' },
  });
}

/** The stored delivery position, or null when nothing has been delivered. */
export function cursorOf(row: CursorRow | null): ExportCursor | null {
  // Both halves or neither — the database constraint says so, and reading it
  // defensively here means a future migration that loosened it would produce a
  // conservative "start from the beginning" rather than a malformed keyset.
  if (!row?.lastExportedId || !row.lastExportedAt) return null;
  return { createdAt: row.lastExportedAt.toISOString(), id: row.lastExportedId };
}

export function serialiseSiemSettings(row: CursorRow | null): SiemExportSettings {
  return {
    enabled: row?.enabled ?? false,
    target: row ? (row.target as SiemExportTarget) : null,
  };
}

/**
 * Create or update the workspace's export configuration.
 *
 * An upsert, because signup leaves no row: a workspace turning this on for the
 * first time would otherwise get a 404 for a setting it can plainly see. The
 * position columns are never touched here — changing where the log goes, or
 * switching the feed off and on, must not move where it got to.
 */
export async function saveSiemExportSettings(
  tx: TenantClient,
  licenseId: bigint,
  changes: { enabled?: boolean; target?: SiemExportTarget },
): Promise<CursorRow> {
  const existing = await readSiemExportRow(tx);
  const target = changes.target ?? existing?.target ?? DEFAULT_SIEM_TARGET;

  return tx.siemExportCursor.upsert({
    where: { licenseId_target: { licenseId, target } },
    create: {
      licenseId,
      target,
      enabled: changes.enabled ?? false,
    },
    update: {
      ...(changes.enabled !== undefined ? { enabled: changes.enabled } : {}),
    },
    select: {
      target: true,
      enabled: true,
      lastExportedId: true,
      lastExportedAt: true,
      lastRunAt: true,
      exportedCount: true,
    },
  });
}

/** The configuration, the position and the backlog, in one read. */
export async function readSiemExportStatus(
  tx: TenantClient,
  options: { horizonMs: number; now?: Date },
): Promise<SiemExportStatus> {
  const row = await readSiemExportRow(tx);
  const pending = await countPendingExport(tx, {
    after: cursorOf(row),
    horizonMs: options.horizonMs,
    ...(options.now ? { now: options.now } : {}),
  });

  return {
    ...serialiseSiemSettings(row),
    last_run_at: row?.lastRunAt?.toISOString() ?? null,
    last_exported_at: row?.lastExportedAt?.toISOString() ?? null,
    exported_count: Number(row?.exportedCount ?? 0n),
    pending_count: pending,
    chain_gap_detected: null,
  };
}
