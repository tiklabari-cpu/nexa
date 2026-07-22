/**
 * RTM gateway.
 *
 * Slice 1 stands up the transport: HTTP health, the WebSocket upgrade path, the
 * envelope codec and the connection limits from v2-03 §7.5 (30s login window,
 * 15s ping, 10 in-flight requests, 15s request deadline). The action handlers,
 * Redis fan-out and missed-event `sync` land in slice 5.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { pino, type Logger } from 'pino';
import { Redis } from 'ioredis';
import { WebSocketServer, type WebSocket } from 'ws';
import { RTM_LIMITS, RTM_VERSION } from '@nexa/types';
import type { RtmEnv } from './config/env.js';
import { ConnectionRegistry } from './connection.js';
import { decodeRequest, encodeError, encodeResponse } from './protocol.js';

export const RTM_PATHS = {
  agent: '/v1/agent/rtm/ws',
  customer: '/v1/customer/rtm/ws',
} as const;

export interface RtmServer {
  http: Server;
  wss: WebSocketServer;
  registry: ConnectionRegistry;
  listen: () => Promise<void>;
  close: () => Promise<void>;
  /** Bound port — resolved after listen(), useful when the port is 0 in tests. */
  address: () => { port: number } | null;
}

export function buildRtmServer(env: RtmEnv, version = '0.1.0'): RtmServer {
  const log: Logger = pino({ level: env.LOG_LEVEL, name: 'nexa-rtm' });
  const redis = new Redis(env.REDIS_URL, {
    connectionName: 'nexa-rtm',
    maxRetriesPerRequest: 3,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });
  redis.on('error', (error) => log.error({ err: error }, 'redis connection error'));

  const registry = new ConnectionRegistry();

  const http = createServer((req, res) => {
    if (req.url?.startsWith('/health')) {
      void handleHealth(redis, version, env).then((body) => {
        res.writeHead(body.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        error: { type: 'not_found', message: 'Route not found.', request_id: '-' },
      }),
    );
  });

  // `noServer` so we can reject unknown paths during the upgrade handshake
  // rather than accepting the socket and closing it afterwards.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  http.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const side =
      url.pathname === RTM_PATHS.agent
        ? 'agent'
        : url.pathname === RTM_PATHS.customer
          ? 'customer'
          : null;

    // `organization_id` is a required query param — it selects the tenant the
    // socket may ever see, and is validated against the token at login.
    const organizationId = url.searchParams.get('organization_id');
    if (!side || !organizationId) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
      attachConnection({ ws, request, side, organizationId, registry, log });
    });
  });

  return {
    http,
    wss,
    registry,
    address: () => {
      const address = http.address();
      return address && typeof address === 'object' ? { port: address.port } : null;
    },
    listen: () =>
      new Promise<void>((resolve) => {
        http.listen(env.RTM_PORT, env.RTM_HOST, () => {
          log.info({ port: env.RTM_PORT, host: env.RTM_HOST }, 'rtm listening');
          resolve();
        });
      }),
    close: async () => {
      registry.closeAll(1001, 'server shutting down');
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
      await redis.quit().catch(() => redis.disconnect());
    },
  };
}

async function handleHealth(redis: Redis, version: string, env: RtmEnv) {
  let redisStatus: 'up' | 'down' = 'down';
  try {
    await redis.ping();
    redisStatus = 'up';
  } catch {
    redisStatus = 'down';
  }
  return {
    status: redisStatus === 'up' ? ('ok' as const) : ('degraded' as const),
    service: 'rtm',
    version,
    region: env.NEXA_REGION,
    dependencies: { redis: { status: redisStatus } },
  };
}

function attachConnection(params: {
  ws: WebSocket;
  request: IncomingMessage;
  side: 'agent' | 'customer';
  organizationId: string;
  registry: ConnectionRegistry;
  log: Logger;
}): void {
  const { ws, side, organizationId, registry, log } = params;
  const connection = registry.add({ ws, side, organizationId });

  // An unauthenticated socket is closed after the login window (v2-03 §7.5).
  const loginTimer = setTimeout(() => {
    if (!connection.authenticated) {
      ws.close(4401, 'login timeout');
    }
  }, RTM_LIMITS.loginTimeoutMs);

  const idleTimer = setInterval(() => {
    if (Date.now() - connection.lastSeenAt > RTM_LIMITS.idleTimeoutMs) {
      ws.close(4408, 'idle timeout');
    }
  }, RTM_LIMITS.pingIntervalMs);

  ws.on('message', (raw) => {
    connection.lastSeenAt = Date.now();
    const decoded = decodeRequest(raw.toString());
    if (!decoded.ok) {
      ws.send(encodeError(decoded.requestId, decoded.action, decoded.error));
      return;
    }
    const message = decoded.value;

    if (message.action === 'ping') {
      ws.send(encodeResponse(message.request_id, 'ping', { version: RTM_VERSION }));
      return;
    }

    // Slice 5 replaces this with the real dispatcher.
    ws.send(
      encodeError(message.request_id, message.action, {
        type: 'not_allowed',
        message: `Action "${message.action}" is not available yet.`,
      }),
    );
  });

  ws.on('close', () => {
    clearTimeout(loginTimer);
    clearInterval(idleTimer);
    registry.remove(connection.id);
  });

  ws.on('error', (error) => {
    log.warn({ err: error, connection_id: connection.id, side }, 'socket error');
  });
}
