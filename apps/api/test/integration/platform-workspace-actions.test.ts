/**
 * The root panel's workspace actions and the purge job (tm 389.10 ·
 * FR-ADMIN-09 · docs/platform-admin/design.md §C workspaces).
 *
 * Each action is driven through the platform API and judged from three
 * sides: the platform audit chain (the entry, its reason, its payload), the
 * workspace's own trail (the `platform.*` entry, without the reason), and the
 * tenant API — what the workspace's members can now do. Both servers share the
 * run's database, so an action here is observable there at once.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformRole } from '@siyahtus/types';
import type { TenantClient } from '../../src/lib/tenant.js';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import { hashToken } from '../../src/services/auth/lifecycle-service.js';
import { trialState } from '../../src/services/billing/metering.js';
import { PURGE_COOLING_OFF_DAYS } from '../../src/services/platform/workspace-actions.js';
import { WORKSPACE_PURGE_REASON } from '../../src/services/platform/workspace-purge.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import {
  bearer,
  createOperator,
  MINUTE,
  openActiveSession,
  TestClock,
} from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type ErrorBody = { error: { type: string; message: string; details?: Record<string, unknown> } };

const DAY = 86_400_000;
const REASON = 'Customer called the support desk';
const reason = { reason: REASON };
const CHECKLIST = { ticket_id: 'SUP-4711', signed_request: true, phone_verified: true };

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('platform workspace actions (tm 389.10)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let mailer: MemoryMailer;
  let fx: Fixtures;
  const tokens = new Map<PlatformRole, string>();

  const call = (
    method: 'POST' | 'PUT' | 'GET',
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
  const act = (
    t: TenantFixture | bigint,
    action: string,
    body: Record<string, unknown> = {},
    role: PlatformRole = 'superadmin',
  ) =>
    call(
      'POST',
      `/workspaces/${typeof t === 'bigint' ? t : t.licenseId}/${action}`,
      { ...reason, ...body },
      role,
    );
  const ok = async (response: Promise<LightMyRequestResponse>) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(200);
    return settled.json() as {
      unchanged: boolean;
      workspace: { license: Record<string, unknown> };
      mail?: string;
      overrides?: Record<string, unknown>;
    };
  };
  const refused = async (
    response: Promise<LightMyRequestResponse>,
    status: number,
    type: string,
    detailsReason?: string,
  ) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(status);
    const body = settled.json() as ErrorBody;
    expect(body.error.type).toBe(type);
    if (detailsReason !== undefined) expect(body.error.details?.['reason']).toBe(detailsReason);
  };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const memberToken = (t: TenantFixture, scopes: string[] = ['chats--all:ro']) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes,
    });
  const license = (t: TenantFixture) =>
    owner.license.findUniqueOrThrow({ where: { id: t.licenseId } });

  /** Both halves of the double entry for one workspace, oldest first. */
  async function trails(t: TenantFixture | bigint) {
    const licenseId = typeof t === 'bigint' ? t : t.licenseId;
    const [platformRows, tenantRows] = await Promise.all([
      owner.platformAuditLog.findMany({ where: { licenseId }, orderBy: { chainSeq: 'asc' } }),
      owner.auditLogEntry.findMany({
        where: { licenseId, actorType: 'platform' },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { platformRows, tenantRows };
  }

  /** The action wrote one platform entry with its reason, and the workspace's own without it. */
  async function expectDoubleEntry(
    t: TenantFixture,
    action: string,
    payload: Record<string, unknown> = {},
  ) {
    const { platformRows, tenantRows } = await trails(t);
    const entry = platformRows.filter((row) => row.action === action);
    expect(entry, action).toHaveLength(1);
    expect(entry[0]).toMatchObject({
      reason: REASON,
      targetType: 'workspace',
      targetId: t.licenseId.toString(),
    });
    expect(entry[0]!.payload).toMatchObject(payload);
    const mirrored = tenantRows.filter(
      (row) => row.action === `platform.${action.replace('.', '_')}`,
    );
    expect(mirrored, action).toHaveLength(1);
    expect(mirrored[0]!.metadata).toEqual({
      platform_seq: entry[0]!.chainSeq.toString(),
      request_id: expect.any(String),
    });
    expect(
      JSON.stringify(mirrored[0], (_k, v: unknown) => (typeof v === 'bigint' ? String(v) : v)),
    ).not.toContain(REASON);
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    mailer = new MemoryMailer();
    // A suite's worth of actions from one address would spend the per-minute bucket.
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
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  });

  describe('the trial and the licence status', () => {
    it('extends a trial from its end — or from now once it has run out — and refuses a paid licence', async () => {
      const days = async (t: TenantFixture) =>
        trialState(owner as unknown as TenantClient, {
          licenseId: t.licenseId,
          organizationId: t.organizationId,
        });
      const before = await days(fx.a);
      expect(before.daysRemaining).toBe(14);

      const extended = await ok(act(fx.a, 'extend-trial', { days: 10 }, 'support'));
      expect(extended.unchanged).toBe(false);
      expect((await days(fx.a)).daysRemaining).toBe(24);
      await expectDoubleEntry(fx.a, 'workspace.trial_extended', { days: 10 });

      // B's trial ran out yesterday: read-only, and the extension counts from now.
      await owner.license.update({
        where: { id: fx.b.licenseId },
        data: { trialEndsAt: new Date(Date.now() - DAY) },
      });
      expect((await days(fx.b)).access).toBe('read_only');
      await ok(act(fx.b, 'extend-trial', { days: 5 }));
      const b = await days(fx.b);
      expect(b.access).toBe('trialing');
      expect(b.daysRemaining).toBe(5);

      await ok(act(fx.a, 'activate'));
      await refused(
        act(fx.a, 'extend-trial', { days: 3 }),
        409,
        'platform_workspace_state',
        'not_trialing',
      );
      await refused(act(fx.b, 'extend-trial', { days: 0 }), 400, 'validation');
      await refused(act(fx.b, 'extend-trial', { days: 91 }), 400, 'validation');
    });

    it('activates by hand once; asking again is unchanged and records nothing', async () => {
      const first = await ok(act(fx.a, 'activate', {}, 'billing'));
      expect(first.unchanged).toBe(false);
      expect(first.workspace.license).toMatchObject({ status: 'active', trial_ends_at: null });
      await expectDoubleEntry(fx.a, 'workspace.activated', { from: 'trialing' });

      const again = await ok(act(fx.a, 'activate', {}, 'billing'));
      expect(again.unchanged).toBe(true);
      const { platformRows } = await trails(fx.a);
      expect(platformRows.filter((row) => row.action === 'workspace.activated')).toHaveLength(1);
    });

    it('turns writes off and on with read-only / active; a trial is refused set-active', async () => {
      const token = await memberToken(fx.a, ['accounts--all:rw']);
      const invite = (email: string) =>
        tenant.post('/invitations', { emails: [email], role: 'agent' }, auth(token));

      await refused(act(fx.a, 'set-active'), 409, 'platform_workspace_state', 'trialing');

      await ok(act(fx.a, 'set-read-only'));
      expect((await license(fx.a)).status).toBe('read_only');
      const blocked = await invite('one@example.test');
      expect(blocked.statusCode).toBe(402);
      expect((blocked.json() as ErrorBody).error.type).toBe('license_expired');
      // Reads still work.
      expect((await tenant.get('/auth/me', auth(token))).statusCode).toBe(200);

      await ok(act(fx.a, 'set-active'));
      expect(await license(fx.a)).toMatchObject({ status: 'active', trialEndsAt: null });
      expect((await invite('two@example.test')).statusCode).toBe(201);
      await expectDoubleEntry(fx.a, 'workspace.read_only_set', { from: 'trialing' });
      await expectDoubleEntry(fx.a, 'workspace.active_set', { from: 'read_only' });
    });

    it('suspends with a fresh code — every member refused — and lifts it back to the status it interrupted', async () => {
      const token = await memberToken(fx.a);
      expect((await tenant.get('/chats', auth(token))).statusCode).toBe(200);
      const trialEnd = (await license(fx.a)).trialEndsAt;

      const suspended = await ok(act(fx.a, 'suspend'));
      expect(suspended.workspace.license).toMatchObject({
        status: 'suspended',
        suspended_reason: REASON,
      });
      expect(await license(fx.a)).toMatchObject({ suspendedFromStatus: 'trialing' });
      const locked = await tenant.get('/chats', auth(token));
      expect(locked.statusCode).toBe(403);
      expect((locked.json() as ErrorBody).error.details).toEqual({ reason: 'workspace_suspended' });
      expect(locked.body).not.toContain(REASON);
      // B is untouched.
      expect((await tenant.get('/chats', auth(await memberToken(fx.b)))).statusCode).toBe(200);

      expect((await ok(act(fx.a, 'suspend'))).unchanged).toBe(true);
      await refused(
        act(fx.a, 'set-read-only'),
        409,
        'platform_workspace_state',
        'workspace_closed',
      );

      await ok(act(fx.a, 'unsuspend'));
      expect(await license(fx.a)).toMatchObject({
        status: 'trialing',
        trialEndsAt: trialEnd,
        suspendedAt: null,
        suspendedReason: null,
        suspendedFromStatus: null,
      });
      expect((await tenant.get('/chats', auth(token))).statusCode).toBe(200);
      await expectDoubleEntry(fx.a, 'workspace.suspended', { from: 'trialing' });
      await expectDoubleEntry(fx.a, 'workspace.unsuspended', { to: 'trialing' });
    });

    it('wants a code younger than five minutes for the suspension, and a superadmin', async () => {
      await refused(act(fx.a, 'suspend', {}, 'support'), 403, 'authorization');
      await refused(act(fx.a, 'suspend', {}, 'billing'), 403, 'authorization');
      clock.advance(6 * MINUTE);
      await refused(act(fx.a, 'suspend'), 403, 'platform_recent_totp_required');
      await refused(act(fx.a, 'unsuspend'), 403, 'platform_recent_totp_required');
      expect((await license(fx.a)).status).toBe('trialing');
      expect((await trails(fx.a)).platformRows).toHaveLength(0);
    });
  });

  describe('plan, subscription and overrides', () => {
    const entitlementsOf = async (t: TenantFixture) =>
      (
        (await tenant.get('/billing/entitlements', auth(await memberToken(t)))).json() as {
          entitlements: Record<string, boolean>;
        }
      ).entitlements;

    it('moves the plan, which changes what the workspace unlocks; an override still beats it', async () => {
      expect((await entitlementsOf(fx.a))['sso']).toBe(false);
      await ok(act(fx.a, 'set-plan', { plan: 'enterprise' }, 'billing'));
      expect((await entitlementsOf(fx.a))['sso']).toBe(true);
      expect((await entitlementsOf(fx.b))['sso']).toBe(false);
      const subscription = await owner.subscription.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      // Sized to the headcount (owner + agent), still on trial.
      expect(subscription).toMatchObject({ plan: 'enterprise', seats: 2, status: 'trialing' });
      await expectDoubleEntry(fx.a, 'workspace.plan_changed', { from: 'growth', to: 'enterprise' });
      expect((await ok(act(fx.a, 'set-plan', { plan: 'enterprise' }, 'billing'))).unchanged).toBe(
        true,
      );

      await ok(
        call(
          'PUT',
          `/workspaces/${fx.a.licenseId}/overrides`,
          { entitlements: { sso: false }, ...reason },
          'billing',
        ),
      );
      expect(await entitlementsOf(fx.a)).toMatchObject({ sso: false, hipaa: true });
      await refused(act(fx.a, 'set-plan', { plan: 'platinum' }, 'billing'), 400, 'validation');
    });

    it('replaces the seat ceiling as a whole row, reads it back, and removes it when nothing is overridden', async () => {
      const token = await memberToken(fx.a, ['accounts--all:rw']);
      const invite = (email: string) =>
        tenant.post('/invitations', { emails: [email], role: 'agent' }, auth(token));
      const put = (body: Record<string, unknown>, role: PlatformRole = 'billing') =>
        call('PUT', `/workspaces/${fx.a.licenseId}/overrides`, { ...reason, ...body }, role);
      const expiresAt = new Date(Date.now() + 30 * DAY).toISOString();

      const saved = await ok(put({ seat_ceiling: 2, mail_daily_cap: 40, expires_at: expiresAt }));
      expect(saved.overrides).toMatchObject({
        seat_ceiling: 2,
        mail_daily_cap: 40,
        expires_at: expiresAt,
        in_force: true,
        entitlements: {},
      });
      const read = await call(
        'GET',
        `/workspaces/${fx.a.licenseId}/overrides`,
        undefined,
        'readonly',
      );
      expect(read.json().overrides).toEqual(saved.overrides);
      const full = await invite('third@example.test');
      expect(full.statusCode).toBe(429);
      expect((full.json() as ErrorBody).error.type).toBe('users_limit_reached');
      await expectDoubleEntry(fx.a, 'workspace.overrides_changed', {
        changed: ['seat_ceiling', 'mail_daily_cap', 'expires_at'],
      });

      // The same row again is unchanged; omitting a field clears it.
      expect(
        (await ok(put({ seat_ceiling: 2, mail_daily_cap: 40, expires_at: expiresAt }))).unchanged,
      ).toBe(true);
      await ok(put({}));
      expect(await owner.licenseOverride.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      expect((await invite('third@example.test')).statusCode).toBe(201);

      await refused(
        put({ expires_at: new Date(Date.now() - DAY).toISOString(), seat_ceiling: 3 }),
        400,
        'validation',
      );
      await refused(put({ entitlements: { platinum: true } }), 400, 'validation');
      await refused(put({ seat_ceiling: 0 }), 400, 'validation');
      await refused(put({ seat_ceiling: 5 }, 'support'), 403, 'authorization');
    });

    it('cancels the subscription at the end of its period and takes it back', async () => {
      await refused(
        act(fx.a, 'subscription/cancel'),
        409,
        'platform_workspace_state',
        'no_subscription',
      );
      await owner.subscription.create({
        data: { licenseId: fx.a.licenseId, plan: 'growth', status: 'active', seats: 2 },
      });
      await ok(act(fx.a, 'subscription/cancel'));
      expect(
        await owner.subscription.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } }),
      ).toMatchObject({ cancelAtPeriodEnd: true, canceledAt: expect.any(Date) });
      expect((await ok(act(fx.a, 'subscription/cancel'))).unchanged).toBe(true);
      await ok(act(fx.a, 'subscription/resume'));
      expect(
        await owner.subscription.findFirstOrThrow({ where: { licenseId: fx.a.licenseId } }),
      ).toMatchObject({ cancelAtPeriodEnd: false, canceledAt: null });
      await expectDoubleEntry(fx.a, 'workspace.cancelled');
      await expectDoubleEntry(fx.a, 'workspace.resumed');
    });
  });

  describe('the owner and the sandbox', () => {
    it("resends the owner's verification link only while the owner is unverified", async () => {
      const verified = await ok(act(fx.a, 'resend-owner-verification', {}, 'support'));
      expect(verified.unchanged).toBe(true);
      expect(mailer.sent).toHaveLength(0);

      await owner.account.update({
        where: { id: fx.a.ownerAccountId },
        data: { emailVerifiedAt: null },
      });
      const sent = await ok(act(fx.a, 'resend-owner-verification', {}, 'support'));
      expect(sent).toMatchObject({ unchanged: false, mail: 'sent' });
      const mail = mailer.sent.find((m) => m.kind === 'email_verification')!;
      expect(mail.to).toBe(fx.a.ownerEmail);
      const token = new URL(
        /https?:\/\/\S+\/verify-email\?token=\S+/.exec(mail.body)![0],
      ).searchParams.get('token')!;
      const link = await owner.emailVerificationToken.findFirst({
        where: { accountId: fx.a.ownerAccountId, usedAt: null },
      });
      expect(link?.tokenHash).toBe(hashToken(token));
      await expectDoubleEntry(fx.a, 'workspace.owner_verification_resent', {
        account_id: fx.a.ownerAccountId,
      });
    });

    it("empties the workspace's sandbox, and refuses a workspace without one", async () => {
      await refused(
        act(fx.a, 'sandbox/reset', {}, 'support'),
        409,
        'platform_workspace_state',
        'no_sandbox',
      );
      const [created] = await owner.$queryRaw<Array<{ created_license: bigint }>>`
        SELECT created_license FROM sandbox_create(${fx.a.licenseId}, ${fx.a.ownerAccountId}::uuid)`;
      const sandboxId = created!.created_license;
      await owner.license.update({
        where: { id: sandboxId },
        data: { onboardingCompletedAt: new Date() },
      });

      const reset = await ok(act(fx.a, 'sandbox/reset', {}, 'support'));
      expect(reset.unchanged).toBe(false);
      const sandbox = await owner.license.findUniqueOrThrow({ where: { id: sandboxId } });
      expect(sandbox.sandboxResetAt).not.toBeNull();
      expect(sandbox.onboardingCompletedAt).toBeNull();
      await expectDoubleEntry(fx.a, 'workspace.sandbox_reset', {
        sandbox_license_id: sandboxId.toString(),
      });
    });
  });

  describe('the forced ownership transfer', () => {
    const transfer = (
      to: string,
      body: Record<string, unknown> = {},
      role: PlatformRole = 'superadmin',
    ) =>
      act(
        fx.a,
        'force-ownership-transfer',
        { to_account_id: to, verification_checklist: CHECKLIST, ...body },
        role,
      );

    it('makes the member the owner and the owner an admin — one owner throughout — and tells them and every admin', async () => {
      const admin = await owner.account.create({
        data: { email: 'admin-a@example.test', name: 'Admin A' },
      });
      await owner.agentMembership.create({
        data: { licenseId: fx.a.licenseId, agentId: admin.id, role: 'admin', locale: 'tr' },
      });

      const moved = await ok(transfer(fx.a.agentAccountId));
      expect(moved).toMatchObject({ unchanged: false, mail: 'sent' });
      const roles = await owner.agentMembership.findMany({
        where: { licenseId: fx.a.licenseId },
        select: { agentId: true, role: true },
      });
      expect(roles.filter((m) => m.role === 'owner')).toEqual([
        { agentId: fx.a.agentAccountId, role: 'owner' },
      ]);
      expect(roles.find((m) => m.agentId === fx.a.ownerAccountId)?.role).toBe('admin');
      // B's memberships are not touched.
      expect(
        (
          await owner.agentMembership.findMany({
            where: { licenseId: fx.b.licenseId, role: 'owner' },
          })
        ).map((m) => m.agentId),
      ).toEqual([fx.b.ownerAccountId]);

      const recipients = mailer.sent
        .filter((m) => m.kind === 'ownership_transferred')
        .map((m) => m.to)
        .sort();
      expect(recipients).toEqual([fx.a.agentEmail, fx.a.ownerEmail, admin.email].sort());
      const adminMail = mailer.sent.find((m) => m.to === admin.email)!;
      expect(adminMail.subject).toContain('devredildi');

      await expectDoubleEntry(fx.a, 'workspace.ownership_transferred', {
        from_account_id: fx.a.ownerAccountId,
        to_account_id: fx.a.agentAccountId,
        previous_role: 'agent',
        verification_checklist: CHECKLIST,
      });
      expect((await ok(transfer(fx.a.agentAccountId))).unchanged).toBe(true);
    });

    it('refuses an incomplete checklist, a stranger, a suspended member and anyone but a superadmin with a fresh code', async () => {
      const unchangedOwners = async () =>
        expect(
          (
            await owner.agentMembership.findMany({
              where: { licenseId: fx.a.licenseId, role: 'owner' },
            })
          ).map((m) => m.agentId),
        ).toEqual([fx.a.ownerAccountId]);

      await refused(
        transfer(fx.a.agentAccountId, { verification_checklist: undefined }),
        400,
        'validation',
      );
      await refused(
        transfer(fx.a.agentAccountId, { verification_checklist: { ...CHECKLIST, ticket_id: ' ' } }),
        400,
        'validation',
      );
      await refused(
        transfer(fx.a.agentAccountId, {
          verification_checklist: { ...CHECKLIST, signed_request: false },
        }),
        400,
        'validation',
      );
      await refused(transfer(fx.b.ownerAccountId), 409, 'platform_workspace_state', 'not_a_member');
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { suspended: true },
      });
      await refused(
        transfer(fx.a.agentAccountId),
        409,
        'platform_workspace_state',
        'member_suspended',
      );
      await refused(transfer(fx.a.agentAccountId, {}, 'support'), 403, 'authorization');
      clock.advance(6 * MINUTE);
      await refused(transfer(fx.a.agentAccountId), 403, 'platform_recent_totp_required');
      await unchangedOwners();
      expect(mailer.sent).toHaveLength(0);
    });
  });

  describe('deletion, its cancellation and the purge', () => {
    const name = 'Org A';
    const del = (confirmName: string, role: PlatformRole = 'superadmin') =>
      act(fx.a, 'delete', { confirm_name: confirmName }, role);

    beforeEach(async () => {
      await owner.organization.update({ where: { id: fx.a.organizationId }, data: { name } });
    });

    it('refuses a name that is not the workspace’s, and changes nothing', async () => {
      await refused(del('Org B'), 400, 'validation', 'confirm_name_mismatch');
      await refused(del(''), 400, 'validation', 'confirm_name_mismatch');
      expect(await license(fx.a)).toMatchObject({ status: 'trialing', purgeScheduledAt: null });
      expect((await trails(fx.a)).platformRows).toHaveLength(0);
      expect(mailer.sent).toHaveLength(0);
    });

    it('schedules the purge fourteen days out, suspends the workspace and mails its owner; the suspension holds until the deletion is cancelled', async () => {
      const scheduled = await ok(del(name));
      expect(scheduled).toMatchObject({ unchanged: false, mail: 'sent' });
      const row = await license(fx.a);
      expect(row.status).toBe('suspended');
      expect(row.suspendedFromStatus).toBe('trialing');
      expect(row.purgeScheduledAt!.getTime()).toBe(
        row.suspendedAt!.getTime() + PURGE_COOLING_OFF_DAYS * DAY,
      );
      expect(Math.abs(row.purgeScheduledAt!.getTime() - (clock.now + 14 * DAY))).toBeLessThan(1000);
      const mail = mailer.sent.find((m) => m.kind === 'workspace_purge_scheduled')!;
      expect(mail.to).toBe(fx.a.ownerEmail);
      expect(mail.subject).toContain(name);
      await expectDoubleEntry(fx.a, 'workspace.deletion_scheduled', { suspended: true });

      const queue = await call('GET', '/workspaces/purge-queue', undefined, 'readonly');
      expect(queue.json().data).toEqual([
        {
          license_id: fx.a.licenseId.toString(),
          organization_name: name,
          status: 'suspended',
          suspended_at: row.suspendedAt!.toISOString(),
          purge_scheduled_at: row.purgeScheduledAt!.toISOString(),
        },
      ]);

      expect((await ok(del(name))).unchanged).toBe(true);
      await refused(act(fx.a, 'unsuspend'), 409, 'platform_workspace_state', 'purge_scheduled');

      await ok(act(fx.a, 'delete/cancel'));
      expect(await license(fx.a)).toMatchObject({ purgeScheduledAt: null, status: 'suspended' });
      expect((await call('GET', '/workspaces/purge-queue')).json().data).toEqual([]);
      await expectDoubleEntry(fx.a, 'workspace.deletion_cancelled');
      await ok(act(fx.a, 'unsuspend'));
      expect((await license(fx.a)).status).toBe('trialing');
    });

    it('wants a superadmin with a fresh code', async () => {
      await refused(del(name, 'support'), 403, 'authorization');
      await refused(del(name, 'readonly'), 403, 'authorization');
      clock.advance(6 * MINUTE);
      await refused(del(name), 403, 'platform_recent_totp_required');
      expect((await license(fx.a)).purgeScheduledAt).toBeNull();
    });

    it('purges a workspace whose time has come — its sandbox and organization with it — and records workspace.purged', async () => {
      await owner.$queryRaw`SELECT created_license FROM sandbox_create(${fx.a.licenseId}, ${fx.a.ownerAccountId}::uuid)`;
      const sandbox = await owner.license.findUniqueOrThrow({
        where: { sandboxOfLicenseId: fx.a.licenseId },
      });
      await ok(del(name));

      // Not yet due: nothing happens.
      expect((await platform.app.workspacePurge.run()).purged).toEqual([]);
      expect(await owner.license.count({ where: { id: fx.a.licenseId } })).toBe(1);

      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { purgeScheduledAt: new Date(Date.now() - MINUTE) },
      });
      const report = await platform.app.workspacePurge.run();
      expect(report).toEqual({ purged: [fx.a.licenseId.toString()], deferred: [] });

      expect(
        await owner.license.count({ where: { id: { in: [fx.a.licenseId, sandbox.id] } } }),
      ).toBe(0);
      expect(
        await owner.organization.count({
          where: { id: { in: [fx.a.organizationId, sandbox.organizationId] } },
        }),
      ).toBe(0);
      expect(await owner.customer.count({ where: { organizationId: fx.a.organizationId } })).toBe(
        0,
      );
      expect(await owner.auditLogEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      // Accounts are people, not the workspace's: they stay.
      expect(await owner.account.count({ where: { id: fx.a.ownerAccountId } })).toBe(1);
      // B is whole.
      expect(await owner.license.count({ where: { id: fx.b.licenseId } })).toBe(1);
      expect(await owner.customer.count({ where: { id: fx.b.customerId } })).toBe(1);

      const { platformRows } = await trails(fx.a.licenseId);
      const purged = platformRows.filter((row) => row.action === 'workspace.purged');
      expect(purged).toHaveLength(1);
      expect(purged[0]).toMatchObject({
        adminId: null,
        reason: WORKSPACE_PURGE_REASON,
        targetId: fx.a.licenseId.toString(),
      });
      expect(purged[0]!.payload).toMatchObject({
        organization_deleted: true,
        sandbox_license_id: sandbox.id.toString(),
      });
      expect((await platform.app.platformAuditLog.verify()).ok).toBe(true);

      // A second pass finds nothing.
      expect(await platform.app.workspacePurge.run()).toEqual({ purged: [], deferred: [] });
    });

    it('does not purge a deletion cancelled after it came due', async () => {
      await ok(del(name));
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { purgeScheduledAt: new Date(Date.now() - MINUTE) },
      });
      await ok(act(fx.a, 'delete/cancel'));
      expect(await platform.app.workspacePurge.run()).toEqual({ purged: [], deferred: [] });
      expect(await owner.license.count({ where: { id: fx.a.licenseId } })).toBe(1);
    });
  });

  describe('every action', () => {
    const ACTIONS: Array<[string, Record<string, unknown>]> = [
      ['extend-trial', { days: 1 }],
      ['activate', {}],
      ['set-plan', { plan: 'enterprise' }],
      ['suspend', {}],
      ['unsuspend', {}],
      ['set-read-only', {}],
      ['set-active', {}],
      ['subscription/cancel', {}],
      ['subscription/resume', {}],
      ['resend-owner-verification', {}],
      ['sandbox/reset', {}],
      [
        'force-ownership-transfer',
        {
          to_account_id: '00000000-0000-4000-8000-000000000000',
          verification_checklist: CHECKLIST,
        },
      ],
      ['delete', { confirm_name: 'x' }],
      ['delete/cancel', {}],
    ];

    it('is refused to a read-only operator, wants a reason, and answers 404 for a workspace that does not exist', async () => {
      for (const [path, body] of ACTIONS) {
        await refused(act(fx.a, path, body, 'readonly'), 403, 'authorization');
        const bare = await call('POST', `/workspaces/${fx.a.licenseId}/${path}`, body);
        expect(bare.statusCode, path).toBe(400);
        expect((bare.json() as ErrorBody).error.type, path).toBe('platform_reason_required');
        for (const id of ['999999999', 'abc']) {
          const missing = await call('POST', `/workspaces/${id}/${path}`, { ...reason, ...body });
          expect(missing.statusCode, `${path} ${id}`).toBe(404);
        }
      }
      expect(await license(fx.a)).toMatchObject({ status: 'trialing', purgeScheduledAt: null });
      expect((await trails(fx.a)).platformRows).toHaveLength(0);
    });

    it('is not served by the tenant API', async () => {
      const token = await memberToken(fx.a);
      const response = await tenant.app.inject({
        method: 'POST',
        url: `/platform/v1/workspaces/${fx.a.licenseId}/activate`,
        headers: auth(token),
        payload: reason,
      });
      expect(response.statusCode).toBe(404);
    });
  });
});
