/**
 * `/platform/v1/support/*` — the support desk (tm 389.9 · FR-ADMIN-10 ·
 * design.md §C support).
 *
 *   GET /support/lookup?q=   workspaces.read   Thread ID / Chat ID / ticket / email → workspace
 *
 * The gate is the workspace list's: the answer is a licence number and an
 * organization name, which every role that may list workspaces already reads.
 * 389.15 adds the impersonation routes here, behind their own permissions.
 *
 * A miss and a malformed `q` are the same 404, after the same probes and no
 * sooner than `LOOKUP_FLOOR_MS` (`services/platform/support-lookup.ts`).
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../../lib/api-error.js';
import {
  LOOKUP_FLOOR_MS,
  LOOKUP_QUERY_MAX,
  supportLookup,
} from '../../services/platform/support-lookup.js';
import { parse } from './auth.js';

const lookupQuery = z.object({ q: z.string().min(1).max(LOOKUP_QUERY_MAX) });

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export default async function platformSupportRoutes(
  app: FastifyInstance,
  options: { floorMs?: number } = {},
): Promise<void> {
  const floorMs = options.floorMs ?? LOOKUP_FLOOR_MS;

  app.get(
    '/support/lookup',
    { config: { platform: { permission: 'workspaces.read' } } },
    async (request, reply) => {
      const { q } = parse(lookupQuery, request.query);
      const started = performance.now();
      const matches = await supportLookup(app.platformDb, q);
      const left = floorMs - (performance.now() - started);
      if (left > 0) await sleep(left);
      reply.header('cache-control', 'no-store');
      if (matches.length === 0) throw ApiError.notFound('Nothing matches that identifier.');
      return { data: matches };
    },
  );
}
