/**
 * Fan-out's half of tm 408 — the order and the spread of `sync_required`, which
 * the integration suite (`test/integration/bus-reconnect.test.ts`, a real
 * `CLIENT KILL`) cannot pin down: a real reconnect is over too fast to observe
 * what happens *between* `ready` and the resubscribe answering.
 *
 * And tm 417.4: the visitor's draft preview reaches agent sockets only, and a
 * congested socket holds the newest draft per chat instead of queueing or
 * dropping it — against a fake socket whose `bufferedAmount` the test sets.
 */
import { EventEmitter } from 'node:events';
import { performance } from 'node:perf_hooks';
import { pino, type Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  licenseChannel,
  principalRevokedEnvelope,
  RTM_PUSH_ACTIONS,
  type PrincipalRevokedEnvelope,
} from '@siyahtus/types';
import type { WebSocket } from 'ws';
import { ConnectionRegistry } from './connection.js';
import { Writable } from 'node:stream';
import {
  Fanout,
  RESYNC_SPREAD_MAX_MS,
  SNEAK_PEEK_COALESCE_BUFFERED_BYTES,
  SNEAK_PEEK_COALESCE_RETRY_MS,
} from './fanout.js';
import { SocketWriter } from './socket-writer.js';

const ORG = '11111111-1111-4111-8111-111111111111';
/** `WebSocket.OPEN` — the writer writes only to an open socket (tm 428). */
const WS_OPEN = 1;

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

/** Every write goes through the gateway's writer (tm 428); off here — `socket-writer.test.ts` holds it. */
function unlimitedWriter(): SocketWriter {
  return new SocketWriter(null, pino({ level: 'silent' }));
}

function setup(sockets = 1, pushes = ['sync_required']) {
  const subscriber = new FakeSubscriber();
  const registry = new ConnectionRegistry();
  const fanout = new Fanout(
    subscriber as unknown as Redis,
    registry,
    pino({ level: 'silent' }),
    unlimitedWriter(),
  );
  const sent: string[][] = [];
  for (let i = 0; i < sockets; i += 1) {
    const frames: string[] = [];
    sent.push(frames);
    const ws = {
      readyState: WS_OPEN,
      send: (frame: string) => frames.push(frame),
    } as unknown as WebSocket;
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

const CHAT = 'CHAT00001';
const OTHER_CHAT = 'CHAT00002';
const PREVIEW_PUSHES = ['incoming_sneak_peek', 'incoming_typing_indicator', 'incoming_event'];
/** More than the threshold: a socket this full is congested. */
const CONGESTED = 70_000;

interface FakeSocket {
  frames: string[];
  readyState: number;
  bufferedAmount: number;
  send(frame: string): void;
}

function previewSetup() {
  const subscriber = new FakeSubscriber();
  const registry = new ConnectionRegistry();
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(chunk.toString());
      done();
    },
  });
  // Debug, so the coalescing line is written and can be searched.
  const fanout = new Fanout(
    subscriber as unknown as Redis,
    registry,
    pino({ level: 'debug' }, stream),
    unlimitedWriter(),
  );

  function socket(
    actorId: string,
    actor: { actorType: string; groupIds?: number[]; unrestricted?: boolean },
    side: 'agent' | 'customer' = 'agent',
  ) {
    const fake: FakeSocket = {
      frames: [],
      readyState: WS_OPEN,
      bufferedAmount: 0,
      send(frame: string) {
        this.frames.push(frame);
      },
    };
    const connection = registry.add({
      ws: fake as unknown as WebSocket,
      side,
      organizationId: ORG,
    });
    registry.authenticate(connection.id, { licenseId: '7', actorId, ...actor });
    for (const action of PREVIEW_PUSHES) connection.subscriptions.add(action);
    return { fake, connection };
  }

  function publish(
    action: string,
    payload: unknown,
    audience: {
      agentIds?: string[];
      groupIds?: number[];
      allAgents?: boolean;
      customerId?: string;
    } = { agentIds: ['agent-1'] },
  ): void {
    subscriber.emit(
      'message',
      licenseChannel('7'),
      JSON.stringify({
        v: 1,
        licenseId: '7',
        organizationId: ORG,
        action,
        audience,
        payload,
        at: Date.now(),
      }),
    );
  }

  return { registry, fanout, lines, socket, publish };
}

function draft(text: string, seq: number, chatId = CHAT) {
  return {
    chat_id: chatId,
    thread_id: null,
    sneak_peek: {
      author_id: 'visitor-1',
      author_type: 'customer',
      recipients: 'agents',
      timestamp: 1,
      text,
      seq,
    },
  };
}

function clear(seq: number, chatId = CHAT) {
  return {
    chat_id: chatId,
    thread_id: null,
    typing_indicator: {
      author_id: 'visitor-1',
      author_type: 'customer',
      recipients: 'agents',
      timestamp: 1,
      is_typing: false,
      seq,
    },
  };
}

/** What a socket was sent, as `action` plus the draft's text (or `seq` of a clear). */
function received(fake: FakeSocket): string[] {
  return fake.frames.map((frame) => {
    const push = JSON.parse(frame) as {
      action: string;
      payload: {
        chat_id?: string;
        sneak_peek?: { text: string };
        typing_indicator?: { seq: number };
      };
    };
    if (push.payload.sneak_peek) {
      return `${push.action}:${push.payload.chat_id}:${push.payload.sneak_peek.text}`;
    }
    if (push.payload.typing_indicator) {
      return `${push.action}:${push.payload.chat_id}:seq=${push.payload.typing_indicator.seq}`;
    }
    return push.action;
  });
}

describe('Fanout — the visitor draft preview (tm 417.4, FR-MOD-11.8)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('pins the threshold the congested socket is measured against', () => {
    expect(CONGESTED).toBeGreaterThan(SNEAK_PEEK_COALESCE_BUFFERED_BYTES);
    expect(SNEAK_PEEK_COALESCE_BUFFERED_BYTES).toBe(64 * 1024);
    expect(SNEAK_PEEK_COALESCE_RETRY_MS).toBe(250);
  });

  it('(a) gives the draft and its clear to the human agent only — never to a bot, however it is addressed (FR-MOD-11.8)', () => {
    const { socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    // Unrestricted, a member of the addressed team, and named in agentIds:
    // every route the audience filter has — and still not a person.
    const bot = socket('bot-1', { actorType: 'bot', groupIds: [3], unrestricted: true });
    const scopedBot = socket('bot-2', { actorType: 'bot', groupIds: [3] });
    const audience = { agentIds: ['agent-1', 'bot-1', 'bot-2'], groupIds: [3] };

    publish('incoming_sneak_peek', draft('hello', 1), audience);
    publish('incoming_typing_indicator', clear(2), audience);
    publish('incoming_event', { chat_id: CHAT }, audience);

    expect(received(human.fake)).toEqual([
      `incoming_sneak_peek:${CHAT}:hello`,
      `incoming_typing_indicator:${CHAT}:seq=2`,
      'incoming_event',
    ]);
    // A bot keeps every other push it is addressed by.
    expect(received(bot.fake)).toEqual(['incoming_event']);
    expect(received(scopedBot.fake)).toEqual(['incoming_event']);
  });

  it('(b) holds the drafts on a congested socket and sends only the newest once it drains (FR-MOD-11.8)', async () => {
    const { socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    human.fake.bufferedAmount = CONGESTED;

    publish('incoming_sneak_peek', draft('A', 1));
    publish('incoming_sneak_peek', draft('B', 2));
    expect(human.fake.frames).toEqual([]);

    human.fake.bufferedAmount = 0;
    await vi.advanceTimersByTimeAsync(SNEAK_PEEK_COALESCE_RETRY_MS);
    expect(received(human.fake)).toEqual([`incoming_sneak_peek:${CHAT}:B`]);

    // Nothing else is waiting: the timer is gone with the held frames.
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(human.fake.frames).toHaveLength(1);
  });

  it('keeps waiting while the socket stays full, then sends the newest of each chat', async () => {
    const { socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    human.fake.bufferedAmount = CONGESTED;

    publish('incoming_sneak_peek', draft('one-A', 1));
    publish('incoming_sneak_peek', draft('two-A', 1, OTHER_CHAT));
    publish('incoming_sneak_peek', draft('one-B', 2));
    await vi.advanceTimersByTimeAsync(SNEAK_PEEK_COALESCE_RETRY_MS * 3);
    expect(human.fake.frames).toEqual([]);
    // One timer for the socket, not one per frame.
    expect(vi.getTimerCount()).toBe(1);

    human.fake.bufferedAmount = SNEAK_PEEK_COALESCE_BUFFERED_BYTES; // at, not above
    await vi.advanceTimersByTimeAsync(SNEAK_PEEK_COALESCE_RETRY_MS);
    expect(received(human.fake)).toEqual([
      `incoming_sneak_peek:${OTHER_CHAT}:two-A`,
      `incoming_sneak_peek:${CHAT}:one-B`,
    ]);
  });

  it('(c) sends the clear at once and drops the draft waiting for that chat (FR-MOD-11.8)', async () => {
    const { socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    human.fake.bufferedAmount = CONGESTED;

    publish('incoming_sneak_peek', draft('A', 1));
    publish('incoming_sneak_peek', draft('other', 1, OTHER_CHAT));
    publish('incoming_typing_indicator', clear(2));
    expect(received(human.fake)).toEqual([`incoming_typing_indicator:${CHAT}:seq=2`]);

    human.fake.bufferedAmount = 0;
    await vi.runAllTimersAsync();
    // The other chat's draft was not this clear's to cancel.
    expect(received(human.fake)).toEqual([
      `incoming_typing_indicator:${CHAT}:seq=2`,
      `incoming_sneak_peek:${OTHER_CHAT}:other`,
    ]);
  });

  it('lets a draft sent once the socket drains supersede the one still waiting', async () => {
    const { socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    human.fake.bufferedAmount = CONGESTED;
    publish('incoming_sneak_peek', draft('old', 1));

    human.fake.bufferedAmount = 0;
    publish('incoming_sneak_peek', draft('new', 2));
    expect(vi.getTimerCount()).toBe(0);
    await vi.runAllTimersAsync();
    expect(received(human.fake)).toEqual([`incoming_sneak_peek:${CHAT}:new`]);
  });

  it('(d) sends every other push on a congested socket as before (FR-MOD-11.8)', () => {
    const { socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    human.fake.bufferedAmount = CONGESTED;

    publish('incoming_event', { chat_id: CHAT });
    expect(received(human.fake)).toEqual(['incoming_event']);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('(e) forgets a closed socket: no timer is left and nothing is sent (FR-MOD-11.8)', async () => {
    const { registry, fanout, socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    human.fake.bufferedAmount = CONGESTED;
    publish('incoming_sneak_peek', draft('A', 1));
    expect(vi.getTimerCount()).toBe(1);

    // What the socket's close handler does.
    registry.remove(human.connection.id);
    fanout.release(human.connection.id);
    expect(vi.getTimerCount()).toBe(0);

    human.fake.bufferedAmount = 0;
    await vi.runAllTimersAsync();
    expect(human.fake.frames).toEqual([]);
  });

  it('drops the held frames of a socket that closed without being released', async () => {
    const { registry, socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    human.fake.bufferedAmount = CONGESTED;
    publish('incoming_sneak_peek', draft('A', 1));

    registry.remove(human.connection.id);
    human.fake.bufferedAmount = 0;
    await vi.runAllTimersAsync();
    expect(human.fake.frames).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('(f) logs the coalescing with ids and the action, never the draft (FR-MOD-11.8)', async () => {
    const { lines, socket, publish } = previewSetup();
    const human = socket('agent-1', { actorType: 'agent' });
    human.fake.bufferedAmount = CONGESTED;
    const sentinel = 'SENTINEL-draft-4111 1111 1111';

    publish('incoming_sneak_peek', draft(sentinel, 1));
    publish('incoming_sneak_peek', draft(`${sentinel} more`, 2));
    human.fake.bufferedAmount = 0;
    await vi.runAllTimersAsync();

    const coalesced = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((line) => line['msg'] === 'coalesced a push on a congested socket');
    expect(coalesced).toHaveLength(2);
    expect(coalesced[0]).toMatchObject({
      connection_id: human.connection.id,
      action: 'incoming_sneak_peek',
    });
    expect(lines.join('\n')).not.toContain('SENTINEL');
    // The frame itself did reach the agent.
    expect(received(human.fake)).toEqual([`incoming_sneak_peek:${CHAT}:${sentinel} more`]);
  });
});

describe('Fanout — who logged in decides the audience, not which door they used (tm 425)', () => {
  const event = (id: string) => ({ chat_id: CHAT, event: { id, text: id, recipients: 'all' } });

  it('gives a visitor credential at the agent door no workspace-wide, team or agent push (NFR-S3)', () => {
    const { socket, publish } = previewSetup();
    // What a visitor token on the agent socket used to become: an agent-side
    // connection whose principal is a visitor — and reach given to it besides.
    const visitor = socket('cust-1', { actorType: 'customer', groupIds: [3], unrestricted: true });
    const member = socket('agent-1', { actorType: 'agent', groupIds: [3] });

    publish('incoming_event', event('E1'), { allAgents: true });
    publish('incoming_event', event('E2'), { groupIds: [3] });
    publish('incoming_event', event('E3'), { agentIds: ['cust-1', 'agent-1'] });

    // The member hears all three — otherwise this would pass on a fan-out that
    // delivers nothing at all.
    expect(member.fake.frames).toHaveLength(3);
    expect(visitor.fake.frames).toEqual([]);
  });

  it('reaches a visitor credential only by its own id, wherever it was presented', () => {
    const { socket, publish } = previewSetup();
    const atAgentDoor = socket('cust-1', { actorType: 'customer' });
    const atCustomerDoor = socket('cust-2', { actorType: 'customer' }, 'customer');

    publish('incoming_event', event('E1'), { customerId: 'cust-1' });
    publish('incoming_event', event('E2'), { customerId: 'cust-2', allAgents: true });

    expect(
      atAgentDoor.fake.frames.map(
        (f) => (JSON.parse(f) as { payload: { event: { id: string } } }).payload.event.id,
      ),
    ).toEqual(['E1']);
    expect(
      atCustomerDoor.fake.frames.map(
        (f) => (JSON.parse(f) as { payload: { event: { id: string } } }).payload.event.id,
      ),
    ).toEqual(['E2']);
  });

  it('gives a member credential at the customer door nothing at all', () => {
    const { socket, publish } = previewSetup();
    const member = socket(
      'agent-2',
      { actorType: 'agent', groupIds: [3], unrestricted: true },
      'customer',
    );

    publish('incoming_event', event('E1'), { allAgents: true });
    publish('incoming_event', event('E2'), { groupIds: [3], agentIds: ['agent-2'] });
    publish('incoming_event', event('E3'), { customerId: 'agent-2' });

    expect(member.fake.frames).toEqual([]);
  });

  it('leaves a bot at the agent door the audiences it had', () => {
    const { socket, publish } = previewSetup();
    const bot = socket('bot-1', { actorType: 'bot', groupIds: [3] });

    publish('incoming_event', event('E1'), { groupIds: [3] });
    publish('incoming_event', event('E2'), { allAgents: true });

    expect(bot.fake.frames).toHaveLength(2);
  });

  it('gives agent audiences to a member and a bot only — a principal kind it does not know hears nothing', () => {
    // An allow-list, like the authenticator's credential kinds: the next kind
    // somebody adds is closed here until it is deliberately opened.
    const { socket, publish } = previewSetup();
    const unknown = socket('operator-1', {
      actorType: 'platform',
      groupIds: [3],
      unrestricted: true,
    });

    publish('incoming_event', event('E1'), { allAgents: true });
    publish('incoming_event', event('E2'), { groupIds: [3], agentIds: ['operator-1'] });

    expect(unknown.fake.frames).toEqual([]);
  });
});

describe('Fanout — principal_revoked goes to the gateway, never to a socket (tm 426)', () => {
  function withHandler() {
    const subscriber = new FakeSubscriber();
    const registry = new ConnectionRegistry();
    const error = vi.fn();
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error,
    } as unknown as Logger;
    const revoked: PrincipalRevokedEnvelope[] = [];
    const fanout = new Fanout(
      subscriber as unknown as Redis,
      registry,
      log,
      unlimitedWriter(),
      null,
      (envelope) => revoked.push(envelope),
    );
    const frames: string[] = [];
    const ws = { readyState: WS_OPEN, send: (frame: string) => frames.push(frame) };
    const connection = registry.add({
      ws: ws as unknown as WebSocket,
      side: 'agent',
      organizationId: ORG,
    });
    registry.authenticate(connection.id, { licenseId: '7', actorId: 'agent-1', tokenId: 't-1' });
    // Subscribed to every push there is — a revocation must still not arrive.
    for (const action of RTM_PUSH_ACTIONS) connection.subscriptions.add(action);
    connection.subscriptions.add('principal_revoked');
    return { subscriber, fanout, revoked, frames, error };
  }

  const envelope = principalRevokedEnvelope(
    { licenseId: '7', organizationId: ORG },
    { kind: 'agent', agentId: 'agent-1' },
  );

  it('hands a revocation on its licence channel to the handler and writes nothing (NFR-S2)', () => {
    const { subscriber, revoked, frames } = withHandler();

    subscriber.emit('message', licenseChannel('7'), JSON.stringify(envelope));

    expect(revoked).toEqual([envelope]);
    expect(frames).toEqual([]);
  });

  it('refuses, loudly, a revocation it cannot read', () => {
    const { subscriber, revoked, frames, error } = withHandler();

    subscriber.emit(
      'message',
      licenseChannel('7'),
      JSON.stringify({ ...envelope, target: { kind: 'agent' } }),
    );

    expect(revoked).toEqual([]);
    expect(frames).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      { channel: licenseChannel('7') },
      'discarded a principal_revoked message it could not read',
    );
  });

  it('refuses a revocation that names another licence than the channel it came on (NFR-S4)', () => {
    const { subscriber, revoked, error } = withHandler();

    subscriber.emit('message', licenseChannel('8'), JSON.stringify(envelope));

    expect(revoked).toEqual([]);
    expect(error).toHaveBeenCalledWith(
      { channel: licenseChannel('8'), license_id: '7' },
      'discarded a principal_revoked message from another licence channel',
    );
  });

  it('still delivers the pushes around it', () => {
    const { subscriber, frames } = withHandler();
    const push = {
      v: 1,
      licenseId: '7',
      organizationId: ORG,
      action: 'incoming_event',
      audience: { allAgents: true },
      payload: { chat_id: 'C1' },
      at: Date.now(),
    };

    subscriber.emit('message', licenseChannel('7'), JSON.stringify(push));
    subscriber.emit('message', licenseChannel('7'), JSON.stringify(envelope));
    subscriber.emit('message', licenseChannel('7'), JSON.stringify(push));

    expect(frames.map((frame) => (JSON.parse(frame) as { action: string }).action)).toEqual([
      'incoming_event',
      'incoming_event',
    ]);
  });
});

describe('Fanout.ensureSubscribed — when the subscription was confirmed (tm 426)', () => {
  it('sends one SUBSCRIBE for logins arriving together and answers them all with the time it was confirmed', async () => {
    const { subscriber, fanout } = setup(0);

    const first = fanout.ensureSubscribed('7');
    const second = fanout.ensureSubscribed('7');
    expect(subscriber.subscribed).toEqual([[licenseChannel('7')]]);

    const before = performance.now();
    subscriber.answer();
    const [one, two] = await Promise.all([first, second]);

    expect(one).toBe(two);
    expect(one).toBeGreaterThanOrEqual(before);
    // Already listening: the same time, no second SUBSCRIBE.
    expect(await fanout.ensureSubscribed('7')).toBe(one);
    expect(subscriber.subscribed).toHaveLength(1);
  });

  it('fails every waiting login when the SUBSCRIBE fails, and subscribes afresh for the next one', async () => {
    const { subscriber, fanout } = setup(0);

    const first = fanout.ensureSubscribed('7');
    const second = fanout.ensureSubscribed('7');
    subscriber.fail();
    await expect(first).rejects.toThrow('Connection is closed.');
    await expect(second).rejects.toThrow('Connection is closed.');

    const third = fanout.ensureSubscribed('7');
    expect(subscriber.subscribed).toHaveLength(2);
    subscriber.answer();
    await expect(third).resolves.toBeTypeOf('number');
  });

  it('counts the subscription as confirmed again only once the resubscribe after an outage is answered', async () => {
    const { subscriber, fanout } = setup(0);
    const pending = fanout.ensureSubscribed('7');
    subscriber.answer();
    const firstConfirmed = await pending;

    subscriber.emit('reconnecting');
    subscriber.emit('ready');
    const beforeAnswer = performance.now();
    subscriber.answer();
    await vi.waitFor(async () => {
      expect(await fanout.ensureSubscribed('7')).toBeGreaterThanOrEqual(beforeAnswer);
    });
    expect(await fanout.ensureSubscribed('7')).toBeGreaterThan(firstConfirmed);
  });
});
