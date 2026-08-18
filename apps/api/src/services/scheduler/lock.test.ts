/**
 * The job lock's own arithmetic and its owner check.
 *
 * The interesting property — that two processes racing for the same interval
 * cannot both win — is proved against a real Redis in
 * `test/integration/scheduler-lock.test.ts`, because `SET NX PX` being atomic is
 * Redis's claim, not this file's. What is asserted here is what this code
 * decides: how long a lock lives, and that releasing it is not something a
 * stale owner can do to its successor.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeRedis } from '../../../test/helpers/scheduler.js';
import { JobLock, LOCK_KEY_PREFIX, MIN_LOCK_TTL_MS, lockKey, lockTtlMs } from './lock.js';

describe('lock keys and lifetimes', () => {
  it('namespaces every job under one prefix', () => {
    expect(lockKey('chat_timeout')).toBe(`${LOCK_KEY_PREFIX}chat_timeout`);
  });

  it('holds a lock for 90% of the interval', () => {
    // Not the whole interval: a marker that survived it could starve a job
    // outright, since every instance's tick drifts by a little jitter.
    expect(lockTtlMs(60_000)).toBe(54_000);
    expect(lockTtlMs(3_600_000)).toBe(3_240_000);
  });

  it('never returns a lifetime shorter than a Redis round trip', () => {
    // Only reachable from the very short intervals a test sets. Below this the
    // lock would expire inside the round trip that took it.
    expect(lockTtlMs(10)).toBe(MIN_LOCK_TTL_MS);
    expect(lockTtlMs(1)).toBe(MIN_LOCK_TTL_MS);
  });

  it('returns whole milliseconds', () => {
    expect(Number.isInteger(lockTtlMs(333))).toBe(true);
  });
});

describe('JobLock', () => {
  let redis: FakeRedis;
  let lock: JobLock;

  beforeEach(() => {
    vi.useFakeTimers();
    redis = new FakeRedis();
    lock = new JobLock(redis);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('hands out a token to the first caller and nothing to the second', async () => {
    expect(await lock.acquire('sla', 1_000)).not.toBeNull();
    expect(await lock.acquire('sla', 1_000)).toBeNull();
  });

  it('mints a different token every time', async () => {
    const first = await lock.acquire('sla', 1_000);
    await lock.release('sla', first!);
    const second = await lock.acquire('sla', 1_000);
    expect(second).not.toBe(first);
  });

  it('locks one job without locking another', async () => {
    await lock.acquire('sla', 1_000);
    expect(await lock.acquire('siem', 1_000)).not.toBeNull();
  });

  it('frees the interval when the owner hands it back', async () => {
    const token = await lock.acquire('sla', 1_000);
    expect(await lock.release('sla', token!)).toBe(true);
    expect(await lock.acquire('sla', 1_000)).not.toBeNull();
  });

  it('refuses a release from anyone but the owner', async () => {
    const token = await lock.acquire('sla', 1_000);
    expect(await lock.release('sla', 'some-other-token')).toBe(false);
    // Still held, which is the point: a wrong token must not free the interval.
    expect(await lock.acquire('sla', 1_000)).toBeNull();
    expect(await lock.release('sla', token!)).toBe(true);
  });

  it('expires on its own so a killed holder cannot wedge the job', async () => {
    await lock.acquire('sla', 1_000);
    vi.advanceTimersByTime(999);
    expect(await lock.acquire('sla', 1_000)).toBeNull();
    vi.advanceTimersByTime(1);
    expect(await lock.acquire('sla', 1_000)).not.toBeNull();
  });

  it('will not let a stale owner delete its successor’s lock', async () => {
    // The whole reason the release is a Lua script rather than GET then DEL: the
    // key can expire and be retaken between the two commands, and the stale
    // holder would then free a lock somebody else is mid-pass with.
    const stale = await lock.acquire('sla', 1_000);
    vi.advanceTimersByTime(1_001);
    const successor = await lock.acquire('sla', 1_000);

    expect(await lock.release('sla', stale!)).toBe(false);
    expect(redis.holder(lockKey('sla'))).toBe(successor);
  });

  it('propagates a Redis failure rather than pretending it won the lock', async () => {
    // The scheduler turns this into "do not run" — a sweep that runs on every
    // instance because the lock was unreachable is the failure being avoided.
    redis.failWith = new Error('connection refused');
    await expect(lock.acquire('sla', 1_000)).rejects.toThrow('connection refused');
  });
});
