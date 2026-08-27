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

const apiOrigin = env('LOAD_API_ORIGIN', 'http://localhost:4000');
const rtmOrigin = env('LOAD_RTM_ORIGIN', 'ws://localhost:4001');

export const CONFIG = Object.freeze({
  /** Everything the REST scenarios call sits under this prefix (`API_PREFIX`). */
  apiBaseUrl: `${apiOrigin}/api/v1`,
  /** Liveness/readiness live next to the API routes, same prefix. */
  healthUrl: `${apiOrigin}/api/v1/health/ready`,
  /** The agent RTM socket. `?organization_id=` is appended by the caller. */
  rtmUrl: `${rtmOrigin}/v1/agent/rtm/ws`,

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

  /** Written next to the scenario, for 161.4 to read. */
  resultsDir: env('LOAD_RESULTS_DIR', 'results'),
});

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
