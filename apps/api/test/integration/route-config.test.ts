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
import type { FastifyInstance } from 'fastify';
import { buildServer, API_PREFIX } from '../../src/server.js';
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
});
