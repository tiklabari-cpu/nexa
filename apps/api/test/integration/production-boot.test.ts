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
