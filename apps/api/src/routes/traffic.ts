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
import { TrafficService } from '../services/traffic/traffic-service.js';

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

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

      const tenant = request.tenant();
      const live = await request.withTenant((tx) =>
        traffic.listLive(tx, tenant, { limit: result.data.limit }),
      );

      return reply.send(live);
    },
  );
}
