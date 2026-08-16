/**
 * The two requests, and the one thing between them that is easy to get wrong:
 * `DELETE` needs an id the app can only have learned from `POST`, and nothing
 * in the API will hand it back later (13.7-l).
 */
import { createDeviceTokenTransport } from './device-token-transport';
import { SessionStore, type SecureKeyValueStore } from './secure-store';

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

interface Call {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
}

/** Records every request and answers each with whatever the test lined up. */
function fakeFetch(responses: Response[]) {
  const calls: Call[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      method: init?.method ?? 'GET',
      url: typeof input === 'string' ? input : input.toString(),
      authorization: new Headers(init?.headers).get('Authorization'),
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const next = responses.shift();
    if (next === undefined) throw new Error('No response queued for this request.');
    return next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const API = 'https://api.nexa.test/api/v1';

function device(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      id: 'device-1',
      platform: 'ios',
      created_at: '2026-08-17T00:00:00.000Z',
      last_seen_at: '2026-08-17T00:00:00.000Z',
      revoked_at: null,
      ...overrides,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function build(responses: Response[], platform: 'ios' | 'android' = 'ios') {
  const store = new SessionStore(memoryStore());
  const { impl, calls } = fakeFetch(responses);
  const transport = createDeviceTokenTransport({
    baseUrl: API,
    store,
    platform,
    fetchImpl: impl,
  });
  return { transport, store, calls };
}

describe('createDeviceTokenTransport', () => {
  it('posts the token and this handset’s platform, with the credential it was handed', async () => {
    const { transport, calls } = build([device()]);

    await transport.register({ token: 'apns-1', accessToken: 'access-1' });

    expect(calls).toEqual([
      {
        method: 'POST',
        url: `${API}/notifications/devices`,
        authorization: 'Bearer access-1',
        body: { token: 'apns-1', platform: 'ios' },
      },
    ]);
  });

  it('carries the platform it was built for, not a fixed one', async () => {
    const { transport, calls } = build([device({ platform: 'android' })], 'android');

    await transport.register({ token: 'fcm-1', accessToken: 'access-1' });

    expect(calls[0]!.body).toEqual({ token: 'fcm-1', platform: 'android' });
  });

  it('remembers the registration id, because DELETE is the only thing that can use it', async () => {
    const { transport, store } = build([device({ id: 'device-9' })]);

    await transport.register({ token: 'apns-1', accessToken: 'access-1' });

    expect(await store.readDeviceId()).toBe('device-9');
  });

  it('does not remember an id when the registration failed', async () => {
    const { transport, store } = build([
      new Response(JSON.stringify({ error: { type: 'internal', message: 'boom' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);

    await expect(
      transport.register({ token: 'apns-1', accessToken: 'access-1' }),
    ).rejects.toThrow();
    // An id left behind by a failed register would point the next revoke at a
    // registration this device does not hold.
    expect(await store.readDeviceId()).toBeNull();
  });

  it('revokes the registration it registered, by id', async () => {
    const { transport, store, calls } = build([
      device({ id: 'device-9' }),
      new Response(null, { status: 204 }),
    ]);

    await transport.register({ token: 'apns-1', accessToken: 'access-1' });
    await transport.revoke({ token: 'apns-1', accessToken: 'access-1' });

    expect(calls[1]).toEqual({
      method: 'DELETE',
      url: `${API}/notifications/devices/device-9`,
      authorization: 'Bearer access-1',
      body: undefined,
    });
    // The store is not cleared here: rule 1 lives in `DeviceTokenLifecycle`,
    // which clears whatever this returned or threw.
    expect(await store.readDeviceId()).toBe('device-9');
  });

  it('revokes with the credential it is handed, not one it captured', async () => {
    // The account-switch case (§C-A31 rule 2): the token that must revoke is
    // the *outgoing* account's, which is why the interface passes one at all.
    const { transport, calls } = build([device(), new Response(null, { status: 204 })]);

    await transport.register({ token: 'apns-1', accessToken: 'access-outgoing' });
    await transport.revoke({ token: 'apns-1', accessToken: 'access-outgoing' });

    expect(calls.map((call) => call.authorization)).toEqual([
      'Bearer access-outgoing',
      'Bearer access-outgoing',
    ]);
  });

  it('asks for nothing when it has no id to name — a register that never landed', async () => {
    const { transport, calls } = build([]);

    await expect(
      transport.revoke({ token: 'apns-1', accessToken: 'access-1' }),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([]);
  });

  it('lets a failed revoke through, so the lifecycle can apply rule 1', async () => {
    const { transport } = build([
      device(),
      new Response(JSON.stringify({ error: { type: 'not_found', message: 'gone' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    ]);

    await transport.register({ token: 'apns-1', accessToken: 'access-1' });

    // Swallowing it here would take the decision away from the one place that
    // is documented to make it — and a 404 is the expected shape of a retry,
    // which `DeviceTokenLifecycle.onSignedOut` already treats as fine.
    await expect(transport.revoke({ token: 'apns-1', accessToken: 'access-1' })).rejects.toThrow();
  });

  it('refuses to be built for a platform the endpoint cannot store', async () => {
    expect(() =>
      createDeviceTokenTransport({
        baseUrl: API,
        store: new SessionStore(memoryStore()),
        platform: 'web' as unknown as 'ios',
      }),
    ).toThrow(/Unsupported device platform/);
  });
});
