/**
 * One tab speaks for the agent (IN-10 · tm 367).
 *
 * An agent with the console open in two tabs gets every realtime push twice —
 * each tab has its own socket — and used to hear two chimes (and, with the
 * repeating sound, two metronomes). Sound is the one effect that cannot be
 * deduplicated after the fact, so the tabs agree beforehand on who plays it.
 *
 * **Election.** Each tab announces itself on a `BroadcastChannel` and repeats the
 * announcement every {@link BEAT_MS}. The leader is the live tab that was born
 * first (ties by id), so the choice is the same on every tab without a vote and
 * does not flap when a newer tab opens. A tab is live until it says goodbye
 * (`pagehide`) or is silent for {@link STALE_MS} — the second covers a crash. A
 * console tab keeps a WebSocket open, which browsers exempt from the heavy
 * timer throttling of background tabs, so a hidden leader still beats on time.
 *
 * **Focus.** Each beat also says whether its tab is being looked at. The agent
 * looking at *any* console tab is not helped by a chime from another, so the
 * leader stays quiet while a peer is focused ({@link TabLeader.anyFocused}).
 *
 * **Reading stops the sound everywhere.** A tab that opens the chat tells the
 * others (`cleared`), so the leader's repeater stops although it never saw the
 * chat opened.
 *
 * Without `BroadcastChannel` (an old browser, a test) a tab is simply its own
 * leader: the old behaviour, which is the safe direction to fail in — a double
 * chime is an annoyance, a missing one is a missed player.
 */

/** How often a tab announces itself. */
export const BEAT_MS = 2_000;
/** A peer silent for this long is gone. */
export const STALE_MS = 7_000;

type Message =
  | { t: 'beat'; id: string; born: number; focused: boolean }
  | { t: 'bye'; id: string }
  | { t: 'cleared'; id: string; key: string };

/** The part of `BroadcastChannel` this uses — so a test can supply a pair. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
}

export interface TabLeaderOptions {
  channel: ChannelLike | null;
  id?: string;
  now?: () => number;
  /** Whether this tab is being looked at, asked at every beat. */
  isFocused?: () => boolean;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
}

interface Peer {
  born: number;
  focused: boolean;
  seenAt: number;
}

export class TabLeader {
  readonly id: string;
  readonly #born: number;
  readonly #channel: ChannelLike | null;
  readonly #now: () => number;
  readonly #isFocused: () => boolean;
  readonly #peers = new Map<string, Peer>();
  readonly #clearedListeners = new Set<(key: string) => void>();
  readonly #setInterval: (fn: () => void, ms: number) => unknown;
  readonly #clearInterval: (handle: unknown) => void;
  #timer: unknown = null;

  constructor(options: TabLeaderOptions) {
    this.#channel = options.channel;
    this.#now = options.now ?? (() => Date.now());
    this.id = options.id ?? Math.random().toString(36).slice(2, 10);
    this.#born = this.#now();
    this.#isFocused = options.isFocused ?? (() => false);
    this.#setInterval = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
    this.#clearInterval = options.clearInterval ?? ((h) => clearInterval(h as never));
  }

  start(): void {
    if (!this.#channel || this.#timer !== null) return;
    this.#channel.addEventListener('message', this.#onMessage);
    this.#beat();
    this.#timer = this.#setInterval(() => this.#beat(), BEAT_MS);
  }

  stop(): void {
    if (!this.#channel) return;
    if (this.#timer !== null) this.#clearInterval(this.#timer);
    this.#timer = null;
    this.#channel.removeEventListener('message', this.#onMessage);
    this.#send({ t: 'bye', id: this.id });
    this.#peers.clear();
  }

  /** Whether this tab is the one that plays sound. True when it is alone. */
  isLeader(): boolean {
    this.#prune();
    for (const [id, peer] of this.#peers) {
      if (peer.born < this.#born || (peer.born === this.#born && id < this.id)) return false;
    }
    return true;
  }

  /** Whether any *other* live tab is being looked at. */
  anyPeerFocused(): boolean {
    this.#prune();
    for (const peer of this.#peers.values()) if (peer.focused) return true;
    return false;
  }

  /** Tell the other tabs the agent read `key` (a chat id): stop its repeating sound. */
  announceCleared(key: string): void {
    this.#send({ t: 'cleared', id: this.id, key });
  }

  /** Hear that another tab read `key`. Returns the way to stop listening. */
  onCleared(listener: (key: string) => void): () => void {
    this.#clearedListeners.add(listener);
    return () => this.#clearedListeners.delete(listener);
  }

  #beat(): void {
    this.#send({ t: 'beat', id: this.id, born: this.#born, focused: this.#isFocused() });
  }

  #send(message: Message): void {
    try {
      this.#channel?.postMessage(message);
    } catch {
      // A closed channel (the page is going away) — nothing to tell anyone.
    }
  }

  #prune(): void {
    const now = this.#now();
    for (const [id, peer] of this.#peers) {
      if (now - peer.seenAt > STALE_MS) this.#peers.delete(id);
    }
  }

  readonly #onMessage = (event: { data: unknown }): void => {
    const message = event.data as Partial<Message> | null;
    if (!message || typeof message !== 'object' || message.id === this.id) return;
    if (typeof message.id !== 'string') return;
    if (message.t === 'beat') {
      if (typeof message.born !== 'number') return;
      const known = this.#peers.has(message.id);
      this.#peers.set(message.id, {
        born: message.born,
        focused: message.focused === true,
        seenAt: this.#now(),
      });
      // A newcomer does not know us yet: answer at once rather than after a beat,
      // so two tabs opened together settle on one leader within a message.
      if (!known) this.#beat();
    } else if (message.t === 'bye') {
      this.#peers.delete(message.id);
    } else if (message.t === 'cleared' && typeof message.key === 'string') {
      for (const listener of this.#clearedListeners) listener(message.key);
    }
  };
}

/** The browser's channel, or null where there is none. */
export function openLeaderChannel(): ChannelLike | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : (new BroadcastChannel('siyahtus.notification-leader') as unknown as ChannelLike);
  } catch {
    return null;
  }
}
