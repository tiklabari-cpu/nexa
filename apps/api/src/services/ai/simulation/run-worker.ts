/**
 * The test run worker (tm 314.2 · SiyahTuş analysis AI-19 §2, §7): plays the
 * queued runs (`ai_test_runs`) in the background, the `ai_jobs` worker's
 * pattern (ADR-11a) on a table of its own.
 *
 *   1. **Finding work.** A claim pass every {@link AI_TEST_RUN_POLL_MS}, and
 *      whenever the route that queued a run asks ({@link AiTestRunWorker.wake})
 *      or a run of this worker ends. At most {@link AI_TEST_RUN_CONCURRENCY}
 *      runs at once in a process; `ai_test_runs_claim` hands out one run per
 *      workspace at a time, across every process.
 *   2. **Two scenarios at a time.** A run plays its scenarios two at once
 *      (`AI_TEST_CONCURRENT_SCENARIOS`, AI-19-S2) — and since a workspace has
 *      one run playing, that is the workspace's limit too. Each scenario has
 *      its 60 s (`runner.ts`).
 *   3. **Durable.** Each result is written as its scenario ends, with the
 *      run's counts and its lease moved on; the lease is also moved on every
 *      third of its length while the scenarios play. A worker that dies leaves
 *      its run `running` until the lease runs out, and the next claim — any
 *      process — plays the scenarios that have no result; a run that every
 *      claim died on fails (`AI_TEST_RUN_MAX_ATTEMPTS`). A claim that lost its
 *      run writes nothing more (`test-runs.ts`'s fence).
 *   4. **The test allowance.** A scenario the test meter refused stops the
 *      run: nothing more can be played today, and the run fails saying so.
 *   5. **Shutdown.** {@link AiTestRunWorker.stop}: no new claims or scenarios;
 *      the scenarios in flight get {@link AI_TEST_RUN_DRAIN_MS}; then the runs
 *      are handed back `queued`, for the next process to go on with at once.
 */
import type { PrismaClient } from '@prisma/client';
import { AI_TEST_CONCURRENT_SCENARIOS } from '@siyahtus/types';
import { withTenant } from '../../../lib/tenant.js';
import { readSimulationSetting, type ScenarioRunner, type SimulatedScenario } from './runner.js';
import {
  AI_TEST_RUN_LEASE_MS,
  AI_TEST_RUN_MAX_ATTEMPTS,
  claimTestRun,
  extendTestRunLease,
  finishTestRun,
  readClaimedRun,
  recordScenarioResult,
  releaseTestRun,
  scenariosToPlay,
  type AiTestRunClaim,
} from './test-runs.js';

/** How often a worker looks for queued runs unasked. A run is not a visitor waiting: seconds do. */
export const AI_TEST_RUN_POLL_MS = 2_000;
/** Runs one process plays at once — each two scenarios at a time, each mostly waiting on the model. */
export const AI_TEST_RUN_CONCURRENCY = 4;
/** How long {@link AiTestRunWorker.stop} waits for the scenarios in flight. */
export const AI_TEST_RUN_DRAIN_MS = 10_000;

/** What a run that could not finish says (`ai_test_runs.error`). */
export const AI_TEST_RUN_ERRORS = {
  capped: "Today's test allowance (llm_test) is spent; the scenarios left were not played.",
  version: 'Configuration versions arrive with tm 316; this run names one that cannot be read.',
  internal: 'The run stopped on a server error; the server log has it.',
} as const;

/** The logger a run's lines go to; a Fastify or pino logger is one. */
export interface AiTestRunLogger {
  child(bindings: Record<string, unknown>): AiTestRunLogger;
  info(object: Record<string, unknown>, message: string): void;
  warn(object: Record<string, unknown>, message: string): void;
  error(object: Record<string, unknown>, message: string): void;
}

export interface AiTestRunWorkerOptions {
  db: PrismaClient;
  logger: AiTestRunLogger;
  runner: ScenarioRunner;
  /** How often to look unasked; null — only when woken (a test server's). */
  pollMs?: number | null;
  leaseMs?: number;
  maxAttempts?: number;
  concurrency?: number;
  scenarioConcurrency?: number;
  drainMs?: number;
}

interface InFlight {
  claim: AiTestRunClaim;
  /** Set when the worker stops: play no new scenario, hand the run back. */
  stopping: { value: boolean };
  done: Promise<void>;
}

/** Run `fn` over `items`, at most `limit` at a time, in order of start. */
async function inParallel<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < items.length) {
      const item = items[next]!;
      next += 1;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => lane()));
}

export class AiTestRunWorker {
  readonly #db: PrismaClient;
  readonly #log: AiTestRunLogger;
  readonly #runner: ScenarioRunner;
  readonly #pollMs: number | null;
  readonly #leaseMs: number;
  readonly #maxAttempts: number;
  readonly #concurrency: number;
  readonly #scenarioConcurrency: number;
  readonly #drainMs: number;

  #started = false;
  #stopping = false;
  #timer: NodeJS.Timeout | null = null;
  #pass: Promise<void> | null = null;
  #again = false;
  #claimFailing = false;
  readonly #inFlight = new Map<string, InFlight>();

  constructor(options: AiTestRunWorkerOptions) {
    this.#db = options.db;
    this.#log = options.logger;
    this.#runner = options.runner;
    this.#pollMs = options.pollMs === undefined ? AI_TEST_RUN_POLL_MS : options.pollMs;
    this.#leaseMs = options.leaseMs ?? AI_TEST_RUN_LEASE_MS;
    this.#maxAttempts = options.maxAttempts ?? AI_TEST_RUN_MAX_ATTEMPTS;
    this.#concurrency = options.concurrency ?? AI_TEST_RUN_CONCURRENCY;
    this.#scenarioConcurrency = options.scenarioConcurrency ?? AI_TEST_CONCURRENT_SCENARIOS;
    this.#drainMs = options.drainMs ?? AI_TEST_RUN_DRAIN_MS;
  }

  /** Begin taking runs. Once per worker. */
  start(): void {
    if (this.#started) throw new Error('AiTestRunWorker: start() once per worker');
    this.#started = true;
    if (this.#pollMs !== null) {
      this.#timer = setInterval(() => this.wake(), this.#pollMs);
      // A worker is never the reason a process stays up.
      this.#timer.unref();
      this.wake();
    }
  }

  /** Runs this worker is playing right now. */
  get inFlight(): number {
    return this.#inFlight.size;
  }

  /** Look for queued runs now. Concurrent calls fold into one pass. */
  wake(): void {
    if (!this.#started || this.#stopping) return;
    if (this.#pass) {
      this.#again = true;
      return;
    }
    this.#pass = this.#claimPass().finally(() => {
      this.#pass = null;
      if (this.#again) {
        this.#again = false;
        this.wake();
      }
    });
  }

  /**
   * Resolves once nothing is in flight and no pass is under way — "what was
   * queued so far has been played". Costs nothing when the worker was never
   * woken; for tests and scripts.
   */
  async idle(): Promise<void> {
    while (this.#pass || this.#inFlight.size > 0) {
      await this.#pass;
      await Promise.all([...this.#inFlight.values()].map((run) => run.done));
    }
  }

  /** Stop: no new claims or scenarios; the scenarios in flight get `drainMs`; the runs go back to the queue. */
  async stop(options: { drainMs?: number } = {}): Promise<void> {
    if (!this.#started || this.#stopping) return;
    this.#stopping = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#pass;
    if (this.#inFlight.size === 0) return;
    for (const run of this.#inFlight.values()) run.stopping.value = true;
    const drainMs = options.drainMs ?? this.#drainMs;
    let timer: NodeJS.Timeout | undefined;
    const finished = await Promise.race([
      Promise.all([...this.#inFlight.values()].map((run) => run.done)).then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), drainMs);
        timer.unref();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (finished) return;
    const left = [...this.#inFlight.values()];
    this.#log.warn(
      { in_flight: left.length, drain_ms: drainMs },
      'ai test runs still playing at shutdown; handing them back',
    );
    await Promise.all(
      left.map(({ claim }) =>
        releaseTestRun(this.#db, claim).catch((error: unknown) =>
          this.#log.warn(
            { err: error, run_id: claim.id },
            'ai test run could not be handed back; its lease will free it',
          ),
        ),
      ),
    );
  }

  /** One claim pass. Never rejects: a failing claim is retried by the next poll. */
  async #claimPass(): Promise<void> {
    while (this.#inFlight.size < this.#concurrency && !this.#stopping) {
      let claim: AiTestRunClaim | null;
      try {
        claim = await claimTestRun(this.#db, {
          leaseMs: this.#leaseMs,
          maxAttempts: this.#maxAttempts,
        });
      } catch (error) {
        if (!this.#claimFailing) {
          this.#claimFailing = true;
          this.#log.error({ err: error }, 'ai test runs could not be claimed; retrying every poll');
        }
        return;
      }
      if (this.#claimFailing) {
        this.#claimFailing = false;
        this.#log.info({}, 'ai test runs can be claimed again');
      }
      if (claim === null) return;
      this.#launch(claim);
    }
  }

  #launch(claim: AiTestRunClaim): void {
    const stopping = { value: false };
    const key = `${claim.id}:${claim.attempts}`;
    const done = this.#play(claim, stopping).finally(() => {
      this.#inFlight.delete(key);
      // The workspace's next run may be due now.
      this.wake();
    });
    this.#inFlight.set(key, { claim, stopping, done });
  }

  async #play(claim: AiTestRunClaim, stopping: { value: boolean }): Promise<void> {
    const log = this.#log.child({
      license_id: String(claim.context.licenseId),
      organization_id: claim.context.organizationId,
      run_id: claim.id,
      attempt: claim.attempts,
    });
    let lost = false;
    const beat = setInterval(
      () => {
        void extendTestRunLease(this.#db, claim, this.#leaseMs)
          .then((held) => {
            if (!held) lost = true;
          })
          .catch((error: unknown) => log.warn({ err: error }, 'ai test run lease not extended'));
      },
      Math.max(1_000, Math.floor(this.#leaseMs / 3)),
    );
    beat.unref();
    try {
      const run = await withTenant(this.#db, claim.context, (tx) => readClaimedRun(tx, claim), {
        readOnly: true,
      });
      if (!run) return;
      if (run.target === 'version') {
        await finishTestRun(this.#db, claim, {
          status: 'failed',
          error: AI_TEST_RUN_ERRORS.version,
        });
        return;
      }
      const target = run.target;
      const { setting, todo } = await withTenant(
        this.#db,
        claim.context,
        async (tx) => ({
          setting: await readSimulationSetting(tx, claim.context, {
            aiAgentId: run.aiAgentId,
            target,
          }),
          todo: await scenariosToPlay(tx, run),
        }),
        { readOnly: true },
      );

      let capped = false;
      await inParallel(todo, this.#scenarioConcurrency, async (scenario: SimulatedScenario) => {
        if (lost || capped || stopping.value) return;
        const play = await this.#runner.play(setting, scenario, { startedAt: run.startedAt });
        if (!(await recordScenarioResult(this.#db, claim, scenario, play, this.#leaseMs))) {
          lost = true;
          return;
        }
        if (play.capped) capped = true;
      });

      if (lost) {
        log.warn({}, 'ai test run was taken over by another claim; this one stops');
        return;
      }
      if (stopping.value) {
        await releaseTestRun(this.#db, claim);
        return;
      }
      await finishTestRun(
        this.#db,
        claim,
        capped ? { status: 'failed', error: AI_TEST_RUN_ERRORS.capped } : { status: 'completed' },
      );
    } catch (error) {
      log.error({ err: error }, 'ai test run failed');
      await finishTestRun(this.#db, claim, {
        status: 'failed',
        error: AI_TEST_RUN_ERRORS.internal,
      }).catch((failed: unknown) =>
        log.error(
          { err: failed },
          'ai test run could not be marked failed; its lease will free it',
        ),
      );
    } finally {
      clearInterval(beat);
    }
  }
}
