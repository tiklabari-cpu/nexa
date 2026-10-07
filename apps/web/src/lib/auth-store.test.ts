/**
 * Keeping a session: restoring it from the stored refresh token, and renewing
 * the access token while the panel stays open (tm 259.1).
 *
 * A refresh token is single-use by design: the server rotates it and treats a
 * second presentation as a stolen credential, revoking the whole family —
 * including the access token the *successful* rotation just minted. So two
 * overlapping renewals do not merely waste a round trip, they end the session
 * and drop the agent on the sign-in form.
 *
 * They overlap in practice, in three places: `App` restores from an effect and
 * StrictMode mounts every effect twice in development (measured in a real
 * browser as two `POST /auth/token` carrying the same token on every signed-in
 * reload); a burst of requests refused at once each want a renewal; and two
 * tabs of one browser share the one stored token. The fake server below is the
 * smallest thing that behaves like the real one on that point — it rotates, and
 * it kills the family when a spent token comes back — so these tests fail the
 * way the browser failed rather than merely counting requests.
 *
 * A "tab" here is a fresh copy of the store module (`openTab`): its own memory,
 * the same `localStorage`, the same server, and the same Web Lock and
 * BroadcastChannel stand-ins — which is exactly what two browser tabs share.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStoreModule from './auth-store.js';
// Type only: every tab loads its own copy of the module, so an error it throws
// is an instance of *its* class, not of one imported here.
import type { ApiClientError } from './api-client.js';

// Every test loads at least one fresh copy of the store, and `@siyahtus/types`
// is workspace source, so each copy evaluates some sixty modules again. That is
// instant on an idle machine and was measured at 5–7 s per test inside the full
// DoD gate, where every package's suite runs at once (tm 259.1). The default
// 5 s turned that into timeouts — and a timed-out test's restore, still
// running, then reached the next test's fake server.
vi.setConfig({ testTimeout: 30_000 });

const REFRESH_KEY = 'siyahtus.refresh_token';
const CLIENT_ID_KEY = 'siyahtus.client_id';

/** The default `expires_in` of a real deployment (`ACCESS_TOKEN_TTL`). */
const HOUR_S = 3600;

type Tab = typeof AuthStoreModule;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The token endpoint's refusal (RFC 6749 §5.2). */
function invalidGrant(): Response {
  return jsonResponse(
    {
      error: {
        type: 'authentication',
        message: 'Refresh token has already been used; the token family has been revoked.',
        request_id: 'rq-grant',
        details: { oauth_error: 'invalid_grant' },
      },
    },
    401,
  );
}

/** The auth plugin's refusal of the bearer itself (RFC 6750 §3.1). */
function invalidToken(): Response {
  return jsonResponse(
    {
      error: {
        type: 'authentication',
        message: 'Invalid or expired credentials.',
        request_id: 'rq-token',
        details: { oauth_error: 'invalid_token' },
      },
    },
    401,
  );
}

interface Family {
  prefix: string;
  account: string;
  license: string;
  rotations: number;
  revoked: boolean;
}

interface FakeServer {
  fetch: typeof fetch;
  tokenCalls: () => number;
  /** Every refresh token presented to `/auth/token`, in order. */
  presented: string[];
  familyRevoked: (family?: 'F1' | 'F2') => boolean;
  /** Every access token minted so far stops working — what an hour does. */
  expireAccessTokens: () => void;
  /** The family ends server-side: signed out elsewhere, or revoked by an admin. */
  revokeFamily: (family?: 'F1' | 'F2') => void;
  /** The membership is gone: tokens still mint, and every one is refused. */
  refuseEveryToken: boolean;
  /** Answer `/auth/token` with this status instead of rotating — a deploy, an outage. */
  tokenOutage: number | null;
  expiresIn: number;
}

/**
 * An OAuth 2.1 server, reduced to the rules this file is about: a refresh token
 * rotates on use and presenting a rotated one revokes the family; an access
 * token works until it expires or its family is revoked.
 *
 * Two families exist from the start, for two people: `refresh-0` belongs to
 * acct-1 (license 1) and `other-refresh-0` to acct-2 (license 2).
 */
function fakeAuthServer(): FakeServer {
  const families = new Map<string, Family>([
    ['F1', { prefix: '', account: 'acct-1', license: '1', rotations: 0, revoked: false }],
    ['F2', { prefix: 'other-', account: 'acct-2', license: '2', rotations: 0, revoked: false }],
  ]);
  const refreshTokens = new Map<string, { family: string; spent: boolean }>([
    ['refresh-0', { family: 'F1', spent: false }],
    ['other-refresh-0', { family: 'F2', spent: false }],
  ]);
  const accessTokens = new Map<string, { family: string; expired: boolean }>();
  let tokenCalls = 0;

  const server: FakeServer = {
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      const path = url.replace(/^.*\/api\/v1/, '');

      if (path === '/auth/token') {
        tokenCalls += 1;
        const body = JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string };
        const presented = body.refresh_token ?? '';
        server.presented.push(presented);
        if (server.tokenOutage !== null) {
          return jsonResponse(
            {
              error: {
                type: 'service_unavailable',
                message: 'Try again shortly.',
                request_id: 'rq-503',
              },
            },
            server.tokenOutage,
          );
        }

        const record = refreshTokens.get(presented);
        const family = record ? families.get(record.family) : undefined;
        if (!record || !family || family.revoked) return invalidGrant();
        if (record.spent) {
          // A rotated token came back: assume theft, end everything it started.
          family.revoked = true;
          return invalidGrant();
        }

        record.spent = true;
        family.rotations += 1;
        const refresh = `${family.prefix}refresh-${family.rotations}`;
        const access = `${family.prefix}access-${family.rotations}`;
        refreshTokens.set(refresh, { family: record.family, spent: false });
        accessTokens.set(access, { family: record.family, expired: false });
        return jsonResponse({
          access_token: access,
          token_type: 'Bearer',
          expires_in: server.expiresIn,
          refresh_token: refresh,
          account_id: family.account,
          license_id: family.license,
          organization_id: 'org-1',
        });
      }

      if (path === '/auth/revoke') {
        const body = JSON.parse(String(init?.body ?? '{}')) as { token?: string };
        const owner = refreshTokens.get(body.token ?? '') ?? accessTokens.get(body.token ?? '');
        if (owner) families.get(owner.family)!.revoked = true;
        return jsonResponse({ revoked: owner !== undefined });
      }

      // Everything else needs a live bearer.
      const bearer = new Headers(init?.headers).get('Authorization')?.replace(/^Bearer /, '');
      const access = bearer ? accessTokens.get(bearer) : undefined;
      const family = access ? families.get(access.family)! : undefined;
      if (!access || !family || access.expired || family.revoked || server.refuseEveryToken) {
        return invalidToken();
      }

      if (path === '/auth/me') {
        return jsonResponse({
          account_id: family.account,
          email: `${family.account}@acme.localhost`,
          name: 'Dana Okonkwo',
          role: 'owner',
          organization_id: 'org-1',
          license_id: family.license,
          scopes: ['accounts--my:ro'],
          routing_status: 'accepting_chats',
        });
      }
      if (path === '/chats') return jsonResponse({ items: [] });

      throw new Error(`unexpected request: ${url}`);
    }) as typeof fetch,
    tokenCalls: () => tokenCalls,
    presented: [],
    familyRevoked: (id = 'F1') => families.get(id)!.revoked,
    expireAccessTokens: () => {
      for (const token of accessTokens.values()) token.expired = true;
    },
    revokeFamily: (id = 'F1') => {
      families.get(id)!.revoked = true;
    },
    refuseEveryToken: false,
    tokenOutage: null,
    expiresIn: HOUR_S,
  };
  return server;
}

/**
 * `navigator.locks`, reduced to one exclusive lock per name, granted in the
 * order asked for — the part of the Web Locks API two tabs rely on.
 */
class FakeLockManager {
  readonly #tails = new Map<string, Promise<unknown>>();

  request<T>(name: string, callback: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(name) ?? Promise.resolve();
    const granted = previous.then(() => callback());
    this.#tails.set(
      name,
      granted.catch(() => undefined),
    );
    return granted;
  }
}

/**
 * `BroadcastChannel` between the tabs of one test: delivered to every *other*
 * instance of the same name, as a task — never synchronously, never to itself.
 */
class FakeBroadcastChannel {
  static open = new Set<FakeBroadcastChannel>();

  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    FakeBroadcastChannel.open.add(this);
  }

  postMessage(data: unknown): void {
    for (const other of FakeBroadcastChannel.open) {
      if (other === this || other.name !== this.name) continue;
      const copy = structuredClone(data);
      setTimeout(() => other.onmessage?.({ data: copy } as MessageEvent), 0);
    }
  }

  close(): void {
    FakeBroadcastChannel.open.delete(this);
  }
}

/** Every store a test opened, signed out afterwards so no timer or listener outlives it. */
const tabs: Tab[] = [];

/**
 * A tab: a fresh copy of the store. `ApiClient` binds `globalThis.fetch` when
 * it is constructed, and the store constructs its anonymous client at module
 * load — so the server has to be stubbed before this runs.
 */
async function openTab(): Promise<Tab> {
  vi.resetModules();
  const tab = await import('./auth-store.js');
  tabs.push(tab);
  return tab;
}

/** A fresh server, stubbed in as `fetch` for every tab opened after this. */
function stubServer(): FakeServer {
  const server = fakeAuthServer();
  vi.stubGlobal('fetch', server.fetch);
  return server;
}

/** One tab against its own server — what the restore tests need. */
async function loadStore(): Promise<{ useAuth: Tab['useAuth']; tokenCalls: () => number }> {
  const server = stubServer();
  const { useAuth } = await openTab();
  return { useAuth, tokenCalls: server.tokenCalls };
}

/** Make `navigator.locks` exist, as it does in every browser the panel supports. */
function installLocks(): void {
  Object.defineProperty(navigator, 'locks', { value: new FakeLockManager(), configurable: true });
}

/** Let the channel's queued deliveries land. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(REFRESH_KEY, 'refresh-0');
  localStorage.setItem(CLIENT_ID_KEY, 'siyahtus-agent-app-acme');
  FakeBroadcastChannel.open.clear();
  vi.stubGlobal('BroadcastChannel', FakeBroadcastChannel);
});

afterEach(async () => {
  for (const tab of tabs.splice(0)) {
    await tab.useAuth
      .getState()
      .signOut()
      .catch(() => undefined);
  }
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'locks');
});

describe('useAuth.restore', () => {
  it('spends the stored refresh token once when two restores overlap', async () => {
    const { useAuth, tokenCalls } = await loadStore();

    // Exactly what StrictMode does to `App`'s effect: two calls, same tick,
    // both reading the same token out of localStorage.
    await Promise.all([useAuth.getState().restore(), useAuth.getState().restore()]);

    // The outcome first, because it is the defect: spending the token twice
    // revokes the family, so the reload lands on the sign-in form.
    expect(useAuth.getState().status).toBe('signed-in');
    expect(useAuth.getState().agent?.account_id).toBe('acct-1');
    expect(tokenCalls()).toBe(1);
    // The rotation's successor was kept, so the next reload has something to
    // spend — a session that survives once and not twice is still broken.
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-1');
  });

  it('still refreshes a second time once the first has settled', async () => {
    const { useAuth, tokenCalls } = await loadStore();

    await useAuth.getState().restore();
    await useAuth.getState().restore();

    // Single-flight, not once-only: collapsing every later restore into the
    // first would leave a signed-out tab unable to come back.
    expect(tokenCalls()).toBe(2);
    expect(useAuth.getState().status).toBe('signed-in');
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-2');
  });

  it('signs out and forgets the token when the refresh is refused', async () => {
    const { useAuth } = await loadStore();
    localStorage.setItem(REFRESH_KEY, 'refresh-from-a-dead-family');

    await useAuth.getState().restore();

    expect(useAuth.getState().status).toBe('signed-out');
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
    // A page load that finds a dead token is a sign-in screen, not news: the
    // "your session ended" line is for a session somebody was in the middle of.
    expect(useAuth.getState().sessionEnded).toBe(false);
  });

  it('does not ask for a token when there is nothing stored to spend', async () => {
    const { useAuth, tokenCalls } = await loadStore();
    localStorage.removeItem(REFRESH_KEY);

    await useAuth.getState().restore();

    expect(tokenCalls()).toBe(0);
    expect(useAuth.getState().status).toBe('signed-out');
  });
});

describe('a request refused for an expired token is renewed and repeated (tm 259.1 · NFR-S2)', () => {
  it('renews once and repeats the request, which then succeeds', async () => {
    const server = stubServer();
    const { useAuth, sessionClient } = await openTab();
    await useAuth.getState().restore();
    server.expireAccessTokens();

    await expect(sessionClient().get('/chats')).resolves.toEqual({ items: [] });

    expect(server.tokenCalls()).toBe(2);
    expect(useAuth.getState().status).toBe('signed-in');
    expect(useAuth.getState().accessToken).toBe('access-2');
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-2');
  });

  it('shares one renewal among five requests refused at the same time', async () => {
    const server = stubServer();
    const { useAuth, sessionClient } = await openTab();
    await useAuth.getState().restore();
    server.expireAccessTokens();

    const answers = await Promise.all(
      Array.from({ length: 5 }, () => sessionClient().get<{ items: unknown[] }>('/chats')),
    );

    expect(answers).toHaveLength(5);
    // One for the restore, one for the renewal — five would have revoked the
    // family on the second.
    expect(server.tokenCalls()).toBe(2);
    expect(server.familyRevoked()).toBe(false);
  });

  it('ends the session and says so when the server refuses the renewal', async () => {
    const server = stubServer();
    const { useAuth, sessionClient } = await openTab();
    await useAuth.getState().restore();
    // Signed out in another browser, or revoked by an admin.
    server.revokeFamily();

    const error = (await sessionClient()
      .get('/chats')
      .catch((e: unknown) => e)) as ApiClientError;

    expect(error.status).toBe(401);
    expect(useAuth.getState().status).toBe('signed-out');
    expect(useAuth.getState().accessToken).toBeNull();
    expect(useAuth.getState().sessionEnded).toBe(true);
    expect(localStorage.getItem(REFRESH_KEY)).toBeNull();
  });

  it('ends the session when a token minted a moment ago is refused too, without looping', async () => {
    const server = stubServer();
    const { useAuth, sessionClient } = await openTab();
    await useAuth.getState().restore();
    server.refuseEveryToken = true;

    await sessionClient()
      .get('/chats')
      .catch(() => undefined);

    expect(server.tokenCalls()).toBe(2);
    expect(useAuth.getState().status).toBe('signed-out');
    expect(useAuth.getState().sessionEnded).toBe(true);
  });

  it('keeps the session when the renewal fails for a reason that says nothing about it', async () => {
    const server = stubServer();
    const { useAuth, sessionClient } = await openTab();
    await useAuth.getState().restore();
    server.expireAccessTokens();
    server.tokenOutage = 503;

    const error = (await sessionClient()
      .get('/chats')
      .catch((e: unknown) => e)) as ApiClientError;

    // The outage is the honest answer to the request, and nothing more: the
    // stored token was never spent, so the session is still there to renew
    // once the server is back (tm 259.2 decides how to wait for that).
    expect(error.status).toBe(503);
    expect(useAuth.getState().status).toBe('signed-in');
    expect(localStorage.getItem(REFRESH_KEY)).toBe('refresh-1');

    server.tokenOutage = null;
    await expect(sessionClient().get('/chats')).resolves.toEqual({ items: [] });
  });
});

describe('the access token is renewed before it expires (tm 259.1 · NFR-S2)', () => {
  it('renews at 80% of the lifetime the server granted, and again from the new token', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const server = stubServer();
    const { useAuth } = await openTab();
    await useAuth.getState().restore();

    await vi.advanceTimersByTimeAsync(0.8 * HOUR_S * 1000 - 1);
    expect(server.tokenCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(server.tokenCalls()).toBe(2);
    expect(useAuth.getState().accessToken).toBe('access-2');

    await vi.advanceTimersByTimeAsync(0.8 * HOUR_S * 1000);
    expect(server.tokenCalls()).toBe(3);
  });

  it('spreads the moment over the 70–80% window so two tabs rarely wake together', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.spyOn(Math, 'random').mockReturnValue(1);
    const server = stubServer();
    const { useAuth } = await openTab();
    await useAuth.getState().restore();

    await vi.advanceTimersByTimeAsync(0.7 * HOUR_S * 1000 - 1);
    expect(server.tokenCalls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.tokenCalls()).toBe(2);
  });

  it('renews at once when the tab becomes visible after sleeping past the moment', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const server = stubServer();
    const { useAuth } = await openTab();
    await useAuth.getState().restore();

    // A laptop lid closed for three hours: the wall clock moved on, the timer
    // did not get to run.
    vi.setSystemTime(Date.now() + 3 * HOUR_S * 1000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(server.tokenCalls()).toBe(2);
    expect(useAuth.getState().accessToken).toBe('access-2');
  });

  it('does nothing on a visibility change while the token is still young', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const server = stubServer();
    const { useAuth } = await openTab();
    await useAuth.getState().restore();

    vi.setSystemTime(Date.now() + 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);

    expect(server.tokenCalls()).toBe(1);
  });

  it('stops renewing once the session is signed out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const server = stubServer();
    const { useAuth } = await openTab();
    await useAuth.getState().restore();

    await useAuth.getState().signOut();
    await vi.advanceTimersByTimeAsync(3 * HOUR_S * 1000);

    expect(server.tokenCalls()).toBe(1);
  });
});

describe('two tabs of one browser share one refresh token (tm 259.1 · NFR-S2)', () => {
  it('never present the same refresh token when both renew at once', async () => {
    installLocks();
    const server = stubServer();
    const a = await openTab();
    await a.useAuth.getState().restore();
    const b = await openTab();
    await b.useAuth.getState().restore();
    await settle();
    server.expireAccessTokens();

    const answers = await Promise.all([
      a.sessionClient().get('/chats'),
      b.sessionClient().get('/chats'),
    ]);

    expect(answers).toEqual([{ items: [] }, { items: [] }]);
    // The defect this guards: without a lock both tabs read the same stored
    // token, the second presentation looks like theft, and the server revokes
    // the family — signing out both tabs at once.
    expect(server.familyRevoked()).toBe(false);
    expect(new Set(server.presented).size).toBe(server.presented.length);
    expect(a.useAuth.getState().status).toBe('signed-in');
    expect(b.useAuth.getState().status).toBe('signed-in');
  });

  it('takes the token a sibling just renewed instead of spending the refresh token again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    installLocks();
    const server = stubServer();
    const a = await openTab();
    await a.useAuth.getState().restore();
    await vi.advanceTimersByTimeAsync(1_000);
    const b = await openTab();
    await b.useAuth.getState().restore();
    await vi.advanceTimersByTimeAsync(0);

    // B's token is a second younger, so A carries it now.
    expect(a.useAuth.getState().accessToken).toBe('access-2');
    expect(b.useAuth.getState().accessToken).toBe('access-2');

    await expect(a.sessionClient().get('/chats')).resolves.toEqual({ items: [] });
    expect(server.tokenCalls()).toBe(2);
  });

  it("never takes a token that belongs to somebody else's sign-in", async () => {
    installLocks();
    const server = stubServer();
    const a = await openTab();
    await a.useAuth.getState().restore();
    expect(a.useAuth.getState().agent?.account_id).toBe('acct-1');

    // A second tab signs in as another person, and its refresh token replaces
    // the stored one — the browser keeps one.
    localStorage.setItem(REFRESH_KEY, 'other-refresh-0');
    const c = await openTab();
    await c.useAuth.getState().restore();
    await settle();
    expect(c.useAuth.getState().agent?.account_id).toBe('acct-2');

    // C's broadcast named acct-2, so A kept its own token.
    expect(a.useAuth.getState().accessToken).toBe('access-1');

    // A's next renewal finds acct-2's token in storage. Spending it is what
    // keeps C's chain unbroken; adopting what it bought would be A acting as
    // somebody else.
    server.expireAccessTokens();
    await a
      .sessionClient()
      .get('/chats')
      .catch(() => undefined);

    expect(a.useAuth.getState().status).toBe('signed-out');
    expect(a.useAuth.getState().accessToken).toBeNull();
    expect(server.familyRevoked('F2')).toBe(false);
    await expect(c.sessionClient().get('/chats')).resolves.toEqual({ items: [] });
    expect(c.useAuth.getState().status).toBe('signed-in');
  });
});
