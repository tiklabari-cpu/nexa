/**
 * Maintenance mode at the gateway (tm 389.13 · FR-ADMIN-15): the key the root panel and the
 * tenant API's leader write, read as a mode; sockets closed once when `full` begins; `login`
 * refused with `maintenance` while it lasts; a Redis that cannot be read keeps the last answer.
 */
import { EventEmitter } from 'node:events';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';
import { OPS_MAINTENANCE_KEY, PLATFORM_OPS_CHANNEL } from '@siyahtus/types';
import { describe, expect, it, vi } from 'vitest';
import { ConnectionRegistry } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import {
  listenForMaintenanceChanges,
  MaintenanceWatch,
  parseMaintenanceKey,
} from './maintenance.js';
import { decodeRequest } from './protocol.js';

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;

function redisWith(value: () => string | null | Error) {
  return {
    get: vi.fn(async (key: string) => {
      expect(key).toBe(OPS_MAINTENANCE_KEY);
      const next = value();
      if (next instanceof Error) throw next;
      return next;
    }),
  } as unknown as Pick<Redis, 'get'>;
}

describe('parseMaintenanceKey', () => {
  it('reads the two modes and nothing else', () => {
    expect(parseMaintenanceKey(JSON.stringify({ mode: 'full' }))).toBe('full');
    expect(parseMaintenanceKey(JSON.stringify({ mode: 'read_only' }))).toBe('read_only');
    expect(parseMaintenanceKey(null)).toBeNull();
    expect(parseMaintenanceKey(JSON.stringify({ mode: 'off' }))).toBeNull();
    expect(parseMaintenanceKey('not json')).toBeNull();
  });
});

describe('MaintenanceWatch', () => {
  it('closes the sockets once when full maintenance begins, and lets logins back after', async () => {
    let stored: string | null = null;
    const onFull = vi.fn();
    const watch = new MaintenanceWatch(
      redisWith(() => stored),
      log,
      onFull,
    );

    await watch.refresh();
    expect(watch.full).toBe(false);

    stored = JSON.stringify({ mode: 'read_only' });
    await watch.refresh();
    expect(watch.full).toBe(false);
    expect(onFull).not.toHaveBeenCalled();

    stored = JSON.stringify({ mode: 'full' });
    await watch.refresh();
    await watch.refresh();
    expect(watch.full).toBe(true);
    expect(onFull).toHaveBeenCalledTimes(1);

    stored = null;
    await watch.refresh();
    expect(watch.full).toBe(false);
  });

  it('keeps the last answer when Redis cannot be read', async () => {
    let next: string | null | Error = JSON.stringify({ mode: 'full' });
    const watch = new MaintenanceWatch(
      redisWith(() => next),
      log,
      vi.fn(),
    );
    await watch.refresh();
    next = new Error('ECONNRESET');
    await watch.refresh();
    expect(watch.full).toBe(true);
  });

  it('re-reads on settings.changed and on an unreadable message, and ignores other channels', async () => {
    const subscriber = new EventEmitter() as EventEmitter & { subscribe: ReturnType<typeof vi.fn> };
    subscriber.subscribe = vi.fn(async () => 1);
    const redis = redisWith(() => null);
    const watch = new MaintenanceWatch(redis, log, vi.fn());
    await listenForMaintenanceChanges(subscriber as unknown as Redis, watch);
    expect(subscriber.subscribe).toHaveBeenCalledWith(PLATFORM_OPS_CHANNEL);

    subscriber.emit('message', PLATFORM_OPS_CHANNEL, JSON.stringify({ type: 'settings.changed' }));
    subscriber.emit('message', PLATFORM_OPS_CHANNEL, '{');
    subscriber.emit('message', PLATFORM_OPS_CHANNEL, JSON.stringify({ type: 'job.run' }));
    subscriber.emit('message', 'permissions.changed', 'x');
    await vi.waitFor(() => expect(redis.get).toHaveBeenCalledTimes(2));
  });
});

describe('login in full maintenance', () => {
  it('is refused with the REST edge’s maintenance type, before the token is looked at', async () => {
    const registry = new ConnectionRegistry();
    const connection = registry.add({
      ws: { close: vi.fn(), send: vi.fn() } as unknown as WebSocket,
      side: 'agent',
      organizationId: 'org-1',
    });
    const authenticate = vi.fn();
    const dispatcher = new Dispatcher({
      registry,
      authenticator: { authenticate } as never,
      sync: {} as never,
      typing: {} as never,
      log,
      onAuthenticated: vi.fn(),
      messagesPerSecond: 50,
      inMaintenance: () => true,
    });
    const request = decodeRequest(
      JSON.stringify({ request_id: 'r1', action: 'login', payload: { token: 't' } }),
    );
    if (!request.ok) throw new Error('fixture did not decode');
    const frame = JSON.parse(await dispatcher.dispatch(connection, request.value)) as {
      success: boolean;
      payload: { error: { type: string } };
    };
    expect(frame.success).toBe(false);
    expect(frame.payload.error.type).toBe('maintenance');
    expect(authenticate).not.toHaveBeenCalled();
  });
});
