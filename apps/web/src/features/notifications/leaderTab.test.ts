/**
 * One tab plays the sound (IN-10 · tm 367 · FR-MOD-13.8): "two tabs, one chime".
 *
 * The channel is a pair of in-memory fakes that deliver synchronously to every
 * *other* endpoint, which is how `BroadcastChannel` behaves — so the election,
 * the focus rule and the "read in one tab, stops in all" rule are exercised
 * against the real protocol rather than a stubbed answer.
 */
import { describe, expect, it } from 'vitest';
import { BEAT_MS, STALE_MS, TabLeader, type ChannelLike } from './leaderTab.js';

class Bus {
  readonly ends: FakeChannel[] = [];
  endpoint(): FakeChannel {
    const end = new FakeChannel(this);
    this.ends.push(end);
    return end;
  }
}

class FakeChannel implements ChannelLike {
  readonly #listeners = new Set<(event: { data: unknown }) => void>();
  closed = false;
  constructor(private readonly bus: Bus) {}
  postMessage(message: unknown): void {
    for (const end of this.bus.ends) {
      if (end === this) continue;
      for (const listener of end.#listeners) listener({ data: structuredClone(message) });
    }
  }
  addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.#listeners.add(listener);
  }
  removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
    this.#listeners.delete(listener);
  }
  close(): void {
    this.closed = true;
  }
}

function tab(bus: Bus, id: string, clock: { now: number }, focused = { value: false }) {
  return {
    focused,
    leader: new TabLeader({
      channel: bus.endpoint(),
      id,
      now: () => clock.now,
      isFocused: () => focused.value,
      // The tests drive time by hand; no real interval is wanted.
      setInterval: () => 0,
      clearInterval: () => undefined,
    }),
  };
}

describe('TabLeader (FR-MOD-13.8)', () => {
  it('is its own leader with no channel — the old behaviour, the safe failure', () => {
    const lone = new TabLeader({ channel: null });
    lone.start();
    expect(lone.isLeader()).toBe(true);
    expect(lone.anyPeerFocused()).toBe(false);
    lone.stop();
  });

  it('elects exactly one of two tabs, and the same one from both sides', () => {
    const bus = new Bus();
    const clock = { now: 1_000 };
    const first = tab(bus, 'a', clock);
    clock.now = 1_500;
    const second = tab(bus, 'b', clock);

    first.leader.start();
    second.leader.start();

    expect(first.leader.isLeader()).toBe(true);
    expect(second.leader.isLeader()).toBe(false);
  });

  it('keeps the older tab as leader when a newer one opens', () => {
    const bus = new Bus();
    const clock = { now: 1_000 };
    const old = tab(bus, 'z-old', clock);
    old.leader.start();
    clock.now = 9_000;
    const fresh = tab(bus, 'a-fresh', clock);
    fresh.leader.start();

    expect(old.leader.isLeader()).toBe(true);
    expect(fresh.leader.isLeader()).toBe(false);
  });

  it('breaks a tie on birth time by id, identically on both tabs', () => {
    const bus = new Bus();
    const clock = { now: 5_000 };
    const a = tab(bus, 'a', clock);
    const b = tab(bus, 'b', clock);
    a.leader.start();
    b.leader.start();

    expect([a.leader.isLeader(), b.leader.isLeader()]).toEqual([true, false]);
  });

  it('hands over when the leader says goodbye', () => {
    const bus = new Bus();
    const clock = { now: 1_000 };
    const first = tab(bus, 'a', clock);
    clock.now = 2_000;
    const second = tab(bus, 'b', clock);
    first.leader.start();
    second.leader.start();
    expect(second.leader.isLeader()).toBe(false);

    first.leader.stop();
    expect(second.leader.isLeader()).toBe(true);
  });

  it('hands over when the leader goes silent (a crash says no goodbye)', () => {
    const bus = new Bus();
    const clock = { now: 1_000 };
    const first = tab(bus, 'a', clock);
    clock.now = 2_000;
    const second = tab(bus, 'b', clock);
    first.leader.start();
    second.leader.start();

    clock.now += STALE_MS - 1;
    expect(second.leader.isLeader()).toBe(false);
    clock.now += 2;
    expect(second.leader.isLeader()).toBe(true);
    expect(BEAT_MS).toBeLessThan(STALE_MS);
  });

  it('knows when another tab is being looked at', () => {
    const bus = new Bus();
    const clock = { now: 1_000 };
    const first = tab(bus, 'a', clock);
    const second = tab(bus, 'b', clock);
    first.leader.start();
    second.leader.start();
    expect(first.leader.anyPeerFocused()).toBe(false);

    second.focused.value = true;
    // The focus travels on the next beat; a restart sends one now.
    second.leader.stop();
    second.leader.start();
    expect(first.leader.anyPeerFocused()).toBe(true);
  });

  it('tells the other tabs a chat was read, but not itself', () => {
    const bus = new Bus();
    const clock = { now: 1_000 };
    const reader = tab(bus, 'a', clock);
    const listener = tab(bus, 'b', clock);
    reader.leader.start();
    listener.leader.start();

    const heardByListener: string[] = [];
    const heardByReader: string[] = [];
    listener.leader.onCleared((key) => heardByListener.push(key));
    reader.leader.onCleared((key) => heardByReader.push(key));

    reader.leader.announceCleared('chat-1');
    expect(heardByListener).toEqual(['chat-1']);
    expect(heardByReader).toEqual([]);
  });

  it('ignores garbage on the channel', () => {
    const bus = new Bus();
    const clock = { now: 1_000 };
    const subject = tab(bus, 'a', clock);
    const stranger = bus.endpoint();
    subject.leader.start();

    for (const junk of [null, 'x', 7, {}, { t: 'beat' }, { t: 'cleared' }]) {
      stranger.postMessage(junk);
    }
    expect(subject.leader.isLeader()).toBe(true);
  });
});
