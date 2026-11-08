/**
 * The socket and the session together, wired the way `InboxProvider` wires
 * them (tm 436): `getToken` is `getFreshAccessToken`, `renewToken` is
 * `renewAccessToken`. The client's own tests prove each branch against a fake
 * renewal; these prove the real session answers those branches the way the
 * client expects — one rotation, the successor on the next login, and a stop
 * that is the session's own sign-out.
 */
import { MobileSession } from '../auth/session';
import { SessionStore, type SecureKeyValueStore } from '../auth/secure-store';
import {
  CREDENTIAL_CLOSE_CODE,
  MobileRtmClient,
  type AppStateLike,
  type RtmSocket,
} from './client';

const API = 'https://api.test/api/v1';
const HOUR_MS = 60 * 60 * 1000;

interface Sent {
  request_id: string;
  action: string;
  payload: Record<string, unknown>;
}

class FakeSocket implements RtmSocket {
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  readonly sent: Sent[] = [];

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Sent);
  }

  close(): void {}

  loginToken(): unknown {
    return this.sent.find((message) => message.action === 'login')?.payload['token'];
  }

  answerLogin(success: boolean): void {
    const request = this.sent.find((message) => message.action === 'login');
    if (request === undefined) throw new Error('No login was sent.');
    this.onmessage?.({
      data: JSON.stringify({
        request_id: request.request_id,
        action: 'login',
        type: 'response',
        success,
        payload: success ? {} : { error: { type: 'authentication' } },
      }),
    });
  }
}

function memoryStore(): SecureKeyValueStore {
  const values = new Map<string, string>();
  return {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
    isAvailable: async () => true,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Real awaits: the session's fetch and store calls settle on the event loop. */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

async function wired() {
  let clock = 1_000_000;
  let issued = 0;
  let refuse = false;
  let rotations = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace(API, '')}`;
    if (key === 'GET /auth/me') {
      return json({
        kind: 'agent',
        account_id: 'acct-1',
        organization_id: 'org-1',
        license_id: '42',
        scopes: [],
      });
    }
    if (key === 'POST /auth/token') {
      rotations += 1;
      if (refuse) {
        return json(
          { error: { type: 'authentication', message: 'refused', request_id: 'r' } },
          401,
        );
      }
      issued += 1;
      return json({
        access_token: `access-${issued}`,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: `refresh-${issued}`,
        scope: '',
        account_id: 'acct-1',
        license_id: '42',
        organization_id: 'org-1',
      });
    }
    throw new Error(`No route for ${key}`);
  }) as unknown as typeof fetch;

  const store = new SessionStore(memoryStore());
  await store.write({
    refreshToken: 'refresh-0',
    clientId: 'siyahtus-agent-app-1',
    licenseId: '42',
    accountId: 'acct-1',
  });
  const session = new MobileSession({
    apiBaseUrl: API,
    store,
    fetchImpl,
    pkce: async () => ({ verifier: 'v'.repeat(64), challenge: 'c'.repeat(43) }),
    createState: async () => 'state-1',
    now: () => clock,
  });
  await session.restore();

  const sockets: FakeSocket[] = [];
  let foreground: ((state: string) => void) | null = null;
  const appState: AppStateLike = {
    addEventListener: (_type, listener) => {
      foreground = listener as (state: string) => void;
      return { remove: () => (foreground = null) };
    },
  };
  const client = new MobileRtmClient({
    baseUrl: 'wss://rtm.siyahtus.test',
    organizationId: 'org-1',
    getToken: () => session.getFreshAccessToken(),
    renewToken: (stale) => session.renewAccessToken(stale),
    isSignedOut: () => session.getState().status === 'signed-out',
    pushes: ['incoming_event'],
    onPush: () => {},
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
    appState,
    random: () => 0.5,
  });

  return {
    session,
    client,
    sockets,
    latest: () => sockets[sockets.length - 1] as FakeSocket,
    rotations: () => rotations,
    advance: (ms: number) => {
      clock += ms;
    },
    refuseRotation: () => {
      refuse = true;
    },
    foreground: () => foreground?.('active'),
  };
}

/** Connect, let the first token be worked out, and log in. */
async function live(w: Awaited<ReturnType<typeof wired>>): Promise<void> {
  w.client.connect();
  await settle();
  w.latest().onopen?.();
  w.latest().answerLogin(true);
  await settle();
  expect(w.client.status).toBe('live');
}

beforeEach(() => {
  // Only the clock-driven timers: the session's fetch and store promises need
  // the real event loop to settle.
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('the inbox socket on the real session (tm 436)', () => {
  it('renews a token that expired in the background before dialling back from the foreground', async () => {
    const w = await wired();
    await live(w);
    expect(w.latest().loginToken()).toBe('Bearer access-1');

    w.advance(2 * HOUR_MS);
    w.foreground();
    await settle();

    expect(w.sockets).toHaveLength(2);
    w.latest().onopen?.();
    expect(w.latest().loginToken()).toBe('Bearer access-2');
    w.latest().answerLogin(true);
    await settle();
    expect(w.client.status).toBe('live');
    expect(w.rotations()).toBe(2); // the launch's, and this one
  });

  it('answers a refused login with one rotation and logs in with its token', async () => {
    const w = await wired();
    w.client.connect();
    await settle();
    w.latest().onopen?.();
    // The clock says access-1 is fresh; the gateway knows better (revoked).
    w.latest().answerLogin(false);
    await settle();

    expect(w.rotations()).toBe(2);
    expect(w.sockets).toHaveLength(2);
    w.latest().onopen?.();
    expect(w.latest().loginToken()).toBe('Bearer access-2');
    w.latest().answerLogin(true);
    await settle();
    expect(w.client.status).toBe('live');
  });

  it('answers a 4401 close with one rotation and a redial, live again', async () => {
    const w = await wired();
    await live(w);

    w.latest().onclose?.({ code: CREDENTIAL_CLOSE_CODE });
    await settle();

    expect(w.rotations()).toBe(2);
    expect(w.sockets).toHaveLength(2);
    w.latest().onopen?.();
    expect(w.latest().loginToken()).toBe('Bearer access-2');
    w.latest().answerLogin(true);
    await settle();
    expect(w.client.status).toBe('live');
  });

  it('stops, signed out, when the rotation after a 4401 close is refused', async () => {
    const w = await wired();
    await live(w);
    w.refuseRotation();

    w.latest().onclose?.({ code: CREDENTIAL_CLOSE_CODE });
    await settle();

    expect(w.session.getState().status).toBe('signed-out');
    expect(w.client.status).toBe('offline');
    jest.advanceTimersByTime(60_000);
    await settle();
    expect(w.sockets).toHaveLength(1);
  });
});
