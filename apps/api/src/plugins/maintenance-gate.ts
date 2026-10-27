/**
 * Maintenance mode (tm 389.13 · FR-ADMIN-15): the root panel takes the
 * deployment down, and this hook answers for it.
 *
 * - `full`: every request is refused with 503 `maintenance` except the few a
 *   client needs to find out and to leave — health, `/deployment`,
 *   `/deployment/notice` (which says maintenance is on) and `/auth/revoke`.
 * - `read_only`: reads go through, and so does signing in (`/auth/login`,
 *   `/auth/authorize`, `/auth/token`, a SAML assertion) and out — a reader
 *   needs a session. Every other write is refused.
 *
 * `onRequest`, registered ahead of authentication and the licence gate: a
 * workspace in maintenance is told so before anything about its own state,
 * and a refused write must not parse its body. Matched on the route pattern
 * (`routeOptions.url`), never the raw URL, so a query string or a trailing
 * slash cannot walk past it. The settings come from `PublicSettings` — cached,
 * so this costs a query per 30 seconds, not per request — and an unreadable
 * setting is "not in maintenance" (`public-settings.ts`).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { MaintenanceMode } from '@siyahtus/types';
import { ApiError } from '../lib/api-error.js';
import type { PublicSettings } from '../services/platform/public-settings.js';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Open in both modes: how a client learns of maintenance, and how it leaves. */
const ALWAYS_OPEN = new Set([
  '/api/v1/deployment',
  '/api/v1/deployment/notice',
  '/api/v1/auth/revoke',
]);

/** Writes `read_only` lets through: signing in and out. */
const SIGN_IN_WRITES = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/authorize',
  '/api/v1/auth/token',
  '/api/v1/auth/revoke',
  '/api/v1/auth/saml/:connectionId/acs',
]);

/** Whether `mode` refuses this request — exported for its unit test. */
export function maintenanceRefuses(
  mode: MaintenanceMode,
  method: string,
  routeUrl: string | undefined,
): boolean {
  // An unmatched address answers 404 as it would anyway.
  if (routeUrl === undefined) return false;
  if (method === 'OPTIONS') return false;
  if (routeUrl.startsWith('/api/v1/health') || ALWAYS_OPEN.has(routeUrl)) return false;
  if (mode === 'full') return true;
  return !READ_METHODS.has(method) && !SIGN_IN_WRITES.has(routeUrl);
}

declare module 'fastify' {
  interface FastifyInstance {
    publicSettings: PublicSettings;
  }
}

async function maintenanceGatePlugin(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request: FastifyRequest) => {
    const routeUrl = request.routeOptions.url;
    // What not even `full` refuses (health, the notice, preflights) never
    // waits on the settings.
    if (!maintenanceRefuses('full', request.method, routeUrl)) return;
    const { maintenance } = await app.publicSettings.get();
    if (!maintenance || !maintenanceRefuses(maintenance.mode, request.method, routeUrl)) return;
    throw new ApiError(
      'maintenance',
      maintenance.mode === 'full'
        ? 'This service is down for maintenance. Please try again later.'
        : 'This service is read-only for maintenance. Changes are not accepted right now.',
      { details: { mode: maintenance.mode } },
    );
  });
}

export default fp(maintenanceGatePlugin, { name: 'maintenance-gate' });
