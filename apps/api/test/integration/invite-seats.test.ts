/**
 * A console invitation reaches the bill (PRD FR-MOD-04.4, last acceptance
 * criterion: "koltuk faturaya yansır").
 *
 * Everything else in that criterion — several addresses at once, the inline
 * invalid-address error, the default role, role pre-assignment, the discard
 * confirmation, the role-ceiling refusal — has been in `account-lifecycle.test.ts`
 * since the modal was built. This file is the one sentence that was missing, and
 * it is a money path, so it is written as a set of claims rather than a set of
 * calls:
 *
 *   1. **The bill follows the person, and only once they arrive.** Accepting an
 *      invitation raises the purchased seat count to the new headcount, in the
 *      same transaction as the membership, and says so in the trail.
 *   2. **Both doors charge the same.** A teammate who joins from the console and
 *      one provisioned over SCIM leave the workspace with the identical seat
 *      count. One product, one billing truth — the defect this file closes was
 *      precisely two.
 *   3. **What never arrives is never charged.** A revoked invitation, an expired
 *      one, and a second acceptance of a spent token all leave the number where
 *      it was. This is the half that is normally implemented as a compensating
 *      "release the seat" path; counting at the join means there is nothing to
 *      release, and these tests are what makes that claim checkable rather than
 *      asserted.
 *   4. **Growth nobody is watching has a ceiling, and it is spoken.** The
 *      refusal lands at `POST /invitations`, where an administrator is present,
 *      and never on the person holding the link.
 */
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SEAT_CEILING } from '../../src/lib/entitlements.js';
import {
  grantToken,
  ownerClient,
  proveSsoDomains,
  seedFixtures,
  seedSubscription,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const STRONG_PASSWORD = 'a-quite-long-passphrase';

/** Owner + agent, written by `seedTenant` before any test runs. */
const SEEDED_HEADCOUNT = 2;

describe('invited seats reach the bill (FR-MOD-04.4)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;
  let ownerToken: string;

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
    // No `plan`, so neither tenant has a subscription row: each test says
    // explicitly whether this workspace has bought anything, because "trial" and
    // "subscribed" are the two answers the seat rule differs on.
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    ownerToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--all:rw'],
    });
  });

  const seatsOf = async (licenseId = fx.a.licenseId) =>
    (await owner.subscription.findFirst({ where: { licenseId } }))?.seats ?? null;

  const entriesFor = (action: string, licenseId = fx.a.licenseId) =>
    owner.auditLogEntry.findMany({ where: { licenseId, action }, orderBy: { createdAt: 'asc' } });

  /** The token only ever exists in the create response. */
  async function inviteOne(email: string, role: 'admin' | 'agent' = 'agent') {
    const response = await server.post('/invitations', { emails: [email], role }, auth(ownerToken));
    expect(response.statusCode).toBe(201);
    const body = response.json() as { items: Array<{ id: string; accept_url: string }> };
    const item = body.items[0]!;
    return { id: item.id, token: new URL(item.accept_url).searchParams.get('token')! };
  }

  async function join(token: string, name = 'Newcomer') {
    return server.post('/auth/invitations/accept', { token, name, password: STRONG_PASSWORD });
  }

  /**
   * Push a workspace's active headcount up without going through either door.
   *
   * The ceiling tests need a workspace already sitting near {@link SEAT_CEILING}
   * before the request under test; inviting that many people one call at a time
   * would make the setup the slow part rather than the assertion. Borrowed from
   * `scim.test.ts`, which needs the same thing for the same reason.
   */
  async function addActiveMembers(count: number, prefix: string): Promise<void> {
    const ids = Array.from({ length: count }, () => randomUUID());
    await owner.account.createMany({
      data: ids.map((id, i) => ({
        id,
        email: `${prefix}-${i}@example.test`,
        name: `${prefix} ${i}`,
      })),
    });
    await owner.agentMembership.createMany({
      data: ids.map((id) => ({ licenseId: fx.a.licenseId, agentId: id, role: 'agent' })),
    });
  }

  // =========================================================================
  // 1. The bill follows the person
  // =========================================================================

  describe('joining raises the purchased seat count', () => {
    it('raises seats to the new headcount and records why (FR-MOD-04.4)', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      expect(await seatsOf()).toBe(SEEDED_HEADCOUNT);

      const invite = await inviteOne('newcomer@example.test');
      // Still two: an invitation is not a seat. The person has not arrived.
      expect(await seatsOf()).toBe(SEEDED_HEADCOUNT);

      expect((await join(invite.token)).statusCode).toBe(200);
      expect(await seatsOf()).toBe(SEEDED_HEADCOUNT + 1);

      const [entry, ...rest] = await entriesFor('billing.subscription_updated');
      expect(rest).toHaveLength(0);
      expect(entry!.metadata).toMatchObject({
        fields: ['seats'],
        from: SEEDED_HEADCOUNT,
        to: SEEDED_HEADCOUNT + 1,
        via: 'invitation',
      });
    });

    it('leaves a workspace that has already bought enough seats alone', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      await owner.subscription.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { seats: 9 },
      });

      const invite = await inviteOne('spare-seat@example.test');
      expect((await join(invite.token)).statusCode).toBe(200);

      // Seats only ever go *up* to meet headcount; lowering is a downgrade the
      // workspace makes deliberately at `PATCH /billing/subscription`.
      expect(await seatsOf()).toBe(9);
      expect(await entriesFor('billing.subscription_updated')).toHaveLength(0);
    });

    it('does not turn a trial into a subscription', async () => {
      // No subscription row means nothing has been bought; both the billing view
      // and the invoice already fall back to live headcount for it. Writing a row
      // here would make an invitation the moment a trial started looking paid.
      const invite = await inviteOne('trialist@example.test');
      expect((await join(invite.token)).statusCode).toBe(200);

      expect(await owner.subscription.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      expect(await entriesFor('billing.subscription_updated')).toHaveLength(0);
    });

    it("cannot move another workspace's seats", async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      await seedSubscription(owner, fx.b.licenseId, 'growth');

      const invite = await inviteOne('crosser@example.test');
      expect((await join(invite.token)).statusCode).toBe(200);

      expect(await seatsOf(fx.a.licenseId)).toBe(SEEDED_HEADCOUNT + 1);
      expect(await seatsOf(fx.b.licenseId)).toBe(SEEDED_HEADCOUNT);
    });

    it('commits the seat with the membership, not after it', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      const invite = await inviteOne('atomic@example.test');
      await join(invite.token);

      // The state `updateSubscription`'s floor (FR-MOD-10.1.3) refuses to save is
      // seats < headcount, and it is exactly what a membership committing without
      // its seat would leave behind: the next admin to touch the billing cycle
      // would be stopped by a number nobody chose. Asserting the two together is
      // the closest a test gets to asserting the transaction boundary.
      const headcount = await owner.agentMembership.count({
        where: { licenseId: fx.a.licenseId, suspended: false },
      });
      expect(await seatsOf()).toBe(headcount);
    });
  });

  // =========================================================================
  // 2. Both doors charge the same
  // =========================================================================

  describe('the console and the directory agree', () => {
    /**
     * Give a workspace an identity provider that has verified `example.test`.
     * Provisioning is confined to the domains a workspace's SSO connections
     * declare (§D116 MEDIUM (a)), and both fixture tenants live there.
     */
    async function verifyDomains(licenseId: bigint): Promise<void> {
      const row = await owner.ssoConnection.create({
        data: {
          licenseId,
          name: 'Directory',
          idpEntityId: `https://idp.example.test/${licenseId}`,
          idpSsoUrl: 'https://idp.example.test/sso',
          idpCertificatePem: '-----BEGIN CERTIFICATE-----\nunused\n-----END CERTIFICATE-----\n',
          verifiedDomains: ['example.test'],
        },
        select: { id: true },
      });
      await proveSsoDomains(owner, row.id);
    }

    it('charges an invited teammate exactly what SCIM charges for the same person', async () => {
      // Both workspaces start identically: same headcount, same seats, and on the
      // plan SCIM needs (`sso` is Enterprise, FR-MOD-11.5) so the two paths differ
      // in nothing but the door.
      await seedSubscription(owner, fx.a.licenseId, 'enterprise');
      await seedSubscription(owner, fx.b.licenseId, 'enterprise');
      await verifyDomains(fx.b.licenseId);

      // Door 1 — the console, in workspace A.
      const invite = await inviteOne('parity@example.test');
      expect((await join(invite.token)).statusCode).toBe(200);

      // Door 2 — a directory, in workspace B.
      const scimB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        kind: 'scim',
        scopes: [],
      });
      const provisioned = await server.post(
        '/scim/v2/Users',
        { userName: 'parity-scim@example.test' },
        { ...auth(scimB), 'content-type': 'application/scim+json' },
      );
      expect(provisioned.statusCode).toBe(201);

      expect(await seatsOf(fx.a.licenseId)).toBe(SEEDED_HEADCOUNT + 1);
      expect(await seatsOf(fx.a.licenseId)).toBe(await seatsOf(fx.b.licenseId));

      // …and both say it happened with the same word, so an auditor totalling a
      // year of seat changes does not have to know which door each came through.
      const [fromInvite] = await entriesFor('billing.subscription_updated', fx.a.licenseId);
      const [fromScim] = await entriesFor('billing.subscription_updated', fx.b.licenseId);
      const moved = { fields: ['seats'], from: SEEDED_HEADCOUNT, to: SEEDED_HEADCOUNT + 1 };
      expect(fromInvite!.metadata).toMatchObject(moved);
      expect(fromScim!.metadata).toMatchObject(moved);
    });
  });

  // =========================================================================
  // 3. What never arrives is never charged
  // =========================================================================

  describe('an invitation that is not accepted never reaches the bill', () => {
    it('charges nothing for a revoked invitation', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      const invite = await inviteOne('revoked@example.test');

      expect((await server.del(`/invitations/${invite.id}`, auth(ownerToken))).statusCode).toBe(
        204,
      );
      expect((await join(invite.token)).statusCode).toBe(401);

      // No seat was ever counted, so there is no seat to give back — the whole
      // reason the count happens at the join and not at the invitation.
      expect(await seatsOf()).toBe(SEEDED_HEADCOUNT);
      expect(await entriesFor('billing.subscription_updated')).toHaveLength(0);
    });

    it('charges nothing for an invitation that expires', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      const invite = await inviteOne('lapsed@example.test');
      await owner.invitation.update({
        where: { id: invite.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      expect((await join(invite.token)).statusCode).toBe(401);
      expect(await seatsOf()).toBe(SEEDED_HEADCOUNT);
    });

    it('charges once when the same invitation is accepted twice', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      const invite = await inviteOne('twice@example.test');

      expect((await join(invite.token)).statusCode).toBe(200);
      // The token is spent by the first call, so the second never reaches the
      // seat raise at all. Belt and braces: the raise sets seats *to* the
      // headcount rather than incrementing them, so even a second pass through
      // it would land on the same number.
      expect((await join(invite.token)).statusCode).toBe(401);

      expect(await seatsOf()).toBe(SEEDED_HEADCOUNT + 1);
      expect(await entriesFor('billing.subscription_updated')).toHaveLength(1);
    });

    it('charges nothing when the invitee is already a member', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      // Re-inviting somebody who is already in the workspace: the membership
      // insert conflicts and does nothing, so headcount does not move and neither
      // does the bill.
      const invite = await inviteOne(fx.a.agentEmail);
      expect(
        (await server.post('/auth/invitations/accept', { token: invite.token })).statusCode,
      ).toBe(200);

      expect(await seatsOf()).toBe(SEEDED_HEADCOUNT);
      expect(await entriesFor('billing.subscription_updated')).toHaveLength(0);
    });
  });

  // =========================================================================
  // 4. The ceiling, and where it is spoken
  // =========================================================================

  describe('the seat ceiling', () => {
    it('refuses invitations that would commit the workspace past the ceiling, and writes nothing', async () => {
      await addActiveMembers(SEAT_CEILING - SEEDED_HEADCOUNT, 'filler');

      const res = await server.post(
        '/invitations',
        { emails: ['over-ceiling@example.test'], role: 'agent' },
        auth(ownerToken),
      );
      expect(res.statusCode).toBe(429);
      expect((res.json() as { error: { type: string } }).error.type).toBe('users_limit_reached');
      // The refusal names the number, so it is a fact the admin can act on rather
      // than a wall (`sessizce reddetmek de yanlış`).
      expect((res.json() as { error: { message: string } }).error.message).toContain(
        String(SEAT_CEILING),
      );

      // Refused *before* the write: no invitation row, no trail, nothing to
      // revoke afterwards.
      expect(await owner.invitation.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
      expect(await entriesFor('member.invited')).toHaveLength(0);
    });

    it('lets through the invitation that brings the workspace exactly to the ceiling', async () => {
      await addActiveMembers(SEAT_CEILING - SEEDED_HEADCOUNT - 1, 'filler');

      const res = await server.post(
        '/invitations',
        { emails: ['at-ceiling@example.test'], role: 'agent' },
        auth(ownerToken),
      );
      expect(res.statusCode).toBe(201);
    });

    it('counts outstanding invitations, not just members', async () => {
      // Two short of the ceiling with one invitation already live: the workspace
      // has committed to `ceiling`, so the next address is one too many even
      // though nobody has joined.
      await addActiveMembers(SEAT_CEILING - SEEDED_HEADCOUNT - 1, 'filler');
      expect(
        (
          await server.post(
            '/invitations',
            { emails: ['first@example.test'], role: 'agent' },
            auth(ownerToken),
          )
        ).statusCode,
      ).toBe(201);

      const second = await server.post(
        '/invitations',
        { emails: ['second@example.test'], role: 'agent' },
        auth(ownerToken),
      );
      expect(second.statusCode).toBe(429);
    });

    it('does not count a re-invitation of an address that already has a live link', async () => {
      await addActiveMembers(SEAT_CEILING - SEEDED_HEADCOUNT - 1, 'filler');
      await inviteOne('again@example.test');

      // The insert replaces the outstanding invitation rather than adding a
      // second one, so counting it twice here would refuse a workspace for a seat
      // it was never going to buy.
      const again = await server.post(
        '/invitations',
        { emails: ['again@example.test'], role: 'agent' },
        auth(ownerToken),
      );
      expect(again.statusCode).toBe(201);
    });

    it('never refuses the person holding the link', async () => {
      // The invitation is created while there is room, and the workspace then
      // grows past the ceiling by another route. The invitee did nothing wrong,
      // cannot buy seats and cannot revoke anybody — so the join still works.
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      const invite = await inviteOne('late-arrival@example.test');
      await addActiveMembers(SEAT_CEILING - SEEDED_HEADCOUNT + 1, 'overflow');

      expect((await join(invite.token)).statusCode).toBe(200);
      expect(await seatsOf()).toBeGreaterThan(SEAT_CEILING);
    });
  });

  // =========================================================================
  // The console-facing half: what the modal is able to say before the click
  // =========================================================================

  describe('GET /invitations reports what an invitation would cost', () => {
    const seatsBlock = async () => {
      const res = await server.get('/invitations', auth(ownerToken));
      expect(res.statusCode).toBe(200);
      return (
        res.json() as {
          seats: {
            headcount: number;
            purchased: number | null;
            unit_price_cents: number | null;
            ceiling: number;
          };
        }
      ).seats;
    };

    it('reports headcount, seats bought and the list price (FR-MOD-04.4)', async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      expect(await seatsBlock()).toEqual({
        headcount: SEEDED_HEADCOUNT,
        purchased: SEEDED_HEADCOUNT,
        unit_price_cents: 9900,
        ceiling: SEAT_CEILING,
      });
    });

    it('reports no purchased figure on a trial — joining costs nothing yet', async () => {
      expect(await seatsBlock()).toMatchObject({ purchased: null, headcount: SEEDED_HEADCOUNT });
    });

    it('quotes no price on a quoted plan rather than inventing one', async () => {
      // Enterprise is priced in a contract this deployment never sees (ADR-13).
      await seedSubscription(owner, fx.a.licenseId, 'enterprise');
      expect((await seatsBlock()).unit_price_cents).toBeNull();
    });

    it("never reports another workspace's numbers", async () => {
      await seedSubscription(owner, fx.a.licenseId, 'growth');
      await seedSubscription(owner, fx.b.licenseId, 'growth');
      await addActiveMembers(3, 'ours');
      await owner.subscription.updateMany({
        where: { licenseId: fx.b.licenseId },
        data: { seats: 40 },
      });

      expect(await seatsBlock()).toMatchObject({
        headcount: SEEDED_HEADCOUNT + 3,
        purchased: SEEDED_HEADCOUNT,
      });
    });
  });
});
