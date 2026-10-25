/**
 * The retention sweep: hard-delete expired data, one tenant at a time (NFR-C8).
 *
 * This is a compliance-critical, irreversible operation, so the design leans on
 * two independent guards rather than trusting either alone:
 *
 *   1. **RLS is the cross-tenant guard.** Every delete runs inside `withTenant`,
 *      so `siyahtus_current_license()` scopes each statement to one workspace. Even
 *      a mistake in a WHERE clause cannot reach another tenant's rows — the
 *      policy filters them out first. This is why the job runs as the RLS-bound
 *      `siyahtus_app` role and loops per tenant, rather than as the owner behind a
 *      single SECURITY DEFINER delete (which would trade the safety net for a
 *      hand-written WHERE). The tenant list itself comes from the one
 *      SECURITY DEFINER enumerator, `retention_list_tenants()`.
 *   2. **The age predicate is the not-yet-expired guard.** Every statement
 *      carries an explicit `... < cutoff`; there is no code path that deletes
 *      without it. `cutoffFor` refuses a non-positive window, so the cutoff can
 *      never land at or after "now".
 *
 * The audit log is the one table the sweep cannot prune through `siyahtus_app`: it
 * is append-only to that role (INSERT/SELECT only, UPDATE/DELETE revoked), so
 * its window is applied by a single SECURITY DEFINER function,
 * `audit_prune_expired`. That function bypasses RLS, so there the age predicate
 * is joined by an explicit per-tenant `license_id` predicate as the sole
 * cross-tenant guard, and it refuses a null or not-yet-past cutoff; a dry-run
 * counts under RLS and never calls it.
 *
 * The windows are resolved **per tenant**, not once for the run, and since
 * tm 241 that resolution has three layers rather than two (`policy.ts`): the
 * deployment default, the workspace's own choice from its `licenses` row
 * (NFR-C8's "yapılandırılabilir 30/60/365/sınırsız"), and last the ceiling a
 * signed BAA imposes (NFR-C4 · C4-e). All three are properties of a licence, so
 * two workspaces in the same deployment are swept under different policies —
 * which is the whole point of the middle layer. Each tenant's effective policy
 * is reported back and recorded in its audit entry, because "why did this
 * conversation disappear a year early" has to be answerable from the trail
 * rather than from the deployment's configuration at the time.
 *
 * A workspace that chose `unlimited` for a class is **skipped for that class**,
 * not swept with a very long window: `resolveCutoffs` hands back a null cutoff
 * and the step does not run at all. That is the one place where "unlimited"
 * being a string rather than a number pays for itself — there is no arithmetic
 * to get wrong, only a branch that cannot be omitted.
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
import { UNRESOLVED_TEXT_RETENTION_DAYS } from '@siyahtus/types';
import { inHipaaScope } from '../../lib/hipaa.js';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { writeAuditEntry } from '../audit/audit-log.js';
import type { ObjectStore } from '../storage/object-store.js';
import { StorageUnavailableError } from '../storage/storage-error.js';
import {
  applyTenantWindows,
  capRetentionForHipaa,
  cutoffFor,
  readTenantWindow,
  type RetentionPolicy,
  resolveCutoffs,
} from './policy.js';

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
  /**
   * AI decision records with no connection, swept by age under the thread
   * window (tm 288.2 · ID-08-S1). A record on a connection is not counted
   * here: it cascades with its thread, inside `threads`.
   */
  aiDecisions: number;
  /**
   * Unresolved questions (tm 317.1 · AI-22-S1) older than
   * `UNRESOLVED_TEXT_RETENTION_DAYS`, whatever the conversation's window. One on a
   * thread swept above went with it (`thread_id` cascades), inside `threads`.
   */
  unresolvedItems: number;
  /**
   * Sensitive files a player e-mailed (tm 357 · HD-02 — an ID card, a
   * passport) deleted from the object store under the thread window and
   * marked `purged` on their message. The message itself stays: tickets are
   * not in the sweep.
   */
  sensitiveFiles: number;
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
    aiDecisions: number;
    unresolvedItems: number;
    sensitiveFiles: number;
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
  /**
   * Where e-mailed files are kept (`STORAGE_PROVIDER`, tm 357). Without one
   * the sensitive-file step is skipped and reports 0 — the scheduler and the
   * CLI always pass the deployment's store.
   */
  store?: ObjectStore;
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
  readonly #store: ObjectStore | null;

  constructor(db: PrismaClient, options: RetentionRunnerOptions) {
    this.#db = db;
    this.#policy = options.policy;
    this.#mailDir = options.mailDir;
    this.#auditChainSecret = options.auditChainSecret;
    this.#store = options.store ?? null;
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
        aiDecisions: results.reduce((sum, r) => sum + r.aiDecisions, 0),
        unresolvedItems: results.reduce((sum, r) => sum + r.unresolvedItems, 0),
        sensitiveFiles: results.reduce((sum, r) => sum + r.sensitiveFiles, 0),
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

    // The licence row first, because it decides the windows everything below is
    // measured against — both halves of the decision live on it. One read, not
    // two: the HIPAA timestamp `C4-d` writes (which the database will not let
    // exist outside a US organization, so it already carries both halves of
    // NFR-C4's condition) and this workspace's own choice of window (NFR-C8).
    // Read under this tenant's own RLS context.
    const licence = await withTenant(this.#db, context, (tx) =>
      tx.license.findUnique({
        where: { id: context.licenseId },
        select: {
          hipaaBaaSignedAt: true,
          retentionThreadWindow: true,
          retentionVisitWindow: true,
        },
      }),
    );
    // `inHipaaScope` rather than a second predicate here: one place decides
    // what "covered" means, and `lib/hipaa.ts` says why.
    const hipaaScope = inHipaaScope(licence);
    // Order matters and is the design: the workspace's choice layers over the
    // deployment default, and the ceiling is applied LAST so it is the last
    // word whatever was chosen.
    const chosen = applyTenantWindows(this.#policy, {
      threadWindow: readTenantWindow(licence?.retentionThreadWindow),
      visitWindow: readTenantWindow(licence?.retentionVisitWindow),
    });
    const policy = hipaaScope ? capRetentionForHipaa(chosen) : chosen;
    const cutoffs = resolveCutoffs(policy, now);

    // A null cutoff is an unlimited window: the class is skipped entirely
    // rather than swept with a very large number of days. Counting zero is the
    // honest report — nothing *would* go, and a dry-run that claimed otherwise
    // would be describing a sweep that will not happen.
    const threads =
      cutoffs.threads === null
        ? 0
        : dryRun
          ? await withTenant(this.#db, context, (tx) => this.#countThreads(tx, cutoffs.threads!))
          : await this.#deleteInBatches(context, (tx) =>
              this.#deleteThreadBatch(tx, cutoffs.threads!),
            );

    const visits =
      cutoffs.visits === null
        ? 0
        : dryRun
          ? await withTenant(this.#db, context, (tx) => this.#countVisits(tx, cutoffs.visits!))
          : await this.#deleteInBatches(context, (tx) =>
              this.#deleteVisitBatch(tx, cutoffs.visits!),
            );

    // The AI decision record is kept as long as the conversation (ID-08-S1),
    // so it runs on the thread window and is skipped with it. A record on a
    // connection went with its thread above (`thread_id` cascades) and is
    // never named here; this only takes the ones filed under no connection.
    const aiDecisions =
      cutoffs.threads === null
        ? 0
        : dryRun
          ? await withTenant(this.#db, context, (tx) =>
              this.#countThreadlessDecisions(tx, cutoffs.threads!),
            )
          : await this.#deleteInBatches(context, (tx) =>
              this.#deleteThreadlessDecisionBatch(tx, cutoffs.threads!),
            );

    // The player's words on the unresolved-questions list (AI-22-S1): at most
    // 90 days, and never longer than the conversation — a thread the step
    // above swept took its rows with it. Not skipped with an unlimited
    // thread window: this ceiling is the list's own, not the conversation's.
    const unresolvedCutoff = cutoffFor(UNRESOLVED_TEXT_RETENTION_DAYS, now);
    const unresolvedItems = dryRun
      ? await withTenant(this.#db, context, (tx) => this.#countUnresolved(tx, unresolvedCutoff))
      : await this.#deleteInBatches(context, (tx) =>
          this.#deleteUnresolvedBatch(tx, unresolvedCutoff),
        );

    // A sensitive file the player e-mailed (tm 357 · HD-02) goes when the
    // conversation window says so (04 HD-02 question 2) — the file, not the
    // message: the thread keeps saying a file was there. Skipped with an
    // unlimited window, like everything else on it.
    const sensitiveFiles =
      cutoffs.threads === null || this.#store === null
        ? 0
        : await this.#purgeSensitiveFiles(context, cutoffs.threads, dryRun);

    // The audit log is append-only to `siyahtus_app` (no DELETE grant), so its
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
    if (
      !dryRun &&
      threads + visits + aiDecisions + unresolvedItems + sensitiveFiles + auditEntries > 0
    ) {
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
              ai_decisions: aiDecisions,
              ai_unresolved: unresolvedItems,
              sensitive_files: sensitiveFiles,
              audit_entries: auditEntries,
              dry_run: false,
              // The windows that were actually applied, and why they were those
              // windows. Without this the trail cannot answer "was this deleted
              // early because we are covered, or because somebody changed the
              // configuration" — and those are different incidents. Since
              // tm 241 there is a third possible answer ("the workspace chose
              // it"), which is why the chosen tier is recorded beside the
              // effective window rather than only the latter: a covered
              // workspace whose `unlimited` was capped to 365 and one that
              // picked 365 outright are indistinguishable from the number
              // alone, and they are different conversations to have.
              hipaa_scope: hipaaScope,
              thread_days: policy.threadDays,
              visit_days: policy.visitDays,
              thread_window: licence?.retentionThreadWindow ?? null,
              visit_window: licence?.retentionVisitWindow ?? null,
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
      aiDecisions,
      unresolvedItems,
      sensitiveFiles,
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

  #deleteThreadlessDecisionBatch(tx: TenantClient, cutoff: Date): Promise<number> {
    return tx.$executeRaw`
      DELETE FROM ai_decision_logs
       WHERE id IN (
         SELECT id FROM ai_decision_logs
          WHERE thread_id IS NULL
            AND created_at < ${cutoff}
          ORDER BY created_at
          LIMIT ${RETENTION_BATCH}
       )`;
  }

  #deleteUnresolvedBatch(tx: TenantClient, cutoff: Date): Promise<number> {
    return tx.$executeRaw`
      DELETE FROM ai_unresolved_items
       WHERE id IN (
         SELECT id FROM ai_unresolved_items
          WHERE created_at < ${cutoff}
          ORDER BY created_at
          LIMIT ${RETENTION_BATCH}
       )`;
  }

  /**
   * The sensitive e-mailed files older than `cutoff` (tm 357), deleted and
   * marked, a batch of messages at a time; a dry-run only counts them.
   *
   * The order is the design: the bytes go first, the mark after. A run cut
   * short between the two leaves a file already gone and still unmarked, and
   * the next run deletes it again (absence is success) and marks it — never a
   * mark on a file still in the store. The mark is written through the one
   * SECURITY DEFINER hole `ticket_message_purge_attachments` (the app role may
   * not update a message), which takes the licence, the message, the keys and
   * the cutoff and touches nothing else. Only this licence's e-mailed-file
   * keys are named, so an upload is never deleted from here.
   *
   * A store that cannot be reached stops the step, not the sweep: what was
   * purged so far is reported, the rest of this tenant's sweep — and its audit
   * entry, which records everything the run did delete — still runs, and the
   * next run picks the files up again.
   */
  async #purgeSensitiveFiles(
    context: TenantContext,
    cutoff: Date,
    dryRun: boolean,
  ): Promise<number> {
    const prefix = `${context.licenseId}-m-%`;
    const select = (tx: TenantClient, limit: number) =>
      tx.$queryRaw<Array<{ id: string; keys: string[] }>>`
        SELECT m.id, array_agg(entry ->> 'key') AS keys
          FROM ticket_messages AS m,
               jsonb_array_elements(m.attachments) AS entry
         WHERE m.created_at < ${cutoff}
           AND entry -> 'sensitive' = 'true'::jsonb
           -- IS DISTINCT FROM, not <>: an entry with no \`purged\` at all is the
           -- common case, and \`NULL <> true\` would drop it.
           AND entry -> 'purged' IS DISTINCT FROM 'true'::jsonb
           AND entry ->> 'key' LIKE ${prefix}
         GROUP BY m.id, m.created_at
         ORDER BY m.created_at, m.id
         LIMIT ${limit}`;

    if (dryRun) {
      const rows = await withTenant(this.#db, context, (tx) => select(tx, 1_000_000));
      return rows.reduce((sum, row) => sum + row.keys.length, 0);
    }

    let total = 0;
    for (;;) {
      const rows = await withTenant(this.#db, context, (tx) => select(tx, RETENTION_BATCH));
      let marked = 0;
      for (const row of rows) {
        try {
          for (const key of row.keys) await this.#store!.delete(key);
        } catch (error) {
          if (error instanceof StorageUnavailableError) return total;
          throw error;
        }
        const done = await withTenant(
          this.#db,
          context,
          (tx) =>
            tx.$queryRaw<Array<{ marked: number }>>`
            SELECT ticket_message_purge_attachments(
              ${context.licenseId}::bigint, ${row.id}::uuid, ${row.keys}::text[], ${cutoff}::timestamptz
            ) AS marked`,
        );
        if ((done[0]?.marked ?? 0) > 0) {
          marked += 1;
          total += row.keys.length;
        }
      }
      // Fewer than a batch, or a batch nothing could be marked in (which would
      // otherwise be selected again forever): done.
      if (rows.length < RETENTION_BATCH || marked === 0) return total;
    }
  }

  async #countUnresolved(tx: TenantClient, cutoff: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM ai_unresolved_items WHERE created_at < ${cutoff}`;
    return Number(rows[0]?.n ?? 0n);
  }

  async #countThreadlessDecisions(tx: TenantClient, cutoff: Date): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM ai_decision_logs
       WHERE thread_id IS NULL AND created_at < ${cutoff}`;
    return Number(rows[0]?.n ?? 0n);
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
   * RLS-bound `siyahtus_app` connection, which holds EXECUTE but no table DELETE.
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
