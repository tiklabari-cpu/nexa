/**
 * The job lock against a real Redis (M-SCHED-a).
 *
 * The scheduler lives inside the API process, so a deployment with three API
 * instances has three schedulers — and the only reason that is safe is that
 * `SET NX PX` is atomic and expiry is Redis's clock, not ours. Neither claim is
 * ours to assert with a double, which is why this suite exists next to the unit
 * one: the same code, with the real thing behind it, and two independent
 * connections so the race is between sockets rather than between calls.
 *
 * Every test invents its own job name. The isolation harness already gives the
 * run its own Redis database (CONVENTIONS §1.1), but a leftover key inside one
 * file would still make the next test in it lie.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { createRedisClient } from '../../src/plugins/redis.js';
import { JobLock, lockKey } from '../../src/services/scheduler/lock.js';
import { Scheduler } from '../../src/services/scheduler/scheduler.js';
import type { JobDefinition } from '../../src/services/scheduler/types.js';
import { testEnv } from '../helpers/fixtures.js';
import { silentLogger } from '../helpers/scheduler.js';

/** Two connections, so "who won" is decided by Redis and not by call order. */
let one: Redis;
let two: Redis;
let lockOne: JobLock;
let lockTwo: JobLock;
const started: Scheduler[] = [];

function job(): string {
  return `test_${randomUUID().replace(/-/g, '')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls rather than sleeping a fixed amount, so a slow machine is late, not red. */
async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the scheduler');
    await sleep(10);
  }
}

beforeAll(async () => {
  const env = testEnv();
  one = createRedisClient(env, 'sched-a');
  two = createRedisClient(env, 'sched-b');
  await Promise.all([one.ping(), two.ping()]);
  lockOne = new JobLock(one);
  lockTwo = new JobLock(two);
});

afterEach(async () => {
  while (started.length > 0) await started.pop()?.stop();
});

afterAll(async () => {
  await Promise.all([one.quit(), two.quit()]);
});

describe('two processes racing for one interval', () => {
  it('gives it to exactly one of them', async () => {
    const name = job();
    const [a, b] = await Promise.all([lockOne.acquire(name, 5_000), lockTwo.acquire(name, 5_000)]);
    // Whichever won, exactly one token exists — the other caller is told no
    // rather than handed a second lock.
    expect([a, b].filter((token) => token !== null)).toHaveLength(1);
  });

  it('keeps the loser out for as long as the winner holds it', async () => {
    const name = job();
    expect(await lockOne.acquire(name, 5_000)).not.toBeNull();
    expect(await lockTwo.acquire(name, 5_000)).toBeNull();
    expect(await lockTwo.acquire(name, 5_000)).toBeNull();
  });

  it('locks one job without locking the others', async () => {
    const [first, second] = [job(), job()];
    expect(await lockOne.acquire(first, 5_000)).not.toBeNull();
    expect(await lockTwo.acquire(second, 5_000)).not.toBeNull();
  });
});

describe('expiry', () => {
  it('frees the interval on its own, so a killed holder cannot wedge a sweep', async () => {
    // The reason the lock is never handed back on the happy path: this is what
    // ends it, whether the holder finished, crashed or was killed mid-pass.
    const name = job();
    expect(await lockOne.acquire(name, 150)).not.toBeNull();
    expect(await lockTwo.acquire(name, 150)).toBeNull();

    await sleep(300);
    expect(await lockTwo.acquire(name, 150)).not.toBeNull();
  });
});

describe('release', () => {
  it('frees the interval for the owner', async () => {
    const name = job();
    const token = await lockOne.acquire(name, 5_000);
    expect(await lockOne.release(name, token!)).toBe(true);
    expect(await lockTwo.acquire(name, 5_000)).not.toBeNull();
  });

  it('refuses anyone else, and leaves the lock where it was', async () => {
    const name = job();
    await lockOne.acquire(name, 5_000);
    expect(await lockTwo.release(name, randomUUID())).toBe(false);
    expect(await lockTwo.acquire(name, 5_000)).toBeNull();
  });

  it('will not let a stale owner free its successor', async () => {
    // The race the Lua script exists for: the key expires and is retaken between
    // a naive GET and DEL, and the stale holder frees a lock somebody else is
    // mid-pass with.
    const name = job();
    const stale = await lockOne.acquire(name, 150);
    await sleep(300);
    const successor = await lockTwo.acquire(name, 5_000);

    expect(await lockOne.release(name, stale!)).toBe(false);
    expect(await one.get(lockKey(name))).toBe(successor);
  });
});

describe('two schedulers, one Redis', () => {
  it('runs the job once per interval rather than once per instance', async () => {
    const name = job();
    const interval = 500;
    let runs = 0;
    const definition = (): JobDefinition => ({
      name,
      intervalMs: interval,
      run: async () => {
        runs += 1;
      },
    });

    const a = new Scheduler({ enabled: true, redis: one, logger: silentLogger(), jitterPct: 0 });
    const b = new Scheduler({ enabled: true, redis: two, logger: silentLogger(), jitterPct: 0 });
    started.push(a, b);
    a.register(definition());
    b.register(definition());
    a.start();
    b.start();

    // Wait for both to have ticked rather than for a wall-clock deadline: the
    // question is what happened on the interval they shared, not how fast the
    // machine got there.
    await waitFor(() =>
      [a, b].every((instance) => instance.snapshot().jobs[0]?.last_status !== null),
    );

    expect(runs).toBe(1);
    expect([a, b].map((instance) => instance.snapshot().jobs[0]?.last_status).sort()).toEqual([
      'ok',
      'skipped',
    ]);
  });

  it('keeps sweeping after the lock expires, so the fleet does not go quiet', async () => {
    const name = job();
    let runs = 0;
    const a = new Scheduler({ enabled: true, redis: one, logger: silentLogger(), jitterPct: 0 });
    const b = new Scheduler({ enabled: true, redis: two, logger: silentLogger(), jitterPct: 0 });
    started.push(a, b);
    for (const instance of [a, b]) {
      instance.register({
        name,
        intervalMs: 300,
        run: async () => {
          runs += 1;
        },
      });
      instance.start();
    }

    await waitFor(() => runs >= 3);
    // Three intervals' worth of passes across two instances — the lock hands the
    // interval on rather than holding it for whoever won first.
    expect(runs).toBeGreaterThanOrEqual(3);
  });
});
