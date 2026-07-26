import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import type { WebSocket } from 'ws';
import type { Redis } from 'ioredis';
import type { PrismaClient } from '@prisma/client';
import { ConnectionRegistry, type Connection } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import { decodeRequest, type DecodedRequest } from './protocol.js';
import { TypingService } from './typing.js';

const ORG = '11111111-1111-4111-8111-111111111111';

function fakeSocket(): WebSocket {
  return { send: () => undefined, close: () => undefined } as unknown as WebSocket;
}

const silentLog = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
} as unknown as Logger;

function build(typing: Partial<TypingService>) {
  const registry = new ConnectionRegistry();
  const dispatcher = new Dispatcher({
    registry,
    authenticator: {} as never,
    sync: {} as never,
    typing: typing as TypingService,
    log: silentLog,
    onAuthenticated: async () => undefined,
    messagesPerSecond: 1_000,
  });
  return { registry, dispatcher };
}

function authed(registry: ConnectionRegistry, side: 'agent' | 'customer'): Connection {
  const conn = registry.add({ ws: fakeSocket(), side, organizationId: ORG });
  registry.authenticate(conn.id, {
    licenseId: '7',
    actorId: side === 'agent' ? 'agent-1' : 'cust-1',
    groupIds: side === 'agent' ? [1] : [],
    unrestricted: false,
  });
  return registry.get(conn.id)!;
}

function req(action: string, payload: Record<string, unknown>): DecodedRequest {
  const decoded = decodeRequest(
    JSON.stringify({ version: '3.6', request_id: 'r1', action, payload }),
  );
  if (!decoded.ok) throw new Error(`decode failed: ${JSON.stringify(decoded)}`);
  return decoded.value;
}

describe('dispatcher · send_typing_indicator', () => {
  it('sets the agent-typing flag when the agent can see the chat', async () => {
    const setAgentTyping = vi.fn().mockResolvedValue(undefined);
    const { registry, dispatcher } = build({
      canType: vi.fn().mockResolvedValue(true),
      setAgentTyping,
    });
    const conn = authed(registry, 'agent');

    const frame = await dispatcher.dispatch(
      conn,
      req('send_typing_indicator', { chat_id: 'CHAT1', is_typing: true }),
    );

    const message = JSON.parse(frame);
    expect(message.success).toBe(true);
    expect(message.payload).toEqual({ chat_id: 'CHAT1', is_typing: true });
    // Keyed by the socket's own licence — never a client-supplied one.
    expect(setAgentTyping).toHaveBeenCalledWith('7', 'CHAT1', true);
  });

  it('answers not_found — and sets nothing — for a chat the agent cannot see', async () => {
    const setAgentTyping = vi.fn().mockResolvedValue(undefined);
    const { registry, dispatcher } = build({
      canType: vi.fn().mockResolvedValue(false),
      setAgentTyping,
    });
    const conn = authed(registry, 'agent');

    const frame = await dispatcher.dispatch(
      conn,
      req('send_typing_indicator', { chat_id: 'SOMEONE_ELSE', is_typing: true }),
    );

    const message = JSON.parse(frame);
    expect(message.success).toBe(false);
    // A typing indicator must not confirm which chat ids exist.
    expect(message.payload.error.type).toBe('not_found');
    expect(setAgentTyping).not.toHaveBeenCalled();
  });

  it('refuses a customer socket — the visitor uses the Customer API', async () => {
    const canType = vi.fn().mockResolvedValue(true);
    const { registry, dispatcher } = build({ canType, setAgentTyping: vi.fn() });
    const conn = authed(registry, 'customer');

    const frame = await dispatcher.dispatch(
      conn,
      req('send_typing_indicator', { chat_id: 'CHAT1', is_typing: true }),
    );

    const message = JSON.parse(frame);
    expect(message.success).toBe(false);
    expect(message.payload.error.type).toBe('not_allowed');
    // Rejected before any access check runs.
    expect(canType).not.toHaveBeenCalled();
  });

  it('validates the payload', async () => {
    const { registry, dispatcher } = build({
      canType: vi.fn().mockResolvedValue(true),
      setAgentTyping: vi.fn(),
    });
    const conn = authed(registry, 'agent');

    const noChat = JSON.parse(
      await dispatcher.dispatch(conn, req('send_typing_indicator', { is_typing: true })),
    );
    expect(noChat.payload.error.type).toBe('validation');

    const badFlag = JSON.parse(
      await dispatcher.dispatch(
        conn,
        req('send_typing_indicator', { chat_id: 'CHAT1', is_typing: 'yes' }),
      ),
    );
    expect(badFlag.payload.error.type).toBe('validation');
  });
});

describe('TypingService · agent-typing flag', () => {
  const redis = {
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  };
  const service = new TypingService({} as unknown as PrismaClient, redis as unknown as Redis);

  it('sets a short-lived, licence-scoped key when typing starts', async () => {
    await service.setAgentTyping('7', 'CHAT1', true);
    expect(redis.set).toHaveBeenCalledWith('nexa:typing:7:CHAT1', '1', 'EX', 8);
  });

  it('clears the key when typing stops', async () => {
    await service.setAgentTyping('7', 'CHAT1', false);
    expect(redis.del).toHaveBeenCalledWith('nexa:typing:7:CHAT1');
  });
});
