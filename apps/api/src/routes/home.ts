/**
 * Home dashboard (FR-MOD-13.1).
 *
 * One read backs the whole landing screen — the activation checklist, the live
 * counters and the weekly performance summary. It surfaces report-flavoured
 * data (operational counts + week-over-week performance), so it rides the same
 * `reports_read` scope the Reports module does: the audience is the same, and a
 * teammate who may not see Reports may not see the dashboard that summarises it.
 */
import type { FastifyInstance } from 'fastify';
import { HomeService } from '../services/home/home-service.js';

export default async function homeRoutes(app: FastifyInstance): Promise<void> {
  const home = new HomeService();

  app.get('/home', { config: { scopes: ['reports_read'] } }, async (request, reply) => {
    const tenant = request.tenant();
    const dashboard = await request.withTenant((tx) => home.getDashboard(tx, tenant, new Date()));
    return reply.send(dashboard);
  });
}
