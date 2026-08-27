/**
 * `RtmClient` reconnect behaviour when the gateway refuses the handshake
 * (M-LOAD-CAP · NFR-R2).
 *
 * The gateway can now say no. It refuses an upgrade while draining (M-OPS-b)
 * and, since M-LOAD-CAP, when it is at its configured connection ceiling — and
 * a refusal reaches this class as a `close` it did not initiate, which is
 * exactly the event that triggers reconnect. That is the desired behaviour and
 * also the risk: a pod at its ceiling refuses *because* it has no room, and a
 * client that answers by retrying immediately would spend that pod's remaining
 * capacity on the retries, which is a load-shedding mechanism that adds load.
 *
 * So what is pinned here is that a refusal walks up the same bounded, jittered
 * backoff any other close does — and, specifically, that it does not reset the
 * attempt counter, because a handshake that never opened is the one case where
 * it would be easy to.
 *
 * Full jitter's floor is zero by construction (`Math.random() * ceiling`), so
 * the guarantee is about the ceiling, not about any single wait: `Math.random`
 * is pinned to 1 below to read the ceiling directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RtmClient, type RtmStatus } from './realtime.js';

/** A socket that behaves like a refused handshake: constructed, never opened. */
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly #listeners = new Map<string, Array<(event: unknown) => void>>();
  readonly sent: string[] = [];
  closedByCaller = false;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    const existing = this.#listeners.get(type);
    if (existing) existing.push(handler);
    else this.#listeners.set(type, [handler]);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.closedByCaller = true;
  }

  emit(type: string, event: unknown = {}): void {
    for (const handler of this.#listeners.get(type) ?? []) handler(event);
  }

  /** What the browser does with a 503 on the upgrade: `error`, then `close`. */
  refuse(): void {
    this.emit('error');
    this.emit('close');
  }
}

/** Delays handed to `setTimeout`, and the callbacks, so a test drives the clock. */
const scheduled: Array<{ ms: number; run: () => void }> = [];

function install(): void {
  FakeWebSocket.instances = [];
  scheduled.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('setTimeout', ((handler: () => void, ms?: number) => {
    scheduled.push({ ms: ms ?? 0, run: handler });
    return scheduled.length as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout);
  vi.stubGlobal('clearTimeout', () => {});
  vi.stubGlobal(
    'setInterval',
    (() => 0 as unknown as ReturnType<typeof setInterval>) as unknown as typeof setInterval,
  );
  vi.stubGlobal('clearInterval', () => {});
  // Full jitter picks uniformly below the ceiling; pinned to the top of the
  // range so the assertions read the ceiling itself rather than a sample.
  vi.spyOn(Math, 'random').mockReturnValue(1);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function newClient(onStatus?: (status: RtmStatus) => void): RtmClient {
  return new RtmClient({
    url: 'ws://127.0.0.1:4001/v1/agent/rtm/ws',
    organizationId: '11111111-1111-4111-8111-111111111111',
    getToken: () => 'token',
    pushes: [],
    onPush: () => {},
    ...(onStatus ? { onStatusChange: onStatus } : {}),
  });
}

/** Refuse the newest socket and run whatever retry that scheduled. */
function refuseAndRetry(): number {
  const socket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
  socket.refuse();
  const retry = scheduled.pop();
  if (!retry) throw new Error('a refused handshake scheduled no retry at all');
  retry.run();
  return retry.ms;
}

describe('a gateway that refuses the handshake (M-LOAD-CAP · NFR-R2)', () => {
  it('backs off along the same bounded curve as any other close, and caps', () => {
    install();
    const client = newClient();
    client.connect();

    const waits = Array.from({ length: 8 }, () => refuseAndRetry());

    // 500ms doubling to the 15s ceiling. The point is the shape: nothing here
    // is a tight loop, and nothing here grows without bound either — an agent
    // whose gateway is full must still come back once it has room.
    expect(waits).toEqual([500, 1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000]);
    expect(FakeWebSocket.instances).toHaveLength(9);
  });

  it('does not reset the attempt counter — a handshake that never opened is not a connection', () => {
    // The regression this guards: treating "we got as far as constructing a
    // socket" as progress. Then every refusal restarts the curve at 500ms, and
    // a pod at its ceiling gets retried twice a second, forever, by every
    // client it turned away.
    install();
    const client = newClient();
    client.connect();

    for (let i = 0; i < 6; i += 1) refuseAndRetry();

    expect(refuseAndRetry()).toBe(15_000);
  });

  it('never reports itself live, and never gives up either', () => {
    install();
    const seen: RtmStatus[] = [];
    const client = newClient((status) => seen.push(status));
    client.connect();

    for (let i = 0; i < 4; i += 1) refuseAndRetry();

    expect(seen).not.toContain('live');
    // `offline` is what a *rejected login* produces — wrong or revoked
    // credentials, where retrying is pointless. A refused upgrade is the
    // opposite case: the credential is fine and the instance is busy, so
    // giving up would strand the agent until they reloaded the page.
    expect(seen).not.toContain('offline');
    expect(client.status).toBe('reconnecting');
  });

  it('sends nothing at a socket that never opened', () => {
    // Login is sent from the `open` handler. Worth pinning because a refused
    // handshake still gives the caller a `WebSocket` object, and writing to it
    // would surface as an exception rather than as a retry.
    install();
    const client = newClient();
    client.connect();

    for (let i = 0; i < 3; i += 1) refuseAndRetry();

    expect(FakeWebSocket.instances.every((socket) => socket.sent.length === 0)).toBe(true);
  });

  it('starts the curve over once a connection actually succeeds', () => {
    // The other half of the counter: it has to be reset by something, or an
    // agent who survived one busy pod waits 15s after every later blip.
    install();
    const client = newClient();
    client.connect();

    for (let i = 0; i < 4; i += 1) refuseAndRetry();
    expect(scheduled).toHaveLength(0);

    // A successful login: open, then the gateway's `login` response.
    const accepted = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]!;
    accepted.emit('open');
    const request = JSON.parse(accepted.sent[0]!) as { request_id: string };
    accepted.emit('message', {
      data: JSON.stringify({
        request_id: request.request_id,
        action: 'login',
        type: 'response',
        success: true,
        payload: {},
      }),
    });

    // `#login` awaits its response, so let the microtask queue drain before
    // asserting on state it sets.
    return Promise.resolve().then(() => {
      expect(client.status).toBe('live');

      accepted.emit('close');
      expect(scheduled.pop()?.ms).toBe(500);
    });
  });
});
