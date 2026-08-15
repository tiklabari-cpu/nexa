/**
 * Plan entitlements, enforced per route (FR-MOD-11.5).
 *
 * A route says what it costs — `config: { entitlement: 'sso' }` — and this hook
 * refuses the call when the workspace's plan does not include it. Declarative
 * for the same reason scopes and roles are (`plugins/auth.ts`) and read-only
 * mode is (`plugins/license-gate.ts`): a check written inside a handler is one
 * forgotten call away from a hole, and "we forgot to gate that one endpoint" is
 * exactly how a paid capability quietly becomes free.
 *
 * What belongs behind this gate is the *capability*, not the screen that
 * reports it. Reads stay open — `GET /settings/siem` telling an admin their
 * export is off, `GET /settings/sso` showing an empty list — so a workspace can
 * always see what it has and what it would be buying; a settings page that
 * 403s where the upsell should be is a worse product and no more secure. The
 * writes, and the endpoints that *are* the capability (shipping the audit
 * trail, provisioning through SCIM), are what this refuses.
 *
 * Two things this hook deliberately does not do:
 *
 *   - **It does not undo what was already configured.** A row written while the
 *     entitlement was held survives a downgrade (§C-A26); making it stop
 *     *meaning* something is the read path's job, not this one's. See
 *     `lib/entitlements.ts` — the white-label rule lives there because three
 *     surfaces serve the widget's look and none of them is a route config.
 *   - **It does not gate sign-in.** See the note on `sso` in `routes/scim.ts`
 *     and `routes/settings.ts`.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Entitlement } from '@nexa/types';
import { requireEntitlement } from '../lib/entitlements.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /** The capability this route requires. Absent means every plan may call it. */
    entitlement?: Entitlement;
  }
}

async function entitlementGatePlugin(app: FastifyInstance): Promise<void> {
  /**
   * A public route has no principal, so it has no plan to check — the
   * declaration would read as gated while being open to anyone. Fail at boot
   * rather than let that combination exist, exactly as the auth plugin does for
   * `public` + `scopes`.
   */
  app.addHook('onRoute', (route) => {
    const config = route.config as { public?: boolean; entitlement?: string };
    if (config?.public && config.entitlement) {
      throw new Error(
        `Route ${route.method} ${route.url} is marked public but requires the ` +
          `"${config.entitlement}" entitlement. A public route has no workspace to check it against.`,
      );
    }
  });

  app.addHook('preHandler', async (request: FastifyRequest) => {
    const entitlement = request.routeOptions.config.entitlement;
    if (!entitlement) return;
    // Unauthenticated requests never reach here on a gated route — the auth
    // plugin has already answered them — but a principal-less request would
    // have no workspace to ask about, so it is left to whatever refused it.
    if (!request.principal) return;

    await request.withTenant((tx) => requireEntitlement(tx, request.tenant(), entitlement));
  });
}

export default fp(entitlementGatePlugin, { name: 'entitlement-gate', dependencies: ['auth'] });
