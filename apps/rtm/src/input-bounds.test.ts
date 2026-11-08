/**
 * The customer socket's collection bounds (tm 419 · `input-bounds.ts`).
 *
 * The visitor's socket is anyone's for a minted token, and `login` arrives
 * before that token is checked, so its push list is bounded before it is
 * walked — and before the authenticator is asked anything. `sync` keeps its
 * 200-chat ceiling, now counted without building the entries first.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { SocketAuthenticator } from './auth.js';
import type { Connection, ConnectionRegistry } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import {
  cursorsWithinBounds,
  hasMoreKeysThan,
  MAX_LOGIN_PUSHES,
  MAX_PUSH_VERSIONS,
  MAX_SYNC_CHAT_ID_LENGTH,
  MAX_SYNC_EVENT_ID_LENGTH,
  pushesWithinBounds,
} from './input-bounds.js';
import type { DecodedRequest } from './protocol.js';
import { MAX_SYNC_CHATS, type SyncService } from './sync.js';
import type { TypingService } from './typing.js';

describe('pushesWithinBounds', () => {
  it('takes a list or version-keyed lists up to the bound', () => {
    expect(pushesWithinBounds(Array(MAX_LOGIN_PUSHES).fill('incoming_event'))).toBe(true);
    expect(pushesWithinBounds({ '3.6': Array(MAX_LOGIN_PUSHES).fill('x') })).toBe(true);
    expect(pushesWithinBounds(undefined)).toBe(true);
    expect(pushesWithinBounds('incoming_event')).toBe(true);
  });

  it('refuses one push past the bound, in either form and across versions', () => {
    expect(pushesWithinBounds(Array(MAX_LOGIN_PUSHES + 1).fill(1))).toBe(false);
    expect(pushesWithinBounds({ '3.6': Array(MAX_LOGIN_PUSHES + 1).fill(1) })).toBe(false);
    const half = Array(MAX_LOGIN_PUSHES / 2 + 1).fill(1);
    expect(pushesWithinBounds({ '3.5': half, '3.6': half })).toBe(false);
  });

  it('refuses more versions than the bound, even with empty lists', () => {
    const versions = Object.fromEntries(
      Array.from({ length: MAX_PUSH_VERSIONS + 1 }, (_, i) => [`3.${i}`, []]),
    );
    expect(pushesWithinBounds(versions)).toBe(false);
  });
});

describe('hasMoreKeysThan', () => {
  it('counts own keys only, up to max + 1', () => {
    expect(hasMoreKeysThan({ a: 1, b: 2 }, 2)).toBe(false);
    expect(hasMoreKeysThan({ a: 1, b: 2, c: 3 }, 2)).toBe(true);
    const inherited = Object.create({ a: 1, b: 2, c: 3 }) as object;
    expect(hasMoreKeysThan(inherited, 0)).toBe(false);
  });
});

describe('Dispatcher — customer socket bounds (tm 419)', () => {
  function connection(side: 'agent' | 'customer', authenticated = false): Connection {
    return {
      id: 'c1',
      side,
      organizationId: '00000000-0000-4000-8000-000000000001',
      authenticated,
      licenseId: authenticated ? '1' : null,
      actorId: authenticated ? 'visitor-1' : null,
      actorType: authenticated ? side : null,
      groupIds: [],
      unrestricted: false,
      authority: null,
      impersonation: null,
      subscriptions: new Set<string>(),
      rateWindowStartedAt: 0,
      messagesInWindow: 0,
    } as unknown as Connection;
  }

  function dispatcher() {
    const authenticate = vi.fn(async () => ({ ok: false as const, reason: 'invalid' as const }));
    const sync = vi.fn(async () => ({ chats: [] }));
    const instance = new Dispatcher({
      registry: { authenticate: vi.fn() } as unknown as ConnectionRegistry,
      authenticator: { authenticate } as unknown as SocketAuthenticator,
      sync: { sync } as unknown as SyncService,
      typing: {} as TypingService,
      log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as Logger,
      onAuthenticated: async () => {},
      messagesPerSecond: 1000,
    });
    return { instance, authenticate, sync };
  }

  function request(action: 'login' | 'sync', payload: Record<string, unknown>): DecodedRequest {
    return { version: '3.6', request_id: 'r1', action, payload };
  }

  function errorOf(frame: string): { type: string; message: string } | undefined {
    return (JSON.parse(frame) as { payload: { error?: { type: string; message: string } } }).payload
      .error;
  }

  it('refuses an oversized push list on a customer login without asking the authenticator', async () => {
    const { instance, authenticate } = dispatcher();
    const frame = await instance.dispatch(
      connection('customer'),
      request('login', { token: 'tok', pushes: { '3.6': Array(130_000).fill(1) } }),
    );

    expect(errorOf(frame)).toMatchObject({
      type: 'validation',
      message: `login accepts at most ${MAX_LOGIN_PUSHES} push actions.`,
    });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('lets a customer login within the bound reach the authenticator', async () => {
    const { instance, authenticate } = dispatcher();
    const frame = await instance.dispatch(
      connection('customer'),
      request('login', { token: 'tok', pushes: { '3.6': ['incoming_event', 'chat_deactivated'] } }),
    );

    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(errorOf(frame)?.type).toBe('authentication');
  });

  it('leaves the agent socket’s login as it was', async () => {
    const { instance, authenticate } = dispatcher();
    await instance.dispatch(
      connection('agent'),
      request('login', { token: 'tok', pushes: Array(MAX_LOGIN_PUSHES + 1).fill('x') }),
    );

    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it('refuses a sync over the chat ceiling before reading a cursor', async () => {
    const { instance, sync } = dispatcher();
    const cursors = Object.fromEntries(
      Array.from({ length: MAX_SYNC_CHATS + 1 }, (_, i) => [`chat${i}`, null]),
    );
    const frame = await instance.dispatch(
      connection('customer', true),
      request('sync', { cursors }),
    );

    expect(errorOf(frame)?.type).toBe('limit_reached');
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs exactly the ceiling', async () => {
    const { instance, sync } = dispatcher();
    const cursors = Object.fromEntries(
      Array.from({ length: MAX_SYNC_CHATS }, (_, i) => [`chat${i}`, null]),
    );
    await instance.dispatch(connection('customer', true), request('sync', { cursors }));

    expect(sync).toHaveBeenCalledTimes(1);
  });

  it('refuses a sync whose cursor key no chat id could be — not echoed back, no chat read (tm 428 · NFR-S8)', async () => {
    const { instance, sync } = dispatcher();
    // What the echo was for: a kilobyte per key came back in `removed_chat_ids`.
    const longKey = `ECHO${'K'.repeat(1020)}`;
    const frame = await instance.dispatch(
      connection('customer', true),
      request('sync', { cursors: { TJ1H8CFKRV: null, [longKey]: null } }),
    );

    expect(errorOf(frame)).toMatchObject({
      type: 'validation',
      message: `sync cursors name a chat in at most ${MAX_SYNC_CHAT_ID_LENGTH} characters and an event in at most ${MAX_SYNC_EVENT_ID_LENGTH}.`,
    });
    expect(frame).not.toContain('ECHO');
    expect(sync).not.toHaveBeenCalled();
  });

  it('refuses a sync whose cursor value no event id could be', async () => {
    const { instance, sync } = dispatcher();
    const frame = await instance.dispatch(
      connection('agent', true),
      request('sync', { cursors: { TJ1H8CFKRV: `TJ1H8CFKRV_${'9'.repeat(40)}` } }),
    );

    expect(errorOf(frame)?.type).toBe('validation');
    expect(sync).not.toHaveBeenCalled();
  });

  it('syncs cursors at the bounds', async () => {
    const { instance, sync } = dispatcher();
    await instance.dispatch(
      connection('customer', true),
      request('sync', {
        cursors: { ['C'.repeat(MAX_SYNC_CHAT_ID_LENGTH)]: 'E'.repeat(MAX_SYNC_EVENT_ID_LENGTH) },
      }),
    );

    expect(sync).toHaveBeenCalledTimes(1);
  });
});

describe('cursorsWithinBounds (tm 428)', () => {
  it('holds the bounds to the id columns: chats.id varchar(12), events.id varchar(40)', () => {
    expect(MAX_SYNC_CHAT_ID_LENGTH).toBe(12);
    expect(MAX_SYNC_EVENT_ID_LENGTH).toBe(40);
  });

  it('takes keys up to a chat id and string values up to an event id; any other value is "no cursor"', () => {
    expect(cursorsWithinBounds({})).toBe(true);
    expect(cursorsWithinBounds({ TJ1H8CFKRV: 'TJ1H8CFKRV_7', ABCDEFGHJKMN: null })).toBe(true);
    expect(cursorsWithinBounds({ TJ1H8CFKRV: 7, X: { nested: 'x'.repeat(100) } })).toBe(true);
  });

  it('refuses one character past either bound', () => {
    expect(cursorsWithinBounds({ ['C'.repeat(MAX_SYNC_CHAT_ID_LENGTH + 1)]: null })).toBe(false);
    expect(cursorsWithinBounds({ C: 'E'.repeat(MAX_SYNC_EVENT_ID_LENGTH + 1) })).toBe(false);
  });

  it('reads own keys only', () => {
    const inherited = Object.create({ ['C'.repeat(100)]: null }) as object;
    expect(cursorsWithinBounds(inherited)).toBe(true);
  });
});
