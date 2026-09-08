/**
 * The production boot path, run for the first time (M-PROD-CFG-a).
 *
 * `NODE_ENV` is `production` nowhere in this repository — the container stack
 * sets `development` on purpose — so every line the API reserves for production
 * had, until this file, never been executed: not the environment checks, and not
 * the one behaviour that branches on their result, which is the CORS allowlist.
 * Reviewing that code is not the same as running it, and the failure it guards
 * is quiet by construction: a browser silently drops a cross-origin response, so
 * an allowlist that never engaged looks exactly like one that did.
 *
 * What this does NOT do is stand up a production deployment. There are no real
 * secrets here and there is no TLS in this repo (CLAUDE.md); the process
 * environment stays `test`, and only the `Env` object handed to `buildServer`
 * says production. That is the honest boundary: the configuration branch is what
 * can be measured locally, and it is what is measured.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from '../helpers/server.js';

const PANEL_ORIGIN = 'https://panel.nexa.test';
const WIDGET_ORIGIN = 'https://widget.nexa.test';
const FOREIGN_ORIGIN = 'https://not-the-panel.example';

/** 32+ characters and not the `dev-only-` placeholder — the production check refuses both. */
const realSecret = (label: string): string => `${label}-0123456789abcdef0123456789abcdef`;

/**
 * Everything a production boot demands, and the two switches a test has to take
 * back. `SCHEDULER_ENABLED`/`OTEL_ENABLED` follow `NODE_ENV` when unset, so a
 * production env would start the five background sweeps inside this suite and
 * let them write underneath other files' fixtures.
 */
const PRODUCTION_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  LOG_LEVEL: 'silent',
  SCHEDULER_ENABLED: 'false',
  OTEL_ENABLED: 'false',
  WEB_ORIGIN: PANEL_ORIGIN,
  // One host serving both, so this fixture keeps saying what it always said —
  // a single panel origin — under the rule tm 243 added: production refuses a
  // `WEB_ORIGIN` that does not contain `WIDGET_BASE_URL`'s origin. Here it
  // does, because it is the same origin. The separate-host shape, which is what
  // the four deployment documents actually describe, gets its own describe at
  // the bottom of this file.
  WIDGET_BASE_URL: PANEL_ORIGIN,
  INBOUND_EMAIL_SECRET: 'an-inbound-webhook-shared-secret',
  JWT_SIGNING_KEY: realSecret('jwt'),
  WEBHOOK_HMAC_SEED: realSecret('webhook'),
  CUSTOMER_TOKEN_SECRET: realSecret('customer'),
  UPLOAD_SIGNING_KEY: realSecret('upload'),
  AUDIT_CHAIN_SECRET: realSecret('audit'),
};

describe('a server built from a production environment', () => {
  let server: TestServer;

  beforeAll(async () => {
    // `DATABASE_APP_URL` is required in production and comes from the isolated
    // datastore harness, which always sets it (CONVENTIONS §1.1).
    expect(process.env['DATABASE_APP_URL']).toBeTruthy();
    server = await startTestServer(PRODUCTION_ENV);
  });

  afterAll(async () => {
    await server?.close();
  });

  it('comes up and answers a request', async () => {
    // The plain fact this file exists to establish: the whole plugin chain —
    // database, redis, auth, audit, rate limiting, the three gates — assembles
    // under a production configuration. It had never been asked to.
    const response = await server.get('/health');

    expect(response.statusCode).toBe(200);
    expect((response.json() as { status: string }).status).toBe('ok');
  });

  it('answers the configured panel origin', async () => {
    const response = await server.get('/health', { origin: PANEL_ORIGIN });

    expect(response.headers['access-control-allow-origin']).toBe(PANEL_ORIGIN);
  });

  it('refuses to hand a foreign origin the credentials header', async () => {
    // `origin: env.isProduction ? [env.WEB_ORIGIN] : true`. With `credentials`
    // on, reflecting an arbitrary origin would let any page a signed-in agent
    // visits read the API with that agent's cookies.
    const response = await server.get('/health', { origin: FOREIGN_ORIGIN });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('is a branch, not a constant — the same server in test reflects any origin', async () => {
    // Without this the two assertions above would still pass if CORS had simply
    // been switched off, and the thing under test is precisely the difference
    // between the two environments.
    const testModeServer = await startTestServer({ WEB_ORIGIN: PANEL_ORIGIN });
    try {
      const response = await testModeServer.get('/health', { origin: FOREIGN_ORIGIN });
      expect(response.headers['access-control-allow-origin']).toBe(FOREIGN_ORIGIN);
    } finally {
      await testModeServer.close();
    }
  });
});

/**
 * More than one front door (M-PROD-CFG-b).
 *
 * The allowlist was `[env.WEB_ORIGIN]` — one origin, wrapped at the point of
 * use. A deployment that serves the agent panel and the hosted chat page
 * (FR-MOD-08.5.9) from different hosts had no way to say so, and the failure is
 * the quiet kind again: the browser drops the response and the second app looks
 * broken for no visible reason.
 */
describe('a production server with several panel origins', () => {
  const CHAT_ORIGIN = 'https://chat.nexa.test';
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({
      ...PRODUCTION_ENV,
      WEB_ORIGIN: `${PANEL_ORIGIN}, ${CHAT_ORIGIN}`,
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  it('answers each configured origin with itself, not with the first one', async () => {
    for (const origin of [PANEL_ORIGIN, CHAT_ORIGIN]) {
      const response = await server.get('/health', { origin });
      expect(response.headers['access-control-allow-origin'], origin).toBe(origin);
    }
  });

  it('still refuses everything else', async () => {
    const response = await server.get('/health', { origin: FOREIGN_ORIGIN });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('refuses to boot at all on a value that is not an origin', async () => {
    // Fail closed. A list that parses but matches nothing a browser sends would
    // come up healthy and serve no one — the worst of the three outcomes,
    // because the process reports itself fine.
    await expect(
      startTestServer({ ...PRODUCTION_ENV, WEB_ORIGIN: 'panel.nexa.test/app' }),
    ).rejects.toThrow(/WEB_ORIGIN/);
  });
});

/**
 * The customer half of the product, on its own host (tm 243).
 *
 * This is the shape every deployment document in the repository described —
 * `panel.<domain>` for agents, `widget.<domain>` for the loader and iframe —
 * and it is the shape that did not work, because all four of them named only
 * the panel in `WEB_ORIGIN`. The widget's browser bundle has no same-origin
 * backend at all (`apps/widget/nginx.conf`'s `connect-src`), so every call it
 * makes is the request measured below, and a browser drops the answer silently
 * when the allowlist does not name it.
 *
 * Two directions, because either alone would be satisfiable by an accident:
 * the widget origin is answered, and an origin nobody listed still is not.
 */
describe('a production server whose widget is a separate origin (NFR-S6)', () => {
  let server: TestServer;

  beforeAll(async () => {
    server = await startTestServer({
      ...PRODUCTION_ENV,
      WEB_ORIGIN: `${PANEL_ORIGIN},${WIDGET_ORIGIN}`,
      WIDGET_BASE_URL: WIDGET_ORIGIN,
    });
  });

  afterAll(async () => {
    await server?.close();
  });

  it('answers the widget origin on a preflight and on the request itself', async () => {
    // A cross-origin POST with a JSON body is preflighted, so the widget's
    // first real call is an OPTIONS this server has to allow before the browser
    // will send anything at all.
    const preflight = await server.app.inject({
      method: 'OPTIONS',
      url: server.url('/customer/token'),
      headers: {
        origin: WIDGET_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(WIDGET_ORIGIN);
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');

    const request = await server.get('/health', { origin: WIDGET_ORIGIN });
    expect(request.headers['access-control-allow-origin']).toBe(WIDGET_ORIGIN);
  });

  it('still refuses an origin nobody listed', async () => {
    const preflight = await server.app.inject({
      method: 'OPTIONS',
      url: server.url('/customer/token'),
      headers: { origin: FOREIGN_ORIGIN, 'access-control-request-method': 'POST' },
    });

    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    expect(
      (await server.get('/health', { origin: FOREIGN_ORIGIN })).headers[
        'access-control-allow-origin'
      ],
    ).toBeUndefined();
  });

  it('never comes up with the widget left off the list', async () => {
    // The gate, at the only place it can be enforced for a deployment that
    // writes its own configuration rather than copying an example. Refusing the
    // boot is the same choice `WEB_ORIGIN`'s own parser already makes: a
    // process that looks healthy and serves half the product is worse than one
    // that does not start.
    await expect(
      startTestServer({
        ...PRODUCTION_ENV,
        WEB_ORIGIN: PANEL_ORIGIN,
        WIDGET_BASE_URL: WIDGET_ORIGIN,
      }),
    ).rejects.toThrow(/WIDGET_BASE_URL/);
  });
});
