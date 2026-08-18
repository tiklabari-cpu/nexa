/**
 * The scheduler core (M-SCHED-a).
 *
 * Fake timers throughout: the properties under test are "after one interval" and
 * "three failures in a row", and waiting out real minutes to see them would make
 * the suite both slow and flaky. The one thing fake timers cannot answer — that
 * two *processes* cannot both win an interval — is the integration suite's
 * (`test/integration/scheduler-lock.test.ts`); what is proved here is that two
 * schedulers sharing one lock store behave that way, which is the same code path
 * with a different Redis behind it.
 *
 * Every test stops its scheduler. The timers are deliberately not `unref()`ed
 * (see the module header), so one that is left running holds the suite open.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeRedis,
  recordingLogger,
  type RecordingLogger,
} from '../../../test/helpers/scheduler.js';
import { lockKey } from './lock.js';
import { ERROR_ESCALATION_THRESHOLD, Scheduler, errorClassOf, nextDelayMs } from './scheduler.js';
import type { JobDefinition } from './types.js';

const INTERVAL = 1_000;

let redis: FakeRedis;
let log: RecordingLogger;
/** Every scheduler a test built, stopped in `afterEach` whatever the test did. */
let built: Scheduler[];

function scheduler(options: { enabled?: boolean; jitterPct?: number } = {}): Scheduler {
  const instance = new Scheduler({
    enabled: options.enabled ?? true,
    redis,
    logger: log.logger,
    // Off by default so a delay is exactly the interval and an assertion can be
    // an equality rather than a range. Jitter has its own tests below.
    jitterPct: options.jitterPct ?? 0,
  });
  built.push(instance);
  return instance;
}

/** A job that counts its passes. */
function counting(
  name: string,
  run?: JobDefinition['run'],
): { job: JobDefinition; runs: () => number } {
  let runs = 0;
  return {
    job: {
      name,
      intervalMs: INTERVAL,
      run: async (context) => {
        runs += 1;
        return run ? await run(context) : undefined;
      },
    },
    runs: () => runs,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  redis = new FakeRedis();
  log = recordingLogger();
  built = [];
});

afterEach(async () => {
  for (const instance of built) await instance.stop();
  vi.useRealTimers();
});

// ===========================================================================
// Delay arithmetic
// ===========================================================================

describe('nextDelayMs', () => {
  it('is exactly the interval when jitter is off', () => {
    expect(nextDelayMs(60_000, 0, () => 0.5, true)).toBe(60_000);
    expect(nextDelayMs(60_000, 0, () => 0.5, false)).toBe(60_000);
  });

  it('spreads a steady delay across ±jitterPct and no further', () => {
    expect(nextDelayMs(60_000, 10, () => 0, false)).toBe(54_000);
    expect(nextDelayMs(60_000, 10, () => 1, false)).toBe(66_000);
    expect(nextDelayMs(60_000, 10, () => 0.5, false)).toBe(60_000);
  });

  it('puts the first pass at a random phase inside the interval', () => {
    // Not a jittered whole interval: instances from one deploy would otherwise
    // all tick together on the first pass, which is when the herd is largest.
    expect(nextDelayMs(60_000, 10, () => 0.25, true)).toBe(15_000);
    expect(nextDelayMs(60_000, 10, () => 1, true)).toBe(60_000);
  });

  it('never schedules a zero delay', () => {
    // A delay of 0 would re-run the job in the same tick of the event loop for
    // the rest of the process's life.
    expect(nextDelayMs(60_000, 10, () => 0, true)).toBe(1);
    expect(nextDelayMs(1, 10, () => 0, true)).toBe(1);
  });

  it('stays within the declared bounds for any sample', () => {
    for (let i = 0; i <= 100; i += 1) {
      const delay = nextDelayMs(60_000, 10, () => i / 100, false);
      expect(delay).toBeGreaterThanOrEqual(54_000);
      expect(delay).toBeLessThanOrEqual(66_000);
    }
  });
});

describe('errorClassOf', () => {
  it('reports the class, not the inherited name', () => {
    class SweepFailed extends Error {}
    // `error.name` here is still 'Error', which tells an operator nothing.
    expect(errorClassOf(new SweepFailed('boom'))).toBe('SweepFailed');
    expect(errorClassOf(new TypeError('boom'))).toBe('TypeError');
  });

  it('says something useful about a thrown non-error', () => {
    expect(errorClassOf('boom')).toBe('string');
  });
});

// ===========================================================================
// Registration
// ===========================================================================

describe('register', () => {
  it('refuses two jobs with the same name', () => {
    const instance = scheduler();
    instance.register(counting('sla').job);
    expect(() => instance.register(counting('sla').job)).toThrow(/duplicate scheduler job/);
  });

  it('refuses an interval that is not a positive whole number', () => {
    const instance = scheduler();
    for (const intervalMs of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        instance.register({ name: `j${intervalMs}`, intervalMs, run: async () => {} }),
      ).toThrow(/positive whole-millisecond interval/);
    }
  });

  it('refuses to register into a running scheduler', () => {
    // Otherwise the first pass's timing depends on when the registration landed.
    const instance = scheduler();
    instance.start();
    expect(() => instance.register(counting('sla').job)).toThrow(/already started/);
  });
});

// ===========================================================================
// Running
// ===========================================================================

describe('running jobs', () => {
  it('runs a job one interval after start, and again each interval after', async () => {
    const instance = scheduler();
    const sla = counting('sla');
    instance.register(sla.job);
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(sla.runs()).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(sla.runs()).toBe(1);

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(sla.runs()).toBe(4);
  });

  it('does not stack passes when one runs longer than its interval', async () => {
    // The next delay is measured from the end of a pass, not from its start —
    // a `setInterval` would have three passes of a slow sweep in flight at once.
    let running = 0;
    let starts = 0;
    let overlaps = 0;
    const instance = scheduler();
    instance.register({
      name: 'slow',
      intervalMs: INTERVAL,
      run: async () => {
        starts += 1;
        running += 1;
        if (running > 1) overlaps += 1;
        await new Promise<void>((resolve) => setTimeout(resolve, INTERVAL * 2));
        running -= 1;
      },
    });
    instance.start();

    // Stops on a beat where nothing is mid-pass: `stop()` waits for whatever is
    // in flight, and under a frozen clock a suspended pass would wait forever.
    await vi.advanceTimersByTimeAsync(INTERVAL * 9.5);
    await instance.stop();

    expect(overlaps).toBe(0);
    // Interval plus duration is three intervals between starts, so nine and a
    // half of them fit three passes — not the nine a `setInterval` would fire.
    expect(starts).toBe(3);
  });

  it('runs nothing at all when the scheduler is switched off', async () => {
    const instance = scheduler({ enabled: false });
    const sla = counting('sla');
    instance.register(sla.job);
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(sla.runs()).toBe(0);
    expect(instance.snapshot().enabled).toBe(false);
    // Said out loud, because "the sweeps did not run" otherwise looks exactly
    // like "the sweeps found nothing" — which is how §D113/K1 went unnoticed.
    expect(log.at('info').map((line) => line.message)).toContainEqual(
      expect.stringContaining('scheduler disabled'),
    );
  });

  it('registers a disabled job without ever running it', async () => {
    const instance = scheduler();
    const retention = counting('retention');
    instance.register({ ...retention.job, enabled: false });
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(retention.runs()).toBe(0);

    const [row] = instance.snapshot().jobs;
    // Visible rather than absent: a job nobody registered and a job somebody
    // switched off look the same from outside, and only one of them is fine.
    expect(row).toMatchObject({ name: 'retention', enabled: false, last_status: 'disabled' });
    expect(row?.last_run_at).toBeNull();
  });

  it('stops scheduling once stopped', async () => {
    const instance = scheduler();
    const sla = counting('sla');
    instance.register(sla.job);
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(sla.runs()).toBe(1);

    await instance.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(sla.runs()).toBe(1);
  });

  it('waits for a pass that is already running before it finishes stopping', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const instance = scheduler();
    instance.register({ name: 'slow', intervalMs: INTERVAL, run: () => gate });
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL);

    let stopped = false;
    const stopping = instance.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(stopped).toBe(false);

    release();
    await stopping;
    expect(stopped).toBe(true);
  });

  it('hands the job a signal that is aborted when the scheduler stops', async () => {
    let seen: AbortSignal | null = null;
    const instance = scheduler();
    instance.register({
      name: 'sla',
      intervalMs: INTERVAL,
      run: async (context) => {
        seen = context.signal;
      },
    });
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(seen!.aborted).toBe(false);

    await instance.stop();
    expect(seen!.aborted).toBe(true);
  });
});

// ===========================================================================
// Error isolation
// ===========================================================================

describe('a job that fails', () => {
  it('does not stop the jobs beside it', async () => {
    const instance = scheduler();
    const healthy = counting('siem');
    instance.register({
      name: 'sla',
      intervalMs: INTERVAL,
      run: async () => {
        throw new TypeError('sweep exploded');
      },
    });
    instance.register(healthy.job);
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(healthy.runs()).toBe(3);

    const rows = instance.snapshot().jobs;
    expect(rows[0]).toMatchObject({
      name: 'sla',
      last_status: 'error',
      last_error_class: 'TypeError',
    });
    expect(rows[1]).toMatchObject({ name: 'siem', last_status: 'ok' });
    expect(rows[1]).not.toHaveProperty('last_error_class');
  });

  it('keeps trying on the next interval', async () => {
    let attempts = 0;
    const instance = scheduler();
    instance.register({
      name: 'sla',
      intervalMs: INTERVAL,
      run: async () => {
        attempts += 1;
        throw new Error('nope');
      },
    });
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(attempts).toBe(3);
  });

  it('gets louder once it has failed three times in a row', async () => {
    const instance = scheduler();
    instance.register({
      name: 'sla',
      intervalMs: INTERVAL,
      run: async () => {
        throw new Error('nope');
      },
    });
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL * (ERROR_ESCALATION_THRESHOLD - 1));
    expect(log.at('warn')).toHaveLength(ERROR_ESCALATION_THRESHOLD - 1);
    expect(log.at('error')).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(log.at('error')).toHaveLength(1);
    expect(log.at('error')[0]?.payload).toMatchObject({
      job: 'sla',
      outcome: 'error',
      error_class: 'Error',
      consecutive_errors: ERROR_ESCALATION_THRESHOLD,
    });
  });

  it('goes quiet again after a pass succeeds', async () => {
    let attempts = 0;
    const instance = scheduler();
    instance.register({
      name: 'sla',
      intervalMs: INTERVAL,
      run: async () => {
        attempts += 1;
        if (attempts !== 3) throw new Error('nope');
      },
    });
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    // Failures 1, 2 then a success resets the streak, so 4 and 5 are warnings
    // again rather than the escalation the raw count would have reached.
    expect(log.at('error')).toHaveLength(0);
    expect(instance.snapshot().jobs[0]?.last_status).toBe('error');
  });

  it('never lets a failure reach the process', async () => {
    // An unhandled rejection out of a timer callback exits Node — a sweep with a
    // bad minute must not take the API with it.
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const instance = scheduler();
      instance.register({
        name: 'sla',
        intervalMs: INTERVAL,
        run: () => Promise.reject(new Error('nope')),
      });
      instance.start();
      await vi.advanceTimersByTimeAsync(INTERVAL * 2);
      await Promise.resolve();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

// ===========================================================================
// The lock
// ===========================================================================

describe('the job lock', () => {
  it('lets only one of two schedulers run an interval', async () => {
    const a = scheduler();
    const b = scheduler();
    let runs = 0;
    const job = (): JobDefinition => ({
      name: 'sla',
      intervalMs: INTERVAL,
      run: async () => {
        runs += 1;
      },
    });
    a.register(job());
    b.register(job());
    a.start();
    b.start();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(runs).toBe(1);

    // And the loser is not simply broken — it says why.
    const statuses = [a, b].map((s) => s.snapshot().jobs[0]?.last_status).sort();
    expect(statuses).toEqual(['ok', 'skipped']);
  });

  it('lets the interval come round again once the lock expires', async () => {
    const a = scheduler();
    const b = scheduler();
    let runs = 0;
    for (const instance of [a, b]) {
      instance.register({
        name: 'sla',
        intervalMs: INTERVAL,
        run: async () => {
          runs += 1;
        },
      });
      instance.start();
    }

    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    // The lock lives 90% of an interval, so each interval is taken exactly once
    // — not once per scheduler, and not never.
    expect(runs).toBe(3);
  });

  it('does not run the job when the lock store cannot be reached', async () => {
    // Deliberate: a retention pass that deletes on every instance because the
    // lock was unreachable is worse than one that happens a minute late.
    const instance = scheduler();
    const sla = counting('sla');
    instance.register(sla.job);
    instance.start();

    redis.failWith = new Error('connection refused');
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(sla.runs()).toBe(0);
    expect(instance.snapshot().jobs[0]).toMatchObject({
      last_status: 'error',
      last_error_class: 'Error',
    });

    redis.failWith = null;
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(sla.runs()).toBe(1);
  });

  it('hands the interval back when it stops between taking the lock and running', async () => {
    // Otherwise a rolling restart parks an interval nobody used, and for the
    // next ninety seconds no instance in the fleet sweeps.
    let openGate!: () => void;
    redis.gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });

    const sla = counting('sla');
    const instance = scheduler();
    instance.register(sla.job);
    instance.start();

    // The pass has fired and is suspended inside the lock acquisition.
    await vi.advanceTimersByTimeAsync(INTERVAL);
    const stopping = instance.stop();
    openGate();
    redis.gate = null;
    await stopping;

    expect(sla.runs()).toBe(0);
    expect(redis.holder(lockKey('sla'))).toBeNull();
  });
});

// ===========================================================================
// What /health reads
// ===========================================================================

describe('snapshot', () => {
  it('reports each job in registration order with its interval', () => {
    const instance = scheduler();
    instance.register({ name: 'chat_timeout', intervalMs: 60_000, run: async () => {} });
    instance.register({ name: 'retention', intervalMs: 3_600_000, run: async () => {} });

    expect(instance.snapshot()).toEqual({
      enabled: true,
      jobs: [
        {
          name: 'chat_timeout',
          interval_ms: 60_000,
          enabled: true,
          last_run_at: null,
          last_status: null,
        },
        {
          name: 'retention',
          interval_ms: 3_600_000,
          enabled: true,
          last_run_at: null,
          last_status: null,
        },
      ],
    });
  });

  it('timestamps the last tick whatever came of it', async () => {
    vi.setSystemTime(new Date('2026-08-18T00:00:00.000Z'));
    const instance = scheduler();
    instance.register(counting('sla').job);
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(instance.snapshot().jobs[0]?.last_run_at).toBe('2026-08-18T00:00:01.000Z');
  });

  it('carries the error class but never the message', async () => {
    const instance = scheduler();
    instance.register({
      name: 'sla',
      intervalMs: INTERVAL,
      run: async () => {
        throw new RangeError('postgres://user:hunter2@db/nexa is unreachable');
      },
    });
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    const row = instance.snapshot().jobs[0];
    expect(row?.last_error_class).toBe('RangeError');
    expect(JSON.stringify(row)).not.toContain('hunter2');
  });
});

// ===========================================================================
// The log line
// ===========================================================================

describe('the log line a pass writes', () => {
  it('carries the outcome, the duration and whatever the job counted', async () => {
    const instance = scheduler();
    instance.register({
      name: 'chat_timeout',
      intervalMs: INTERVAL,
      run: async () => ({ counts: { closed: 3, tenants: 12 } }),
    });
    instance.start();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    const line = log.at('info').find((entry) => entry.payload['job'] === 'chat_timeout');
    expect(line?.payload).toMatchObject({
      job: 'chat_timeout',
      outcome: 'ok',
      duration_ms: expect.any(Number),
      closed: 3,
      tenants: 12,
    });
  });

  it('keeps a skipped pass at debug', async () => {
    // Every instance but one logs this every interval; at info it would be the
    // loudest line in the deployment and say nothing.
    const a = scheduler();
    const b = scheduler();
    for (const instance of [a, b]) {
      instance.register(counting('sla').job);
      instance.start();
    }

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(log.at('debug').map((line) => line.payload['outcome'])).toContain('skipped');
  });
});
