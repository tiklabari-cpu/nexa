import { describe, expect, it, vi } from 'vitest';
import {
  QUEUE_WAIT_CACHE_SECONDS,
  QUEUE_WAIT_MIN_SAMPLES,
  cachedQueueWaitStats,
  estimateQueueWait,
  queueWaitCacheKey,
  type QueueWaitStats,
} from './queue-wait.js';

const enough: QueueWaitStats = {
  samples: QUEUE_WAIT_MIN_SAMPLES,
  medianSeconds: 120,
  p80Seconds: 300,
  capacity: 2,
};

describe('estimateQueueWait (tm 344 · WG-05)', () => {
  it('scales the median and the 80th percentile by position over capacity, in minutes', () => {
    // 120 s × 3 / 2 = 3 min; 300 s × 3 / 2 = 7.5 → 8 min.
    expect(estimateQueueWait(enough, 3)).toEqual({ min_minutes: 3, max_minutes: 8 });
    // More hands, shorter wait.
    expect(estimateQueueWait({ ...enough, capacity: 6 }, 3)).toEqual({
      min_minutes: 1,
      max_minutes: 3,
    });
  });

  it('says nothing below the sample threshold, without capacity or outside the queue', () => {
    expect(estimateQueueWait({ ...enough, samples: QUEUE_WAIT_MIN_SAMPLES - 1 }, 3)).toBeNull();
    expect(estimateQueueWait({ ...enough, capacity: 0 }, 3)).toBeNull();
    expect(estimateQueueWait(enough, 0)).toBeNull();
  });

  it('never promises less than a minute, and the range never inverts', () => {
    const quick = { ...enough, medianSeconds: 5, p80Seconds: 6 };
    expect(estimateQueueWait(quick, 1)).toEqual({ min_minutes: 1, max_minutes: 1 });
  });
});

describe('cachedQueueWaitStats', () => {
  function fakeRedis() {
    const store = new Map<string, string>();
    return {
      store,
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK' as const;
      }),
    };
  }

  it('reads the database once per team and window, then serves polls from the cache', async () => {
    const redis = fakeRedis();
    const read = vi.fn(async () => enough);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = redis as any;
    expect(await cachedQueueWaitStats(r, 7n, 3n, read)).toEqual(enough);
    expect(await cachedQueueWaitStats(r, 7n, 3n, read)).toEqual(enough);
    expect(read).toHaveBeenCalledTimes(1);
    expect(redis.set).toHaveBeenCalledWith(
      queueWaitCacheKey(7n, 3n),
      JSON.stringify(enough),
      'EX',
      QUEUE_WAIT_CACHE_SECONDS,
    );
    // Another team of the same workspace is its own entry.
    await cachedQueueWaitStats(r, 7n, 4n, read);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('computes anyway when the cache is down', async () => {
    const read = vi.fn(async () => enough);
    const down = {
      get: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
      set: vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(await cachedQueueWaitStats(down as any, 7n, 3n, read)).toEqual(enough);
  });
});
