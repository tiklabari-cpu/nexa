/**
 * "Enter as the customer" end to end (tm 389.15 · FR-ADMIN-21 ·
 * docs/platform-admin/design.md §G).
 *
 * The session is opened through the platform API and judged from the tenant
 * API — what the operator's browser can then do with the code, and with the
 * token it trades it for — and from both audit trails: the platform chain with
 * the reason, the workspace's own trail without it, and every write made in the
 * member's name recorded as the operator's (`actor_type: platform`,
 * `on_behalf_of`).
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_SCOPES, type PlatformRole } from '@siyahtus/types';
import { hashToken } from '../../src/lib/crypto.js';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  bearer,
  createOperator,
  MINUTE,
  openActiveSession,
  TestClock,
  type TestOperator,
} from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type ErrorBody = { error: { type: string; message: string; details?: Record<string, unknown> } };

interface Started {
  impersonation: {
    id: string;
    license_id: string;
    account_id: string;
    account_email: string | null;
    admin_id: string;
    mode: string;
    started_at: string;
    ends_at: string;
    ended_at: string | null;
    end_reason: string | null;
    active: boolean;
    organization_name: string | null;
  };
  handoff_url: string;
  handoff_expires_at: string;
  mail: string;
}

interface Grant {
  access_token: string;
  token_type: string;
  expires_in: number;
  account_id: string;
  license_id: string;
  impersonation: { session_id: string; mode: string; ends_at: string };
}

const REASON = 'Customer reports the inbox shows no chats';

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('platform impersonation (tm 389.15)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let mailer: MemoryMailer;
  let fx: Fixtures;
  const operators = new Map<PlatformRole, TestOperator>();
  const tokens = new Map<PlatformRole, string>();

  const call = (
    method: 'POST' | 'GET',
    path: string,
    body?: unknown,
    role: PlatformRole = 'superadmin',
  ): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method,
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(tokens.get(role)!),
      ...(body === undefined ? {} : { payload: body as object }),
    });

  const start = (
    body: { account_id?: string; license_id?: string; mode?: string; reason?: string },
    role: PlatformRole = 'support',
  ) =>
    call(
      'POST',
      '/support/impersonations',
      {
        license_id: fx.a.licenseId.toString(),
        account_id: fx.a.agentAccountId,
        reason: REASON,
        ...body,
      },
      role,
    );

  async function started(
    body: Parameters<typeof start>[0] = {},
    role: PlatformRole = 'support',
  ): Promise<Started & { code: string }> {
    const response = await start(body, role);
    expect(response.statusCode, response.body).toBe(201);
    const json = response.json() as Started;
    const code = decodeURIComponent(new URL(json.handoff_url).hash.replace(/^#code=/, ''));
    return { ...json, code };
  }

  const exchange = (code: unknown) =>
    tenant.post('/auth/impersonation/exchange', code === undefined ? {} : { code });

  async function enter(
    body: Parameters<typeof start>[0] = {},
    role: PlatformRole = 'support',
  ): Promise<{ session: Started; grant: Grant }> {
    const session = await started(body, role);
    const response = await exchange(session.code);
    expect(response.statusCode, response.body).toBe(200);
    return { session, grant: response.json() as Grant };
  }

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  const refused = async (
    response: Promise<LightMyRequestResponse>,
    status: number,
    type: string,
  ): Promise<ErrorBody> => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(status);
    const body = settled.json() as ErrorBody;
    expect(body.error.type).toBe(type);
    return body;
  };

  /** A chat in workspace A, started by its owner — something to try to write to. */
  async function chatInA(): Promise<string> {
    const ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ADMIN_SCOPES,
    });
    const response = await tenant.post(
      '/chats',
      { customer_id: fx.a.customerId, initial_event: { type: 'message', text: 'Hello' } },
      auth(ownerToken),
    );
    expect([200, 201], response.body).toContain(response.statusCode);
    return (response.json() as { id: string }).id;
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    mailer = new MemoryMailer();
    platform = await buildPlatformTestServer(
      { RATE_LIMIT_PLATFORM_PER_MIN: '100000' },
      { now: clock.read, mailer },
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
    mailer.clear();
    tokens.clear();
    operators.clear();
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      operators.set(role, operator);
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  });

  describe('starting a session', () => {
    it('opens a read-only session for a support operator: a one-time link, both trails, the Founder told', async () => {
      const session = await started();
      const { impersonation } = session;
      expect(impersonation).toMatchObject({
        license_id: fx.a.licenseId.toString(),
        account_id: fx.a.agentAccountId,
        account_email: fx.a.agentEmail,
        admin_id: operators.get('support')!.id,
        mode: 'read_only',
        ended_at: null,
        end_reason: null,
        active: true,
      });
      // 30 minutes by default, the code good for 60 seconds — both from one clock.
      const startedAt = Date.parse(impersonation.started_at);
      expect(Date.parse(impersonation.ends_at) - startedAt).toBe(30 * MINUTE);
      expect(Date.parse(session.handoff_expires_at) - startedAt).toBe(60_000);
      expect(session.handoff_url.startsWith('http://localhost:5173/auth/impersonate#code=')).toBe(
        true,
      );

      // Only the digest is kept.
      const row = await owner.platformImpersonationSession.findUniqueOrThrow({
        where: { id: impersonation.id },
      });
      expect(row.handoffCodeHash).toBe(hashToken(session.code));
      expect(Object.values(row).map(String)).not.toContain(session.code);

      // The platform chain carries the reason; the workspace's trail does not.
      const platformRows = await owner.platformAuditLog.findMany({
        where: { action: 'impersonation.started' },
      });
      expect(platformRows).toHaveLength(1);
      expect(platformRows[0]).toMatchObject({
        adminId: operators.get('support')!.id,
        targetType: 'impersonation',
        targetId: impersonation.id,
        licenseId: fx.a.licenseId,
        reason: REASON,
      });
      expect(JSON.stringify(platformRows[0]!.payload)).not.toContain(session.code);
      const tenantRows = await owner.auditLogEntry.findMany({
        where: { action: 'platform.impersonation_started' },
      });
      expect(tenantRows).toHaveLength(1);
      expect(tenantRows[0]).toMatchObject({
        licenseId: fx.a.licenseId,
        actorType: 'platform',
        actorId: operators.get('support')!.id,
        target: `impersonation:${impersonation.id}`,
      });
      expect(JSON.stringify(tenantRows[0]!.metadata)).not.toContain(REASON);

      // The Founder hears who was entered as, how and until when — never why.
      expect(session.mail).toBe('sent');
      const notices = mailer.sent.filter((m) => m.kind === 'impersonation_notice');
      expect(notices.map((m) => m.to)).toEqual([fx.a.ownerEmail]);
      expect(notices[0]!.body).toContain(fx.a.agentEmail);
      expect(notices[0]!.body).toMatch(/read-only/i);
      expect(notices[0]!.body).not.toContain(REASON);
      expect(notices[0]!.body).not.toContain(session.code);
      expect(notices[0]!.licenseId).toBe(fx.a.licenseId);
    });

    it('opens a full session only for a superadmin with a fresh code', async () => {
      await refused(start({ mode: 'full' }, 'support'), 403, 'authorization');
      clock.advance(6 * MINUTE);
      await refused(start({ mode: 'full' }, 'superadmin'), 403, 'platform_recent_totp_required');
      // A new session at the moved clock has a fresh code again.
      tokens.set('superadmin', await openActiveSession(db, operators.get('superadmin')!, clock));
      const session = await started({ mode: 'full' }, 'superadmin');
      expect(session.impersonation.mode).toBe('full');
    });

    it('refuses what the tenant API would refuse to serve, and gates the route', async () => {
      await refused(start({ license_id: '999999' }), 404, 'not_found');
      await refused(start({ account_id: fx.b.agentAccountId }), 404, 'not_found');
      await refused(start({ account_id: 'not-a-uuid' }), 400, 'validation');
      await refused(start({ mode: 'everything' }), 400, 'validation');

      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        data: { suspended: true },
      });
      await refused(start({}), 404, 'not_found');
      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        data: { suspended: false },
      });

      await owner.account.update({
        where: { id: fx.a.agentAccountId },
        data: { platformSuspendedAt: new Date() },
      });
      const suspendedPerson = await refused(start({}), 409, 'platform_account_state');
      expect(suspendedPerson.error.details?.['reason']).toBe('account_suspended');
      await owner.account.update({
        where: { id: fx.a.agentAccountId },
        data: { platformSuspendedAt: null },
      });

      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'suspended', suspendedAt: new Date() },
      });
      const closed = await refused(start({}), 409, 'platform_workspace_state');
      expect(closed.error.details?.['reason']).toBe('workspace_closed');

      await refused(start({}, 'readonly'), 403, 'authorization');
      await refused(start({}, 'billing'), 403, 'authorization');
      await refused(start({ reason: '' }), 400, 'platform_reason_required');
      expect(await owner.platformImpersonationSession.count()).toBe(0);
      expect(mailer.sent).toHaveLength(0);
    });
  });

  describe('trading the code', () => {
    it('trades a code once, for the member’s token bounded by the session', async () => {
      const session = await started();
      const first = await exchange(session.code);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.headers['cache-control']).toBe('no-store');
      const grant = first.json() as Grant;
      expect(grant).toMatchObject({
        token_type: 'Bearer',
        account_id: fx.a.agentAccountId,
        license_id: fx.a.licenseId.toString(),
        impersonation: {
          session_id: session.impersonation.id,
          mode: 'read_only',
          ends_at: session.impersonation.ends_at,
        },
      });
      expect(grant.expires_in).toBeGreaterThan(29 * 60);
      expect(grant.expires_in).toBeLessThanOrEqual(30 * 60);
      expect(grant).not.toHaveProperty('refresh_token');

      // Spent: the same code again is the same 401 as one never issued.
      await refused(exchange(session.code), 401, 'authentication');
      await refused(exchange('not-a-code'), 401, 'authentication');
      await refused(exchange(undefined), 400, 'validation');

      const token = await owner.apiToken.findFirstOrThrow({
        where: { impersonationSessionId: session.impersonation.id },
      });
      expect(token).toMatchObject({
        kind: 'impersonation',
        ownerId: fx.a.agentAccountId,
        licenseId: fx.a.licenseId,
        tokenHash: hashToken(grant.access_token),
      });
    });

    it('refuses a code past its sixty seconds', async () => {
      const session = await started();
      await owner.$executeRaw`
        UPDATE platform_impersonation_sessions
           SET handoff_expires_at = now() - interval '1 second'
         WHERE id = ${session.impersonation.id}::uuid`;
      await refused(exchange(session.code), 401, 'authentication');
      expect(await owner.apiToken.count({ where: { kind: 'impersonation' } })).toBe(0);
    });

    it('has a bucket of its own, apart from the anonymous one', async () => {
      const responses = [];
      for (let i = 0; i < 31; i += 1) responses.push(await exchange(`guess-${i}`));
      expect(responses.slice(0, 30).every((r) => r.statusCode === 401)).toBe(true);
      expect(responses[30]!.statusCode).toBe(429);
      // Sign-in's anonymous bucket is untouched.
      const login = await tenant.post('/auth/login', {
        email: fx.a.agentEmail,
        password: 'wrong-password',
      });
      expect(login.statusCode).not.toBe(429);
    });
  });

  describe('a read-only session', () => {
    it('reads what the member reads and writes nothing', async () => {
      const chatId = await chatInA();
      const { grant } = await enter();
      const as = auth(grant.access_token);

      const chats = await tenant.get('/chats', as);
      expect(chats.statusCode, chats.body).toBe(200);
      await refused(
        tenant.post(`/chats/${chatId}/events`, { type: 'message', text: 'hi' }, as),
        403,
        'impersonation_read_only',
      );
      await refused(
        tenant.put('/agents/me/routing-status', { routing_status: 'accepting_chats' }, as),
        403,
        'impersonation_read_only',
      );
      // A write the member could not make either is refused as it would be for them.
      await refused(tenant.post('/settings/tags', { name: 'support' }, as), 403, 'authorization');

      // In every mode, a forbidden route says so rather than "read-only".
      const forbidden = await refused(
        tenant.post('/auth/2fa/enroll', undefined, as),
        403,
        'impersonation_forbidden_path',
      );
      expect(forbidden.error.details?.['category']).toBe('two_factor');
    });

    it('describes itself on /auth/me and carries the member’s role — never more', async () => {
      const { grant, session } = await enter();
      const as = auth(grant.access_token);
      const me = await tenant.get('/auth/me', { ...as, 'x-siyahtus-locale': 'tr' });
      expect(me.statusCode, me.body).toBe(200);
      expect(me.json()).toMatchObject({
        kind: 'agent',
        account_id: fx.a.agentAccountId,
        role: 'agent',
        impersonation: {
          session_id: session.impersonation.id,
          mode: 'read_only',
          ends_at: session.impersonation.ends_at,
        },
      });
      // The member is an agent: the admin screens stay shut.
      await refused(tenant.get('/settings/company', as), 403, 'authorization');

      // Neither the member's language nor their "last seen" moves for the operator.
      const membership = await owner.agentMembership.findUniqueOrThrow({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        select: { locale: true },
      });
      expect(membership.locale).not.toBe('tr');
      const account = await owner.account.findUniqueOrThrow({
        where: { id: fx.a.agentAccountId },
        select: { lastSeenAt: true },
      });
      expect(account.lastSeenAt).toBeNull();
    });

    it('lets the session leave: signing out works read-only', async () => {
      const { grant } = await enter();
      const revoked = await tenant.post('/auth/revoke', { token: grant.access_token });
      expect(revoked.statusCode).toBe(200);
      await refused(tenant.get('/chats', auth(grant.access_token)), 401, 'authentication');
    });
  });

  describe('a full session', () => {
    it('acts as the member, records the operator, and keeps the forbidden paths shut', async () => {
      const chatId = await chatInA();
      const tokensBefore = await owner.apiToken.count({
        where: { kind: 'pat', ownerId: fx.a.ownerAccountId },
      });
      const { grant } = await enter(
        { mode: 'full', account_id: fx.a.ownerAccountId },
        'superadmin',
      );
      const as = auth(grant.access_token);

      const sent = await tenant.post(
        `/chats/${chatId}/events`,
        { type: 'message', text: 'Support here — looking into it.' },
        as,
      );
      expect([200, 201], sent.body).toContain(sent.statusCode);

      const changed = await tenant.patch('/settings/company', { name: 'Renamed by support' }, as);
      expect(changed.statusCode, changed.body).toBe(200);
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { action: 'settings.company_updated' },
      });
      expect(entry).toMatchObject({
        licenseId: fx.a.licenseId,
        actorType: 'platform',
        actorId: operators.get('superadmin')!.id,
        onBehalfOf: fx.a.ownerAccountId,
      });

      const tag = await tenant.post('/settings/tags', { name: 'from-support' }, as);
      expect([200, 201]).toContain(tag.statusCode);

      const cases: Array<[Promise<LightMyRequestResponse>, string]> = [
        [tenant.post('/auth/2fa/enroll', undefined, as), 'two_factor'],
        [tenant.post('/auth/personal-access-tokens', { name: 'x', scopes: [] }, as), 'credentials'],
        [tenant.patch('/settings/security', { require_two_factor: true }, as), 'security'],
        [tenant.post(`/customers/${fx.a.customerId}/erase`, {}, as), 'data_deletion'],
        [tenant.patch('/billing/subscription', { plan: 'enterprise' }, as), 'subscription'],
        [tenant.post('/settings/sandbox/reset', {}, as), 'sandbox'],
        [
          tenant.post('/invitations', { email: 'new@example.test', role: 'admin' }, as),
          'membership',
        ],
      ];
      for (const [response, category] of cases) {
        const body = await refused(response, 403, 'impersonation_forbidden_path');
        expect(body.error.details?.['category']).toBe(category);
      }
      // Nothing behind those doors moved.
      expect(
        await owner.apiToken.count({ where: { kind: 'pat', ownerId: fx.a.ownerAccountId } }),
      ).toBe(tokensBefore);
    });
  });

  describe('ending a session', () => {
    it('ends with its window', async () => {
      const { grant, session } = await enter();
      await owner.$executeRaw`
        UPDATE platform_impersonation_sessions
           SET started_at = now() - interval '1 hour', ends_at = now() - interval '1 second'
         WHERE id = ${session.impersonation.id}::uuid`;
      await refused(tenant.get('/chats', auth(grant.access_token)), 401, 'authentication');
    });

    it('ends from the root panel: the token dies, both trails record it, a second end changes nothing', async () => {
      const { grant, session } = await enter();
      const ended = await call(
        'POST',
        `/support/impersonations/${session.impersonation.id}/end`,
        { reason: REASON },
        'support',
      );
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ended.json()).toMatchObject({
        unchanged: false,
        impersonation: { active: false, end_reason: 'ended_by_operator' },
      });
      await refused(tenant.get('/chats', auth(grant.access_token)), 401, 'authentication');

      const again = await call(
        'POST',
        `/support/impersonations/${session.impersonation.id}/end`,
        { reason: REASON },
        'support',
      );
      expect(again.json()).toMatchObject({ unchanged: true });
      expect(await owner.platformAuditLog.count({ where: { action: 'impersonation.ended' } })).toBe(
        1,
      );
      expect(
        await owner.auditLogEntry.count({ where: { action: 'platform.impersonation_ended' } }),
      ).toBe(1);

      await refused(
        call(
          'POST',
          `/support/impersonations/${session.impersonation.id}/end`,
          { reason: REASON },
          'readonly',
        ),
        403,
        'authorization',
      );
      await refused(
        call('POST', '/support/impersonations/not-a-uuid/end', { reason: REASON }, 'support'),
        404,
        'not_found',
      );
    });

    it('ends from the console’s banner, as the operator, even read-only', async () => {
      const { grant, session } = await enter();
      const as = auth(grant.access_token);
      const ended = await tenant.post('/auth/impersonation/end', undefined, as);
      expect(ended.statusCode, ended.body).toBe(200);
      expect(ended.json()).toEqual({ ended: true });
      await refused(tenant.get('/chats', as), 401, 'authentication');

      const row = await owner.platformImpersonationSession.findUniqueOrThrow({
        where: { id: session.impersonation.id },
      });
      expect(row.endReason).toBe('ended_in_workspace');
      expect(row.endedAt).not.toBeNull();
      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { action: 'platform.impersonation_ended' },
      });
      expect(entry).toMatchObject({
        actorType: 'platform',
        actorId: operators.get('support')!.id,
        onBehalfOf: fx.a.agentAccountId,
        target: `impersonation:${session.impersonation.id}`,
      });

      // The member's own session has no impersonation to end.
      const memberToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--access:rw'],
      });
      await refused(
        tenant.post('/auth/impersonation/end', undefined, auth(memberToken)),
        404,
        'not_found',
      );
    });

    it('dies with the person: a suspension in the root panel ends what the token can do', async () => {
      const { grant } = await enter();
      await owner.account.update({
        where: { id: fx.a.agentAccountId },
        data: { platformSuspendedAt: new Date() },
      });
      await refused(tenant.get('/chats', auth(grant.access_token)), 401, 'authentication');
    });
  });

  describe('reading sessions', () => {
    it('lists them newest first, open ones on their own, and reads one', async () => {
      const first = await started();
      const second = await started({ account_id: fx.a.ownerAccountId });
      await call(
        'POST',
        `/support/impersonations/${first.impersonation.id}/end`,
        { reason: REASON },
        'support',
      );

      const all = await call('GET', '/support/impersonations', undefined, 'readonly');
      expect(all.statusCode, all.body).toBe(200);
      expect((all.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).toEqual([
        second.impersonation.id,
        first.impersonation.id,
      ]);

      const open = await call('GET', '/support/impersonations?active=true');
      expect((open.json() as { data: Array<{ id: string }> }).data.map((r) => r.id)).toEqual([
        second.impersonation.id,
      ]);
      const elsewhere = await call(
        'GET',
        `/support/impersonations?license_id=${fx.b.licenseId.toString()}`,
      );
      expect((elsewhere.json() as { data: unknown[] }).data).toEqual([]);

      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: LightMyRequestResponse = await call(
          'GET',
          `/support/impersonations?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        const json = page.json() as { data: Array<{ id: string }>; next_cursor: string | null };
        seen.push(...json.data.map((r) => r.id));
        cursor = json.next_cursor;
      } while (cursor);
      expect(seen).toEqual([second.impersonation.id, first.impersonation.id]);
      await refused(call('GET', '/support/impersonations?cursor=nope'), 400, 'validation');

      const one = await call(
        'GET',
        `/support/impersonations/${second.impersonation.id}`,
        undefined,
        'billing',
      );
      expect(one.statusCode).toBe(200);
      expect(one.json()).toMatchObject({
        impersonation: {
          id: second.impersonation.id,
          active: true,
          account_email: fx.a.ownerEmail,
        },
      });
      // Nothing in a listed session is a secret.
      expect(one.body).not.toContain(second.code);
      await refused(call('GET', '/support/impersonations/not-a-uuid'), 404, 'not_found');
      await refused(
        call('GET', '/support/impersonations/00000000-0000-4000-8000-000000000000'),
        404,
        'not_found',
      );
    });

    it('is not a tenant API route', async () => {
      const { grant } = await enter();
      const response = await tenant.app.inject({
        method: 'GET',
        url: '/platform/v1/support/impersonations',
        headers: auth(grant.access_token),
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
