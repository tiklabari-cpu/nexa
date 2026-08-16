/**
 * Where the session lives on the device.
 *
 * The refresh token is a bearer credential with a week of life in it, and a
 * phone is a thing that gets lost, backed up, and rooted. So it goes to the
 * platform's own protected store — Keychain on iOS, the Keystore-backed
 * `SharedPreferences` on Android — and nowhere else. `AsyncStorage` and the file
 * system are not fallbacks: both are plain, both survive into an unencrypted
 * backup, and a session that "still works when the Keychain is unavailable" is a
 * session stored in the clear.
 *
 * The access token is deliberately absent. It lives in memory for at most an
 * hour (D2) and is re-minted from the refresh token on the next launch, so
 * writing it down would add a second copy of a credential and buy nothing.
 *
 * The device push token is here too rather than beside the push code: it is the
 * thing that must be gone the instant a session ends (§C-A31 · 13.7-b), and
 * "gone" means gone from the same store, under the same clear.
 */
import * as SecureStore from 'expo-secure-store';

/** The narrow slice of `expo-secure-store` this app uses, so tests can stand in for it. */
export interface SecureKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** False on a device with no protected store — see {@link SessionStore}. */
  isAvailable(): Promise<boolean>;
}

export class SecureStoreUnavailableError extends Error {
  constructor() {
    super('This device has no secure storage; Nexa will not keep a session in the clear.');
    this.name = 'SecureStoreUnavailableError';
  }
}

/**
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is the two decisions that matter, in one
 * constant: the entry is unreadable while the phone is locked, and it is not
 * migrated into an iCloud backup or onto a replacement handset. A session is
 * bound to the device that signed in — restoring last year's backup must not
 * restore last year's session with it.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const expoSecureStore: SecureKeyValueStore = {
  getItem: (key) => SecureStore.getItemAsync(key, OPTIONS),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, OPTIONS),
  removeItem: (key) => SecureStore.deleteItemAsync(key, OPTIONS),
  isAvailable: () => SecureStore.isAvailableAsync(),
};

/** What survives a restart. Everything else is rebuilt from `/auth/me`. */
export interface PersistedSession {
  refreshToken: string;
  /** The workspace's OAuth client, from `/auth/login` rather than guessed. */
  clientId: string;
  licenseId: string;
  accountId: string;
}

const SESSION_KEY = 'nexa.session';
const DEVICE_TOKEN_KEY = 'nexa.device_token';

/**
 * The session and the device token, read and written as whole values.
 *
 * Every method refuses rather than degrades when the protected store is
 * missing. That is the point of the class: there is exactly one storage
 * back-end, it is the encrypted one, and no code path can quietly choose
 * another.
 */
export class SessionStore {
  readonly #store: SecureKeyValueStore;

  constructor(store: SecureKeyValueStore = expoSecureStore) {
    this.#store = store;
  }

  async read(): Promise<PersistedSession | null> {
    const raw = await this.#store.getItem(SESSION_KEY);
    if (raw === null) return null;

    const parsed: unknown = safeParse(raw);
    if (!isPersistedSession(parsed)) {
      // A value written by an older build, or a truncated one. Treated as no
      // session rather than as a half session: the alternative is a restore
      // that sends `undefined` as a refresh token and gets a 400 forever.
      await this.clearSession();
      return null;
    }
    return parsed;
  }

  async write(session: PersistedSession): Promise<void> {
    await this.#requireSecureStorage();
    await this.#store.setItem(SESSION_KEY, JSON.stringify(session));
  }

  async clearSession(): Promise<void> {
    await this.#store.removeItem(SESSION_KEY);
  }

  async readDeviceToken(): Promise<string | null> {
    return this.#store.getItem(DEVICE_TOKEN_KEY);
  }

  async writeDeviceToken(token: string): Promise<void> {
    await this.#requireSecureStorage();
    await this.#store.setItem(DEVICE_TOKEN_KEY, token);
  }

  async clearDeviceToken(): Promise<void> {
    await this.#store.removeItem(DEVICE_TOKEN_KEY);
  }

  /**
   * Both keys, always both. A sign-out that dropped the session and left the
   * push token behind would leave the phone receiving one workspace's messages
   * while signed in to another (§C-A31).
   */
  async clearAll(): Promise<void> {
    await Promise.all([this.clearSession(), this.clearDeviceToken()]);
  }

  async #requireSecureStorage(): Promise<void> {
    if (!(await this.#store.isAvailable())) throw new SecureStoreUnavailableError();
  }
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isPersistedSession(value: unknown): value is PersistedSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['refreshToken'] === 'string' &&
    candidate['refreshToken'] !== '' &&
    typeof candidate['clientId'] === 'string' &&
    candidate['clientId'] !== '' &&
    typeof candidate['licenseId'] === 'string' &&
    typeof candidate['accountId'] === 'string'
  );
}
