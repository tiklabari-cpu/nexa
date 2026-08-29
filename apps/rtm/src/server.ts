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
import type { Duplex } from 'node:stream';
import { setTimeout as delay } from 'node:timers/promises';
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
import {
  classifyDisconnectReason,
  createTelemetry,
  type Telemetry,
} from './telemetry/telemetry.js';
import { TypingService } from './typing.js';

/**
 * How long `close()` waits for open sockets to answer the close frame before it
 * tears them down (M-OPS-b).
 *
 * `ws` gives a peer thirty seconds to send its own close frame back, which is
 * generous for a browser tab that went to sleep and far too long for a deploy:
 * the orchestrator's grace period expires first and SIGKILL ends the process
 * mid-drain anyway. A client that has not answered in five seconds is not going
 * to notice the difference between a clean close and a reset — it reconnects
 * either way — but the deploy notices the twenty-five seconds.
 */
const SOCKET_CLOSE_TIMEOUT_MS = 5_000;

/**
 * The listen backlog — how many completed TCP connections the kernel parks
 * before the process has called `accept()` on them (M-LOAD-CAP · §D127).
 *
 * Chosen rather than inherited: `http.listen(port, host, cb)` left this at
 * Node's default of 511, which was nobody's decision. The value matters here
 * more than it does for a request-shaped service, because §D127 measured what
 * overload actually looks like on this gateway — accepting sockets and running
 * a fan-out compete for the one JS thread, so the accept queue drains in bursts
 * separated by whole fan-outs rather than steadily.
 *
 * 1024 for two reasons:
 *
 *   - it absorbs those bursts. At the arrival rates the capacity ladder used
 *     (100-200 sockets/s) a queue this deep covers seconds of arrivals, which
 *     is far longer than any single fan-out pause measured;
 *   - it moves the refusal from the kernel to this process. A queue overflow is
 *     an anonymous `ECONNREFUSED` — indistinguishable, from the client's side,
 *     from a load generator that ran out of ephemeral ports, which is a
 *     confusion tm 161.3 had to spend an entire extra measurement run to
 *     resolve. Queueing instead lets the upgrade handler below refuse *by name*
 *     when {@link RtmEnv.maxConnections} says to, and say nothing at all when
 *     it does not.
 *
 * Not higher: Linux silently clamps this to `net.core.somaxconn` (4096 on
 * current kernels, 128 on older ones), so a larger number here would be a claim
 * the OS may not honour — and a socket that waits in the queue long enough
 * belongs to a client that has already given up on it.
 */
export const RTM_LISTEN_BACKLOG = 1024;

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

export function buildRtmServer(
  env: RtmEnv,
  version = '0.1.0',
  /**
   * Where log lines go. Omitted, pino's default (stdout) — same contract as
   * the API's `BuildServerOptions.logStream` (`apps/api/src/server.ts`): a
   * test passes a stream to read back what was actually written, which is the
   * only way to assert a log line's shape rather than that a call site exists.
   */
  logStream?: NodeJS.WritableStream,
  /**
   * OpenTelemetry instrumentation (M-OTEL-b). Omitted, it follows
   * `env.otelEnabled` (off under test) and `env.OTEL_EXPORTER` — same
   * contract as the API's `BuildServerOptions.telemetry`. Pass an instance to
   * inject an in-memory exporter, or `null` to force it off.
   */
  telemetry?: Telemetry | null,
): RtmServer {
  // Level follows `LOG_LEVEL` in every environment, same as the API
  // (`apps/api/src/server.ts`) — there is no dev/production branch to get out
  // of sync (M-OPS-c).
  const log: Logger = pino({ level: env.LOG_LEVEL, name: 'nexa-rtm' }, logStream);
  const startedAt = Date.now();

  // Same `telemetry !== undefined ? telemetry : env.otelEnabled ? … : null`
  // contract as the API's `buildServer` (M-OTEL-b): an explicit `null` or
  // instance always wins over the env-driven default, which is the path
  // tests take to inject an in-memory exporter.
  const telemetryInstance: Telemetry | null =
    telemetry !== undefined
      ? telemetry
      : env.otelEnabled
        ? createTelemetry({
            serviceName: 'nexa-rtm',
            serviceVersion: version,
            metricExporter: env.OTEL_EXPORTER,
            otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
          })
        : null;
  /**
   * Set the moment `close()` starts (M-OPS-b). Readiness turns false first and
   * new upgrades are refused, so the orchestrator stops routing here — and a
   * client whose socket is about to be closed reconnects to an instance that is
   * staying, rather than back into this one.
   */
  let draining = false;
  /**
   * True while upgrades are being turned away for hitting
   * {@link RtmEnv.maxConnections} (M-LOAD-CAP).
   *
   * Held only so the two *transitions* can be logged rather than every refusal:
   * at the ceiling, clients retry, so a line per refused upgrade would produce
   * its heaviest logging in the moment the process has the least room — and
   * "we started refusing" / "we stopped refusing" is the whole of what an
   * operator needs anyway. The instantaneous count stays readable on `/health`.
   */
  let atCeiling = false;

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
  // Pull-based: the gauge is only actually read when a collection happens
  // (on export or `flushMetrics`), so this costs nothing between exports.
  telemetryInstance?.instruments.activeConnections.addCallback((result) => {
    result.observe(registry.size);
  });
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
  const fanout = new Fanout(subscriber, registry, log, telemetryInstance);

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
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

    // LIVENESS (M-OPS-a): no dependency touch, always 200 while the process
    // is up — same reasoning as `apps/api/src/routes/health.ts`'s sibling
    // route. A Postgres outage must not make an orchestrator kill the one
    // process that could still recover once the dependency comes back.
    if (pathname === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          status: 'ok',
          service: 'rtm',
          uptime_s: Math.round((Date.now() - startedAt) / 100) / 10,
        }),
      );
      return;
    }

    // READINESS (M-OPS-a): today's dependency probe, unchanged — 503 takes
    // the instance out of rotation. Always the narrow body: an orchestrator
    // probe never carries a bearer token, so the admin-gated detail below
    // would never be reachable here anyway.
    if (pathname === '/health/ready') {
      // Draining short-circuits the probe: mid-close the connections it reads
      // may already be gone, so probing would spend the full
      // `HEALTH_PROBE_TIMEOUT_MS` on the way to the same 503 — and a readiness
      // answer that is slow during a drain is the one that arrives too late to
      // stop the traffic. `draining` rather than `degraded` because they call
      // for opposite responses: one is leaving on purpose, the other is broken.
      if (draining) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'draining', service: 'rtm' }));
        return;
      }
      void health(db, commands, version, env, registry).then(({ narrow }) => {
        res.writeHead(narrow.status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
        res.end(JSON.stringify(narrow));
      });
      return;
    }

    if (pathname === '/health') {
      // Draining wins over the admin body below, for the reason it does in
      // `apps/api/src/routes/health.ts`: anything still pointed at this route
      // from before the M-OPS-a split reads it as readiness, and a 200 here
      // during a drain keeps traffic arriving at a process that is closing.
      if (draining) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ status: 'draining', service: 'rtm' }));
        return;
      }
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
    // A socket accepted during the drain window would be closed seconds later
    // by the very `close()` that opened the window — and the client would
    // reconnect straight back here, because nothing told it this instance is
    // leaving. Refusing sends it to one that is staying.
    if (draining) {
      refuseUpgrade(
        socket,
        'draining',
        'The gateway is shutting down and is not taking new connections.',
      );
      return;
    }

    // CONNECTION CEILING (M-LOAD-CAP · §D127). Before this, the gateway had no
    // idea how many sockets it could serve and accepted them all: §D127
    // measured the consequence, which is not a refusal but a silent slide into
    // latency — the fan-out budget went first, and every already-connected
    // agent paid for the ones still arriving. Refusing is the honest failure of
    // the two, and it is the one a client and an orchestrator both know how to
    // react to.
    //
    // Checked before the path and tenant validation below on purpose: at the
    // ceiling the cheapest possible answer is the right one.
    //
    // `null` is unlimited, so an unconfigured deployment behaves exactly as it
    // did before this branch existed.
    if (env.maxConnections !== null && registry.size >= env.maxConnections) {
      if (!atCeiling) {
        atCeiling = true;
        log.warn(
          { connections: registry.size, max_connections: env.maxConnections },
          'rtm at connection ceiling: refusing new upgrades',
        );
      }
      refuseUpgrade(
        socket,
        'connection_limit_reached',
        'The gateway is at its connection ceiling and is not taking new connections.',
      );
      return;
    }

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

    // Logged here rather than next to the ceiling check above, so the line
    // means what it says: an upgrade is about to be accepted, not merely that
    // one arrived while there was room and then turned out to be malformed.
    if (atCeiling) {
      atCeiling = false;
      log.info(
        { connections: registry.size, max_connections: env.maxConnections },
        'rtm below connection ceiling: accepting upgrades again',
      );
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
      attach({
        ws,
        side,
        organizationId,
        registry,
        dispatcher,
        log,
        telemetry: telemetryInstance,
        isDraining: () => draining,
      });
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
        // Options form rather than `(port, host, cb)` so the backlog is a
        // decision this file makes — see {@link RTM_LISTEN_BACKLOG}. The
        // ceiling rides along in the boot line: "how many will this process
        // take" is the first thing anyone reading these logs during an
        // incident wants, and `null` there says "unlimited" out loud rather
        // than by omission.
        http.listen({ port: env.RTM_PORT, host: env.RTM_HOST, backlog: RTM_LISTEN_BACKLOG }, () => {
          log.info(
            {
              port: env.RTM_PORT,
              host: env.RTM_HOST,
              backlog: RTM_LISTEN_BACKLOG,
              max_connections: env.maxConnections,
            },
            'rtm listening',
          );
          resolve();
        });
      }),
    /**
     * Graceful drain (M-OPS-b), in the same order the API uses
     * (`apps/api/src/lib/shutdown.ts`) and for the same reason: an orchestrator
     * keeps routing here until a readiness probe fails, so anything that closes
     * before that probe had a chance to fail is a client dropped mid-handshake.
     *
     *   1. readiness turns false and new upgrades are refused;
     *   2. wait `SHUTDOWN_DRAIN_MS` — zero outside production, see `config/env.ts`;
     *   3. tell every open socket to go away with close code 1001 ("going
     *      away"), which a client reads as reconnect rather than as an error
     *      (`apps/web/src/lib/realtime.ts` retries any close it did not
     *      initiate) — so NFR-R2's reconnect + missed-event sync is what
     *      carries the session across the deploy;
     *   4. stop listening and let go of Postgres and Redis.
     */
    close: async () => {
      draining = true;
      if (env.shutdownDrainMs > 0) {
        log.info({ drain_ms: env.shutdownDrainMs }, 'draining: readiness is now false');
        await delay(env.shutdownDrainMs);
      }

      registry.closeAll(1001, 'server shutting down');
      await closeSockets(wss);
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        // A health probe's keep-alive connection is idle, not in flight, and
        // `close()` alone would wait for it — which is a shutdown that hangs on
        // a connection nobody is using.
        http.closeIdleConnections();
      });
      await Promise.all([
        commands.quit().catch(() => commands.disconnect()),
        subscriber.quit().catch(() => subscriber.disconnect()),
        publisher.quit().catch(() => publisher.disconnect()),
        db.$disconnect(),
        // A plain `shutdown()` would discard whatever the periodic reader has
        // not exported yet — and the disconnect reason this drain itself just
        // produced for every socket above (`server_shutdown`) is exactly that:
        // recorded a moment ago, never yet flushed. Flushing first is what
        // lets that count actually reach the exporter instead of only ever
        // existing in memory the process is about to leave.
        telemetryInstance
          ? telemetryInstance
              .flushMetrics()
              .catch(() => {})
              .then(() => telemetryInstance.shutdown())
          : Promise.resolve(),
      ]);
    },
  };
}

/**
 * Turn an upgrade away before the handshake, saying which of the gateway's two
 * refusals this is (M-OPS-b's drain and M-LOAD-CAP's ceiling).
 *
 * One function for both, because they are one decision — "this process is not
 * taking new sockets" — differing only in why, and a client that has to tell
 * `503 draining` apart from `503 full` by prose is a client that will not.
 * `service_unavailable` is the existing error type for exactly this
 * (`packages/types/src/errors.ts` maps it to 503); the machine-readable half of
 * "why" rides in `details.reason` rather than as a new type, since neither of
 * these is a new *category* of failure.
 *
 * What the body deliberately does not carry is the configured ceiling. That an
 * unauthenticated caller learns this instance is full is operationally
 * necessary — it is the difference between "the pod refused me" and "my machine
 * ran out of ports", which is the ambiguity §D127 had to pay a whole extra
 * measurement run to resolve. What it would be *capacity* for is the number,
 * and that stays where the rest of the fingerprintable detail is: behind
 * `/health`'s admin gate (M-SEC-b2).
 *
 * `end()` rather than `write()` + `destroy()`: destroy tears the socket down
 * immediately, including anything still buffered, so a body written that way
 * arrives only when the write happened to flush synchronously.
 */
function refuseUpgrade(
  socket: Duplex,
  reason: 'draining' | 'connection_limit_reached',
  message: string,
): void {
  const body = JSON.stringify({
    error: { type: 'service_unavailable', message, request_id: '-', details: { reason } },
  });
  socket.end(
    'HTTP/1.1 503 Service Unavailable\r\n' +
      'Connection: close\r\n' +
      'Content-Type: application/json\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      '\r\n' +
      body,
  );
}

/**
 * Wait for every socket to answer its close frame, then stop waiting.
 *
 * `wss.close()` resolves only once the last client has gone, and `ws` will sit
 * on an unanswered close frame for thirty seconds. A peer that is asleep or
 * whose network vanished would hold the whole shutdown open for that long, so
 * after {@link SOCKET_CLOSE_TIMEOUT_MS} the stragglers are torn down — which
 * their clients see as a dropped connection and handle exactly the way they
 * handle any other one: by reconnecting.
 */
async function closeSockets(wss: WebSocketServer): Promise<void> {
  const closed = new Promise<void>((resolve) => wss.close(() => resolve()));

  let timer: NodeJS.Timeout | undefined;
  const outcome = await Promise.race([
    closed.then(() => 'closed' as const),
    new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), SOCKET_CLOSE_TIMEOUT_MS);
      // Never the reason the process stays alive.
      timer.unref?.();
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (outcome === 'closed') return;

  for (const client of wss.clients) client.terminate();
  await closed;
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
      // The ceiling next to the count it bounds (M-LOAD-CAP): a number of open
      // sockets means nothing without the number this process will stop at, and
      // reading them from two different places is how they get compared across
      // two different moments. `null` is unlimited, stated rather than omitted
      // — an absent field reads as "this build does not report it".
      //
      // Admin-only along with everything else in this body (M-SEC-b2): the
      // ceiling is capacity intelligence, and the refusal an anonymous caller
      // gets on the upgrade path names the *reason* without the number.
      max_connections: env.maxConnections,
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
  telemetry: Telemetry | null;
  /** Read at close time, not captured once — the drain can start mid-connection. */
  isDraining: () => boolean;
}): void {
  const { ws, side, organizationId, registry, dispatcher, log, telemetry, isDraining } = params;
  const connection = registry.add({ ws, side, organizationId });

  // Set when `ws` itself detects a framing problem (oversized payload, bad
  // opcode, invalid UTF-8, …) — its own errors all carry a `WS_ERR_*` code
  // (`ws/lib/receiver.js#createError`). This has to be read here rather than
  // from the close code below: a self-detected error already leaves the
  // receiver in an errored state, so `websocket.close()` tears the socket
  // down immediately instead of waiting out the normal two-way handshake —
  // which means the *local* close code comes back as the generic 1006 ("no
  // status received"), not the specific violation code that was actually
  // sent to the peer. `classifyDisconnectReason`'s code-based check still
  // covers the other, legitimate case: a remote peer closing on its own with
  // one of these codes, which *does* complete a normal handshake.
  let protocolViolation = false;

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
          // Internals never reach the client; the log keeps the detail. The
          // failing request's own `request_id` rides along (NFR-M5) — without
          // it this line cannot be pinned to the frame the client is still
          // waiting on, the one correlation an operator actually needs here.
          log.error(
            { err: error, action: decoded.value.action, request_id: decoded.value.request_id },
            'rtm dispatch failed',
          );
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

  ws.on('close', (code) => {
    clearTimeout(loginTimer);
    clearInterval(idleTimer);
    registry.remove(connection.id);
    telemetry?.instruments.disconnects.add(1, {
      reason: protocolViolation
        ? 'protocol_violation'
        : classifyDisconnectReason(code, isDraining()),
    });
  });

  ws.on('error', (error) => {
    if (typeof (error as NodeJS.ErrnoException).code === 'string') {
      protocolViolation =
        protocolViolation || (error as NodeJS.ErrnoException).code!.startsWith('WS_ERR_');
    }
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
