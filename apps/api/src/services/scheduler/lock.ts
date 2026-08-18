/**
 * The per-job leader lock (M-SCHED-a).
 *
 * The scheduler runs inside the API process, so a deployment with three API
 * instances has three schedulers. Without a shared guard each interval would
 * sweep three times: three retention passes deleting the same rows, three
 * scheduled-report mails to the same inbox. This is that guard.
 *
 *   SET nexa:sched:<job> <owner token> PX <ttl> NX
 *
 * One round trip, and atomic by construction — `EXISTS` followed by `SET` would
 * let two instances both read "free" before either wrote.
 *
 * **The lock is not handed back when the pass finishes.** That reads like an
 * omission and is the central decision here: the key doubles as the marker for
 * "this interval is already taken". Releasing it on completion would leave the
 * rest of the interval unguarded, and a second instance ticking 200 ms later
 * would take it and sweep the very same rows — the double run the lock exists to
 * prevent. It expires on its own instead, which is also what unwedges a job
 * whose holder was killed mid-pass: the next tick after expiry simply takes it.
 *
 * The TTL is {@link LOCK_TTL_FRACTION} of the interval rather than the whole of
 * it, because a marker that survived the full interval could starve a job
 * outright — every instance's tick drifts by a few milliseconds of jitter, and
 * one that always landed a hair early would always find the key still there.
 * Ten percent of slack is the price: a job may occasionally run twice in one
 * interval, which every sweep here already tolerates (they are all idempotent),
 * where never running at all is not tolerable.
 *
 * The one caveat worth knowing: a pass that outlives its own TTL is no longer
 * protected, so a job whose work can exceed 90% of its interval must be safe to
 * overlap with itself. Extending the lock from a heartbeat while a pass runs
 * would close that, and is deliberately not here — none of the five sweeps comes
 * close to its window.
 *
 * {@link JobLock.release} is still owner-checked, because the one path that does
 * hand a lock back (the scheduler stopping between acquiring and running) must
 * not be able to delete a lock that expired and was retaken by somebody else in
 * the meantime.
 */
import { randomUUID } from 'node:crypto';

/**
 * KEYS[1] lock key · ARGV[1] owner token.
 *
 * Lua because the check and the delete have to be one step: with `GET` then
 * `DEL` the key can expire and be taken by another instance in between, and the
 * `DEL` would then remove *their* lock while they were mid-pass.
 */
const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Namespaced like `rl:` (rate limits) so `KEYS nexa:sched:*` shows the fleet's state. */
export const LOCK_KEY_PREFIX = 'nexa:sched:';

/** Share of the interval a lock survives. See the header for why it is not 1. */
export const LOCK_TTL_FRACTION = 0.9;

/**
 * Floor for the TTL. Only reachable from the very short intervals a test sets;
 * below a few tens of milliseconds the lock would expire inside the Redis round
 * trip that took it, which is the same as having no lock.
 */
export const MIN_LOCK_TTL_MS = 50;

export function lockKey(job: string): string {
  return `${LOCK_KEY_PREFIX}${job}`;
}

export function lockTtlMs(intervalMs: number): number {
  return Math.max(MIN_LOCK_TTL_MS, Math.floor(intervalMs * LOCK_TTL_FRACTION));
}

/**
 * The slice of ioredis this needs. Structural rather than the concrete client so
 * a unit test can drive the lock's own logic without a Redis to talk to; the
 * integration suite runs the same code against the real one.
 */
export interface LockRedis {
  set(
    key: string,
    value: string,
    millisecondsToken: 'PX',
    milliseconds: number,
    nx: 'NX',
  ): Promise<'OK' | null>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export class JobLock {
  constructor(private readonly redis: LockRedis) {}

  /**
   * Take this job's interval, or return null because somebody else has it.
   *
   * The token is what makes the lock releasable by its owner alone — an
   * instance that stalled past its TTL must not be able to delete the lock its
   * successor is holding.
   */
  async acquire(job: string, ttlMs: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.redis.set(lockKey(job), token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  /** Hand the interval back. Returns false when the caller no longer owns it. */
  async release(job: string, token: string): Promise<boolean> {
    // Plain EVAL rather than the SCRIPT LOAD / EVALSHA dance the rate limiter
    // does: that one runs on every request, this one runs when a process is
    // shutting down.
    const deleted = await this.redis.eval(RELEASE_LUA, 1, lockKey(job), token);
    return deleted === 1;
  }
}
