/**
 * In-process background job scheduler (M-SCHED-a · §D113/K1).
 *
 * Five correctness-critical sweeps — idle chat auto-close, SLA breach marking,
 * the SIEM export, scheduled reports and retention — existed only as
 * `pnpm --filter @nexa/api <job>:run` scripts. Nothing started them, so a Nexa
 * brought up with `make dev` never closed an idle chat, never marked a breach
 * and never wrote a SIEM file, while the plan recorded all five as done. This is
 * the thing that runs them.
 *
 * In-process rather than a worker process, deliberately: `make dev` promises one
 * command and the deployment is one unit (ADR-11 — no external broker). What
 * that choice costs is that N API instances mean N schedulers, so `lock.ts` is
 * not an optimisation; it is what makes running more than one instance safe.
 *
 * Shape:
 *
 *   - One self-rescheduling `setTimeout` per job, not one `setInterval`. The
 *     next delay is computed after a pass settles, so a slow sweep pushes its
 *     own schedule instead of stacking passes on top of each other.
 *   - Timers are NOT `unref()`ed. A sweep that stops because the process happens
 *     to have nothing else pending is a sweep nobody notices is gone. (The
 *     partition maintenance timer in `plugins/database.ts` does unref, because
 *     losing a pass there costs performance, not correctness.) `stop()` is what
 *     ends it — and a test that forgets to call it will hang, which is the
 *     honest consequence of not unref'ing.
 *   - A job that throws is contained: its own row goes to `error`, its streak
 *     escalates the log level, every other job keeps its schedule, and nothing
 *     reaches the process. An unhandled rejection out of a timer callback would
 *     take the API down, which is a far worse outcome than a sweep that failed.
 *   - Every pass produces a span (`scheduler.<job>`) and one structured log line
 *     carrying the outcome, the duration and whatever the job counted.
 */
import { SpanStatusCode } from '@opentelemetry/api';
import type { FastifyBaseLogger } from 'fastify';
import type { Telemetry } from '../../telemetry/telemetry.js';
import { JobLock, lockTtlMs, type LockRedis } from './lock.js';
import type { JobDefinition, JobSnapshot, JobStatus, SchedulerSnapshot } from './types.js';

/**
 * Consecutive failures before a job's log line moves from `warn` to `error`.
 *
 * One failed pass is usually a blip the next one clears; three in a row is a
 * sweep that has stopped working, and that is what deserves to wake somebody.
 */
export const ERROR_ESCALATION_THRESHOLD = 3;

export interface SchedulerOptions {
  /**
   * Whether this process runs jobs at all (`env.schedulerEnabled`). Passed in
   * rather than checked at the call site so `snapshot()` stays the single answer
   * to "is anything sweeping here?" — including when the answer is no.
   */
  enabled: boolean;
  redis: LockRedis;
  logger: FastifyBaseLogger;
  /** Omitted or null disables spans; the jobs still run and still log. */
  telemetry?: Telemetry | null;
  /** Spread applied to each interval, in percent. 0 turns jitter off entirely. */
  jitterPct: number;
  /** Injected by tests so a jitter bound can be asserted rather than sampled. */
  random?: () => number;
}

interface JobState {
  definition: JobDefinition;
  timer: NodeJS.Timeout | null;
  lastRunAt: number | null;
  lastStatus: JobStatus | null;
  lastErrorClass: string | null;
  consecutiveErrors: number;
  inFlight: Promise<unknown> | null;
  /**
   * The lock token this process is holding for the job, or null when it holds
   * none. Kept past the end of a pass on purpose — the key outlives the work
   * as the "this interval is taken" marker (`lock.ts`) — so this is what lets
   * {@link Scheduler.stop} hand back an interval a departing process is still
   * sitting on.
   */
  heldToken: string | null;
}

/**
 * How long to wait before the next pass of a job.
 *
 * The *first* delay is a random phase anywhere inside the interval rather than a
 * jittered whole one: instances that came up from the same deploy would
 * otherwise all tick together on the first pass and only drift apart afterwards
 * — which is the moment the herd is largest and the lock does the most work.
 * Every later delay is the interval plus or minus `jitterPct`, so they keep
 * drifting instead of re-converging.
 *
 * Exported because bounds are far easier to assert on a pure function than to
 * infer from a timer.
 */
export function nextDelayMs(
  intervalMs: number,
  jitterPct: number,
  random: () => number,
  first: boolean,
): number {
  if (jitterPct <= 0) return intervalMs;
  const factor = first ? random() : 1 + (random() * 2 - 1) * (jitterPct / 100);
  // Never zero: a delay of 0 would re-run the job in the same tick of the event
  // loop for the rest of the process's life.
  return Math.max(1, Math.round(intervalMs * factor));
}

/**
 * The constructor's name rather than `error.name`: a subclass that never sets
 * `name` still reports `Error`, which tells whoever is reading `/health`
 * nothing at all.
 */
export function errorClassOf(error: unknown): string {
  if (error instanceof Error) return error.constructor?.name || error.name;
  return typeof error;
}

export class Scheduler {
  readonly #options: SchedulerOptions;
  readonly #lock: JobLock;
  readonly #random: () => number;
  readonly #jobs = new Map<string, JobState>();
  readonly #abort = new AbortController();
  #started = false;
  #stopped = false;

  constructor(options: SchedulerOptions) {
    this.#options = options;
    this.#lock = new JobLock(options.redis);
    this.#random = options.random ?? Math.random;
  }

  /**
   * Add a job. Boot-time only: registering into a running scheduler would leave
   * the first pass's timing dependent on when the registration happened to land.
   */
  register(definition: JobDefinition): void {
    if (this.#started) {
      throw new Error(`scheduler already started; register "${definition.name}" before start()`);
    }
    if (this.#jobs.has(definition.name)) {
      throw new Error(`duplicate scheduler job "${definition.name}"`);
    }
    if (!Number.isInteger(definition.intervalMs) || definition.intervalMs <= 0) {
      throw new Error(
        `scheduler job "${definition.name}" needs a positive whole-millisecond interval, got ${String(definition.intervalMs)}`,
      );
    }

    const enabled = definition.enabled !== false;
    this.#jobs.set(definition.name, {
      definition,
      timer: null,
      lastRunAt: null,
      // A switched-off job says so from the moment it is registered, rather than
      // looking like one that simply has not had its first pass yet.
      lastStatus: enabled ? null : 'disabled',
      lastErrorClass: null,
      consecutiveErrors: 0,
      inFlight: null,
      heldToken: null,
    });
  }

  start(): void {
    if (this.#started || this.#stopped) return;
    this.#started = true;

    if (!this.#options.enabled) {
      // Said out loud: "the sweeps did not run" is otherwise indistinguishable
      // from "the sweeps found nothing", which is how §D113/K1 went unnoticed.
      this.#options.logger.info(
        { jobs: this.#jobs.size },
        'scheduler disabled — no background jobs will run in this process',
      );
      return;
    }

    const scheduled: string[] = [];
    for (const state of this.#jobs.values()) {
      if (state.definition.enabled === false) continue;
      this.#schedule(state, true);
      scheduled.push(state.definition.name);
    }
    this.#options.logger.info(
      { jobs: scheduled, jitter_pct: this.#options.jitterPct },
      'scheduler started',
    );
  }

  /**
   * Stop scheduling, wait for whatever is mid-pass, then hand back every
   * interval this process is holding. Single use: no restart.
   *
   * The release is the part that matters at shutdown (M-OPS-b). A lock is
   * normally left to expire, because the key doubles as "this interval is
   * already taken" and handing it back early would let a second instance sweep
   * the same rows moments later (`lock.ts` says so at length). That reasoning
   * assumes the holder is still around to take the *next* interval too — and a
   * process that is exiting is not. Left behind, the key parks the job for up
   * to ninety percent of its interval with nobody sweeping: an hour of no
   * retention pass after a routine restart, and on a single-instance
   * deployment there is no other holder to cover it. The double run the marker
   * prevents costs one redundant idempotent pass; the parked interval costs a
   * sweep that does not happen at all, so the trade goes the other way here.
   *
   * Releasing is safe against the race it looks like it invites: the token is
   * owner-checked in Lua, so a lock that expired and was retaken by another
   * instance while this one drained is left exactly where it is.
   *
   * Ordered after the in-flight wait, not before it: a pass that is still
   * running is still holding its interval, and handing it back underneath
   * itself would invite the second instance in while the first is mid-sweep.
   */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#abort.abort();

    const inFlight: Array<Promise<unknown>> = [];
    for (const state of this.#jobs.values()) {
      if (state.timer !== null) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      if (state.inFlight !== null) inFlight.push(state.inFlight);
    }
    await Promise.allSettled(inFlight);

    await Promise.all(
      [...this.#jobs.values()]
        .filter((state) => state.heldToken !== null)
        .map((state) => this.#release(state.definition.name, state.heldToken!)),
    );
  }

  /** What `/health` reports. Registration order, which is the order jobs matter in. */
  snapshot(): SchedulerSnapshot {
    return {
      enabled: this.#options.enabled,
      jobs: [...this.#jobs.values()].map((state) => {
        const row: JobSnapshot = {
          name: state.definition.name,
          interval_ms: state.definition.intervalMs,
          enabled: state.definition.enabled !== false,
          last_run_at: state.lastRunAt === null ? null : new Date(state.lastRunAt).toISOString(),
          last_status: state.lastStatus,
        };
        if (state.lastErrorClass !== null) row.last_error_class = state.lastErrorClass;
        return row;
      }),
    };
  }

  #schedule(state: JobState, first: boolean): void {
    if (this.#stopped) return;
    const delay = nextDelayMs(
      state.definition.intervalMs,
      this.#options.jitterPct,
      this.#random,
      first,
    );
    state.timer = setTimeout(() => {
      state.timer = null;
      const pass = this.#pass(state)
        .catch((error: unknown) => {
          // `#pass` is written not to reject. This is the backstop that keeps
          // the day it does from becoming an unhandled rejection — which in Node
          // means the API process exits because a sweep had a bad minute.
          this.#options.logger.error(
            { job: state.definition.name, err: error },
            'scheduler pass escaped its own error handling',
          );
        })
        .finally(() => {
          state.inFlight = null;
          this.#schedule(state, false);
        });
      state.inFlight = pass;
    }, delay);
  }

  async #pass(state: JobState): Promise<void> {
    const { name, intervalMs } = state.definition;
    const logger = this.#options.logger;

    let token: string | null;
    try {
      token = await this.#lock.acquire(name, lockTtlMs(intervalMs));
    } catch (error) {
      // Redis is the only thing standing between one sweep and one per instance.
      // With no answer from it the job does not run: a retention pass that
      // deletes twice is worse than one that happens a minute late.
      this.#record(state, 'error', error);
      logger.warn(
        { job: name, outcome: 'error', error_class: errorClassOf(error), err: error },
        'scheduler could not reach the job lock — pass skipped',
      );
      return;
    }

    if (token === null) {
      this.#record(state, 'skipped', null);
      logger.debug({ job: name, outcome: 'skipped' }, 'scheduler job held by another instance');
      return;
    }

    // Recorded before the pass runs, so `stop()` can hand the interval back
    // however the pass ends — including the one that throws.
    state.heldToken = token;

    if (this.#stopped) {
      // Took the interval and will not use it. Handing it back lets a healthy
      // instance run the pass now instead of after the lock times out.
      await this.#release(name, token);
      return;
    }

    const span = this.#options.telemetry?.tracer.startSpan(`scheduler.${name}`) ?? null;
    const startedAt = Date.now();
    try {
      const outcome = await state.definition.run({
        signal: this.#abort.signal,
        logger: logger.child({ job: name }),
      });
      const durationMs = Date.now() - startedAt;
      this.#record(state, 'ok', null);
      span?.setAttributes({ outcome: 'ok', duration_ms: durationMs });
      logger.info(
        { job: name, outcome: 'ok', duration_ms: durationMs, ...(outcome?.counts ?? {}) },
        'scheduler job ran',
      );
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      this.#record(state, 'error', error);
      span?.recordException(error instanceof Error ? error : new Error(String(error)));
      span?.setStatus({ code: SpanStatusCode.ERROR });
      span?.setAttributes({ outcome: 'error', duration_ms: durationMs });

      const payload = {
        job: name,
        outcome: 'error',
        duration_ms: durationMs,
        error_class: errorClassOf(error),
        consecutive_errors: state.consecutiveErrors,
        err: error,
      };
      if (state.consecutiveErrors >= ERROR_ESCALATION_THRESHOLD) {
        logger.error(payload, 'scheduler job keeps failing');
      } else {
        logger.warn(payload, 'scheduler job failed');
      }
    } finally {
      span?.end();
    }
  }

  async #release(job: string, token: string): Promise<void> {
    // Cleared whatever happens below: a second release of the same token can
    // only delete a lock this process no longer owns, which is the one thing
    // the owner check exists to prevent.
    const state = this.#jobs.get(job);
    if (state?.heldToken === token) state.heldToken = null;

    try {
      await this.#lock.release(job, token);
    } catch (error) {
      // Nothing to do about it: the lock times out on its own, so the worst case
      // is one interval in which nobody sweeps.
      this.#options.logger.warn({ job, err: error }, 'scheduler could not release its job lock');
    }
  }

  #record(state: JobState, status: JobStatus, error: unknown): void {
    state.lastRunAt = Date.now();
    state.lastStatus = status;
    if (status === 'error') {
      state.consecutiveErrors += 1;
      state.lastErrorClass = errorClassOf(error);
    } else if (status === 'ok') {
      state.consecutiveErrors = 0;
      state.lastErrorClass = null;
    }
    // A skip leaves the streak alone: another instance took the interval, which
    // says nothing about whether this one's last failure has been fixed.
  }
}
