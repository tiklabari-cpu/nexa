/**
 * The root panel's accounts (tm 389.11 · FR-ADMIN-11 · docs/platform-admin/design.md §C
 * accounts).
 *
 * Each action is driven through the platform API and judged from the tenant API — what
 * the person can now do — and from both audit trails: one platform entry with the reason,
 * and the tenant half in every workspace the person belongs to, without it.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PlatformRole } from '@siyahtus/types';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { withTenant } from '../../src/lib/tenant.js';
import { generateTotpSecret } from '../../src/lib/totp.js';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import { ACCOUNT_EXPORT_FORMAT } from '../../src/services/platform/accounts.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedDefaultBrand,
  seedFixtures,
  TEST_PASSWORD,
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

const REASON = 'Locked out, called the support desk';
const reason = { reason: REASON };

const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

describe('platform accounts (tm 389.11)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let mailer: MemoryMailer;
  let fx: Fixtures;
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
  const act = (
    accountId: string,
    action: string,
    body: Record<string, unknown> = {},
    role: PlatformRole = 'superadmin',
  ) => call('POST', `/accounts/${accountId}/${action}`, { ...reason, ...body }, role);
  const ok = async (response: Promise<LightMyRequestResponse>) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(200);
    return settled.json() as {
      unchanged: boolean;
      account: Record<string, unknown> & {
        platform_suspended_at: string | null;
        two_factor: { enabled: boolean };
        credentials: { sessions: number; personal_tokens: number };
        memberships: Array<{ license_id: string; role: string }>;
      };
      mail?: string;
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
    return body;
  };

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** Put the agent of A into B as well, so an account action reaches two workspaces. */
  async function joinB(accountId: string) {
    await owner.agentMembership.create({
      data: { licenseId: fx.b.licenseId, agentId: accountId, role: 'agent' },
    });
  }

  /** The tenant API's password sign-in, end to end: login → authorize → token. */
  async function signIn(t: TenantFixture, email: string) {
    const verifier = generateToken(48).slice(0, 64);
    const login = await tenant.post('/auth/login', { email, password: TEST_PASSWORD });
    if (login.statusCode !== 200) return { login, grant: null };
    const authorized = await tenant.post('/auth/authorize', {
      client_id: t.clientId,
      redirect_uri: t.redirectUri,
      code_challenge: deriveCodeChallenge(verifier),
      email,
      password: TEST_PASSWORD,
      license_id: t.licenseId.toString(),
    });
    if (authorized.statusCode !== 200) return { login, authorized, grant: null };
    const exchanged = await tenant.post('/auth/token', {
      grant_type: 'authorization_code',
      code: authorized.json().code,
      code_verifier: verifier,
      client_id: t.clientId,
      redirect_uri: t.redirectUri,
    });
    expect(exchanged.statusCode, exchanged.body).toBe(200);
    return {
      login,
      authorized,
      grant: exchanged.json() as { access_token: string; refresh_token: string },
    };
  }

  const refresh = (t: TenantFixture, refreshToken: string) =>
    tenant.post('/auth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: t.clientId,
    });

  /** The platform entries of one action on one account, and its tenant halves. */
  async function trails(accountId: string, action: string) {
    const [platformRows, tenantRows] = await Promise.all([
      owner.platformAuditLog.findMany({
        where: { action, targetId: accountId },
        orderBy: { chainSeq: 'asc' },
      }),
      owner.auditLogEntry.findMany({
        where: { actorType: 'platform', action: `platform.${action.replace('.', '_')}` },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { platformRows, tenantRows };
  }

  async function expectRecorded(accountId: string, action: string, workspaces: bigint[]) {
    const { platformRows, tenantRows } = await trails(accountId, action);
    expect(platformRows, action).toHaveLength(1);
    expect(platformRows[0]).toMatchObject({
      reason: REASON,
      targetType: 'account',
      targetId: accountId,
      licenseId: null,
    });
    expect(tenantRows.map((row) => row.licenseId).sort()).toEqual([...workspaces].sort());
    for (const row of tenantRows) {
      expect(row.target).toBe(`account:${accountId}`);
      expect(row.metadata).toMatchObject({ platform_seq: platformRows[0]!.chainSeq.toString() });
      expect(JSON.stringify(row.metadata)).not.toContain(REASON);
    }
    return platformRows[0]!;
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
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  });

  describe('search and detail', () => {
    it('finds an account by exact address, address prefix, name prefix and id — prefixes, not substrings', async () => {
      const find = async (q: string) => {
        const response = await call('GET', `/accounts?q=${encodeURIComponent(q)}`);
        expect(response.statusCode, response.body).toBe(200);
        return (response.json() as { data: Array<{ id: string; email: string }> }).data.map(
          (row) => row.email,
        );
      };
      expect(await find('AGENT-A@example.test')).toEqual([fx.a.agentEmail]);
      expect(await find('owner-')).toEqual([fx.a.ownerEmail, fx.b.ownerEmail]);
      expect(await find('Agent b')).toEqual([fx.b.agentEmail]);
      expect(await find(fx.b.ownerAccountId)).toEqual([fx.b.ownerEmail]);
      expect(await find('example.test')).toEqual([]);
      // A LIKE metacharacter is a character.
      expect(await find('%')).toEqual([]);
    });

    it('walks every account with limit=1 without a repeat or a gap, and refuses a foreign cursor', async () => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const response = await call(
          'GET',
          `/accounts?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        const page = response.json() as {
          data: Array<{ email: string }>;
          next_cursor: string | null;
        };
        seen.push(...page.data.map((row) => row.email));
        cursor = page.next_cursor;
      } while (cursor);
      expect(seen).toEqual(
        [fx.a.agentEmail, fx.b.agentEmail, fx.a.ownerEmail, fx.b.ownerEmail].sort(),
      );
      const bad = await call('GET', '/accounts?cursor=not-a-cursor');
      expect(bad.statusCode).toBe(400);
    });

    it('shows memberships, roles, the last sign-in and the second factor — and 404s an unknown or malformed id', async () => {
      await joinB(fx.a.agentAccountId);
      const before = await call('GET', `/accounts/${fx.a.agentAccountId}`);
      expect(before.json().account.last_sign_in_at).toBeNull();
      await signIn(fx.a, fx.a.agentEmail);

      const response = await call('GET', `/accounts/${fx.a.agentAccountId}`, undefined, 'readonly');
      expect(response.statusCode, response.body).toBe(200);
      const { account } = response.json() as { account: Record<string, unknown> };
      expect(account).toMatchObject({
        id: fx.a.agentAccountId,
        email: fx.a.agentEmail,
        password_set: true,
        platform_suspended_at: null,
        two_factor: { enabled: false, enabled_at: null, recovery_codes_left: 0 },
        credentials: { sessions: 1, personal_tokens: 0 },
        memberships: [
          { license_id: fx.a.licenseId.toString(), organization_name: 'Org A', role: 'agent' },
          { license_id: fx.b.licenseId.toString(), organization_name: 'Org B', role: 'agent' },
        ],
      });
      expect(account['last_sign_in_at']).toEqual(expect.any(String));
      expect(JSON.stringify(account)).not.toMatch(/token_hash|password_hash|secret/);

      expect((await call('GET', '/accounts/00000000-0000-4000-8000-000000000000')).statusCode).toBe(
        404,
      );
      expect((await call('GET', '/accounts/abc')).statusCode).toBe(404);
      // billing holds no accounts.read.
      expect((await call('GET', '/accounts', undefined, 'billing')).statusCode).toBe(403);
    });
  });

  describe('mail and credentials', () => {
    it('mails a new verification link to an unverified address, and nothing to a verified one', async () => {
      const verified = await ok(act(fx.a.agentAccountId, 'resend-verification', {}, 'support'));
      expect(verified.unchanged).toBe(true);
      expect(mailer.sent).toHaveLength(0);

      await owner.account.update({
        where: { id: fx.a.agentAccountId },
        data: { emailVerifiedAt: null },
      });
      const sent = await ok(act(fx.a.agentAccountId, 'resend-verification', {}, 'support'));
      expect(sent).toMatchObject({ unchanged: false, mail: 'sent' });
      const mail = mailer.sent.find((m) => m.kind === 'email_verification')!;
      expect(mail.to).toBe(fx.a.agentEmail);
      const token = /verify-email\?token=([A-Za-z0-9_%-]+)/.exec(mail.body)![1]!;
      const link = await owner.emailVerificationToken.findFirst({
        where: { accountId: fx.a.agentAccountId, usedAt: null },
      });
      expect(link).not.toBeNull();
      expect(decodeURIComponent(token)).not.toBe('');
      await expectRecorded(fx.a.agentAccountId, 'account.verification_resent', [fx.a.licenseId]);
    });

    it('forces a password reset: the old refresh token is refused, a link is mailed and it works', async () => {
      const { grant } = await signIn(fx.a, fx.a.agentEmail);
      const forced = await ok(act(fx.a.agentAccountId, 'force-password-reset', {}, 'support'));
      expect(forced).toMatchObject({ unchanged: false, mail: 'sent' });
      expect(forced.account.credentials.sessions).toBe(0);

      expect((await refresh(fx.a, grant!.refresh_token)).statusCode).toBe(401);
      expect((await tenant.get('/auth/me', auth(grant!.access_token))).statusCode).toBe(401);

      const mail = mailer.sent.find((m) => m.kind === 'password_reset')!;
      expect(mail.to).toBe(fx.a.agentEmail);
      const token = decodeURIComponent(
        /reset-password\?token=([A-Za-z0-9_%-]+)/.exec(mail.body)![1]!,
      );
      const confirmed = await tenant.post('/auth/password-reset/confirm', {
        token,
        password: 'a-brand-new-long-password',
      });
      expect(confirmed.statusCode, confirmed.body).toBe(204);
      const login = await tenant.post('/auth/login', {
        email: fx.a.agentEmail,
        password: 'a-brand-new-long-password',
      });
      expect(login.statusCode).toBe(200);
      const entry = await expectRecorded(fx.a.agentAccountId, 'account.password_reset_forced', [
        fx.a.licenseId,
      ]);
      expect(entry.payload).toMatchObject({ sessions_ended: 2 });
    });

    it('revoke-sessions ends sessions and keeps personal tokens; revoke-tokens ends those too', async () => {
      const pat = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:ro'],
      });
      const { grant } = await signIn(fx.a, fx.a.agentEmail);

      await ok(act(fx.a.agentAccountId, 'revoke-sessions', {}, 'support'));
      expect((await tenant.get('/auth/me', auth(grant!.access_token))).statusCode).toBe(401);
      expect((await refresh(fx.a, grant!.refresh_token)).statusCode).toBe(401);
      expect((await tenant.get('/auth/me', auth(pat))).statusCode).toBe(200);
      // Nothing left to end.
      expect((await ok(act(fx.a.agentAccountId, 'revoke-sessions', {}, 'support'))).unchanged).toBe(
        true,
      );

      const revoked = await ok(act(fx.a.agentAccountId, 'revoke-tokens', {}, 'support'));
      expect(revoked.account.credentials).toEqual({ sessions: 0, personal_tokens: 0 });
      expect((await tenant.get('/auth/me', auth(pat))).statusCode).toBe(401);
      const entry = await expectRecorded(fx.a.agentAccountId, 'account.tokens_revoked', [
        fx.a.licenseId,
      ]);
      expect(entry.payload).toMatchObject({ personal_revoked: 1 });
      // The owner's token in the same workspace is somebody else's.
      const ownerPat = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      expect((await tenant.get('/auth/me', auth(ownerPat))).statusCode).toBe(200);
    });
  });

  describe('the second factor', () => {
    it('removes the authenticator: the sign-in asks for no code, and a workspace that requires one asks for enrolment', async () => {
      await owner.accountTwoFactor.create({
        data: {
          accountId: fx.a.agentAccountId,
          secret: generateTotpSecret(),
          activatedAt: new Date(),
        },
      });
      const brand = await seedDefaultBrand(owner, fx.b.licenseId);
      await owner.securitySettings.create({
        data: { licenseId: fx.b.licenseId, brandId: brand, requireTwoFactor: true },
      });
      await joinB(fx.a.agentAccountId);
      const before = await signIn(fx.a, fx.a.agentEmail);
      expect(before.login.json().account.two_factor_enabled).toBe(true);
      expect(before.authorized!.statusCode).toBe(401);
      expect(before.authorized!.json().error.type).toBe('two_factor_required');

      // Only a superadmin, and only with a fresh code.
      await refused(
        act(fx.a.agentAccountId, 'reset-two-factor', {}, 'support'),
        403,
        'authorization',
      );
      clock.advance(6 * MINUTE);
      await refused(
        act(fx.a.agentAccountId, 'reset-two-factor'),
        403,
        'platform_recent_totp_required',
      );
      tokens.set(
        'superadmin',
        await openActiveSession(db, await createOperator(db, { clock }), clock),
      );

      const reset = await ok(act(fx.a.agentAccountId, 'reset-two-factor'));
      expect(reset.account.two_factor.enabled).toBe(false);
      expect((await ok(act(fx.a.agentAccountId, 'reset-two-factor'))).unchanged).toBe(true);

      const after = await signIn(fx.a, fx.a.agentEmail);
      expect(after.login.json().account.two_factor_enabled).toBe(false);
      expect(after.grant).not.toBeNull();
      const required = await signIn(fx.b, fx.a.agentEmail);
      expect(required.authorized!.statusCode).toBe(401);
      expect(required.authorized!.json().error).toMatchObject({
        type: 'two_factor_required',
        details: { enrollment_required: true },
      });
      await expectRecorded(fx.a.agentAccountId, 'account.two_factor_reset', [
        fx.a.licenseId,
        fx.b.licenseId,
      ]);
    });
  });

  describe('suspension', () => {
    it('refuses the password with 403 account_suspended, every bearer with 401, in every workspace — and lifts cleanly', async () => {
      await joinB(fx.a.agentAccountId);
      const { grant } = await signIn(fx.a, fx.a.agentEmail);
      const pat = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:ro'],
      });

      const suspended = await ok(act(fx.a.agentAccountId, 'suspend'));
      expect(suspended.account.platform_suspended_at).toEqual(expect.any(String));
      expect(suspended.account.memberships).toHaveLength(2);
      expect((await ok(act(fx.a.agentAccountId, 'suspend'))).unchanged).toBe(true);

      const login = await refused(
        tenant.post('/auth/login', { email: fx.a.agentEmail, password: TEST_PASSWORD }),
        403,
        'not_allowed',
        'account_suspended',
      );
      expect(JSON.stringify(login)).not.toContain(REASON);
      // A wrong password learns nothing.
      await refused(
        tenant.post('/auth/login', { email: fx.a.agentEmail, password: 'not-the-password' }),
        401,
        'authentication',
      );
      expect((await tenant.get('/auth/me', auth(grant!.access_token))).statusCode).toBe(401);
      expect((await tenant.get('/auth/me', auth(pat))).statusCode).toBe(401);
      expect((await refresh(fx.a, grant!.refresh_token)).statusCode).toBe(401);
      // The rest of the workspace carries on.
      expect((await signIn(fx.a, fx.a.ownerEmail)).grant).not.toBeNull();

      // The tenant role cannot lift it, even inside a workspace the person belongs to.
      await expect(
        withTenant(
          tenant.app.db,
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
          (tx) =>
            tx.$executeRaw`UPDATE accounts SET platform_suspended_at = NULL WHERE id = ${fx.a.agentAccountId}::uuid`,
        ),
      ).rejects.toThrow(/set and lifted by the platform/);

      const lifted = await ok(act(fx.a.agentAccountId, 'unsuspend'));
      expect(lifted.account.platform_suspended_at).toBeNull();
      expect((await signIn(fx.a, fx.a.agentEmail)).grant).not.toBeNull();
      // A personal token was not ended by the suspension, so it works again.
      expect((await tenant.get('/auth/me', auth(pat))).statusCode).toBe(200);

      const entry = await expectRecorded(fx.a.agentAccountId, 'account.suspended', [
        fx.a.licenseId,
        fx.b.licenseId,
      ]);
      expect(entry.payload).toMatchObject({ sessions_ended: 2 });
      await expectRecorded(fx.a.agentAccountId, 'account.unsuspended', [
        fx.a.licenseId,
        fx.b.licenseId,
      ]);
      const row = await owner.account.findUniqueOrThrow({ where: { id: fx.a.agentAccountId } });
      expect(row.platformSuspendedReason).toBeNull();
    });
  });

  describe('export and erasure', () => {
    it('exports the account as a person — profile, memberships, token names, trail counts — and nothing of a workspace', async () => {
      await joinB(fx.a.agentAccountId);
      await signIn(fx.a, fx.a.agentEmail);
      await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:ro'],
      });
      await refused(act(fx.a.agentAccountId, 'export', {}, 'support'), 403, 'authorization');
      const response = await act(fx.a.agentAccountId, 'export');
      expect(response.statusCode, response.body).toBe(200);
      expect(response.headers['content-disposition']).toContain('attachment');
      const document = response.json() as Record<string, unknown>;
      expect(Object.keys(document).sort()).toEqual(
        [
          'account',
          'audit_summary',
          'format',
          'generated_at',
          'memberships',
          'personal_tokens',
        ].sort(),
      );
      expect(document['format']).toBe(ACCOUNT_EXPORT_FORMAT);
      expect(Object.keys(document['account'] as object).sort()).toEqual(
        [
          'avatar_url',
          'created_at',
          'email',
          'email_verified_at',
          'id',
          'last_seen_at',
          'name',
          'password_set',
          'suspended',
          'two_factor',
        ].sort(),
      );
      expect(document['memberships']).toHaveLength(2);
      expect(document['personal_tokens']).toEqual([
        expect.objectContaining({ name: 'test token', license_id: fx.a.licenseId.toString() }),
      ]);
      expect(document['audit_summary']).toEqual([
        expect.objectContaining({ license_id: fx.a.licenseId.toString(), entries: 1 }),
      ]);
      const text = JSON.stringify(document);
      expect(text).not.toMatch(/token_hash|password_hash|secret|message|chat|customer/i);
      await expectRecorded(fx.a.agentAccountId, 'account.exported', [
        fx.a.licenseId,
        fx.b.licenseId,
      ]);
    });

    it('refuses to erase a Founder (409 account_is_sole_owner) and a mistyped address (400), and erases anybody else with both trails kept', async () => {
      await refused(
        act(fx.a.ownerAccountId, 'erase', { confirm_email: fx.a.ownerEmail }),
        409,
        'platform_account_state',
        'account_is_sole_owner',
      );
      await refused(
        act(fx.a.agentAccountId, 'erase', { confirm_email: 'someone-else@example.test' }),
        400,
        'validation',
        'confirm_email_mismatch',
      );
      await refused(
        act(fx.a.agentAccountId, 'erase', { confirm_email: fx.a.agentEmail }, 'support'),
        403,
        'authorization',
      );
      expect(await owner.account.findUnique({ where: { id: fx.a.agentAccountId } })).not.toBeNull();

      await joinB(fx.a.agentAccountId);
      await signIn(fx.a, fx.a.agentEmail);
      await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['chats--all:ro'],
      });
      const erased = await act(fx.a.agentAccountId, 'erase', {
        confirm_email: fx.a.agentEmail.toUpperCase(),
      });
      expect(erased.statusCode, erased.body).toBe(200);
      expect(erased.json()).toEqual({
        erased: true,
        account_id: fx.a.agentAccountId,
        license_ids: [fx.a.licenseId.toString(), fx.b.licenseId.toString()],
      });

      expect(await owner.account.findUnique({ where: { id: fx.a.agentAccountId } })).toBeNull();
      expect(await owner.agentMembership.count({ where: { agentId: fx.a.agentAccountId } })).toBe(
        0,
      );
      expect(await owner.apiToken.count({ where: { ownerId: fx.a.agentAccountId } })).toBe(0);
      expect(
        await owner.oauthRefreshToken.count({ where: { accountId: fx.a.agentAccountId } }),
      ).toBe(0);
      // The workspaces and their owners stay.
      expect(await owner.account.findUnique({ where: { id: fx.a.ownerAccountId } })).not.toBeNull();
      const entry = await expectRecorded(fx.a.agentAccountId, 'account.erased', [
        fx.a.licenseId,
        fx.b.licenseId,
      ]);
      expect(JSON.stringify(entry.payload)).not.toContain(fx.a.agentEmail);
      expect((await call('GET', `/accounts/${fx.a.agentAccountId}`)).statusCode).toBe(404);
    });

    it('wants a fresh code to erase', async () => {
      clock.advance(6 * MINUTE);
      await refused(
        act(fx.a.agentAccountId, 'erase', { confirm_email: fx.a.agentEmail }),
        403,
        'platform_recent_totp_required',
      );
    });
  });

  describe('gates', () => {
    it('refuses readonly every action, wants a reason, 404s a malformed id, and is absent from the tenant API', async () => {
      for (const action of [
        'resend-verification',
        'force-password-reset',
        'revoke-sessions',
        'revoke-tokens',
        'reset-two-factor',
        'suspend',
        'unsuspend',
        'export',
        'erase',
      ]) {
        const response = await act(fx.a.agentAccountId, action, { confirm_email: 'x' }, 'readonly');
        expect(response.statusCode, action).toBe(403);
        const bare = await call('POST', `/accounts/${fx.a.agentAccountId}/${action}`, {
          confirm_email: fx.a.agentEmail,
        });
        expect(bare.statusCode, action).toBe(400);
        expect((bare.json() as ErrorBody).error.type, action).toBe('platform_reason_required');
        expect((await act('not-a-uuid', action, { confirm_email: 'x' })).statusCode, action).toBe(
          404,
        );
      }
      expect(await owner.platformAuditLog.count({ where: { targetType: 'account' } })).toBe(0);
      const leak = await tenant.get(
        `/platform/v1/accounts/${fx.a.agentAccountId}`,
        auth(
          await grantToken(owner, {
            licenseId: fx.a.licenseId,
            organizationId: fx.a.organizationId,
            ownerId: fx.a.ownerAccountId,
            scopes: ['accounts--all:rw'],
          }),
        ),
      );
      expect(leak.statusCode).toBe(404);
    });
  });
});
