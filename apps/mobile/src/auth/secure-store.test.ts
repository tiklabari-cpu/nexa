/**
 * The property under test is a negative one: there is exactly one place a
 * session is written, and it is the encrypted one. Most of these tests exist to
 * fail if somebody adds a "just this once" fallback.
 */

// The factory closes over nothing: `jest.mock` is hoisted above every `const` in
// this file, so a factory that referenced one would run against a variable that
// does not exist yet and quietly produce an empty module. The handles come back
// out through `requireMock` below instead.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
  isAvailableAsync: jest.fn(async () => true),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 4,
}));

import {
  expoSecureStore,
  SecureStoreUnavailableError,
  SessionStore,
  type PersistedSession,
} from './secure-store';

const mockSecureStore = jest.requireMock('expo-secure-store') as {
  getItemAsync: jest.Mock;
  setItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
  isAvailableAsync: jest.Mock;
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: number;
};

const SESSION: PersistedSession = {
  refreshToken: 'refresh-1',
  clientId: 'nexa-agent-app-1',
  licenseId: '42',
  accountId: 'acct-1',
};

/** An in-memory stand-in for the Keychain, with a switch for "not available". */
function fakeStore(available = true) {
  const values = new Map<string, string>();
  return {
    values,
    getItem: jest.fn(async (key: string) => values.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      values.delete(key);
    }),
    isAvailable: jest.fn(async () => available),
  };
}

describe('expoSecureStore', () => {
  it('writes through expo-secure-store, bound to this device and this unlock', async () => {
    await expoSecureStore.setItem('nexa.session', 'value');

    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith('nexa.session', 'value', {
      keychainAccessible: mockSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  });

  it('reads and deletes with the same accessibility, so an entry is findable again', async () => {
    await expoSecureStore.getItem('nexa.session');
    await expoSecureStore.removeItem('nexa.session');

    const options = { keychainAccessible: mockSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith('nexa.session', options);
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith('nexa.session', options);
  });
});

describe('SessionStore', () => {
  it('round-trips a session', async () => {
    const store = fakeStore();
    const subject = new SessionStore(store);

    await subject.write(SESSION);
    expect(await subject.read()).toEqual(SESSION);
  });

  it('refuses to write when the device has no protected store, and writes nowhere else', async () => {
    const store = fakeStore(false);
    const subject = new SessionStore(store);

    await expect(subject.write(SESSION)).rejects.toBeInstanceOf(SecureStoreUnavailableError);
    expect(store.setItem).not.toHaveBeenCalled();
    expect(store.values.size).toBe(0);
  });

  it('refuses to write a device token when the store is unavailable', async () => {
    const subject = new SessionStore(fakeStore(false));
    await expect(subject.writeDeviceToken('device-1')).rejects.toBeInstanceOf(
      SecureStoreUnavailableError,
    );
  });

  it('treats an unreadable stored value as no session, and removes it', async () => {
    const store = fakeStore();
    store.values.set('nexa.session', 'not json');
    const subject = new SessionStore(store);

    expect(await subject.read()).toBeNull();
    expect(store.values.has('nexa.session')).toBe(false);
  });

  it('treats a session missing its refresh token as no session', async () => {
    const store = fakeStore();
    store.values.set('nexa.session', JSON.stringify({ clientId: 'c', licenseId: '1' }));

    expect(await new SessionStore(store).read()).toBeNull();
  });

  it('clears the device token together with the session', async () => {
    const store = fakeStore();
    const subject = new SessionStore(store);

    await subject.write(SESSION);
    await subject.writeDeviceToken('device-1');
    await subject.clearAll();

    expect(await subject.read()).toBeNull();
    expect(await subject.readDeviceToken()).toBeNull();
  });

  it('never writes the access token — only the refresh token is persisted', async () => {
    const store = fakeStore();
    await new SessionStore(store).write(SESSION);

    const written = [...store.values.values()].join('\n');
    expect(written).toContain('refresh-1');
    expect(written).not.toContain('access');
  });
});

/**
 * The other half of "one store, and it is the encrypted one" is not a test at
 * all: no runtime assertion catches somebody *adding* an AsyncStorage fallback
 * "for simulators", because the app keeps working — that is the whole problem.
 * `eslint.config.js` refuses the imports and the two web storage globals inside
 * `src/auth` and `src/api`, so the gate that catches it is `pnpm -w lint`.
 */
