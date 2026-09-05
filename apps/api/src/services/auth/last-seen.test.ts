import { describe, expect, it, vi } from 'vitest';
import { LAST_SEEN_COARSEN_WINDOW_MS, LastSeenRecorder } from './last-seen.js';

describe('LastSeenRecorder — coarsening the last-seen stamp (FR-MOD-04.3.4)', () => {
  it('writes the first time it sees an account', async () => {
    const write = vi.fn(async () => undefined);
    const recorder = new LastSeenRecorder();

    await expect(recorder.record('a-1', write, 1_000)).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('two requests in the same second produce exactly one write', async () => {
    const write = vi.fn(async () => undefined);
    const recorder = new LastSeenRecorder();

    const first = await recorder.record('a-1', write, 1_000);
    const second = await recorder.record('a-1', write, 1_400);

    expect([first, second]).toEqual([true, false]);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('a burst of concurrent requests from one account still produces one write', async () => {
    // The mark has to be taken before the await, or every request in flight
    // reads the same empty map and they all write.
    const write = vi.fn(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    const recorder = new LastSeenRecorder();

    const results = await Promise.all([
      recorder.record('a-1', write, 1_000),
      recorder.record('a-1', write, 1_000),
      recorder.record('a-1', write, 1_000),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('writes again once the window has passed', async () => {
    const write = vi.fn(async () => undefined);
    const recorder = new LastSeenRecorder();

    await recorder.record('a-1', write, 1_000);
    await expect(recorder.record('a-1', write, 1_000 + LAST_SEEN_COARSEN_WINDOW_MS)).resolves.toBe(
      true,
    );
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('throttles per account, not globally', async () => {
    const write = vi.fn(async () => undefined);
    const recorder = new LastSeenRecorder();

    await recorder.record('a-1', write, 1_000);
    await expect(recorder.record('a-2', write, 1_000)).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('hands the write the stamp and the staleness cut-off a window apart', async () => {
    const seen: Array<[Date, Date]> = [];
    const recorder = new LastSeenRecorder(60_000);

    await recorder.record(
      'a-1',
      async (at, staleBefore) => {
        seen.push([at, staleBefore]);
      },
      1_000_000,
    );

    const [at, staleBefore] = seen[0]!;
    expect(at.getTime()).toBe(1_000_000);
    expect(at.getTime() - staleBefore.getTime()).toBe(60_000);
  });

  it('does not suppress the next attempt when a write fails', async () => {
    // A transient database failure must not buy the account a whole quiet
    // window — the stamp would then be a minute wrong for no reason.
    const write = vi
      .fn<(at: Date, staleBefore: Date) => Promise<void>>()
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce(undefined);
    const recorder = new LastSeenRecorder();

    await expect(recorder.record('a-1', write, 1_000)).rejects.toThrow('connection lost');
    await expect(recorder.record('a-1', write, 1_001)).resolves.toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
  });
});
