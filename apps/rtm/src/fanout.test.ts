/**
 * Fan-out's half of tm 408 — the order and the spread of `sync_required`, which
 * the integration suite (`test/integration/bus-reconnect.test.ts`, a real
 * `CLIENT KILL`) cannot pin down: a real reconnect is over too fast to observe
 * what happens *between* `ready` and the resubscribe answering.
 */
import { EventEmitter } from 'node:events';
import { pino } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { licenseChannel } from '@siyahtus/types';
import type { WebSocket } from 'ws';
import { ConnectionRegistry } from './connection.js';
import { Fanout, RESYNC_SPREAD_MAX_MS } from './fanout.js';

const ORG = '11111111-1111-4111-8111-111111111111';

class FakeSubscriber extends EventEmitter {
  readonly subscribed: string[][] = [];
  next: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  subscribe(...channels: string[]): Promise<number> {
    this.subscribed.push(channels);
    return new Promise((resolve, reject) => {
      this.next.push({ resolve: () => resolve(channels.length), reject });
    });
  }

  answer(): void {
    this.next.shift()?.resolve();
  }

  fail(): void {
    this.next.shift()?.reject(new Error('Connection is closed.'));
  }
}

function setup(sockets = 1, pushes = ['sync_required']) {
  const subscriber = new FakeSubscriber();
  const registry = new ConnectionRegistry();
  const fanout = new Fanout(subscriber as unknown as Redis, registry, pino({ level: 'silent' }));
  const sent: string[][] = [];
  for (let i = 0; i < sockets; i += 1) {
    const frames: string[] = [];
    sent.push(frames);
    const ws = { send: (frame: string) => frames.push(frame) } as unknown as WebSocket;
    const connection = registry.add({ ws, side: 'agent', organizationId: ORG });
    registry.authenticate(connection.id, { licenseId: '7', actorId: `agent-${i}` });
    for (const action of pushes) connection.subscriptions.add(action);
  }
  return { subscriber, registry, fanout, sent };
}

async function subscribed(fanout: Fanout, subscriber: FakeSubscriber): Promise<void> {
  const pending = fanout.ensureSubscribed('7');
  subscriber.answer();
  await pending;
}

describe('Fanout — sync_required after the subscription comes back (tm 408)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('says nothing on the first ready, which is not a recovery', async () => {
    const { subscriber, fanout, sent } = setup();
    await subscribed(fanout, subscriber);
    subscriber.emit('ready');
    await vi.runAllTimersAsync();
    expect(sent[0]).toEqual([]);
  });

  it('re-subscribes on ready and tells the sockets only once that has been answered', async () => {
    const { subscriber, fanout, sent } = setup();
    await subscribed(fanout, subscriber);

    subscriber.emit('reconnecting');
    subscriber.emit('reconnecting'); // every failed attempt says it again
    subscriber.emit('ready');
    expect(subscriber.subscribed.at(-1)).toEqual([licenseChannel('7')]);

    await vi.runAllTimersAsync();
    expect(sent[0]).toEqual([]); // the resubscribe has not answered yet

    subscriber.answer();
    await vi.runAllTimersAsync();
    expect(sent[0]!.map((frame) => JSON.parse(frame) as unknown)).toEqual([
      { action: 'sync_required', type: 'push', payload: { reason: 'bus_reconnected' } },
    ]);
  });

  it('waits for the next ready when the resubscribe itself fails', async () => {
    const { subscriber, fanout, sent } = setup();
    await subscribed(fanout, subscriber);

    subscriber.emit('reconnecting');
    subscriber.emit('ready');
    subscriber.fail();
    await vi.runAllTimersAsync();
    expect(sent[0]).toEqual([]);

    subscriber.emit('ready');
    subscriber.answer();
    await vi.runAllTimersAsync();
    expect(sent[0]).toHaveLength(1);
  });

  it('skips sockets that did not subscribe to it, and sockets that closed while they waited', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { subscriber, fanout, registry, sent } = setup(2);
    const [first, second] = registry.authenticated();
    second!.subscriptions.delete('sync_required');
    await subscribed(fanout, subscriber);

    subscriber.emit('reconnecting');
    subscriber.emit('ready');
    subscriber.answer();
    // The resubscribe settles and the turns are handed out (half of the 5 ms
    // window one subscribed socket gets); the first socket closes before its own.
    await vi.advanceTimersByTimeAsync(1);
    registry.remove(first!.id);
    await vi.runAllTimersAsync();
    expect(sent).toEqual([[], []]);
  });

  it('spreads a full node (1,000 sockets × 5 ms reaches the cap) over at most the cap', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.999_999);
    const { subscriber, fanout, sent } = setup(1_000);
    await subscribed(fanout, subscriber);

    subscriber.emit('reconnecting');
    subscriber.emit('ready');
    subscriber.answer();
    await vi.advanceTimersByTimeAsync(RESYNC_SPREAD_MAX_MS - 1_000);
    expect(sent.every((frames) => frames.length === 0)).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sent.every((frames) => frames.length === 1)).toBe(true);
  });
});
