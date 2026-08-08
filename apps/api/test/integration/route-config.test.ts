/**
 * Route configuration safety.
 *
 * `public: true` bypasses authentication entirely. A route that declared both
 * `public` and `scopes` would read as protected in review while accepting
 * anonymous callers — the kind of mistake that survives a code review precisely
 * because the declaration looks right. The auth plugin refuses to start rather
 * than allowing it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildServer, API_PREFIX } from '../../src/server.js';
import agentRoutes from '../../src/routes/agents.js';
import reportRoutes from '../../src/routes/reports.js';
import { testEnv } from '../helpers/fixtures.js';

describe('route configuration guards', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('refuses to register a public route that declares scopes', async () => {
    app = await buildServer({ env: testEnv() });

    expect(() =>
      app!.get(
        '/danger',
        { config: { public: true, scopes: ['chats--all:rw'] } },
        async () => ({}),
      ),
    ).toThrow(/public but declares authorization requirements/);
  });

  it('refuses to register a public route that declares a minimum role', async () => {
    app = await buildServer({ env: testEnv() });

    expect(() =>
      app!.get('/danger', { config: { public: true, minimumRole: 'admin' } }, async () => ({})),
    ).toThrow(/public but declares authorization requirements/);
  });

  it('allows a plain public route', async () => {
    app = await buildServer({ env: testEnv() });

    expect(() =>
      app!.get('/fine', { config: { public: true } }, async () => ({ ok: true })),
    ).not.toThrow();
  });

  it('allows a protected route with scopes', async () => {
    app = await buildServer({ env: testEnv() });

    expect(() =>
      app!.get('/also-fine', { config: { scopes: ['chats--all:ro'] } }, async () => ({ ok: true })),
    ).not.toThrow();
  });

  it('leaves every shipped route in a coherent state', async () => {
    // Guards the guard: if buildServer itself ever registered a contradictory
    // route, it would throw here rather than in production.
    await expect(buildServer({ env: testEnv() }).then((a) => a.close())).resolves.not.toThrow();
  });

  it('keeps the auth recovery routes public, so an IP allow-list can never lock everyone out', async () => {
    // The IP allow-list (08.9.6-e) is enforced only for authenticated, non-public
    // requests — the enforcement guard is skipped when `config.public` is set. So
    // the routes that let a locked-out workspace back in must stay public. A
    // protected route answers 401 to an unauthenticated caller; these must not
    // (they run on to body validation), which is exactly what keeps them exempt
    // from an allow-list that would otherwise refuse the admin's own address.
    app = await buildServer({ env: testEnv() });
    await app.ready();

    const recovery = ['/auth/login', '/auth/authorize', '/auth/token', '/auth/revoke'];
    for (const path of recovery) {
      const res = await app.inject({ method: 'POST', url: `${API_PREFIX}${path}`, payload: {} });
      expect(res.statusCode, path).not.toBe(401);
      expect(res.statusCode, path).not.toBe(403);
    }
  });

  it('keeps the work-schedule routes behind a scope, on both verbs (NFR-S3)', async () => {
    // A new authorized surface is where a missing `config.scopes` is easiest to
    // ship: the handler still works, every other test still passes, and the
    // route stands open to any authenticated token. Asserted per verb because
    // read and write deliberately carry *different* lists — the write side must
    // never admit a read-only scope, which is what a copy-pasted config quietly
    // undoes.
    //
    // Read off an `onRoute` hook rather than the built server: `findRoute` does
    // not expose a route's config, and this reads the declaration the module
    // actually ships.
    const declared = new Map<string, string[] | undefined>();
    const probe = Fastify();
    // The module builds a publisher at registration time; nothing here sends.
    probe.decorate('redis', {} as never);
    probe.addHook('onRoute', (route) => {
      const config = route.config as { scopes?: string[] } | undefined;
      if (route.url === '/agents/:agentId/work-schedule') {
        declared.set(String(route.method), config?.scopes);
      }
    });
    await probe.register(agentRoutes);
    await probe.ready();
    await probe.close();

    expect(declared.get('GET')).toEqual(['agents--all:ro', 'agents--my:ro']);
    expect(declared.get('PUT')).toEqual(['agents--my:rw', 'agents--all:rw']);
  });

  it('keeps the routing-status endpoint behind the scopes the command palette hides it by', async () => {
    // The palette offers "Stop Accepting Chats" only to a caller holding one of
    // these (`apps/web/src/components/actions.ts`, `requiredScope`), and hides
    // the entry otherwise. That is a UX gate; this route's own list is the
    // boundary. Pinned here so the two cannot drift apart silently: widen or
    // narrow the route and the palette would go on gating by a stale list —
    // either offering an action that 403s, or hiding one the caller may use.
    // The web suite asserts the same literal from its side.
    const declared = new Map<string, string[] | undefined>();
    const probe = Fastify();
    probe.decorate('redis', {} as never);
    probe.addHook('onRoute', (route) => {
      if (route.url === '/agents/me/routing-status') {
        declared.set(String(route.method), (route.config as { scopes?: string[] })?.scopes);
      }
    });
    await probe.register(agentRoutes);
    await probe.ready();
    await probe.close();

    expect(declared.get('PUT')).toEqual(['agents--my:rw', 'agents--all:rw']);
  });

  it('keeps the staffing forecast behind reports_read, and opens no scope of its own', async () => {
    // Same reasoning as the work-schedule routes: a new authorized surface is
    // where a missing `config.scopes` ships unnoticed. The second half matters as
    // much as the first — the forecast is derived from the volume `reports_read`
    // already covers, so a scope of its own would let a token read staffing
    // numbers it could not read the inputs of.
    const declared = new Map<string, string[] | undefined>();
    const probe = Fastify();
    probe.addHook('onRoute', (route) => {
      if (route.url === '/reports/staffing-forecast') {
        declared.set(String(route.method), (route.config as { scopes?: string[] })?.scopes);
      }
    });
    await probe.register(reportRoutes, { env: testEnv() });
    await probe.ready();
    await probe.close();

    expect(declared.get('GET')).toEqual(['reports_read']);
  });
});
