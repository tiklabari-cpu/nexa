/**
 * The drain sequence against a real server (M-OPS-b).
 *
 * `lib/shutdown.test.ts` proves the ordering with a double. The two claims that
 * a double cannot make are here, and both need the real thing:
 *
 *   - a request that was already in flight when SIGTERM arrived still gets its
 *     answer, and gets it *after* the drain window has passed and the close has
 *     begun. That is a property of Fastify's own close and of a real listening
 *     socket; `app.inject()` never touches one, so these tests bind a port and
 *     speak HTTP.
 *   - the scheduler's Redis leader lock is not left behind. Left parked, the
 *     next holder waits out the TTL — up to ninety percent of the interval,
 *     which for retention is close to an hour, and on a single-instance
 *     deployment is nobody sweeping at all. That the key is gone is only
 *     checkable against the real Redis the real `onClose` hook wrote it to.
 */
import { setTimeout as delay } from 'node:timers/promises';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { drainAndClose } from '../../src/lib/shutdown.js';
import { LOCK_KEY_PREFIX } from '../../src/services/scheduler/lock.js';
import { buildServer, API_PREFIX } from '../../src/server.js';
import { testEnv } from '../helpers/fixtures.js';

/** Every server a test bound, closed in `afterEach` whatever the test did. */
const open: FastifyInstance[] = [];

interface Listening {
  app: FastifyInstance;
  origin: string;
}

async function listen(
  overrides: Partial<NodeJS.ProcessEnv> = {},
  /** Extra routes. Fastify refuses to add one after `listen()`, so they go here. */
  routes?: (app: FastifyInstance) => void,
): Promise<Listening> {
  const app = await buildServer({ env: testEnv(overrides) });
  open.push(app);
  routes?.(app);
  // Port 0 so parallel suites never collide, matching the RTM harness.
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (address === null || typeof address === 'string') throw new Error('server did not bind');
  return { app, origin: `http://127.0.0.1:${address.port}` };
}

afterEach(async () => {
  while (open.length > 0) {
    // Already-closed servers resolve immediately; a test that closed its own
    // must not make the teardown throw.
    await open
      .pop()
      ?.close()
      .catch(() => {});
  }
});

describe('readiness during a drain', () => {
  it('answers 503 draining while the process is still accepting requests', async () => {
    const { app, origin } = await listen();

    const before = await fetch(`${origin}${API_PREFIX}/health/ready`);
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ status: 'ok', service: 'api' });

    // The whole point of the window: the socket is still open and still
    // serving, and readiness is already false — which is the only way an
    // orchestrator can be told to stop routing here *before* anything closes.
    const draining = drainAndClose({ app, drainMs: 2_000 });

    const during = await fetch(`${origin}${API_PREFIX}/health/ready`);
    expect(during.status).toBe(503);
    // `draining`, not `degraded`: both mean "stop routing", but only one of
    // them means somebody should be woken up.
    expect(await during.json()).toEqual({ status: 'draining', service: 'api' });

    // Every reply written during the drain says not to reuse the connection
    // (`plugins/lifecycle.ts`). Without it the caller parks a keep-alive socket
    // on a process that is closing, and `close()` waits out `keepAliveTimeout`
    // — 72 seconds — for a connection nobody is using.
    expect(during.headers.get('connection')).toBe('close');

    // Liveness is unaffected — a process that is shutting down on request has
    // not failed, and reporting it as dead would only add a kill to a deploy.
    const live = await fetch(`${origin}${API_PREFIX}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toMatchObject({ status: 'ok', service: 'api' });

    await draining;
  });

  it('answers the legacy /health as draining too, so anything still pointed at it stops routing', async () => {
    const { app, origin } = await listen();

    const draining = drainAndClose({ app, drainMs: 1_000 });
    const response = await fetch(`${origin}${API_PREFIX}/health`);

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'draining', service: 'api' });

    await draining;
  });
});

describe('in-flight requests', () => {
  it('completes a request that was already running when the drain started', async () => {
    // A response that takes longer than the drain window, so the answer can
    // only arrive from a close that waited for it.
    let released = false;
    let arrived!: () => void;
    const handlerStarted = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const { app, origin } = await listen({}, (instance) => {
      instance.get('/__slow', { config: { public: true } }, async () => {
        arrived();
        while (!released) await delay(20);
        return { ok: true };
      });
    });

    const inFlight = fetch(`${origin}/__slow`);
    await handlerStarted;

    let settled = false;
    const draining = drainAndClose({ app, drainMs: 100 }).then((result) => {
      settled = true;
      return result;
    });

    // Well past the drain window: the close has begun and is waiting on the
    // handler, not on the clock.
    await delay(600);
    expect(settled).toBe(false);

    released = true;
    const response = await inFlight;
    // The failure this replaces is not a 503 — it is a connection reset,
    // because the listener was gone before the reply was written.
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    expect(await draining).toEqual({ timedOut: false });
  });

  it('refuses a request that arrives after the close, rather than answering it', async () => {
    // The drain window is a bounded courtesy, not an open door: once close()
    // has run, this instance is out of rotation for real.
    const { app, origin } = await listen();
    await drainAndClose({ app, drainMs: 0 });

    await expect(fetch(`${origin}${API_PREFIX}/health/live`)).rejects.toThrow();
  });
});

describe('the scheduler leader lock', () => {
  it('is gone from Redis once the server has closed', async () => {
    // Only `chat_timeout` is given a short interval — the other five are
    // pushed out of the way, so this test drives one cheap sweep rather than
    // all six.
    const { app } = await listen({
      SCHEDULER_ENABLED: 'true',
      SCHEDULE_JITTER_PCT: '0',
      SCHEDULE_CHAT_TIMEOUT_MS: '250',
      SCHEDULE_SLA_MS: '600000',
      SCHEDULE_SIEM_MS: '600000',
      SCHEDULE_SCHEDULED_REPORTS_MS: '600000',
      SCHEDULE_RETENTION_MS: '600000',
      SCHEDULE_WEBHOOK_REDELIVERY_MS: '600000',
    });
    const redis = app.redis;

    const deadline = Date.now() + 10_000;
    let held: string[] = [];
    while (held.length === 0) {
      if (Date.now() > deadline) throw new Error('the scheduler never took a lock');
      held = await redis.keys(`${LOCK_KEY_PREFIX}*`);
      if (held.length === 0) await delay(25);
    }
    // Guards the assertion below from passing vacuously: a run where the sweep
    // never fired would also find no keys afterwards.
    expect(held).toContain(`${LOCK_KEY_PREFIX}chat_timeout`);

    // A second connection, because `app.close()` takes `app.redis` with it.
    const observer = redis.duplicate();
    try {
      await drainAndClose({ app, drainMs: 0 });
      expect(await observer.keys(`${LOCK_KEY_PREFIX}*`)).toEqual([]);
    } finally {
      await observer.quit().catch(() => observer.disconnect());
    }
  });
});
