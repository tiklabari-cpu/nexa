/**
 * The property these tests exist for is the one nobody sees fail: a socket that
 * dropped for four seconds must not cost the agent a customer's message. Every
 * other assertion here is scaffolding around that one.
 */
import { RTM_LIMITS, RTM_PATHS, RTM_VERSION } from '@nexa/types';

import { MobileRtmClient, type AppStateLike, type RtmSocket } from './client';

interface Sent {
  version?: string;
  request_id: string;
  action: string;
  payload: Record<string, unknown>;
}

/** A socket a test drives by hand: it records what was sent and answers back. */
class FakeSocket implements RtmSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  readonly sent: Sent[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Sent);
  }

  close(): void {
    this.closed = true;
  }

  /** Open the connection as the platform would. */
  open(): void {
    this.onopen?.();
  }

  /** Answer the last request with this action. */
  reply(action: string, payload: Record<string, unknown>, success = true): void {
    const request = [...this.sent].reverse().find((message) => message.action === action);
    if (request === undefined) throw new Error(`No "${action}" was sent.`);
    this.onmessage?.({
      data: JSON.stringify({
        request_id: request.request_id,
        action,
        type: 'response',
        success,
        payload,
      }),
    });
  }

  push(action: string, payload: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify({ action, type: 'push', payload }) });
  }

  /** The network went away. */
  drop(): void {
    this.onclose?.();
  }

  sentActions(): string[] {
    return this.sent.map((message) => message.action);
  }
}

function harness(overrides: { token?: string | null; isSignedOut?: () => boolean } = {}) {
  // Mutable, because the interesting case is a token that arrives *later*: a
  // renewal in flight is the ordinary reason `getAccessToken()` is null.
  let token: string | null = overrides.token === undefined ? 'access-token' : overrides.token;
  const sockets: FakeSocket[] = [];
  const pushes: Array<{ action: string; payload: Record<string, unknown> }> = [];
  const statuses: string[] = [];
  let appStateListener: ((state: string) => void) | null = null;

  const appState: AppStateLike = {
    addEventListener: (_type, listener) => {
      appStateListener = listener as (state: string) => void;
      return { remove: () => (appStateListener = null) };
    },
  };

  const client = new MobileRtmClient({
    baseUrl: 'wss://rtm.nexa.test',
    organizationId: 'org-1',
    getToken: () => token,
    ...(overrides.isSignedOut ? { isSignedOut: overrides.isSignedOut } : {}),
    pushes: ['incoming_event'],
    onPush: (action, payload) => pushes.push({ action, payload }),
    onStatusChange: (status) => statuses.push(status),
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    appState,
    // Pin the jitter: the property under test is that a retry happens, not how
    // long the dice said to wait.
    random: () => 0.5,
  });

  return {
    client,
    sockets,
    pushes,
    statuses,
    latest: () => sockets[sockets.length - 1] as FakeSocket,
    foreground: () => appStateListener?.('active'),
    hasAppStateListener: () => appStateListener !== null,
    setToken: (next: string | null) => {
      token = next;
    },
  };
}

/** Connect and complete a successful login, leaving the client live. */
async function signIn(h: ReturnType<typeof harness>): Promise<void> {
  h.client.connect();
  h.latest().open();
  h.latest().reply('login', {});
  await Promise.resolve();
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('connecting', () => {
  it('dials the gateway path from the configured host, not a hand-copied URL', async () => {
    const h = harness();
    await signIn(h);

    expect(h.latest().url).toBe(`wss://rtm.nexa.test${RTM_PATHS.agent}?organization_id=org-1`);
  });

  it('logs in with the version-keyed push subscription ADR-15 specifies', async () => {
    const h = harness();
    await signIn(h);

    const login = h.latest().sent.find((message) => message.action === 'login');
    expect(login?.version).toBe(RTM_VERSION);
    expect(login?.payload['token']).toBe('Bearer access-token');
    expect(login?.payload['pushes']).toEqual({ [RTM_VERSION]: ['incoming_event'] });
    // A first attempt is not a resumption; the gateway is told which it is.
    expect(login?.payload['reconnect']).toBe(false);
    expect(h.statuses).toEqual(['connecting', 'live']);
  });

  it('opens no socket at all without a credential', () => {
    const h = harness({ token: null });
    h.client.connect();

    expect(h.sockets).toHaveLength(0);
    expect(h.client.status).toBe('offline');
  });

  it('keeps waiting for a token instead of sitting closed until something pokes it', () => {
    // The ordinary way this happens: a renewal is in flight, so the token is
    // null for a few hundred milliseconds. Returning quietly used to leave the
    // socket closed with nothing scheduled — on a phone held in the foreground,
    // no app-state change ever arrives to reopen it, and messages just stop.
    const h = harness({ token: null });
    h.client.connect();
    expect(h.sockets).toHaveLength(0);

    h.setToken('renewed-token');
    jest.advanceTimersByTime(250); // 0.5 × the first 500ms backoff window

    expect(h.sockets).toHaveLength(1);
    h.latest().open();
    expect(h.latest().sent.find((message) => message.action === 'login')?.payload['token']).toBe(
      'Bearer renewed-token',
    );
  });

  it('stops waiting for a token once the session is over', () => {
    // There is no renewal coming. Retrying forever would be a wakeup every
    // fifteen seconds for a door that is closed on purpose.
    const h = harness({ token: null, isSignedOut: () => true });
    h.client.connect();

    jest.advanceTimersByTime(60_000);

    expect(h.sockets).toHaveLength(0);
    expect(h.client.status).toBe('offline');
  });

  it('stops trying when the gateway refuses the credential', async () => {
    const h = harness();
    h.client.connect();
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await Promise.resolve();

    expect(h.client.status).toBe('offline');
    // A wrong token is not a transient failure — retrying is a loop the session
    // layer has to break, not the socket.
    jest.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
  });
});

describe('reconnect', () => {
  it('comes back after a drop, and says so while it is away', async () => {
    const h = harness();
    await signIn(h);

    h.latest().drop();
    expect(h.client.status).toBe('reconnecting');

    jest.advanceTimersByTime(RTM_LIMITS.pingIntervalMs);
    expect(h.sockets).toHaveLength(2);

    h.latest().open();
    const login = h.latest().sent.find((message) => message.action === 'login');
    // The gateway is told this is a resumption, which is what it is.
    expect(login?.payload['reconnect']).toBe(true);
  });

  it('backs off further on each failure instead of hammering the gateway', async () => {
    const h = harness();
    await signIn(h);

    h.latest().drop();
    jest.advanceTimersByTime(250); // 0.5 × 500ms
    expect(h.sockets).toHaveLength(2);

    h.latest().drop();
    jest.advanceTimersByTime(250);
    // The second window is 0.5 × 1000ms, so 250ms is not yet enough.
    expect(h.sockets).toHaveLength(2);
    jest.advanceTimersByTime(250);
    expect(h.sockets).toHaveLength(3);
  });

  it('does not reconnect after a deliberate disconnect', async () => {
    const h = harness();
    await signIn(h);

    h.client.disconnect();
    jest.advanceTimersByTime(60_000);

    expect(h.sockets).toHaveLength(1);
    expect(h.client.status).toBe('offline');
    expect(h.hasAppStateListener()).toBe(false);
  });

  it('redials the moment the app is unlocked rather than waiting out a ping', async () => {
    const h = harness();
    await signIn(h);

    // The OS froze this process; whatever the socket believes is stale.
    h.foreground();

    expect(h.sockets).toHaveLength(2);
    expect((h.sockets[0] as FakeSocket).closed).toBe(true);
  });
});

describe('missed-event sync', () => {
  it('replays everything sent while the socket was down, exactly once', async () => {
    const h = harness();
    await signIn(h);

    // The agent read up to event 4 before the connection died.
    h.latest().push('incoming_event', {
      chat_id: 'chat-1',
      event: { id: 'THREAD1_4', text: 'seen' },
    });
    h.pushes.length = 0;

    h.latest().drop();
    jest.advanceTimersByTime(250);
    h.latest().open();
    h.latest().reply('login', {});
    await Promise.resolve();

    const sync = h.latest().sent.find((message) => message.action === 'sync');
    expect(sync?.payload['cursors']).toEqual({ 'chat-1': 'THREAD1_4' });

    h.latest().reply('sync', {
      chats: [
        {
          chat_id: 'chat-1',
          thread_id: 'THREAD1',
          events: [
            { id: 'THREAD1_5', text: 'missed one' },
            { id: 'THREAD1_6', text: 'missed two' },
          ],
          truncated: false,
        },
      ],
      removed_chat_ids: [],
      new_chat_ids: [],
    });
    await Promise.resolve();

    // Replayed events arrive as ordinary events: one definition of "an event
    // arrived", whichever way it came in.
    expect(h.pushes).toEqual([
      { action: 'incoming_event', payload: { chat_id: 'chat-1', event: expect.anything() } },
      { action: 'incoming_event', payload: { chat_id: 'chat-1', event: expect.anything() } },
    ]);
    expect(h.pushes.map((p) => (p.payload['event'] as { text: string }).text)).toEqual([
      'missed one',
      'missed two',
    ]);
    // And the cursor has moved on, so a second drop does not replay them again.
    expect(h.client.cursors()).toEqual({ 'chat-1': 'THREAD1_6' });
  });

  it('asks for nothing when it has never seen an event', async () => {
    const h = harness();
    await signIn(h);
    h.latest().drop();
    jest.advanceTimersByTime(250);
    h.latest().open();
    h.latest().reply('login', {});
    await Promise.resolve();

    // No cursors means no position to resume from; a sync would ask the gateway
    // to decide what "missed" means, and it cannot.
    expect(h.latest().sentActions()).not.toContain('sync');
  });

  it('says the gap was too large rather than leaving an invisible hole', async () => {
    const h = harness();
    await signIn(h);
    h.client.noteEvent('chat-1', 'THREAD1_1');
    h.latest().drop();
    jest.advanceTimersByTime(250);
    h.latest().open();
    h.latest().reply('login', {});
    await Promise.resolve();

    h.latest().reply('sync', {
      chats: [{ chat_id: 'chat-1', thread_id: 'THREAD1', events: [], truncated: true }],
      removed_chat_ids: [],
      new_chat_ids: [],
    });
    await Promise.resolve();

    expect(h.pushes).toContainEqual({ action: 'sync_truncated', payload: { chat_id: 'chat-1' } });
  });

  it('reports chats gained and lost while it was away', async () => {
    const h = harness();
    await signIn(h);
    h.client.noteEvent('chat-gone', 'THREAD9_3');
    h.latest().drop();
    jest.advanceTimersByTime(250);
    h.latest().open();
    h.latest().reply('login', {});
    await Promise.resolve();

    h.latest().reply('sync', {
      chats: [],
      removed_chat_ids: ['chat-gone'],
      new_chat_ids: ['chat-new'],
    });
    await Promise.resolve();

    expect(h.pushes).toContainEqual({
      action: 'chat_unfollowed',
      payload: { chat_id: 'chat-gone' },
    });
    expect(h.pushes).toContainEqual({ action: 'chat_appeared', payload: { chat_id: 'chat-new' } });
    // A chat we can no longer see has no position worth remembering.
    expect(h.client.cursors()).toEqual({});
  });

  it('settles a sync that never comes back instead of hanging the reconnect', async () => {
    const h = harness();
    await signIn(h);
    h.client.noteEvent('chat-1', 'THREAD1_1');
    h.latest().drop();
    jest.advanceTimersByTime(250);
    h.latest().open();
    h.latest().reply('login', {});
    await Promise.resolve();

    // The gateway accepted the request and went quiet. Without the deadline the
    // client would sit in `live` with a promise nobody resolves.
    jest.advanceTimersByTime(RTM_LIMITS.requestTimeoutMs);
    await Promise.resolve();
    expect(h.client.status).toBe('live');
    expect(h.pushes).toEqual([]);
  });
});

describe('cursors', () => {
  it('never rewinds within a thread, however the ids sort as strings', async () => {
    const h = harness();
    await signIn(h);

    h.client.noteEvent('chat-1', 'THREAD1_10');
    // `_2` sorts before `_10` lexically. Taking it would replay eight events.
    h.client.noteEvent('chat-1', 'THREAD1_2');
    expect(h.client.cursors()).toEqual({ 'chat-1': 'THREAD1_10' });

    h.client.noteEvent('chat-1', 'THREAD1_11');
    expect(h.client.cursors()).toEqual({ 'chat-1': 'THREAD1_11' });
  });

  it('takes a new thread, because the old position means nothing there', async () => {
    const h = harness();
    await signIn(h);

    h.client.noteEvent('chat-1', 'THREAD1_9');
    // The conversation was reopened: a new thread, its own sequence from 1.
    h.client.noteEvent('chat-1', 'THREAD2_1');
    expect(h.client.cursors()).toEqual({ 'chat-1': 'THREAD2_1' });
  });
});

describe('typing', () => {
  it('sends the indicator only while the socket is live', async () => {
    const h = harness();
    await signIn(h);

    h.client.sendTyping('chat-1', true);
    expect(h.latest().sentActions()).toContain('send_typing_indicator');

    const before = h.latest().sent.length;
    h.latest().drop();
    // Queuing this across a reconnect would deliver a stale "is typing" the
    // moment the socket returns.
    h.client.sendTyping('chat-1', true);
    expect(h.latest().sent).toHaveLength(before);
  });
});
