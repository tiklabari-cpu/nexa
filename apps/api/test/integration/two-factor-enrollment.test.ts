/**
 * Two-factor enrollment endpoints (NFR-S11 · FR-MOD-00.1 · S11-2FA-d).
 *
 * Four endpoints, and what is worth testing about them is not that the happy
 * path works — it is the set of failures that still *look* like a working
 * feature from outside:
 *
 *   an abandoned enrollment that turns into a state nobody can leave;
 *   a live factor swapped out by a session that proved nothing;
 *   a code that can be presented twice inside its thirty seconds;
 *   a recovery sheet that outlives the factor it belonged to;
 *   a workspace policy that only applies to the workspace you signed in to.
 *
 * Every one of those passes a happy-path test.
 *
 * The suite drives real HTTP against a real server, because half of these
 * properties live in the route's ordering and the other half in SECURITY
 * DEFINER functions — neither is observable from a unit test of the service.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { generateTotp, generateTotpForStep, totpStep } from '../../src/lib/totp.js';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';

/** `ABCDE-FGHJK`: two groups of five, no confusable characters, no lower case. */
const DISPLAY_RE = /^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{5}$/;

describe('two-factor enrollment endpoints (S11-2FA-d)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  /** A session for tenant A's owner — the account under test throughout. */
  let token: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    token = await session(fx.a, fx.a.ownerAccountId);
  });

  function session(tenant: TenantFixture, accountId: string): Promise<string> {
    return grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: accountId,
      scopes: ['accounts--my:rw'],
    });
  }

  const auth = (bearer = token): Record<string, string> => ({ authorization: `Bearer ${bearer}` });

  /** `server.del` takes no payload, and this endpoint asks for a credential. */
  const deleteTwoFactor = (payload: unknown, bearer = token) =>
    server.app.inject({
      method: 'DELETE',
      url: server.url('/auth/2fa'),
      headers: auth(bearer),
      payload: payload as object,
    });

  /** Enroll and return the secret the authenticator app would have imported. */
  async function enroll(bearer = token): Promise<string> {
    const response = await server.post('/auth/2fa/enroll', undefined, auth(bearer));
    expect(response.statusCode).toBe(200);
    return response.json().secret as string;
  }

  /** Enroll, confirm with a live code, and hand back the recovery sheet. */
  async function activate(bearer = token): Promise<{ secret: string; recoveryCodes: string[] }> {
    const secret = await enroll(bearer);
    const response = await server.post(
      '/auth/2fa/activate',
      { code: generateTotp(secret, Date.now()) },
      auth(bearer),
    );
    expect(response.statusCode).toBe(200);
    return { secret, recoveryCodes: response.json().recovery_codes as string[] };
  }

  /** An account with no password at all — how SSO provisioning leaves one. */
  async function ssoOnlyAccount(): Promise<{ accountId: string; bearer: string }> {
    const account = await owner.account.create({
      data: { email: `sso-only-${fx.a.licenseId}@example.test`, name: 'Sso Only' },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.a.licenseId, agentId: account.id, role: 'agent' },
    });
    return { accountId: account.id, bearer: await session(fx.a, account.id) };
  }

  /** Turn `require_two_factor` on for a license, seeding the brand it hangs off. */
  async function requireTwoFactor(tenant: TenantFixture): Promise<void> {
    const brandId = await seedDefaultBrand(owner, tenant.licenseId);
    await owner.securitySettings.create({
      data: { licenseId: tenant.licenseId, brandId, requireTwoFactor: true },
    });
  }

  // =========================================================================
  // Enrollment: a half-finished attempt must never become a lock
  // =========================================================================

  describe('POST /auth/2fa/enroll', () => {
    it('hands over a secret and an otpauth URI without enabling anything', async () => {
      const response = await server.post('/auth/2fa/enroll', undefined, auth());

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(body.issuer).toBe('Nexa');
      expect(body.account_name).toBe(fx.a.ownerEmail);
      // The URI's parameters are pinned to what verification computes; an app
      // importing a mismatched one produces plausible codes that never match.
      expect(body.otpauth_uri).toContain(`secret=${body.secret}`);
      expect(body.otpauth_uri).toContain('algorithm=SHA1');
      expect(body.otpauth_uri).toContain('digits=6');
      expect(body.otpauth_uri).toContain('period=30');
      // The response is a credential; a shared cache holding it is a leak.
      expect(response.headers['cache-control']).toBe('no-store');

      const row = await owner.accountTwoFactor.findUnique({
        where: { accountId: fx.a.ownerAccountId },
      });
      expect(row?.activatedAt).toBeNull();
      const membership = await owner.agentMembership.findUnique({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId },
        },
      });
      expect(membership?.twoFactorEnabled).toBe(false);
    });

    it('replaces a pending secret rather than refusing, so an abandoned attempt is not a lock', async () => {
      const abandoned = await enroll();
      const fresh = await enroll();
      expect(fresh).not.toBe(abandoned);

      // The point of the property: the *new* secret is what works, and the
      // abandoned one is dead. A design that kept the first would leave anybody
      // who lost the phone mid-enrollment unable to finish or to start over.
      const withOldSecret = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(abandoned, Date.now()) },
        auth(),
      );
      expect(withOldSecret.statusCode).toBe(401);

      const withNewSecret = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(fresh, Date.now()) },
        auth(),
      );
      expect(withNewSecret.statusCode).toBe(200);
    });

    it('refuses to replace a live factor, which is what a stolen session would do', async () => {
      const { secret } = await activate();

      const response = await server.post('/auth/2fa/enroll', undefined, auth());
      expect(response.statusCode).toBe(409);
      expect(response.json().error.type).toBe('two_factor_already_enabled');

      // The victim's own authenticator still works — nothing was swapped.
      const stored = await owner.accountTwoFactor.findUnique({
        where: { accountId: fx.a.ownerAccountId },
      });
      expect(stored?.secret).toBe(secret);
      expect(stored?.activatedAt).not.toBeNull();
    });

    it('is closed to a session without the account scope', async () => {
      const readOnly = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--access:ro'],
      });
      const response = await server.post('/auth/2fa/enroll', undefined, auth(readOnly));
      expect(response.statusCode).toBe(403);
    });

    it('is closed to an anonymous caller', async () => {
      const response = await server.post('/auth/2fa/enroll');
      expect(response.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // Activation
  // =========================================================================

  describe('POST /auth/2fa/activate', () => {
    it('refuses a wrong code and leaves the enrollment pending', async () => {
      await enroll();

      const response = await server.post('/auth/2fa/activate', { code: '000000' }, auth());
      expect(response.statusCode).toBe(401);
      expect(response.json().error.type).toBe('authentication');

      const row = await owner.accountTwoFactor.findUnique({
        where: { accountId: fx.a.ownerAccountId },
      });
      expect(row?.activatedAt).toBeNull();
    });

    it('refuses when nothing is enrolled to confirm', async () => {
      const response = await server.post('/auth/2fa/activate', { code: '000000' }, auth());
      expect(response.statusCode).toBe(401);
      expect(response.json().error.type).toBe('two_factor_required');
    });

    it('enables the factor, returns ten codes, and flags every membership', async () => {
      // A second workspace for the same person: the flag is per membership but
      // the fact is per account, so both rows must move.
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.a.ownerAccountId, role: 'agent' },
      });

      const secret = await enroll();
      // Pinned rather than read back from `Date.now()` afterwards: the code is
      // generated *for* this step, so the floor the server records is knowable
      // even if the thirty-second boundary passes mid-request.
      const at = Date.now();
      const response = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, at) },
        auth(),
      );
      expect(response.statusCode).toBe(200);
      const recoveryCodes = response.json().recovery_codes as string[];

      expect(recoveryCodes).toHaveLength(10);
      expect(new Set(recoveryCodes).size).toBe(10);
      for (const code of recoveryCodes) expect(code).toMatch(DISPLAY_RE);

      const row = await owner.accountTwoFactor.findUnique({
        where: { accountId: fx.a.ownerAccountId },
      });
      expect(row?.activatedAt).not.toBeNull();
      // The code just typed is spent: its step becomes the replay floor, so it
      // cannot be turned round into a session while it is still arithmetically
      // valid.
      expect(row?.lastUsedStep).toBe(BigInt(totpStep(at)));

      const memberships = await owner.agentMembership.findMany({
        where: { agentId: fx.a.ownerAccountId },
        select: { twoFactorEnabled: true },
      });
      expect(memberships).toHaveLength(2);
      expect(memberships.every((m) => m.twoFactorEnabled)).toBe(true);
    });

    it('stores only hashes — no recovery code is in the table in the clear', async () => {
      const { recoveryCodes } = await activate();

      const stored = await owner.twoFactorRecoveryCode.findMany({
        where: { accountId: fx.a.ownerAccountId },
      });
      expect(stored).toHaveLength(10);
      const serialised = JSON.stringify(stored);
      for (const code of recoveryCodes) {
        expect(serialised).not.toContain(code);
        expect(serialised).not.toContain(code.replace('-', ''));
      }
    });

    it('shows the codes in that one response and in no other', async () => {
      const { recoveryCodes } = await activate();

      // `/auth/me` reports the count, never the sheet.
      const me = await server.get('/auth/me', auth());
      expect(me.statusCode).toBe(200);
      expect(me.json().two_factor).toEqual({
        enabled: true,
        pending: false,
        recovery_codes_remaining: 10,
      });
      for (const code of recoveryCodes) expect(me.body).not.toContain(code);
    });

    it('refuses a second activation', async () => {
      const { secret } = await activate();

      const response = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()) },
        auth(),
      );
      expect(response.statusCode).toBe(409);
      expect(response.json().error.type).toBe('two_factor_already_enabled');

      // And it did not quietly mint a second sheet, which would have killed the
      // one already handed over.
      expect(
        await owner.twoFactorRecoveryCode.count({ where: { accountId: fx.a.ownerAccountId } }),
      ).toBe(10);
    });
  });

  // =========================================================================
  // Removal: the step a stolen session cannot take
  // =========================================================================

  describe('DELETE /auth/2fa', () => {
    it('refuses a session that offers no password', async () => {
      await activate();

      const response = await deleteTwoFactor({});
      expect(response.statusCode).toBe(400);
      expect(response.json().error.type).toBe('validation');

      expect(
        await owner.accountTwoFactor.findUnique({ where: { accountId: fx.a.ownerAccountId } }),
      ).not.toBeNull();
    });

    it('refuses a wrong password', async () => {
      await activate();

      const response = await deleteTwoFactor({ password: 'not-the-password' });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.type).toBe('authentication');

      expect(
        await owner.accountTwoFactor.findUnique({ where: { accountId: fx.a.ownerAccountId } }),
      ).not.toBeNull();
    });

    it('will not accept the second factor itself in place of the password', async () => {
      // The phone is one of the things stolen along with a laptop, so a code
      // cannot authorise removing the protection the code provides.
      const { secret } = await activate();

      const response = await deleteTwoFactor({ code: generateTotp(secret, Date.now()) });
      expect(response.statusCode).toBe(400);
      expect(
        await owner.accountTwoFactor.findUnique({ where: { accountId: fx.a.ownerAccountId } }),
      ).not.toBeNull();
    });

    it('removes the factor, the whole recovery sheet and every membership flag', async () => {
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.a.ownerAccountId, role: 'agent' },
      });
      await activate();

      const response = await deleteTwoFactor({ password: TEST_PASSWORD });
      expect(response.statusCode).toBe(204);

      expect(
        await owner.accountTwoFactor.findUnique({ where: { accountId: fx.a.ownerAccountId } }),
      ).toBeNull();
      // Not tidying up: the codes' foreign key is to `accounts`, so nothing
      // would have cascaded them away, and each one is a standalone factor.
      expect(
        await owner.twoFactorRecoveryCode.count({ where: { accountId: fx.a.ownerAccountId } }),
      ).toBe(0);
      const memberships = await owner.agentMembership.findMany({
        where: { agentId: fx.a.ownerAccountId },
        select: { twoFactorEnabled: true },
      });
      expect(memberships).toHaveLength(2);
      expect(memberships.some((m) => m.twoFactorEnabled)).toBe(false);
    });

    it('answers 404 when there is nothing to remove', async () => {
      const response = await deleteTwoFactor({ password: TEST_PASSWORD });
      expect(response.statusCode).toBe(404);
    });

    it('is refused while ANY of the account’s workspaces requires two-factor', async () => {
      // The policy is on workspace B; the session is in workspace A. An account
      // is global, so reading only the signed-in workspace's policy would let a
      // member of a strict workspace escape it by signing in to a lax one.
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.a.ownerAccountId, role: 'agent' },
      });
      await requireTwoFactor(fx.b);
      await activate();

      const response = await deleteTwoFactor({ password: TEST_PASSWORD });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.type).toBe('not_allowed');

      const organization = await owner.organization.findUnique({
        where: { id: fx.b.organizationId },
        select: { name: true },
      });
      // The refusal names the workspace, so nobody has to guess which of theirs
      // is asking.
      expect(response.json().error.details.workspaces).toEqual([organization?.name]);

      expect(
        await owner.accountTwoFactor.findUnique({ where: { accountId: fx.a.ownerAccountId } }),
      ).not.toBeNull();
    });

    it('lets a suspended membership go — a workspace nobody can enter sets no policy', async () => {
      await owner.agentMembership.create({
        data: {
          licenseId: fx.b.licenseId,
          agentId: fx.a.ownerAccountId,
          role: 'agent',
          suspended: true,
        },
      });
      await requireTwoFactor(fx.b);
      await activate();

      expect((await deleteTwoFactor({ password: TEST_PASSWORD })).statusCode).toBe(204);
    });

    it('lets an account with no password prove itself with a code instead', async () => {
      // SSO provisioning leaves `password_hash` null. Demanding a password
      // would leave such an account able to switch two-factor on and never able
      // to switch it off.
      const { accountId, bearer } = await ssoOnlyAccount();
      const secret = await enroll(bearer);
      const at = Date.now();
      expect(
        (await server.post('/auth/2fa/activate', { code: generateTotp(secret, at) }, auth(bearer)))
          .statusCode,
      ).toBe(200);

      const withoutAnything = await deleteTwoFactor({}, bearer);
      expect(withoutAnything.statusCode).toBe(401);
      expect(withoutAnything.json().error.type).toBe('two_factor_required');

      const wrongCode = await deleteTwoFactor({ code: '000000' }, bearer);
      expect(wrongCode.statusCode).toBe(401);

      // Measured, not assumed: the code that activated the factor is spent, and
      // presenting it again inside its own thirty seconds is refused. That is
      // the replay floor doing its job end to end — the next step's code, which
      // an authenticator app shows a moment later, is what works.
      const replayed = await deleteTwoFactor({ code: generateTotp(secret, at) }, bearer);
      expect(replayed.statusCode).toBe(401);

      const response = await deleteTwoFactor(
        { code: generateTotpForStep(secret, totpStep(at) + 1) },
        bearer,
      );
      expect(response.statusCode).toBe(204);
      expect(await owner.accountTwoFactor.findUnique({ where: { accountId } })).toBeNull();
    });

    it('spends a recovery code when that is all a passwordless account has left', async () => {
      // The authenticator is gone — which is the situation the sheet exists for
      // — and this account has no password to fall back on.
      const { accountId, bearer } = await ssoOnlyAccount();
      const secret = await enroll(bearer);
      const activated = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()) },
        auth(bearer),
      );
      expect(activated.statusCode).toBe(200);
      const codes = activated.json().recovery_codes as string[];

      const response = await deleteTwoFactor({ code: codes[0] }, bearer);
      expect(response.statusCode).toBe(204);
      expect(await owner.accountTwoFactor.findUnique({ where: { accountId } })).toBeNull();
      expect(await owner.twoFactorRecoveryCode.count({ where: { accountId } })).toBe(0);
    });

    it('touches nobody else’s factor', async () => {
      const colleague = await session(fx.a, fx.a.agentAccountId);
      await activate(colleague);
      await activate();

      expect((await deleteTwoFactor({ password: TEST_PASSWORD })).statusCode).toBe(204);

      const theirs = await owner.accountTwoFactor.findUnique({
        where: { accountId: fx.a.agentAccountId },
      });
      expect(theirs?.activatedAt).not.toBeNull();
      expect(
        await owner.twoFactorRecoveryCode.count({ where: { accountId: fx.a.agentAccountId } }),
      ).toBe(10);
    });
  });

  // =========================================================================
  // Regenerating the sheet
  // =========================================================================

  describe('POST /auth/2fa/recovery-codes', () => {
    it('requires the password, like removal — a sheet is ten standalone factors', async () => {
      await activate();

      const response = await server.post('/auth/2fa/recovery-codes', {}, auth());
      expect(response.statusCode).toBe(400);

      const wrong = await server.post(
        '/auth/2fa/recovery-codes',
        { password: 'not-the-password' },
        auth(),
      );
      expect(wrong.statusCode).toBe(401);
    });

    it('refuses when two-factor is not active', async () => {
      const response = await server.post(
        '/auth/2fa/recovery-codes',
        { password: TEST_PASSWORD },
        auth(),
      );
      expect(response.statusCode).toBe(401);
      expect(response.json().error.type).toBe('two_factor_required');

      // Not even a *pending* enrollment earns a sheet: the codes would be usable
      // the instant it was activated by whoever is holding the session.
      await enroll();
      const pending = await server.post(
        '/auth/2fa/recovery-codes',
        { password: TEST_PASSWORD },
        auth(),
      );
      expect(pending.statusCode).toBe(401);
    });

    it('replaces the old sheet whole, unused codes included', async () => {
      const { recoveryCodes: original } = await activate();

      const response = await server.post(
        '/auth/2fa/recovery-codes',
        { password: TEST_PASSWORD },
        auth(),
      );
      expect(response.statusCode).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');

      const fresh = response.json().recovery_codes as string[];
      expect(fresh).toHaveLength(10);
      expect(response.json().recovery_codes_remaining).toBe(10);
      expect(fresh.filter((code) => original.includes(code))).toEqual([]);

      // Exactly ten rows, so nothing from the old sheet survived alongside.
      expect(
        await owner.twoFactorRecoveryCode.count({ where: { accountId: fx.a.ownerAccountId } }),
      ).toBe(10);
      const stored = JSON.stringify(
        await owner.twoFactorRecoveryCode.findMany({
          where: { accountId: fx.a.ownerAccountId },
        }),
      );
      for (const code of original) expect(stored).not.toContain(code.replace('-', ''));
    });
  });

  // =========================================================================
  // The trail
  // =========================================================================

  describe('audit log', () => {
    it('records every step, naming the account and never a credential', async () => {
      const { secret, recoveryCodes } = await activate();
      expect(
        (await server.post('/auth/2fa/recovery-codes', { password: TEST_PASSWORD }, auth()))
          .statusCode,
      ).toBe(200);
      expect((await deleteTwoFactor({ password: TEST_PASSWORD })).statusCode).toBe(204);

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: { startsWith: 'security.two_factor' } },
        orderBy: { createdAt: 'asc' },
      });

      expect(entries.map((e) => e.action)).toEqual([
        'security.two_factor_enrollment_started',
        'security.two_factor_enabled',
        'security.two_factor_recovery_codes_regenerated',
        'security.two_factor_disabled',
      ]);
      for (const entry of entries) {
        expect(entry.actorId).toBe(fx.a.ownerAccountId);
        expect(entry.target).toBe(`account:${fx.a.ownerAccountId}`);
      }

      // An audit log is read by people who are not its subject and is designed
      // never to be deleted, so a secret or a working code in one would be a
      // credential nobody can take back.
      const serialised = JSON.stringify(entries, (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
      expect(serialised).not.toContain(secret);
      for (const code of recoveryCodes) {
        expect(serialised).not.toContain(code);
        expect(serialised).not.toContain(code.replace('-', ''));
      }
    });
  });

  // =========================================================================
  // What the profile says
  // =========================================================================

  describe('GET /auth/me', () => {
    it('reports the three states the settings screen has to tell apart', async () => {
      const off = await server.get('/auth/me', auth());
      expect(off.json().two_factor).toEqual({
        enabled: false,
        pending: false,
        recovery_codes_remaining: 0,
      });

      await enroll();
      const pending = await server.get('/auth/me', auth());
      expect(pending.json().two_factor).toEqual({
        enabled: false,
        pending: true,
        recovery_codes_remaining: 0,
      });

      const secret = (
        await owner.accountTwoFactor.findUnique({ where: { accountId: fx.a.ownerAccountId } })
      )?.secret;
      const activated = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret ?? '', Date.now()) },
        auth(),
      );
      expect(activated.statusCode).toBe(200);

      const on = await server.get('/auth/me', auth());
      expect(on.json().two_factor).toEqual({
        enabled: true,
        pending: false,
        recovery_codes_remaining: 10,
      });
    });

    it('never carries the secret', async () => {
      const secret = await enroll();
      const me = await server.get('/auth/me', auth());
      expect(me.body).not.toContain(secret);
    });
  });

  // =========================================================================
  // The role that actually staffs the inbox (S11-2FA-j)
  // =========================================================================

  /**
   * Every test above drives a *personal access token*, and `scopesWithinRole`
   * deliberately leaves those alone (SEC-2, tm 146) — so not one of them could
   * see the hole this block covers.
   *
   * A session is capped by the role its holder has now, and the ceiling is
   * `defaultScopesForRole`. `DEFAULT_AGENT_SCOPES` carried `accounts--my:ro`
   * and not the write half, while all four enrollment endpoints ask for
   * `accounts--my:rw` — so the one role most of a workspace holds could not set
   * up its own second factor from inside the product. Paired with S11-2FA-e
   * that closes into a loop: `require_two_factor` refuses the sign-in of a
   * member who has not enrolled, and enrollment refuses the member.
   *
   * These tests go through the real sign-in rather than `grantToken`, because
   * the defect lives entirely in the difference between the two.
   */
  describe('a member whose role is agent (S11-2FA-j)', () => {
    /** The real sign-in: authorize with PKCE, then exchange the code. */
    async function signIn(email: string, code?: string): Promise<string> {
      const verifier = generateToken(48).slice(0, 64);
      const authorized = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(verifier),
        email,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
        ...(code === undefined ? {} : { code }),
      });
      expect(authorized.statusCode).toBe(200);

      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: authorized.json().code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(granted.statusCode).toBe(200);
      return granted.json().access_token as string;
    }

    it('carries the scope its own second factor sits behind', async () => {
      const bearer = await signIn(fx.a.agentEmail);
      const me = await server.get('/auth/me', auth(bearer));
      expect(me.statusCode).toBe(200);
      expect((me.json() as { scopes: string[] }).scopes).toContain('accounts--my:rw');
    });

    it('enrolls and activates from its own session', async () => {
      const bearer = await signIn(fx.a.agentEmail);

      const enrolled = await server.post('/auth/2fa/enroll', undefined, auth(bearer));
      expect(enrolled.statusCode).toBe(200);
      const secret = enrolled.json().secret as string;

      const activated = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()) },
        auth(bearer),
      );
      expect(activated.statusCode).toBe(200);
      expect(activated.json().recovery_codes as string[]).toHaveLength(10);
    });

    it('reads its own two-factor state back from the profile', async () => {
      const bearer = await signIn(fx.a.agentEmail);
      expect((await server.get('/auth/me', auth(bearer))).json().two_factor).toEqual({
        enabled: false,
        pending: false,
        recovery_codes_remaining: 0,
      });

      await server.post('/auth/2fa/enroll', undefined, auth(bearer));
      expect((await server.get('/auth/me', auth(bearer))).json().two_factor).toEqual({
        enabled: false,
        pending: true,
        recovery_codes_remaining: 0,
      });
    });

    it('signs in to a workspace that requires a second factor once it holds one', async () => {
      // Enroll, then switch the policy on — the order the console imposes,
      // since S11-2FA-h counts the members who have not enrolled before it lets
      // an admin turn it on.
      const bearer = await signIn(fx.a.agentEmail);
      const secret = (await server.post('/auth/2fa/enroll', undefined, auth(bearer))).json()
        .secret as string;
      const activated = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()) },
        auth(bearer),
      );
      expect(activated.statusCode).toBe(200);

      await requireTwoFactor(fx.a);

      // The policy is live: the sign-in that worked a moment ago is refused
      // without a code, so the session below is one the gate let past rather
      // than one it never looked at.
      const refused = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: fx.a.agentEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(refused.statusCode).toBe(401);
      expect(refused.json().error.type).toBe('two_factor_required');

      // `Date.now()`'s own step was just spent by activation; +1 is inside the
      // accepted drift window.
      const session = await signIn(
        fx.a.agentEmail,
        generateTotpForStep(secret, totpStep(Date.now()) + 1),
      );
      expect((await server.get('/auth/me', auth(session))).statusCode).toBe(200);
    });

    it('gains nothing but its own account — the workspace surfaces stay shut', async () => {
      const bearer = await signIn(fx.a.agentEmail);

      // `accounts--my:rw` widens along `:rw → :ro` only, never along
      // `--my → --all`, so nothing that reads or writes somebody *else* moved.
      const settings = await server.patch(
        '/settings/security',
        { ip_allowlist_enforced: false },
        auth(bearer),
      );
      expect(settings.statusCode).toBe(403);

      const demote = await server.put(
        `/agents/${fx.a.ownerAccountId}/role`,
        { role: 'agent' },
        auth(bearer),
      );
      expect(demote.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // The door out of the policy's own dead end (S11-2FA-k)
  // =========================================================================

  /**
   * S11-2FA-j opened enrollment to the `agent` role. What it could not open was
   * the case that has no role in it at all: a member holding **no session**, no
   * factor, whose only membership is in a workspace with `require_two_factor`.
   * `/auth/authorize` refuses them (correctly — that is S11-2FA-e), all four
   * enrollment endpoints want a session, and the only way to a session is
   * through the factor they do not have. An owner is exactly as stuck as an
   * agent; the previous version of this block pinned that as a known limit.
   *
   * The way out is a credential minted *with* the refusal: it opens the two
   * enrollment endpoints and nothing else. So the tests that matter are not
   * "can they enrol" — that is one line — but the ways this could quietly
   * become the hole S11-2FA-e closed:
   *
   *   a ticket handed to somebody who already holds a factor (the code prompt,
   *     skipped);
   *   a ticket that reaches a third endpoint (a session by another name);
   *   a ticket that outlives the enrollment it was minted for;
   *   a ticket that keeps working after the membership behind it stops.
   */
  describe('the enrollment ticket (S11-2FA-k)', () => {
    interface Refusal {
      statusCode: number;
      details: Record<string, unknown>;
      cacheControl: string | undefined;
      ticket: string;
    }

    /** Sign in far enough to be refused, and read the refusal. */
    async function refusedSignIn(email = fx.a.agentEmail): Promise<Refusal> {
      const response = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      const details = (response.json().error.details ?? {}) as Record<string, unknown>;
      return {
        statusCode: response.statusCode,
        details,
        cacheControl: response.headers['cache-control'] as string | undefined,
        ticket: details['enrollment_ticket'] as string,
      };
    }

    /** The full sign-in, for proving the ticket's work actually opened the door. */
    async function signIn(email: string, code?: string): Promise<number> {
      const verifier = generateToken(48).slice(0, 64);
      const authorized = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(verifier),
        email,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
        ...(code === undefined ? {} : { code }),
      });
      if (authorized.statusCode !== 200) return authorized.statusCode;

      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: authorized.json().code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(granted.statusCode).toBe(200);
      const me = await server.get('/auth/me', auth(granted.json().access_token as string));
      return me.statusCode;
    }

    it('walks the whole way out: refused, enrolled, activated, signed in', async () => {
      await requireTwoFactor(fx.a);

      const refusal = await refusedSignIn();
      expect(refusal.statusCode).toBe(401);
      expect(refusal.details['enrollment_required']).toBe(true);
      expect(refusal.ticket).toEqual(expect.any(String));
      expect(refusal.details['enrollment_ticket_expires_in']).toBe(600);
      // There is a bearer credential in that body.
      expect(refusal.cacheControl).toBe('no-store');

      const enrolled = await server.post('/auth/2fa/enroll', undefined, auth(refusal.ticket));
      expect(enrolled.statusCode).toBe(200);
      const secret = enrolled.json().secret as string;

      const activated = await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()) },
        auth(refusal.ticket),
      );
      expect(activated.statusCode).toBe(200);
      expect(activated.json().recovery_codes as string[]).toHaveLength(10);

      // The point of the whole subtask: the same password that was refused a
      // moment ago now opens the workspace, because the factor exists.
      // `Date.now()`'s own step was just spent by activation; +1 is inside the
      // accepted drift window.
      const code = generateTotpForStep(secret, totpStep(Date.now()) + 1);
      expect(await signIn(fx.a.agentEmail, code)).toBe(200);
    });

    it('is role-independent — an owner in the same position gets one too', async () => {
      // The defect S11-2FA-j fixed was scope-shaped and stopped at `agent`.
      // This one is not: it is about holding no session at all, so the account
      // with every scope in the product is in it as deeply as the account with
      // the fewest. A ticket for the owner is what proves the two are different
      // defects rather than two readings of one.
      await requireTwoFactor(fx.a);

      const refusal = await refusedSignIn(fx.a.ownerEmail);
      expect(refusal.statusCode).toBe(401);
      expect(refusal.ticket).toEqual(expect.any(String));
      expect(
        (await server.post('/auth/2fa/enroll', undefined, auth(refusal.ticket))).statusCode,
      ).toBe(200);
    });

    it('reaches the two enrollment endpoints and nothing else', async () => {
      // The trap this subtask names: the ticket is the easiest way to reopen
      // the hole S11-2FA-e closed, and it would reopen it by being *slightly*
      // too wide rather than obviously too wide. So the claim is not "it is
      // narrow" but "here is every neighbouring door, and each one is shut".
      //
      // 404 rather than 403 throughout, and that is the product's own answer,
      // not a compromise: `plugins/auth.ts` refuses a principal kind a route
      // did not name with `not_found`, so the surface cannot be mapped by
      // reading which refusals differ.
      await requireTwoFactor(fx.a);
      const { ticket } = await refusedSignIn();
      const headers = auth(ticket);

      // The account's own profile — the endpoint every other own-account
      // credential opens, and the one carrying memberships, scopes and
      // notification preferences.
      expect((await server.get('/auth/me', headers)).statusCode).toBe(404);
      // The other two two-factor endpoints. These are the operations a stolen
      // credential wants — remove the factor, print a fresh recovery sheet —
      // and both would be reachable if `principals` had been widened by family
      // rather than by endpoint.
      expect((await deleteTwoFactor({ password: TEST_PASSWORD }, ticket)).statusCode).toBe(404);
      expect(
        (await server.post('/auth/2fa/recovery-codes', { password: TEST_PASSWORD }, headers))
          .statusCode,
      ).toBe(404);
      // A personal access token would be a session that outlives the ticket by
      // a year — the single most valuable thing to mint from here.
      expect(
        (await server.post('/auth/personal-access-tokens', { name: 'from a ticket' }, headers))
          .statusCode,
      ).toBe(404);
      // And the product itself.
      expect((await server.get('/chats', headers)).statusCode).toBe(404);
      expect((await server.get('/agents', headers)).statusCode).toBe(404);
      expect(
        (await server.patch('/settings/security', { require_two_factor: false }, headers))
          .statusCode,
      ).toBe(404);
    });

    it('is never minted for an account that already holds a factor', async () => {
      // The first branch of `enforceSecondFactor`: a live factor means a code
      // is demanded whatever the policy says. If a ticket appeared here it
      // would be a way past the code prompt for anybody holding the password —
      // enrol a second authenticator, sign in with it — which is precisely the
      // control being enforced.
      const agentSession = await session(fx.a, fx.a.agentAccountId);
      const secret = await enroll(agentSession);
      expect(
        (
          await server.post(
            '/auth/2fa/activate',
            { code: generateTotp(secret, Date.now()) },
            auth(agentSession),
          )
        ).statusCode,
      ).toBe(200);
      await requireTwoFactor(fx.a);

      const refusal = await refusedSignIn();
      expect(refusal.statusCode).toBe(401);
      // The code prompt, which carries no details at all.
      expect(refusal.details).toEqual({});
      expect(refusal.ticket).toBeUndefined();

      // And a wrong code does not produce one either — the refusal changes
      // type, and a client retrying wrong codes must not collect credentials.
      const wrongCode = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: fx.a.agentEmail,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
        code: '000000',
      });
      expect(wrongCode.statusCode).toBe(401);
      expect(wrongCode.body).not.toContain('enrollment_ticket');
    });

    it('is not minted at all when the workspace does not require a factor', async () => {
      // No policy, no factor: the untouched case S11-2FA-e was careful to leave
      // alone. A ticket here would mean every ordinary sign-in in the product
      // mints a second credential nobody asked for.
      expect(await signIn(fx.a.agentEmail)).toBe(200);
      const tickets = await owner.apiToken.findMany({ where: { kind: 'enrollment' } });
      expect(tickets).toHaveLength(0);
    });

    it('is spent by the activation it exists for', async () => {
      await requireTwoFactor(fx.a);
      const { ticket } = await refusedSignIn();

      const secret = (await server.post('/auth/2fa/enroll', undefined, auth(ticket))).json()
        .secret as string;
      expect(
        (
          await server.post(
            '/auth/2fa/activate',
            { code: generateTotp(secret, Date.now()) },
            auth(ticket),
          )
        ).statusCode,
      ).toBe(200);

      // Done its one job. Anything still holding it — a browser tab, a log, a
      // proxy — is holding nothing.
      expect((await server.post('/auth/2fa/enroll', undefined, auth(ticket))).statusCode).toBe(401);
    });

    it('survives a wrong activation code, so a typo is not a locked door', async () => {
      // The other side of "single use": spending the ticket on a *failed*
      // activation would send somebody back to a sign-in that refuses them, for
      // mistyping six digits. It is spent by success only.
      await requireTwoFactor(fx.a);
      const { ticket } = await refusedSignIn();

      const secret = (await server.post('/auth/2fa/enroll', undefined, auth(ticket))).json()
        .secret as string;
      expect(
        (await server.post('/auth/2fa/activate', { code: '000000' }, auth(ticket))).statusCode,
      ).toBe(401);

      expect(
        (
          await server.post(
            '/auth/2fa/activate',
            { code: generateTotp(secret, Date.now()) },
            auth(ticket),
          )
        ).statusCode,
      ).toBe(200);
    });

    it('leaves at most one live ticket per member, however many times they try', async () => {
      // Every refused attempt mints one. Without replacing the previous, a
      // handful of retries leaves a handful of live credentials, and the set
      // outlives any one of them — the TTL stops meaning what it says.
      await requireTwoFactor(fx.a);
      const first = await refusedSignIn();
      const second = await refusedSignIn();
      expect(second.ticket).not.toBe(first.ticket);

      expect(
        (await server.post('/auth/2fa/enroll', undefined, auth(first.ticket))).statusCode,
      ).toBe(401);
      expect(
        (await server.post('/auth/2fa/enroll', undefined, auth(second.ticket))).statusCode,
      ).toBe(200);

      const live = await owner.apiToken.findMany({
        where: { kind: 'enrollment', ownerId: fx.a.agentAccountId, revokedAt: null },
      });
      expect(live).toHaveLength(1);
    });

    it('stops working the moment the membership behind it does', async () => {
      // The reason the ticket is a row in `api_tokens` rather than a signed
      // blob: resolution reads the membership fresh on every request. An admin
      // who suspends somebody mid-enrollment has suspended them, not queued a
      // suspension for whenever the credential happens to expire.
      await requireTwoFactor(fx.a);
      const { ticket } = await refusedSignIn();
      expect((await server.post('/auth/2fa/enroll', undefined, auth(ticket))).statusCode).toBe(200);

      await owner.agentMembership.update({
        where: {
          licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
        },
        data: { suspended: true },
      });

      expect((await server.post('/auth/2fa/enroll', undefined, auth(ticket))).statusCode).toBe(401);
    });

    it('marks the enrollment it produced, and leaves an ordinary one unmarked', async () => {
      // A workspace that has just switched the policy on will see a run of
      // these, and that is expected; the same marker weeks later, on an account
      // that had a session all along, is not. Distinguishable is the whole ask.
      await requireTwoFactor(fx.a);
      const { ticket } = await refusedSignIn();
      const secret = (await server.post('/auth/2fa/enroll', undefined, auth(ticket))).json()
        .secret as string;
      await server.post(
        '/auth/2fa/activate',
        { code: generateTotp(secret, Date.now()) },
        auth(ticket),
      );

      const viaTicket = await owner.auditLogEntry.findMany({
        where: {
          licenseId: fx.a.licenseId,
          actorId: fx.a.agentAccountId,
          action: { in: ['security.two_factor_enrollment_started', 'security.two_factor_enabled'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(viaTicket.map((e) => e.action)).toEqual([
        'security.two_factor_enrollment_started',
        'security.two_factor_enabled',
      ]);
      for (const entry of viaTicket) {
        // `toMatchObject`, not `toEqual`: every entry's metadata also carries
        // the `request_id` the audit writer folds in (`sanitizeAuditMetadata`).
        expect(entry.metadata).toMatchObject({ via: 'enrollment_ticket' });
      }
      // The actor is the person, not the credential: an account's security
      // history has to read as one story whichever door it came through.
      expect(viaTicket[0]?.actorType).toBe('agent');

      // The ordinary path keeps no metadata at all — a key that is always there
      // is a key every query has to remember to ignore.
      await activate(await session(fx.a, fx.a.ownerAccountId));
      const viaSession = await owner.auditLogEntry.findMany({
        where: {
          licenseId: fx.a.licenseId,
          actorId: fx.a.ownerAccountId,
          action: 'security.two_factor_enabled',
        },
      });
      expect(viaSession).toHaveLength(1);
      expect(viaSession[0]?.metadata).not.toHaveProperty('via');
    });

    it('does not survive its own expiry', async () => {
      await requireTwoFactor(fx.a);
      const { ticket } = await refusedSignIn();

      await owner.apiToken.updateMany({
        where: { kind: 'enrollment', ownerId: fx.a.agentAccountId },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      expect((await server.post('/auth/2fa/enroll', undefined, auth(ticket))).statusCode).toBe(401);
    });

    it('is still no unauthenticated way in — the endpoints have not become public', async () => {
      await requireTwoFactor(fx.a);
      await refusedSignIn();

      expect((await server.post('/auth/2fa/enroll', undefined)).statusCode).toBe(401);
      expect((await server.post('/auth/2fa/activate', { code: '000000' })).statusCode).toBe(401);
    });
  });
});
