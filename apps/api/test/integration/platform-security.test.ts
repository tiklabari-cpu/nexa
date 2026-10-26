/**
 * The root panel's Security page (tm 389.16 · FR-ADMIN-22 · docs/platform-admin/design.md §C security),
 * driven through the platform API and judged from the tenant API: the sign-up blocklist (an address, a
 * domain with its subdomains, a CIDR — added, refused at sign-up, lifted), failed sign-ins, the
 * sign-ups-by-address answer, the impersonation list and the abuse counters.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a requirement tag
 * (CONVENTIONS §7.3); the letters (a)–(k) are the task's acceptance list.
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformRole } from '@siyahtus/types';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  OPS_COMPONENTS_KEY,
  reportComponentStatus,
} from '../../src/services/ops/component-status.js';
import { INVITES_PER_DAY } from '../../src/services/auth/lifecycle-service.js';
import {
  ownerClient,
  platformClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type ErrorBody = { error: { type: string; message: string; details?: Record<string, unknown> } };

const REASON = 'Abuse reported by three workspaces';
const STRONG_PASSWORD = 'a-quite-long-passphrase';

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('the platform Security page (tm 389.16)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let fx: Fixtures;
  const tokens = new Map<PlatformRole, string>();

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
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
  const block = (kind: string, value: string, role: PlatformRole = 'superadmin') =>
    call('POST', '/security/blocklist', { kind, value, reason: REASON }, role);
  const errorOf = (response: LightMyRequestResponse) => (response.json() as ErrorBody).error;
  const added = async (kind: string, value: string) => {
    const response = await block(kind, value);
    expect(response.statusCode, response.body).toBe(201);
    return response.json() as { id: string; kind: string; value: string };
  };

  let signups = 0;
  const signUp = (email = `founder${(signups += 1)}@newco.test`) =>
    tenant.post('/auth/signup', {
      email,
      password: STRONG_PASSWORD,
      name: 'Founder',
      organization_name: `NewCo ${signups}`,
    });

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
    await platform.app.redis.del(OPS_COMPONENTS_KEY);
    tokens.clear();
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  });

  describe('the blocklist', () => {
    it('(a) refuses an address, a domain and its subdomains, and a CIDR at sign-up — and lets them through once lifted', async () => {
      const email = await added('email', 'Spammer@Bad.test');
      await added('domain', 'burner.test');
      expect((await signUp('spammer@bad.test')).statusCode).toBe(403);
      for (const address of ['anyone@burner.test', 'anyone@mail.eu.burner.test']) {
        const response = await signUp(address);
        expect(response.statusCode, address).toBe(403);
        expect(errorOf(response)).toMatchObject({
          type: 'not_allowed',
          details: { reason: 'signup_blocked' },
        });
      }
      // A different domain that merely ends the same way is not a subdomain.
      expect((await signUp('someone@notburner.test')).statusCode).toBe(201);

      // `inject` comes from 127.0.0.1; typed with host bits, stored as the network.
      const range = await added('ip', '127.0.0.9/8');
      expect(range.value).toBe('127.0.0.0/8');
      const fromNetwork = await signUp('other@good.test');
      expect(fromNetwork.statusCode).toBe(403);
      expect(errorOf(fromNetwork).details?.['reason']).toBe('signup_blocked');

      // Lifting is immediate: nothing between the write and the gate is cached.
      for (const entry of [email, range]) {
        const lifted = await call('DELETE', `/security/blocklist/${entry.id}`, { reason: REASON });
        expect(lifted.statusCode, lifted.body).toBe(204);
      }
      expect((await signUp('spammer@bad.test')).statusCode).toBe(201);
      expect((await signUp('other@good.test')).statusCode).toBe(201);
      expect((await signUp('anyone@mail.burner.test')).statusCode).toBe(403);
    });

    it('(b) stores what the sign-up gate compares — normalised — and refuses what is not a value of its kind', async () => {
      expect((await added('email', '  Person@Example.COM ')).value).toBe('person@example.com');
      expect((await added('domain', '*.Burner.TEST.')).value).toBe('burner.test');
      expect((await added('domain', '@other.test')).value).toBe('other.test');
      expect((await added('ip', '203.0.113.7')).value).toBe('203.0.113.7');
      expect((await added('ip', '2001:DB8:0:0::1/64')).value).toBe('2001:db8::/64');

      const invalid: Array<[string, string]> = [
        ['email', 'not-an-address'],
        ['email', 'a@b@c'],
        ['domain', 'nodot'],
        ['domain', 'bad_char.test'],
        ['ip', '999.1.1.1'],
        ['ip', '10.0.0.0/33'],
        ['ip', '10.0.0.0/8/9'],
        ['ip', 'example.com'],
      ];
      for (const [kind, value] of invalid) {
        const response = await block(kind, value);
        expect(response.statusCode, `${kind} ${value}`).toBe(400);
        expect(errorOf(response)).toMatchObject({
          type: 'validation',
          details: { reason: 'invalid_value', kind },
        });
      }
      expect((await block('hostname', 'x.test')).statusCode).toBe(400);

      // The same range twice — also under another spelling of it — is one entry.
      const again = await block('ip', '2001:db8:0:0:0:0:0:1/64');
      expect(again.statusCode).toBe(400);
      expect(errorOf(again).details).toMatchObject({ reason: 'already_listed' });
      expect((await block('email', 'PERSON@example.com')).statusCode).toBe(400);
      expect(await owner.platformBlocklist.count()).toBe(5);
    });

    it('(c) lets support and read-only operators read it and nobody but a superadmin write it', async () => {
      const entry = await added('domain', 'burner.test');
      for (const role of ['support', 'readonly'] as const) {
        const list = await call('GET', '/security/blocklist', undefined, role);
        expect(list.statusCode, role).toBe(200);
        expect((list.json() as { data: unknown[] }).data).toHaveLength(1);
        expect((await block('domain', 'second.test', role)).statusCode, role).toBe(403);
        const lift = await call(
          'DELETE',
          `/security/blocklist/${entry.id}`,
          { reason: REASON },
          role,
        );
        expect(lift.statusCode, role).toBe(403);
      }
      // Billing has no business on this page, not even to read.
      expect((await call('GET', '/security/blocklist', undefined, 'billing')).statusCode).toBe(403);
      expect(await owner.platformBlocklist.count()).toBe(1);
    });

    it('(d) asks for a reason, keeps it on the entry and records each change once — an address masked', async () => {
      const bare = await call('POST', '/security/blocklist', { kind: 'domain', value: 'x.test' });
      expect(bare.statusCode).toBe(400);
      expect(errorOf(bare).type).toBe('platform_reason_required');

      const entry = await added('email', 'Spammer@Bad.test');
      await added('ip', '198.51.100.0/24');
      const row = await owner.platformBlocklist.findUniqueOrThrow({ where: { id: entry.id } });
      expect(row).toMatchObject({ kind: 'email', value: 'spammer@bad.test', reason: REASON });
      expect(row.createdBy).not.toBeNull();

      const withoutReason = await call('DELETE', `/security/blocklist/${entry.id}`, {});
      expect(withoutReason.statusCode).toBe(400);
      expect(await owner.platformBlocklist.count()).toBe(2);
      expect(
        (
          await call('DELETE', `/security/blocklist/${entry.id}`, {
            reason: 'Lifted: mailbox belongs to a customer',
          })
        ).statusCode,
      ).toBe(204);
      const gone = await call('DELETE', `/security/blocklist/${entry.id}`, { reason: REASON });
      expect(gone.statusCode).toBe(404);
      expect(
        (await call('DELETE', '/security/blocklist/not-a-uuid', { reason: REASON })).statusCode,
      ).toBe(404);

      const entries = await owner.platformAuditLog.findMany({
        where: { action: { in: ['security.blocklist_added', 'security.blocklist_removed'] } },
        orderBy: { chainSeq: 'asc' },
      });
      expect(entries.map((e) => e.action)).toEqual([
        'security.blocklist_added',
        'security.blocklist_added',
        'security.blocklist_removed',
      ]);
      expect(entries[0]).toMatchObject({
        targetType: 'blocklist',
        targetId: entry.id,
        reason: REASON,
        payload: { kind: 'email', value: 's***@bad.test' },
      });
      expect(entries[1]?.payload).toMatchObject({ kind: 'ip', value: '198.51.100.0/24' });
      expect(entries[2]).toMatchObject({
        targetId: entry.id,
        reason: 'Lifted: mailbox belongs to a customer',
        payload: { kind: 'email', value: 's***@bad.test' },
      });
      // The full address is nowhere in the chain.
      expect(
        JSON.stringify(entries, (_key, value) =>
          typeof value === 'bigint' ? String(value) : value,
        ),
      ).not.toContain('spammer@bad.test');
    });

    it('(e) lists newest first, filters by kind and text, and pages by keyset', async () => {
      const ids: string[] = [];
      for (const [kind, value] of [
        ['domain', 'one.test'],
        ['email', 'two@x.test'],
        ['ip', '10.1.0.0/16'],
        ['domain', 'four.test'],
      ] as const) {
        ids.push((await added(kind, value)).id);
        clock.now += 5;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const all = (await call('GET', '/security/blocklist')).json() as {
        data: Array<{ id: string; created_by_email: string | null }>;
        next_cursor: string | null;
      };
      expect(all.data.map((e) => e.id)).toEqual([...ids].reverse());
      expect(all.next_cursor).toBeNull();
      expect(all.data[0]?.created_by_email).toMatch(/@/);

      const first = (await call('GET', '/security/blocklist?limit=3')).json() as typeof all;
      expect(first.data).toHaveLength(3);
      expect(first.next_cursor).toEqual(expect.any(String));
      const second = (
        await call('GET', `/security/blocklist?limit=3&cursor=${first.next_cursor}`)
      ).json() as typeof all;
      expect([...first.data, ...second.data].map((e) => e.id)).toEqual([...ids].reverse());
      expect(second.next_cursor).toBeNull();

      const domains = (await call('GET', '/security/blocklist?kind=domain')).json() as typeof all;
      expect(domains.data).toHaveLength(2);
      const search = (await call('GET', '/security/blocklist?q=FOUR')).json() as typeof all;
      expect(search.data.map((e) => e.id)).toEqual([ids[3]]);

      const bad = await call('GET', '/security/blocklist?cursor=garbage');
      expect(bad.statusCode).toBe(400);
      expect((await call('GET', '/security/blocklist?kind=nope')).statusCode).toBe(400);
    });

    it('(f) is out of the tenant role’s reach: the sign-up gate reads it only through the function', async () => {
      await added('domain', 'burner.test');
      await expect(
        tenant.app.db.$queryRawUnsafe('SELECT * FROM platform_blocklist'),
      ).rejects.toThrow(/permission denied/i);
      const rows = await tenant.app.db.$queryRaw<Array<{ blocked: boolean; matched_kind: string }>>`
        SELECT blocked, matched_kind FROM platform_signup_blocked('a@burner.test', NULL)`;
      expect(rows[0]).toEqual({ blocked: true, matched_kind: 'domain' });
      // The gate's own call names the address by its v4 form, even from a dual-stack socket.
      await added('ip', '203.0.113.0/24');
      expect(
        await tenant.app.publicSettings.signupBlocked('a@good.test', '::ffff:203.0.113.5'),
      ).toBe('ip');
      expect(
        await tenant.app.publicSettings.signupBlocked('a@good.test', '203.0.114.5'),
      ).toBeNull();
    });
  });

  describe('the counters', () => {
    it('(g) shows who is failing now, what the workspaces’ trail holds and what this panel refused', async () => {
      // Live: the pre-authentication budget (`rl:authfail:<ip>`), a sliding 60-second window.
      const redis = platform.app.redis;
      const limit = testEnv().RATE_LIMIT_AUTH_FAILURES_PER_MIN;
      const fill = async (ip: string, n: number) => {
        for (let i = 0; i < n; i += 1) {
          await redis.zadd(`rl:authfail:${ip}`, Date.now(), `${ip}-${i}`);
        }
        await redis.pexpire(`rl:authfail:${ip}`, 60_000);
      };
      await fill('198.51.100.1', 3);
      await fill('198.51.100.2', limit);
      // An entry older than the window does not count.
      await redis.zadd('rl:authfail:198.51.100.3', Date.now() - 120_000, 'old');
      await redis.pexpire('rl:authfail:198.51.100.3', 60_000);

      // Trail: two failed authorisations against workspace A, one against B.
      const wrong = (workspace: Fixtures['a']) =>
        tenant.post('/auth/authorize', {
          client_id: workspace.clientId,
          redirect_uri: workspace.redirectUri,
          code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
          email: workspace.ownerEmail,
          password: 'wrong-password',
          license_id: workspace.licenseId.toString(),
        });
      for (const response of [await wrong(fx.a), await wrong(fx.a), await wrong(fx.b)]) {
        expect(response.statusCode).toBe(401);
      }

      // Operator: a wrong password twice.
      for (let i = 0; i < 2; i += 1) {
        const refused = await platform.app.inject({
          method: 'POST',
          url: `${PLATFORM_PREFIX}/auth/login`,
          payload: { email: 'nobody@platform.test', password: 'wrong-password' },
        });
        expect(refused.statusCode).toBe(401);
      }

      const response = await call('GET', '/security/failed-logins', undefined, 'readonly');
      expect(response.statusCode, response.body).toBe(200);
      const body = response.json() as {
        hours: number;
        tenant: {
          live: {
            status: string;
            window_seconds: number;
            limit: number;
            addresses_total: number;
            locked_total: number;
            addresses: Array<{ ip: string; failures: number; locked: boolean }>;
          };
          history: {
            total: number;
            by_ip: Array<{ key: string; count: number }>;
            by_workspace: Array<{ key: string; count: number }>;
          };
        };
        operator: { sign_in_failed: number; totp_failed: number; by_ip: Array<{ key: string }> };
      };
      expect(body.hours).toBe(24);
      expect(body.tenant.live).toMatchObject({
        status: 'available',
        window_seconds: 60,
        limit,
        addresses_total: 2,
        locked_total: 1,
      });
      expect(body.tenant.live.addresses).toEqual([
        { ip: '198.51.100.2', failures: limit, locked: true },
        { ip: '198.51.100.1', failures: 3, locked: false },
      ]);
      expect(body.tenant.history.total).toBe(3);
      expect(body.tenant.history.by_workspace).toEqual([
        { key: fx.a.licenseId.toString(), count: 2 },
        { key: fx.b.licenseId.toString(), count: 1 },
      ]);
      expect(body.tenant.history.by_ip.reduce((sum, row) => sum + row.count, 0)).toBe(3);
      expect(body.operator.sign_in_failed).toBe(2);
      expect(body.operator.totp_failed).toBe(0);
      expect(body.operator.by_ip.length).toBeGreaterThan(0);

      // Older than the span asked for: out.
      await owner.$executeRawUnsafe(
        `UPDATE audit_log SET created_at = now() - interval '3 hours' WHERE action = 'auth.login_failed'`,
      );
      const narrow = (await call('GET', '/security/failed-logins?hours=1')).json() as typeof body;
      expect(narrow.tenant.history.total).toBe(0);
      const wide = (await call('GET', '/security/failed-logins?hours=6')).json() as typeof body;
      expect(wide.tenant.history.total).toBe(3);

      for (const hours of ['0', '169', 'x']) {
        expect((await call('GET', `/security/failed-logins?hours=${hours}`)).statusCode).toBe(400);
      }
      expect((await call('GET', '/security/failed-logins', undefined, 'billing')).statusCode).toBe(
        403,
      );
    });

    it('(h) says sign-ups by address are not available, and no column was added to make them so', async () => {
      const response = await call('GET', '/security/signups-by-ip?days=30');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ status: 'not_available', days: 30, data: [] });
      expect((await call('GET', '/security/signups-by-ip?days=0')).statusCode).toBe(400);
      expect((await call('GET', '/security/signups-by-ip?days=91')).statusCode).toBe(400);

      const columns = await owner.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name IN ('licenses', 'accounts', 'organizations') AND column_name LIKE '%ip%'`;
      expect(
        columns.map((c) => c.column_name).filter((c) => /created_from|signup/.test(c)),
      ).toEqual([]);
    });

    it('(i) lists impersonation sessions behind the Security gate, the way the support list does', async () => {
      const started = await call(
        'POST',
        '/support/impersonations',
        {
          license_id: fx.a.licenseId.toString(),
          account_id: fx.a.agentAccountId,
          reason: REASON,
        },
        'support',
      );
      expect(started.statusCode, started.body).toBe(201);

      const security = await call('GET', '/security/impersonations', undefined, 'readonly');
      expect(security.statusCode, security.body).toBe(200);
      const support = await call('GET', '/support/impersonations', undefined, 'readonly');
      expect(security.json()).toEqual(support.json());
      const { data } = security.json() as { data: Array<Record<string, unknown>> };
      expect(data).toHaveLength(1);
      expect(data[0]).toMatchObject({ license_id: fx.a.licenseId.toString(), mode: 'read_only' });

      expect((await call('GET', '/security/impersonations?active=true')).statusCode).toBe(200);
      expect((await call('GET', '/security/impersonations?cursor=garbage')).statusCode).toBe(400);
      expect((await call('GET', '/security/impersonations', undefined, 'billing')).statusCode).toBe(
        403,
      );
    });

    it('(j) counts workspaces at their invitation allowance and members at their AI allowance — and says when a source is not there', async () => {
      const quiet = (await call('GET', '/security/abuse-counters')).json() as Record<string, any>;
      expect(quiet['invites']).toMatchObject({ status: 'available', workspaces_at_limit: 0 });
      expect(quiet['widget_quota']).toMatchObject({ status: 'available', members_at_cap: 0 });

      // Workspace A sent its whole allowance today; B one short of it.
      const invited = (licenseId: bigint, n: number) =>
        owner.auditLogEntry.createMany({
          data: Array.from({ length: n }, () => ({
            licenseId,
            action: 'member.invited',
            actorType: 'agent',
          })),
        });
      await invited(fx.a.licenseId, INVITES_PER_DAY);
      await invited(fx.b.licenseId, INVITES_PER_DAY - 1);

      // A's allowance is three turns; one member used all three, one used two. B keeps the default 40.
      const brand = await owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Main', slug: 'main', isDefault: true },
      });
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, brandId: brand.id, aiTurnsPerCustomerDay: 3 },
      });
      const second = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Second member' },
      });
      const day = new Date(clock.now).toISOString().slice(0, 10);
      await owner.$executeRaw`
        INSERT INTO ai_customer_daily_usage (license_id, customer_id, day, ai_turns)
        VALUES (${fx.a.licenseId}, ${fx.a.customerId}::uuid, ${day}::date, 3),
               (${fx.a.licenseId}, ${second.id}::uuid, ${day}::date, 2),
               (${fx.b.licenseId}, ${fx.b.customerId}::uuid, ${day}::date, 39)`;

      await reportComponentStatus(platform.app.redis, 'captcha', {
        state: 'ok',
        detail: 'mock provider',
      });

      const response = await call('GET', '/security/abuse-counters', undefined, 'readonly');
      expect(response.statusCode, response.body).toBe(200);
      const counters = response.json() as Record<string, any>;
      expect(counters['invites']).toEqual({
        status: 'available',
        limit_per_day: INVITES_PER_DAY,
        workspaces_at_limit: 1,
        workspaces: [{ key: fx.a.licenseId.toString(), count: INVITES_PER_DAY }],
      });
      expect(counters['widget_quota']).toEqual({
        status: 'available',
        day,
        members_at_cap: 1,
        workspaces_affected: 1,
        workspaces: [{ key: fx.a.licenseId.toString(), count: 1 }],
      });
      expect(counters['widget_challenge']).toMatchObject({
        status: 'not_available',
        component: { key: 'captcha', state: 'ok', detail: 'mock provider' },
      });

      // A source that is not part of this database is not a zero.
      await owner.$executeRawUnsafe('ALTER TABLE ai_customer_daily_usage RENAME TO aicdu_away');
      try {
        const missing = (await call('GET', '/security/abuse-counters')).json() as Record<
          string,
          any
        >;
        expect(missing['widget_quota']).toMatchObject({
          status: 'not_installed',
          members_at_cap: 0,
          workspaces: [],
        });
        expect(missing['invites'].status).toBe('available');
      } finally {
        await owner.$executeRawUnsafe('ALTER TABLE aicdu_away RENAME TO ai_customer_daily_usage');
      }
      expect((await call('GET', '/security/abuse-counters', undefined, 'billing')).statusCode).toBe(
        403,
      );
    });
  });
});
