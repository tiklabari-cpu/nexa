/**
 * The root panel's deployment settings (tm 389.13 · docs/platform-admin/design.md §B2, §C
 * settings), driven through the platform API and judged from the tenant API: the sign-up
 * switch (the stricter of the panel and `SIGNUP_ENABLED` wins), the blocklist at sign-up and
 * at an invitation, the trial length of the next workspace, the announcement and maintenance
 * mode on `GET /deployment/notice`, maintenance at the tenant edge, the announcement reaching a
 * running tenant API within a second, and the effective configuration — redacted, sourced.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OPS_CONFIG_KEY, OPS_MAINTENANCE_KEY, type PlatformRole } from '@siyahtus/types';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type ErrorBody = { error: { type: string; details?: Record<string, unknown> } };

const REASON = 'Deployment change agreed with the owner';
const STRONG_PASSWORD = 'a-quite-long-passphrase';
const MINUTE = 60_000;

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('platform deployment settings (tm 389.13)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let fx: Fixtures;
  const tokens = new Map<PlatformRole, string>();
  const extraServers: TestServer[] = [];

  const call = (
    method: 'GET' | 'PATCH' | 'PUT',
    path: string,
    body?: Record<string, unknown>,
    role: PlatformRole = 'superadmin',
  ): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method,
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(tokens.get(role)!),
      ...(body === undefined ? {} : { payload: body }),
    });
  const patch = (body: Record<string, unknown>, role: PlatformRole = 'superadmin') =>
    call('PATCH', '/settings', { reason: REASON, ...body }, role);
  const maintenance = (body: Record<string, unknown>, role: PlatformRole = 'superadmin') =>
    call('PUT', '/settings/maintenance', { reason: REASON, ...body }, role);
  const ok = async (response: Promise<LightMyRequestResponse>) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(200);
    return settled.json() as Record<string, unknown>;
  };
  const errorOf = (response: LightMyRequestResponse) => (response.json() as ErrorBody).error;

  /** What the tenant API applies now — its cache dropped, as `settings.changed` would. */
  const applied = () => tenant.app.publicSettings.refresh();

  let signups = 0;
  const signUp = (server: TestServer = tenant, email = `founder${(signups += 1)}@newco.test`) =>
    server.post('/auth/signup', {
      email,
      password: STRONG_PASSWORD,
      name: 'Founder',
      organization_name: `NewCo ${signups}`,
    });

  async function start(overrides: Partial<NodeJS.ProcessEnv>): Promise<TestServer> {
    const server = await startTestServer(overrides);
    extraServers.push(server);
    return server;
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    platform = await buildPlatformTestServer(
      { RATE_LIMIT_PLATFORM_PER_MIN: '100000' },
      { now: clock.read },
    );
    tenant = await startTestServer();
  });

  afterAll(async () => {
    await platform?.close();
    await tenant?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    clock.now = Date.now();
    fx = await seedFixtures(owner);
    await clearRateLimits(tenant.app);
    await tenant.app.redis.del(OPS_MAINTENANCE_KEY, OPS_CONFIG_KEY);
    tenant.app.publicSettings.invalidate();
    tokens.clear();
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  });

  afterEach(async () => {
    while (extraServers.length > 0) await extraServers.pop()!.close();
  });

  describe('the settings routes', () => {
    it('reads nothing set as null, and changes only what is named — recorded with before and after', async () => {
      expect(await ok(call('GET', '/settings'))).toEqual({
        signup_enabled: null,
        trial_days: null,
        announcement: null,
        maintenance: null,
        updated_at: null,
      });

      const after = await ok(patch({ trial_days: 7 }));
      expect(after).toMatchObject({ signup_enabled: null, trial_days: 7 });
      expect(after['updated_at']).toEqual(expect.any(String));

      const [entry] = await owner.platformAuditLog.findMany({
        where: { action: 'settings.updated' },
      });
      expect(entry).toMatchObject({
        targetType: 'settings',
        targetId: 'trial_days',
        reason: REASON,
        licenseId: null,
        payload: { trial_days: { from: null, to: 7 } },
      });
      const row = await owner.platformSetting.findUniqueOrThrow({ where: { key: 'trial_days' } });
      expect(row).toMatchObject({ value: 7, version: 1 });

      // The same value again changes nothing and records nothing.
      await ok(patch({ trial_days: 7 }));
      expect(await owner.platformAuditLog.count({ where: { action: 'settings.updated' } })).toBe(1);

      // `null` hands the key back to the environment.
      await ok(patch({ trial_days: null }));
      expect(await owner.platformSetting.count({ where: { key: 'trial_days' } })).toBe(0);
    });

    it('refuses a body that names nothing, a misspelt key, one language, and a trial out of bounds', async () => {
      for (const body of [
        {},
        { trial_day: 7 },
        { trial_days: 0 },
        { trial_days: 366 },
        { announcement: { level: 'info', en: 'Hello', until: null } },
        { announcement: { level: 'loud', en: 'Hello', tr: 'Merhaba', until: null } },
      ]) {
        const response = await patch(body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
        expect(errorOf(response).type).toBe('validation');
      }
      const unreasoned = await call('PATCH', '/settings', { trial_days: 7 });
      expect(errorOf(unreasoned).type).toBe('platform_reason_required');
    });

    it('lets superadmin change the settings and refuses billing even the read', async () => {
      await ok(call('GET', '/settings', undefined, 'readonly'));
      await ok(call('GET', '/settings', undefined, 'support'));
      for (const role of ['support', 'billing', 'readonly'] as const) {
        const response = await patch({ signup_enabled: false }, role);
        expect(response.statusCode, role).toBe(403);
        expect(errorOf(response).type).toBe('authorization');
      }
      expect((await call('GET', '/settings', undefined, 'billing')).statusCode).toBe(403);
      await ok(patch({ signup_enabled: false }));
    });

    it('asks for a fresh code before maintenance mode changes', async () => {
      clock.advance(6 * MINUTE);
      const stale = await maintenance({ enabled: true, mode: 'full' });
      expect(stale.statusCode).toBe(403);
      expect(errorOf(stale).type).toBe('platform_recent_totp_required');
      expect(await owner.platformSetting.count({ where: { key: 'maintenance' } })).toBe(0);
    });
  });

  describe('sign-up at the tenant API', () => {
    it('closes sign-up when the panel says so, while SIGNUP_ENABLED is true', async () => {
      await ok(patch({ signup_enabled: false }));
      await applied();
      const response = await signUp();
      expect(response.statusCode).toBe(403);
      expect(errorOf(response)).toMatchObject({
        type: 'not_allowed',
        details: { reason: 'signup_closed' },
      });
      expect((await tenant.get('/deployment')).json()).toMatchObject({ signup_enabled: false });
    });

    it('keeps sign-up closed under SIGNUP_ENABLED=false even when the panel opens it', async () => {
      const closed = await start({ SIGNUP_ENABLED: 'false' });
      await ok(patch({ signup_enabled: true }));
      await closed.app.publicSettings.refresh();
      const response = await signUp(closed);
      expect(response.statusCode).toBe(403);
      expect(errorOf(response).details?.['reason']).toBe('signup_closed');
      expect((await closed.get('/deployment')).json()).toMatchObject({ signup_enabled: false });
    });

    it('refuses an address, its domain or the caller’s network on the blocklist', async () => {
      await owner.platformBlocklist.createMany({
        data: [
          { kind: 'email', value: 'spammer@bad.test' },
          { kind: 'domain', value: 'burner.test' },
        ],
      });
      for (const email of ['spammer@bad.test', 'anyone@mail.burner.test']) {
        const response = await signUp(tenant, email);
        expect(response.statusCode, email).toBe(403);
        expect(errorOf(response)).toMatchObject({
          type: 'not_allowed',
          details: { reason: 'signup_blocked' },
        });
      }
      expect((await signUp(tenant, 'fine@good.test')).statusCode).toBe(201);

      // `inject` comes from 127.0.0.1.
      await owner.platformBlocklist.create({ data: { kind: 'ip', value: '127.0.0.0/8' } });
      const fromNetwork = await signUp(tenant, 'other@good.test');
      expect(errorOf(fromNetwork).details?.['reason']).toBe('signup_blocked');
    });

    it('applies the blocklist to an invitation, which a closed sign-up does not stop', async () => {
      const ownerToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['accounts--all:rw'],
      });
      const invite = async (email: string) => {
        const response = await tenant.post(
          '/invitations',
          { emails: [email], role: 'agent' },
          { authorization: `Bearer ${ownerToken}` },
        );
        expect(response.statusCode, response.body).toBe(201);
        const url = (response.json() as { items: Array<{ accept_url: string }> }).items[0]!
          .accept_url;
        return new URL(url).searchParams.get('token')!;
      };
      const accept = (token: string) =>
        tenant.post('/auth/invitations/accept', {
          token,
          name: 'Teammate',
          password: STRONG_PASSWORD,
        });

      await ok(patch({ signup_enabled: false }));
      await applied();
      // Closed sign-up: an invitee still gets through to proving the address.
      expect((await accept(await invite('invitee@good.test'))).statusCode).toBe(202);

      await owner.platformBlocklist.create({ data: { kind: 'domain', value: 'blocked.test' } });
      const token = await invite('invitee@blocked.test');
      const refused = await accept(token);
      expect(refused.statusCode).toBe(403);
      expect(errorOf(refused).details?.['reason']).toBe('signup_blocked');
      // Refused before anything was spent: the invitation is still open.
      expect((await tenant.get(`/auth/invitations/preview?token=${token}`)).statusCode).toBe(200);
      expect(await owner.account.count({ where: { email: 'invitee@blocked.test' } })).toBe(0);
    });

    it('opens the next workspace with the panel’s trial length', async () => {
      await ok(patch({ trial_days: 7 }));
      await applied();
      const response = await signUp(tenant, 'founder@sevenco.test');
      expect(response.statusCode, response.body).toBe(201);
      const license = await owner.license.findFirstOrThrow({
        where: { organization: { name: `NewCo ${signups}` } },
      });
      const days = (license.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThan(7.1);
    });
  });

  describe('the notice and maintenance mode', () => {
    const announcement = { level: 'warning', en: 'Upgrade tonight', tr: 'Bu gece güncelleme' };

    it('serves the announcement, and nothing once its end has passed', async () => {
      await ok(patch({ announcement: { ...announcement, until: null } }));
      await applied();
      const response = await tenant.get('/deployment/notice');
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-cache');
      expect(response.json()).toEqual({
        announcement: { ...announcement, until: null },
        maintenance: null,
      });

      const past = new Date(Date.now() - MINUTE).toISOString();
      await ok(patch({ announcement: { ...announcement, until: past } }));
      await applied();
      expect((await tenant.get('/deployment/notice')).json()).toEqual({
        announcement: null,
        maintenance: null,
      });
    });

    it('in full maintenance refuses every request but health, the notice and signing out', async () => {
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:ro'],
      });
      const auth = { authorization: `Bearer ${agentToken}` };
      expect((await tenant.get('/chats', auth)).statusCode).toBe(200);

      const stored = await ok(
        maintenance({ enabled: true, mode: 'full', message: { en: 'Back soon', tr: 'Birazdan' } }),
      );
      expect(stored['maintenance']).toEqual({
        enabled: true,
        mode: 'full',
        message: { en: 'Back soon', tr: 'Birazdan' },
      });
      // Where the realtime gateway reads it.
      expect(JSON.parse((await tenant.app.redis.get(OPS_MAINTENANCE_KEY))!)).toEqual({
        mode: 'full',
      });
      await applied();

      const chats = await tenant.get('/chats', auth);
      expect(chats.statusCode).toBe(503);
      expect(errorOf(chats)).toMatchObject({ type: 'maintenance', details: { mode: 'full' } });
      expect((await signUp()).statusCode).toBe(503);
      expect((await tenant.get('/health/live')).statusCode).toBe(200);
      expect((await tenant.get('/deployment')).statusCode).toBe(200);
      expect((await tenant.get('/deployment/notice')).json()).toEqual({
        announcement: null,
        maintenance: { mode: 'full', message: { en: 'Back soon', tr: 'Birazdan' } },
      });
      const signOut = await tenant.post('/auth/revoke', { token: agentToken });
      expect(signOut.statusCode).toBeLessThan(500);

      await ok(maintenance({ enabled: false, mode: 'full' }));
      expect(await tenant.app.redis.get(OPS_MAINTENANCE_KEY)).toBeNull();
      expect(
        await owner.platformAuditLog.count({ where: { action: 'settings.maintenance_changed' } }),
      ).toBe(2);
    });

    it('in read-only maintenance lets reads and sign-in through and refuses writes', async () => {
      const agentToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro', 'accounts--all:rw'],
      });
      const auth = { authorization: `Bearer ${agentToken}` };
      await ok(maintenance({ enabled: true, mode: 'read_only' }));
      await applied();

      expect((await tenant.get('/chats', auth)).statusCode).toBe(200);
      const write = await tenant.post(
        '/invitations',
        { invitations: [{ email: 'x@good.test', role: 'agent' }] },
        auth,
      );
      expect(write.statusCode).toBe(503);
      expect(errorOf(write)).toMatchObject({ type: 'maintenance', details: { mode: 'read_only' } });
      // Signing in is a write the mode lets through: a wrong password is a 401, not a 503.
      const login = await tenant.post('/auth/login', {
        email: fx.a.ownerEmail,
        password: 'not-the-password',
      });
      expect(login.statusCode).toBe(401);
    });

    it('reaches a running tenant API within a second of the change, through settings.changed', async () => {
      // A cached copy first, as a live server holds one.
      expect((await tenant.get('/deployment')).json()).toMatchObject({ signup_enabled: true });
      await ok(patch({ signup_enabled: false }));
      const changedAt = Date.now();
      let seen = true;
      while (Date.now() - changedAt < 1_000) {
        seen = ((await tenant.get('/deployment')).json() as { signup_enabled: boolean })
          .signup_enabled;
        if (!seen) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(seen).toBe(false);
    });

    it('keeps serving on the environment when the settings cannot be read', async () => {
      // The function is the tenant's only door to the table; without it the read fails.
      await owner.$executeRawUnsafe(
        'ALTER FUNCTION platform_public_settings() RENAME TO platform_public_settings_away',
      );
      try {
        tenant.app.publicSettings.invalidate();
        expect((await tenant.get('/deployment')).json()).toMatchObject({ signup_enabled: true });
        expect((await tenant.get('/deployment/notice')).statusCode).toBe(200);
        expect((await signUp()).statusCode).toBe(201);
      } finally {
        await owner.$executeRawUnsafe(
          'ALTER FUNCTION platform_public_settings_away() RENAME TO platform_public_settings',
        );
        tenant.app.publicSettings.invalidate();
      }
    });
  });

  describe('the effective configuration', () => {
    it('is not reporting until the tenant API publishes', async () => {
      expect(await ok(call('GET', '/settings/effective-config'))).toEqual({
        stale: true,
        generated_at: null,
        age_s: null,
        entries: [],
      });
    });

    it('lists the tenant API’s keys with secrets as set or unset, URLs without passwords, each with a source', async () => {
      const configured = await start({ LLM_API_KEY: 'sk-test-never-shown-1234567890' });
      await ok(patch({ trial_days: 9 }));
      await configured.app.opsHealth.publish();

      const body = (await ok(call('GET', '/settings/effective-config', undefined, 'readonly'))) as {
        stale: boolean;
        entries: Array<{ key: string; value: string | null; source: string; redacted: boolean }>;
      };
      expect(body.stale).toBe(false);
      const entry = (key: string) => body.entries.find((candidate) => candidate.key === key);
      expect(entry('LLM_API_KEY')).toMatchObject({ value: 'set', redacted: true, source: 'env' });
      expect(entry('TRIAL_DAYS')).toMatchObject({ value: '9', source: 'db' });
      expect(entry('PILOT_MODE')).toBeDefined();
      expect(entry('APPS_LIVE_PROVIDERS')).toBeDefined();
      for (const candidate of body.entries) {
        expect(['db', 'env', 'default']).toContain(candidate.source);
      }

      const text = JSON.stringify(body);
      expect(text).not.toContain('sk-test-never-shown');
      const password = new URL(testEnv().DATABASE_URL).password;
      if (password) expect(text).not.toContain(`:${password}@`);
      expect(entry('DATABASE_URL')?.value).not.toMatch(/\/\/[^/]*@/);

      expect(
        (await call('GET', '/settings/effective-config', undefined, 'billing')).statusCode,
      ).toBe(403);
    });
  });
});
