/**
 * The scheduled SIEM sink (NFR-C6 · C6-d): deliver each workspace's pending
 * trail to its configured destination, and move the position on
 * `siem_export_cursors` — the one thing `siem-export.ts` deliberately does not
 * do (see its header).
 *
 * Mirrors `scheduled-report-sweeper.ts`'s shape (periodic job, per-tenant loop,
 * one failure isolated from the rest) with one addition that report has no
 * analogue for: a per-licence lock, because this job's crash-safety story is
 * the opposite of that one's.
 *
 * **The order invariant this whole module exists to hold:** the file is
 * written and closed — *then* the cursor advances, never the reverse. Getting
 * this backwards would let a crash between the two steps look, to the next
 * run, like the file's rows were delivered when they never left the process.
 * `C6-c`'s retention rule only protects what the cursor claims is delivered
 * (`audit_prune_expired` never prunes past it); reverse the order and that
 * claim can be false, and the rows it was covering are gone for good — the
 * "kalıcı denetim kaydı kaybı" (permanent audit-record loss) the finding named.
 * A crash is therefore only ever allowed to *redeliver* (the next run reads
 * the same unmoved cursor and writes the range again), never to skip.
 *
 * The lock is what keeps that true under concurrency, not just under a single
 * run's crash. Two overlapping sweeps — a retry, two instances, an operator and
 * a cron — must not both read the same pending range and race to advance the
 * cursor: the loser's write would either duplicate (tolerable) or, if it lost
 * the race after reading a now-stale page, drag the cursor backward and reopen
 * a range the winner already shipped (not tolerable — the retention rule would
 * then treat still-owed rows as delivered). `pg_advisory_xact_lock`, keyed like
 * `token-service.ts`'s session-cap lock, makes read-write-advance one critical
 * section per licence: the whole thing — the read, the file write, and the
 * cursor update — runs inside one tenant transaction holding the lock, so a
 * second sweep for the same licence blocks until the first has fully committed
 * or fully rolled back, and then sees the position the first one left.
 */
import type { PrismaClient } from '@prisma/client';
import { readEntitlements } from '../../lib/entitlements.js';
import { type TenantClient, type TenantContext, withTenant } from '../../lib/tenant.js';
import { deriveChainKey } from './audit-chain.js';
import { readAuditExportPage, sealExportPage } from './audit-export.js';
import { cursorOf, readSiemExportRow } from './siem-export.js';
import { FileSiemTarget, type SiemBatch, type SiemTarget } from './siem-target.js';

/** How much of a failure's message is kept — same bound as the report sweeper. */
const ERROR_MAX_LENGTH = 500;

export interface SiemSinkOptions {
  /** Root the file sink writes under (`env.SIEM_DIR`). `.data/siem` by default. */
  siemDir: string;
  /**
   * Where a sealed page goes (`SIEM_PROVIDER`, via `createSiemTarget`).
   *
   * Optional, defaulting to the file sink over `siemDir`: every caller that
   * only ever wanted the mock — the tests, and anything constructed before this
   * seam existed — keeps saying `{ siemDir }` and gets exactly what it got
   * before. The runners pass one built from the env, which is what makes
   * `SIEM_PROVIDER` a setting that is read rather than merely validated.
   */
  target?: SiemTarget;
  /** `AUDIT_CHAIN_SECRET` — the export's records are signed exactly as the pull endpoint signs them. */
  auditChainSecret: string;
  /** Same horizon the pull endpoint reads to (`env.SIEM_EXPORT_HORIZON_MS`). */
  horizonMs: number;
}

export interface SiemSinkDelivery {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  /** Null when the workspace has never configured an export. */
  target: string | null;
  /**
   * `delivered` — a file was written and the cursor moved. `empty` — the sink
   * ran but nothing was pending (`last_run_at` still moves; see `siem-export.ts`
   * on why that distinction matters to the status screen). `skipped` — nothing
   * was even attempted: no enabled destination, or a plan that does not include
   * SIEM export. `failed` — an error (a write that could not complete) rolled
   * the whole attempt back; the cursor is exactly where it was before this run.
   */
  status: 'delivered' | 'empty' | 'skipped' | 'failed';
  /** Records written to the file, 0 unless `status === 'delivered'`. */
  delivered: number;
  /** Path of the file written, or null when nothing was. */
  file: string | null;
  /**
   * Why this workspace got nothing — a failure on `failed`, and on `skipped`
   * the reason when it is not simply "switched off". An operator reading a
   * report where a workspace with `enabled = true` shipped nothing needs the
   * sentence; "skipped" on its own reads as a bug.
   */
  error: string | null;
}

export interface SiemSinkReport {
  startedAt: string;
  finishedAt: string;
  tenants: SiemSinkDelivery[];
  totals: { tenants: number; delivered: number; empty: number; skipped: number; failed: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export class SiemSink {
  readonly #db: PrismaClient;
  readonly #target: SiemTarget;
  readonly #auditChainSecret: string;
  readonly #horizonMs: number;

  constructor(db: PrismaClient, options: SiemSinkOptions) {
    this.#db = db;
    this.#target = options.target ?? new FileSiemTarget(options.siemDir);
    this.#auditChainSecret = options.auditChainSecret;
    this.#horizonMs = options.horizonMs;
  }

  /**
   * `now` is injected for the same reason every other sweep takes it: a test
   * has to be able to run the same instant twice and prove the second pass
   * moves nothing new.
   */
  async run(options: { now?: Date } = {}): Promise<SiemSinkReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const tenants = await this.#listTenants();
    const results: SiemSinkDelivery[] = [];
    for (const tenant of tenants) {
      results.push(await this.#sweepTenant(tenant, now));
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        delivered: results.reduce((sum, r) => sum + r.delivered, 0),
        empty: results.filter((r) => r.status === 'empty').length,
        skipped: results.filter((r) => r.status === 'skipped').length,
        failed: results.filter((r) => r.status === 'failed').length,
      },
    };
  }

  /**
   * Cross-tenant read via the shared SECURITY DEFINER enumerator — the only
   * place this job steps outside a single-tenant context, and it reads
   * nothing but the two ids the loop needs.
   */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  /**
   * One tenant, isolated: a write failure here (a directory the process
   * cannot create, a full disk) must not stop the rest of the workspaces from
   * shipping. Whatever went wrong already rolled the tenant's transaction
   * back — see `#deliverLocked` — so `failed` here is reported with the
   * cursor provably untouched, not merely believed to be.
   */
  async #sweepTenant(tenant: TenantRow, now: Date): Promise<SiemSinkDelivery> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    try {
      return await withTenant(this.#db, context, (tx) => this.#deliverLocked(tx, context, now));
    } catch (error) {
      return {
        licenseId: tenant.license_id.toString(),
        target: null,
        status: 'failed',
        delivered: 0,
        file: null,
        error: sanitiseError(error),
      };
    }
  }

  /**
   * The whole critical section for one licence: take the lock, read the
   * position, write the file, advance the position. One transaction, so a
   * throw anywhere in it — including from the filesystem write — rolls back
   * everything, and a concurrent sweep for the same licence blocks on the lock
   * until this one has fully committed or fully failed.
   */
  async #deliverLocked(
    tx: TenantClient,
    context: TenantContext,
    now: Date,
  ): Promise<SiemSinkDelivery> {
    const licenseId = context.licenseId;
    const base = { licenseId: licenseId.toString() };

    // Keyed like token-service.ts's session-cap lock: a fixed namespace plus a
    // per-licence value, so this sink's lock and any other feature's advisory
    // lock cannot collide, and one licence's delivery never blocks another's.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext('nexa.siem-sink'), hashtext(${licenseId.toString()}))`;

    const row = await readSiemExportRow(tx);
    if (!row || !row.enabled) {
      // No destination, or the feed is switched off: nothing to attempt, and
      // nothing recorded — turning it back on later must not find a
      // `last_run_at` from runs that never actually shipped anything.
      return {
        ...base,
        target: row?.target ?? null,
        status: 'skipped',
        delivered: 0,
        file: null,
        error: null,
      };
    }

    // The plan, checked here and not only at the endpoints that configure this
    // (FR-MOD-11.5). A licence that turned the feed on as Enterprise and then
    // downgraded still has `enabled = true` — the row survives on purpose
    // (§C-A26) — and a gate that lived only on the HTTP surface would let this
    // loop go on shipping the workspace's entire security trail to an external
    // system, on a schedule, for a capability it no longer pays for. That is
    // the quiet half of the leak; the write gate is the loud half.
    //
    // `skipped` rather than `failed`: nothing went wrong and nothing needs
    // retrying. The cursor stays where it is, so re-upgrading resumes from the
    // last delivered record rather than re-sending the trail or skipping the
    // gap.
    const { plan, entitlements } = await readEntitlements(tx, context);
    if (!entitlements.siem_export) {
      return {
        ...base,
        target: row.target,
        status: 'skipped',
        delivered: 0,
        file: null,
        error: `SIEM export is not included in the ${plan} plan.`,
      };
    }

    const chainKey = deriveChainKey(this.#auditChainSecret, licenseId);
    const page = await readAuditExportPage(tx, {
      after: cursorOf(row),
      horizonMs: this.#horizonMs,
      now,
      chainKey,
    });

    if (page.records.length === 0) {
      // Ran, found nothing new. `last_run_at` moves so the status screen can
      // tell this apart from a feed that has stopped running entirely; the
      // delivery position does not, because nothing was delivered.
      await tx.siemExportCursor.updateMany({
        where: { licenseId, target: row.target },
        data: { lastRunAt: now },
      });
      return {
        ...base,
        target: row.target,
        status: 'empty',
        delivered: 0,
        file: null,
        error: null,
      };
    }

    const sealed = sealExportPage(chainKey, licenseId, page.records);
    const file = await deliverToTarget(this.#target, row.target, {
      licenseId,
      now,
      body: sealed.body,
      signature: sealed.signature,
    });

    // Past this point the file is written and closed. Only now may the
    // position move — the invariant this module exists to hold.
    const last = page.records[page.records.length - 1]!;
    await tx.siemExportCursor.updateMany({
      where: { licenseId, target: row.target },
      data: {
        lastExportedId: last.id,
        lastExportedAt: new Date(last.created_at),
        lastRunAt: now,
        exportedCount: { increment: BigInt(page.records.length) },
      },
    });

    return {
      ...base,
      target: row.target,
      status: 'delivered',
      delivered: page.records.length,
      file,
      error: null,
    };
  }
}

/**
 * Hand one page to the configured destination and return the locator it gives
 * back.
 *
 * The guard looks like overkill for a vocabulary of one value, but the two
 * vocabularies are not the same one: `row.target` is what the *workspace* chose
 * and lives in the database, while the target instance is what this *build* can
 * deliver to. The database will happily hold a target this deployment gained no
 * delivery code for — a workspace configured against a build that had a Splunk
 * provider, running on one that does not — and failing loudly here is better
 * than a silent no-op that quietly stops shipping that workspace's trail. It
 * throws inside the tenant transaction, so the cursor stays put and the range
 * is still owed.
 */
async function deliverToTarget(
  target: SiemTarget,
  configured: string,
  batch: SiemBatch,
): Promise<string> {
  if (configured !== target.name) {
    throw new Error(`no delivery implementation for SIEM target "${configured}"`);
  }
  return target.deliver(batch);
}

/** A failure as one bounded line — identical shape to the report sweeper's. */
function sanitiseError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const message = collapsed === '' ? 'Delivery failed.' : collapsed;
  return message.length > ERROR_MAX_LENGTH ? `${message.slice(0, ERROR_MAX_LENGTH - 1)}…` : message;
}
