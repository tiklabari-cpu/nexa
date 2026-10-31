/**
 * The repeating alert sound (IN-10 · tm 367 · FR-MOD-13.8): when it chimes, when
 * it stops, and that two unread chats are still one metronome.
 *
 * Driven by a fake clock and fake timers so the schedule is asserted to the
 * millisecond rather than "eventually".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { REPEAT_INTERVAL_MS, REPEAT_WINDOW_MS, SoundRepeater } from './soundRepeater.js';

/** A clock whose single scheduled timer fires when time is advanced past it. */
class FakeClock {
  now = 1_000_000;
  #timer: { at: number; fn: () => void } | null = null;
  timersSet = 0;

  setTimer = (fn: () => void, ms: number): unknown => {
    this.timersSet += 1;
    const timer = { at: this.now + ms, fn };
    this.#timer = timer;
    return timer;
  };

  clearTimer = (handle: unknown): void => {
    if (this.#timer === handle) this.#timer = null;
  };

  get armed(): boolean {
    return this.#timer !== null;
  }

  advance(ms: number): void {
    const target = this.now + ms;
    while (this.#timer && this.#timer.at <= target) {
      const timer = this.#timer;
      this.#timer = null;
      this.now = timer.at;
      timer.fn();
    }
    this.now = target;
  }
}

let clock: FakeClock;
let plays: number;
let mayPlay: boolean;
let repeater: SoundRepeater;

beforeEach(() => {
  clock = new FakeClock();
  plays = 0;
  mayPlay = true;
  repeater = new SoundRepeater({
    play: () => void (plays += 1),
    shouldPlay: () => mayPlay,
    now: () => clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
});

describe('SoundRepeater (FR-MOD-13.8)', () => {
  it('chimes again every 10 seconds while a message is unread', () => {
    repeater.start('chat-1');
    expect(plays).toBe(0); // the first chime is the caller's

    clock.advance(REPEAT_INTERVAL_MS - 1);
    expect(plays).toBe(0);
    clock.advance(1);
    expect(plays).toBe(1);
    clock.advance(REPEAT_INTERVAL_MS);
    expect(plays).toBe(2);
    clock.advance(REPEAT_INTERVAL_MS * 3);
    expect(plays).toBe(5);
  });

  it('stops the moment the chat is read', () => {
    repeater.start('chat-1');
    clock.advance(REPEAT_INTERVAL_MS);
    expect(plays).toBe(1);

    repeater.clear('chat-1');
    expect(repeater.pending).toEqual([]);
    expect(clock.armed).toBe(false);
    clock.advance(REPEAT_INTERVAL_MS * 5);
    expect(plays).toBe(1);
  });

  it('gives up after two minutes — the last chime is the one before the window closes', () => {
    const expired: string[][] = [];
    repeater.onExpire = (keys) => expired.push(keys);
    repeater.start('chat-1');

    clock.advance(REPEAT_WINDOW_MS);
    expect(plays).toBe(REPEAT_WINDOW_MS / REPEAT_INTERVAL_MS - 1);
    expect(expired).toEqual([['chat-1']]);
    expect(repeater.pending).toEqual([]);
    expect(clock.armed).toBe(false);

    clock.advance(REPEAT_INTERVAL_MS * 3);
    expect(plays).toBe(REPEAT_WINDOW_MS / REPEAT_INTERVAL_MS - 1);
  });

  it('runs one timer for any number of chats, aligned to the oldest', () => {
    repeater.start('chat-1');
    clock.advance(4_000);
    repeater.start('chat-2');
    clock.advance(4_000);
    repeater.start('chat-3');

    // The marks are chat-1's: 10 s, 20 s… not 14 s or 18 s.
    clock.advance(2_000);
    expect(plays).toBe(1);
    clock.advance(9_999);
    expect(plays).toBe(1);
    clock.advance(1);
    expect(plays).toBe(2);
    // Three unread chats, one chime per mark.
    expect(repeater.pending).toEqual(['chat-1', 'chat-2', 'chat-3']);
  });

  it('re-aims at the next-oldest when the oldest is read, without a second beat', () => {
    repeater.start('chat-1');
    clock.advance(4_000);
    repeater.start('chat-2');

    repeater.clear('chat-1');
    // chat-2 arrived at 4 s: its marks are 14 s, 24 s.
    clock.advance(9_999);
    expect(plays).toBe(0);
    clock.advance(1);
    expect(plays).toBe(1);
  });

  it('does not restart the wait when the same chat gets another message', () => {
    repeater.start('chat-1');
    clock.advance(7_000);
    repeater.start('chat-1');
    clock.advance(3_000);
    expect(plays).toBe(1);
  });

  it('stays silent while it may not play, and resumes on the same marks', () => {
    repeater.start('chat-1');
    mayPlay = false;
    clock.advance(REPEAT_INTERVAL_MS * 2);
    expect(plays).toBe(0);
    expect(repeater.pending).toEqual(['chat-1']);

    mayPlay = true;
    clock.advance(REPEAT_INTERVAL_MS);
    expect(plays).toBe(1);
  });

  it('forgets everything on clearAll', () => {
    repeater.start('chat-1');
    repeater.start('chat-2');
    repeater.clearAll();
    expect(repeater.pending).toEqual([]);
    expect(clock.armed).toBe(false);
  });

  it('ignores clearing a chat that was never pending', () => {
    repeater.start('chat-1');
    const before = clock.timersSet;
    repeater.clear('chat-9');
    expect(clock.timersSet).toBe(before);
    expect(repeater.pending).toEqual(['chat-1']);
  });
});
