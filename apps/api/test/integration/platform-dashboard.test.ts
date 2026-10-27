/**
 * The root panel's dashboard (tm 389.8 · FR-ADMIN-07 · docs/platform-admin/design.md §A, §C).
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a requirement tag
 * (CONVENTIONS §7.3); the letters (a)–(f) are the task's acceptance list.
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPS_COMPONENTS } from '@siyahtus/types';
import { buildPlatformServer, PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  OPS_COMPONENTS_KEY,
  reportComponentStatus,
} from '../../src/services/ops/component-status.js';
import { deliver } from '../../src/services/mail/delivery.js';
import { OPS_HEALTH_KEY, OPS_HEALTH_TTL_S } from '../../src/services/ops/health-keys.js';
import { HealthSnapshotPublisher } from '../../src/services/ops/health-publisher.js';
import {
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { startTestServer, type TestServer } from '../helpers/server.js';

const DAY = 86_400_000;
const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

const dayKey = (at: Date) => at.toISOString().slice(0, 10).replaceAll('-', '');

describe('the platform dashboard (tm 389.8)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let fx: Fixtures;
  let token: string;

  const get = (path: string, as: string | null = token): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method: 'GET',
      url: `${PLATFORM_PREFIX}${path}`,
      headers: as ? bearer(as) : {},
    });

  async function clearOps(): Promise<void> {
    await platform.app.redis.del(
      OPS_HEALTH_KEY,
      OPS_COMPONENTS_KEY,
      'siyahtus:sched:ops_health_snapshot',
    );
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    platform = await buildPlatformTestServer({}, { now: clock.read });
    tenant = await startTestServer();
  });

  afterAll(async () => {
    await platform?.close();
    await tenant?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    const operator = await createOperator(db, { role: 'superadmin', clock });
    token = await openActiveSession(db, operator, clock);
    await clearOps();
    clock.now = Date.now();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('(a) kpis', () => {
    it('counts workspaces by status, trials ending within seven days and operators signed in', async () => {
      const third = await owner.organization.create({ data: { name: 'Org C', region: 'eu' } });
      await owner.license.create({
        data: {
          organizationId: third.id,
          status: 'trialing',
          trialEndsAt: new Date(clock.now + 20 * DAY),
        },
      });
      // a: trialing, ends in 3 days · b: active · c (below): suspended
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { trialEndsAt: new Date(clock.now + 3 * DAY) },
      });
      await owner.license.update({
        where: { id: fx.b.licenseId },
        data: { status: 'active', trialEndsAt: null },
      });
      const suspendedOrg = await owner.organization.create({
        data: { name: 'Org D', region: 'eu' },
      });
      await owner.license.create({
        data: {
          organizationId: suspendedOrg.id,
          status: 'suspended',
          suspendedAt: new Date(clock.now),
          suspendedReason: 'test',
        },
      });
      // A sandbox is a second tenant of the same customer, not a workspace.
      await owner.license.create({
        data: {
          organizationId: (
            await owner.organization.create({ data: { name: 'Sandbox', region: 'eu' } })
          ).id,
          status: 'trialing',
          trialEndsAt: new Date(clock.now + 2 * DAY),
          sandboxOfLicenseId: fx.a.licenseId,
        },
      });
      // A second operator signed in; a third whose session is idle past the window is not counted.
      const second = await createOperator(db, { role: 'support', clock });
      await openActiveSession(db, second, clock);
      const idle = await createOperator(db, { role: 'readonly', clock });
      await openActiveSession(db, idle, clock);
      await owner.platformSession.updateMany({
        where: { adminId: idle.id },
        data: { lastSeenAt: new Date(clock.now - 3_600_000) },
      });

      const response = await get('/dashboard/kpis');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const kpis = response.json();
      expect(kpis.workspaces).toEqual({
        total: 4,
        by_status: { trialing: 2, active: 1, past_due: 0, read_only: 0, canceled: 0, suspended: 1 },
      });
      // a ends in 3 days; the 20-day one and the sandbox (not a workspace) do not count.
      expect(kpis.trials_ending_7d).toBe(1);
      expect(kpis.active_operator_sessions).toBe(2);
      expect(kpis.pending_payment_requests).toBe(0);
    });

    it('reads today’s AI tokens from the deployment row and the month’s usage records', async () => {
      const day = dayKey(new Date(clock.now));
      await owner.$executeRaw`
        INSERT INTO ai_daily_usage (id, license_id, day, meter, used, updated_at)
        VALUES (gen_random_uuid(), NULL, ${day}, 'llm', 1200, now()),
               (gen_random_uuid(), NULL, ${day}, 'embedding', 300, now()),
               (gen_random_uuid(), ${fx.a.licenseId}, ${day}, 'llm', 700, now()),
               (gen_random_uuid(), NULL, '20000101', 'llm', 9999, now())`;
      const period = day.slice(0, 6);
      await owner.usageRecord.createMany({
        data: [
          { licenseId: fx.a.licenseId, metric: 'ai_resolutions', period, quantity: 5n },
          { licenseId: fx.b.licenseId, metric: 'ai_resolutions', period, quantity: 7n },
          { licenseId: fx.a.licenseId, metric: 'api_calls', period, quantity: 100n },
          { licenseId: fx.a.licenseId, metric: 'api_calls', period: '200001', quantity: 55n },
        ],
      });

      const kpis = (await get('/dashboard/kpis')).json();
      expect(kpis.usage).toEqual({
        day,
        ai_tokens_today: { llm: 1200, embedding: 300 },
        period,
        ai_resolutions_month: 12,
        api_calls_month: 100,
      });
    });

    it('counts the manual payment queue once its table exists, and is 0 before', async () => {
      expect((await get('/dashboard/kpis')).json().pending_payment_requests).toBe(0);
      await owner.$executeRawUnsafe(
        'CREATE TABLE IF NOT EXISTS crypto_payment_requests (status text)',
      );
      try {
        await owner.$executeRawUnsafe(
          "INSERT INTO crypto_payment_requests (status) VALUES ('pending'), ('pending'), ('confirmed')",
        );
        expect((await get('/dashboard/kpis')).json().pending_payment_requests).toBe(2);
      } finally {
        await owner.$executeRawUnsafe('DROP TABLE IF EXISTS crypto_payment_requests');
      }
    });

    it('names no workspace, account or message anywhere in the body', async () => {
      const body = (await get('/dashboard/kpis')).body + (await get('/dashboard/signups')).body;
      expect(body).not.toContain(fx.a.ownerEmail);
      expect(body).not.toContain('Org A');
    });
  });

  describe('(b) signups', () => {
    it('is a zero-filled thirty-day series, oldest first, sandboxes and older workspaces left out', async () => {
      const today = new Date(clock.now);
      await owner.license.update({ where: { id: fx.a.licenseId }, data: { createdAt: today } });
      await owner.license.update({
        where: { id: fx.b.licenseId },
        data: { createdAt: new Date(clock.now - 2 * DAY) },
      });
      await owner.license.create({
        data: {
          organizationId: (await owner.organization.create({ data: { name: 'Old', region: 'eu' } }))
            .id,
          createdAt: new Date(clock.now - 40 * DAY),
        },
      });

      const series = (await get('/dashboard/signups')).json() as {
        days: number;
        total: number;
        data: Array<{ date: string; count: number }>;
      };
      expect(series.days).toBe(30);
      expect(series.data).toHaveLength(30);
      expect(series.total).toBe(2);
      expect(series.data.at(-1)).toEqual({ date: today.toISOString().slice(0, 10), count: 1 });
      expect(series.data.at(-3)?.count).toBe(1);
      expect(series.data.at(-2)?.count).toBe(0);
      const dates = series.data.map((point) => point.date);
      expect([...dates].sort()).toEqual(dates);

      const week = (await get('/dashboard/signups?days=7')).json();
      expect(week.data).toHaveLength(7);
      expect(week.total).toBe(2);
    });

    it('refuses a window outside 1–90 days', async () => {
      for (const days of ['0', '91', 'abc', '-3']) {
        const response = await get(`/dashboard/signups?days=${days}`);
        expect(response.statusCode, days).toBe(400);
      }
    });
  });

  describe('(c) health', () => {
    it('says "not reporting" before any publication: 200, stale, no snapshot, twelve unknown components', async () => {
      const response = await get('/dashboard/health');
      expect(response.statusCode, response.body).toBe(200);
      const health = response.json();
      expect(health).toMatchObject({
        stale: true,
        generated_at: null,
        age_s: null,
        snapshot: null,
      });
      expect(health.components.map((c: { key: string }) => c.key)).toEqual([...OPS_COMPONENTS]);
      expect(health.components.every((c: { state: string }) => c.state === 'unknown')).toBe(true);
    });

    it('serves the leader’s publication fresh, with the components it judges itself', async () => {
      const stored = await tenant.app.opsHealth.publish();
      expect(stored).not.toBeNull();

      const health = (await get('/dashboard/health')).json();
      expect(health.stale).toBe(false);
      expect(health.snapshot).toMatchObject({
        status: 'ok',
        service: 'api',
        dependencies: { database: { status: 'up' }, redis: { status: 'up' } },
        scheduler: { enabled: false },
      });
      expect(health.snapshot.version).toBe(stored!.health.version);
      const byKey = Object.fromEntries(
        health.components.map((c: { key: string; state: string }) => [c.key, c.state]),
      );
      // The test environment mails nowhere (`MAIL_PROVIDER=null`): not a fault, not installed.
      expect(byKey).toMatchObject({
        db: 'ok',
        redis: 'ok',
        scheduler: 'ok',
        mail: 'not_installed',
      });
      // Since tm 389.14 the leader also judges the modules it can see — and marks the ones this
      // build does not contain — so a publication leaves none of the twelve unreported. The test
      // server has no GeoIP file and says so.
      expect(byKey['geoip']).toBe('not_installed');
      expect(Object.values(byKey)).not.toContain('unknown');
    });

    it('carries the admin health body’s fields, in its order', async () => {
      const stored = await tenant.app.opsHealth.publish();
      const direct = await tenant.app.inject({ method: 'GET', url: '/api/v1/health' });
      // Anonymous gets the narrow body; the snapshot is the admin one, so compare its keys.
      expect(direct.json()).toEqual({ status: 'ok', service: 'api' });
      expect(Object.keys(stored!.health)).toEqual([
        'status',
        'service',
        'version',
        'region',
        'uptime_s',
        'dependencies',
        'scheduler',
        'event_partitions',
        'ai_jobs',
        'providers',
      ]);
    });

    it('expires: the key carries a TTL of at most 90 s, and deleting it makes the view stale', async () => {
      await tenant.app.opsHealth.publish();
      const ttl = await platform.app.redis.pttl(OPS_HEALTH_KEY);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(OPS_HEALTH_TTL_S * 1000);

      expect((await get('/dashboard/health')).json().stale).toBe(false);
      await platform.app.redis.del(OPS_HEALTH_KEY);
      const gone = (await get('/dashboard/health')).json();
      expect(gone).toMatchObject({ stale: true, snapshot: null });
    });

    it('marks a lingering publication stale once it is older than 90 s, keeping what it said', async () => {
      await tenant.app.opsHealth.publish();
      clock.advance(60_000);
      expect((await get('/dashboard/health')).json().stale).toBe(false);
      clock.advance(40_000);
      const old = (await get('/dashboard/health')).json();
      expect(old.stale).toBe(true);
      expect(old.age_s).toBeGreaterThan(90);
      expect(old.snapshot).not.toBeNull();
    });

    it('lists a component a module reported, including "not installed", and refuses an unlisted key', async () => {
      await reportComponentStatus(tenant.app.redis, 'geoip', {
        state: 'not_installed',
        detail: 'no database file',
      });
      await reportComponentStatus(tenant.app.redis, 'webhooks', {
        state: 'degraded',
        detail: 'x'.repeat(500),
      });
      expect(
        await reportComponentStatus(tenant.app.redis, 'nonsense' as never, { state: 'ok' }),
      ).toBe(false);
      expect(
        await reportComponentStatus(tenant.app.redis, 'geoip', { state: 'weird' as never }),
      ).toBe(false);

      const { components } = (await get('/dashboard/health')).json();
      const geoip = components.find((c: { key: string }) => c.key === 'geoip');
      expect(geoip).toMatchObject({ state: 'not_installed', detail: 'no database file' });
      expect(geoip.updated_at).not.toBeNull();
      const webhooks = components.find((c: { key: string }) => c.key === 'webhooks');
      expect(webhooks.state).toBe('degraded');
      expect(webhooks.detail).toHaveLength(200);
      expect(components).toHaveLength(OPS_COMPONENTS.length);
    });

    it('survives a damaged record: unreadable JSON is "unknown", not a 500', async () => {
      await platform.app.redis.set(OPS_HEALTH_KEY, '{not json');
      await platform.app.redis.hset(
        OPS_COMPONENTS_KEY,
        'mail',
        'garbage',
        'db',
        '{"state":"on fire"}',
      );
      const response = await get('/dashboard/health');
      expect(response.statusCode, response.body).toBe(200);
      const health = response.json();
      expect(health).toMatchObject({ stale: true, snapshot: null });
      expect(health.components.find((c: { key: string }) => c.key === 'mail').state).toBe(
        'unknown',
      );
      expect(health.components.find((c: { key: string }) => c.key === 'db').state).toBe('unknown');
    });

    it('answers 200 and stale when Redis cannot be read, never 500', async () => {
      vi.spyOn(platform.app.redis, 'get').mockRejectedValue(new Error('redis down'));
      vi.spyOn(platform.app.redis, 'hgetall').mockRejectedValue(new Error('redis down'));
      const response = await get('/dashboard/health');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ stale: true, snapshot: null });
      expect(response.json().components).toHaveLength(OPS_COMPONENTS.length);
    });

    it('reports a failing scheduler job as a degraded scheduler', async () => {
      const original = tenant.app.scheduler.snapshot.bind(tenant.app.scheduler);
      vi.spyOn(tenant.app.scheduler, 'snapshot').mockImplementation(() => {
        const snapshot = original();
        return {
          ...snapshot,
          jobs: snapshot.jobs.map((job, index) =>
            index === 0
              ? { ...job, last_status: 'error' as const, last_error_class: 'Error' }
              : job,
          ),
        };
      });
      await tenant.app.opsHealth.publish();
      const { components } = (await get('/dashboard/health')).json();
      const scheduler = components.find((c: { key: string }) => c.key === 'scheduler');
      expect(scheduler.state).toBe('degraded');
      expect(scheduler.detail).toContain('failing:');
    });
  });

  describe('(d) the leader’s 30-second publication', () => {
    it('reports mail as ok on a carrier, and degraded after a send that failed', async () => {
      const mailing = new HealthSnapshotPublisher({
        db: tenant.app.db,
        redis: tenant.app.redis,
        env: testEnv({ MAIL_PROVIDER: 'file' }),
        version: 'test',
        scheduler: tenant.app.scheduler,
        eventPartitions: tenant.app.eventPartitions,
        logger: tenant.app.log,
        enabled: true,
      });
      const mail = async () =>
        (await get('/dashboard/health'))
          .json()
          .components.find((c: { key: string }) => c.key === 'mail');
      const message = { to: 'a@example.test', subject: 's', text: 't' } as never;

      await deliver({ send: async () => undefined }, message);
      await mailing.publish();
      expect(await mail()).toMatchObject({ state: 'ok', detail: 'file' });

      await deliver(
        {
          send: async () => {
            throw new Error('smtp refused');
          },
        },
        message,
      );
      await mailing.publish();
      expect(await mail()).toMatchObject({ state: 'degraded' });

      // A later success clears it.
      await deliver({ send: async () => undefined }, message);
      await mailing.publish();
      expect((await mail()).state).toBe('ok');
    });

    function instance(): HealthSnapshotPublisher {
      return new HealthSnapshotPublisher({
        db: tenant.app.db,
        redis: tenant.app.redis,
        env: testEnv(),
        version: 'test',
        scheduler: tenant.app.scheduler,
        eventPartitions: tenant.app.eventPartitions,
        logger: tenant.app.log,
        enabled: true,
      });
    }

    it('is written by one instance at a time, and handed over when the leader stops', async () => {
      const first = instance();
      const second = instance();
      expect(await first.tick()).toBe('published');
      expect(await second.tick()).toBe('skipped');
      expect((await get('/dashboard/health')).json().snapshot.version).toBe('test');

      await first.stop();
      expect(await second.tick()).toBe('published');
      await second.stop();
    });

    it('does not start when the scheduler is switched off', async () => {
      const off = new HealthSnapshotPublisher({
        db: tenant.app.db,
        redis: tenant.app.redis,
        env: testEnv(),
        version: 'test',
        scheduler: tenant.app.scheduler,
        eventPartitions: tenant.app.eventPartitions,
        logger: tenant.app.log,
        enabled: false,
      });
      off.start();
      await off.stop();
      expect(await platform.app.redis.exists(OPS_HEALTH_KEY)).toBe(0);
    });
  });

  describe('(e) access', () => {
    it('is open to every role that holds dashboard.read, and to none without a session', async () => {
      for (const role of ['support', 'billing', 'readonly'] as const) {
        const operator = await createOperator(db, { role, clock });
        const roleToken = await openActiveSession(db, operator, clock);
        for (const path of ['/dashboard/kpis', '/dashboard/signups', '/dashboard/health']) {
          const response = await get(path, roleToken);
          expect(response.statusCode, `${role} ${path}`).toBe(200);
        }
      }
      for (const path of ['/dashboard/kpis', '/dashboard/signups', '/dashboard/health']) {
        expect((await get(path, null)).statusCode, path).toBe(401);
        expect((await get(path, 'not-a-token')).statusCode, path).toBe(401);
      }
    });

    it('is not served by the tenant API', async () => {
      // No route there at all (platform-isolation.test.ts holds the 404 for an authenticated call).
      for (const path of ['/dashboard/kpis', '/dashboard/signups', '/dashboard/health']) {
        expect(tenant.app.hasRoute({ method: 'GET', url: `${PLATFORM_PREFIX}${path}` }), path).toBe(
          false,
        );
      }
    });
  });

  describe('(f) the platform process stays a platform process', () => {
    it('registers no publisher or scheduler of its own', async () => {
      expect(platform.app.hasDecorator('opsHealth')).toBe(false);
      expect(platform.app.hasDecorator('scheduler')).toBe(false);
    });

    it('builds from a bare environment like the other platform tests', async () => {
      const app = await buildPlatformServer({ env: testEnv() });
      await app.ready();
      await app.close();
    });
  });
});
