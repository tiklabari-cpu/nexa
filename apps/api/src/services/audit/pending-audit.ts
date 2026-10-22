/**
 * Signs the audit entries a migration recorded but could not chain (tm 324.3).
 *
 * The audit log is a chain keyed by `AUDIT_CHAIN_SECRET` (NFR-C6 · C6-c), and
 * the database deliberately never holds that secret — so a SQL migration that
 * changes something the trail must show cannot write the entry itself: a row it
 * inserted into `audit_log` would carry no chain, and an unchained row written
 * after a workspace's chain began is what the verifier reports as tampering.
 * Such a migration writes `pending_audit_entries` in the statement that makes
 * the change (the first is `20261022200000_viceowner_to_admin`, K6), and this
 * pass — run by the API at boot (`plugins/pending-audit.ts`) — moves each row
 * into the chain.
 *
 * Exactly once, by construction rather than by care:
 *
 *   - The row is deleted and its entry written in one tenant transaction. A
 *     failure anywhere rolls back both, so the row is still pending and the
 *     chain has no hole (`writeAuditEntry` reserves its position inside the
 *     same transaction).
 *   - The delete locks the rows it takes. A second pass running at the same
 *     moment — two replicas booting together — waits on those rows and, once
 *     the first commits, finds them gone (Postgres re-checks a row deleted
 *     under a waiting `DELETE` and skips it), so neither signs one the other
 *     has. Not `FOR UPDATE SKIP LOCKED`: that needs an UPDATE grant, and the
 *     application has none on this table.
 *
 * One workspace's failure stays its own: it is counted, logged by the caller,
 * and its rows wait for the next boot, while the other workspaces are signed.
 */
import type { PrismaClient } from '@prisma/client';
import { withTenant, type TenantContext } from '../../lib/tenant.js';
import { AUDIT_ACTIONS, type AuditAction, writeAuditEntry } from './audit-log.js';

/** Rows signed per transaction — a workspace's entries never ride one unbounded transaction. */
export const PENDING_AUDIT_BATCH = 100;

export interface PendingAuditReport {
  /** Workspaces that had entries waiting. */
  tenants: number;
  /** Entries written into the chain by this pass. */
  signed: number;
  /** Workspaces whose remaining entries stay pending for the next pass. */
  failed: Array<{ licenseId: bigint; error: unknown }>;
}

interface PendingRow {
  id: bigint;
  action: string;
  target: string | null;
  metadata: unknown;
  occurred_at: Date;
}

const KNOWN_ACTIONS: ReadonlySet<string> = new Set(AUDIT_ACTIONS);

function isAuditAction(action: string): action is AuditAction {
  return KNOWN_ACTIONS.has(action);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function signPendingAuditEntries(
  db: PrismaClient,
  options: { chainSecret: string; batchSize?: number },
): Promise<PendingAuditReport> {
  const batchSize = options.batchSize ?? PENDING_AUDIT_BATCH;
  const tenants = await db.$queryRaw<Array<{ license_id: bigint; organization_id: string }>>`
    SELECT license_id, organization_id FROM pending_audit_tenants()`;

  const report: PendingAuditReport = { tenants: tenants.length, signed: 0, failed: [] };
  for (const tenant of tenants) {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    try {
      for (;;) {
        const signed = await signBatch(db, context, options.chainSecret, batchSize);
        report.signed += signed;
        if (signed < batchSize) break;
      }
    } catch (error) {
      report.failed.push({ licenseId: tenant.license_id, error });
    }
  }
  return report;
}

async function signBatch(
  db: PrismaClient,
  context: TenantContext,
  chainSecret: string,
  batchSize: number,
): Promise<number> {
  return withTenant(db, context, async (tx) => {
    const rows = await tx.$queryRaw<PendingRow[]>`
      DELETE FROM pending_audit_entries
       WHERE id IN (
         SELECT id FROM pending_audit_entries
          WHERE license_id = ${context.licenseId}
          ORDER BY id
          LIMIT ${batchSize})
      RETURNING id, action, target, metadata, occurred_at`;
    // `RETURNING` promises no order; the trail reads in the order the
    // migration recorded.
    rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

    for (const row of rows) {
      // Refused rather than written: the action list is the trail's vocabulary,
      // and the whole batch stays pending until a release that knows it boots.
      if (!isAuditAction(row.action)) {
        throw new Error(`pending audit entry ${row.id} names an unknown action "${row.action}"`);
      }
      if (!isPlainObject(row.metadata)) {
        throw new Error(`pending audit entry ${row.id} carries metadata that is not an object`);
      }
      await writeAuditEntry(
        tx,
        { licenseId: context.licenseId, chainSecret, actorId: null, actorType: 'system' },
        {
          action: row.action,
          target: row.target,
          metadata: { ...row.metadata, occurred_at: row.occurred_at.toISOString() },
        },
      );
    }
    return rows.length;
  });
}
