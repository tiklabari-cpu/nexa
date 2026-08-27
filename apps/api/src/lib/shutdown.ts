/**
 * Graceful shutdown for the API process (M-OPS-b).
 *
 * What was here before was `process.once('SIGTERM', () => app.close())`, which
 * closes correctly and still drops requests. The gap is not in the closing —
 * Fastify's `close()` already lets in-flight requests finish — it is in the
 * moment *before* it. An orchestrator keeps routing to an instance until one of
 * its readiness probes fails, and it sends SIGTERM and removes the endpoint at
 * roughly the same time, in no guaranteed order. Everything routed in that
 * window arrives at a listener that has already stopped accepting, and the
 * caller sees a connection reset. That is what a rolling deploy looks like from
 * the client side, and it is what the sequence below removes:
 *
 *   1. Readiness turns false. `/health/ready` answers 503 `draining` from here
 *      on, which is the only signal an orchestrator actually watches.
 *   2. Wait `drainMs` while still accepting and answering normally. This is the
 *      window the orchestrator needs to notice step 1 and stop routing; requests
 *      that arrive during it are served, not refused.
 *   3. `app.close()` — stop accepting, let in-flight requests finish, then run
 *      the `onClose` hooks in reverse registration order: the scheduler stops
 *      and hands its Redis leader locks back (`services/scheduler/scheduler.ts`)
 *      before the Redis and Postgres connections those locks live on close.
 *
 * Two things that are easy to get wrong and are handled here rather than in the
 * caller:
 *
 * - **A second signal forces the exit.** An orchestrator that has run out of
 *   patience sends SIGTERM again before it reaches for SIGKILL; a handler that
 *   ignores it leaves the operator with nothing between "wait" and "kill -9".
 * - **The whole sequence is bounded.** A request that never completes, or a
 *   connection close that hangs, must not turn a deploy into a process that sits
 *   there until the orchestrator kills it — which would defeat the point, since
 *   SIGKILL truncates exactly the in-flight requests this exists to protect.
 */
import type { FastifyInstance } from 'fastify';

/**
 * Ceiling on everything after the drain window: in-flight requests finishing,
 * the scheduler's last pass settling, the leader locks going back and the
 * connections closing.
 *
 * Comfortably above any single request this API serves and comfortably below a
 * default `terminationGracePeriodSeconds` of 30s, so the process gets to decide
 * how it ends rather than having SIGKILL decide for it.
 */
export const CLOSE_TIMEOUT_MS = 15_000;

export interface ShutdownOptions {
  app: FastifyInstance;
  /** `env.shutdownDrainMs`. Zero skips the wait entirely — see `config/env.ts`. */
  drainMs: number;
  /** Injected by the tests so the sequence can be driven without real waiting. */
  wait?: (ms: number) => Promise<void>;
  /** Injected by the tests; nothing else has a reason to replace `process.exit`. */
  exit?: (code: number) => void;
  signals?: readonly NodeJS.Signals[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Steps 1–3 above. Resolves once the server is closed, or once
 * {@link CLOSE_TIMEOUT_MS} has passed with it refusing to.
 *
 * Exported on its own so a test can assert the sequence — that readiness flips
 * *before* the wait and that a request issued during the wait still gets an
 * answer — without installing a signal handler in the test process.
 */
export async function drainAndClose(options: {
  app: FastifyInstance;
  drainMs: number;
  wait?: (ms: number) => Promise<void>;
}): Promise<{ timedOut: boolean }> {
  const { app, drainMs } = options;
  const wait = options.wait ?? sleep;

  // Step 1, and first: every millisecond between the signal and this line is a
  // millisecond in which the orchestrator still believes this instance is ready.
  app.lifecycle.beginDraining();

  // Step 2. Skipped rather than awaited at zero — `setTimeout(0)` still costs a
  // macrotask on every one of the hundreds of server closes a suite does.
  if (drainMs > 0) {
    app.log.info({ drain_ms: drainMs }, 'draining: readiness is now false');
    await wait(drainMs);
  }

  // Step 3, bounded. `Promise.race` rather than an abort: there is nothing to
  // abort — the point of the timeout is to stop *waiting* on a close that is not
  // going to finish, so the caller can exit on its own terms.
  let timer: NodeJS.Timeout | undefined;
  const timedOut = await Promise.race([
    app.close().then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), CLOSE_TIMEOUT_MS);
      // Not the reason the process stays alive: if everything else has already
      // let go, waiting out this timer would be the only thing keeping it up.
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);

  return { timedOut };
}

/**
 * Wire SIGINT/SIGTERM to {@link drainAndClose}.
 *
 * `process.on`, not `once`: the second signal is meaningful (it forces the
 * exit), and `once` would hand it to Node's default handler, which terminates
 * immediately — the opposite of what somebody pressing Ctrl-C a second time
 * during a drain is asking for, and indistinguishable from a crash in the logs.
 */
export function installShutdownHandlers(options: ShutdownOptions): void {
  const { app, drainMs } = options;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const signals = options.signals ?? (['SIGINT', 'SIGTERM'] as const);

  let shuttingDown = false;

  for (const signal of signals) {
    process.on(signal, () => {
      if (shuttingDown) {
        // Deliberately not a graceful path: whoever sent this already asked
        // nicely once and is about to reach for SIGKILL instead. Losing the
        // in-flight requests is the answer they asked for.
        app.log.warn({ signal }, 'second shutdown signal — exiting now');
        exit(1);
        return;
      }
      shuttingDown = true;
      app.log.info({ signal, drain_ms: drainMs }, 'shutting down');

      void drainAndClose({ app, drainMs, ...(options.wait ? { wait: options.wait } : {}) }).then(
        ({ timedOut }) => {
          if (timedOut) {
            // A non-zero code because it is not a clean exit: something was
            // still holding on, and a deploy that logs this every time has a
            // request path or a connection that never lets go.
            app.log.error(
              { close_timeout_ms: CLOSE_TIMEOUT_MS },
              'shutdown timed out waiting for the server to close',
            );
            exit(1);
            return;
          }
          exit(0);
        },
        (error: unknown) => {
          app.log.error({ err: error }, 'error during shutdown');
          exit(1);
        },
      );
    });
  }
}
