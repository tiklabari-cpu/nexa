/**
 * Two rules, and both are about what happens when something fails or when two
 * things happen in the wrong order — so the interesting tests here are the
 * negative ones (§C-A31 · 13.7-b).
 */
import { DeviceTokenLifecycle, type DeviceTokenTransport } from './device-token';
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

/** Records what was called and in which order — the ordering rule needs both. */
function recordingTransport(overrides: Partial<DeviceTokenTransport> = {}) {
  const calls: string[] = [];
  const transport: DeviceTokenTransport = {
    register: jest.fn(async (input) => {
      calls.push(`register:${input.token}:${input.accessToken}`);
      await overrides.register?.(input);
    }),
    revoke: jest.fn(async (input) => {
      calls.push(`revoke:${input.token}:${input.accessToken}`);
      await overrides.revoke?.(input);
    }),
  };
  return { transport, calls };
}

function provider(token: string | null) {
  return { getToken: jest.fn(async () => token) };
}

describe('DeviceTokenLifecycle', () => {
  it('registers the device token when a session starts', async () => {
    const store = new SessionStore(memoryStore());
    const { transport, calls } = recordingTransport();

    await new DeviceTokenLifecycle({ store, provider: provider('dev-1'), transport }).onSignedIn(
      'access-1',
    );

    expect(calls).toEqual(['register:dev-1:access-1']);
    expect(await store.readDeviceToken()).toBe('dev-1');
  });

  it('registers nothing when notifications were declined', async () => {
    const store = new SessionStore(memoryStore());
    const { transport, calls } = recordingTransport();

    await new DeviceTokenLifecycle({ store, provider: provider(null), transport }).onSignedIn(
      'access-1',
    );

    expect(calls).toEqual([]);
    expect(await store.readDeviceToken()).toBeNull();
  });

  it('does not claim a token is registered when registration failed', async () => {
    const store = new SessionStore(memoryStore());
    const { transport } = recordingTransport({
      register: async () => {
        throw new Error('502');
      },
    });

    await new DeviceTokenLifecycle({ store, provider: provider('dev-1'), transport }).onSignedIn(
      'access-1',
    );

    expect(await store.readDeviceToken()).toBeNull();
  });

  it('deletes the local token even when the revoke call fails', async () => {
    const store = new SessionStore(memoryStore());
    await store.writeDeviceToken('dev-1');
    const { transport, calls } = recordingTransport({
      revoke: async () => {
        throw new Error('no network');
      },
    });

    const lifecycle = new DeviceTokenLifecycle({ store, provider: provider('dev-1'), transport });
    await expect(lifecycle.onSignedOut('access-1')).resolves.toBeUndefined();

    expect(calls).toEqual(['revoke:dev-1:access-1']);
    // Rule 1: a failed revoke must not leave a usable token behind for the next
    // person to sign in on this handset.
    expect(await store.readDeviceToken()).toBeNull();
  });

  it('deletes the local token when there is no credential left to revoke with', async () => {
    const store = new SessionStore(memoryStore());
    await store.writeDeviceToken('dev-1');
    const { transport, calls } = recordingTransport();

    await new DeviceTokenLifecycle({ store, provider: provider('dev-1'), transport }).onSignedOut(
      null,
    );

    expect(calls).toEqual([]);
    expect(await store.readDeviceToken()).toBeNull();
  });

  it('revokes the outgoing account before registering the incoming one', async () => {
    const store = new SessionStore(memoryStore());
    await store.writeDeviceToken('dev-1');
    const { transport, calls } = recordingTransport();

    await new DeviceTokenLifecycle({
      store,
      provider: provider('dev-2'),
      transport,
    }).onAccountSwitched({ previousAccessToken: 'access-a', nextAccessToken: 'access-b' });

    // Rule 2, stated as an order rather than a set: register-first would leave a
    // window in which one handset is registered to two workspaces.
    expect(calls).toEqual(['revoke:dev-1:access-a', 'register:dev-2:access-b']);
    expect(await store.readDeviceToken()).toBe('dev-2');
  });

  it('still registers the incoming account after a failed revoke, and never before it', async () => {
    const store = new SessionStore(memoryStore());
    await store.writeDeviceToken('dev-1');
    const { transport, calls } = recordingTransport({
      revoke: async () => {
        throw new Error('offline');
      },
    });

    await new DeviceTokenLifecycle({
      store,
      provider: provider('dev-2'),
      transport,
    }).onAccountSwitched({ previousAccessToken: 'access-a', nextAccessToken: 'access-b' });

    expect(calls).toEqual(['revoke:dev-1:access-a', 'register:dev-2:access-b']);
    expect(await store.readDeviceToken()).toBe('dev-2');
  });

  it('does nothing at all until a transport exists (13.7-c)', async () => {
    const store = new SessionStore(memoryStore());
    const push = provider('dev-1');

    const lifecycle = new DeviceTokenLifecycle({ store, provider: push });
    await lifecycle.onSignedIn('access-1');
    await lifecycle.onSignedOut('access-1');

    expect(push.getToken).not.toHaveBeenCalled();
    expect(await store.readDeviceToken()).toBeNull();
  });
});
