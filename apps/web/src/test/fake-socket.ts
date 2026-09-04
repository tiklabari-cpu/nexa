/**
 * A stand-in `WebSocket` for suites that mount the shell.
 *
 * The shell owns the app's realtime connection (`AppShell` · `RealtimeOwner`),
 * so every test that renders it now opens a socket. Against jsdom's real
 * `WebSocket` that is an actual TCP connection to `localhost:4001`, which in a
 * unit run fails, schedules a reconnect, and leaves a backoff timer behind
 * after the test that started it has finished — noise that belongs to nobody.
 *
 * This fake answers the handshake the way the gateway does, so a test can reach
 * `live` and then hand the client a push, and it records every socket ever
 * constructed so a test can assert *how many* connections a sequence of
 * navigations opened. `lib/realtime.test.ts` keeps its own narrower fake: that
 * suite is about a handshake being refused, and needs a socket that never
 * opens.
 */
import { vi } from 'vitest';

interface RtmFrame {
  request_id?: string;
  action: string;
  type?: 'response' | 'push';
  success?: boolean;
  payload: Record<string, unknown>;
}

export class FakeWebSocket {
  /** Every socket constructed since the last `reset()`, in order. */
  static instances: FakeWebSocket[] = [];

  /** Frames the client sent, parsed — `login`, `sync`, `ping`, typing. */
  readonly sent: RtmFrame[] = [];
  /** True once the client closed this socket itself (sign-out, unmount). */
  closedByClient = false;

  readonly #listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    // A real socket opens after the constructor returns, which is the only
    // reason `RtmClient` gets to register its `open` listener at all.
    queueMicrotask(() => {
      if (!this.closedByClient) this.#emit('open');
    });
  }

  static reset(): void {
    FakeWebSocket.instances = [];
  }

  /** The newest socket — the one a live client is talking through. */
  static get last(): FakeWebSocket {
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error('no socket has been opened');
    return socket;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.#listeners.get(type);
    if (existing) existing.push(handler);
    else this.#listeners.set(type, [handler]);
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as RtmFrame;
    this.sent.push(frame);
    // The gateway answers everything it is asked. A fake that stayed silent
    // would leave the client's `login` promise pending, so it would never reach
    // `live` and no test could tell a working connection from a broken one.
    if (frame.request_id) {
      this.deliver({
        request_id: frame.request_id,
        action: frame.action,
        type: 'response',
        success: true,
        payload: {},
      });
    }
  }

  close(): void {
    this.closedByClient = true;
  }

  /** Hand the client one frame, encoded the way the wire carries it. */
  deliver(frame: RtmFrame): void {
    this.#emit('message', { data: JSON.stringify(frame) });
  }

  /** A push from the gateway — the frames `applyPush` and the notifier read. */
  push(action: string, payload: Record<string, unknown>): void {
    this.deliver({ action, type: 'push', payload });
  }

  /** The connection dropping from the other end, which triggers reconnect. */
  drop(): void {
    this.#emit('close');
  }

  #emit(type: string, event: unknown = {}): void {
    for (const handler of this.#listeners.get(type) ?? []) handler(event);
  }
}

/** Install the fake as the global `WebSocket`; undone by `vi.unstubAllGlobals`. */
export function installFakeWebSocket(): void {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
}

/** One customer message, in the shape `incoming_event` carries it. */
export function customerMessage(chatId: string, text: string): Record<string, unknown> {
  return {
    chat_id: chatId,
    event: {
      id: `${chatId}_1`,
      chat_id: chatId,
      type: 'message',
      author_type: 'customer',
      author_id: 'customer-1',
      text,
      created_at: new Date().toISOString(),
    },
  };
}
