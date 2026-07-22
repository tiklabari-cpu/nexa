/**
 * Drives a real RTM server over a real WebSocket.
 *
 * No transport mocking: the properties under test — the login window, framing,
 * pending-request back-pressure, fan-out ordering — only exist at the socket
 * level. A fake would test the fake.
 */
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';
import { loadEnvFile } from './env.js';
import { parseEnv, type RtmEnv } from '../../src/config/env.js';
import { buildRtmServer, type RtmServer } from '../../src/server.js';

loadEnvFile();

export interface Frame {
  request_id?: string;
  action: string;
  type: 'response' | 'push';
  success?: boolean;
  payload: Record<string, unknown>;
}

export function rtmTestEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): RtmEnv {
  return parseEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    // Port 0 so parallel suites never collide on a fixed port.
    RTM_PORT: '0',
    RTM_HOST: '127.0.0.1',
    ...overrides,
  });
}

export async function startRtm(overrides: Partial<NodeJS.ProcessEnv> = {}): Promise<{
  server: RtmServer;
  port: number;
  close: () => Promise<void>;
}> {
  const server = buildRtmServer(rtmTestEnv(overrides));
  await server.listen();
  const port = server.address()?.port;
  if (!port) throw new Error('rtm server did not bind a port');

  return { server, port, close: () => server.close() };
}

/** A connected socket with helpers for request/response and push assertions. */
export class TestSocket {
  readonly #ws: WebSocket;
  readonly #frames: Frame[] = [];
  readonly #waiters: Array<(frame: Frame) => boolean> = [];
  #requestCounter = 0;
  #closed = false;
  closeCode: number | null = null;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
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
    ws.on('close', (code) => {
      this.#closed = true;
      this.closeCode = code;
    });
  }

  static connect(
    port: number,
    options: { organizationId?: string; side?: 'agent' | 'customer'; path?: string } = {},
  ): Promise<TestSocket> {
    const path = options.path ?? `/v1/${options.side ?? 'agent'}/rtm/ws`;
    const query =
      options.organizationId === undefined
        ? ''
        : `?organization_id=${encodeURIComponent(options.organizationId)}`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}${path}${query}`);
      const socket = new TestSocket(ws);
      ws.on('open', () => resolve(socket));
      ws.on('error', (error) => reject(error));
    });
  }

  /** Send an action and resolve with its matching response frame. */
  async request(
    action: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 5_000,
  ): Promise<Frame> {
    const requestId = `req-${++this.#requestCounter}`;
    const response = this.waitFor(
      (frame) => frame.type === 'response' && frame.request_id === requestId,
      timeoutMs,
    );
    this.#ws.send(JSON.stringify({ version: '3.6', request_id: requestId, action, payload }));
    return response;
  }

  /** Send a raw string, for malformed-frame tests. */
  sendRaw(raw: string): void {
    this.#ws.send(raw);
  }

  waitFor(predicate: (frame: Frame) => boolean, timeoutMs = 5_000): Promise<Frame> {
    const existing = this.#frames.find(predicate);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(
          new Error(
            `timed out waiting for a frame; received: ${this.#frames
              .map((f) => `${f.type}:${f.action}`)
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

  waitForPush(action: string, timeoutMs = 5_000): Promise<Frame> {
    return this.waitFor((frame) => frame.type === 'push' && frame.action === action, timeoutMs);
  }

  /** Frames received so far — for asserting something did *not* arrive. */
  get frames(): readonly Frame[] {
    return this.#frames;
  }

  pushes(action?: string): Frame[] {
    return this.#frames.filter(
      (f) => f.type === 'push' && (action === undefined || f.action === action),
    );
  }

  get closed(): boolean {
    return this.#closed;
  }

  async waitForClose(timeoutMs = 5_000): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (!this.#closed && Date.now() < deadline) await delay(20);
    return this.closeCode;
  }

  close(): void {
    this.#ws.close();
  }
}

/** Give asynchronous fan-out a moment before asserting a push did not arrive. */
export const settle = (ms = 250): Promise<void> => delay(ms);
