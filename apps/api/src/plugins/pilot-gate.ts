/**
 * What the public pilot does not offer, refused at the door (tm 257.13 · ADR
 * docs/adr/pilot-public-readiness.md K-c).
 *
 * With `PILOT_MODE=true` the panel hides the surfaces that are mocks — billing
 * purchases, fake channels, the marketplace — but hiding is a courtesy: the
 * routes behind them are still there for anyone with `curl`. This hook is
 * what makes "not in the pilot" true. It answers 403 `not_allowed` with
 * `details.reason: 'pilot_mode'` — the `signup_closed` shape (§D195(4)), so no
 * new error type and no new `common.errors.*` key.
 *
 * Two ways to name a refused route, for the same reason `sandbox-gate.ts`
 * gives for its path prefix:
 *
 *   - `config: { pilotRefused: true }` on one route — channel, apps and
 *     onboarding endpoints share no prefix, so a flag is the only handle;
 *   - a `{ methods, pathRegex }` entry in `PILOT_REFUSED_PATHS` — for a whole
 *     surface (billing writes, 257.2), where a per-route annotation is one
 *     forgotten line away from a hole and the next billing write added would
 *     be that line.
 *
 * Three properties the other gates do not have, each one the reason this is
 * a separate hook rather than a line in one of them:
 *
 *   - **It never looks at the principal.** `sandbox-gate` and
 *     `entitlement-gate` step aside when there is none, and that is right for
 *     them; here it would leave every public route open — the two inbound
 *     channel webhooks are public, and they are exactly what the pilot must
 *     refuse. Whether this deployment offers a thing does not depend on who
 *     is asking.
 *   - **It runs in `onRequest`, before the body is parsed.** A refused route
 *     reads none of its input: a malformed body gets the 403, not a 400 that
 *     would tell the caller how to fix a request this deployment will never
 *     serve.
 *   - **It matches the route, not the URL.** `request.routeOptions.url` is the
 *     pattern the router picked (`/api/v1/billing/subscription`), so neither a
 *     query string nor a percent-encoded segment can make a refused path look
 *     like another one — `request.url` is the raw string the caller sent.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { ApiError } from '../lib/api-error.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * Refused with 403 `pilot_mode` while `PILOT_MODE=true` (tm 257.13), public
     * route or not. Absent, the route is served as usual.
     */
    pilotRefused?: true;
    /**
     * The one way through a `pilotRefused` route (tm 263): the route parameter
     * named here (`appId`, `type`) holds a card this deployment runs live
     * (`APPS_LIVE_PROVIDERS`). Read from the router's own params, so — like the
     * pattern match below — no encoding of the URL can make a mock card look
     * like a live one. A refused *path* (`PILOT_REFUSED_PATHS`) has no such door.
     */
    pilotLiveParam?: string;
  }
}

/** A surface the pilot refuses by path rather than by a flag on each route. */
export interface PilotRefusedPath {
  /** Upper-case HTTP methods. `GET` covers `HEAD`, which Fastify serves from it. */
  methods: readonly string[];
  /**
   * Tested against the route pattern with the `/api/v1` mount
   * (`/api/v1/billing/subscription`, `/api/v1/chats/:chatId`). Anchored with
   * `^`, no `g`/`y` flag.
   */
  pathRegex: RegExp;
}

/**
 * The surfaces refused by path. Hard-coded with the mount like `sandbox-gate`'s
 * `BILLING_PATH`: importing `API_PREFIX` from `server.ts` would close a cycle.
 */
export const PILOT_REFUSED_PATHS: readonly PilotRefusedPath[] = [
  // Every billing write (tm 257.2): plan, seats and cycle, the card, API
  // packages and AI packs — the pilot takes no payment, so a purchase here
  // would be a licence opened for nothing or a statement nobody pays. Reads
  // stay open: the shell still reads the trial state, and the mobile app the
  // entitlements. No `DELETE` route exists today; listed so the first one
  // added is closed before anyone writes it.
  { methods: ['POST', 'PUT', 'PATCH', 'DELETE'], pathRegex: /^\/api\/v1\/billing\// },
];

const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Refuse a path list that would quietly match less than it says. Each of these
 * fails *open* — a lower-case `'patch'` never equals `request.method`, a `g`
 * flag makes `.test()` alternate between true and false on the same route —
 * so they are boot errors rather than review comments.
 */
export function assertPilotRefusedPaths(paths: readonly PilotRefusedPath[]): void {
  for (const { methods, pathRegex } of paths) {
    const where = `pilot-gate path ${String(pathRegex)}`;
    if (methods.length === 0) throw new Error(`${where} names no method.`);
    for (const method of methods) {
      if (!HTTP_METHODS.has(method)) {
        throw new Error(
          `${where}: "${method}" is not one of ${[...HTTP_METHODS].join(', ')} (upper case).`,
        );
      }
    }
    if (!pathRegex.source.startsWith('^')) {
      throw new Error(`${where} is not anchored with "^".`);
    }
    if (pathRegex.global || pathRegex.sticky) {
      throw new Error(`${where} carries a g or y flag, which makes .test() stateful.`);
    }
  }
}

/** Whether `method` on the route pattern `routeUrl` is one of `paths`. */
export function matchesPilotRefusedPath(
  paths: readonly PilotRefusedPath[],
  method: string,
  routeUrl: string | undefined,
): boolean {
  if (routeUrl === undefined) return false; // no route matched: the 404 answers
  const asked = method === 'HEAD' ? 'GET' : method;
  return paths.some(
    ({ methods, pathRegex }) => methods.includes(asked) && pathRegex.test(routeUrl),
  );
}

async function pilotGatePlugin(
  app: FastifyInstance,
  options: { env: Env; paths?: readonly PilotRefusedPath[]; liveApps?: readonly string[] },
): Promise<void> {
  const liveApps = new Set(options.liveApps ?? []);
  const paths = options.paths ?? PILOT_REFUSED_PATHS;
  assertPilotRefusedPaths(paths);

  // Off is not "cheaper", it is absent: with the switch off no hook is added,
  // so nothing about a request's lifecycle differs from before this existed.
  if (!options.env.PILOT_MODE) return;

  app.addHook('onRequest', async (request: FastifyRequest) => {
    const byPath = matchesPilotRefusedPath(paths, request.method, request.routeOptions.url);
    if (!request.routeOptions.config.pilotRefused && !byPath) return;
    const liveParam = request.routeOptions.config.pilotLiveParam;
    if (!byPath && liveParam !== undefined) {
      const value = (request.params as Record<string, unknown> | undefined)?.[liveParam];
      if (typeof value === 'string' && liveApps.has(value)) return;
    }
    throw new ApiError('not_allowed', 'This is not available during the pilot.', {
      details: { reason: 'pilot_mode' },
    });
  });
}

export default fp(pilotGatePlugin, { name: 'pilot-gate', dependencies: ['auth'] });
