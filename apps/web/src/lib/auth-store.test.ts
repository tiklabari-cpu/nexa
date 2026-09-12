/**
 * Restoring a session from the stored refresh token.
 *
 * A refresh token is single-use by design: the server rotates it and treats a
 * second presentation as a stolen credential, revoking the whole family —
 * including the access token the *successful* rotation just minted. So two
 * overlapping restores do not merely waste a round trip, they end the session
 * and drop the agent on the sign-in form.
 *
 * They overlap in practice: `App` restores from an effect and StrictMode mounts
 * every effect twice in development, which was measured in a real browser as
 * two `POST /auth/token` carrying the same token on every signed-in reload. The
 * fake server below is the smallest thing that behaves like the real one on
 * that point — it rotates, and it kills the family when a spent token comes
 * back — so these tests fail the way the browser failed rather than merely
 * counting requests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useAuth as useAuthStore } from './auth-store.js';

const REFRESH_KEY = 'nexa.refresh_token';
const CLIENT_ID_KEY = 'nexa.client_id';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * An OAuth 2.1 server, reduced to the one rule this file is about: a refresh
 * token rotates on use, and presenting a rotated one revokes the family.
 */
function fakeAuthServer(): { fetch: typeof fetch; tokenCalls: () => number } {
  let liveRefresh = 'refresh-0';
  let rotation = 0;
  let familyRevoked = false;
  let tokenCalls = 0;

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();

    if (url.endsWith('/auth/token')) {
      tokenCalls += 1;
      const body = JSON.parse(String(init?.body ?? '{}')) as { refresh_token?: string };
      if (familyRevoked || body.refresh_token !== liveRefresh) {
        familyRevoked = true;
        return jsonResponse(
          { error: { type: 'authentication', message: 'Refresh token has already been used.' } },
          401,
        );
      }
      rotation += 1;
      liveRefresh = `refresh-${rotation}`;
      return jsonResponse({ access_token: `access-${rotation}`, refresh_token: liveRefresh });
    }

    if (url.endsWith('/auth/me')) {
      if (familyRevoked) {
        return jsonResponse({ error: { type: 'authentication', message: 'Unauthorized.' } }, 401);
      }
      return jsonResponse({
        account_id: 'acct-1',
        email: 'owner@acme.localhost',
        name: 'Dana Okonkwo',
        role: 'owner',
        organization_id: 'org-1',
        license_id: '1',
        scopes: ['accounts--my:ro'],
        routing_status: 'accepting_chats',
      });
    }

    throw new Error(`unexpected request: ${url}`);
  }) as typeof fetch;

  return { fetch: fetchImpl, tokenCalls: () => tokenCalls };
}

/**
 * A fresh copy of the store bound to a fresh fake server.
 *
 * `ApiClient` binds `globalThis.fetch` when it is constructed, and the store
 * constructs its anonymous client at module load — so the stub has to be in
 * place before the import, and the module registry reset between tests.
 */
async function loadStore(): Promise<{
  useAuth: typeof useAuthStore;
  tokenCalls: () => number;
}> {
  const server = fakeAuthServer();
  vi.resetModules();
  vi.stubGlobal('fetch', server.fetch);
  const { useAuth } = await import('./auth-store.js');
  return { useAuth, tokenCalls: server.tokenCalls };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(REFRESH_KEY, 'refresh-0');
  localStorage.setItem(CLIENT_ID_KEY, 'nexa-agent-app-acme');
});

afterEach(() => {
  vi.unstubAllGlobals();
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
  });

  it('does not ask for a token when there is nothing stored to spend', async () => {
    const { useAuth, tokenCalls } = await loadStore();
    localStorage.removeItem(REFRESH_KEY);

    await useAuth.getState().restore();

    expect(tokenCalls()).toBe(0);
    expect(useAuth.getState().status).toBe('signed-out');
  });
});
