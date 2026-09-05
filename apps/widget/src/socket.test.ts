/**
 * The widget's RTM socket client (FR-MOD-11.6).
 *
 * Driven against a stand-in WebSocket rather than a real one: everything under
 * test here is what this file does with the *frames* — the login handshake, the
 * cursor it resumes from, what it refuses to hand upwards. A real socket would
 * add a server to the test without adding an assertion; the gateway's own half
 * is proven against a real one in `apps/rtm/test/integration/customer-socket.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetSocket, type WidgetWebSocket } from './socket.js';
import type { WidgetEvent } from './api.js';

interface SentFrame {
  request_id: string;
  action: string;
  payload: Record<string, unknown>;
  version: string;
}

class FakeSocket implements WidgetWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: SentFrame[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as SentFrame);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }

  /** Answer the request with the given action, as the gateway would. */
  reply(action: string, payload: Record<string, unknown> = {}, success = true): void {
    const request = this.sent.find((frame) => frame.action === action);
    if (!request) throw new Error(`no ${action} request was sent`);
    this.deliver({ request_id: request.request_id, action, type: 'response', success, payload });
  }

  push(action: string, payload: Record<string, unknown>): void {
    this.deliver({ action, type: 'push', payload });
  }

  deliver(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

function event(id: string, overrides: Partial<WidgetEvent> = {}): Record<string, unknown> {
  return {
    id,
    text: `text ${id}`,
    author_type: 'agent',
    created_at: '2026-09-06T10:00:00.000Z',
    type: 'message',
    attachment_url: null,
    ...overrides,
  };
}

interface Harness {
  socket: WidgetSocket;
  sockets: FakeSocket[];
  events: Array<{ chatId: string; event: WidgetEvent }>;
  closed: string[];
  resyncs: number;
  statuses: boolean[];
  urls: string[];
}

function harness(options: { token?: string | null } = {}): Harness {
  const sockets: FakeSocket[] = [];
  const urls: string[] = [];
  const events: Array<{ chatId: string; event: WidgetEvent }> = [];
  const closed: string[] = [];
  const statuses: boolean[] = [];
  let resyncs = 0;

  const socket = new WidgetSocket({
    url: 'ws://rtm.test/v1/customer/rtm/ws',
    organizationId: 'org-1',
    getToken: () => (options.token === undefined ? 'nxc1.body.sig' : options.token),
    onEvent: (chatId, e) => events.push({ chatId, event: e }),
    onChatClosed: (chatId) => closed.push(chatId),
    onResync: () => {
      resyncs += 1;
    },
    onStatusChange: (live) => statuses.push(live),
    createSocket: (url) => {
      urls.push(url);
      const fake = new FakeSocket();
      sockets.push(fake);
      return fake;
    },
  });

  return {
    socket,
    sockets,
    events,
    closed,
    statuses,
    urls,
    get resyncs() {
      return resyncs;
    },
  } as Harness;
}

/** Drain the promise chain `login` runs through, without touching the clock. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('widget RTM socket (FR-MOD-11.6)', () => {
  it('logs in with the customer token and subscribes to nothing wider than its own events', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();

    expect(h.urls[0]).toBe('ws://rtm.test/v1/customer/rtm/ws?organization_id=org-1');
    const login = h.sockets[0]!.sent[0]!;
    expect(login.action).toBe('login');
    expect(login.version).toBe('3.6');
    expect(login.payload['token']).toBe('nxc1.body.sig');
    // The whole subscription surface: push *kinds*, and the credential. A chat
    // id, a team or a `chats--all` scope has no place in it — the gateway
    // addresses this socket by the customer id inside the signed token and by
    // nothing the client asks for, so there is nothing here to ask wrongly.
    expect(login.payload['pushes']).toEqual({ '3.6': ['incoming_event', 'chat_deactivated'] });
    expect(Object.keys(login.payload).sort()).toEqual(['pushes', 'token']);
  });

  it('goes live only once login succeeds, and hands pushed events upwards', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();

    expect(h.socket.live).toBe(false);
    h.sockets[0]!.reply('login', { my_profile: { kind: 'customer' } });
    await settle();
    expect(h.socket.live).toBe(true);
    expect(h.statuses).toEqual([true]);

    h.sockets[0]!.push('incoming_event', { chat_id: 'chat-1', event: event('thr-1_2') });
    expect(h.events).toEqual([
      { chatId: 'chat-1', event: expect.objectContaining({ id: 'thr-1_2', text: 'text thr-1_2' }) },
    ]);
  });

  it('resumes from the cursor the poll left, and replays the gap as ordinary events', async () => {
    const h = harness();
    h.socket.connect();
    // What the poll saw before the socket came up. Without this the reconnect
    // would replay the whole thread the visitor is already looking at.
    h.socket.noteEvent('chat-1', 'thr-1_4');
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();

    const sync = h.sockets[0]!.sent.find((frame) => frame.action === 'sync')!;
    expect(sync.payload['cursors']).toEqual({ 'chat-1': 'thr-1_4' });
    // Not live until the gap is filled: telling the caller "live" first would
    // let it slow the poll that is the only thing covering the hole.
    expect(h.socket.live).toBe(false);

    h.sockets[0]!.reply('sync', {
      chats: [
        { chat_id: 'chat-1', events: [event('thr-1_5'), event('thr-1_6')], truncated: false },
      ],
      removed_chat_ids: [],
      new_chat_ids: [],
    });
    await settle();

    expect(h.events.map((e) => e.event.id)).toEqual(['thr-1_5', 'thr-1_6']);
    expect(h.socket.live).toBe(true);
  });

  it('skips sync on a first connection — there is no gap to fill', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();

    expect(h.sockets[0]!.sent.map((f) => f.action)).toEqual(['login']);
    expect(h.socket.live).toBe(true);
  });

  it('never names an optimistic bubble as a cursor', async () => {
    const h = harness();
    h.socket.connect();
    // The id of a bubble that only ever existed in the browser. Sent as a
    // cursor it names an event in no thread, and the gateway answers by
    // declaring the whole chat truncated — a full refetch on every reconnect.
    h.socket.noteEvent('chat-1', 'pending-1757145600000');
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();

    expect(h.sockets[0]!.sent.map((f) => f.action)).toEqual(['login']);
  });

  it('asks for a refetch when the gap was too wide to replay', async () => {
    const h = harness();
    h.socket.connect();
    h.socket.noteEvent('chat-1', 'thr-1_1');
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();
    h.sockets[0]!.reply('sync', {
      chats: [{ chat_id: 'chat-1', events: [], truncated: true }],
    });
    await settle();

    expect(h.resyncs).toBe(1);
  });

  it('reports a conversation that ended while the socket was down', async () => {
    const h = harness();
    h.socket.connect();
    h.socket.noteEvent('chat-1', 'thr-1_1');
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();
    h.sockets[0]!.reply('sync', { chats: [], removed_chat_ids: ['chat-1'], new_chat_ids: [] });
    await settle();

    expect(h.closed).toEqual(['chat-1']);
  });

  it('reports a live deactivation and stops replaying that chat', async () => {
    const h = harness();
    h.socket.connect();
    h.socket.noteEvent('chat-1', 'thr-1_3');
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();
    h.sockets[0]!.reply('sync', { chats: [] });
    await settle();

    h.sockets[0]!.push('chat_deactivated', { chat_id: 'chat-1' });
    expect(h.closed).toEqual(['chat-1']);

    // Dropped from the cursor map, so the next reconnect does not ask about a
    // conversation that is over.
    h.sockets[0]!.close();
    await vi.advanceTimersByTimeAsync(1_000);
    h.sockets[1]!.onopen!();
    await settle();
    h.sockets[1]!.reply('login', {});
    await settle();
    expect(h.sockets[1]!.sent.map((f) => f.action)).toEqual(['login']);
  });

  it('refuses to surface an event addressed to agents', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();

    // A reply the visitor is meant to see. The API stamps it `all`, and the
    // gateway forwards it — the baseline this test measures the refusal against.
    h.sockets[0]!.push('incoming_event', {
      chat_id: 'chat-1',
      event: { ...event('thr-1_9', { text: 'for the visitor' }), recipients: 'all' },
    });
    expect(h.events).toHaveLength(1);

    // The API addresses an internal note to teams and never to the customer, so
    // this frame should not exist. The widget refuses to render one anyway —
    // this is the last gate before workspace-private text reaches a visitor's
    // screen, and it costs one comparison.
    h.sockets[0]!.push('incoming_event', {
      chat_id: 'chat-1',
      event: { ...event('thr-1_10', { text: 'INTERNAL-ONLY' }), recipients: 'agents' },
    });
    expect(h.events).toHaveLength(1);
    expect(JSON.stringify(h.events)).not.toContain('INTERNAL-ONLY');
  });

  it('drops malformed frames rather than passing junk to the DOM', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();

    h.sockets[0]!.onmessage!({ data: 'not json' });
    h.sockets[0]!.push('incoming_event', { chat_id: 'chat-1' });
    h.sockets[0]!.push('incoming_event', { chat_id: 'chat-1', event: { id: 42 } });
    h.sockets[0]!.push('incoming_event', { event: event('thr-1_1') });
    h.sockets[0]!.push('agent_conflict_warning', { chat_id: 'chat-1' });
    expect(h.events).toHaveLength(0);
    expect(h.closed).toHaveLength(0);

    // A text field of the wrong type becomes null rather than reaching
    // `textContent` as `[object Object]`.
    h.sockets[0]!.push('incoming_event', {
      chat_id: 'chat-1',
      event: { id: 'thr-1_2', text: { evil: true }, author_type: 'nobody' },
    });
    expect(h.events[0]!.event).toMatchObject({ text: null, author_type: 'system' });
  });

  it('falls back and reconnects after a drop, with a bounded backoff', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();
    expect(h.socket.live).toBe(true);

    h.sockets[0]!.close();
    // The caller learns at once that it is on its own again — the poll it slowed
    // down has to speed back up before the visitor notices anything.
    expect(h.socket.live).toBe(false);
    expect(h.statuses).toEqual([true, false]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.onopen!();
    await settle();
    h.sockets[1]!.reply('login', {});
    await settle();
    expect(h.socket.live).toBe(true);
  });

  it('backs off rather than hammering when login is refused', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();
    // An expired token. Retrying instantly would loop against a door that is not
    // going to open; the poll running alongside is what re-mints.
    h.sockets[0]!.reply('login', { error: { type: 'authentication' } }, false);
    await settle();

    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.socket.live).toBe(false);
    expect(h.sockets).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('waits for a token instead of opening a socket that could only fail', async () => {
    const sockets: FakeSocket[] = [];
    // No credential yet: `connect` runs from `mint`'s success path, but the
    // token is also dropped and re-minted whenever the poll meets a 401.
    let token: string | null = null;
    const socket = new WidgetSocket({
      url: 'ws://rtm.test/v1/customer/rtm/ws',
      organizationId: 'org-1',
      getToken: () => token,
      onEvent: () => {},
      onChatClosed: () => {},
      onResync: () => {},
      onStatusChange: () => {},
      createSocket: () => {
        const fake = new FakeSocket();
        sockets.push(fake);
        return fake;
      },
    });

    socket.connect();
    // Nothing dialled — an upgrade with no credential can only be refused, and
    // a refused login is what schedules the *next* backoff.
    expect(sockets).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets).toHaveLength(0);

    // The poll's own re-mint lands; the next attempt picks it up with nothing
    // else having to notice.
    token = 'nxc1.body.sig';
    await vi.advanceTimersByTimeAsync(30_000);
    expect(sockets).toHaveLength(1);
    socket.close();
  });

  it('stays on the polling path when the browser will not open a socket at all', async () => {
    const socket = new WidgetSocket({
      url: 'ws://rtm.test/v1/customer/rtm/ws',
      organizationId: 'org-1',
      getToken: () => 'nxc1.body.sig',
      onEvent: () => {},
      onChatClosed: () => {},
      onResync: () => {},
      onStatusChange: () => {},
      // A Content-Security-Policy without the gateway's origin, a proxy that
      // refuses the upgrade, or a browser with no WebSocket — all arrive here.
      createSocket: () => {
        throw new Error('blocked');
      },
    });

    expect(() => socket.connect()).not.toThrow();
    expect(socket.live).toBe(false);
    socket.close();
  });

  it('pings inside the gateway’s idle window', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();

    // The gateway closes an idle socket at 30 s (`RTM_LIMITS.idleTimeoutMs`), so
    // a live one has to speak before then or it is dropped every half minute.
    await vi.advanceTimersByTimeAsync(16_000);
    expect(h.sockets[0]!.sent.some((f) => f.action === 'ping')).toBe(true);
  });

  it('stops for good when closed, and schedules no further attempts', async () => {
    const h = harness();
    h.socket.connect();
    h.sockets[0]!.onopen!();
    await settle();
    h.sockets[0]!.reply('login', {});
    await settle();

    h.socket.close();
    expect(h.sockets[0]!.closed).toBe(true);
    expect(h.socket.live).toBe(false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sockets).toHaveLength(1);
  });
});
