/**
 * Where the run points, and how hard it pushes.
 *
 * Everything is read from `__ENV` with a default that is safe against a local
 * `make dev` stack, so `k6 run scenarios/smoke.js` needs no arguments. The
 * defaults are deliberately small: this suite runs against a developer laptop
 * that is also running Postgres, Redis and four Node processes, and a profile
 * that saturates the machine measures the machine, not the product.
 *
 * k6-only module — `__ENV` does not exist under Node, so nothing here is
 * importable from the guard test. Numbers that the guard has to see live in
 * `thresholds.js`.
 */
import { RTM_AGENT_PATH } from './protocol.js';

/** `__ENV.NAME`, or `fallback` when unset or empty. */
function env(name, fallback) {
  const value = __ENV[name];
  return value === undefined || value === '' ? fallback : value;
}

/** `__ENV.NAME` as a positive integer, or `fallback`. */
function envInt(name, fallback) {
  const raw = env(name, null);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/** `__ENV.NAME` as a non-negative integer — 0 is a real answer ("off"). */
function envCount(name, fallback) {
  const raw = env(name, null);
  if (raw === null) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

/** `__ENV.NAME` as a positive number, or `fallback`. */
function envNumber(name, fallback) {
  const raw = env(name, null);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
  }
  return parsed;
}

const apiOrigin = env('LOAD_API_ORIGIN', 'http://localhost:4000');
const rtmOrigin = env('LOAD_RTM_ORIGIN', 'ws://localhost:4001');

export const CONFIG = Object.freeze({
  /** Everything the REST scenarios call sits under this prefix (`API_PREFIX`). */
  apiBaseUrl: `${apiOrigin}/api/v1`,
  /** Liveness/readiness live next to the API routes, same prefix. */
  healthUrl: `${apiOrigin}/api/v1/health/ready`,
  /** The agent RTM socket. `?organization_id=` is appended by the caller. */
  rtmUrl: `${rtmOrigin}${RTM_AGENT_PATH}`,
  /**
   * The gateway's own health route, over HTTP rather than the socket.
   *
   * Presented with an admin credential it answers with `connections` — how many
   * sockets *the pod* is holding — which is the only honest reading of NFR-P8
   * (`lib/metrics.js#rtmConnectionsObserved`). Derived from the socket origin
   * rather than configured separately so the two can never point at different
   * processes, which is precisely the mistake that would make the number a lie.
   */
  rtmHealthUrl: `${rtmOrigin.replace(/^ws/, 'http')}/health`,

  /**
   * The seeded owner the suite signs in as. `prisma/seed.ts` writes
   * `owner@<slug>.localhost` for every tenant and gives them all the same demo
   * password; `apps/e2e/tests/fixtures.ts` uses exactly these credentials.
   */
  email: env('LOAD_EMAIL', 'owner@acme.localhost'),
  password: env('LOAD_PASSWORD', 'nexa-demo-password'),
  /** Memberships are matched on this prefix — an owner may hold several. */
  orgPrefix: env('LOAD_ORG_PREFIX', 'Acme'),
  /** The panel's registered redirect URI; `/auth/authorize` checks it. */
  redirectUri: env('LOAD_REDIRECT_URI', 'http://localhost:5173/auth/callback'),

  /** Virtual users at the plateau. */
  vus: envInt('LOAD_VUS', 2),
  /** How long the plateau lasts. */
  duration: env('LOAD_DURATION', '30s'),
  /** Ramp-up and ramp-down, so the plateau is measured without cold starts. */
  rampUp: env('LOAD_RAMP_UP', '10s'),
  rampDown: env('LOAD_RAMP_DOWN', '5s'),
  /**
   * Seconds a virtual user waits between iterations.
   *
   * This is the rate-limit dial. Agent traffic is capped at 180/min per account
   * (ADR-07) and every VU here shares one account, so requests-per-minute is
   * roughly `vus / pacingSeconds * 60 * requestsPerIteration`. README.md
   * §"Staying under the rate limit" works the arithmetic.
   */
  pacingSeconds: Number(env('LOAD_PACING_SECONDS', '1')),

  // --- RTM capacity ladder (`scenarios/rtm.js`) ---------------------------
  //
  // These are one rung of a ladder, not a profile to tune once. NFR-P8 is
  // found by running the same scenario at rising `LOAD_RTM_CONNECTIONS` until
  // a degradation threshold trips — README §"Finding NFR-P8".

  /** Sockets this run holds open at the plateau. */
  rtmConnections: envInt('LOAD_RTM_CONNECTIONS', 200),
  /**
   * Sockets per k6 VU.
   *
   * A VU is a whole JavaScript runtime, so one-VU-per-socket measures k6's
   * memory rather than the gateway's capacity. The async `k6/websockets` API
   * lets one VU hold many, which is the only reason a four-figure rung fits on
   * a developer laptop at all.
   */
  rtmSocketsPerVu: envInt('LOAD_RTM_SOCKETS_PER_VU', 25),
  /**
   * How fast sockets are opened, in sockets per second, across the whole run.
   *
   * Rate rather than a per-VU delay because a gateway feels the global arrival
   * rate, and because the per-VU delay that produces it changes with the VU
   * count — a fixed delay would quietly turn into a thundering herd the moment
   * a bigger rung raised the VU count.
   */
  rtmConnectRatePerSecond: envInt('LOAD_RTM_CONNECT_RATE', 200),
  /** Messages published into the target chat once every socket is up. */
  rtmPublishes: envInt('LOAD_RTM_PUBLISHES', 20),
  /** Seconds between two published messages. */
  rtmPublishIntervalSeconds: envNumber('LOAD_RTM_PUBLISH_INTERVAL', 2),
  /**
   * Every Nth socket does one disconnect → reconnect → `sync` cycle mid-run
   * (NFR-R2). `0` turns the reconnect leg off, and with it the threshold that
   * judges it.
   */
  rtmReconnectEvery: envCount('LOAD_RTM_RECONNECT_EVERY', 10),
  /**
   * Slack seconds, twice: after the last socket opens before the first publish,
   * and after the last publish before the sockets close. Both exist so a
   * boundary effect never gets read as a delivery failure.
   */
  rtmSettleSeconds: envInt('LOAD_RTM_SETTLE', 5),

  /** Written next to the scenario, for 161.4 to read. */
  resultsDir: env('LOAD_RESULTS_DIR', 'results'),
});

/**
 * One rung of the connection ladder, with every derived duration in one place.
 *
 * Derived rather than configured because the parts have to agree: the publisher
 * must not start before the last socket is up, and no socket may close before
 * the last message has had time to arrive. Four separate knobs would let an
 * operator produce a run whose "missing deliveries" are the schedule's fault.
 *
 * Timeline, from the start of the run:
 *
 *   0 ─────────────── connectSeconds ─────────── +publishSeconds ── +settle ─┐
 *   sockets open & log in │ publisher sends every `interval` │ quiet │ close ─┘
 */
export function rtmPlan() {
  const connections = CONFIG.rtmConnections;
  const socketsPerVu = Math.min(CONFIG.rtmSocketsPerVu, connections);
  const vus = Math.ceil(connections / socketsPerVu);

  // All VUs open in parallel, so the pause *inside* one VU has to be the VU
  // count divided by the rate to add up to the rate the gateway feels.
  const staggerMs = Math.max(1, Math.round((vus / CONFIG.rtmConnectRatePerSecond) * 1000));
  const connectSeconds =
    Math.ceil(connections / CONFIG.rtmConnectRatePerSecond) + CONFIG.rtmSettleSeconds;
  const publishSeconds = Math.ceil(CONFIG.rtmPublishes * CONFIG.rtmPublishIntervalSeconds);
  const holdSeconds = connectSeconds + publishSeconds + CONFIG.rtmSettleSeconds;

  // Sockets are numbered from 0 and the Nth is picked by `index % every === 0`,
  // so socket 0 qualifies and the count rounds up. Spelled the same way here as
  // it is applied, because this number is reported and a reported number that
  // is one off its own definition is how a results file starts lying.
  const reconnects =
    CONFIG.rtmReconnectEvery === 0 ? 0 : Math.ceil(connections / CONFIG.rtmReconnectEvery);

  return Object.freeze({
    connections,
    socketsPerVu,
    vus,
    staggerMs,
    connectSeconds,
    publishSeconds,
    holdSeconds,
    publishes: CONFIG.rtmPublishes,
    reconnects,
    /**
     * The gap a reconnecting socket stays away for — long enough to be certain
     * at least one message was published while it was gone, so `sync` has
     * something it must recover and NFR-R2 is actually put to the test rather
     * than trivially satisfied by an empty replay.
     */
    reconnectGapMs: Math.ceil(CONFIG.rtmPublishIntervalSeconds * 1000) + 1_000,
    /**
     * What every socket must have received by the time it closes.
     *
     * One below the published count, not equal to it: the reconnecting sockets
     * are away across a message boundary and recover it through `sync`, and a
     * single-message tolerance keeps that from turning scheduling jitter into a
     * failed run. Anything worse than one missing message is a real delivery
     * failure and fails `checks`.
     */
    expectedPushes: Math.max(1, CONFIG.rtmPublishes - 1),
  });
}

/** How many sockets VU number `vu` owns — the remainder spread over the first VUs. */
export function socketsForVu(plan, vu) {
  const base = Math.floor(plan.connections / plan.vus);
  const remainder = plan.connections % plan.vus;
  return base + (vu <= remainder ? 1 : 0);
}

/** The global index of VU `vu`'s first socket, so "every Nth" is run-wide. */
export function firstSocketForVu(plan, vu) {
  const base = Math.floor(plan.connections / plan.vus);
  const remainder = plan.connections % plan.vus;
  return (vu - 1) * base + Math.min(vu - 1, remainder);
}

/**
 * A ramp-up → plateau → ramp-down stage list.
 *
 * Ramping rather than a flat `vus` because a cold Node process JITs, a cold
 * connection pool opens sockets, and a cold Prisma client compiles its queries
 * — all of it inside the first seconds. Folded into a flat run those costs land
 * in the same p99 the thresholds judge, and the run fails on warm-up.
 */
export function stages() {
  return [
    { duration: CONFIG.rampUp, target: CONFIG.vus },
    { duration: CONFIG.duration, target: CONFIG.vus },
    { duration: CONFIG.rampDown, target: 0 },
  ];
}
