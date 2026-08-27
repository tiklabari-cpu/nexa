/**
 * Real-time traffic — the live-visitor board (FR-MOD-03.1).
 *
 * A read on the same people the customer directory covers, so it rides the same
 * `customers:ro`/`customers:rw` scope rather than inventing a new one: an agent
 * who may see the CRM may see who is on the site now. The row actions the UI
 * offers (start / supervise / assign) are separate chat endpoints with their own
 * chat scopes — nothing here mutates.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApiError } from '../lib/api-error.js';
import { TRAFFIC_ACTIVITIES, TrafficService } from '../services/traffic/traffic-service.js';

/**
 * Repeated key, one value each: `?activity=queued&activity=waiting`.
 *
 * Node's query parser hands a single occurrence back as a bare string and a
 * repeated one as an array, so the two shapes are normalised before the enum
 * sees them — otherwise the one-filter case, which is the common one, would be
 * the case that 400s.
 */
const activityQuery = z.preprocess(
  (value) => (value === undefined || Array.isArray(value) ? value : [value]),
  z.array(z.enum(TRAFFIC_ACTIVITIES)).min(1).max(TRAFFIC_ACTIVITIES.length),
);

/**
 * Not `z.coerce.boolean()`: that is `Boolean(value)`, and `Boolean('false')` is
 * `true`. A query string only ever carries text, so asking for non-leads would
 * silently return leads.
 */
const booleanQuery = z.enum(['true', 'false']).transform((value) => value === 'true');

// `.strict()` for the reason `campaigns.ts` gives for its conditions: a typo in
// a filter key (`country_cod`) has to be a 400. Ignored silently it would be a
// filter the caller believes is narrowing the board while everyone the filter
// was meant to exclude stays on it.
const listQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    page_id: z.string().max(512).optional(),
    activity: activityQuery.optional(),
    page_url_contains: z.string().trim().min(1).max(2048).optional(),
    came_from_contains: z.string().trim().min(1).max(2048).optional(),
    country_code: z.string().trim().length(2).optional(),
    is_lead: booleanQuery.optional(),
    group_id: z.coerce.bigint().optional(),
  })
  .strict();

export default async function trafficRoutes(app: FastifyInstance): Promise<void> {
  const traffic = new TrafficService();

  app.get(
    '/traffic',
    { config: { scopes: ['customers:ro', 'customers:rw'] } },
    async (request, reply) => {
      const result = listQuery.safeParse(request.query);
      if (!result.success) {
        const issue = result.error.issues[0];
        throw ApiError.validation(
          issue ? `${issue.path.join('.') || 'query'}: ${issue.message}` : 'Invalid request.',
        );
      }
      const query = result.data;

      const tenant = request.tenant();
      const live = await request.withTenant((tx) =>
        traffic.listLive(tx, tenant, {
          limit: query.limit,
          // Spread rather than pass-through, so "absent" survives the hop: an
          // explicit `undefined` and a missing key mean the same thing here
          // (no restriction), and only the service's `!== undefined` checks
          // decide whether a condition joins the query.
          ...(query.page_id !== undefined ? { pageId: query.page_id } : {}),
          ...(query.activity !== undefined ? { activity: query.activity } : {}),
          ...(query.page_url_contains !== undefined
            ? { pageUrlContains: query.page_url_contains }
            : {}),
          ...(query.came_from_contains !== undefined
            ? { cameFromContains: query.came_from_contains }
            : {}),
          ...(query.country_code !== undefined ? { countryCode: query.country_code } : {}),
          ...(query.is_lead !== undefined ? { isLead: query.is_lead } : {}),
          ...(query.group_id !== undefined ? { groupId: query.group_id } : {}),
        }),
      );

      return reply.send({
        items: live.items,
        total: live.total,
        ...(live.nextPageId ? { next_page_id: live.nextPageId } : {}),
      });
    },
  );
}
