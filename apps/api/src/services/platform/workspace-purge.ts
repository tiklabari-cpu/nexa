/**
 * The purge job (tm 389.10 · FR-ADMIN-09): a workspace whose scheduled
 * deletion (`licenses.purge_scheduled_at`) has come is deleted, and the
 * platform audit chain says so (`workspace.purged`).
 *
 * It runs in the platform process, not in the tenant API's scheduler where the
 * task first placed it: the purge has to write the platform chain in the same
 * transaction as the delete, and only this process holds the chain's key and
 * the role that may write `platform_audit_log` (the tenant role is refused
 * every platform table, 20261101090000). A tenant-side job could only delete
 * and leave the record to somebody else — the gap this chain exists to close.
 *
 * Leader-only, the way the tenant API's sweeps are: the same Redis lock
 * (`JobLock`, `siyahtus:sched:workspace_purge`) held for just under the
 * interval, so N platform-api replicas purge once between them. The delete
 * itself is `platform_purge_workspace` (20261103090000) — one workspace per
 * call and transaction, the schedule re-checked under its row lock, and a row
 * in use (`NOWAIT`, the retention sweep deleting the same workspace's old
 * rows, a request) rolls the attempt back, entry included, for the next pass.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { JobLock, lockTtlMs, type LockRedis } from '../scheduler/lock.js';
import type { PlatformAuditLog } from './platform-audit.js';

/** Hourly: the cooling-off is fourteen days; an hour late is nothing. */
export const WORKSPACE_PURGE_INTERVAL_MS = 60 * 60_000;
export const WORKSPACE_PURGE_LOCK = 'workspace_purge';
/** Workspaces per pass — a pass stays short however long the queue. */
export const WORKSPACE_PURGE_BATCH = 20;

/** The entry's reason: the operator's own was recorded when it was scheduled. */
export const WORKSPACE_PURGE_REASON =
  'Scheduled deletion: the 14-day cooling-off period has ended.';

export interface WorkspacePurgeReport {
  purged: string[];
  /** Due, but in use right now or no longer due — looked at again next pass. */
  deferred: string[];
}

export interface WorkspacePurgeRunnerOptions {
  db: PrismaClient;
  redis: LockRedis;
  audit: PlatformAuditLog;
  logger: FastifyBaseLogger;
  /** Whether this process runs the timer at all (`env.schedulerEnabled`). */
  enabled: boolean;
  now?: () => number;
}

class NothingPurged extends Error {}

export class WorkspacePurgeRunner {
  readonly #options: WorkspacePurgeRunnerOptions;
  readonly #lock: JobLock;
  #timer: NodeJS.Timeout | null = null;
  #inFlight: Promise<unknown> | null = null;
  #stopped = false;

  constructor(options: WorkspacePurgeRunnerOptions) {
    this.#options = options;
    this.#lock = new JobLock(options.redis);
  }

  start(): void {
    if (!this.#options.enabled || this.#timer !== null || this.#stopped) return;
    this.#schedule(60_000);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    await this.#inFlight?.catch(() => undefined);
  }

  #schedule(delayMs: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#inFlight = this.tick().finally(() => {
        this.#inFlight = null;
        this.#schedule(WORKSPACE_PURGE_INTERVAL_MS);
      });
    }, delayMs);
    this.#timer.unref();
  }

  /** One timer tick: the leader lock, then a pass. Public for tests. */
  async tick(): Promise<WorkspacePurgeReport | 'skipped' | 'failed'> {
    try {
      const token = await this.#lock.acquire(
        WORKSPACE_PURGE_LOCK,
        lockTtlMs(WORKSPACE_PURGE_INTERVAL_MS),
      );
      if (token === null) return 'skipped';
      return await this.run();
    } catch (error) {
      this.#options.logger.warn({ err: error }, 'workspace purge tick failed');
      return 'failed';
    }
  }

  /** One pass, lock or no lock — what a tick does once it holds the lock. */
  async run(): Promise<WorkspacePurgeReport> {
    const { db, audit, logger } = this.#options;
    const now = new Date((this.#options.now ?? Date.now)());
    const due = await db.license.findMany({
      where: { purgeScheduledAt: { lte: now } },
      orderBy: [{ purgeScheduledAt: 'asc' }, { id: 'asc' }],
      take: WORKSPACE_PURGE_BATCH,
      select: { id: true, purgeScheduledAt: true },
    });

    const report: WorkspacePurgeReport = { purged: [], deferred: [] };
    for (const license of due) {
      const licenseId = license.id;
      try {
        await db.$transaction(
          async (tx) => {
            const [row] = await tx.$queryRaw<
              Array<{ organization_deleted: boolean; sandbox_license_id: bigint | null }>
            >`SELECT * FROM platform_purge_workspace(${licenseId})`;
            // Cancelled between the scan and the lock: nothing deleted, nothing recorded.
            if (!row) throw new NothingPurged();
            await audit.record(
              {
                adminId: null,
                action: 'workspace.purged',
                targetType: 'workspace',
                targetId: licenseId.toString(),
                licenseId,
                reason: WORKSPACE_PURGE_REASON,
                payload: {
                  scheduled_for: license.purgeScheduledAt?.toISOString() ?? null,
                  organization_deleted: row.organization_deleted,
                  sandbox_license_id: row.sandbox_license_id?.toString() ?? null,
                },
              },
              tx,
            );
          },
          { timeout: 60_000 },
        );
        report.purged.push(licenseId.toString());
      } catch (error) {
        report.deferred.push(licenseId.toString());
        if (!(error instanceof NothingPurged)) {
          logger.warn(
            { err: error, license_id: licenseId.toString() },
            'workspace purge deferred to the next pass',
          );
        }
      }
    }
    if (report.purged.length > 0 || report.deferred.length > 0) {
      logger.info(
        { purged: report.purged.length, deferred: report.deferred.length },
        'workspace purge pass',
      );
    }
    return report;
  }
}
