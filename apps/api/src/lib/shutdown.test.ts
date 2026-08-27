/**
 * The shutdown sequence (M-OPS-b).
 *
 * A fake app rather than a real server here on purpose: the properties this
 * file is about are ordering and bounds — does readiness turn false *before*
 * the wait, does a second signal stop waiting, does a close that never resolves
 * eventually give up — and each of those is a race that a real Postgres and a
 * real Fastify would make slower to drive and no more convincing. That
 * in-flight requests actually survive the sequence is not a claim a double can
 * make, so it is proved against a real server in
 * `test/integration/graceful-shutdown.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createLifecycle } from '../plugins/lifecycle.js';
import { CLOSE_TIMEOUT_MS, drainAndClose, installShutdownHandlers } from './shutdown.js';

interface FakeApp {
  app: FastifyInstance;
  /** Everything the sequence did, in the order it did it. */
  events: string[];
  /** Resolves the pending `close()`. Absent until `close()` has been called. */
  finishClose: (() => void) | null;
  logs: Array<{ level: string; payload: Record<string, unknown>; message?: string }>;
}

/** A Fastify stand-in with a `close()` the test decides when to finish. */
function fakeApp(options: { closeResolves?: boolean; closeRejects?: Error } = {}): FakeApp {
  const events: string[] = [];
  const logs: FakeApp['logs'] = [];
  const lifecycle = createLifecycle();
  const state: FakeApp = { app: null as never, events, finishClose: null, logs };

  const log = (level: string) => (payload: Record<string, unknown>, message?: string) => {
    logs.push({ level, payload, ...(message === undefined ? {} : { message }) });
  };

  state.app = {
    lifecycle: {
      get draining() {
        return lifecycle.draining;
      },
      beginDraining() {
        events.push('draining');
        lifecycle.beginDraining();
      },
    },
    log: { info: log('info'), warn: log('warn'), error: log('error') },
    close: () => {
      events.push('close');
      if (options.closeRejects) return Promise.reject(options.closeRejects);
      if (options.closeResolves === false) return new Promise<void>(() => {});
      return new Promise<void>((resolve) => {
        state.finishClose = () => resolve();
      });
    },
  } as unknown as FastifyInstance;

  return state;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('drainAndClose', () => {
  it('turns readiness off before it waits, not after', async () => {
    const fake = fakeApp();
    const waited: number[] = [];

    const sequence = drainAndClose({
      app: fake.app,
      drainMs: 250,
      wait: async (ms) => {
        // Asserted from *inside* the wait: an implementation that closed first
        // and flipped the flag afterwards would still end with `draining` true,
        // so only the ordering distinguishes it, and only here.
        waited.push(ms);
        expect(fake.app.lifecycle.draining).toBe(true);
        fake.events.push(`wait:${ms}`);
      },
    });
    await vi.waitUntil(() => fake.finishClose !== null);
    fake.finishClose?.();
    await sequence;

    expect(waited).toEqual([250]);
    expect(fake.events).toEqual(['draining', 'wait:250', 'close']);
  });

  it('skips the wait entirely at zero, so a suite closing hundreds of servers pays nothing', async () => {
    const fake = fakeApp();
    const wait = vi.fn(async () => {});

    const sequence = drainAndClose({ app: fake.app, drainMs: 0, wait });
    await vi.waitUntil(() => fake.finishClose !== null);
    fake.finishClose?.();

    expect(await sequence).toEqual({ timedOut: false });
    expect(wait).not.toHaveBeenCalled();
    expect(fake.events).toEqual(['draining', 'close']);
  });

  it('gives up on a close that never finishes rather than waiting for SIGKILL', async () => {
    vi.useFakeTimers();
    const fake = fakeApp({ closeResolves: false });

    const sequence = drainAndClose({ app: fake.app, drainMs: 0 });
    await vi.advanceTimersByTimeAsync(CLOSE_TIMEOUT_MS + 1);

    // The point of the bound: a process that sat here forever would be killed
    // with `-9`, which truncates the very in-flight requests the drain exists
    // to protect.
    expect(await sequence).toEqual({ timedOut: true });
  });

  it('reports the close as clean when it beats the timeout', async () => {
    vi.useFakeTimers();
    const fake = fakeApp();

    const sequence = drainAndClose({ app: fake.app, drainMs: 0 });
    await vi.waitUntil(() => fake.finishClose !== null);
    fake.finishClose?.();
    await vi.advanceTimersByTimeAsync(CLOSE_TIMEOUT_MS + 1);

    expect(await sequence).toEqual({ timedOut: false });
  });
});

describe('installShutdownHandlers', () => {
  /** Handlers are torn down per test so signals never leak between them. */
  function install(options: Parameters<typeof installShutdownHandlers>[0]): () => void {
    const signal = options.signals?.[0] ?? 'SIGTERM';
    const before = process.listeners(signal).slice();
    installShutdownHandlers(options);
    return () => {
      for (const listener of process.listeners(signal)) {
        if (!before.includes(listener)) process.removeListener(signal, listener);
      }
    };
  }

  it('runs the sequence and exits 0 on the first signal', async () => {
    const fake = fakeApp();
    const exit = vi.fn();
    const teardown = install({
      app: fake.app,
      drainMs: 0,
      exit,
      signals: ['SIGUSR2'],
    });

    process.emit('SIGUSR2');
    await vi.waitUntil(() => fake.finishClose !== null);
    fake.finishClose?.();
    await vi.waitUntil(() => exit.mock.calls.length > 0);

    expect(exit).toHaveBeenCalledWith(0);
    expect(fake.events).toEqual(['draining', 'close']);
    teardown();
  });

  it('exits immediately on a second signal instead of waiting out the drain', async () => {
    // The operator's escape hatch: whoever sends it has already asked nicely
    // once and is otherwise left with nothing between "wait" and `kill -9`.
    const fake = fakeApp({ closeResolves: false });
    const exit = vi.fn();
    const teardown = install({
      app: fake.app,
      drainMs: 5_000,
      exit,
      wait: () => new Promise<void>(() => {}),
      signals: ['SIGUSR2'],
    });

    process.emit('SIGUSR2');
    await vi.waitUntil(() => fake.app.lifecycle.draining);
    expect(exit).not.toHaveBeenCalled();

    process.emit('SIGUSR2');
    expect(exit).toHaveBeenCalledWith(1);
    // Never reached `close()`: the second signal cut the drain window short
    // rather than queueing behind it.
    expect(fake.events).toEqual(['draining']);
    expect(fake.logs.some((line) => line.level === 'warn')).toBe(true);
    teardown();
  });

  it('keeps listening after the first signal — `once` would let Node kill the process', async () => {
    // With `process.once` the second SIGTERM has no handler and Node's default
    // terminates on the spot, which looks like a crash rather than a decision.
    const fake = fakeApp({ closeResolves: false });
    const teardown = install({
      app: fake.app,
      drainMs: 0,
      exit: vi.fn(),
      signals: ['SIGUSR2'],
    });

    expect(process.listenerCount('SIGUSR2')).toBeGreaterThan(0);
    process.emit('SIGUSR2');
    expect(process.listenerCount('SIGUSR2')).toBeGreaterThan(0);
    teardown();
  });

  it('exits 1 when the close rejects', async () => {
    const fake = fakeApp({ closeRejects: new Error('pool already gone') });
    const exit = vi.fn();
    const teardown = install({
      app: fake.app,
      drainMs: 0,
      exit,
      signals: ['SIGUSR2'],
    });

    process.emit('SIGUSR2');
    await vi.waitUntil(() => exit.mock.calls.length > 0);

    expect(exit).toHaveBeenCalledWith(1);
    expect(fake.logs.some((line) => line.level === 'error')).toBe(true);
    teardown();
  });
});
