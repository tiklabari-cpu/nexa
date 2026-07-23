/**
 * Signup, password recovery and invitations (PRD FR-MOD-00.2, 00.3, 04.3.1, 04.4).
 *
 * Negative cases come first, deliberately. This is the surface where a mistake
 * is silent: an enumeration channel, an invitation that outlives its revocation
 * or a role that can promote itself all look like a working feature from the
 * outside, and the tests are the only thing that would notice.
 *
 * The invariants and threats these correspond to are listed in PLAN §3.12 and
 * were written before the code.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const STRONG_PASSWORD = 'a-quite-long-passphrase';

describe('account lifecycle', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  let ownerToken: string;
  let agentToken: string;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

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

    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
    agentToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.agentAccountId,
      scopes: ['accounts--all:rw'],
    });
  });

  /** The invitation token only ever exists in the create response. */
  async function inviteOne(email: string, role: 'admin' | 'agent' = 'admin') {
    const response = await server.post('/invitations', { emails: [email], role }, auth(ownerToken));
    expect(response.statusCode).toBe(201);
    const body = response.json() as { items: Array<{ id: string; accept_url: string }> };
    const item = body.items[0]!;
    return { id: item.id, token: new URL(item.accept_url).searchParams.get('token')! };
  }

  async function resetTokenFor(email: string): Promise<string | null> {
    const response = await server.post('/auth/password-reset', { email });
    expect(response.statusCode).toBe(202);
    const row = await owner.$queryRaw<Array<{ token_hash: string }>>`
      SELECT t.token_hash FROM password_reset_tokens t
      JOIN accounts a ON a.id = t.account_id
      WHERE a.email = ${email}::citext AND t.used_at IS NULL`;
    return row[0]?.token_hash ?? null;
  }

  // =========================================================================
  // Enumeration (T1) — the channel FR-MOD-00.3 exists to close
  // =========================================================================

  describe('password recovery does not reveal who has an account', () => {
    it('answers a real and an unknown address identically', async () => {
      const real = await server.post('/auth/password-reset', { email: fx.a.ownerEmail });
      const fake = await server.post('/auth/password-reset', {
        email: 'nobody-at-all@example.test',
      });

      expect(real.statusCode).toBe(fake.statusCode);
      expect(real.statusCode).toBe(202);
      // Byte-for-byte, not "both look fine".
      expect(real.body).toBe(fake.body);
      expect(real.json()).toEqual({
        message: 'If an account exists for that address, we sent a link.',
      });
    });

    it('records a token only for the address that exists', async () => {
      await server.post('/auth/password-reset', { email: 'nobody-at-all@example.test' });
      const stored = await owner.passwordResetToken.count();
      expect(stored).toBe(0);

      await server.post('/auth/password-reset', { email: fx.a.ownerEmail });
      expect(await owner.passwordResetToken.count()).toBe(1);
    });

    it('stores only the hash, never the token', async () => {
      // A leaked backup of this table must not be a set of working links.
      await server.post('/auth/password-reset', { email: fx.a.ownerEmail });
      const [row] = await owner.passwordResetToken.findMany();
      expect(row!.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  // =========================================================================
  // Reset token abuse (T2)
  // =========================================================================

  describe('reset tokens', () => {
    it('refuses an unknown token', async () => {
      const response = await server.post('/auth/password-reset/confirm', {
        token: 'x'.repeat(43),
        password: STRONG_PASSWORD,
      });
      expect(response.statusCode).toBe(401);
    });

    it('works once', async () => {
      // Read the raw token by intercepting it the only place it exists: the
      // mailer is null in tests, so drive the confirm through a token minted
      // here and matched by hash.
      const token = 'k'.repeat(43);
      const hash = await sha256(token);
      const account = await owner.account.findFirst({ where: { email: fx.a.ownerEmail } });
      await owner.passwordResetToken.create({
        data: {
          accountId: account!.id,
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });

      const first = await server.post('/auth/password-reset/confirm', {
        token,
        password: STRONG_PASSWORD,
      });
      expect(first.statusCode).toBe(204);

      const second = await server.post('/auth/password-reset/confirm', {
        token,
        password: 'another-long-passphrase',
      });
      expect(second.statusCode).toBe(401);
    });

    it('refuses an expired token', async () => {
      const token = 'e'.repeat(43);
      const account = await owner.account.findFirst({ where: { email: fx.a.ownerEmail } });
      await owner.passwordResetToken.create({
        data: {
          accountId: account!.id,
          tokenHash: await sha256(token),
          expiresAt: new Date(Date.now() - 1000),
        },
      });

      const response = await server.post('/auth/password-reset/confirm', {
        token,
        password: STRONG_PASSWORD,
      });
      expect(response.statusCode).toBe(401);
    });

    it('spends an earlier outstanding token when a new one is asked for', async () => {
      // Asking again is how someone reacts to thinking the first link leaked.
      const first = await resetTokenFor(fx.a.ownerEmail);
      await resetTokenFor(fx.a.ownerEmail);

      const stillLive = await owner.passwordResetToken.findMany({ where: { usedAt: null } });
      expect(stillLive).toHaveLength(1);
      expect(stillLive[0]!.tokenHash).not.toBe(first);
    });

    it('revokes existing sessions when the password changes (I9)', async () => {
      const account = await owner.account.findFirst({ where: { email: fx.a.ownerEmail } });

      // A signed-in session, stood up directly: the fixtures issue access
      // tokens without going through the refresh flow, so without this the
      // assertion below would pass against zero sessions and prove nothing.
      await owner.oauthRefreshToken.create({
        data: {
          tokenHash: `session-${Date.now()}`,
          clientId: fx.a.clientId,
          accountId: account!.id,
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          scopes: ['chats--all:rw'],
          familyId: randomUUID(),
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });

      const live = await owner.oauthRefreshToken.count({
        where: { accountId: account!.id, revokedAt: null },
      });
      expect(live).toBeGreaterThan(0);

      const token = 'r'.repeat(43);
      await owner.passwordResetToken.create({
        data: {
          accountId: account!.id,
          tokenHash: await sha256(token),
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await server.post('/auth/password-reset/confirm', { token, password: STRONG_PASSWORD });

      // A reset is what someone does when they think another person is in
      // their account; leaving that person signed in defeats it.
      const after = await owner.oauthRefreshToken.count({
        where: { accountId: account!.id, revokedAt: null },
      });
      expect(after).toBe(0);
    });
  });

  // =========================================================================
  // Invitation abuse (T3, T4, T5)
  // =========================================================================

  describe('invitations', () => {
    it('refuses an agent inviting above their own role (T4)', async () => {
      const response = await server.post(
        '/invitations',
        { emails: ['new@example.test'], role: 'admin' },
        auth(agentToken),
      );
      expect(response.statusCode).toBe(403);
    });

    it('stops working the moment it is revoked (T3)', async () => {
      const invite = await inviteOne('forwarded@example.test');

      expect((await server.get(`/auth/invitations/preview?token=${invite.token}`)).statusCode).toBe(
        200,
      );

      await server.del(`/invitations/${invite.id}`, auth(ownerToken));

      // The whole reason revocation exists is a link that reached the wrong inbox.
      expect((await server.get(`/auth/invitations/preview?token=${invite.token}`)).statusCode).toBe(
        401,
      );
    });

    it('works once', async () => {
      const invite = await inviteOne('joiner@example.test');

      const first = await server.post('/auth/invitations/accept', {
        token: invite.token,
        name: 'Joiner',
        password: STRONG_PASSWORD,
      });
      expect(first.statusCode).toBe(200);

      const second = await server.post('/auth/invitations/accept', {
        token: invite.token,
        name: 'Joiner',
        password: STRONG_PASSWORD,
      });
      expect(second.statusCode).toBe(401);
    });

    it("never lists another tenant's invitations (T5)", async () => {
      await inviteOne('ours@example.test');

      const otherToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['accounts--all:rw'],
      });
      const response = await server.get('/invitations', auth(otherToken));
      expect((response.json() as { items: unknown[] }).items).toHaveLength(0);
    });

    it("cannot revoke another tenant's invitation", async () => {
      const invite = await inviteOne('ours@example.test');
      const otherToken = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['accounts--all:rw'],
      });

      expect((await server.del(`/invitations/${invite.id}`, auth(otherToken))).statusCode).toBe(
        404,
      );
      // And it still works for the tenant that owns it.
      expect((await server.get(`/auth/invitations/preview?token=${invite.token}`)).statusCode).toBe(
        200,
      );
    });

    it('does not hand out working links from the list endpoint', async () => {
      await inviteOne('listed@example.test');
      const body = (await server.get('/invitations', auth(ownerToken))).json() as {
        items: Array<Record<string, unknown>>;
      };
      // Read access to the team page must not become workspace access.
      expect(body.items[0]).not.toHaveProperty('accept_url');
      expect(JSON.stringify(body)).not.toContain('token=');
    });

    it('keeps one live invitation per address (I6)', async () => {
      await inviteOne('twice@example.test');
      const second = await inviteOne('twice@example.test');

      const pending = await owner.invitation.findMany({
        where: { email: 'twice@example.test', acceptedAt: null },
      });
      expect(pending).toHaveLength(1);

      // And it is the newer link that works.
      expect((await server.get(`/auth/invitations/preview?token=${second.token}`)).statusCode).toBe(
        200,
      );
    });

    it('reports invalid addresses individually rather than rejecting the batch', async () => {
      const response = await server.post(
        '/invitations',
        { emails: ['fine@example.test', 'not-an-email'], role: 'admin' },
        auth(ownerToken),
      );
      expect(response.statusCode).toBe(400);
      const error = response.json() as { error: { details?: { invalid_emails?: string[] } } };
      expect(error.error.details?.invalid_emails).toEqual(['not-an-email']);
    });
  });

  // =========================================================================
  // The happy paths
  // =========================================================================

  describe('signup', () => {
    it('creates the workspace, the owner and a 14-day trial (I1, I3)', async () => {
      const response = await server.post('/auth/signup', {
        email: 'founder@newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'NewCo',
      });

      expect(response.statusCode).toBe(201);
      const body = response.json() as {
        account: { id: string; email: string };
        memberships: Array<{ role: string; organization_name: string; license_status: string }>;
      };
      expect(body.memberships).toHaveLength(1);
      expect(body.memberships[0]!.role).toBe('owner');
      expect(body.memberships[0]!.organization_name).toBe('NewCo');
      expect(body.memberships[0]!.license_status).toBe('trialing');

      const license = await owner.license.findFirst({
        where: { organization: { name: 'NewCo' } },
      });
      const days = (license!.trialEndsAt!.getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(13.9);
      expect(days).toBeLessThan(14.1);
    });

    it('leaves nothing behind when the email is taken (I1)', async () => {
      const before = await owner.organization.count();

      const response = await server.post('/auth/signup', {
        email: fx.a.ownerEmail,
        password: STRONG_PASSWORD,
        name: 'Impostor',
        organization_name: 'Should Not Exist',
      });
      expect(response.statusCode).toBe(409);
      expect((response.json() as { error: { type: string } }).error.type).toBe('account_exists');

      // The organization is inserted before the account inside `auth_signup`;
      // if the function were not atomic this is where the orphan would show up.
      expect(await owner.organization.count()).toBe(before);
      expect(await owner.organization.count({ where: { name: 'Should Not Exist' } })).toBe(0);
    });

    it('refuses a short password', async () => {
      const response = await server.post('/auth/signup', {
        email: 'short@newco.test',
        password: 'tiny',
        name: 'Founder',
        organization_name: 'NewCo',
      });
      expect(response.statusCode).toBe(400);
    });

    it('lets the new owner sign in immediately', async () => {
      await server.post('/auth/signup', {
        email: 'founder2@newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'NewCo Two',
      });

      const login = await server.post('/auth/login', {
        email: 'founder2@newco.test',
        password: STRONG_PASSWORD,
      });
      expect(login.statusCode).toBe(200);
    });
  });

  describe('accepting an invitation', () => {
    it('creates the account and the membership for a newcomer', async () => {
      const invite = await inviteOne('newcomer@example.test', 'agent');

      const preview = await server.get(`/auth/invitations/preview?token=${invite.token}`);
      expect(preview.json()).toMatchObject({ needs_password: true, role: 'agent' });

      const response = await server.post('/auth/invitations/accept', {
        token: invite.token,
        name: 'Newcomer',
        password: STRONG_PASSWORD,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { memberships: Array<{ role: string }> };
      expect(body.memberships).toHaveLength(1);
      expect(body.memberships[0]!.role).toBe('agent');
    });

    it('joins an existing account rather than making a second one (I2, I7)', async () => {
      // The other tenant's owner is invited here. One email is one person.
      const invite = await inviteOne(fx.b.ownerEmail, 'agent');

      const preview = await server.get(`/auth/invitations/preview?token=${invite.token}`);
      expect(preview.json()).toMatchObject({ needs_password: false });

      const response = await server.post('/auth/invitations/accept', { token: invite.token });
      expect(response.statusCode).toBe(200);

      const accounts = await owner.account.count({ where: { email: fx.b.ownerEmail } });
      expect(accounts).toBe(1);

      const body = response.json() as { memberships: Array<{ license_id: string }> };
      // Now a member of both workspaces.
      expect(body.memberships).toHaveLength(2);
    });

    it('requires a password when the address has no account', async () => {
      const invite = await inviteOne('passwordless@example.test');
      const response = await server.post('/auth/invitations/accept', { token: invite.token });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    });
  });
});

async function sha256(value: string): Promise<string> {
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(value).digest('hex');
}
