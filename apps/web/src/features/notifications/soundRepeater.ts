/**
 * The sound that does not stop until the message is read (IN-10 · tm 367).
 *
 * A short chime is easy to miss when the agent is in the operator's back office
 * looking up a player's account, and a missed chime is a player left waiting.
 * With "repeat" on, a visitor's message starts a pending entry; the repeater
 * plays again every {@link REPEAT_INTERVAL_MS} until the entry is read.
 *
 * **One timer, however many chats.** Entries are keyed by chat and the single
 * timer is aligned to the *oldest* unread one: ticks fall on its 10-second
 * marks, so a second message arriving at 4 s does not start a second metronome
 * and the agent hears one steady beat, not two interleaved ones. A tick plays at
 * most once however many chats are waiting.
 *
 * **It ends.** An entry stops being pending when the agent reads it ({@link
 * SoundRepeater.clear}, from opening the chat, `useMarkSeen`, or another tab),
 * or when {@link REPEAT_WINDOW_MS} has passed since it arrived — a chat the
 * agent has deliberately left alone for two minutes is not going to be answered
 * by a louder chime. Sound off, the master switch and the repeat preference are
 * the caller's to apply before {@link SoundRepeater.start}.
 *
 * **It does not nag a person who is looking.** A tick plays only when
 * `shouldPlay()` says so (the leader tab, nobody focused); it still advances, so
 * the beat resumes on the same marks when the agent looks away again.
 *
 * Plain functions in, no browser globals: the clock and timers are injected so
 * the schedule is testable to the millisecond.
 */

/** Between one chime and the next. */
export const REPEAT_INTERVAL_MS = 10_000;
/** After this long unread, an entry is given up on. */
export const REPEAT_WINDOW_MS = 120_000;

export interface SoundRepeaterDeps {
  play: () => void;
  /** May a tick make a sound right now? (leader tab, nobody looking) */
  shouldPlay: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export class SoundRepeater {
  readonly #deps: Required<SoundRepeaterDeps>;
  readonly #pending = new Map<string, number>();
  #timer: unknown = null;
  /** Called with the entry keys that stopped on their own (the window ran out). */
  onExpire: ((keys: string[]) => void) | null = null;

  constructor(deps: SoundRepeaterDeps) {
    this.#deps = {
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as never),
      ...deps,
    };
  }

  /** The keys still waiting to be read, oldest first. */
  get pending(): string[] {
    return [...this.#pending.entries()].sort((a, b) => a[1] - b[1]).map(([key]) => key);
  }

  /**
   * A message arrived for `key`. The first sound is the caller's (it already
   * played it); this schedules the ones after. A second message on a chat that
   * is already pending does not move its start — the wait is measured from the
   * first unread message.
   */
  start(key: string): void {
    if (!this.#pending.has(key)) this.#pending.set(key, this.#deps.now());
    this.#schedule();
  }

  /** `key` was read (or is no longer worth chiming for). */
  clear(key: string): void {
    if (!this.#pending.delete(key)) return;
    this.#schedule();
  }

  clearAll(): void {
    this.#pending.clear();
    this.#schedule();
  }

  /** Re-aim the one timer at the next mark of the oldest pending entry, or stop it. */
  #schedule(): void {
    if (this.#timer !== null) this.#deps.clearTimer(this.#timer);
    this.#timer = null;
    const oldest = this.#oldest();
    if (oldest === null) return;
    const elapsed = this.#deps.now() - oldest;
    const next = (Math.floor(elapsed / REPEAT_INTERVAL_MS) + 1) * REPEAT_INTERVAL_MS - elapsed;
    this.#timer = this.#deps.setTimer(() => this.#tick(), next);
  }

  #oldest(): number | null {
    let oldest: number | null = null;
    for (const at of this.#pending.values()) if (oldest === null || at < oldest) oldest = at;
    return oldest;
  }

  #tick(): void {
    this.#timer = null;
    const now = this.#deps.now();
    const expired: string[] = [];
    for (const [key, at] of this.#pending) {
      if (now - at >= REPEAT_WINDOW_MS) {
        this.#pending.delete(key);
        expired.push(key);
      }
    }
    // The window closing is not a reason to chime — the last chime was the one
    // before it.
    if (this.#pending.size > 0 && this.#deps.shouldPlay()) this.#deps.play();
    if (expired.length > 0) this.onExpire?.(expired);
    this.#schedule();
  }
}
