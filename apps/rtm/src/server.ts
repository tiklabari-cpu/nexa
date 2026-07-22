/**
 * RTM gateway.
 *
 * Two Redis connections, deliberately: a client in subscriber mode may issue no
 * other commands, so health checks and anything else need their own.
 *
 * Connection limits come straight from v2-03 §7.5 — 30s login window, 15s ping,
 * 10 in-flight requests, 15s request deadline — kept compatible on purpose so a
 * client SDK written against the original protocol still works.
 */
import { createServer, type Server } from 'node:http';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import { pino, type Logger } from 'pino';
import { WebSocketServer, type WebSocket } from 'ws';
import { RTM_LIMITS } from '@nexa/types';
import { SocketAuthenticator, type SocketPrincipal } from './auth.js';
import type { RtmEnv } from './config/env.js';
import { ConnectionRegistry, type Connection } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import { Fanout } from './fanout.js';
import { decodeRequest, encodeError } from './protocol.js';
import { SyncService } from './sync.js';

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
  address: () => { port: number } | null;
}

export function buildRtmServer(env: RtmEnv, version = '0.1.0'): RtmServer {
  const log: Logger = pino({ level: env.LOG_LEVEL, name: 'nexa-rtm' });

  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  const commands = new Redis(env.REDIS_URL, {
    connectionName: 'nexa-rtm',
    maxRetriesPerRequest: 3,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });
  const subscriber = new Redis(env.REDIS_URL, {
    connectionName: 'nexa-rtm-sub',
    // A subscriber that gives up leaves clients silently stale, which is worse
    // than a noisy reconnect loop.
    maxRetriesPerRequest: null,
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });
  for (const client of [commands, subscriber]) {
    client.on('error', (error) => log.error({ err: error }, 'redis connection error'));
  }

  const registry = new ConnectionRegistry();
  const authenticator = new SocketAuthenticator(db, env.JWT_SIGNING_KEY_CUSTOMER);
  const sync = new SyncService(db);
  const fanout = new Fanout(subscriber, registry, log);

  const dispatcher = new Dispatcher({
    registry,
    authenticator,
    sync,
    log,
    messagesPerSecond: env.RATE_LIMIT_RTM_PER_SEC,
    onAuthenticated: async (_connection: Connection, principal: SocketPrincipal) => {
      // Subscribing on demand keeps a node from decoding traffic for tenants it
      // hosts nobody from.
      await fanout.ensureSubscribed(principal.licenseId);
    },
  });

  const http = createServer((req, res) => {
    if (req.url?.startsWith('/health')) {
      void health(commands, version, env, registry).then((body) => {
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

  // `noServer` so an unknown path is rejected during the handshake rather than
  // accepted and closed afterwards.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  http.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const side =
      url.pathname === RTM_PATHS.agent
        ? 'agent'
        : url.pathname === RTM_PATHS.customer
          ? 'customer'
          : null;

    // `organization_id` fixes the tenant for the socket's whole life and is
    // checked against the token at login.
    const organizationId = url.searchParams.get('organization_id');
    if (!side || !organizationId || !isUuid(organizationId)) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
      attach({ ws, side, organizationId, registry, dispatcher, log });
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
      await Promise.all([
        commands.quit().catch(() => commands.disconnect()),
        subscriber.quit().catch(() => subscriber.disconnect()),
        db.$disconnect(),
      ]);
    },
  };
}

async function health(
  redis: Redis,
  version: string,
  env: RtmEnv,
  registry: ConnectionRegistry,
): Promise<{ status: 'ok' | 'degraded'; [key: string]: unknown }> {
  let redisStatus: 'up' | 'down' = 'down';
  try {
    await redis.ping();
    redisStatus = 'up';
  } catch {
    redisStatus = 'down';
  }
  return {
    status: redisStatus === 'up' ? 'ok' : 'degraded',
    service: 'rtm',
    version,
    region: env.NEXA_REGION,
    connections: registry.size,
    dependencies: { redis: { status: redisStatus } },
  };
}

function attach(params: {
  ws: WebSocket;
  side: 'agent' | 'customer';
  organizationId: string;
  registry: ConnectionRegistry;
  dispatcher: Dispatcher;
  log: Logger;
}): void {
  const { ws, side, organizationId, registry, dispatcher, log } = params;
  const connection = registry.add({ ws, side, organizationId });

  // An unauthenticated socket is closed after the login window.
  const loginTimer = setTimeout(() => {
    if (!connection.authenticated) ws.close(4401, 'login timeout');
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
      send(ws, encodeError(decoded.requestId, decoded.action, decoded.error));
      return;
    }

    // Back-pressure: a client that fires faster than the server can answer is
    // told to slow down rather than being allowed to queue without limit.
    if (connection.pendingRequests >= RTM_LIMITS.maxPendingRequests) {
      send(
        ws,
        encodeError(decoded.value.request_id, decoded.value.action, {
          type: 'pending_requests_limit_reached',
          message: `At most ${RTM_LIMITS.maxPendingRequests} requests may be in flight per socket.`,
        }),
      );
      return;
    }

    connection.pendingRequests += 1;
    void dispatcher
      .dispatch(connection, decoded.value)
      .then(
        (frame) => send(ws, frame),
        (error: unknown) => {
          // Internals never reach the client; the log keeps the detail.
          log.error({ err: error, action: decoded.value.action }, 'rtm dispatch failed');
          send(
            ws,
            encodeError(decoded.value.request_id, decoded.value.action, {
              type: 'internal',
              message: 'Internal server error.',
            }),
          );
        },
      )
      .finally(() => {
        connection.pendingRequests -= 1;
      });
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

function send(ws: WebSocket, frame: string): void {
  try {
    ws.send(frame);
  } catch {
    // Socket closed between the decision to reply and the reply itself.
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
