/**
 * "My profile" (tm 327 · SiyahTuş analysis RL-06): the caller edits their own
 * name and the name visitors see (`PATCH /agents/me`), and changes their
 * password with the current one (`POST /auth/password`).
 *
 *   - the new name is what the team list and the profile read, and the trail
 *     says which fields changed;
 *   - a right current password changes it, ends every *other* session at its
 *     next request or renewal (RL-06-S1) and keeps this one;
 *   - a wrong one is refused and counts against the hourly budget;
 *   - a member an enforced identity provider signs in is refused, with why.
 *
 * The widget half (`public_name ?? name`) is `customer-chat.test.ts`'s
 * "agent identity" block.
 *
 * RL-06 is an analysis code, not an Ek A catalogue ID, so no title carries it
 * as a requirement tag (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const NEW_PASSWORD = 'a-brand-new-long-password';

type Headers = Record<string, string>;

interface Session {
  headers: Headers;
  refreshToken: string;
}

describe('my profile: names and password (RL-06 · tm 327)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

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
  });

  afterEach(async () => {
    // The change mails its notice beside the response; the next reset must
    // not truncate under it.
    await server.app.backgroundMail.settled();
  });

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });

  /** The real sign-in through the workspace's own client: authorize with PKCE, exchange the code. */
  async function signIn(t: TenantFixture, email: string, password = TEST_PASSWORD) {
    const verifier = generateToken(48).slice(0, 64);
    const authorized = await server.post('/auth/authorize', {
      client_id: t.clientId,
      redirect_uri: t.redirectUri,
      code_challenge: deriveCodeChallenge(verifier),
      email,
      password,
      license_id: t.licenseId.toString(),
    });
    if (authorized.statusCode !== 200) return null;
    const granted = await server.post('/auth/token', {
      grant_type: 'authorization_code',
      code: authorized.json().code,
      code_verifier: verifier,
      client_id: t.clientId,
      redirect_uri: t.redirectUri,
    });
    expect(granted.statusCode).toBe(200);
    const body = granted.json() as { access_token: string; refresh_token: string };
    return { headers: bearer(body.access_token), refreshToken: body.refresh_token };
  }

  async function session(t: TenantFixture, email: string): Promise<Session> {
    const signed = await signIn(t, email);
    expect(signed).not.toBeNull();
    return signed!;
  }

  function renew(t: TenantFixture, refreshToken: string) {
    return server.post('/auth/token', {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: t.clientId,
    });
  }

  function changePassword(headers: Headers, current: string, next: string) {
    return server.post(
      '/auth/password',
      { current_password: current, new_password: next },
      headers,
    );
  }

  async function auditActions(t: TenantFixture, action: string) {
    return owner.auditLogEntry.findMany({
      where: { licenseId: t.licenseId, action },
      select: { actorId: true, target: true, metadata: true },
    });
  }

  // ===========================================================================

  describe('PATCH /agents/me', () => {
    it('renames the caller everywhere the panel reads a name, and records which fields changed', async () => {
      const agent = await session(fx.a, fx.a.agentEmail);

      const saved = await server.patch(
        '/agents/me',
        { name: '  Deniz Yılmaz  ', public_name: 'Deniz' },
        agent.headers,
      );
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        id: fx.a.agentAccountId,
        name: 'Deniz Yılmaz',
        public_name: 'Deniz',
      });

      // The team list and the caller's own profile.
      const owners = await session(fx.a, fx.a.ownerEmail);
      const team = await server.get('/agents', owners.headers);
      const row = (
        team.json().items as Array<{ id: string; name: string; public_name: string }>
      ).find((item) => item.id === fx.a.agentAccountId);
      expect(row).toMatchObject({ name: 'Deniz Yılmaz', public_name: 'Deniz' });
      const me = await server.get('/auth/me', agent.headers);
      expect(me.json()).toMatchObject({ name: 'Deniz Yılmaz', public_name: 'Deniz' });

      const entries = await auditActions(fx.a, 'account.profile_updated');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: fx.a.agentAccountId,
        target: `account:${fx.a.agentAccountId}`,
        metadata: { fields: ['name', 'public_name'] },
      });
    });

    it('clears the visitor-facing name with null or an empty string', async () => {
      const agent = await session(fx.a, fx.a.agentEmail);
      await server.patch('/agents/me', { public_name: 'Deniz' }, agent.headers);

      const cleared = await server.patch('/agents/me', { public_name: '  ' }, agent.headers);
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json().public_name).toBeNull();

      await server.patch('/agents/me', { public_name: 'Deniz' }, agent.headers);
      const nulled = await server.patch('/agents/me', { public_name: null }, agent.headers);
      expect(nulled.json().public_name).toBeNull();
    });

    it('writes nothing to the trail for a save that changes nothing', async () => {
      const agent = await session(fx.a, fx.a.agentEmail);
      const { name } = await owner.account.findUniqueOrThrow({
        where: { id: fx.a.agentAccountId },
        select: { name: true },
      });

      const same = await server.patch('/agents/me', { name, public_name: null }, agent.headers);
      expect(same.statusCode).toBe(200);
      expect(await auditActions(fx.a, 'account.profile_updated')).toHaveLength(0);
    });

    it('refuses an empty name, one over 120 characters, an unknown key and an empty body', async () => {
      const agent = await session(fx.a, fx.a.agentEmail);
      for (const body of [
        { name: '   ' },
        { name: 'x'.repeat(121) },
        { public_name: 'x'.repeat(121) },
        { email: 'someone@else.test' },
        {},
      ]) {
        const refused = await server.patch('/agents/me', body, agent.headers);
        expect(refused.statusCode, JSON.stringify(body)).toBe(400);
      }
    });
  });

  // ===========================================================================

  describe('POST /auth/password', () => {
    it('changes the password, ends every other session and keeps this one', async () => {
      const here = await session(fx.a, fx.a.agentEmail);
      const phone = await session(fx.a, fx.a.agentEmail);
      const laptop = await session(fx.a, fx.a.agentEmail);

      const changed = await changePassword(here.headers, TEST_PASSWORD, NEW_PASSWORD);
      expect(changed.statusCode).toBe(204);

      // The other devices: their access token stops at the next request, their
      // refresh token at the next renewal.
      for (const other of [phone, laptop]) {
        expect((await server.get('/auth/me', other.headers)).statusCode).toBe(401);
        expect((await renew(fx.a, other.refreshToken)).statusCode).toBe(401);
      }

      // This one carries on, and renews.
      expect((await server.get('/auth/me', here.headers)).statusCode).toBe(200);
      const renewed = await renew(fx.a, here.refreshToken);
      expect(renewed.statusCode).toBe(200);
      expect((await server.get('/auth/me', bearer(renewed.json().access_token))).statusCode).toBe(
        200,
      );

      // The old password no longer signs in; the new one does.
      expect(await signIn(fx.a, fx.a.agentEmail, TEST_PASSWORD)).toBeNull();
      expect(await signIn(fx.a, fx.a.agentEmail, NEW_PASSWORD)).not.toBeNull();

      const entries = await auditActions(fx.a, 'account.password_changed');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        actorId: fx.a.agentAccountId,
        metadata: { ended_sessions: 2 },
      });
    });

    it('leaves personal access tokens working', async () => {
      const here = await session(fx.a, fx.a.agentEmail);
      const pat = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['agents--my:ro'],
      });

      expect((await changePassword(here.headers, TEST_PASSWORD, NEW_PASSWORD)).statusCode).toBe(
        204,
      );
      expect((await server.get('/auth/me', bearer(pat))).statusCode).toBe(200);
    });

    it('refuses a wrong current password and counts it against the hourly budget', async () => {
      const here = await session(fx.a, fx.a.agentEmail);

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const wrong = await changePassword(here.headers, 'not-the-password', NEW_PASSWORD);
        expect(wrong.statusCode).toBe(401);
        expect(wrong.json().error.type).toBe('authentication');
      }
      // The eleventh is refused before the password is read — even the right one.
      const spent = await changePassword(here.headers, TEST_PASSWORD, NEW_PASSWORD);
      expect(spent.statusCode).toBe(429);

      // Nothing changed, and the session is still good: a wrong password is
      // not a refused credential.
      expect((await server.get('/auth/me', here.headers)).statusCode).toBe(200);
      expect(await signIn(fx.a, fx.a.agentEmail, TEST_PASSWORD)).not.toBeNull();
      expect(await auditActions(fx.a, 'account.password_changed')).toHaveLength(0);
    });

    it('refuses a new password that is the current one, or shorter than 12 characters', async () => {
      const here = await session(fx.a, fx.a.agentEmail);

      const same = await changePassword(here.headers, TEST_PASSWORD, TEST_PASSWORD);
      expect(same.statusCode).toBe(400);
      const short = await changePassword(here.headers, TEST_PASSWORD, 'short-pass');
      expect(short.statusCode).toBe(400);
      expect(await signIn(fx.a, fx.a.agentEmail, TEST_PASSWORD)).not.toBeNull();
    });

    it('refuses a member an enforced identity provider signs in, and says why — not the owner', async () => {
      await owner.ssoConnection.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'Okta (corp)',
          idpEntityId: 'https://idp.example.test/saml/metadata',
          idpSsoUrl: 'https://idp.example.test/saml/sso',
          idpCertificatePem: '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----\n',
          enabled: true,
          enforced: true,
        },
      });
      // The member's session came from the identity provider; a panel session
      // minted directly stands in for it.
      const member = bearer(
        await grantToken(owner, {
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ownerId: fx.a.agentAccountId,
          scopes: ['accounts--my:rw'],
          kind: 'oauth',
          clientId: fx.a.clientId,
        }),
      );

      const refused = await changePassword(member, TEST_PASSWORD, NEW_PASSWORD);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error).toMatchObject({
        type: 'not_allowed',
        details: { reason: 'sso_enforced' },
      });

      // The owner keeps the break-glass password, so keeps this too.
      const owners = await session(fx.a, fx.a.ownerEmail);
      expect((await changePassword(owners.headers, TEST_PASSWORD, NEW_PASSWORD)).statusCode).toBe(
        204,
      );
    });

    it('refuses a personal access token: only a sign-in session can change the password', async () => {
      const pat = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['accounts--my:rw'],
      });
      const refused = await changePassword(bearer(pat), TEST_PASSWORD, NEW_PASSWORD);
      expect(refused.statusCode).toBe(403);
      expect(refused.json().error.details).toMatchObject({ reason: 'session_required' });
    });

    it("never touches another account's sessions", async () => {
      const mine = await session(fx.a, fx.a.agentEmail);
      const theirs = await session(fx.a, fx.a.ownerEmail);

      expect((await changePassword(mine.headers, TEST_PASSWORD, NEW_PASSWORD)).statusCode).toBe(
        204,
      );
      expect((await server.get('/auth/me', theirs.headers)).statusCode).toBe(200);
      expect((await renew(fx.a, theirs.refreshToken)).statusCode).toBe(200);
    });
  });
});
