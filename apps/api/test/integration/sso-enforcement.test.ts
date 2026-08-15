/**
 * Requiring single sign-on, and getting back in when it breaks (S11-h).
 *
 * `sso.test.ts` covers configuring a connection and `sso-login.test.ts` covers
 * using one. This covers the switch that makes it the *only* way in — the point
 * at which a mistake stops being a broken feature and becomes a workspace
 * locked out of its own account.
 *
 * The two halves are tested together because they were designed together:
 *
 *   - **The door closes where a session is minted.** `/auth/authorize` refuses a
 *     correct password for an SSO-only workspace. `/auth/login` deliberately
 *     does not — it selects no workspace, and a caller can reach `/auth/authorize`
 *     without ever calling it — so it annotates instead, which is what lets a
 *     sign-in screen offer the right door rather than a password box that will
 *     be rejected.
 *   - **The owner keeps a key.** An enterprise whose identity provider stops
 *     answering has no support channel to appeal to, so the account that can
 *     undo the enforcement has to be able to sign in and undo it. That door is
 *     narrow (owners only) and loud (marked in the audit trail).
 *   - **And the switch refuses to leave nobody holding one** — the self-lockout
 *     guard, in the shape tm 80's IP allow-list established: a configuration
 *     that would exclude the people saving it is refused at the write, not
 *     discovered at the next sign-in.
 *   - **Enforcement is per license.** One workspace requiring SSO says nothing
 *     about another's password sign-in, including for a person who belongs to
 *     both.
 *
 * Rejections first: this is the front door.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';

/** Shaped like a published certificate; nothing here parses the bytes. */
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n';

describe('sso enforcement', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let ownerWriteToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorBody = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string; message: string; details?: Record<string, unknown> } })
      .error;

  interface WireMembership {
    license_id: string;
    role: string;
    sso_enforced_connection_id: string | null;
    password_login_available: boolean;
  }

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    // The enforcement switch is reached through `PATCH /settings/sso`, which is
    // gated on the `sso` entitlement (FR-MOD-11.5).
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    await clearRateLimits(server.app);
    ownerWriteToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
  });

  // --- Fixtures --------------------------------------------------------------

  /** A connection row, written straight to the database. */
  async function connect(
    overrides: Record<string, unknown> = {},
    tenant: TenantFixture = fx.a,
  ): Promise<string> {
    const row = await owner.ssoConnection.create({
      data: {
        licenseId: tenant.licenseId,
        name: 'Okta (corp)',
        idpEntityId: `https://idp.example.test/${tenant.organizationId}/metadata`,
        idpSsoUrl: 'https://idp.example.test/saml/sso',
        idpCertificatePem: PEM,
        enabled: true,
        enforced: true,
        ...overrides,
      },
      select: { id: true },
    });
    return row.id;
  }

  const login = (email: string, tenant: TenantFixture = fx.a) =>
    server.post('/auth/login', { email, password: tenant.password });

  const memberships = (res: { json: () => unknown }) =>
    (res.json() as { memberships: WireMembership[] }).memberships;

  const membershipFor = (res: { json: () => unknown }, tenant: TenantFixture) =>
    memberships(res).find((m) => m.license_id === tenant.licenseId.toString());

  /** The sign-in that actually mints a code — the call enforcement gates. */
  function authorize(email: string, tenant: TenantFixture = fx.a) {
    return server.post('/auth/authorize', {
      client_id: tenant.clientId,
      redirect_uri: tenant.redirectUri,
      code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
      email,
      password: tenant.password,
      license_id: tenant.licenseId.toString(),
    });
  }

  /** Audit entries of one action against a license, oldest first. */
  async function entries(action: string, licenseId = fx.a.licenseId) {
    return owner.auditLogEntry.findMany({
      where: { licenseId, action },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Strip the password from an account, the shape SSO-only provisioning leaves. */
  const clearPassword = (accountId: string) =>
    owner.account.update({ where: { id: accountId }, data: { passwordHash: null } });

  // =========================================================================
  // The door closes
  // =========================================================================

  describe('POST /auth/authorize', () => {
    it('refuses a correct password once SSO is required', async () => {
      const connectionId = await connect();

      const res = await authorize(fx.a.agentEmail);

      expect(res.statusCode).toBe(403);
      const error = errorBody(res);
      expect(error.type).toBe('not_allowed');
      // Named so a client that came straight here — a saved workspace, a deep
      // link — can still send the person somewhere. Withholding it protects
      // nothing from a caller who has already proved the password and the
      // membership.
      expect(error.details?.['sso_connection_id']).toBe(connectionId);
    });

    it('records the refusal in the workspace audit log, with its reason', async () => {
      await connect();
      await authorize(fx.a.agentEmail);

      const failures = await entries('auth.login_failed');
      expect(failures).toHaveLength(1);
      expect((failures[0]?.metadata as { reason?: string })?.reason).toBe('sso_enforced');
      // Attributed to the person, not to `system`: unlike a wrong password —
      // where the address typed is unverified and belongs to whoever typed it —
      // this account has been authenticated, and "who tried" is the whole value
      // of the entry.
      expect(failures[0]?.actorId).toBe(fx.a.agentAccountId);
      // And no session was minted on the way to refusing.
      expect(await owner.oauthAuthorizationCode.count()).toBe(0);
    });

    it('still refuses a member who is an admin', async () => {
      // The exemption is `owner`, not "senior enough". Enforcement is written by
      // `exactRole: 'owner'`, so the door out is held to the same rank as the
      // door in — an admin let through would be a way in for somebody who could
      // not fix the outage anyway.
      await connect();
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { role: 'admin' },
      });

      expect((await authorize(fx.a.agentEmail)).statusCode).toBe(403);
    });

    it('leaves a wrong password answering exactly as before', async () => {
      // Enforcement must not become an oracle: "that password is wrong" and
      // "that password is right but unusable here" are told apart only by
      // somebody who already knows the password.
      await connect();

      const res = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: fx.a.agentEmail,
        password: 'not-the-password',
        license_id: fx.a.licenseId.toString(),
      });

      expect(res.statusCode).toBe(401);
      expect(errorBody(res).type).toBe('authentication');
    });
  });

  describe('the pair, not the flag', () => {
    it('lets passwords through while the required connection is switched off', async () => {
      // Not a corrupt state — it is where a workspace lands when it disables a
      // federation whose IdP has stopped answering, and it is how the password
      // door reopens without anybody having to sign in first to turn
      // enforcement off.
      await connect({ enabled: false });

      expect((await authorize(fx.a.agentEmail)).statusCode).toBe(200);
      const listed = membershipFor(await login(fx.a.agentEmail), fx.a);
      expect(listed?.sso_enforced_connection_id).toBeNull();
      expect(listed?.password_login_available).toBe(true);
    });

    it('closes the door while any one of several connections requires it', async () => {
      await connect({ name: 'Okta (corp)', enforced: false });
      const required = await connect({
        name: 'Azure AD',
        idpEntityId: 'https://login.microsoftonline.test/metadata',
        enforced: true,
      });

      const res = await authorize(fx.a.agentEmail);
      expect(res.statusCode).toBe(403);
      expect(errorBody(res).details?.['sso_connection_id']).toBe(required);
    });
  });

  // =========================================================================
  // Break-glass
  // =========================================================================

  describe('the owner keeps a key', () => {
    it('signs the owner in with a password against an SSO-only workspace', async () => {
      await connect();

      const res = await authorize(fx.a.ownerEmail);

      expect(res.statusCode).toBe(200);
      expect((res.json() as { code: string }).code).toBeTruthy();
    });

    it('marks the break-glass sign-in in the audit trail', async () => {
      // The residual risk the owner exemption accepts — a phished owner password
      // is still a way in — is bounded by exactly this: it is loud, and a SIEM
      // export can alert on it.
      const connectionId = await connect();
      await authorize(fx.a.ownerEmail);

      const logins = await entries('auth.login');
      expect(logins).toHaveLength(1);
      expect(logins[0]?.metadata).toMatchObject({
        break_glass: true,
        sso_connection_id: connectionId,
      });
    });

    it('leaves an ordinary sign-in unmarked', async () => {
      // Absent, not `false`: a flag every future query would have to remember to
      // ignore is a flag that eventually gets forgotten in the wrong direction.
      await authorize(fx.a.ownerEmail);

      const logins = await entries('auth.login');
      expect(logins).toHaveLength(1);
      expect(logins[0]?.metadata).not.toHaveProperty('break_glass');
    });

    it('reports the door on the workspace listing, per membership', async () => {
      const connectionId = await connect();

      const asOwner = membershipFor(await login(fx.a.ownerEmail), fx.a);
      expect(asOwner?.sso_enforced_connection_id).toBe(connectionId);
      // Both facts, because they differ: the workspace requires SSO *and* this
      // person may still use a password. Deriving the second from the first plus
      // the role is the client-side copy of the rule this field exists to avoid.
      expect(asOwner?.password_login_available).toBe(true);

      const asAgent = membershipFor(await login(fx.a.agentEmail), fx.a);
      expect(asAgent?.sso_enforced_connection_id).toBe(connectionId);
      expect(asAgent?.password_login_available).toBe(false);
    });

    it('keeps the workspace in the list rather than hiding it', async () => {
      // Filtering it out would read to the person as "you have been removed",
      // and would leave them nothing to act on.
      await connect();
      expect(memberships(await login(fx.a.agentEmail))).toHaveLength(1);
    });
  });

  // =========================================================================
  // The self-lockout guard
  // =========================================================================

  describe('PATCH /settings/sso — the switch refuses to strand the workspace', () => {
    /**
     * Leave the license with an SSO-only owner — the shape a workspace has once
     * its owner first signs in through SAML, since `auth_provision_sso_account`
     * writes `password_hash` NULL. A license has exactly one owner
     * (`uq_license_single_owner`), so this removes the only key there is.
     */
    async function removeEveryPasswordOwner(): Promise<void> {
      await clearPassword(fx.a.ownerAccountId);
    }

    it('refuses to require SSO when no owner holds a password', async () => {
      const connectionId = await connect({ enforced: false });
      await removeEveryPasswordOwner();

      const res = await server.patch(
        `/settings/sso/${connectionId}`,
        { enforced: true },
        auth(ownerWriteToken),
      );

      expect(res.statusCode).toBe(400);
      expect(errorBody(res).type).toBe('validation');
      expect(errorBody(res).message).toContain('lock this workspace out');
      // And nothing was written: a refused guard must not leave the flag set.
      const row = await owner.ssoConnection.findUniqueOrThrow({ where: { id: connectionId } });
      expect(row.enforced).toBe(false);
    });

    it('does not count a suspended owner as a key', async () => {
      // Asserted against the resolver rather than the endpoint, because the
      // endpoint cannot reach this state: a suspended member's token stops
      // resolving, so they are refused at the door before the guard runs (and a
      // license has only the one owner to suspend). The clause exists so this
      // function and the sign-in path answer "can this person get in" the same
      // way — `auth_list_memberships` drops suspended members too — and pinning
      // it here is what keeps a later change to one from silently invalidating
      // the other.
      const hasKey = async () =>
        (
          await owner.$queryRaw<Array<{ has_key: boolean }>>`
            SELECT auth_has_break_glass_owner(${fx.a.licenseId}) AS has_key`
        )[0]?.has_key;

      expect(await hasKey()).toBe(true);
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId } },
        data: { suspended: true },
      });
      expect(await hasKey()).toBe(false);
    });

    it('accepts it once the owner holds a password again', async () => {
      const connectionId = await connect({ enforced: false });
      await removeEveryPasswordOwner();

      const patch = () =>
        server.patch(`/settings/sso/${connectionId}`, { enforced: true }, auth(ownerWriteToken));
      expect((await patch()).statusCode).toBe(400);

      // The fix the refusal names, and the proof it is the password — not the
      // role, the connection or the certificate — that the guard is reading.
      await owner.account.update({
        where: { id: fx.a.ownerAccountId },
        data: { passwordHash: 'scrypt$placeholder' },
      });

      const res = await patch();
      expect(res.statusCode).toBe(200);
      expect((res.json() as { enforced: boolean }).enforced).toBe(true);
    });

    it('guards the state after the write, not the fields in it', async () => {
      // `{enabled: true}` on an already-required connection closes the same door
      // as `{enforced: true}` on an already-live one. A guard reading only the
      // body would let this through.
      const connectionId = await connect({ enabled: false, enforced: true });
      await removeEveryPasswordOwner();

      const res = await server.patch(
        `/settings/sso/${connectionId}`,
        { enabled: true },
        auth(ownerWriteToken),
      );
      expect(res.statusCode).toBe(400);
    });

    it('guards a connection created with enforcement already on', async () => {
      await removeEveryPasswordOwner();

      const res = await server.post(
        '/settings/sso',
        {
          name: 'Okta (corp)',
          idp_entity_id: 'https://idp.example.test/new/metadata',
          idp_sso_url: 'https://idp.example.test/saml/sso',
          idp_certificate_pem: PEM,
          enabled: true,
          enforced: true,
        },
        auth(ownerWriteToken),
      );

      expect(res.statusCode).toBe(400);
      // Refused before the row exists, so nothing is left behind in a state the
      // caller was told they could not have.
      expect(await owner.ssoConnection.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('never blocks the way out', async () => {
      // Switching enforcement off, or switching the connection off, is the
      // recovery path — it must not be gated on the guard that protects turning
      // it on, or an outage would be unrecoverable by construction.
      const connectionId = await connect();
      await removeEveryPasswordOwner();

      const off = await server.patch(
        `/settings/sso/${connectionId}`,
        { enabled: false },
        auth(ownerWriteToken),
      );
      expect(off.statusCode).toBe(200);

      const unenforced = await server.patch(
        `/settings/sso/${connectionId}`,
        { enforced: false },
        auth(ownerWriteToken),
      );
      expect(unenforced.statusCode).toBe(200);
    });

    it('records the change as a security update naming the field', async () => {
      const connectionId = await connect({ enforced: false });

      await server.patch(
        `/settings/sso/${connectionId}`,
        { enforced: true },
        auth(ownerWriteToken),
      );

      const changes = await entries('settings.security_updated');
      const last = changes.at(-1);
      expect(last?.target).toBe(`sso_connection:${connectionId}`);
      expect(last?.metadata).toMatchObject({
        resource: 'sso_connection',
        operation: 'updated',
        fields: ['enforced'],
      });
    });

    it('stays owner-only', async () => {
      // The same `exactRole: 'owner'` gate the rest of this surface has: an
      // admin who could require SSO could lock every colleague out of the
      // product with one request.
      const connectionId = await connect({ enforced: false });
      const adminToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['access_rules:rw'],
      });
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId } },
        data: { role: 'admin' },
      });

      const res = await server.patch(
        `/settings/sso/${connectionId}`,
        { enforced: true },
        auth(adminToken),
      );
      expect(res.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // Cross-tenant
  // =========================================================================

  describe('one workspace does not close another one', () => {
    it('leaves B signing in with a password while A requires SSO', async () => {
      await connect({}, fx.a);

      expect((await authorize(fx.b.agentEmail, fx.b)).statusCode).toBe(200);
    });

    it('answers per membership for a person who belongs to both', async () => {
      // The realistic shape of the bug this guards: enforcement read as a
      // property of the *account* rather than of the license would lock this
      // person out of a workspace that never required anything.
      await connect({}, fx.a);
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: fx.a.agentAccountId, role: 'agent' },
      });

      const res = await server.post('/auth/login', {
        email: fx.a.agentEmail,
        password: TEST_PASSWORD,
      });
      expect(membershipFor(res, fx.a)?.password_login_available).toBe(false);
      expect(membershipFor(res, fx.b)?.password_login_available).toBe(true);

      expect((await authorize(fx.a.agentEmail, fx.a)).statusCode).toBe(403);
      const intoB = await server.post('/auth/authorize', {
        client_id: fx.b.clientId,
        redirect_uri: fx.b.redirectUri,
        code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
        email: fx.a.agentEmail,
        password: TEST_PASSWORD,
        license_id: fx.b.licenseId.toString(),
      });
      expect(intoB.statusCode).toBe(200);
    });

    it('counts break-glass owners in the license being changed, not next door', async () => {
      // B keeps a password-holding owner throughout. If the guard counted across
      // licenses, A would be allowed to strand itself on the strength of B's.
      const connectionId = await connect({ enforced: false }, fx.a);
      await clearPassword(fx.a.ownerAccountId);

      const res = await server.patch(
        `/settings/sso/${connectionId}`,
        { enforced: true },
        auth(ownerWriteToken),
      );
      expect(res.statusCode).toBe(400);
    });
  });
});
