/**
 * The platform-api process (tm 389.3 · docs/platform-admin/design.md §A):
 * its own Fastify server, its own database role, its own prefix — and nothing
 * of it inside the tenant API.
 */
import { PassThrough } from 'node:stream';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import {
  grantToken,
  ownerClient,
  resetDatabase,
  seedFixtures,
  testEnv,
} from '../helpers/fixtures.js';
import { startTestServer } from '../helpers/server.js';
import { VERSION } from '../../src/version.js';

/** Every bucket of this run's Redis — the tenant server in the same file charges its own. */
async function clearPlatformRateLimits(server: PlatformTestServer): Promise<void> {
  const keys = await server.app.redis.keys('rl:*');
  if (keys.length > 0) await server.app.redis.del(...keys);
}

describe('platform-api health (tm 389.3)', () => {
  let server: PlatformTestServer;

  beforeAll(async () => {
    server = await buildPlatformTestServer();
  });
  afterAll(async () => {
    await server?.close();
  });
  beforeEach(async () => {
    await clearPlatformRateLimits(server);
  });

  it('answers liveness without touching a dependency', async () => {
    const response = await server.get('/health/live');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'platform' });
    expect(typeof response.json().uptime_s).toBe('number');
  });

  it('is ready with Postgres and Redis up, on both readiness paths, with the narrow body', async () => {
    for (const path of ['/health/ready', '/health']) {
      const response = await server.get(path);
      expect(response.statusCode, path).toBe(200);
      expect(response.json(), path).toEqual({ status: 'ok', service: 'platform' });
    }
  });

  it('is not ready while its database is down — and still alive', async () => {
    const original = server.app.platformDb;
    // A client swapped onto this instance, never the run's own connection.
    const broken = new PrismaClient({
      datasourceUrl: 'postgresql://siyahtus_platform:x@127.0.0.1:1/siyahtus?connect_timeout=1',
    });
    server.app.platformDb = broken;
    try {
      for (const path of ['/health/ready', '/health']) {
        const response = await server.get(path);
        expect(response.statusCode, path).toBe(503);
        expect(response.json(), path).toEqual({ status: 'degraded', service: 'platform' });
      }
      expect((await server.get('/health/live')).statusCode).toBe(200);
    } finally {
      server.app.platformDb = original;
      await broken.$disconnect();
    }
    expect((await server.get('/health/ready')).statusCode).toBe(200);
  });

  it('says draining, not degraded, once shutdown has begun', async () => {
    const draining = await buildPlatformTestServer();
    try {
      draining.app.lifecycle.beginDraining();
      const response = await draining.get('/health/ready');
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ status: 'draining', service: 'platform' });
    } finally {
      await draining.close();
    }
  });

  it('serves version and region before sign-in, and nothing more', async () => {
    const response = await server.get('/meta');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ version: VERSION, region: testEnv().SIYAHTUS_REGION });
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('platform-api is its own process with its own role (tm 389.3)', () => {
  let server: PlatformTestServer;

  beforeAll(async () => {
    server = await buildPlatformTestServer();
  });
  afterAll(async () => {
    await server?.close();
  });

  it('connects as siyahtus_platform and has no tenant client to reach for', async () => {
    const [row] = await server.app.platformDb.$queryRaw<
      { user: string; bypass: boolean }[]
    >`SELECT current_user AS user, rolbypassrls AS bypass FROM pg_roles WHERE rolname = current_user`;
    expect(row).toEqual({ user: 'siyahtus_platform', bypass: true });
    expect(server.app.hasDecorator('db')).toBe(false);
    expect(server.app.hasDecorator('scheduler')).toBe(false);
  });

  it('serves nothing of the tenant API', async () => {
    for (const path of ['/api/v1/health/live', '/api/v1/deployment', '/api/v1/chats']) {
      const response = await server.app.inject({ method: 'GET', url: path });
      expect(response.statusCode, path).toBe(404);
      expect(response.json().error.type).toBe('not_found');
    }
  });

  it('the tenant API serves nothing of the platform (platform-isolation)', async () => {
    const owner = ownerClient();
    const tenant = await startTestServer();
    try {
      await resetDatabase(owner);
      const fx = await seedFixtures(owner);
      // A valid workspace credential, so the answer is the router's and not
      // authentication's: the tenant API answers an anonymous unknown path 401.
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: [],
      });
      for (const path of ['/platform/v1/health/live', '/platform/v1/meta', '/platform/v1/health']) {
        expect(tenant.app.hasRoute({ method: 'GET', url: path }), path).toBe(false);
        const response = await tenant.app.inject({
          method: 'GET',
          url: path,
          headers: { authorization: `Bearer ${token}` },
        });
        expect(response.statusCode, path).toBe(404);
        expect(response.json().error.type, path).toBe('not_found');
      }
      expect(tenant.app.printRoutes({ commonPrefix: false })).not.toContain('platform/v1');
      // The tenant API is otherwise up: the 404 is the prefix, not a dead server.
      expect((await tenant.get('/health/live')).statusCode).toBe(200);
    } finally {
      await tenant.close();
      await owner.$disconnect();
    }
  });

  it('answers CORS for the admin SPA only, in every environment', async () => {
    const allowed = await server.app.inject({
      method: 'OPTIONS',
      url: server.url('/meta'),
      headers: { origin: 'http://localhost:5175', 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5175');
    expect(allowed.headers['access-control-allow-credentials']).toBeUndefined();

    const panel = await server.app.inject({
      method: 'GET',
      url: server.url('/meta'),
      headers: { origin: 'http://localhost:5173' },
    });
    expect(panel.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('names itself on every log line, with the request id under its #288 key', async () => {
    const stream = new PassThrough();
    const lines: Record<string, unknown>[] = [];
    stream.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as Record<string, unknown>);
      }
    });
    const logged = await buildPlatformTestServer({ LOG_LEVEL: 'info' }, { logStream: stream });
    try {
      await logged.get('/meta', { 'x-request-id': 'platform-log-test-1' });
    } finally {
      await logged.close();
    }
    const requestLines = lines.filter((line) => line['request_id'] === 'platform-log-test-1');
    expect(requestLines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line['service']).toBe('platform');
  });
});

describe('platform rate limit (tm 389.3)', () => {
  let server: PlatformTestServer;

  beforeAll(async () => {
    server = await buildPlatformTestServer({ RATE_LIMIT_PLATFORM_PER_MIN: '2' });
  });
  afterAll(async () => {
    await server?.close();
  });
  beforeEach(async () => {
    await clearPlatformRateLimits(server);
  });

  it('refuses the request past RATE_LIMIT_PLATFORM_PER_MIN with Retry-After, in its own rl:platform: bucket', async () => {
    expect((await server.get('/meta')).statusCode).toBe(200);
    const second = await server.get('/meta');
    expect(second.statusCode).toBe(200);
    expect(second.headers['x-ratelimit-limit']).toBe('2');
    expect(second.headers['x-ratelimit-remaining']).toBe('0');

    const refused = await server.get('/meta');
    expect(refused.statusCode).toBe(429);
    expect(refused.json().error.type).toBe('too_many_requests');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);

    const keys = await server.app.redis.keys('rl:*');
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys.filter((k) => k.includes('127.0.0.1'))) {
      expect(key.startsWith('rl:platform:')).toBe(true);
    }
  });

  it('keeps the health probes on their own bucket, so a spent budget never fails readiness', async () => {
    await server.get('/meta');
    await server.get('/meta');
    expect((await server.get('/meta')).statusCode).toBe(429);
    for (let i = 0; i < 3; i += 1) {
      expect((await server.get('/health/ready')).statusCode).toBe(200);
    }
  });
});
