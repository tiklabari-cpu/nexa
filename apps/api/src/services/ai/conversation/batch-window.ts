/**
 * The batch window (tm 292.4 · SiyahTuş analysis AI-01 §5).
 *
 * A visitor rarely says what they need in one message: "hi", "my deposit",
 * "has not arrived" arrive a second apart, and answering each as it lands
 * gives three replies to one question — the first two to half of it. So a turn
 * does not start the moment its job does: it waits until the visitor's newest
 * message is `windowMs` old, reading again after each pause in case another
 * arrived, and then answers everything unanswered as one turn. The jobs of the
 * messages it gathered find their message answered and do nothing.
 *
 * The wait is bounded at twice the window in all, so a visitor who keeps
 * typing is still answered — a few seconds late rather than never. A window of
 * 0 does not wait at all; what was already waiting is answered together
 * anyway, since gathering is the turn's (`ai-responder.ts`), not the window's.
 *
 * The clock is the database's (`newestVisitorEvent` reports the message's age
 * as Postgres measures it); the pause is this process's, injectable so a unit
 * test does not sleep.
 */
import type { VisitorEventAge } from './context-loader.js';

export interface BatchWindowOptions {
  /** How quiet the visitor must have been, in milliseconds. 0: do not wait. */
  readonly windowMs: number;
  /** The visitor's newest message and its age, read afresh on every call. */
  readonly read: () => Promise<VisitorEventAge | null>;
  /** The pause between reads. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface BatchWindowResult {
  /** The visitor's newest message when the wait ended; null if they wrote none. */
  readonly newest: VisitorEventAge | null;
  /** How long the turn waited, in all. */
  readonly waitedMs: number;
}

/**
 * Wait until the visitor's newest message is `windowMs` old, or until the
 * waiting adds up to twice the window — whichever comes first.
 */
export async function awaitBatchWindow(options: BatchWindowOptions): Promise<BatchWindowResult> {
  const { windowMs, read, sleep = pause } = options;
  const ceiling = windowMs * 2;
  let waitedMs = 0;
  for (;;) {
    const newest = await read();
    if (!newest || windowMs <= 0) return { newest, waitedMs };
    const quietIn = windowMs - newest.ageMs;
    if (quietIn <= 0 || waitedMs >= ceiling) return { newest, waitedMs };
    const wait = Math.ceil(Math.min(quietIn, ceiling - waitedMs));
    await sleep(wait);
    waitedMs += wait;
  }
}

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
