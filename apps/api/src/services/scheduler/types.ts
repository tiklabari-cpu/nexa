/**
 * The scheduler's vocabulary: what a background job is, what one pass reports,
 * and what `/health` shows for it.
 *
 * Kept apart from `scheduler.ts` so a job module can describe itself without
 * importing the machinery that runs it, and so the health route can type its
 * body without importing either.
 */
import type { FastifyBaseLogger } from 'fastify';

/**
 * How a pass ended.
 *
 * - `ok`       — the job ran to completion.
 * - `skipped`  — another instance held this interval's lock, so this one
 *                deliberately did nothing (see `lock.ts`).
 * - `error`    — the job threw, or the lock could not be reached.
 * - `disabled` — registered but switched off: it has never run and will not.
 */
export type JobStatus = 'ok' | 'skipped' | 'error' | 'disabled';

export interface JobRunContext {
  /**
   * Aborted when the scheduler stops, so a pass that walks every tenant can
   * give up between tenants instead of holding shutdown open.
   */
  readonly signal: AbortSignal;
  /** Child logger already tagged with the job name. */
  readonly logger: FastifyBaseLogger;
}

export interface JobOutcome {
  /**
   * Counters folded into the job's log line — `{ closed: 3, tenants: 12 }`.
   *
   * Numbers only, deliberately: this line is written for every pass of every
   * sweep, and a free-form field is how a customer's address ends up in a log
   * (the same reason `req.url` is masked rather than trusted — `log-redact.ts`).
   */
  readonly counts?: Readonly<Record<string, number>>;
}

export interface JobDefinition {
  /** Stable `lower_snake_case`: it is a Redis key, a span name and a health row. */
  readonly name: string;
  readonly intervalMs: number;
  /**
   * `false` registers the job without ever running it, and `/health` says so.
   *
   * The retention sweep arrives this way unless `RETENTION_ENABLED` is set: a
   * deployment must not hard-delete data because nobody read the default. A job
   * that were simply left unregistered instead would be indistinguishable, from
   * the outside, from one somebody forgot to write.
   */
  readonly enabled?: boolean;
  run(context: JobRunContext): Promise<JobOutcome | void>;
}

/** One row of the `scheduler` block in the `/health` body. */
export interface JobSnapshot {
  name: string;
  interval_ms: number;
  enabled: boolean;
  /**
   * When the job last *ticked*, whatever came of it — ISO-8601, or null before
   * the first tick. The first question asked of a scheduler is whether it is
   * ticking at all, so a skip and a failure both move this.
   */
  last_run_at: string | null;
  last_status: JobStatus | null;
  /**
   * The error's *class*, never its message: driver messages carry connection
   * strings, and `/health` is the one body an unauthenticated monitor reads
   * (`routes/health.ts` draws the same line for its dependency probes).
   */
  last_error_class?: string;
}

export interface SchedulerSnapshot {
  /** Whether this process runs jobs at all (`SCHEDULER_ENABLED`). */
  enabled: boolean;
  jobs: JobSnapshot[];
}
