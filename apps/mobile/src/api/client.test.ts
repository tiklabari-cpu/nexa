/**
 * The 401 policy, tested against a real `MobileSession` rather than a stub of
 * one. The interesting behaviour is the handshake between the two — a stubbed
 * `refresh()` that always resolves would prove the retry happens and nothing
 * about whether the session survived it.
 */
import { MobileSession } from '../auth/session';
import { SessionStore, type SecureKeyValueStore } from '../auth/secure-store';
import { SessionApiClient } from './client';

const API = 'https://api.test/api/v1';

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

function apiError(status: number, type: string): Response {
  return json({ error: { type, message: `${type} refused`, request_id: 'req-1' } }, status);
}

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
  organization_id: 'org-1',
  license_id: '42',
  scopes: ['chats--all:rw'],
};

/**
 * A session already restored and signed in, plus a handle on the fake server so
 * each test can decide what the protected endpoint does next.
 */
async function signedIn(handlers: { agents: () => Response; token?: () => Response }): Promise<{
  session: MobileSession;
  store: SessionStore;
  client: SessionApiClient;
  calls: Array<{ url: string; authorization: string | undefined }>;
}> {
  const store = new SessionStore(memoryStore());
  await store.write({
    refreshToken: 'refresh-0',
    clientId: 'nexa-agent-app-1',
    licenseId: '42',
    accountId: 'acct-1',
  });

  const calls: Array<{ url: string; authorization: string | undefined }> = [];
  let rotations = 0;
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ url, authorization: headers['Authorization'] });

    if (url.endsWith('/auth/token')) {
      rotations += 1;
      return handlers.token?.() ?? json({ ...GRANT, access_token: `access-${rotations}` });
    }
    if (url.endsWith('/auth/me')) return json(ME);
    return handlers.agents();
  }) as unknown as typeof fetch;

  const session = new MobileSession({ apiBaseUrl: API, store, fetchImpl });
  await session.restore();

  return {
    session,
    store,
    client: new SessionApiClient({ session, baseUrl: API, fetchImpl }),
    calls,
  };
}

describe('SessionApiClient', () => {
  it('carries the session token, and the current one after a renewal', async () => {
    let attempt = 0;
    const { client, calls } = await signedIn({
      agents: () => {
        attempt += 1;
        return attempt === 1 ? apiError(401, 'authentication') : json({ agents: [] });
      },
    });

    await client.request('get', '/agents');

    const protectedCalls = calls.filter((c) => c.url.endsWith('/agents'));
    expect(protectedCalls).toHaveLength(2);
    expect(protectedCalls[0]!.authorization).toBe('Bearer access-1');
    // The retry uses the token minted a moment ago, not the one that failed.
    expect(protectedCalls[1]!.authorization).toBe('Bearer access-2');
  });

  it('retries once and no more', async () => {
    const { client, calls } = await signedIn({ agents: () => apiError(401, 'authentication') });

    await expect(client.request('get', '/agents')).rejects.toMatchObject({ status: 401 });

    // Two attempts, one renewal. A second 401 against a fresh token is an answer,
    // not a stale credential, and retrying it is a loop.
    expect(calls.filter((c) => c.url.endsWith('/agents'))).toHaveLength(2);
  });

  it('drops the session and surfaces the original refusal when renewal fails', async () => {
    let rotations = 0;
    const { client, session, store } = await signedIn({
      agents: () => apiError(401, 'authentication'),
      token: () => {
        rotations += 1;
        return rotations === 1 ? json(GRANT) : apiError(401, 'authentication');
      },
    });

    await expect(client.request('get', '/agents')).rejects.toMatchObject({ status: 401 });

    expect(session.getState().status).toBe('signed-out');
    expect(await store.read()).toBeNull();
  });

  it('does not renew for a refusal a new token would not fix', async () => {
    const { client, calls } = await signedIn({ agents: () => apiError(403, 'authorization') });

    await expect(client.request('get', '/agents')).rejects.toMatchObject({ status: 403 });

    expect(calls.filter((c) => c.url.endsWith('/agents'))).toHaveLength(1);
    // One rotation, from `restore()` — none caused by the 403.
    expect(calls.filter((c) => c.url.endsWith('/auth/token'))).toHaveLength(1);
  });

  it('does not renew for a 401 that is not about the credential', async () => {
    // `license_expired` arrives with 401 too; a fresh token answers nothing.
    const { client, calls } = await signedIn({ agents: () => apiError(401, 'license_expired') });

    await expect(client.request('get', '/agents')).rejects.toMatchObject({
      type: 'license_expired',
    });
    expect(calls.filter((c) => c.url.endsWith('/agents'))).toHaveLength(1);
  });

  it('passes a successful response straight through', async () => {
    const { client } = await signedIn({ agents: () => json({ agents: [{ id: 'a-1' }] }) });

    await expect(client.request('get', '/agents')).resolves.toEqual({ agents: [{ id: 'a-1' }] });
  });
});
