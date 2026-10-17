/**
 * The batch window (tm 292.4 · AI-01 §5): a turn waits until the visitor's
 * newest message is a window old, reading again after each pause, and never
 * waits more than twice the window in all. The clock here is a script of
 * reads and a pause that records instead of sleeping.
 */
import { describe, expect, it } from 'vitest';
import type { VisitorEventAge } from './context-loader.js';
import { awaitBatchWindow } from './batch-window.js';

/**
 * A visitor seen through `reads`: each read returns the next entry (the last
 * one again once they run out); the pauses are recorded, not slept.
 */
function script(reads: Array<VisitorEventAge | null>) {
  const pauses: number[] = [];
  let at = 0;
  return {
    pauses,
    reads: () => at,
    read: async () => reads[Math.min(at++, reads.length - 1)] ?? null,
    sleep: async (ms: number) => {
      pauses.push(ms);
    },
  };
}

describe('the batch window (AI-01 §5)', () => {
  it('does not wait with a window of 0', async () => {
    const visitor = script([{ sequence: 4, ageMs: 10 }]);
    const result = await awaitBatchWindow({ windowMs: 0, ...visitor });
    expect(result).toEqual({ newest: { sequence: 4, ageMs: 10 }, waitedMs: 0 });
    expect(visitor.pauses).toEqual([]);
  });

  it('does not wait once the newest message is a window old, nor for a visitor who wrote nothing', async () => {
    const quiet = script([{ sequence: 4, ageMs: 3_000 }]);
    expect(await awaitBatchWindow({ windowMs: 3_000, ...quiet })).toEqual({
      newest: { sequence: 4, ageMs: 3_000 },
      waitedMs: 0,
    });
    const silent = script([null]);
    expect(await awaitBatchWindow({ windowMs: 3_000, ...silent })).toEqual({
      newest: null,
      waitedMs: 0,
    });
    expect([...quiet.pauses, ...silent.pauses]).toEqual([]);
  });

  it('waits out the rest of the window, and again for each message written meanwhile', async () => {
    const visitor = script([
      { sequence: 4, ageMs: 200 },
      // A second message arrived during the pause, 800 ms ago…
      { sequence: 5, ageMs: 800 },
      // …and nothing since.
      { sequence: 5, ageMs: 3_000 },
    ]);
    const result = await awaitBatchWindow({ windowMs: 3_000, ...visitor });
    expect(visitor.pauses).toEqual([2_800, 2_200]);
    expect(result).toEqual({ newest: { sequence: 5, ageMs: 3_000 }, waitedMs: 5_000 });
    expect(visitor.reads()).toBe(3);
  });

  it('stops at twice the window for a visitor who keeps typing', async () => {
    // Every read finds a message written a moment ago.
    const typing = script([
      { sequence: 4, ageMs: 100 },
      { sequence: 5, ageMs: 100 },
      { sequence: 6, ageMs: 100 },
      { sequence: 7, ageMs: 100 },
    ]);
    const result = await awaitBatchWindow({ windowMs: 3_000, ...typing });
    expect(typing.pauses).toEqual([2_900, 2_900, 200]);
    expect(result.waitedMs).toBe(6_000);
    // The read after the last pause is the one the turn answers.
    expect(result.newest).toEqual({ sequence: 7, ageMs: 100 });
  });
});
