/**
 * A socket lives no longer than its credential (tm 426.3): the timer armed at
 * login closes it with 4401 when the credential expires and is cleared when the
 * socket closes first — against a fake clock and fake sockets. The login path
 * that arms it is driven through the real `Dispatcher` with a stand-in
 * authenticator.
 */
import type { Logger } from 'pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebSocket } from 'ws';
import type { AuthResult, SocketAuthenticator, SocketPrincipal } from './auth.js';
import { ConnectionRegistry } from './connection.js';
import {
  armCredentialExpiry,
  CREDENTIAL_EXPIRED_CLOSE_CODE,
  disarmCredentialExpiry,
  MAX_TIMER_DELAY_MS,
} from './credential-expiry.js';
import { Dispatcher } from './dispatcher.js';
import type { DecodedRequest } from './protocol.js';
import { CREDENTIAL_REVOKED_CLOSE_CODE } from './revocation.js';
import type { SyncService } from './sync.js';
import type { TypingService } from './typing.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const T0 = Date.parse('2026-11-08T10:00:00.000Z');

const silentLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

function socket(registry = new ConnectionRegistry()) {
  const closes: Array<{ code: number; reason: string }> = [];
  const connection = registry.add({
    ws: {
      send: () => undefined,
      close: (code: number, reason: string) => closes.push({ code, reason }),
    } as unknown as WebSocket,
    side: 'agent',
    organizationId: ORG,
  });
  return { connection, closes, registry };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('armCredentialExpiry (tm 426.3)', () => {
  it('closes the socket with 4401 when the credential expires, not a moment before, and leaves no timer behind', () => {
    const { connection, closes } = socket();
    armCredentialExpiry(connection, new Date(T0 + 60 * 60_000));
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(60 * 60_000 - 1);
    expect(closes).toEqual([]);
    expect(connection.closedBy).toBeNull();

    vi.advanceTimersByTime(1);
    expect(closes).toEqual([{ code: 4401, reason: 'credential expired' }]);
    // The client's one signal: the same code a revoked credential closes with.
    expect(CREDENTIAL_EXPIRED_CLOSE_CODE).toBe(CREDENTIAL_REVOKED_CLOSE_CODE);
    expect(connection.closedBy).toBe('credential_expired');
    expect(connection.credentialExpiry).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a socket closed first takes its timer with it: nothing fires later', () => {
    const { connection, closes } = socket();
    armCredentialExpiry(connection, new Date(T0 + 60_000));

    disarmCredentialExpiry(connection);
    expect(vi.getTimerCount()).toBe(0);
    expect(connection.credentialExpiry).toBeNull();
    vi.advanceTimersByTime(10 * 60_000);
    expect(closes).toEqual([]);
    // A second disarm is a no-op.
    disarmCredentialExpiry(connection);
  });

  it('arms nothing for a credential with no expiry', () => {
    const { connection } = socket();
    armCredentialExpiry(connection, null);
    expect(vi.getTimerCount()).toBe(0);
    expect(connection.credentialExpiry).toBeNull();
  });

  it('re-arming replaces the timer rather than adding a second one', () => {
    const { connection, closes } = socket();
    armCredentialExpiry(connection, new Date(T0 + 60_000));
    armCredentialExpiry(connection, new Date(T0 + 120_000));
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(60_000);
    expect(closes).toEqual([]);
    vi.advanceTimersByTime(60_000);
    expect(closes).toHaveLength(1);
  });

  it("waits out an expiry beyond setTimeout's ceiling in steps instead of firing at once", () => {
    const { connection, closes } = socket();
    const year = 365 * 24 * 60 * 60_000;
    armCredentialExpiry(connection, new Date(T0 + year));

    vi.advanceTimersByTime(MAX_TIMER_DELAY_MS);
    expect(closes).toEqual([]);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(year - MAX_TIMER_DELAY_MS - 1);
    expect(closes).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(closes).toEqual([{ code: 4401, reason: 'credential expired' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('closes at once a credential already past its expiry', () => {
    const { connection, closes } = socket();
    armCredentialExpiry(connection, new Date(T0 - 1));
    expect(closes).toEqual([{ code: 4401, reason: 'credential expired' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ends an operator's session as a member at its window, saying so", () => {
    const { connection, closes } = socket();
    connection.impersonation = { mode: 'read_only', endsAt: new Date(T0 + 30 * 60_000) };
    armCredentialExpiry(connection, connection.impersonation.endsAt);

    vi.advanceTimersByTime(30 * 60_000);
    expect(closes).toEqual([{ code: 4401, reason: 'session ended' }]);
    expect(connection.closedBy).toBe('credential_expired');
  });

  it('leaves the first reason standing on a socket the gateway is closing already', () => {
    const { connection, closes } = socket();
    armCredentialExpiry(connection, new Date(T0 + 60_000));
    connection.closedBy = 'credential_revoked';

    vi.advanceTimersByTime(60_000);
    expect(closes).toEqual([]);
    expect(connection.closedBy).toBe('credential_revoked');
  });
});

describe('login arms the timer (tm 426.3)', () => {
  function principal(overrides: Partial<SocketPrincipal> = {}): SocketPrincipal {
    return {
      kind: 'agent',
      actorId: 'agent-1',
      licenseId: '7',
      organizationId: ORG,
      scopes: [],
      groupIds: [],
      unrestricted: false,
      authority: null,
      tokenId: 'token-1',
      ...overrides,
    };
  }

  function build(authenticate: () => Promise<AuthResult>) {
    const registry = new ConnectionRegistry();
    const dispatcher = new Dispatcher({
      registry,
      authenticator: { authenticate } as unknown as SocketAuthenticator,
      sync: {} as SyncService,
      typing: {} as TypingService,
      log: silentLog,
      onAuthenticated: async () => undefined,
      messagesPerSecond: 1_000,
    });
    return { registry, dispatcher };
  }

  const login: DecodedRequest = {
    version: '3.6',
    request_id: 'r1',
    action: 'login',
    payload: { token: 'tok' },
  };

  it("closes a logged-in member's socket when its access token expires", async () => {
    const { registry, dispatcher } = build(async () => ({
      ok: true,
      principal: principal({ expiresAt: new Date(T0 + 3_600_000) }),
    }));
    const { connection, closes } = socket(registry);

    const frame = JSON.parse(await dispatcher.dispatch(connection, login)) as { success: boolean };
    expect(frame.success).toBe(true);
    expect(connection.credentialExpiry).not.toBeNull();

    vi.advanceTimersByTime(3_600_000);
    expect(closes).toEqual([{ code: 4401, reason: 'credential expired' }]);
    expect(connection.closedBy).toBe('credential_expired');
  });

  it('arms nothing for a refused login, a visitor, or a token with no expiry', async () => {
    const refused = build(async () => ({ ok: false, reason: 'expired' }));
    const a = socket(refused.registry);
    await refused.dispatcher.dispatch(a.connection, login);
    expect(a.connection.credentialExpiry).toBeNull();

    const forever = build(async () => ({ ok: true, principal: principal({ expiresAt: null }) }));
    const b = socket(forever.registry);
    await forever.dispatcher.dispatch(b.connection, login);
    expect(b.connection.authenticated).toBe(true);
    expect(b.connection.credentialExpiry).toBeNull();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('arms nothing on a socket that closed while its credential was being read: no timer outlives it', async () => {
    let resolve!: (result: AuthResult) => void;
    const { registry, dispatcher } = build(
      () =>
        new Promise<AuthResult>((r) => {
          resolve = r;
        }),
    );
    const { connection } = socket(registry);
    const answer = dispatcher.dispatch(connection, login);
    // The close handler ran meanwhile: the socket is out of the registry.
    registry.remove(connection.id);
    resolve({ ok: true, principal: principal({ expiresAt: new Date(T0 + 60_000) }) });
    await answer;

    expect(connection.credentialExpiry).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
