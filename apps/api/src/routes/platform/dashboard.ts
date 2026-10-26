/**
 * `/platform/v1/dashboard/*` — the operator's landing screen (tm 389.8 ·
 * FR-ADMIN-07 · design.md §C dashboard).
 *
 *   GET /dashboard/kpis      dashboard.read   workspace counts by status, trials ending, ...
 *   GET /dashboard/signups   dashboard.read   ?days=1..90 (30) new workspaces per UTC day
 *   GET /dashboard/health    dashboard.read   the tenant API's published snapshot + components
 *
 * Reads only, so nothing here writes an audit entry. Counts and states, never
 * a tenant's name or content (services/platform/dashboard.ts).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { PlatformEnv } from '../../config/platform-env.js';
import {
  PlatformDashboard,
  SIGNUP_DAYS_DEFAULT,
  SIGNUP_DAYS_MAX,
} from '../../services/platform/dashboard.js';
import { parse } from './auth.js';

const signupsQuery = z.object({
  days: z.coerce.number().int().min(1).max(SIGNUP_DAYS_MAX).default(SIGNUP_DAYS_DEFAULT),
});

export default async function platformDashboardRoutes(
  app: FastifyInstance,
  options: { platform: PlatformEnv; now?: () => number },
): Promise<void> {
  const dashboard = new PlatformDashboard(app.platformDb, app.redis, {
    now: options.now ?? Date.now,
    idleTtlS: options.platform.idleTtlS,
  });
  const read = { platform: { permission: 'dashboard.read' as const } };

  app.get('/dashboard/kpis', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await dashboard.kpis()),
  );

  app.get('/dashboard/signups', { config: read }, async (request, reply) => {
    const { days } = parse(signupsQuery, request.query);
    return reply.header('cache-control', 'no-store').send(await dashboard.signups(days));
  });

  app.get('/dashboard/health', { config: read }, async (_request, reply) =>
    reply.header('cache-control', 'no-store').send(await dashboard.health()),
  );
}
