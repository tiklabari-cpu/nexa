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
import { RTM_LIMITS, RTM_PATHS, roleAtLeast } from '@nexa/types';
import { SocketAuthenticator, type SocketPrincipal } from './auth.js';
import type { RtmEnv } from './config/env.js';
import { ConflictDetectionService } from './conflict.js';
import { ConflictPublisher } from './conflict-publisher.js';
import { ConnectionRegistry, type Connection } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import { Fanout } from './fanout.js';
import { decodeRequest, encodeError } from './protocol.js';
import { SyncService } from './sync.js';
import { TypingService } from './typing.js';

// Defined in `@nexa/types` so the gateway and its clients cannot disagree about
// it; re-exported here because this is where callers have always imported it.
export { RTM_PATHS };

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
  // A third connection for the one thing the gateway publishes — conflict
  // warnings — so a burst of them cannot queue behind the RLS and Lua commands
  // typing and conflict detection run on `commands`.
  const publisher = new Redis(env.REDIS_URL, {
    connectionName: 'nexa-rtm-pub',
    maxRetriesPerRequest: 3,
    retryStrategy: (attempt) => Math.min(attempt * 200, 3_000),
  });
  for (const client of [commands, subscriber, publisher]) {
    client.on('error', (error) => log.error({ err: error }, 'redis connection error'));
  }

  const registry = new ConnectionRegistry();
  const authenticator = new SocketAuthenticator(db, env.JWT_SIGNING_KEY_CUSTOMER, env.NEXA_REGION);
  const sync = new SyncService(db);
  // Typing flags are written on the command connection: a subscriber-mode client
  // may issue no other commands, so it cannot be reused for a `SET`.
  const typing = new TypingService(db, commands);
  // Conflict detection registers composing agents on the command connection (its
  // Redis registry is a Lua script), then hands the decision to the publisher,
  // which emits the warning on the dedicated publish connection.
  const conflict = new ConflictDetectionService(db, commands);
  const conflictPublisher = new ConflictPublisher(db, publisher, log);
  const fanout = new Fanout(subscriber, registry, log);

  const dispatcher = new Dispatcher({
    registry,
    authenticator,
    sync,
    typing,
    conflict,
    conflictPublisher,
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
      // Same narrowing as `apps/api/src/routes/health.ts` (M-SEC-b2 · §D116
      // MEDIUM (b)): region/connection-count/dependency detail is
      // infrastructure fingerprinting, admin-role callers only. Run alongside
      // the dependency probes, not after them — both are independently bounded
      // (`HEALTH_PROBE_TIMEOUT_MS`), and chaining them would mean an admin
      // token presented while Postgres is down waits out that same timeout
      // twice before /health answers at all, which defeats the point of a
      // readiness probe when the dependency it reports on is the one that is
      // actually unreachable.
      void Promise.all([
        health(db, commands, version, env, registry),
        wantsHealthDetail(req.headers.authorization, authenticator),
      ]).then(([body, detailed]) => {
        const response = detailed ? body.detailed : body.narrow;
        res.writeHead(response.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(response));
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
        publisher.quit().catch(() => publisher.disconnect()),
        db.$disconnect(),
      ]);
    },
  };
}

interface RtmDependencyHealth {
  status: 'up' | 'down';
  error?: string;
}

const HEALTH_PROBE_TIMEOUT_MS = 2_000;

// Same shape as `apps/api/src/routes/health.ts`'s `probe`: a dependency that
// never answers must not hang the health check forever, and a driver error can
// carry a connection string, so only its class is surfaced.
async function probeHealth(
  name: string,
  check: () => Promise<unknown>,
): Promise<RtmDependencyHealth> {
  try {
    const outcome = check();
    // A slow dependency can still reject well after the timeout branch below
    // has already won the race — without this, that later rejection has no
    // handler left and surfaces as an unhandled rejection instead of the 503
    // this function already answered.
    outcome.catch(() => {});
    await Promise.race([
      outcome,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${name} probe timed out`)), HEALTH_PROBE_TIMEOUT_MS),
      ),
    ]);
    return { status: 'up' };
  } catch (error) {
    return { status: 'down', error: error instanceof Error ? error.name : 'unknown error' };
  }
}

// Undefined header → no token to resolve; the common anonymous-probe case
// never touches the database. A presented token is bound by the same
// `HEALTH_PROBE_TIMEOUT_MS` the dependency probes use — resolving it means a
// query against the very Postgres this check might be reporting as down, and
// an admin caller's credential must not be why an otherwise-fast 503 hangs.
// Unresolvable (timeout, malformed token, database down) fails closed to "not
// admin", the same posture as an anonymous request.
async function wantsHealthDetail(
  authorization: string | undefined,
  authenticator: SocketAuthenticator,
): Promise<boolean> {
  if (!authorization) return false;
  try {
    const outcome = authenticator.resolveAdminRole(authorization);
    // Same reasoning as `probeHealth`: a resolution that outlives the race
    // below must not surface as an unhandled rejection later.
    outcome.catch(() => {});
    const role = await Promise.race([
      outcome,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), HEALTH_PROBE_TIMEOUT_MS)),
    ]);
    return role !== null && roleAtLeast(role, 'admin');
  } catch {
    return false;
  }
}

interface HealthBodies {
  narrow: { status: 'ok' | 'degraded'; service: string };
  detailed: { status: 'ok' | 'degraded'; [key: string]: unknown };
}

async function health(
  db: PrismaClient,
  redis: Redis,
  version: string,
  env: RtmEnv,
  registry: ConnectionRegistry,
): Promise<HealthBodies> {
  // Every agent login reads Postgres (`auth.ts`) — a gateway that reports `ok`
  // with the database down accepts no logins while claiming to be healthy.
  const [database, redisHealth] = await Promise.all([
    probeHealth('database', () => db.$queryRaw`SELECT 1`),
    probeHealth('redis', () => redis.ping()),
  ]);
  const status = database.status === 'up' && redisHealth.status === 'up' ? 'ok' : 'degraded';

  return {
    narrow: { status, service: 'rtm' },
    detailed: {
      status,
      service: 'rtm',
      version,
      region: env.NEXA_REGION,
      connections: registry.size,
      dependencies: { database, redis: redisHealth },
    },
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
