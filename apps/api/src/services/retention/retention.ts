/**
 * The retention sweep: hard-delete expired data, one tenant at a time (NFR-C8).
 *
 * This is a compliance-critical, irreversible operation, so the design leans on
 * two independent guards rather than trusting either alone:
 *
 *   1. **RLS is the cross-tenant guard.** Every delete runs inside `withTenant`,
 *      so `nexa_current_license()` scopes each statement to one workspace. Even
 *      a mistake in a WHERE clause cannot reach another tenant's rows — the
 *      policy filters them out first. This is why the job runs as the RLS-bound
 *      `nexa_app` role and loops per tenant, rather than as the owner behind a
 *      single SECURITY DEFINER delete (which would trade the safety net for a
 *      hand-written WHERE). The tenant list itself comes from the one
 *      SECURITY DEFINER enumerator, `retention_list_tenants()`.
 *   2. **The age predicate is the not-yet-expired guard.** Every statement
 *      carries an explicit `... < cutoff`; there is no code path that deletes
 *      without it. `cutoffFor` refuses a non-positive window, so the cutoff can
 *      never land at or after "now".
 *
 * `dryRun` counts what *would* go without writing anything — no delete, no audit
 * entry — so an operator can see the blast radius before committing to it. It is
 * the default in the CLI; deletion takes an explicit `--apply`.
 *
 * Deletes are batched (bounded statement size, short transactions) and
 * idempotent: a second run finds the expired rows already gone and reports zero.
 */
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { type PrismaClient } from '@prisma/client';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { writeAuditEntry } from '../audit/audit-log.js';
import { type RetentionCutoffs, type RetentionPolicy, resolveCutoffs } from './policy.js';

/**
 * Rows deleted per statement. Large enough that real workloads finish in a
 * handful of round trips, small enough that no single delete holds locks or
 * builds a transaction big enough to matter.
 */
const RETENTION_BATCH = 500;

export interface TenantPruneResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  threads: number;
  visits: number;
}

export interface RetentionReport {
  dryRun: boolean;
  policy: RetentionPolicy;
  startedAt: string;
  finishedAt: string;
  tenants: TenantPruneResult[];
  mailFiles: number;
  totals: { tenants: number; threads: number; visits: number; mailFiles: number };
}

export interface RetentionRunnerOptions {
  policy: RetentionPolicy;
  /** Directory holding outgoing mail files (`env.MAIL_DIR`). */
  mailDir: string;
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export class RetentionRunner {
  readonly #db: PrismaClient;
  readonly #policy: RetentionPolicy;
  readonly #mailDir: string;

  constructor(db: PrismaClient, options: RetentionRunnerOptions) {
    this.#db = db;
    this.#policy = options.policy;
    this.#mailDir = options.mailDir;
  }

  async run(options: { dryRun: boolean; now?: Date }): Promise<RetentionReport> {
    const dryRun = options.dryRun;
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();
    const cutoffs = resolveCutoffs(this.#policy, now);

    const tenants = await this.#listTenants();
    const results: TenantPruneResult[] = [];
    for (const tenant of tenants) {
      results.push(await this.#pruneTenant(tenant, cutoffs, dryRun));
    }

    const mailFiles = await this.#pruneMail(cutoffs.mail, dryRun);

    return {
      dryRun,
      policy: this.#policy,
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      mailFiles,
      totals: {
        tenants: results.length,
        threads: results.reduce((sum, r) => sum + r.threads, 0),
        visits: results.reduce((sum, r) => sum + r.visits, 0),
        mailFiles,
      },
    };
  }

  /**
   * Cross-tenant read via the SECURITY DEFINER enumerator — the only place the
   * job steps outside a single-tenant context, and it reads nothing but the two
   * ids the loop needs.
   */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  async #pruneTenant(
    tenant: TenantRow,
    cutoffs: RetentionCutoffs,
    dryRun: boolean,
  ): Promise<TenantPruneResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };

    const threads = dryRun
      ? await withTenant(this.#db, context, (tx) => this.#countThreads(tx, cutoffs.threads))
      : await this.#deleteInBatches(context, (tx) => this.#deleteThreadBatch(tx, cutoffs.threads));

    const visits = dryRun
      ? await withTenant(this.#db, context, (tx) => this.#countVisits(tx, cutoffs.visits))
      : await this.#deleteInBatches(context, (tx) => this.#deleteVisitBatch(tx, cutoffs.visits));

    // Recording the deletion (who, when, how much) is itself part of the
    // compliance requirement — and it is metadata, not the deleted data, so it
    // is retained. A run that removed nothing writes no entry, matching the rest
    // of the audit trail (a no-op delete is not an event).
    if (!dryRun && threads + visits > 0) {
      await withTenant(this.#db, context, (tx) =>
        writeAuditEntry(
          tx,
          { licenseId: context.licenseId, actorId: null, actorType: 'system' },
          { action: 'data.retention_pruned', metadata: { threads, visits, dry_run: false } },
        ),
      );
    }

    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      threads,
      visits,
    };
  }

  /**
   * Delete in fixed-size passes until a pass removes fewer rows than the batch,
   * meaning none are left. Each pass is its own short transaction, so locks are
   * released between batches instead of held for the whole table.
   */
  async #deleteInBatches(
    context: TenantContext,
    deleteBatch: (tx: TenantClient) => Promise<number>,
  ): Promise<number> {
    let total = 0;
    for (;;) {
      const removed = await withTenant(this.#db, context, deleteBatch);
      total += removed;
      if (removed < RETENTION_BATCH) return total;
    }
  }

  #deleteThreadBatch(tx: TenantClient, cutoff: Date): Promise<number> {
    // Closed threads only, and only past the window. Deleting the thread
    // cascades to its events and thread tags (ON DELETE CASCADE), which is how
    // the largest table is pruned without ever naming it here. RLS confines the
    // subselect and the delete to the current tenant.
    return tx.$executeRaw`
      DELETE FROM threads
       WHERE id IN (
         SELECT id FROM threads
          WHERE active = false
            AND closed_at IS NOT NULL
            AND closed_at < ${cutoff}
          ORDER BY closed_at
          LIMIT ${RETENTION_BATCH}
       )`;
  }

  #deleteVisitBatch(tx: TenantClient, cutoff: Date): Promise<number> {
    return tx.$executeRaw`
      DELETE FROM visits
       WHERE id IN (
         SELECT id FROM visits
          WHERE started_at < ${cutoff}
          ORDER BY started_at
          LIMIT ${RETENTION_BATCH}
       )`;
  }

  async #countThreads(tx: TenantClient, cutoff: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM threads
       WHERE active = false AND closed_at IS NOT NULL AND closed_at < ${cutoff}`;
    return Number(rows[0]?.n ?? 0n);
  }

  async #countVisits(tx: TenantClient, cutoff: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM visits
       WHERE started_at < ${cutoff}`;
    return Number(rows[0]?.n ?? 0n);
  }

  /**
   * Sweep outgoing mail files. Not tenant-scoped: the files are local
   * dev/support artifacts with no workspace on them, so this runs once per
   * sweep. Age is read from each file's `sent_at`, falling back to its mtime;
   * in dry-run nothing is unlinked, only counted.
   */
  async #pruneMail(cutoff: Date, dryRun: boolean): Promise<number> {
    let names: string[];
    try {
      names = await readdir(this.#mailDir);
    } catch {
      return 0; // No mail directory yet — nothing to sweep.
    }

    let pruned = 0;
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const path = join(this.#mailDir, name);
      const sentAt = await this.#mailSentAt(path);
      if (sentAt === null || sentAt >= cutoff) continue;
      pruned += 1;
      if (!dryRun) await unlink(path);
    }
    return pruned;
  }

  async #mailSentAt(path: string): Promise<Date | null> {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { sent_at?: unknown };
      if (typeof parsed.sent_at === 'string') {
        const sent = new Date(parsed.sent_at);
        if (!Number.isNaN(sent.getTime())) return sent;
      }
    } catch {
      // Unreadable or malformed — fall back to the filesystem timestamp.
    }
    try {
      return new Date((await stat(path)).mtimeMs);
    } catch {
      return null;
    }
  }
}
