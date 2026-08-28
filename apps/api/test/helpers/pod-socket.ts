/**
 * A WebSocket client aimed at a spawned RTM pod (M-SCALE-a).
 *
 * `apps/rtm` already has one of these (`test/helpers/rtm-harness.ts`), and this
 * is deliberately not it: that one takes a gateway object built inside the test
 * process, which is exactly the thing the two-pod suite may not do. Importing it
 * across the package boundary is not open either — `@nexa/api`'s tsconfig
 * compiles its own tree, and a `../../rtm/**` import would drag the gateway's
 * sources under this package's `rootDir`.
 *
 * So this is the small half of that harness: connect, request/response by
 * `request_id`, and wait for a push. Everything the fleet questions need and
 * nothing else.
 */
import WebSocket from 'ws';
import type { Pod } from './pods.js';

export interface Frame {
  request_id?: string;
  action: string;
  type: 'response' | 'push';
  success?: boolean;
  payload: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class PodSocket {
  readonly #ws: WebSocket;
  readonly #frames: Frame[] = [];
  readonly #waiters: Array<(frame: Frame) => boolean> = [];
  #requestCounter = 0;

  /** Which pod this socket is attached to — the whole point of the suite. */
  readonly pod: string;

  private constructor(ws: WebSocket, pod: string) {
    this.#ws = ws;
    this.pod = pod;
    ws.on('message', (raw) => {
      let frame: Frame;
      try {
        frame = JSON.parse(raw.toString()) as Frame;
      } catch {
        return;
      }
      this.#frames.push(frame);
      for (const waiter of [...this.#waiters]) {
        if (waiter(frame)) this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
      }
    });
  }

  static connect(
    pod: Pod,
    options: { organizationId: string; side?: 'agent' | 'customer' },
  ): Promise<PodSocket> {
    const path = `/v1/${options.side ?? 'agent'}/rtm/ws`;
    const query = `?organization_id=${encodeURIComponent(options.organizationId)}`;
    const url = `ws://127.0.0.1:${pod.port}${path}${query}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const socket = new PodSocket(ws, pod.name);
      ws.on('open', () => resolve(socket));
      ws.on('error', (error) => reject(error));
    });
  }

  async request(
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<Frame> {
    const requestId = `req-${++this.#requestCounter}`;
    const response = this.waitFor(
      (frame) => frame.type === 'response' && frame.request_id === requestId,
      timeoutMs,
    );
    this.#ws.send(JSON.stringify({ version: '3.6', request_id: requestId, action, payload }));
    return response;
  }

  waitFor(predicate: (frame: Frame) => boolean, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Frame> {
    const existing = this.#frames.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `${this.pod}: timed out waiting for a frame; received: ${this.#frames
              .map((frame) => `${frame.type}:${frame.action}`)
              .join(', ')}`,
          ),
        );
      }, timeoutMs);

      this.#waiters.push((frame) => {
        if (!predicate(frame)) return false;
        clearTimeout(timer);
        resolve(frame);
        return true;
      });
    });
  }

  waitForPush(action: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Frame> {
    return this.waitFor((frame) => frame.type === 'push' && frame.action === action, timeoutMs);
  }

  /** Pushes received so far — for asserting something did *not* arrive. */
  pushes(action?: string): Frame[] {
    return this.#frames.filter(
      (frame) => frame.type === 'push' && (action === undefined || frame.action === action),
    );
  }

  close(): void {
    this.#ws.close();
  }
}
