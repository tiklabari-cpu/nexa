/**
 * The session, driven against a fake server.
 *
 * `fetch` is the seam rather than the API client: that way the assertions are
 * about what actually goes over the wire — which grant type, which redirect URI,
 * whether the verifier appears before the exchange — instead of about which
 * method was called. Everything a device would provide (secure store, browser,
 * push token) is injected, so no native module is loaded here.
 */
import { MOBILE_REDIRECT_URI } from '@nexa/types';

import { DeviceTokenLifecycle } from './device-token';
import { MobileSession, SsoRequiredError, type AuthBrowser } from './session';
import { SessionStore, type SecureKeyValueStore } from './secure-store';

const API = 'https://api.test/api/v1';

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | null;
  headers: Record<string, string>;
}

/** A `fetch` that answers from a routing table and records everything. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const impl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });

    const key = `${init?.method ?? 'GET'} ${url.replace(API, '')}`;
    const route = routes[key];
    if (!route) throw new Error(`No route for ${key}`);
    return route();
  }) as unknown as typeof fetch;

  return { impl, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function apiError(status: number, type: string, details?: Record<string, unknown>): Response {
  return json(
    {
      error: { type, message: `${type} refused`, request_id: 'req-1', ...(details && { details }) },
    },
    status,
  );
}

function memoryStore(): { store: SecureKeyValueStore; values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    store: {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => {
        values.set(key, value);
      },
      removeItem: async (key) => {
        values.delete(key);
      },
      isAvailable: async () => true,
    },
  };
}

const PKCE = { verifier: 'v'.repeat(64), challenge: 'c'.repeat(43) };

const GRANT = {
  access_token: 'access-1',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh-1',
  scope: 'chats--all:rw',
  account_id: 'acct-1',
  license_id: '42',
  organization_id: 'org-1',
};

const ME = {
  kind: 'agent',
  account_id: 'acct-1',
  organization_id: 'org-1',
  license_id: '42',
  scopes: ['chats--all:rw'],
  role: 'agent',
};

function build(
  routes: Record<string, () => Response | Promise<Response>>,
  // `store` is here for the tests that have to build a `DeviceTokenLifecycle`
  // first: the lifecycle needs a store, and the session has to be reading the
  // same one for a persisted session to be visible to both.
  extra: { browser?: AuthBrowser; deviceTokens?: DeviceTokenLifecycle; store?: SessionStore } = {},
) {
  const { store, values } = memoryStore();
  const sessionStore = extra.store ?? new SessionStore(store);
  const { impl, calls } = fakeFetch(routes);
  const session = new MobileSession({
    apiBaseUrl: API,
    store: sessionStore,
    fetchImpl: impl,
    pkce: async () => PKCE,
    createState: async () => 'state-1',
    ...extra,
  });
  return { session, sessionStore, calls, values };
}

const SIGN_IN_ROUTES = {
  'POST /auth/authorize': () =>
    json({ code: 'code-1', redirect_uri: MOBILE_REDIRECT_URI, expires_in: 60 }),
  'POST /auth/token': () => json(GRANT),
  'GET /auth/me': () => json(ME),
};

const CREDENTIALS = {
  email: 'agent@nexa.test',
  password: 'hunter2',
  licenseId: '42',
  clientId: 'nexa-agent-app-1',
};

describe('signIn', () => {
  it('sends the challenge to authorize and the verifier only to the exchange', async () => {
    const { session, calls } = build(SIGN_IN_ROUTES);

    await session.signIn(CREDENTIALS);

    const authorize = calls.find((c) => c.url.endsWith('/auth/authorize'))!;
    expect(authorize.body).toMatchObject({
      code_challenge: PKCE.challenge,
      code_challenge_method: 'S256',
      redirect_uri: MOBILE_REDIRECT_URI,
    });
    // The secret must not travel with the request that has not earned it yet.
    expect(JSON.stringify(authorize.body)).not.toContain(PKCE.verifier);

    const exchange = calls.find((c) => c.url.endsWith('/auth/token'))!;
    expect(exchange.body).toMatchObject({
      grant_type: 'authorization_code',
      code: 'code-1',
      code_verifier: PKCE.verifier,
      redirect_uri: MOBILE_REDIRECT_URI,
    });
  });

  it('keeps the access token in memory and only the refresh token on the device', async () => {
    const { session, values } = build(SIGN_IN_ROUTES);

    await session.signIn(CREDENTIALS);

    expect(session.getState()).toMatchObject({ status: 'signed-in', accessToken: 'access-1' });

    const stored = [...values.values()].join('\n');
    expect(stored).toContain('refresh-1');
    expect(stored).not.toContain('access-1');
  });

  it('names the connection when the workspace has closed its password door', async () => {
    const { session } = build({
      ...SIGN_IN_ROUTES,
      'POST /auth/authorize': () => apiError(403, 'not_allowed', { sso_connection_id: 'conn-9' }),
    });

    await expect(session.signIn(CREDENTIALS)).rejects.toMatchObject({
      name: 'SsoRequiredError',
      connectionId: 'conn-9',
    });
  });

  it('leaves an ordinary refusal alone', async () => {
    const { session } = build({
      ...SIGN_IN_ROUTES,
      'POST /auth/authorize': () => apiError(401, 'authentication'),
    });

    await expect(session.signIn(CREDENTIALS)).rejects.not.toBeInstanceOf(SsoRequiredError);
    expect(session.getState().status).toBe('unknown');
  });

  it('registers the device token once the session exists', async () => {
    const { store } = memoryStore();
    const sessionStore = new SessionStore(store);
    const register = jest.fn(async () => undefined);
    const deviceTokens = new DeviceTokenLifecycle({
      store: sessionStore,
      provider: { getToken: async () => 'dev-1' },
      transport: { register, revoke: jest.fn(async () => undefined) },
    });

    const { session } = build(SIGN_IN_ROUTES, { deviceTokens });
    await session.signIn(CREDENTIALS);

    expect(register).toHaveBeenCalledWith({ token: 'dev-1', accessToken: 'access-1' });
  });
});

describe('signInWithSso', () => {
  const browserFor = (callback: string | null): AuthBrowser => ({
    open: jest.fn(async () => callback),
  });

  it('hands the identity provider to the system browser and redeems what comes back', async () => {
    const browser = browserFor(`${MOBILE_REDIRECT_URI}?code=code-1&state=state-1`);
    const { session, calls } = build(SIGN_IN_ROUTES, { browser });

    await session.signInWithSso({ connectionId: 'conn-9', clientId: 'nexa-agent-app-1' });

    const [url, redirect] = (browser.open as jest.Mock).mock.calls[0]!;
    expect(url).toContain(`${API}/auth/saml/conn-9/login?`);
    expect(url).toContain(`redirect_uri=${encodeURIComponent(MOBILE_REDIRECT_URI)}`);
    expect(url).toContain(`code_challenge=${PKCE.challenge}`);
    expect(redirect).toBe(MOBILE_REDIRECT_URI);

    expect(session.getState().status).toBe('signed-in');
    expect(calls.find((c) => c.url.endsWith('/auth/token'))!.body).toMatchObject({
      code_verifier: PKCE.verifier,
    });
  });

  it('refuses a callback that carries a state this app did not issue', async () => {
    const browser = browserFor(`${MOBILE_REDIRECT_URI}?code=code-1&state=somebody-else`);
    const { session, calls } = build(SIGN_IN_ROUTES, { browser });

    await expect(
      session.signInWithSso({ connectionId: 'conn-9', clientId: 'nexa-agent-app-1' }),
    ).rejects.toThrow(/did not start in this app/);
    // Refused before the code is spent, so a forged callback costs no round trip.
    expect(calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(0);
    expect(session.getState().status).toBe('unknown');
  });

  it('treats a dismissed browser sheet as a cancellation, not a failure to explain', async () => {
    const { session } = build(SIGN_IN_ROUTES, { browser: browserFor(null) });

    await expect(
      session.signInWithSso({ connectionId: 'conn-9', clientId: 'nexa-agent-app-1' }),
    ).rejects.toThrow(/cancelled/);
  });
});

describe('restore', () => {
  it('rotates the stored refresh token and persists the successor', async () => {
    const { session, sessionStore, calls } = build({
      'POST /auth/token': () =>
        json({ ...GRANT, access_token: 'access-2', refresh_token: 'refresh-2' }),
      'GET /auth/me': () => json(ME),
    });
    await sessionStore.write({
      refreshToken: 'refresh-1',
      clientId: 'nexa-agent-app-1',
      licenseId: '42',
      accountId: 'acct-1',
    });

    await session.restore();

    expect(calls.find((c) => c.url.endsWith('/auth/token'))!.body).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-1',
    });
    expect(session.getState()).toMatchObject({ status: 'signed-in', accessToken: 'access-2' });
    expect((await sessionStore.read())!.refreshToken).toBe('refresh-2');
  });

  it('starts signed out when the device holds nothing', async () => {
    const { session, calls } = build({});

    await session.restore();

    expect(session.getState().status).toBe('signed-out');
    expect(calls).toHaveLength(0);
  });

  it('drops the session when the stored refresh token has been revoked', async () => {
    const { session, sessionStore } = build({
      'POST /auth/token': () => apiError(401, 'authentication'),
    });
    await sessionStore.write({
      refreshToken: 'revoked',
      clientId: 'nexa-agent-app-1',
      licenseId: '42',
      accountId: 'acct-1',
    });

    await session.restore();

    expect(session.getState()).toEqual({
      status: 'signed-out',
      accessToken: null,
      principal: null,
    });
    // Dropped locally too: retrying a revoked token every launch is a loop.
    expect(await sessionStore.read()).toBeNull();
  });

  it('does not end a session because the network was unreachable', async () => {
    const { session, sessionStore } = build({
      'POST /auth/token': () => {
        throw new TypeError('Network request failed');
      },
    });
    await sessionStore.write({
      refreshToken: 'refresh-1',
      clientId: 'nexa-agent-app-1',
      licenseId: '42',
      accountId: 'acct-1',
    });

    await expect(session.restore()).rejects.toMatchObject({ type: 'network' });
    expect((await sessionStore.read())!.refreshToken).toBe('refresh-1');
  });

  it('re-registers the handset on every launch, not only at sign-in (13.7-l)', async () => {
    const { store } = memoryStore();
    const sessionStore = new SessionStore(store);
    const register = jest.fn(async () => undefined);
    const deviceTokens = new DeviceTokenLifecycle({
      store: sessionStore,
      provider: { getToken: async () => 'apns-1' },
      transport: { register, revoke: jest.fn(async () => undefined) },
    });
    const { session } = build(
      {
        'POST /auth/token': () => json({ ...GRANT, access_token: 'access-2' }),
        'GET /auth/me': () => json(ME),
      },
      { deviceTokens, store: sessionStore },
    );
    await sessionStore.write({
      refreshToken: 'refresh-1',
      clientId: 'nexa-agent-app-1',
      licenseId: '42',
      accountId: 'acct-1',
    });

    await session.restore();

    // Somebody who stays signed in for a month never passes through `#redeem`
    // again, while the operating system may hand out a new APNs/FCM address at
    // any point in that month. Registering only at sign-in means push stops and
    // nothing says so. The credential is the one this launch just minted.
    expect(register).toHaveBeenCalledWith({ token: 'apns-1', accessToken: 'access-2' });
  });

  it('registers nothing when the launch found no session', async () => {
    const { store } = memoryStore();
    const sessionStore = new SessionStore(store);
    const register = jest.fn(async () => undefined);
    const deviceTokens = new DeviceTokenLifecycle({
      store: sessionStore,
      provider: { getToken: async () => 'apns-1' },
      transport: { register, revoke: jest.fn(async () => undefined) },
    });
    const { session } = build({}, { deviceTokens, store: sessionStore });

    await session.restore();

    expect(session.getState().status).toBe('signed-out');
    expect(register).not.toHaveBeenCalled();
  });
});

describe('refresh', () => {
  it('serves concurrent callers from a single rotation', async () => {
    let issued = 0;
    const { session, sessionStore, calls } = build({
      'POST /auth/token': () => {
        issued += 1;
        return json({
          ...GRANT,
          access_token: `access-${issued}`,
          refresh_token: `refresh-${issued}`,
        });
      },
      'GET /auth/me': () => json(ME),
    });
    await sessionStore.write({
      refreshToken: 'refresh-0',
      clientId: 'nexa-agent-app-1',
      licenseId: '42',
      accountId: 'acct-1',
    });
    await session.restore();
    const before = calls.filter((c) => c.url.endsWith('/auth/token')).length;

    const results = await Promise.all([session.refresh(), session.refresh(), session.refresh()]);

    // Presenting a rotated refresh token twice is what the server reads as
    // theft — it would revoke the family and sign the person out for being fast.
    expect(calls.filter((c) => c.url.endsWith('/auth/token')).length).toBe(before + 1);
    expect(new Set(results).size).toBe(1);
  });

  it('signs the session out and tells its subscribers when rotation is refused', async () => {
    let rotations = 0;
    const { session, sessionStore } = build({
      // The first rotation restores the session; the second finds the family
      // revoked — a token stolen and presented by somebody else, say.
      'POST /auth/token': () => {
        rotations += 1;
        return rotations === 1 ? json(GRANT) : apiError(401, 'authentication');
      },
      'GET /auth/me': () => json(ME),
    });
    await sessionStore.write({
      refreshToken: 'refresh-0',
      clientId: 'nexa-agent-app-1',
      licenseId: '42',
      accountId: 'acct-1',
    });
    await session.restore();
    expect(session.getState().status).toBe('signed-in');

    const seen: string[] = [];
    session.subscribe((state) => seen.push(state.status));

    expect(await session.refresh()).toBeNull();

    // The shell learns from the subscription, not from the return value — the
    // screen that was mid-request is not the only one that has to react.
    expect(seen).toEqual(['signed-out']);
    expect(session.getState()).toEqual({
      status: 'signed-out',
      accessToken: null,
      principal: null,
    });
    expect(await sessionStore.read()).toBeNull();
  });

  it('answers null without a request when there is no session to renew', async () => {
    const { session, calls } = build({});
    expect(await session.refresh()).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe('signOut', () => {
  it('revokes both tokens, clears the device, and forgets the device token', async () => {
    const { store } = memoryStore();
    const sessionStore = new SessionStore(store);
    const revoke = jest.fn(async () => undefined);
    const deviceTokens = new DeviceTokenLifecycle({
      store: sessionStore,
      provider: { getToken: async () => 'dev-1' },
      transport: { register: jest.fn(async () => undefined), revoke },
    });

    const { impl, calls } = fakeFetch({
      ...SIGN_IN_ROUTES,
      'POST /auth/revoke': () => json({ revoked: true }),
    });
    const session = new MobileSession({
      apiBaseUrl: API,
      store: sessionStore,
      fetchImpl: impl,
      pkce: async () => PKCE,
      deviceTokens,
    });

    await session.signIn(CREDENTIALS);
    await session.signOut();

    const revoked = calls
      .filter((c) => c.url.endsWith('/auth/revoke'))
      .map((c) => (c.body as { token: string }).token);
    expect(revoked).toEqual(expect.arrayContaining(['access-1', 'refresh-1']));
    expect(revoke).toHaveBeenCalledWith({ token: 'dev-1', accessToken: 'access-1' });

    expect(session.getState()).toEqual({
      status: 'signed-out',
      accessToken: null,
      principal: null,
    });
    expect(await sessionStore.read()).toBeNull();
    expect(await sessionStore.readDeviceToken()).toBeNull();
  });

  it('ends the session on this phone even when the revoke calls fail', async () => {
    const { session, sessionStore } = build({
      ...SIGN_IN_ROUTES,
      'POST /auth/revoke': () => apiError(500, 'internal'),
    });

    await session.signIn(CREDENTIALS);
    await expect(session.signOut()).resolves.toBeUndefined();

    expect(session.getState().status).toBe('signed-out');
    expect(await sessionStore.read()).toBeNull();
  });
});

describe('switchAccount', () => {
  it('revokes the outgoing device token before the incoming account registers one', async () => {
    const { store } = memoryStore();
    const sessionStore = new SessionStore(store);
    const order: string[] = [];
    const deviceTokens = new DeviceTokenLifecycle({
      store: sessionStore,
      provider: { getToken: async () => 'dev-1' },
      transport: {
        register: jest.fn(async () => {
          order.push('register');
        }),
        revoke: jest.fn(async () => {
          order.push('revoke');
        }),
      },
    });

    const { impl } = fakeFetch({
      ...SIGN_IN_ROUTES,
      'POST /auth/revoke': () => json({ revoked: true }),
    });
    const session = new MobileSession({
      apiBaseUrl: API,
      store: sessionStore,
      fetchImpl: impl,
      pkce: async () => PKCE,
      deviceTokens,
    });

    await session.signIn(CREDENTIALS);
    order.length = 0;
    await session.switchAccount({ ...CREDENTIALS, email: 'other@nexa.test', licenseId: '43' });

    expect(order).toEqual(['revoke', 'register']);
    expect(session.getState().status).toBe('signed-in');
  });
});
