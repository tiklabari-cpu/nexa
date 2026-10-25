/**
 * Every platform mutation writes the audit chain (tm 389.5 · FR-ADMIN-05 ·
 * design.md §C audit).
 *
 * A route says what it records, next to its gates:
 *
 *   config: { platform: { permission: 'admins.manage',
 *                         audit: { action: 'admin.disabled', target: 'admin', targetParam: 'adminId' } } }
 *
 * and this plugin does the rest:
 *
 *   - **At boot**, every route that is not a GET either declares `audit` or
 *     says it is `safe` (changes nothing); a GET, or a safe route, that
 *     declares one is refused too. A forgotten declaration therefore stops the
 *     process instead of leaving a mutation off the record — the same rule
 *     `platform-auth.ts` holds the gates to.
 *   - **Before the handler**, a business route (one guarded by a permission)
 *     needs `reason` in its body: 400 `platform_reason_required` without one.
 *     The operator's own session routes (`self`, and the public sign-in) carry
 *     none — signing in needs no justification, only a record.
 *   - **After a successful response**, the entry is written with the operator,
 *     the address, the target from the path and whatever the handler added
 *     (`request.platformAudit`). A handler that records inside its own
 *     transaction (`app.platformAuditLog.run`, required when the action
 *     touches a workspace — its own trail must commit with it) builds the
 *     entry with `request.platformAuditEntry()`, and nothing is written twice.
 *
 * A failed request writes nothing here: its effect did not happen. The
 * failures worth keeping — a wrong password, a wrong code — are recorded by
 * their handlers.
 */
import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import type { PlatformEnv } from '../config/platform-env.js';
import { ApiError } from '../lib/api-error.js';
import {
  normalizeReason,
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_TARGETS,
  PLATFORM_REASON_MAX,
  PLATFORM_REASON_MIN,
  PlatformAuditLog,
  type PlatformAuditEntry,
} from '../services/platform/platform-audit.js';
import type { PlatformRouteConfig } from './platform-auth.js';

/** What a handler adds to the automatic entry. */
export interface PlatformAuditState {
  /** The validated reason (business routes only). */
  reason: string | null;
  /** Overrides the path parameter — an id the action created. */
  targetId?: string | null;
  licenseId?: bigint | null;
  payload?: Record<string, unknown>;
  /** The operator, where there is no session yet (sign-in, invitation). */
  adminId?: string | null;
  /** Set once the entry is written; the response hook then writes nothing. */
  recorded: boolean;
}

declare module 'fastify' {
  interface FastifyInstance {
    platformAuditLog: PlatformAuditLog;
  }

  interface FastifyRequest {
    /** Present on audited routes from `preHandler` on. */
    platformAudit: PlatformAuditState | null;
    /**
     * The route's entry, complete, for a handler recording it inside its own
     * transaction — marks it recorded, so the response hook stays quiet.
     */
    platformAuditEntry: (extra?: Partial<PlatformAuditEntry>) => PlatformAuditEntry;
  }
}

const READ_METHODS = new Set(['GET', 'HEAD']);

/** Why a route's audit declaration is refused, or null. Exported for its unit test. */
export function platformAuditRouteProblem(
  method: string,
  url: string,
  platform: PlatformRouteConfig | undefined,
): string | null {
  const where = `${method} ${url}`;
  const audit = platform?.audit;
  if (READ_METHODS.has(method)) {
    if (audit) return `${where}: a read is not audited (config.platform.audit).`;
    if (platform?.safe) return `${where}: only a non-GET route can be declared safe.`;
    return null;
  }
  if (platform?.safe) {
    return audit ? `${where}: a safe route changes nothing and writes no audit entry.` : null;
  }
  if (!audit) {
    return `${where}: every platform mutation declares config.platform.audit (or safe: true).`;
  }
  if (!(PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(audit.action)) {
    return `${where}: unknown audit action "${String(audit.action)}".`;
  }
  if (!(PLATFORM_AUDIT_TARGETS as readonly string[]).includes(audit.target)) {
    return `${where}: unknown audit target "${String(audit.target)}".`;
  }
  if (audit.targetParam && !url.includes(`:${audit.targetParam}`)) {
    return `${where}: audit.targetParam "${audit.targetParam}" is not a path parameter.`;
  }
  return null;
}

/** A business route — guarded by a permission — must say why. */
function needsReason(platform: PlatformRouteConfig): boolean {
  return platform.permission !== undefined;
}

function entryOf(
  request: FastifyRequest,
  platform: PlatformRouteConfig,
  state: PlatformAuditState,
  extra: Partial<PlatformAuditEntry> = {},
): PlatformAuditEntry {
  const audit = platform.audit!;
  const session = request.platformSession;
  const params = request.params as Record<string, unknown> | undefined;
  const fromParam = audit.targetParam ? params?.[audit.targetParam] : undefined;
  const targetId =
    state.targetId !== undefined
      ? state.targetId
      : typeof fromParam === 'string'
        ? fromParam
        : audit.target === 'admin'
          ? (state.adminId ?? session?.adminId ?? null)
          : audit.target === 'session'
            ? (session?.sessionId ?? null)
            : null;
  return {
    adminId: state.adminId !== undefined ? state.adminId : (session?.adminId ?? null),
    action: audit.action,
    targetType: audit.target,
    targetId,
    licenseId: state.licenseId ?? null,
    reason: state.reason,
    payload: state.payload ?? {},
    ip: request.ip ?? null,
    requestId: request.id,
    ...extra,
  };
}

async function platformAuditPlugin(
  app: FastifyInstance,
  options: { env: Env; platform: PlatformEnv; now?: () => number },
): Promise<void> {
  const log = new PlatformAuditLog(app.platformDb, {
    settingsKey: options.platform.settingsKey,
    tenantChainSecret: options.env.AUDIT_CHAIN_SECRET,
    ...(options.now ? { now: options.now } : {}),
  });
  app.decorate('platformAuditLog', log);
  app.decorateRequest('platformAudit', null);
  app.decorateRequest(
    'platformAuditEntry',
    function (this: FastifyRequest, extra?: Partial<PlatformAuditEntry>) {
      const platform = this.routeOptions.config.platform;
      if (!platform?.audit || !this.platformAudit) {
        throw new Error('platformAuditEntry() on a route that declares no audit entry');
      }
      this.platformAudit.recorded = true;
      return entryOf(this, platform, this.platformAudit, extra);
    },
  );

  app.addHook('onRoute', (route: RouteOptions) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      const problem = platformAuditRouteProblem(method, route.url, route.config?.platform);
      if (problem) throw new Error(`platform-audit: ${problem}`);
    }
  });

  // After the gates (`onRequest`) and the body parser; before the handler.
  app.addHook('preHandler', async (request) => {
    const platform = request.routeOptions.config.platform;
    if (!platform?.audit) return;
    let reason: string | null = null;
    if (needsReason(platform)) {
      const body = request.body as Record<string, unknown> | null | undefined;
      reason = normalizeReason(body?.['reason']);
      if (reason === null) {
        throw new ApiError(
          'platform_reason_required',
          `Say why (${PLATFORM_REASON_MIN}-${PLATFORM_REASON_MAX} characters in \`reason\`): every operator action is recorded with its reason.`,
        );
      }
    }
    request.platformAudit = { reason, recorded: false };
  });

  app.addHook('onSend', async (request, reply) => {
    const platform = request.routeOptions.config.platform;
    const state = request.platformAudit;
    if (!platform?.audit || !state || state.recorded || reply.statusCode >= 400) return;
    state.recorded = true;
    try {
      await log.record(entryOf(request, platform, state));
    } catch (error) {
      // The action has happened and its record has not: say so loudly, and
      // do not answer as if all were well.
      request.log.error(
        { err: error, event: 'platform_audit.write_failed', action: platform.audit.action },
        'platform audit entry could not be written',
      );
      throw error;
    }
  });
}

export default fp(platformAuditPlugin, {
  name: 'platform-audit',
  dependencies: ['platform-database', 'platform-auth'],
});
