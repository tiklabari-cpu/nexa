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
 * The audit log is the one table the sweep cannot prune through `nexa_app`: it
 * is append-only to that role (INSERT/SELECT only, UPDATE/DELETE revoked), so
 * its window is applied by a single SECURITY DEFINER function,
 * `audit_prune_expired`. That function bypasses RLS, so there the age predicate
 * is joined by an explicit per-tenant `license_id` predicate as the sole
 * cross-tenant guard, and it refuses a null or not-yet-past cutoff; a dry-run
 * counts under RLS and never calls it.
 *
 * The windows are resolved **per tenant**, not once for the run: a workspace
 * inside HIPAA scope (NFR-C4 · C4-e) has its windows capped at
 * `HIPAA_RETENTION_CEILING`, and scope is a property of a licence, so two
 * workspaces in the same deployment can be swept under different policies. Each
 * tenant's effective policy is reported back and recorded in its audit entry,
 * because "why did this conversation disappear a year early" has to be
 * answerable from the trail rather than from the deployment's configuration at
 * the time.
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
import { readHipaaScope } from '../../lib/hipaa.js';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { writeAuditEntry } from '../audit/audit-log.js';
import { capRetentionForHipaa, cutoffFor, type RetentionPolicy, resolveCutoffs } from './policy.js';

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
  /** Audit-log entries pruned for this tenant (NFR-S12 30-day window). */
  auditEntries: number;
  /** Whether this workspace is covered by a signed BAA (NFR-C4 · C4-e). */
  hipaaScope: boolean;
  /**
   * The windows this tenant was actually swept under — the run's policy, capped
   * when `hipaaScope`. Reported rather than inferred: an operator reading a
   * dry-run should not have to re-derive the ceiling to know what will go.
   */
  policy: RetentionPolicy;
}

export interface RetentionReport {
  dryRun: boolean;
  /** The configured windows, before any per-tenant HIPAA ceiling is applied. */
  policy: RetentionPolicy;
  startedAt: string;
  finishedAt: string;
  tenants: TenantPruneResult[];
  mailFiles: number;
  /**
   * Audit-log entries pruned across all tenants (NFR-S12: basic audit is kept
   * for "the last 30 days" on every plan). Deleted through the SECURITY DEFINER
   * `audit_prune_expired`, the one exception to the log's append-only grant —
   * see `#pruneAudit`. Zero in a dry-run, which only counts.
   */
  auditEntries: number;
  totals: {
    tenants: number;
    /** How many of them were swept under the HIPAA ceiling (NFR-C4 · C4-e). */
    hipaaTenants: number;
    threads: number;
    visits: number;
    mailFiles: number;
    auditEntries: number;
  };
}

export interface RetentionRunnerOptions {
  policy: RetentionPolicy;
  /** Directory holding outgoing mail files (`env.MAIL_DIR`). */
  mailDir: string;
  /**
   * `AUDIT_CHAIN_SECRET` (NFR-C6 · C6-c) — this sweep writes its own audit
   * entry, and the entry recording a deletion is the last one that should be
   * outside the chain that makes deletions visible.
   */
  auditChainSecret: string;
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export class RetentionRunner {
  readonly #db: PrismaClient;
  readonly #policy: RetentionPolicy;
  readonly #mailDir: string;
  readonly #auditChainSecret: string;

  constructor(db: PrismaClient, options: RetentionRunnerOptions) {
    this.#db = db;
    this.#policy = options.policy;
    this.#mailDir = options.mailDir;
    this.#auditChainSecret = options.auditChainSecret;
  }

  async run(options: { dryRun: boolean; now?: Date }): Promise<RetentionReport> {
    const dryRun = options.dryRun;
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const tenants = await this.#listTenants();
    const results: TenantPruneResult[] = [];
    for (const tenant of tenants) {
      results.push(await this.#pruneTenant(tenant, now, dryRun));
    }

    // The mail spool is the one thing here that cannot be swept per tenant: the
    // files are local artifacts with no workspace on them (`#pruneMail`), so
    // there is no licence to look a ceiling up against. When *any* workspace in
    // this deployment is covered, the whole spool is swept under the capped
    // window. The alternative — per-tenant windows over unattributable files —
    // is not implementable, and of the two directions this one only deletes
    // sooner, which is the side of the mistake a retention ceiling is on.
    const mailPolicy = results.some((r) => r.hipaaScope)
      ? capRetentionForHipaa(this.#policy)
      : this.#policy;
    const mailFiles = await this.#pruneMail(cutoffFor(mailPolicy.mailDays, now), dryRun);
    const auditEntries = results.reduce((sum, r) => sum + r.auditEntries, 0);

    return {
      dryRun,
      policy: this.#policy,
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      mailFiles,
      auditEntries,
      totals: {
        tenants: results.length,
        hipaaTenants: results.filter((r) => r.hipaaScope).length,
        threads: results.reduce((sum, r) => sum + r.threads, 0),
        visits: results.reduce((sum, r) => sum + r.visits, 0),
        mailFiles,
        auditEntries,
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

  async #pruneTenant(tenant: TenantRow, now: Date, dryRun: boolean): Promise<TenantPruneResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };

    // Scope first, because it decides the windows everything below is measured
    // against. Read under this tenant's own RLS context, from the timestamp
    // `C4-d` writes — which the database will not let exist outside a US
    // organization, so it already carries both halves of NFR-C4's condition.
    const hipaaScope = await withTenant(this.#db, context, (tx) =>
      readHipaaScope(tx, context.licenseId),
    );
    const policy = hipaaScope ? capRetentionForHipaa(this.#policy) : this.#policy;
    const cutoffs = resolveCutoffs(policy, now);

    const threads = dryRun
      ? await withTenant(this.#db, context, (tx) => this.#countThreads(tx, cutoffs.threads))
      : await this.#deleteInBatches(context, (tx) => this.#deleteThreadBatch(tx, cutoffs.threads));

    const visits = dryRun
      ? await withTenant(this.#db, context, (tx) => this.#countVisits(tx, cutoffs.visits))
      : await this.#deleteInBatches(context, (tx) => this.#deleteVisitBatch(tx, cutoffs.visits));

    // The audit log is append-only to `nexa_app` (no DELETE grant), so its
    // window cannot be applied through `withTenant` like the tables above. A
    // real run goes through the one SECURITY DEFINER hole, `audit_prune_expired`,
    // whose in-function `license_id = …` predicate keeps the RLS-bypassing
    // delete inside this tenant; a dry-run only counts, under RLS.
    const auditEntries = dryRun
      ? await withTenant(this.#db, context, (tx) => this.#countAudit(tx, cutoffs.audit))
      : await this.#pruneAudit(context.licenseId, cutoffs.audit);

    // Recording the deletion (who, when, how much) is itself part of the
    // compliance requirement — and it is metadata, not the deleted data, so it
    // is retained. A run that removed nothing writes no entry, matching the rest
    // of the audit trail (a no-op delete is not an event). The audit prune runs
    // before this entry, so the row that records the sweep is itself fresh and
    // never inside the window it just applied.
    if (!dryRun && threads + visits + auditEntries > 0) {
      await withTenant(this.#db, context, (tx) =>
        writeAuditEntry(
          tx,
          {
            licenseId: context.licenseId,
            chainSecret: this.#auditChainSecret,
            actorId: null,
            actorType: 'system',
          },
          {
            action: 'data.retention_pruned',
            metadata: {
              threads,
              visits,
              audit_entries: auditEntries,
              dry_run: false,
              // The windows that were actually applied, and why they were those
              // windows. Without this the trail cannot answer "was this deleted
              // early because we are covered, or because somebody changed the
              // configuration" — and those are different incidents.
              hipaa_scope: hipaaScope,
              thread_days: policy.threadDays,
              visit_days: policy.visitDays,
            },
          },
        ),
      );
    }

    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      threads,
      visits,
      auditEntries,
      hipaaScope,
      policy,
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
   * Count this tenant's expired audit rows for a dry-run. RLS scopes the read to
   * the current tenant, and — unlike the apply path — it never touches the
   * SECURITY DEFINER function, so a dry-run has no way to delete.
   */
  async #countAudit(tx: TenantClient, cutoff: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM audit_log
       WHERE created_at < ${cutoff}`;
    return Number(rows[0]?.n ?? 0n);
  }

  /**
   * Prune this tenant's expired audit rows through the one function permitted to
   * delete from the append-only log. It runs SECURITY DEFINER and so bypasses
   * RLS: the `licenseId` handed to it — not a tenant context — is what scopes the
   * delete, and it refuses a null or `now()`-or-later cutoff. Called on the
   * RLS-bound `nexa_app` connection, which holds EXECUTE but no table DELETE.
   */
  async #pruneAudit(licenseId: bigint, cutoff: Date): Promise<number> {
    const rows = await this.#db.$queryRaw<Array<{ n: bigint }>>`
      SELECT audit_prune_expired(${licenseId}, ${cutoff}) AS n`;
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
