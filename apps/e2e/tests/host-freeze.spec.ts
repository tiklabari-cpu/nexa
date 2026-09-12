/**
 * The `hostFreezeWatch` fixture's own proof (tm 251).
 *
 * The fixture exists for a rare event, a laptop sleeping in the middle of a run,
 * so a real one cannot be waited for. Removing it, or quietly breaking it, would
 * not show until the next hibernation, and that red would again look like a
 * flaky test. So this test causes a freeze on purpose and checks that it gets
 * reported.
 *
 * `Atomics.wait` blocks the worker's thread outright. From the worker's side
 * that is exactly what a hibernation looks like: no timer, no socket and no
 * Playwright call runs until it returns, and the monotonic clock has moved on.
 * It is the same stand-in that reproduced tm 248's two-line failure byte for
 * byte. No page is requested, so no browser context is opened and the test
 * costs the freeze plus a heartbeat.
 *
 * Run logs therefore always carry one `host-freeze` line naming this test. A
 * line naming any *other* test is the real thing.
 */
import { expect, HOST_FREEZE, HOST_FREEZE_THRESHOLD_MS, test } from './fixtures.js';

function freezeThisWorker(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const freezeNotes = () => test.info().annotations.filter((note) => note.type === HOST_FREEZE);

test.describe('host freeze watch', () => {
  test('reports a freeze this test causes on purpose, and nothing without one', async () => {
    // A worker that is merely waiting is not frozen: the heartbeat keeps running.
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    expect(freezeNotes()).toEqual([]);

    freezeThisWorker(HOST_FREEZE_THRESHOLD_MS + 1_500);

    await expect.poll(() => freezeNotes().length).toBe(1);
    const [note] = freezeNotes();
    expect(note!.description).toContain('reports a freeze this test causes on purpose');
    const seconds = Number(
      /did not run for at least ([\d.]+) s/.exec(note!.description ?? '')?.[1],
    );
    expect(seconds).toBeGreaterThanOrEqual(HOST_FREEZE_THRESHOLD_MS / 1000);
  });
});
