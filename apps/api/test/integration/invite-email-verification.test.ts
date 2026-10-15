/**
 * An invitation link no longer proves the address (tm 282 · GV-03).
 *
 * `POST /invitations` hands every accept link back to the admin ("Copy invite
 * link", GV-03-S1), so before this the admin could open the link, choose a
 * password for somebody else's address, and hold a verified account under it
 * — one that followed the real person into every workspace, since one address
 * is one account. The claims, each against the hole it closes:
 *
 *   1. **The link holder gets nothing.** Accepting with an address nobody has
 *      verified answers 202 and nothing more: no session, no membership, no
 *      seat, no way to sign in. A verification link goes to the address.
 *   2. **The mailbox is the way in.** Opening that link with the password is
 *      the join — and a real invitee can accept after the admin did, replacing
 *      the admin's password, because the invitation stays live until then.
 *   3. **A verified account is unchanged.** It joins on the accept, as before.
 *   4. **Fifty a day.** The 51st invitation of a UTC day is refused whole, and
 *      revoking gives nothing back (GV-03-S2).
 *   5. **What nobody verifies goes.** An unverified invitee past the sign-up
 *      TTL is purged, and its invitation is live again.
 *
 * Run with `SIGNUP_EMAIL_VERIFICATION` off — the deployment default — because
 * none of this waits for that flag: an invitation's link is handed to the
 * admin whatever the sign-up form does.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { INVITES_PER_DAY } from '../../src/services/auth/lifecycle-service.js';
import { UnverifiedInviteeSweeper } from '../../src/services/auth/unverified-signup-sweep.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { MemoryMailer, verificationTokenFor } from '../helpers/invite-join.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const INVITEE = 'invitee@example.test';
const ADMIN_CHOSEN = 'chosen-by-the-admin';
const INVITEE_CHOSEN = 'chosen-by-the-invitee';
const HOUR_MS = 3_600_000;

describe('an invitation link does not prove the address (GV-03)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  let adminToken: string;
  const mailer = new MemoryMailer();

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    mailer.clear();
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
  });

  /** What the admin is handed: the invitation's id and its working link. */
  async function invite(email = INVITEE) {
    const response = await server.post(
      '/invitations',
      { emails: [email], role: 'agent' },
      auth(adminToken),
    );
    expect(response.statusCode, response.payload).toBe(201);
    const item = (response.json() as { items: Array<{ id: string; accept_url: string }> })
      .items[0]!;
    return { id: item.id, token: new URL(item.accept_url).searchParams.get('token')! };
  }

  const accept = (token: string, password: string, name = 'Somebody') =>
    server.post('/auth/invitations/accept', { token, name, password });

  const verify = async (email: string, password: string) =>
    server.post('/auth/verify-email', {
      token: await verificationTokenFor(server, mailer, email),
      password,
    });

  /** `/auth/authorize` into workspace A, the way the panel signs in. */
  const authorize = (email: string, password: string) =>
    server.post('/auth/authorize', {
      client_id: fx.a.clientId,
      redirect_uri: fx.a.redirectUri,
      code_challenge: deriveCodeChallenge(generateToken(48).slice(0, 64)),
      email,
      password,
      license_id: fx.a.licenseId.toString(),
    });

  const accountOf = (email: string) => owner.account.findUnique({ where: { email } });
  const membershipsOf = (accountId: string) =>
    owner.agentMembership.findMany({ where: { agentId: accountId } });
  const trail = (action: string) =>
    owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action },
      orderBy: { createdAt: 'asc' },
    });

  // =========================================================================
  // 1. The link holder gets nothing
  // =========================================================================

  describe('an admin who opens the copied link for somebody else', () => {
    it('creates an unverified account in no workspace, answers 202 with nothing about it, and mails the address (FR-MOD-04.4)', async () => {
      const { token } = await invite();
      const accepted = await accept(token, ADMIN_CHOSEN, 'Impostor');

      expect(accepted.statusCode).toBe(202);
      expect(accepted.json()).toEqual({
        verification_required: true,
        message: 'Check your inbox: confirm your email address to finish joining.',
      });

      const account = await accountOf(INVITEE);
      expect(account?.emailVerifiedAt).toBeNull();
      expect(await membershipsOf(account!.id)).toHaveLength(0);
      expect(await trail('member.joined')).toHaveLength(0);

      // The link went to the invited address — account mail, outside the
      // workspace's own allowance — worded as the invitation's.
      await server.app.backgroundMail.settled();
      const mails = mailer.sent.filter((m) => m.kind === 'email_verification');
      expect(mails.map((m) => m.to)).toEqual([INVITEE]);
      expect(mails[0]!.licenseId).toBeNull();
      expect(mails[0]!.subject).toBe(`Confirm your email address to join Org A`);
      expect(mails[0]!.body).not.toContain('signing up');
    });

    it('cannot sign in with the password it chose — not to the workspace, not anywhere', async () => {
      const { token } = await invite();
      expect((await accept(token, ADMIN_CHOSEN)).statusCode).toBe(202);

      const login = await server.post('/auth/login', { email: INVITEE, password: ADMIN_CHOSEN });
      expect(login.statusCode).toBe(200);
      expect(login.json()).toMatchObject({
        account: { email_verified: false },
        memberships: [],
      });
      // No membership, so the workspace does not exist as far as this account
      // is concerned — the same 404 any stranger gets.
      expect((await authorize(INVITEE, ADMIN_CHOSEN)).statusCode).toBe(404);
    });

    it('cannot verify without the mailbox: the link is only in the invitee’s inbox, and the invitation stays pending', async () => {
      const invitation = await invite();
      expect((await accept(invitation.token, ADMIN_CHOSEN)).statusCode).toBe(202);

      const pending = await server.get('/invitations', auth(adminToken));
      const listed = (pending.json() as { items: Array<{ id: string }> }).items.map((i) => i.id);
      expect(listed).toContain(invitation.id);
      const preview = await server.get(`/auth/invitations/preview?token=${invitation.token}`);
      expect(preview.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // 2. The mailbox is the way in
  // =========================================================================

  describe('the invitee', () => {
    it('joins by opening the mailed link with the password, and can then sign in (FR-MOD-04.4)', async () => {
      const { token } = await invite();
      expect((await accept(token, INVITEE_CHOSEN, 'Real Invitee')).statusCode).toBe(202);

      const verified = await verify(INVITEE, INVITEE_CHOSEN);
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toMatchObject({
        account: { email: INVITEE, name: 'Real Invitee' },
        memberships: [{ license_id: fx.a.licenseId.toString(), role: 'agent' }],
        joined_license_ids: [fx.a.licenseId.toString()],
      });

      const account = await accountOf(INVITEE);
      expect(account?.emailVerifiedAt).not.toBeNull();
      expect((await authorize(INVITEE, INVITEE_CHOSEN)).statusCode).toBe(200);

      // The trail says who joined, how, and that the address was proven — in
      // the workspace joined, never with the address in it.
      const [joined] = await trail('member.joined');
      expect(joined).toMatchObject({ actorId: account!.id, target: `account:${account!.id}` });
      expect(joined!.metadata).toMatchObject({ role: 'agent', via: 'invitation' });
      expect(await trail('auth.email_verified')).toHaveLength(1);
      expect(JSON.stringify(joined!.metadata)).not.toContain(INVITEE);

      // Spent by the join.
      expect((await accept(token, INVITEE_CHOSEN)).statusCode).toBe(401);
    });

    it('can accept after the admin did: their password replaces the admin’s, whose link stops working', async () => {
      const { token } = await invite();
      expect((await accept(token, ADMIN_CHOSEN, 'Impostor')).statusCode).toBe(202);
      const adminLink = await verificationTokenFor(server, mailer, INVITEE);

      // The real invitee opens the invitation mail later: still a password
      // form, because the account the admin made belongs to nothing.
      const preview = await server.get(`/auth/invitations/preview?token=${token}`);
      expect(preview.json()).toMatchObject({ needs_password: true });
      expect((await accept(token, INVITEE_CHOSEN, 'Real Invitee')).statusCode).toBe(202);

      // The first link is spent, and the admin's password opens nothing.
      expect(
        (await server.post('/auth/verify-email', { token: adminLink, password: ADMIN_CHOSEN }))
          .statusCode,
      ).toBe(401);
      expect((await verify(INVITEE, ADMIN_CHOSEN)).statusCode).toBe(401);

      const verified = await verify(INVITEE, INVITEE_CHOSEN);
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toMatchObject({ account: { name: 'Real Invitee' } });
      expect(
        (await server.post('/auth/login', { email: INVITEE, password: ADMIN_CHOSEN })).statusCode,
      ).toBe(401);
    });

    it('gets the invitation’s wording on a resent link too', async () => {
      const { token } = await invite();
      expect((await accept(token, INVITEE_CHOSEN)).statusCode).toBe(202);
      mailer.clear();

      expect((await server.post('/auth/verify-email/resend', { email: INVITEE })).statusCode).toBe(
        202,
      );
      await server.app.backgroundMail.settled();
      const [resent] = mailer.sent.filter((m) => m.kind === 'email_verification');
      expect(resent!.subject).toBe('Confirm your email address to join Org A');
      expect((await verify(INVITEE, INVITEE_CHOSEN)).statusCode).toBe(200);
    });
  });

  // =========================================================================
  // 3. A verified account is unchanged
  // =========================================================================

  describe('an address somebody already verified', () => {
    it('joins on the accept, asks for no password, and mails no link — as before (FR-MOD-04.4)', async () => {
      const { token } = await invite(fx.b.ownerEmail);
      const preview = await server.get(`/auth/invitations/preview?token=${token}`);
      expect(preview.json()).toMatchObject({ needs_password: false });

      const accepted = await server.post('/auth/invitations/accept', { token });
      expect(accepted.statusCode).toBe(200);
      const memberships = (accepted.json() as { memberships: Array<{ license_id: string }> })
        .memberships;
      expect(memberships.map((m) => m.license_id)).toContain(fx.a.licenseId.toString());
      expect(await trail('member.joined')).toHaveLength(1);

      await server.app.backgroundMail.settled();
      expect(mailer.sent.filter((m) => m.kind === 'email_verification')).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. Fifty a day (GV-03-S2)
  // =========================================================================

  describe('the daily invitation allowance', () => {
    const batch = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, n) => `${prefix}-${String(n)}@example.test`);

    it(`takes ${INVITES_PER_DAY} invitations a day and refuses the next one whole, writing nothing (FR-MOD-04.4)`, async () => {
      expect(INVITES_PER_DAY).toBe(50);
      const first = await server.post(
        '/invitations',
        { emails: batch('day', INVITES_PER_DAY) },
        auth(adminToken),
      );
      expect(first.statusCode, first.payload).toBe(201);

      const rowsBefore = await owner.invitation.count({ where: { licenseId: fx.a.licenseId } });
      const trailBefore = (await trail('member.invited')).length;

      const refused = await server.post(
        '/invitations',
        { emails: ['fifty-first@example.test'] },
        auth(adminToken),
      );
      expect(refused.statusCode).toBe(429);
      expect(refused.json()).toMatchObject({
        error: {
          type: 'limit_reached',
          details: { reason: 'invite_daily_cap', limit: 50, remaining: 0 },
        },
      });
      const retryAfter = Number(refused.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(24 * 3600);

      expect(await owner.invitation.count({ where: { licenseId: fx.a.licenseId } })).toBe(
        rowsBefore,
      );
      expect(await trail('member.invited')).toHaveLength(trailBefore);
    });

    it('refuses a batch that would cross the line, and takes one that fits', async () => {
      expect(
        (await server.post('/invitations', { emails: batch('a', 45) }, auth(adminToken)))
          .statusCode,
      ).toBe(201);
      const over = await server.post('/invitations', { emails: batch('b', 6) }, auth(adminToken));
      expect(over.statusCode).toBe(429);
      expect(over.json()).toMatchObject({ error: { details: { remaining: 5 } } });
      expect(
        (await server.post('/invitations', { emails: batch('c', 5) }, auth(adminToken))).statusCode,
      ).toBe(201);
    });

    it('gives nothing back for a revoked invitation, and counts a re-invitation again', async () => {
      const first = await server.post(
        '/invitations',
        { emails: batch('r', INVITES_PER_DAY - 1) },
        auth(adminToken),
      );
      expect(first.statusCode).toBe(201);
      const ids = (first.json() as { items: Array<{ id: string }> }).items.map((i) => i.id);
      for (const id of ids.slice(0, 10)) {
        expect((await server.del(`/invitations/${id}`, auth(adminToken))).statusCode).toBe(204);
      }
      // One left: a re-invitation of a live address takes it, and mails again.
      expect(
        (await server.post('/invitations', { emails: ['r-20@example.test'] }, auth(adminToken)))
          .statusCode,
      ).toBe(201);
      expect(
        (await server.post('/invitations', { emails: ['r-0@example.test'] }, auth(adminToken)))
          .statusCode,
      ).toBe(429);
    });

    it('renews at 00:00 UTC, and is each workspace’s own', async () => {
      expect(
        (
          await server.post(
            '/invitations',
            { emails: batch('y', INVITES_PER_DAY) },
            auth(adminToken),
          )
        ).statusCode,
      ).toBe(201);

      // Workspace B has its own fifty.
      const otherAdmin = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['accounts--all:rw'],
      });
      expect(
        (await server.post('/invitations', { emails: ['b-side@example.test'] }, auth(otherAdmin)))
          .statusCode,
      ).toBe(201);

      // Yesterday's fifty do not count today.
      const midnight = new Date();
      midnight.setUTCHours(0, 0, 0, 0);
      await owner.auditLogEntry.updateMany({
        where: { licenseId: fx.a.licenseId, action: 'member.invited' },
        data: { createdAt: new Date(midnight.getTime() - 60_000) },
      });
      expect(
        (await server.post('/invitations', { emails: ['today@example.test'] }, auth(adminToken)))
          .statusCode,
      ).toBe(201);
    });
  });

  // =========================================================================
  // 5. What nobody verifies goes
  // =========================================================================

  describe('an invitee nobody verifies', () => {
    const TTL_HOURS = 72;

    /** Push an account, and every link mailed to it, `hours` into the past. */
    async function age(email: string, hours: number): Promise<string> {
      const account = await owner.account.findUniqueOrThrow({ where: { email } });
      const past = new Date(Date.now() - hours * HOUR_MS);
      await owner.account.update({ where: { id: account.id }, data: { createdAt: past } });
      await owner.emailVerificationToken.updateMany({
        where: { accountId: account.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      return account.id;
    }

    const sweep = () => new UnverifiedInviteeSweeper(server.app.db, { ttlHours: TTL_HOURS }).run();

    it('is purged past the TTL, and the invitation is live again for the real invitee', async () => {
      const invitation = await invite();
      expect((await accept(invitation.token, ADMIN_CHOSEN)).statusCode).toBe(202);
      const stale = await age(INVITEE, TTL_HOURS + 1);

      expect(await sweep()).toEqual({ totals: { purged: 1, batches: 1 } });
      expect(await owner.account.count({ where: { id: stale } })).toBe(0);
      const row = await owner.invitation.findUniqueOrThrow({ where: { id: invitation.id } });
      expect(row.pendingAccountId).toBeNull();
      expect(row.acceptedAt).toBeNull();

      // The real invitee starts afresh with the same link.
      expect((await accept(invitation.token, INVITEE_CHOSEN)).statusCode).toBe(202);
      expect((await verify(INVITEE, INVITEE_CHOSEN)).statusCode).toBe(200);
    });

    it('keeps one inside the TTL, one whose link still works, and every account in a workspace', async () => {
      const young = await invite('young@example.test');
      expect((await accept(young.token, ADMIN_CHOSEN)).statusCode).toBe(202);
      await age('young@example.test', TTL_HOURS - 1);

      const linked = await invite('linked@example.test');
      expect((await accept(linked.token, ADMIN_CHOSEN)).statusCode).toBe(202);
      const linkedId = await age('linked@example.test', TTL_HOURS + 1);
      await owner.emailVerificationToken.updateMany({
        where: { accountId: linkedId },
        data: { expiresAt: new Date(Date.now() + HOUR_MS) },
      });

      // A seeded agent, unverified and old, but a member somewhere.
      await owner.account.update({
        where: { id: fx.a.agentAccountId },
        data: { emailVerifiedAt: null, createdAt: new Date(Date.now() - 1000 * HOUR_MS) },
      });

      expect(await sweep()).toEqual({ totals: { purged: 0, batches: 1 } });
      expect(await owner.account.count({ where: { email: 'young@example.test' } })).toBe(1);
      expect(await owner.account.count({ where: { id: linkedId } })).toBe(1);
      expect(await owner.account.count({ where: { id: fx.a.agentAccountId } })).toBe(1);
    });
  });
});
