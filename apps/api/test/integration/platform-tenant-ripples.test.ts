/**
 * The tenant half of the root panel (tm 389.2 · docs/platform-admin/design.md §B3).
 *
 * The platform acts on a workspace through five things this suite pins, each
 * from the tenant side — the platform's own routes come later (389.10, 389.15):
 *
 *   1. A suspended licence is a full lock: every authenticated route answers
 *      403 `workspace_suspended`, the widget token mint too, and so does the
 *      sign-in; signing out stays open. Lifting it restores everything.
 *   2. A canceled licence behaves exactly as it did before `suspended` existed
 *      — `isLicenseClosed()` replaced eleven `=== 'canceled'` comparisons, and
 *      the answers they gave are asserted here, not assumed.
 *   3. `license_overrides` is read by the workspace and written by nobody in
 *      it; a live override replaces the plan's entitlement, the seat ceiling and
 *      the daily mail cap, and an expired one is as if it were not there.
 *   4. `auth_consume_impersonation_handoff` trades a handoff code for a token
 *      once, inside its window, for a live session only — and the token is not
 *      honoured yet (389.15 opens it behind its gate).
 *   5. The audit trail takes a `platform` actor with `on_behalf_of`, chained
 *      like every other entry.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateToken, hashToken } from '../../src/lib/crypto.js';
import { withTenant } from '../../src/lib/tenant.js';
import { deriveChainKey, verifyAuditChain } from '../../src/services/audit/audit-chain.js';
import { writeAuditEntry } from '../../src/services/audit/audit-log.js';
import {
  auditContextFor,
  grantToken,
  ownerClient,
  seedFixtures,
  seedSubscription,
  TEST_PASSWORD,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

type ErrorBody = { error: { type: string; message: string; details?: Record<string, unknown> } };

describe('platform ripples on the tenant side (tm 389.2)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const tenantOf = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await appRole.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  function memberToken(t: TenantFixture, scopes: string[] = ['chats--all:ro']) {
    return grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes,
    });
  }

  const suspend = (t: TenantFixture) =>
    owner.license.update({
      where: { id: t.licenseId },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedReason: 'operator note: chargeback investigation',
      },
    });

  const lift = (t: TenantFixture) =>
    owner.license.update({
      where: { id: t.licenseId },
      data: { status: 'active', suspendedAt: null, suspendedReason: null },
    });

  const mintCustomerToken = (t: TenantFixture) =>
    server.post(
      '/customer/token',
      { organization_id: t.organizationId },
      { origin: `https://${t.trustedDomain}` },
    );

  const signIn = (t: TenantFixture) =>
    server.post('/auth/authorize', {
      client_id: t.clientId,
      redirect_uri: t.redirectUri,
      code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
      email: t.ownerEmail,
      password: TEST_PASSWORD,
      license_id: t.licenseId.toString(),
    });

  function expectSuspended(response: { statusCode: number; json: () => unknown }) {
    expect(response.statusCode).toBe(403);
    const body = response.json() as ErrorBody;
    expect(body.error.type).toBe('not_allowed');
    expect(body.error.details).toEqual({ reason: 'workspace_suspended' });
    // The operator's reason is the platform's, never the workspace's.
    expect(JSON.stringify(body)).not.toContain('chargeback');
  }

  // =========================================================================
  // 1. Suspension
  // =========================================================================

  describe('a suspended licence', () => {
    it('refuses a member every authenticated route — reads included — with 403 workspace_suspended', async () => {
      const token = await memberToken(fx.a);
      expect((await server.get('/chats', auth(token))).statusCode).toBe(200);

      await suspend(fx.a);
      expectSuspended(await server.get('/chats', auth(token)));
      expectSuspended(await server.get('/auth/me', auth(token)));
      expectSuspended(
        await server.post('/invitations', { emails: ['x@example.test'] }, auth(token)),
      );

      await lift(fx.a);
      expect((await server.get('/chats', auth(token))).statusCode).toBe(200);
    });

    it('refuses the widget token mint with 403 workspace_suspended, and mints again once lifted', async () => {
      expect((await mintCustomerToken(fx.a)).statusCode).toBe(200);

      await suspend(fx.a);
      expectSuspended(await mintCustomerToken(fx.a));

      await lift(fx.a);
      expect((await mintCustomerToken(fx.a)).statusCode).toBe(200);
    });

    it('refuses the sign-in with 403 workspace_suspended after the password is proved', async () => {
      await suspend(fx.a);
      expectSuspended(await signIn(fx.a));
      await lift(fx.a);
      expect((await signIn(fx.a)).statusCode).toBe(200);
    });

    it('keeps signing out and the health check open', async () => {
      const token = await memberToken(fx.a);
      await suspend(fx.a);

      expect((await server.get('/health')).statusCode).toBe(200);
      const revoked = await server.post('/auth/revoke', { token });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toEqual({ revoked: true });

      // Revoked for good: lifting the suspension does not bring it back.
      await lift(fx.a);
      expect((await server.get('/chats', auth(token))).statusCode).toBe(401);
    });

    it('leaves every other workspace alone', async () => {
      const tokenB = await memberToken(fx.b);
      await suspend(fx.a);
      expect((await server.get('/chats', auth(tokenB))).statusCode).toBe(200);
      expect((await mintCustomerToken(fx.b)).statusCode).toBe(200);
    });

    it('stays out of reach of the workspace itself — the tenant role cannot suspend or lift', async () => {
      const tenant = tenantOf(fx.a);
      await expect(
        withTenant(appRole, tenant, (tx) =>
          tx.license.update({
            where: { id: fx.a.licenseId },
            data: { status: 'suspended', suspendedAt: new Date() },
          }),
        ),
      ).rejects.toThrow(/set and lifted by the platform/);

      await suspend(fx.a);
      await expect(
        withTenant(appRole, tenant, (tx) =>
          tx.license.update({
            where: { id: fx.a.licenseId },
            data: { status: 'active', suspendedAt: null, suspendedReason: null },
          }),
        ),
      ).rejects.toThrow(/set and lifted by the platform/);
      const after = await owner.license.findUniqueOrThrow({ where: { id: fx.a.licenseId } });
      expect(after.status).toBe('suspended');
    });

    it('cannot be stored without saying when it began', async () => {
      await expect(
        owner.license.update({ where: { id: fx.a.licenseId }, data: { status: 'suspended' } }),
      ).rejects.toThrow(/licenses_suspension_check/);
    });

    it('closes the public knowledge base the way a cancellation does', async () => {
      await owner.kbSettings.create({
        data: { licenseId: fx.a.licenseId, enabled: true, publicSlug: 'ripples-kb' },
      });
      const resolve = () =>
        appRole.$queryRaw<unknown[]>`SELECT * FROM kb_resolve_public_slug('ripples-kb')`;
      expect(await resolve()).toHaveLength(1);
      await suspend(fx.a);
      expect(await resolve()).toHaveLength(0);
    });
  });

  // =========================================================================
  // 2. Cancellation — unchanged
  // =========================================================================

  describe('a canceled licence answers exactly as before', () => {
    beforeEach(async () => {
      await owner.license.update({ where: { id: fx.a.licenseId }, data: { status: 'canceled' } });
    });

    it('refuses its bearer tokens as invalid (401), not as suspended', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      const response = await server.get('/chats', auth(token));
      expect(response.statusCode).toBe(401);
      expect((response.json() as ErrorBody).error.type).toBe('authentication');
    });

    it('refuses the widget token mint and the sign-in with 402 license_expired', async () => {
      for (const response of [await mintCustomerToken(fx.a), await signIn(fx.a)]) {
        expect(response.statusCode).toBe(402);
        expect((response.json() as ErrorBody).error.type).toBe('license_expired');
      }
    });
  });

  // =========================================================================
  // 3. license_overrides
  // =========================================================================

  describe('license_overrides', () => {
    const invite = async (token: string, email: string) =>
      server.post('/invitations', { emails: [email], role: 'agent' }, auth(token));

    it('is readable by the workspace and writable by nobody in it', async () => {
      await owner.licenseOverride.create({
        data: { licenseId: fx.b.licenseId, seatCeiling: 5 },
      });
      const tenant = tenantOf(fx.a);

      await expect(
        withTenant(appRole, tenant, (tx) =>
          tx.licenseOverride.create({ data: { licenseId: fx.a.licenseId, seatCeiling: 999 } }),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withTenant(
          appRole,
          tenant,
          (tx) => tx.$executeRaw`UPDATE license_overrides SET seat_ceiling = 999`,
        ),
      ).rejects.toThrow(/permission denied/);

      // SELECT is granted, and RLS confines it to the caller's own row.
      await owner.licenseOverride.create({ data: { licenseId: fx.a.licenseId, seatCeiling: 7 } });
      const seen = await withTenant(appRole, tenant, (tx) => tx.licenseOverride.findMany());
      expect(seen.map((row) => row.licenseId)).toEqual([fx.a.licenseId]);
    });

    it('refuses an entitlement key outside the vocabulary', async () => {
      await expect(
        owner.licenseOverride.create({
          data: { licenseId: fx.a.licenseId, entitlements: { white_lable: true } },
        }),
      ).rejects.toThrow(/license_overrides_entitlements_check/);
    });

    it('replaces the seat ceiling, and an expired override is ignored', async () => {
      const token = await memberToken(fx.a, ['accounts--all:rw']);
      // Owner + agent hold two seats; a ceiling of two leaves no room.
      await owner.licenseOverride.create({ data: { licenseId: fx.a.licenseId, seatCeiling: 2 } });

      const refused = await invite(token, 'third@example.test');
      expect(refused.statusCode).toBe(429);
      expect((refused.json() as ErrorBody).error.type).toBe('users_limit_reached');
      expect((refused.json() as ErrorBody).error.message).toContain('2-seat ceiling');
      expect(await owner.invitation.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);

      await owner.licenseOverride.update({
        where: { licenseId: fx.a.licenseId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await invite(token, 'third@example.test')).statusCode).toBe(201);
    });

    it('replaces the plan entitlement in both directions, in the report and at the gate', async () => {
      const token = await memberToken(fx.a, ['chats--all:ro']);
      const entitlements = async () =>
        (
          (await server.get('/billing/entitlements', auth(token))).json() as {
            entitlements: Record<string, boolean>;
          }
        ).entitlements;

      // A trial (growth) has no SSO; the platform grants it.
      expect((await entitlements())['sso']).toBe(false);
      await owner.licenseOverride.create({
        data: { licenseId: fx.a.licenseId, entitlements: { sso: true } },
      });
      expect(await entitlements()).toMatchObject({ sso: true, white_label: false });

      // An enterprise workspace has white label; the platform withdraws it.
      await seedSubscription(owner, fx.a.licenseId, 'enterprise');
      expect((await entitlements())['white_label']).toBe(true);
      await owner.licenseOverride.update({
        where: { licenseId: fx.a.licenseId },
        data: { entitlements: { white_label: false } },
      });
      const after = await entitlements();
      expect(after['white_label']).toBe(false);
      // Keys the override does not name keep the plan's answer.
      expect(after['sso']).toBe(true);
    });

    it("replaces the workspace's daily mail cap inside mail_budget_spend", async () => {
      const day = '20261101';
      const spend = () =>
        appRole.$queryRaw<Array<{ scope: string | null }>>`
          SELECT mail_budget_spend(${fx.a.licenseId}::bigint, ${day}::text, false, NULL::text,
            200, 50, 400, 50, 5) AS scope`;

      await owner.licenseOverride.create({ data: { licenseId: fx.a.licenseId, mailDailyCap: 1 } });
      expect((await spend())[0]?.scope).toBeNull();
      expect((await spend())[0]?.scope).toBe('workspace');

      // Expired: the deployment's 200 is back.
      await owner.licenseOverride.update({
        where: { licenseId: fx.a.licenseId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await spend())[0]?.scope).toBeNull();
    });
  });

  // =========================================================================
  // 4. The impersonation handoff
  // =========================================================================

  describe('auth_consume_impersonation_handoff', () => {
    async function openSession(
      t: TenantFixture,
      options: { handoffInMs?: number; endsInMs?: number; ended?: boolean } = {},
    ) {
      const admin = await owner.platformAdmin.create({
        data: {
          id: randomUUID(),
          email: `operator-${randomUUID()}@siyahtus.test`,
          passwordHash: 'x',
          role: 'support',
        },
        select: { id: true },
      });
      const code = generateToken(32);
      const session = await owner.platformImpersonationSession.create({
        data: {
          id: randomUUID(),
          adminId: admin.id,
          licenseId: t.licenseId,
          accountId: t.agentAccountId,
          mode: 'read_only',
          handoffCodeHash: hashToken(code),
          handoffExpiresAt: new Date(Date.now() + (options.handoffInMs ?? 60_000)),
          startedAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + (options.endsInMs ?? 30 * 60_000)),
          ...(options.ended ? { endedAt: new Date(), endReason: 'ended_by_operator' } : {}),
        },
        select: { id: true },
      });
      return { adminId: admin.id, sessionId: session.id, code };
    }

    type Consumed = {
      token_id: string;
      session_id: string;
      license_id: bigint;
      organization_id: string;
      account_id: string;
      admin_id: string;
      mode: string;
      ends_at: Date;
    };
    const consume = (code: string, token: string) =>
      appRole.$queryRaw<Consumed[]>`
        SELECT * FROM auth_consume_impersonation_handoff(${hashToken(code)}, ${hashToken(token)})`;

    it('trades the code for an impersonation token once, and only once', async () => {
      const { adminId, sessionId, code } = await openSession(fx.a);
      const token = generateToken(32);

      const [traded] = await consume(code, token);
      expect(traded).toMatchObject({
        session_id: sessionId,
        license_id: fx.a.licenseId,
        organization_id: fx.a.organizationId,
        account_id: fx.a.agentAccountId,
        admin_id: adminId,
        mode: 'read_only',
      });
      const row = await owner.apiToken.findUniqueOrThrow({ where: { id: traded!.token_id } });
      expect(row).toMatchObject({
        kind: 'impersonation',
        ownerId: fx.a.agentAccountId,
        impersonationSessionId: sessionId,
        scopes: [],
      });
      expect(row.expiresAt?.getTime()).toBe(traded!.ends_at.getTime());

      // The same code again, even with a fresh token: nothing.
      expect(await consume(code, generateToken(32))).toEqual([]);
      expect(await owner.apiToken.count({ where: { kind: 'impersonation' } })).toBe(1);
    });

    it('lets exactly one of two racing redemptions win', async () => {
      const { code } = await openSession(fx.a);
      const results = await Promise.all([
        consume(code, generateToken(32)),
        consume(code, generateToken(32)),
      ]);
      expect(results.map((r) => r.length).sort()).toEqual([0, 1]);
    });

    it('refuses a code past its sixty seconds, an ended session and a session past its window', async () => {
      const late = await openSession(fx.a, { handoffInMs: -1000 });
      expect(await consume(late.code, generateToken(32))).toEqual([]);

      const ended = await openSession(fx.a, { ended: true });
      expect(await consume(ended.code, generateToken(32))).toEqual([]);

      const over = await openSession(fx.a, { endsInMs: -500 });
      expect(await consume(over.code, generateToken(32))).toEqual([]);

      expect(await owner.apiToken.count({ where: { kind: 'impersonation' } })).toBe(0);
    });

    it('refuses a member the workspace has suspended, and spends the code anyway', async () => {
      const { code, sessionId } = await openSession(fx.a);
      await owner.agentMembership.updateMany({
        where: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        data: { suspended: true },
      });
      expect(await consume(code, generateToken(32))).toEqual([]);
      const session = await owner.platformImpersonationSession.findUniqueOrThrow({
        where: { id: sessionId },
      });
      expect(session.handoffCodeHash).toBeNull();
    });

    it('resolves the token with its session, and the session ending revokes it', async () => {
      const { adminId, sessionId, code } = await openSession(fx.a);
      const token = generateToken(32);
      await consume(code, token);

      type Resolved = {
        kind: string;
        revoked_at: Date | null;
        impersonation_session_id: string | null;
        impersonation_mode: string | null;
        impersonation_admin_id: string | null;
      };
      const resolve = async () =>
        (
          await appRole.$queryRaw<Resolved[]>`SELECT * FROM auth_resolve_token(${hashToken(token)})`
        )[0];

      expect(await resolve()).toMatchObject({
        kind: 'impersonation',
        revoked_at: null,
        impersonation_session_id: sessionId,
        impersonation_mode: 'read_only',
        impersonation_admin_id: adminId,
      });

      await owner.platformImpersonationSession.update({
        where: { id: sessionId },
        data: { endedAt: new Date(), endReason: 'ended_by_operator' },
      });
      expect((await resolve())?.revoked_at).not.toBeNull();
    });

    it('is honoured by the tenant API as the member, on the session’s terms, since the gate exists (389.15)', async () => {
      const { code, sessionId } = await openSession(fx.a);
      const token = generateToken(32);
      await consume(code, token);
      const me = await server.get('/auth/me', auth(token));
      expect(me.statusCode, me.body).toBe(200);
      expect(me.json()).toMatchObject({
        account_id: fx.a.agentAccountId,
        role: 'agent',
        impersonation: { session_id: sessionId, mode: 'read_only' },
      });
    });

    it('leaves the other token kinds resolving as they did', async () => {
      const token = await memberToken(fx.a);
      const [row] = await appRole.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM auth_resolve_token(${hashToken(token)})`;
      expect(row).toMatchObject({
        kind: 'pat',
        expires_at: null,
        revoked_at: null,
        impersonation_session_id: null,
        impersonation_mode: null,
        impersonation_admin_id: null,
      });
    });
  });

  // =========================================================================
  // 5. The platform audit actor
  // =========================================================================

  describe('the platform audit actor', () => {
    const CHAIN_SECRET = testEnv().AUDIT_CHAIN_SECRET;

    it('writes a platform entry on behalf of a member, returns on_behalf_of and keeps the chain intact', async () => {
      const operatorId = randomUUID();
      const tenant = tenantOf(fx.a);
      // An ordinary entry first, so the chain links a null on_behalf_of to a set one.
      await withTenant(appRole, tenant, (tx) =>
        writeAuditEntry(tx, auditContextFor(tenant), { action: 'settings.security_updated' }),
      );
      await withTenant(appRole, tenant, (tx) =>
        writeAuditEntry(
          tx,
          {
            ...auditContextFor(tenant, { actorId: operatorId, actorType: 'platform' }),
            onBehalfOf: fx.a.agentAccountId,
          },
          { action: 'settings.security_updated', target: `license:${fx.a.licenseId}` },
        ),
      );

      const entry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, actorType: 'platform' },
      });
      expect(entry).toMatchObject({ actorId: operatorId, onBehalfOf: fx.a.agentAccountId });

      const admin = await memberToken(fx.a, ['audit_log--all:ro']);
      const read = await server.get(`/audit-log/${entry.id}`, auth(admin));
      expect(read.statusCode).toBe(200);
      expect(read.json()).toMatchObject({
        actor_type: 'platform',
        actor_id: operatorId,
        on_behalf_of: fx.a.agentAccountId,
      });
      const list = (await server.get('/audit-log', auth(admin))).json() as {
        items: Array<Record<string, unknown>>;
      };
      const others = list.items.filter((item) => item['actor_type'] !== 'platform');
      expect(others.length).toBeGreaterThan(0);
      for (const item of others) expect(item).not.toHaveProperty('on_behalf_of');

      const trail = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId },
        orderBy: [{ chainSeq: 'asc' }],
      });
      const verdict = verifyAuditChain(trail, {
        key: deriveChainKey(CHAIN_SECRET, fx.a.licenseId),
      });
      expect(verdict.findings).toEqual([]);

      // The chain commits to it: moving the entry to another member breaks it.
      const forged = trail.map((row) =>
        row.id === entry.id ? { ...row, onBehalfOf: fx.a.ownerAccountId } : row,
      );
      expect(
        verifyAuditChain(forged, { key: deriveChainKey(CHAIN_SECRET, fx.a.licenseId) }).findings,
      ).not.toEqual([]);
    });

    it('refuses on_behalf_of on any actor but the platform', async () => {
      const tenant = tenantOf(fx.a);
      await expect(
        withTenant(appRole, tenant, (tx) =>
          writeAuditEntry(
            tx,
            {
              ...auditContextFor(tenant, { actorId: fx.a.ownerAccountId, actorType: 'agent' }),
              onBehalfOf: fx.a.agentAccountId,
            },
            { action: 'settings.security_updated' },
          ),
        ),
      ).rejects.toThrow(/audit_log_on_behalf_of_check/);
    });
  });
});
