/**
 * `events` monthly partition maintenance (SEMA-MIMARI.8.4c · PLAN §D131 →
 * §D187 · tm 255.14).
 *
 * `events` is RANGE partitioned by month. An event whose month has no
 * partition is not lost — it lands in `events_default` — but that catch-all is
 * read whole by every range query that cannot rule it out, it grows without
 * bound, and once it holds rows for a month PostgreSQL refuses to open that
 * month's partition at all. So each month has to exist before its first event.
 *
 * This opens them: the current month, `monthsBehind` before it and
 * `monthsAhead` after it, at boot and every `intervalMs`. It replaces a single
 * `events_maintain_partitions(3, 1)` call, and differs from it in three ways,
 * each a way that call failed without anyone being able to see it:
 *
 *  - One statement per month. A month that fails — rows already in the default
 *    partition, a lock not free within the function's second — no longer rolls
 *    back the months before it in the loop or skips the ones after it: a
 *    blocked December must not also cost January.
 *  - The outcome is kept, not only logged. `snapshot()` is what `/health` shows
 *    an admin: when the last pass ran, which months failed and with which
 *    SQLSTATE. The old call's failure became one `log.error` line that no
 *    health check, alert or person ever read (§D131).
 *  - The window is computed once per pass from one clock, not from `now()`
 *    re-read by each statement — which at a month boundary could step over a
 *    month between two of them.
 *
 * Still never fatal, and still every process for itself: this is not a
 * scheduler job. `SCHEDULER_ENABLED=false` must not stop it, and a pass needs
 * no leader — opening a month twice is a no-op, and the SQL function survives
 * two instances racing for the same one.
 */
import { Prisma } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { errorClassOf } from '../scheduler/scheduler.js';

/**
 * How far ahead partitions are kept. Three months of runway: a pass that keeps
 * failing is on `/health` for a quarter before any event is affected.
 */
export const PARTITION_MONTHS_AHEAD = 3;
/** One month back, so a late write for last month still finds its partition. */
export const PARTITION_MONTHS_BEHIND = 1;
export const PARTITION_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type PartitionPassStatus = 'ok' | 'error';

export interface FailedMonth {
  /** `YYYY-MM`, UTC — the partition's own month. */
  month: string;
  /** The SQLSTATE, or the error's class when the database never answered. */
  error_code: string;
}

/** The `event_partitions` block of the admin `/health` body (OpenAPI `EventPartitionsHealth`). */
export interface EventPartitionsSnapshot {
  interval_ms: number;
  months_ahead: number;
  months_behind: number;
  last_run_at: string | null;
  last_status: PartitionPassStatus | null;
  consecutive_errors: number;
  failed_months: FailedMonth[];
}

export interface EventPartitionMaintenanceOptions {
  /**
   * Opens — or finds already open — the partition of the month that starts at
   * `monthStart`: `events_ensure_partition` in production, a recorder in tests.
   */
  ensureMonth: (monthStart: Date) => PromiseLike<unknown>;
  logger: FastifyBaseLogger;
  monthsAhead?: number;
  monthsBehind?: number;
  intervalMs?: number;
  /** Injected by tests; production reads the wall clock. */
  now?: () => Date;
}

/** First instant (UTC) of each month from `monthsBehind` before `now`'s month to `monthsAhead` after it. */
export function windowMonths(now: Date, monthsBehind: number, monthsAhead: number): Date[] {
  const months: Date[] = [];
  for (let offset = -monthsBehind; offset <= monthsAhead; offset += 1) {
    months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1)));
  }
  return months;
}

export function monthKey(monthStart: Date): string {
  return monthStart.toISOString().slice(0, 7);
}

/**
 * The SQLSTATE a failed call carries.
 *
 * Prisma reports a raw query's database error as `P2010` with the SQLSTATE in
 * `meta.code` (measured on Prisma 6.19). A failure that never reached the
 * database — a dropped connection, a pool timeout — has no SQLSTATE; its
 * Prisma code, or failing that its class, is the most that is safe to show.
 */
export function errorCodeOf(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const code = (error.meta as { code?: unknown } | undefined)?.code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    return error.code;
  }
  if (error instanceof Prisma.PrismaClientInitializationError && error.errorCode) {
    return error.errorCode;
  }
  return errorClassOf(error);
}

/**
 * The database's own sentence for a failure — for the log line, never for
 * `/health` (the same line `SchedulerJob.last_error_class` draws). Here it is
 * what an operator needs: "permission denied for schema public", "events_default
 * holds rows for 2026-12".
 */
function messageOf(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const message = (error.meta as { message?: unknown } | undefined)?.message;
    if (typeof message === 'string') return message;
  }
  return error instanceof Error ? error.message : String(error);
}

export class EventPartitionMaintenance {
  readonly #ensureMonth: (monthStart: Date) => PromiseLike<unknown>;
  readonly #logger: FastifyBaseLogger;
  readonly #monthsAhead: number;
  readonly #monthsBehind: number;
  readonly #intervalMs: number;
  readonly #now: () => Date;
  #lastRunAt: Date | null = null;
  #lastStatus: PartitionPassStatus | null = null;
  #consecutiveErrors = 0;
  #failedMonths: FailedMonth[] = [];
  #inFlight: Promise<void> | null = null;

  constructor(options: EventPartitionMaintenanceOptions) {
    this.#ensureMonth = options.ensureMonth;
    this.#logger = options.logger;
    this.#monthsAhead = options.monthsAhead ?? PARTITION_MONTHS_AHEAD;
    this.#monthsBehind = options.monthsBehind ?? PARTITION_MONTHS_BEHIND;
    this.#intervalMs = options.intervalMs ?? PARTITION_MAINTENANCE_INTERVAL_MS;
    this.#now = options.now ?? (() => new Date());

    for (const [name, value] of [
      ['monthsAhead', this.#monthsAhead],
      ['monthsBehind', this.#monthsBehind],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`event partition ${name} must be a whole number of months, got ${value}`);
      }
    }
  }

  get intervalMs(): number {
    return this.#intervalMs;
  }

  /**
   * One pass over the window. Never rejects — a failure is recorded, logged
   * and shown, and the process carries on serving: the default partition
   * catches every event a missing month would have refused. A caller that
   * arrives while a pass is running shares that pass rather than starting a
   * second one beside it.
   */
  run(): Promise<void> {
    this.#inFlight ??= this.#pass()
      .catch((error: unknown) => {
        // `#pass` is written not to reject; this is the backstop that keeps the
        // day it does from becoming an unhandled rejection out of a timer.
        this.#logger.error(
          { err: error },
          'event partition maintenance escaped its own error handling',
        );
      })
      .finally(() => {
        this.#inFlight = null;
      });
    return this.#inFlight;
  }

  /** Resolves once no pass is running — `onClose` waits on it before the pool goes away. */
  async settled(): Promise<void> {
    await this.#inFlight;
  }

  snapshot(): EventPartitionsSnapshot {
    return {
      interval_ms: this.#intervalMs,
      months_ahead: this.#monthsAhead,
      months_behind: this.#monthsBehind,
      last_run_at: this.#lastRunAt === null ? null : this.#lastRunAt.toISOString(),
      last_status: this.#lastStatus,
      consecutive_errors: this.#consecutiveErrors,
      failed_months: this.#failedMonths.map((failed) => ({ ...failed })),
    };
  }

  async #pass(): Promise<void> {
    const months = windowMonths(this.#now(), this.#monthsBehind, this.#monthsAhead);
    const failed: Array<FailedMonth & { message: string }> = [];

    for (const month of months) {
      try {
        await this.#ensureMonth(month);
      } catch (error) {
        failed.push({
          month: monthKey(month),
          error_code: errorCodeOf(error),
          message: messageOf(error),
        });
      }
    }

    this.#lastRunAt = this.#now();
    this.#failedMonths = failed.map(({ month, error_code }) => ({ month, error_code }));
    const window = { from: monthKey(months[0]!), to: monthKey(months[months.length - 1]!) };

    if (failed.length === 0) {
      const recoveredFrom = this.#consecutiveErrors;
      this.#lastStatus = 'ok';
      this.#consecutiveErrors = 0;
      if (recoveredFrom > 0) {
        this.#logger.info(
          { window, previous_consecutive_errors: recoveredFrom },
          'event partition maintenance recovered',
        );
      }
      return;
    }

    this.#lastStatus = 'error';
    this.#consecutiveErrors += 1;
    // `error` from the first failure, unlike the scheduler's warn-then-error:
    // passes are six hours apart, and the one this replaces went unread.
    this.#logger.error(
      { window, failed_months: failed, consecutive_errors: this.#consecutiveErrors },
      'event partition maintenance failed',
    );
  }
}
