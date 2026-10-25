/**
 * Operator authentication and authorization for the platform process (tm 389.4
 * · FR-ADMIN-01…03 · docs/platform-admin/design.md §A).
 *
 * Every route is closed unless it says otherwise, and says how in its config:
 *
 *   config: { public: true }                         no session (sign-in, probes, meta)
 *   config: { platform: { permission: 'x.read' } }   an active session whose role holds it
 *   config: { platform: { self: true } }             an active session, any role (own session/me)
 *   …, stage: 'enrollment' | 'challenge' | 'any'     self routes reachable before the code
 *   …, recentTotp: true                              a code younger than five minutes
 *
 * The declaration is checked when the route is registered, not when it is
 * called: a route with neither `public` nor a permission (or `self`), a public
 * route that also names a permission, a mutation guarded by a read permission
 * or a pre-code stage on a business route stops the boot. A forgotten
 * annotation therefore cannot quietly expose a route, and a contradictory one
 * cannot quietly pick a side.
 *
 * The checks run at `onRequest`, after the platform rate limit and before the
 * body is parsed, in this order:
 *
 *   1. `PLATFORM_IP_ALLOWLIST` (`decideIpAccess` — empty admits everyone).
 *      Probes are exempt: their caller is the orchestrator, from wherever it
 *      runs.
 *   2. Public routes stop here.
 *   3. The bearer token → session (`admin-auth.ts resolve`). A token nobody
 *      holds is charged to the address's failure budget, which is read before
 *      the lookup, so an address spraying tokens is refused before it costs a
 *      query. A real session that has run out (absolute or idle) is deleted.
 *   4. Stage. A `password`-stage session reaches only the routes that say so;
 *      everywhere else it gets 403 `platform_totp_required` with `next`.
 *   5. Permission, from `PLATFORM_PERMISSIONS` (`@siyahtus/types`) — read on
 *      every request from the operator's current role, so a role change bites
 *      on the next request.
 *   6. `recentTotp` — 403 `platform_recent_totp_required` past five minutes.
 *
 * The operator's id is bound to every log line the request writes
 * (`platform_admin_id`).
 */
import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import {
  isPlatformPermission,
  PLATFORM_PERMISSIONS,
  platformRoleHas,
  type PlatformPermission,
} from '@siyahtus/types';
import type { Env } from '../config/env.js';
import type { PlatformEnv } from '../config/platform-env.js';
import { ApiError } from '../lib/api-error.js';
import { decideIpAccess } from '../lib/ip-allowlist.js';
import { PlatformAdminAuth, type PlatformSessionContext } from '../services/platform/admin-auth.js';
import { PlatformAdminDirectory } from '../services/platform/admin-directory.js';
import { bindLogContext } from './log-context.js';
import { RateLimiter } from './rate-limit.js';

/**
 * Which session stages a route admits. `active` is the default and the only
 * one a business route may have; the others exist for the sign-in itself.
 *
 *   enrollment  a password-stage session of an operator with no authenticator
 *   challenge   a password-stage session of an operator who has one (show a code)
 *   any         either stage (sign-out)
 */
export type PlatformRouteStage = 'active' | 'enrollment' | 'challenge' | 'any';

export interface PlatformRouteConfig {
  /** The permission the operator's role must hold. */
  permission?: PlatformPermission;
  /** Any signed-in operator, whatever their role — their own session and profile. */
  self?: boolean;
  stage?: PlatformRouteStage;
  /** A code younger than `PLATFORM_RECENT_TOTP_SECONDS` (destructive routes). */
  recentTotp?: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    platformAuth: PlatformAdminAuth;
    platformAdmins: PlatformAdminDirectory;
  }

  interface FastifyRequest {
    /** Present on every route that is not public; absent on public ones. */
    platformSession?: PlatformSessionContext;
    requirePlatformSession: () => PlatformSessionContext;
  }

  interface FastifyContextConfig {
    /** Operator gates (platform process only) — see `plugins/platform-auth.ts`. */
    platform?: PlatformRouteConfig;
  }
}

const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * The address's budget for presenting session tokens nobody holds — the
 * tenant's `authFailureBucket` (M-SEC-c1) under the platform's prefix.
 */
export function platformAuthFailureBucket(ip: string, env: Env) {
  return {
    key: `rl:platform:authfail:${ip}`,
    limit: env.RATE_LIMIT_AUTH_FAILURES_PER_MIN,
    windowMs: 60_000,
  };
}

/** Why a route declaration is refused, or null. Exported for its unit test. */
export function platformRouteProblem(
  method: string,
  url: string,
  config: { public?: boolean; platform?: PlatformRouteConfig } | undefined,
): string | null {
  const where = `${method} ${url}`;
  const platform = config?.platform;
  if (config?.public) {
    return platform
      ? `${where}: a public route cannot also declare operator gates (config.platform).`
      : null;
  }
  if (!platform) {
    return `${where}: every platform route declares config.platform.permission (or self: true), or config.public.`;
  }
  if (platform.permission !== undefined && platform.self) {
    return `${where}: a route is either self or guarded by a permission, not both.`;
  }
  if (platform.permission === undefined && !platform.self) {
    return `${where}: config.platform needs a permission or self: true.`;
  }
  if (platform.permission !== undefined) {
    if (!isPlatformPermission(platform.permission)) {
      return `${where}: unknown permission "${String(platform.permission)}".`;
    }
    if (!READ_METHODS.has(method) && PLATFORM_PERMISSIONS[platform.permission].kind !== 'write') {
      return `${where}: a mutation must be guarded by a write permission, not "${platform.permission}".`;
    }
  }
  const stage = platform.stage ?? 'active';
  if (stage !== 'active' && !platform.self) {
    return `${where}: only a self route may be reached before the second factor.`;
  }
  if (platform.recentTotp && stage !== 'active') {
    return `${where}: recentTotp needs an active session.`;
  }
  return null;
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match?.[1] ?? null;
}

function totpRequired(session: PlatformSessionContext): ApiError {
  const next = session.totpEnrolled ? 'totp_verify' : 'totp_enroll';
  return new ApiError(
    'platform_totp_required',
    session.totpEnrolled
      ? 'Enter the code from your authenticator app to finish signing in.'
      : 'Set up an authenticator app to finish signing in.',
    { details: { next } },
  );
}

async function platformAuthPlugin(
  app: FastifyInstance,
  options: { env: Env; platform: PlatformEnv; now?: () => number },
): Promise<void> {
  const { env, platform } = options;
  const now = options.now ?? Date.now;
  const auth = new PlatformAdminAuth(app.platformDb, {
    sessionTtlS: platform.sessionTtlS,
    idleTtlS: platform.idleTtlS,
    settingsKey: platform.settingsKey,
    now,
  });
  const limiter = new RateLimiter(app.redis);

  app.decorate('platformAuth', auth);
  app.decorate(
    'platformAdmins',
    new PlatformAdminDirectory(app.platformDb, { now, idleTtlS: platform.idleTtlS }),
  );
  app.decorateRequest('platformSession', undefined);
  app.decorateRequest('requirePlatformSession', function (this: FastifyRequest) {
    if (!this.platformSession) throw ApiError.authentication();
    return this.platformSession;
  });

  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      const problem = platformRouteProblem(method, route.url, route.config);
      if (problem) throw new Error(`platform-auth: ${problem}`);
    }
  });

  async function chargeFailure(request: FastifyRequest): Promise<void> {
    const bucket = platformAuthFailureBucket(request.ip, env);
    try {
      await limiter.consume(bucket.key, bucket.limit, bucket.windowMs);
    } catch (error) {
      request.log.error({ err: error }, 'platform auth failure budget unavailable');
    }
  }

  app.addHook('onRequest', async (request) => {
    const config = request.routeOptions.config;

    // 1. The network. Probes are the orchestrator's, from wherever it runs.
    if (
      !config.healthRateLimit &&
      decideIpAccess({ clientIp: request.ip, entries: platform.ipAllowlist }) === 'deny'
    ) {
      throw new ApiError('not_allowed', 'Access from your network is not permitted.', {
        details: { reason: 'ip_not_allowed' },
      });
    }

    // 2. Public routes, and a path no route matched (the 404 says no more).
    if (config.public || request.routeOptions.url === undefined) return;

    const gate = config.platform;
    // `onRoute` refused every route without one; this is the belt to that braces.
    if (!gate) throw ApiError.authentication();

    // 3. The session.
    const failures = platformAuthFailureBucket(request.ip, env);
    try {
      const standing = await limiter.peek(failures.key, failures.limit, failures.windowMs);
      if (!standing.allowed) {
        throw ApiError.tooManyRequests(
          standing.resetMs / 1000,
          'Too many failed attempts from this address. Retry after the interval in the Retry-After header.',
        );
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      request.log.error({ err: error }, 'platform auth failure budget unavailable');
    }

    const token = bearerToken(request);
    if (!token) throw ApiError.authentication('Sign in to continue.');
    const resolution = await auth.resolve(token);
    if (!resolution.ok) {
      if (resolution.reason === 'unknown' || resolution.reason === 'malformed') {
        await chargeFailure(request);
      }
      throw ApiError.authentication(
        resolution.reason === 'idle' || resolution.reason === 'expired'
          ? 'Your session has ended. Sign in again.'
          : 'Invalid or expired credentials.',
      );
    }
    const session = resolution.session;
    request.platformSession = session;
    bindLogContext(request, { platform_admin_id: session.adminId });

    // 4. Stage.
    const stage = gate.stage ?? 'active';
    if (stage === 'active' && session.stage !== 'active') throw totpRequired(session);
    if (stage === 'enrollment') {
      if (session.totpEnrolled) {
        throw new ApiError(
          'two_factor_already_enabled',
          'An authenticator is already set up for this operator.',
        );
      }
      if (session.stage !== 'password') {
        throw new ApiError('not_allowed', 'This session has already been verified.');
      }
    }
    if (stage === 'challenge') {
      if (!session.totpEnrolled) throw totpRequired(session);
      if (session.stage !== 'password') {
        throw new ApiError('not_allowed', 'This session has already been verified.');
      }
    }

    // 5. Permission.
    if (gate.permission && !platformRoleHas(session.role, gate.permission)) {
      throw ApiError.authorization('Your operator role does not allow this.', {
        permission: gate.permission,
      });
    }

    // 6. A recent code.
    if (gate.recentTotp && !auth.hasRecentTotp(session)) {
      throw new ApiError(
        'platform_recent_totp_required',
        'Confirm with a fresh code from your authenticator app, then try again.',
      );
    }
  });

  // The line that closes the request carries the operator too.
  app.addHook('onSend', async (request, reply) => {
    reply.log = request.log;
  });
}

export default fp(platformAuthPlugin, {
  name: 'platform-auth',
  dependencies: ['platform-database', 'redis', 'platform-rate-limit'],
});
