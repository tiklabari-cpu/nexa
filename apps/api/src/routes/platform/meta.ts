/**
 * GET /platform/v1/meta (tm 389.3) — version and region, before sign-in.
 *
 * What the admin SPA's permanent "PLATFORM · <region>" strip reads (design.md
 * §D), so an operator always sees which deployment they are about to act on.
 * Nothing else: no dependency, workspace or setting can be read from it.
 */
import type { FastifyInstance } from 'fastify';
import type { Env } from '../../config/env.js';

export default async function platformMetaRoutes(
  app: FastifyInstance,
  options: { env: Env; version: string },
): Promise<void> {
  const body = { version: options.version, region: options.env.SIYAHTUS_REGION };
  app.get('/meta', { config: { public: true } }, async () => body);
}
