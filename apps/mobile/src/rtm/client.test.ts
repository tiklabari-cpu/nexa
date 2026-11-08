/**
 * The property these tests exist for is the one nobody sees fail: a socket that
 * dropped for four seconds must not cost the agent a customer's message. Every
 * other assertion here is scaffolding around that one.
 */
import { RTM_LIMITS, RTM_PATHS, RTM_VERSION } from '@siyahtus/types';

import {
  CREDENTIAL_CLOSE_CODE,
  MobileRtmClient,
  type AppStateLike,
  type RtmSocket,
} from './client';

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
  onclose: ((event?: { code?: number }) => void) | null = null;
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

  /** The network went away — or, with a code, the gateway closed the socket. */
  drop(code?: number): void {
    this.onclose?.(code === undefined ? undefined : { code });
  }

  login(): Sent | undefined {
    return [...this.sent].reverse().find((message) => message.action === 'login');
  }

  sentActions(): string[] {
    return this.sent.map((message) => message.action);
  }
}

function harness(
  overrides: {
    token?: string | null;
    isSignedOut?: () => boolean;
    /** Replaces the synchronous token read — the app's own answer is async (tm 436). */
    getToken?: () => string | null | Promise<string | null>;
    renewToken?: (stale: string) => Promise<string | null>;
  } = {},
) {
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
    baseUrl: 'wss://rtm.siyahtus.test',
    organizationId: 'org-1',
    getToken: overrides.getToken ?? (() => token),
    ...(overrides.renewToken ? { renewToken: overrides.renewToken } : {}),
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

/** The first backoff window, as the pinned jitter rolls it (0.5 × 500 ms). */
const FIRST_WINDOW_MS = 250;

/** Let promise callbacks run; the timers stay frozen. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
}

/** A promise the test resolves by hand, to hold a token or a renewal mid-flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

    expect(h.latest().url).toBe(`wss://rtm.siyahtus.test${RTM_PATHS.agent}?organization_id=org-1`);
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

describe('an expired or revoked credential (tm 436)', () => {
  it('pins the close code the gateway uses for a credential it stopped honouring', () => {
    // tm 426.1 chose it (revocation) and tm 426.3 reuses it (expiry); a client
    // waiting for any other code would sit offline after either.
    expect(CREDENTIAL_CLOSE_CODE).toBe(4401);
  });

  it('renews once when login is refused for its token, and logs in with the successor', async () => {
    const renewToken = jest.fn(async (_stale: string) => 'renewed-token');
    const h = harness({ token: 'expired-token', renewToken });
    h.client.connect();
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await settle();

    expect(renewToken).toHaveBeenCalledTimes(1);
    expect(renewToken).toHaveBeenCalledWith('expired-token');
    // At once, not after a backoff: nothing is wrong with the gateway.
    expect(h.sockets).toHaveLength(2);
    expect((h.sockets[0] as FakeSocket).closed).toBe(true);
    h.latest().open();
    expect(h.latest().login()?.payload['token']).toBe('Bearer renewed-token');
    h.latest().reply('login', {});
    await settle();
    expect(h.client.status).toBe('live');

    // Not stopped: an ordinary drop afterwards still comes back.
    h.latest().drop();
    jest.advanceTimersByTime(FIRST_WINDOW_MS);
    expect(h.sockets).toHaveLength(3);
  });

  it('stops when the renewed token is refused too — the session is over, not stale', async () => {
    const renewToken = jest.fn(async (_stale: string) => 'renewed-token');
    const h = harness({ renewToken });
    h.client.connect();
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await settle();
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await settle();

    expect(h.client.status).toBe('offline');
    expect(renewToken).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('stops when the renewal answers that the session is over', async () => {
    const h = harness({ renewToken: async () => null });
    h.client.connect();
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await settle();

    expect(h.client.status).toBe('offline');
    jest.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('does not renew for a refusal no new token changes', async () => {
    const renewToken = jest.fn(async (_stale: string) => 'renewed-token');
    const h = harness({ renewToken });
    h.client.connect();
    h.latest().open();
    h.latest().reply('login', { error: { type: 'not_allowed' } }, false);
    await settle();

    expect(renewToken).not.toHaveBeenCalled();
    expect(h.client.status).toBe('offline');
    jest.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('backs off and tries again when the renewal fails on the network', async () => {
    const renewToken = jest
      .fn<Promise<string | null>, [string]>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('renewed-token');
    const h = harness({ renewToken });
    h.client.connect();
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await settle();

    // A tunnel swallowed the refresh; that says nothing about the session.
    expect(h.client.status).toBe('reconnecting');
    expect(h.sockets).toHaveLength(1);
    jest.advanceTimersByTime(FIRST_WINDOW_MS);
    expect(h.sockets).toHaveLength(2);

    // And the renewal is not spent: the next refusal gets one.
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await settle();
    expect(renewToken).toHaveBeenCalledTimes(2);
    expect(h.sockets).toHaveLength(3);
  });

  it('renews once and redials at once when the gateway closes the socket over its credential', async () => {
    const renewToken = jest.fn(async (_stale: string) => 'renewed-token');
    const h = harness({ renewToken });
    await signIn(h);

    h.latest().drop(CREDENTIAL_CLOSE_CODE);
    await settle();

    expect(renewToken).toHaveBeenCalledTimes(1);
    expect(renewToken).toHaveBeenCalledWith('access-token');
    expect(h.sockets).toHaveLength(2);
    h.latest().open();
    const login = h.latest().login();
    expect(login?.payload['token']).toBe('Bearer renewed-token');
    // A live socket was cut: the gateway is told this is a resumption.
    expect(login?.payload['reconnect']).toBe(true);
    h.latest().reply('login', {});
    await settle();
    expect(h.client.status).toBe('live');
  });

  it('stops when the token renewed after a 4401 close is refused as well', async () => {
    const renewToken = jest.fn(async (_stale: string) => 'renewed-token');
    const h = harness({ renewToken });
    await signIn(h);

    h.latest().drop(CREDENTIAL_CLOSE_CODE);
    await settle();
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await settle();

    expect(renewToken).toHaveBeenCalledTimes(1);
    expect(h.client.status).toBe('offline');
    jest.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(2);
  });

  it('stops when the renewal after a 4401 close says the session is over', async () => {
    const h = harness({ renewToken: async () => null });
    await signIn(h);

    h.latest().drop(CREDENTIAL_CLOSE_CODE);
    await settle();

    expect(h.client.status).toBe('offline');
    jest.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(1);
  });

  it('spends one renewal per successful login, so every expiry renews again', async () => {
    let issued = 0;
    const renewToken = jest.fn(async (_stale: string) => `renewed-${++issued}`);
    const h = harness({ renewToken });
    await signIn(h);

    for (let hour = 1; hour <= 3; hour += 1) {
      h.latest().drop(CREDENTIAL_CLOSE_CODE);
      await settle();
      h.latest().open();
      expect(h.latest().login()?.payload['token']).toBe(`Bearer renewed-${hour}`);
      h.latest().reply('login', {});
      await settle();
      expect(h.client.status).toBe('live');
    }
    expect(renewToken).toHaveBeenCalledTimes(3);
  });

  it('leaves an ordinary drop to the backoff — a network failure is not a credential', async () => {
    const renewToken = jest.fn(async (_stale: string) => 'renewed-token');
    const h = harness({ renewToken });
    await signIn(h);

    h.latest().drop(1006);
    await settle();
    expect(h.sockets).toHaveLength(1);
    jest.advanceTimersByTime(FIRST_WINDOW_MS);
    expect(h.sockets).toHaveLength(2);
    expect(renewToken).not.toHaveBeenCalled();
  });

  it('opens nothing when a renewal lands after a deliberate disconnect', async () => {
    const renewal = deferred<string | null>();
    const h = harness({ renewToken: () => renewal.promise });
    await signIn(h);

    h.latest().drop(CREDENTIAL_CLOSE_CODE);
    h.client.disconnect();
    renewal.resolve('renewed-token');
    await settle();
    jest.advanceTimersByTime(60_000);

    expect(h.sockets).toHaveLength(1);
    expect(h.client.status).toBe('offline');
  });

  it('without a renewal on offer, a 4401 close redials and a refused login stops as before', async () => {
    const h = harness();
    await signIn(h);

    h.latest().drop(CREDENTIAL_CLOSE_CODE);
    jest.advanceTimersByTime(FIRST_WINDOW_MS);
    expect(h.sockets).toHaveLength(2);
    h.latest().open();
    h.latest().reply('login', { error: { type: 'authentication' } }, false);
    await settle();

    expect(h.client.status).toBe('offline');
    jest.advanceTimersByTime(60_000);
    expect(h.sockets).toHaveLength(2);
  });
});

describe('an asynchronous token (tm 436)', () => {
  it('dials once the token has been worked out, and with that token', async () => {
    const token = deferred<string | null>();
    const h = harness({ getToken: () => token.promise });
    h.client.connect();
    expect(h.sockets).toHaveLength(0);

    token.resolve('fresh-token');
    await settle();

    expect(h.sockets).toHaveLength(1);
    h.latest().open();
    expect(h.latest().login()?.payload['token']).toBe('Bearer fresh-token');
  });

  it('redials from the foreground with whatever the token has turned into', async () => {
    let calls = 0;
    const h = harness({ getToken: async () => `token-${++calls}` });
    h.client.connect();
    await settle();
    h.latest().open();
    h.latest().reply('login', {});
    await settle();

    h.foreground();
    await settle();

    expect(h.sockets).toHaveLength(2);
    h.latest().open();
    expect(h.latest().login()?.payload['token']).toBe('Bearer token-2');
  });

  it('backs off and asks again when working the token out fails on the network', async () => {
    const getToken = jest
      .fn<Promise<string | null>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue('fresh-token');
    const h = harness({ getToken });
    h.client.connect();
    await settle();
    expect(h.sockets).toHaveLength(0);

    jest.advanceTimersByTime(FIRST_WINDOW_MS);
    await settle();
    expect(getToken).toHaveBeenCalledTimes(2);
    expect(h.sockets).toHaveLength(1);
  });

  it('opens nothing for a token that arrives after a deliberate disconnect', async () => {
    const token = deferred<string | null>();
    const h = harness({ getToken: () => token.promise });
    h.client.connect();
    h.client.disconnect();
    token.resolve('fresh-token');
    await settle();

    expect(h.sockets).toHaveLength(0);
    expect(h.client.status).toBe('offline');
  });

  it('keeps one socket when a newer dial overtakes a token still being worked out', async () => {
    const first = deferred<string | null>();
    const second = deferred<string | null>();
    const answers = [first, second];
    const h = harness({ getToken: () => (answers.shift() as typeof first).promise });
    h.client.connect();
    // Unlocked while the first answer is still out: a second dial starts.
    h.foreground();

    second.resolve('second-token');
    first.resolve('first-token');
    await settle();

    expect(h.sockets).toHaveLength(1);
    h.latest().open();
    expect(h.latest().login()?.payload['token']).toBe('Bearer second-token');
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

  it("syncs on `sync_required` without a reconnect — the gateway's bus dropped, the socket did not (tm 408)", async () => {
    const h = harness();
    await signIn(h);
    const socket = h.latest();
    socket.push('incoming_event', { chat_id: 'chat-1', event: { id: 'THREAD1_4', text: 'seen' } });
    h.pushes.length = 0;

    socket.push('sync_required', { reason: 'bus_reconnected' });
    expect(h.sockets).toHaveLength(1);
    const sync = [...socket.sent].reverse().find((message) => message.action === 'sync');
    expect(sync?.payload['cursors']).toEqual({ 'chat-1': 'THREAD1_4' });
    // Handed on as well, for the list no cursor covers.
    expect(h.pushes).toEqual([{ action: 'sync_required', payload: { reason: 'bus_reconnected' } }]);

    socket.reply('sync', {
      chats: [
        {
          chat_id: 'chat-1',
          thread_id: 'THREAD1',
          events: [{ id: 'THREAD1_5', text: 'lost on the bus' }],
          truncated: false,
        },
      ],
      removed_chat_ids: [],
      new_chat_ids: [],
    });
    await Promise.resolve();
    expect(h.pushes.at(-1)).toEqual({
      action: 'incoming_event',
      payload: { chat_id: 'chat-1', event: { id: 'THREAD1_5', text: 'lost on the bus' } },
    });
    expect(h.client.cursors()).toEqual({ 'chat-1': 'THREAD1_5' });
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
