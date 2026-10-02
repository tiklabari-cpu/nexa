/**
 * GET /api/v1/deployment — what the panel needs to know about this deployment
 * before anyone signs in (tm 257.13 · ADR docs/adr/pilot-public-readiness.md
 * K-a).
 *
 * Before this the panel learned server settings only at build time
 * (`VITE_*`) or after sign-in (`/auth/me`), and neither works for the pilot
 * switch: the sign-in screen is where the demo credentials and the sign-up
 * region picker live, and a build argument means a rebuild to flip it — and a
 * setting none of the env parity checks can see. `/health` is anonymous but
 * was narrowed on purpose (M-SEC-b2) and is not widened here.
 *
 * So one anonymous route, deliberately small. It answers with deployment-wide
 * settings only — nothing about any workspace, and none of the
 * infrastructure detail `/health` hides from a stranger (version, region,
 * providers, uptime). The panel only *hides* what these fields say is
 * unavailable; the API enforces every one of them on its own
 * (`plugins/pilot-gate.ts`, the sign-up route).
 *
 * Its own rate limit bucket (`publicConfigRateLimit`): every page load reads
 * it, and in the shared anon bucket it would spend sign-in's budget.
 */
import type { FastifyInstance } from 'fastify';
import type { DeploymentConfig } from '@siyahtus/types';
import type { Env } from '../config/env.js';

export default async function deploymentRoutes(
  app: FastifyInstance,
  options: { env: Env },
): Promise<void> {
  const { env } = options;

  app.get(
    '/deployment',
    { config: { public: true, publicConfigRateLimit: true } },
    async (_request, reply) => {
      const body: DeploymentConfig = {
        pilot_mode: env.PILOT_MODE,
        contact_email: env.PILOT_CONTACT_EMAIL ?? null,
        signup_enabled: env.SIGNUP_ENABLED,
      };
      // A cache may keep it but must ask again: switching pilot mode off and
      // restarting has to be seen on the next read, not after a max-age.
      return reply.header('Cache-Control', 'no-cache').send(body);
    },
  );
}
