/**
 * The launch's retry loop (tm 435 · F17), against a real `MobileSession` whose
 * only fake is the network — so "a retryable failure" means exactly what
 * `#rotate` rethrows, and "signed in" means the session said so, not that a
 * mock was called.
 */
import type { AppStateStatus } from 'react-native';

import { SessionStore, type SecureKeyValueStore } from './secure-store';
import {
  RESTORE_RETRY_BASE_MS,
  RESTORE_RETRY_MAX_MS,
  SessionRestorer,
  restoreRetryDelay,
  type RestorableSession,
} from './restore-retry';
import { MobileSession } from './session';
import type { AppStateLike } from '../rtm/client';

const API = 'https://api.test/api/v1';

const GRANT = {
  access_token: 'access-1',
  token_type: 'Bearer',
  expires_in: 3600,
  refresh_token: 'refresh-2',
  account_id: 'acct-1',
  license_id: '42',
  organization_id: 'org-1',
};

const ME = {
  account_id: 'acct-1',
  organization_id: 'org-1',
  license_id: '42',
  scopes: ['chats--all:rw'],
  role: 'agent',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** What `/auth/token` answers, one entry per call; the last entry repeats. */
type TokenAnswer = 'offline' | 'unavailable' | 'revoked' | 'ok';

async function launch(answers: TokenAnswer[]) {
  const values = new Map<string, string>();
  const kv: SecureKeyValueStore = {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => {
      values.set(key, value);
    },
    removeItem: async (key) => {
      values.delete(key);
    },
    isAvailable: async () => true,
  };
  const store = new SessionStore(kv);
  await store.write({
    refreshToken: 'refresh-1',
    clientId: 'siyahtus-agent-app-1',
    licenseId: '42',
    accountId: 'acct-1',
  });

  let tokenCalls = 0;
  const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input).replace(API, '')}`;
    if (key === 'POST /auth/token') {
      const answer = answers[Math.min(tokenCalls, answers.length - 1)];
      tokenCalls += 1;
      if (answer === 'offline') throw new TypeError('Network request failed');
      if (answer === 'unavailable') {
        return json({ error: { type: 'service_unavailable', message: 'down' } }, 503);
      }
      if (answer === 'revoked') {
        return json({ error: { type: 'authentication', message: 'revoked' } }, 401);
      }
      return json(GRANT);
    }
    if (key === 'GET /auth/me') return json(ME);
    throw new Error(`No route for ${key}`);
  }) as unknown as typeof fetch;

  const session = new MobileSession({ apiBaseUrl: API, store, fetchImpl });
  const restore = jest.spyOn(session, 'restore');
  const appState = fakeAppState();
  const restorer = new SessionRestorer({ session, appState: appState.api });
  return { session, store, restore, restorer, appState, tokenCalls: () => tokenCalls };
}

function fakeAppState() {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const api: AppStateLike = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  return {
    api,
    emit: (state: AppStateStatus) => listeners.forEach((listener) => listener(state)),
    count: () => listeners.size,
  };
}

/** Let the in-flight attempt's promise chain run to the end without moving the clock. */
const settle = () => jest.advanceTimersByTimeAsync(0);

let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => unhandled.push(reason);

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  unhandled = [];
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  jest.useRealTimers();
});

describe('restoreRetryDelay', () => {
  it('doubles from one second and stops at thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map(restoreRetryDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000,
    ]);
    expect(RESTORE_RETRY_BASE_MS).toBe(1_000);
    expect(RESTORE_RETRY_MAX_MS).toBe(30_000);
    // A very long night offline neither overflows nor shrinks the wait.
    expect(restoreRetryDelay(10_000)).toBe(30_000);
  });
});

describe('SessionRestorer', () => {
  it('signs in after two retryable failures, waiting 1 s then 2 s between them', async () => {
    const h = await launch(['offline', 'unavailable', 'ok']);

    h.restorer.start();
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.session.getState().status).toBe('unknown');

    // Nothing before the first wait is up.
    await jest.advanceTimersByTimeAsync(RESTORE_RETRY_BASE_MS - 1);
    expect(h.restore).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.restore).toHaveBeenCalledTimes(2);
    expect(h.session.getState().status).toBe('unknown');

    // The second wait is twice the first.
    await jest.advanceTimersByTimeAsync(2 * RESTORE_RETRY_BASE_MS - 1);
    expect(h.restore).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(1);
    expect(h.restore).toHaveBeenCalledTimes(3);

    expect(h.session.getState().status).toBe('signed-in');
    expect(h.session.getState().principal).toMatchObject({ account_id: 'acct-1' });
    expect((await h.store.read())!.refreshToken).toBe('refresh-2');

    // Decided: no timer left behind, and nothing more is attempted.
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(RESTORE_RETRY_MAX_MS * 2);
    expect(h.restore).toHaveBeenCalledTimes(3);
    expect(unhandled).toEqual([]);
    h.restorer.stop();
  });

  it('keeps an offline launch trying at a 30 s ceiling instead of giving up', async () => {
    const h = await launch(['offline']);

    h.restorer.start();
    await settle();
    // 1 + 2 + 4 + 8 + 16 s, then two 30 s waits: seven retries after the first try.
    await jest.advanceTimersByTimeAsync(31_000 + 2 * RESTORE_RETRY_MAX_MS);
    expect(h.restore).toHaveBeenCalledTimes(8);
    expect(h.session.getState().status).toBe('unknown');
    // The refresh token survives every one of them — offline is not "signed out".
    expect((await h.store.read())!.refreshToken).toBe('refresh-1');
    expect(unhandled).toEqual([]);
    h.restorer.stop();
  });

  it('signs out once on a refused refresh token and never retries it', async () => {
    const h = await launch(['revoked']);

    h.restorer.start();
    await settle();

    expect(h.session.getState().status).toBe('signed-out');
    expect(await h.store.read()).toBeNull();
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(RESTORE_RETRY_MAX_MS * 2);
    h.appState.emit('active');
    h.restorer.retryNow();
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(1);
    expect(h.tokenCalls()).toBe(1);
    h.restorer.stop();
  });

  it('a failure after the launch has decided is not retried', async () => {
    // Signed in, then the handset registration (or `/auth/me`) throws: the
    // inbox is already up, and a second rotation would buy nothing.
    let status: 'unknown' | 'signed-in' = 'unknown';
    const session: RestorableSession = {
      getState: () => ({ status }),
      restore: jest.fn(async () => {
        status = 'signed-in';
        throw new Error('push registration failed');
      }),
    };
    const restorer = new SessionRestorer({ session, appState: fakeAppState().api });

    restorer.start();
    await settle();
    await jest.advanceTimersByTimeAsync(RESTORE_RETRY_MAX_MS);

    expect(session.restore).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
    expect(unhandled).toEqual([]);
    restorer.stop();
  });

  it('tries at once when the app returns to the foreground, then backs off from 1 s again', async () => {
    const h = await launch(['offline', 'offline', 'offline', 'offline', 'ok']);

    h.restorer.start();
    await settle();
    await jest.advanceTimersByTimeAsync(1_000 + 2_000); // tries 2 and 3; now waiting 4 s
    expect(h.restore).toHaveBeenCalledTimes(3);

    h.appState.emit('background');
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(3);

    h.appState.emit('active');
    await settle();
    expect(h.restore).toHaveBeenCalledTimes(4); // without waiting out the 4 s
    expect(h.session.getState().status).toBe('unknown');

    // The pending 4 s wait was cancelled, and the next one starts at 1 s.
    await jest.advanceTimersByTimeAsync(RESTORE_RETRY_BASE_MS);
    expect(h.restore).toHaveBeenCalledTimes(5);
    expect(h.session.getState().status).toBe('signed-in');
    h.restorer.stop();
  });

  it('retryNow attempts immediately, and does nothing while an attempt is in flight', async () => {
    let release: (() => void) | null = null;
    let status: 'unknown' | 'signed-in' = 'unknown';
    const restore = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          release = () => reject(new Error('offline'));
        }),
    );
    const restorer = new SessionRestorer({
      session: { getState: () => ({ status }), restore },
      appState: fakeAppState().api,
    });

    restorer.start();
    restorer.retryNow();
    restorer.retryNow();
    expect(restore).toHaveBeenCalledTimes(1);

    release!();
    await settle();
    expect(jest.getTimerCount()).toBe(1); // waiting 1 s

    restorer.retryNow();
    expect(restore).toHaveBeenCalledTimes(2);
    expect(jest.getTimerCount()).toBe(0); // the wait it replaced is gone

    status = 'signed-in';
    release!();
    await settle();
    expect(jest.getTimerCount()).toBe(0);
    restorer.stop();
  });

  it('leaves no timer and no listener behind once stopped, even with an attempt still in flight', async () => {
    const h = await launch(['offline']);

    h.restorer.start();
    await settle();
    expect(jest.getTimerCount()).toBe(1);
    expect(h.appState.count()).toBe(1);

    h.restorer.stop();
    expect(jest.getTimerCount()).toBe(0);
    expect(h.appState.count()).toBe(0);
    await jest.advanceTimersByTimeAsync(RESTORE_RETRY_MAX_MS);
    expect(h.restore).toHaveBeenCalledTimes(1);

    // An attempt that fails after the stop schedules nothing either.
    let fail: (() => void) | null = null;
    const restore = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          fail = () => reject(new Error('offline'));
        }),
    );
    const restorer = new SessionRestorer({
      session: { getState: () => ({ status: 'unknown' }), restore },
      appState: fakeAppState().api,
    });
    restorer.start();
    restorer.stop();
    fail!();
    await settle();
    expect(jest.getTimerCount()).toBe(0);
    expect(unhandled).toEqual([]);
  });

  it('a stop and start in a row (React’s double mount) does not run two restores at once', async () => {
    const restore = jest.fn(() => new Promise<void>(() => {}));
    const restorer = new SessionRestorer({
      session: { getState: () => ({ status: 'unknown' }), restore },
      appState: fakeAppState().api,
    });

    restorer.start();
    restorer.stop();
    restorer.start();

    expect(restore).toHaveBeenCalledTimes(1);
    restorer.stop();
  });
});
