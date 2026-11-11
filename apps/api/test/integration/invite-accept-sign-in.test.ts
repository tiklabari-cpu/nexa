/**
 * A verified account joins a workspace only once it signs in (tm 421 · audit
 * 2026-11-06 F04).
 *
 * `POST /invitations` hands every accept link back to the admin who sent it
 * ("Copy invite link"), so the link proves nobody's identity. Before this, an
 * admin could invite anybody's address, accept the link themselves with no
 * credential at all, and the person was in their workspace — the answer
 * listing every other workspace that person belonged to. The claims, each
 * against the hole it closes:
 *
 *   1. **The link alone is refused.** 401 `invitation_requires_sign_in`, and
 *      nothing is written: no membership, the invitation still live.
 *   2. **A proof joins, and the answer names one workspace.** The account's
 *      password, or a signed-in session of that same account; the answer lists
 *      the workspace joined and none of the account's others.
 *   3. **Guessing is bounded per account.** Five presented passwords an hour,
 *      right or wrong, however many links an admin mints for the address.
 *   4. **Only the person's own session counts.** Not another account's, not a
 *      personal access token. An account with no password (single sign-on)
 *      gets in by its session.
 *   5. **Unverified accounts are untouched** — they still prove the address by
 *      the mailed link (tm 282).
 *   6. **The database holds the line too.** `auth_accept_invitation` refuses a
 *      verified join without a matching proof, whoever calls it.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/lib/crypto.js';
import { INVITE_SIGN_IN_ATTEMPTS_PER_HOUR } from '../../src/routes/account-lifecycle.js';
import { hashToken } from '../../src/services/auth/lifecycle-service.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface ErrorBody {
  error: { type: string; message: string; details?: { reason?: string } };
}
interface SessionBody {
  account: { id: string; email: string };
  memberships: Array<{ license_id: string; organization_name: string; role: string }>;
}

describe('a verified account joins only once it signs in (tm 421 · F04)', () => {
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
    // Nothing from the previous test lands in this one.
    await server.app.backgroundMail.settled();
    mailer.clear();
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
  });

  /** Workspace A's admin invites `email`, and is handed the link. */
  async function invite(email: string): Promise<{ id: string; token: string }> {
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

  const accept = (body: Record<string, unknown>, headers: Record<string, string> = {}) =>
    server.post('/auth/invitations/accept', body, headers);

  /** A panel session of `accountId` in workspace B — what signing in there gives. */
  const sessionInB = (accountId: string, kind: 'oauth' | 'pat' = 'oauth') =>
    grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: accountId,
      scopes: ['chats--all:ro'],
      kind,
      ...(kind === 'oauth' ? { clientId: fx.b.clientId } : {}),
    });

  const membershipIn = (licenseId: bigint, accountId: string) =>
    owner.agentMembership.findFirst({ where: { licenseId, agentId: accountId } });
  const invitationRow = (id: string) => owner.invitation.findUnique({ where: { id } });
  const joinedTrail = () =>
    owner.auditLogEntry.findMany({ where: { licenseId: fx.a.licenseId, action: 'member.joined' } });

  /** Nothing about the account moved: no membership in A, the invitation still live. */
  async function expectNothingWritten(invitationId: string, accountId: string): Promise<void> {
    expect(await membershipIn(fx.a.licenseId, accountId)).toBeNull();
    expect((await invitationRow(invitationId))?.acceptedAt).toBeNull();
    expect(await joinedTrail()).toHaveLength(0);
  }

  function expectSignInRefusal(
    response: { statusCode: number; json: () => unknown },
    reason: string,
  ): void {
    expect(response.statusCode).toBe(401);
    const body = response.json() as ErrorBody;
    expect(body.error.type).toBe('invitation_requires_sign_in');
    expect(body.error.details?.reason).toBe(reason);
  }

  // =========================================================================
  // 1. The link alone
  // =========================================================================

  describe('the link alone', () => {
    it('is refused with 401 invitation_requires_sign_in, and nothing is written', async () => {
      const { id, token } = await invite(fx.b.ownerEmail);

      expectSignInRefusal(await accept({ token }), 'sign_in_required');
      // A password to *choose* is not a proof of the account's.
      expectSignInRefusal(
        await accept({ token, name: 'Impostor', password: 'a-password-the-admin-chose' }),
        'sign_in_required',
      );

      await expectNothingWritten(id, fx.b.ownerAccountId);
      // The invitation still works for its owner.
      const preview = await server.get(`/auth/invitations/preview?token=${token}`);
      expect(preview.statusCode).toBe(200);
      expect(preview.json()).toMatchObject({ needs_password: false });
      // The account's own password was left alone.
      const signIn = await server.post('/auth/login', {
        email: fx.b.ownerEmail,
        password: fx.b.password,
      });
      expect(signIn.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // 2. A proof joins — and the answer names one workspace
  // =========================================================================

  describe("the account's password", () => {
    it('joins, and the answer lists the workspace joined and none of the account’s others (FR-MOD-04.4)', async () => {
      const { id, token } = await invite(fx.b.ownerEmail);

      const accepted = await accept({ token, current_password: fx.b.password });
      expect(accepted.statusCode, accepted.payload).toBe(200);
      const body = accepted.json() as SessionBody;
      expect(body.account.id).toBe(fx.b.ownerAccountId);
      expect(body.memberships).toHaveLength(1);
      expect(body.memberships[0]).toMatchObject({
        license_id: fx.a.licenseId.toString(),
        organization_name: 'Org A',
        role: 'agent',
      });
      // Workspace B — the account's own — is nowhere in it.
      expect(accepted.payload).not.toContain(fx.b.organizationId);
      expect(accepted.payload).not.toContain('Org B');

      // Joined for real: a member of both, the invitation spent, the trail written.
      expect(await membershipIn(fx.a.licenseId, fx.b.ownerAccountId)).not.toBeNull();
      expect(await membershipIn(fx.b.licenseId, fx.b.ownerAccountId)).not.toBeNull();
      expect((await invitationRow(id))?.acceptedAt).not.toBeNull();
      expect(await joinedTrail()).toHaveLength(1);
    });

    it('refuses a wrong one with password_incorrect, and writes nothing', async () => {
      const { id, token } = await invite(fx.b.ownerEmail);
      expectSignInRefusal(
        await accept({ token, current_password: 'not-the-password' }),
        'password_incorrect',
      );
      await expectNothingWritten(id, fx.b.ownerAccountId);
    });
  });

  // =========================================================================
  // 3. Guessing is bounded per account
  // =========================================================================

  describe('passwords presented for one account', () => {
    it(`are counted right or wrong — the ${INVITE_SIGN_IN_ATTEMPTS_PER_HOUR + 1}th in an hour is 429, even the right one, and a new link does not reset it`, async () => {
      const first = await invite(fx.b.ownerEmail);
      for (let attempt = 1; attempt < INVITE_SIGN_IN_ATTEMPTS_PER_HOUR; attempt++) {
        expectSignInRefusal(
          await accept({ token: first.token, current_password: `guess-${attempt}` }),
          'password_incorrect',
        );
      }
      // The last one the hour allows, through a new link for the same address:
      // the allowance is the account's, so the new link starts none of its own.
      const reinvited = await invite(fx.b.ownerEmail);
      expect(reinvited.id).toBe(first.id);
      expectSignInRefusal(
        await accept({ token: reinvited.token, current_password: 'guess-last' }),
        'password_incorrect',
      );

      const refused = await accept({ token: reinvited.token, current_password: fx.b.password });
      expect(refused.statusCode).toBe(429);
      expect(refused.headers['retry-after']).toBe('3600');
      await expectNothingWritten(first.id, fx.b.ownerAccountId);

      // Another account's allowance is its own.
      const other = await invite(fx.b.agentEmail);
      expect(
        (await accept({ token: other.token, current_password: fx.b.password })).statusCode,
      ).toBe(200);
    });

    it('are not what a session spends', async () => {
      const { token } = await invite(fx.b.ownerEmail);
      for (let attempt = 0; attempt < INVITE_SIGN_IN_ATTEMPTS_PER_HOUR; attempt++) {
        await accept({ token, current_password: `guess-${attempt}` });
      }
      const session = await sessionInB(fx.b.ownerAccountId);
      expect((await accept({ token }, auth(session))).statusCode).toBe(200);
    });
  });

  // =========================================================================
  // 4. Only the person's own session
  // =========================================================================

  describe('a session', () => {
    it('of the same account joins with no password, and answers with the one workspace', async () => {
      const { token } = await invite(fx.b.ownerEmail);
      const session = await sessionInB(fx.b.ownerAccountId);

      const accepted = await accept({ token }, auth(session));
      expect(accepted.statusCode, accepted.payload).toBe(200);
      const body = accepted.json() as SessionBody;
      expect(body.memberships.map((m) => m.license_id)).toEqual([fx.a.licenseId.toString()]);
      expect(await membershipIn(fx.a.licenseId, fx.b.ownerAccountId)).not.toBeNull();
    });

    it('of another account, or a personal access token of the same one, proves nothing', async () => {
      const { id, token } = await invite(fx.b.ownerEmail);

      // Workspace B's agent is signed in — but the invitation is the owner's.
      const somebodyElse = await sessionInB(fx.b.agentAccountId);
      expectSignInRefusal(await accept({ token }, auth(somebodyElse)), 'sign_in_required');

      // A token minted for a program is not the person saying yes.
      const pat = await sessionInB(fx.b.ownerAccountId, 'pat');
      expectSignInRefusal(await accept({ token }, auth(pat)), 'sign_in_required');

      await expectNothingWritten(id, fx.b.ownerAccountId);
    });

    it('is how an account with no password — single sign-on only — gets in', async () => {
      const sso = await owner.account.create({
        data: { email: 'sso-only@example.test', name: 'Sso Only', passwordHash: null },
        select: { id: true, emailVerifiedAt: true },
      });
      expect(sso.emailVerifiedAt).not.toBeNull();
      await owner.agentMembership.create({
        data: { licenseId: fx.b.licenseId, agentId: sso.id, role: 'agent' },
      });
      const { id, token } = await invite('sso-only@example.test');

      expectSignInRefusal(
        await accept({ token, current_password: 'there-is-no-password' }),
        'password_incorrect',
      );
      await expectNothingWritten(id, sso.id);

      const session = await sessionInB(sso.id);
      expect((await accept({ token }, auth(session))).statusCode).toBe(200);
      expect(await membershipIn(fx.a.licenseId, sso.id)).not.toBeNull();
    });
  });

  // =========================================================================
  // 5. Unverified accounts are untouched
  // =========================================================================

  describe('an address nobody has verified', () => {
    it('still answers 202 and waits on the mailed link, whatever current_password says', async () => {
      const newcomer = await invite('newcomer@example.test');
      const accepted = await accept({
        token: newcomer.token,
        name: 'Newcomer',
        password: 'a-quite-long-passphrase',
        current_password: 'ignored-here',
      });
      expect(accepted.statusCode).toBe(202);
      expect(accepted.json()).toMatchObject({ verification_required: true });
    });
  });

  // =========================================================================
  // 6. The database holds the line
  // =========================================================================

  describe('auth_accept_invitation', () => {
    /** Calls the function the way the API does, as `siyahtus_app` would see it. */
    const callAccept = (token: string, proofAccount: string | null, proofHash: string | null) =>
      owner.$queryRaw<Array<{ joined_account: string }>>`
        SELECT * FROM auth_accept_invitation(
          ${hashToken(token)}, NULL, NULL, NULL::int, NULL::timestamptz,
          ${proofAccount}::uuid, ${proofHash})`;

    const passwordHashOf = async (accountId: string) =>
      (await owner.account.findUniqueOrThrow({ where: { id: accountId } })).passwordHash;

    it('refuses a verified join with no proof, the wrong account, or a password since changed — and joins with the right one', async () => {
      const { id, token } = await invite(fx.b.ownerEmail);

      await expect(callAccept(token, null, null)).rejects.toThrow(/siyahtus_sign_in_required/);
      await expect(callAccept(token, fx.b.agentAccountId, null)).rejects.toThrow(
        /siyahtus_sign_in_required/,
      );
      // The hash the API checked a password against, before a reset replaced it.
      const stale = await hashPassword('the-password-before-the-reset');
      await expect(callAccept(token, fx.b.ownerAccountId, stale)).rejects.toThrow(
        /siyahtus_sign_in_required/,
      );
      await expectNothingWritten(id, fx.b.ownerAccountId);

      const current = await passwordHashOf(fx.b.ownerAccountId);
      const rows = await callAccept(token, fx.b.ownerAccountId, current);
      expect(rows.map((r) => r.joined_account)).toEqual([fx.b.ownerAccountId]);
      expect(await membershipIn(fx.a.licenseId, fx.b.ownerAccountId)).not.toBeNull();
    });

    it('takes a session proof — the account alone — for an account with no password hash compared', async () => {
      const { token } = await invite(fx.b.ownerEmail);
      const rows = await callAccept(token, fx.b.ownerAccountId, null);
      expect(rows.map((r) => r.joined_account)).toEqual([fx.b.ownerAccountId]);
    });
  });
});
