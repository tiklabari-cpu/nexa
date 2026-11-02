/**
 * Handing the workspace over (tm 328 · SiyahTuş analysis RL-05): the owner
 * offers it to a member with the password (and the second factor), the member
 * accepts within 72 hours with the mailed token, and in one transaction the
 * previous owner becomes an admin and the member the owner.
 *
 *   - only the owner starts or cancels one, from a signed-in session; a wrong
 *     password or code is refused;
 *   - a suspended, unconfirmed or (where the workspace requires it) factorless
 *     member cannot be offered it, nor take it if they became one meanwhile;
 *   - one pending per workspace; 72 hours later it is expired and dead;
 *   - accepting swaps the roles under the single-owner index, live on the
 *     sessions both already hold, writes the audit entries, moves the billing
 *     contact when it was the owner's, and mails both parties and the admins;
 *   - an owner who changed meanwhile (the root panel) cancels it.
 *
 * RL-05 is an analysis code, not an Ek A catalogue ID, so no title carries it
 * as a requirement tag (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/lib/crypto.js';
import { generateTotp, generateTotpSecret } from '../../src/lib/totp.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  TEST_PASSWORD,
  type Fixtures,
} from '../helpers/fixtures.js';
import { MemoryMailer } from '../helpers/invite-join.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

type Headers = Record<string, string>;

const ALL_SCOPES = ['accounts--all:rw', 'accounts--all:ro', 'accounts--my:rw', 'accounts--my:ro'];

describe('ownership transfer (RL-05 · tm 328)', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  const mailer = new MemoryMailer();

  /** The extra members of workspace a, by part. */
  let adminId: string;
  let adminEmail: string;
  let unverifiedId: string;
  let suspendedId: string;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { mailer });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  async function addMember(
    email: string,
    role: string,
    extra: { verified?: boolean; suspended?: boolean } = {},
  ): Promise<string> {
    const account = await owner.account.create({
      data: {
        email,
        name: email.split('@')[0]!,
        passwordHash: await hashPassword(TEST_PASSWORD),
        ...(extra.verified === false ? { emailVerifiedAt: null } : {}),
      },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: fx.a.licenseId,
        agentId: account.id,
        role,
        suspended: extra.suspended ?? false,
      },
    });
    return account.id;
  }

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    mailer.clear();
    adminEmail = 'admin-ot@a.test';
    adminId = await addMember(adminEmail, 'admin');
    unverifiedId = await addMember('unverified-ot@a.test', 'agent', { verified: false });
    suspendedId = await addMember('suspended-ot@a.test', 'agent', { suspended: true });
  });

  afterEach(async () => {
    await server.app.backgroundMail.settled();
  });

  const bearer = (token: string): Headers => ({ authorization: `Bearer ${token}` });

  /** A panel session of `accountId` in workspace a (or `t`). */
  async function sessionOf(accountId: string, t = fx.a): Promise<Headers> {
    return bearer(
      await grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: accountId,
        scopes: ALL_SCOPES,
        kind: 'oauth',
        clientId: t.clientId,
      }),
    );
  }

  function start(headers: Headers, body: Record<string, unknown>) {
    return server.post('/ownership-transfers', body, headers);
  }

  function offerTo(headers: Headers, targetId: string) {
    return start(headers, { target_agent_id: targetId, password: TEST_PASSWORD });
  }

  /** The token of the newest offer mailed to `email`. */
  function offerToken(email: string): string {
    const mail = mailer.sent
      .filter(
        (m) => m.to.toLowerCase() === email.toLowerCase() && /ownership-transfer\?/.test(m.body),
      )
      .at(-1);
    expect(mail, `no offer mail to ${email}`).toBeDefined();
    const match = /https?:\/\/\S+\/app\/ownership-transfer\?\S+/.exec(mail!.body);
    expect(match).not.toBeNull();
    return new URL(match![0]).searchParams.get('token')!;
  }

  function accept(headers: Headers, transferId: string, token: string) {
    return server.post(`/ownership-transfers/${transferId}/accept`, { token }, headers);
  }

  async function roleOf(accountId: string): Promise<string | undefined> {
    const membership = await owner.agentMembership.findUnique({
      where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: accountId } },
      select: { role: true },
    });
    return membership?.role;
  }

  async function auditOf(action: string) {
    return owner.auditLogEntry.findMany({
      where: { licenseId: fx.a.licenseId, action },
      orderBy: { createdAt: 'asc' },
      select: { actorId: true, actorType: true, target: true, metadata: true },
    });
  }

  async function ownersOfA(): Promise<string[]> {
    const rows = await owner.agentMembership.findMany({
      where: { licenseId: fx.a.licenseId, role: 'owner' },
      select: { agentId: true },
    });
    return rows.map((r) => r.agentId);
  }

  // ===========================================================================

  describe('starting one', () => {
    it('is the owner’s alone: an admin and an agent get 403, a personal access token is refused', async () => {
      const asAdmin = await offerTo(await sessionOf(adminId), fx.a.agentAccountId);
      expect(asAdmin.statusCode).toBe(403);
      const asAgent = await offerTo(await sessionOf(fx.a.agentAccountId), adminId);
      expect(asAgent.statusCode).toBe(403);

      const pat = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ALL_SCOPES,
      });
      const byPat = await offerTo(bearer(pat), adminId);
      expect(byPat.statusCode).toBe(403);
      expect(byPat.json().error.details).toMatchObject({ reason: 'session_required' });

      expect(await owner.ownershipTransfer.count()).toBe(0);
      expect(await auditOf('ownership.transfer_requested')).toHaveLength(0);
    });

    it('wants the password again: missing is 400, wrong is 401 and records nothing', async () => {
      const ownerSession = await sessionOf(fx.a.ownerAccountId);
      const missing = await start(ownerSession, { target_agent_id: adminId });
      expect(missing.statusCode).toBe(400);
      const wrong = await start(ownerSession, {
        target_agent_id: adminId,
        password: 'not-the-password-at-all',
      });
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json().error.type).toBe('authentication');
      expect(await owner.ownershipTransfer.count()).toBe(0);
      expect(mailer.sent).toHaveLength(0);
    });

    it('wants the second factor too when it is on: missing, wrong, then a current code', async () => {
      const secret = generateTotpSecret();
      await owner.accountTwoFactor.create({
        data: { accountId: fx.a.ownerAccountId, secret, activatedAt: new Date() },
      });
      const ownerSession = await sessionOf(fx.a.ownerAccountId);

      const missing = await offerTo(ownerSession, adminId);
      expect(missing.statusCode).toBe(401);
      expect(missing.json().error.type).toBe('two_factor_required');

      const wrong = await start(ownerSession, {
        target_agent_id: adminId,
        password: TEST_PASSWORD,
        totp: '000000',
      });
      // A wrong code is a plain 401; `000000` is a real code once in a million.
      expect(wrong.statusCode).toBe(401);

      const right = await start(ownerSession, {
        target_agent_id: adminId,
        password: TEST_PASSWORD,
        totp: generateTotp(secret, Date.now()),
      });
      expect(right.statusCode).toBe(201);
      expect(right.json()).toMatchObject({ transfer: { state: 'pending' }, mail: 'sent' });
    });

    it('records the offer, mails the member a 72-hour single-use link and writes the audit entry', async () => {
      const before = Date.now();
      const started = await offerTo(await sessionOf(fx.a.ownerAccountId), adminId);
      expect(started.statusCode).toBe(201);
      const { transfer } = started.json();
      expect(transfer).toMatchObject({
        state: 'pending',
        from_agent: { id: fx.a.ownerAccountId, email: fx.a.ownerEmail },
        to_agent: { id: adminId, email: adminEmail },
        decided_at: null,
        sso_enforced: false,
      });
      const hours = (Date.parse(transfer.expires_at) - Date.parse(transfer.created_at)) / 3_600_000;
      expect(hours).toBe(72);
      expect(Date.parse(transfer.created_at)).toBeGreaterThanOrEqual(before - 1000);

      // The token is in the mail and nowhere in the database but as a digest.
      const token = offerToken(adminEmail);
      const row = await owner.ownershipTransfer.findUniqueOrThrow({ where: { id: transfer.id } });
      expect(row.tokenHash).not.toContain(token);
      expect(row.tokenHash).toMatch(/^[A-Za-z0-9_-]{43}$/); // SHA-256, base64url

      const [entry] = await auditOf('ownership.transfer_requested');
      expect(entry).toMatchObject({
        actorId: fx.a.ownerAccountId,
        target: `account:${adminId}`,
        metadata: { transfer_id: transfer.id, to_account_id: adminId, to_role: 'admin' },
      });
      expect(JSON.stringify(entry!.metadata)).not.toContain(token);
    });

    it('refuses a member who cannot hold it: suspended, unconfirmed, the owner, another workspace’s', async () => {
      const ownerSession = await sessionOf(fx.a.ownerAccountId);

      const suspended = await offerTo(ownerSession, suspendedId);
      expect(suspended.statusCode).toBe(409);
      expect(suspended.json().error).toMatchObject({
        type: 'ownership_transfer_state',
        details: { reason: 'target_suspended' },
      });

      const unverified = await offerTo(ownerSession, unverifiedId);
      expect(unverified.statusCode).toBe(409);
      expect(unverified.json().error.details).toMatchObject({ reason: 'target_unverified' });

      const self = await offerTo(ownerSession, fx.a.ownerAccountId);
      expect(self.statusCode).toBe(400);
      expect(self.json().error.details).toMatchObject({ reason: 'target_is_owner' });

      // Workspace b's member is not a member here: 404, ids un-enumerable.
      const foreign = await offerTo(ownerSession, fx.b.agentAccountId);
      expect(foreign.statusCode).toBe(404);

      expect(await owner.ownershipTransfer.count()).toBe(0);
    });

    it('refuses a member without a second factor where the workspace requires one', async () => {
      const brand = await seedDefaultBrand(owner, fx.a.licenseId);
      await owner.securitySettings.create({
        data: { licenseId: fx.a.licenseId, brandId: brand, requireTwoFactor: true },
      });
      const ownerSession = await sessionOf(fx.a.ownerAccountId);

      const refused = await offerTo(ownerSession, adminId);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.details).toMatchObject({ reason: 'target_two_factor_required' });

      await owner.accountTwoFactor.create({
        data: { accountId: adminId, secret: generateTotpSecret(), activatedAt: new Date() },
      });
      expect((await offerTo(ownerSession, adminId)).statusCode).toBe(201);
    });

    it('keeps one pending per workspace: a second offer names the first', async () => {
      const ownerSession = await sessionOf(fx.a.ownerAccountId);
      const first = await offerTo(ownerSession, adminId);
      expect(first.statusCode).toBe(201);

      const second = await offerTo(ownerSession, fx.a.agentAccountId);
      expect(second.statusCode).toBe(409);
      expect(second.json().error.details).toMatchObject({
        reason: 'pending_exists',
        transfer_id: first.json().transfer.id,
      });

      // Two at once meet the partial unique index; exactly one is recorded.
      await server.del(`/ownership-transfers/${first.json().transfer.id}`, ownerSession);
      const racing = await Promise.all([
        offerTo(ownerSession, adminId),
        offerTo(ownerSession, fx.a.agentAccountId),
      ]);
      expect(racing.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      expect(
        await owner.ownershipTransfer.count({
          where: { licenseId: fx.a.licenseId, state: 'pending' },
        }),
      ).toBe(1);
    });
  });

  // ===========================================================================

  describe('reading the pending one', () => {
    it('shows it to the owner, the admins and the member offered; anyone else reads null', async () => {
      const otherAgent = await addMember('other-ot@a.test', 'agent');
      const started = await offerTo(await sessionOf(fx.a.ownerAccountId), fx.a.agentAccountId);
      const id = started.json().transfer.id;

      for (const who of [fx.a.ownerAccountId, adminId, fx.a.agentAccountId]) {
        const read = await server.get('/ownership-transfers/current', await sessionOf(who));
        expect(read.statusCode, who).toBe(200);
        expect(read.json().transfer, who).toMatchObject({ id, state: 'pending' });
      }
      const other = await server.get('/ownership-transfers/current', await sessionOf(otherAgent));
      expect(other.statusCode).toBe(200);
      expect(other.json()).toEqual({ transfer: null });

      // Workspace b sees nothing of it.
      const foreign = await server.get(
        '/ownership-transfers/current',
        await sessionOf(fx.b.ownerAccountId, fx.b),
      );
      expect(foreign.json()).toEqual({ transfer: null });
    });
  });

  // ===========================================================================

  describe('accepting', () => {
    it('swaps the roles in one step: the member owns it, the previous owner is an admin — live on both sessions', async () => {
      const ownerSession = await sessionOf(fx.a.ownerAccountId);
      const started = await offerTo(ownerSession, fx.a.agentAccountId);
      const id = started.json().transfer.id;
      const token = offerToken(fx.a.agentEmail);
      const memberSession = await sessionOf(fx.a.agentAccountId);
      mailer.clear();

      const accepted = await accept(memberSession, id, token);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json()).toMatchObject({
        transfer: { id, state: 'accepted' },
        billing_contact: 'none',
      });
      expect(accepted.json().transfer.decided_at).not.toBeNull();

      expect(await roleOf(fx.a.agentAccountId)).toBe('owner');
      expect(await roleOf(fx.a.ownerAccountId)).toBe('admin');
      expect(await ownersOfA()).toEqual([fx.a.agentAccountId]);

      // The role is read from the membership on every request: the sessions
      // they already hold changed with it. The previous owner can no longer
      // offer the workspace; the new one can.
      expect((await offerTo(ownerSession, adminId)).statusCode).toBe(403);
      expect((await offerTo(memberSession, adminId)).statusCode).toBe(201);

      const [entry] = await auditOf('ownership.transfer_accepted');
      expect(entry).toMatchObject({
        actorId: fx.a.agentAccountId,
        target: `account:${fx.a.agentAccountId}`,
        metadata: {
          transfer_id: id,
          from_account_id: fx.a.ownerAccountId,
          to_account_id: fx.a.agentAccountId,
          from_role: 'owner',
          from_role_now: 'admin',
          to_previous_role: 'agent',
          billing_contact: 'none',
          sso_enforced: false,
        },
      });

      // Both parties and every admin are told; the token is spent.
      await server.app.backgroundMail.settled();
      const told = mailer.sent
        .filter((m) => /is now the owner of|yeni Kurucusu/.test(m.subject))
        .map((m) => m.to)
        .sort();
      expect(told).toEqual([adminEmail, fx.a.agentEmail, fx.a.ownerEmail].sort());
      const again = await accept(memberSession, id, token);
      expect(again.statusCode).toBe(409);
      expect(again.json().error.details).toMatchObject({
        reason: 'not_pending',
        state: 'accepted',
      });
    });

    it('takes a team lead off the teams they led, since the owner leads none', async () => {
      const lead = await addMember('lead-ot@a.test', 'team_lead');
      const group = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'VIP' },
        select: { id: true },
      });
      await owner.groupAgent.create({
        data: { licenseId: fx.a.licenseId, groupId: group.id, agentId: lead, isLead: true },
      });
      const started = await offerTo(await sessionOf(fx.a.ownerAccountId), lead);
      const accepted = await accept(
        await sessionOf(lead),
        started.json().transfer.id,
        offerToken('lead-ot@a.test'),
      );
      expect(accepted.statusCode).toBe(200);
      const mark = await owner.groupAgent.findFirstOrThrow({
        where: { groupId: group.id, agentId: lead },
        select: { isLead: true },
      });
      expect(mark.isLead).toBe(false);
    });

    it('is the offered member’s alone, with the right token', async () => {
      const started = await offerTo(await sessionOf(fx.a.ownerAccountId), fx.a.agentAccountId);
      const id = started.json().transfer.id;
      const token = offerToken(fx.a.agentEmail);

      const byAdmin = await accept(await sessionOf(adminId), id, token);
      expect(byAdmin.statusCode).toBe(403);
      const byOwner = await accept(await sessionOf(fx.a.ownerAccountId), id, token);
      expect(byOwner.statusCode).toBe(403);

      const wrongToken = await accept(await sessionOf(fx.a.agentAccountId), id, `${token}x`);
      expect(wrongToken.statusCode).toBe(403);
      expect(wrongToken.json().error).toMatchObject({
        type: 'not_allowed',
        details: { reason: 'invalid_token' },
      });

      // Another workspace's session cannot reach it at all.
      const foreign = await accept(await sessionOf(fx.b.ownerAccountId, fx.b), id, token);
      expect(foreign.statusCode).toBe(404);

      expect(await roleOf(fx.a.ownerAccountId)).toBe('owner');
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');
    });

    it('lets exactly one of two simultaneous acceptances through, and the index holds one owner', async () => {
      const started = await offerTo(await sessionOf(fx.a.ownerAccountId), fx.a.agentAccountId);
      const id = started.json().transfer.id;
      const token = offerToken(fx.a.agentEmail);
      const memberSession = await sessionOf(fx.a.agentAccountId);

      const both = await Promise.all([
        accept(memberSession, id, token),
        accept(memberSession, id, token),
      ]);
      expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
      expect(await ownersOfA()).toEqual([fx.a.agentAccountId]);
      expect(await auditOf('ownership.transfer_accepted')).toHaveLength(1);
    });

    it('refuses a member who cannot hold it any more, and leaves the transfer pending', async () => {
      const started = await offerTo(await sessionOf(fx.a.ownerAccountId), fx.a.agentAccountId);
      const id = started.json().transfer.id;
      const token = offerToken(fx.a.agentEmail);
      const memberSession = await sessionOf(fx.a.agentAccountId);
      const where = {
        licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.agentAccountId },
      };

      // Address unconfirmed since (an e-mail change, say): the transfer's own check.
      await owner.account.update({
        where: { id: fx.a.agentAccountId },
        data: { emailVerifiedAt: null },
      });
      const unverified = await accept(memberSession, id, token);
      expect(unverified.statusCode).toBe(409);
      expect(unverified.json().error.details).toMatchObject({ reason: 'target_unverified' });

      // Suspended since: refused at the door already — no session of theirs
      // reaches the transfer.
      await owner.account.update({
        where: { id: fx.a.agentAccountId },
        data: { emailVerifiedAt: new Date() },
      });
      await owner.agentMembership.update({ where, data: { suspended: true } });
      const suspended = await accept(memberSession, id, token);
      expect(suspended.statusCode).toBe(401);

      expect(await roleOf(fx.a.ownerAccountId)).toBe('owner');
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');
      const row = await owner.ownershipTransfer.findUniqueOrThrow({ where: { id } });
      expect(row.state).toBe('pending');
    });

    it('cancels it when the owner changed meanwhile (the root panel moved the workspace)', async () => {
      const started = await offerTo(await sessionOf(fx.a.ownerAccountId), fx.a.agentAccountId);
      const id = started.json().transfer.id;
      const token = offerToken(fx.a.agentEmail);
      // The forced transfer's effect, as the platform process leaves it.
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: fx.a.ownerAccountId } },
        data: { role: 'admin' },
      });
      await owner.agentMembership.update({
        where: { licenseId_agentId: { licenseId: fx.a.licenseId, agentId: adminId } },
        data: { role: 'owner' },
      });

      const refused = await accept(await sessionOf(fx.a.agentAccountId), id, token);
      expect(refused.statusCode).toBe(409);
      expect(refused.json().error.details).toMatchObject({ reason: 'owner_changed' });
      expect(await ownersOfA()).toEqual([adminId]);
      const row = await owner.ownershipTransfer.findUniqueOrThrow({ where: { id } });
      expect(row.state).toBe('cancelled');
      const [entry] = await auditOf('ownership.transfer_cancelled');
      expect(entry).toMatchObject({
        actorType: 'system',
        metadata: { transfer_id: id, cause: 'owner_changed' },
      });
    });

    it('moves the billing contact when it was the previous owner’s address, and keeps any other', async () => {
      await owner.billingProfile.create({
        data: {
          licenseId: fx.a.licenseId,
          legalName: 'Acme Ltd',
          addressLine1: '1 Main St',
          city: 'London',
          country: 'GB',
          invoiceEmail: fx.a.ownerEmail.toUpperCase(),
        },
      });
      let started = await offerTo(await sessionOf(fx.a.ownerAccountId), fx.a.agentAccountId);
      let accepted = await accept(
        await sessionOf(fx.a.agentAccountId),
        started.json().transfer.id,
        offerToken(fx.a.agentEmail),
      );
      expect(accepted.json().billing_contact).toBe('moved');
      let profile = await owner.billingProfile.findUniqueOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(profile.invoiceEmail).toBe(fx.a.agentEmail);

      await owner.billingProfile.update({
        where: { licenseId: fx.a.licenseId },
        data: { invoiceEmail: 'accounts@acme.test' },
      });
      started = await offerTo(await sessionOf(fx.a.agentAccountId), adminId);
      accepted = await accept(
        await sessionOf(adminId),
        started.json().transfer.id,
        offerToken(adminEmail),
      );
      expect(accepted.json().billing_contact).toBe('kept');
      profile = await owner.billingProfile.findUniqueOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(profile.invoiceEmail).toBe('accounts@acme.test');
    });

    it('under an enforced identity provider: the new owner keeps the password door, the previous owner loses it', async () => {
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
      const ownerSession = await sessionOf(fx.a.ownerAccountId);
      const started = await offerTo(ownerSession, adminId);
      expect(started.json().transfer.sso_enforced).toBe(true);
      const adminSession = await sessionOf(adminId);
      const accepted = await accept(
        adminSession,
        started.json().transfer.id,
        offerToken(adminEmail),
      );
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().transfer.sso_enforced).toBe(true);

      // The owner's break-glass moved with the role (`POST /auth/password` is
      // held to the same rule as the sign-in).
      const change = (headers: Headers) =>
        server.post(
          '/auth/password',
          { current_password: TEST_PASSWORD, new_password: 'a-brand-new-long-password' },
          headers,
        );
      const previous = await change(ownerSession);
      expect(previous.statusCode).toBe(403);
      expect(previous.json().error.details).toMatchObject({ reason: 'sso_enforced' });
      expect((await change(adminSession)).statusCode).toBe(204);

      await server.app.backgroundMail.settled();
      const toPrevious = mailer.sent.find(
        (m) => m.to === fx.a.ownerEmail && /now the owner/.test(m.subject),
      );
      expect(toPrevious?.body).toContain('signs in through the identity provider');
    });
  });

  // ===========================================================================

  describe('72 hours and cancelling', () => {
    /** Move a transfer's clock back so its 72 hours have passed. */
    async function age(id: string, hours: number): Promise<void> {
      const shift = hours * 3_600_000;
      const row = await owner.ownershipTransfer.findUniqueOrThrow({ where: { id } });
      await owner.ownershipTransfer.update({
        where: { id },
        data: {
          createdAt: new Date(row.createdAt.getTime() - shift),
          expiresAt: new Date(row.expiresAt.getTime() - shift),
        },
      });
    }

    it('lapses after 72 hours: not accepted, not shown, expired once by the system, and a new offer is possible', async () => {
      const ownerSession = await sessionOf(fx.a.ownerAccountId);
      const started = await offerTo(ownerSession, fx.a.agentAccountId);
      const id = started.json().transfer.id;
      const token = offerToken(fx.a.agentEmail);
      await age(id, 72);

      const late = await accept(await sessionOf(fx.a.agentAccountId), id, token);
      expect(late.statusCode).toBe(409);
      expect(late.json().error.details).toMatchObject({ reason: 'not_pending', state: 'expired' });
      expect(await roleOf(fx.a.ownerAccountId)).toBe('owner');

      const read = await server.get('/ownership-transfers/current', ownerSession);
      expect(read.json()).toEqual({ transfer: null });
      const row = await owner.ownershipTransfer.findUniqueOrThrow({ where: { id } });
      expect(row.state).toBe('expired');
      expect(row.decidedAt?.getTime()).toBe(row.expiresAt.getTime());

      const expired = await auditOf('ownership.transfer_expired');
      expect(expired).toHaveLength(1);
      expect(expired[0]).toMatchObject({
        actorType: 'system',
        actorId: null,
        target: `ownership_transfer:${id}`,
      });

      expect((await offerTo(ownerSession, adminId)).statusCode).toBe(201);
    });

    it('is still open at 71 hours', async () => {
      const started = await offerTo(await sessionOf(fx.a.ownerAccountId), fx.a.agentAccountId);
      const id = started.json().transfer.id;
      await age(id, 71);
      const accepted = await accept(
        await sessionOf(fx.a.agentAccountId),
        id,
        offerToken(fx.a.agentEmail),
      );
      expect(accepted.statusCode).toBe(200);
    });

    it('can be cancelled by the owner — the member is told and the link is dead; not by anyone else', async () => {
      const ownerSession = await sessionOf(fx.a.ownerAccountId);
      const started = await offerTo(ownerSession, fx.a.agentAccountId);
      const id = started.json().transfer.id;
      const token = offerToken(fx.a.agentEmail);

      expect(
        (await server.del(`/ownership-transfers/${id}`, await sessionOf(adminId))).statusCode,
      ).toBe(403);
      expect(
        (await server.del(`/ownership-transfers/${id}`, await sessionOf(fx.a.agentAccountId)))
          .statusCode,
      ).toBe(403);

      const cancelled = await server.del(`/ownership-transfers/${id}`, ownerSession);
      expect(cancelled.statusCode).toBe(204);
      const again = await server.del(`/ownership-transfers/${id}`, ownerSession);
      expect(again.statusCode).toBe(409);
      expect(again.json().error.details).toMatchObject({
        reason: 'not_pending',
        state: 'cancelled',
      });

      const late = await accept(await sessionOf(fx.a.agentAccountId), id, token);
      expect(late.statusCode).toBe(409);
      expect(await roleOf(fx.a.agentAccountId)).toBe('agent');

      const [entry] = await auditOf('ownership.transfer_cancelled');
      expect(entry).toMatchObject({
        actorId: fx.a.ownerAccountId,
        metadata: { transfer_id: id, cause: 'owner' },
      });
      await server.app.backgroundMail.settled();
      expect(mailer.sent.some((m) => m.to === fx.a.agentEmail && /cancelled/.test(m.subject))).toBe(
        true,
      );

      // A transfer is never deleted: the app role holds no DELETE on the table.
      expect(await owner.ownershipTransfer.count({ where: { id } })).toBe(1);
    });
  });
});
