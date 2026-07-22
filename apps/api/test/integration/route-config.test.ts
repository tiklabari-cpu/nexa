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
import { buildServer } from '../../src/server.js';
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
});
