/**
 * HIPAA Business Associate Agreement (NFR-C4 · C4-d).
 *
 * PRD NFR-C4 makes HIPAA cover conditional on two things *together*: a signed
 * BAA and US hosting. So the interesting tests here are not "can the owner
 * accept" — they are the pairs where one half is present and the other is not.
 * A signed BAA on a European workspace would be a document asserting something
 * false about where the data lives, and C4-e reads this timestamp to decide
 * what it constrains; a value it can hold without the region being `us` would
 * make those constraints answer the wrong question.
 *
 * The signature is mocked (CLAUDE.md). Nothing here tests a contract text or a
 * signature provider, because there is none — the fact under test is that the
 * platform records an acceptance, refuses the ones it must, and says so in the
 * audit trail exactly once.
 *
 * The region rule is attacked at the database as well as through the endpoint,
 * for the reason §C-A20.3 gives for region immutability: a guard that lives
 * only in a service is one new call site away from being absent, and the seed,
 * a migration and a psql session are all such call sites.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  seedSubscription,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('HIPAA BAA (C4-d)', () => {
  /** The European deployment — where fixture tenants A and B live. */
  let server: TestServer;
  /** The same build configured as the US deployment, for `us` workspaces. */
  let usServer: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
    usServer = await startTestServer({ NEXA_REGION: 'us' });
  });

  afterAll(async () => {
    await Promise.all([server.close(), usServer.close()]);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await clearRateLimits(usServer.app);
  });

  interface UsTenant {
    organizationId: string;
    licenseId: bigint;
    ownerAccountId: string;
    adminAccountId: string;
    ownerToken: string;
    adminToken: string;
  }

  /**
   * A workspace that genuinely lives in `us`, with both an owner and an admin.
   *
   * Built directly rather than through signup because the pair of credentials
   * is the point: `exactRole: 'owner'` is only proved by an admin of the *same*
   * workspace being refused, and signup mints one owner and nobody else.
   *
   * On Enterprise, because HIPAA cover is (NFR-C4, "Şartlı — Enterprise") and
   * `POST /settings/compliance/baa` is gated on the `hipaa` entitlement
   * (FR-MOD-11.5). This suite proves C4-d's region and role rules, which need
   * the request to get past the plan first; that the plan itself refuses is
   * `entitlements.test.ts`'s claim, on a `growth` workspace built the same way.
   */
  async function seedUsTenant(suffix = 'one'): Promise<UsTenant> {
    const organization = await owner.organization.create({
      data: { name: `Org US ${suffix}`, region: 'us' },
      select: { id: true },
    });
    const license = await owner.license.create({
      data: { organizationId: organization.id, plan: 'enterprise', status: 'active' },
      select: { id: true },
    });
    await seedSubscription(owner, license.id, 'enterprise');
    const ownerAccount = await owner.account.create({
      data: { email: `owner-us-${suffix}@example.test`, name: 'Owner US' },
      select: { id: true },
    });
    const adminAccount = await owner.account.create({
      data: { email: `admin-us-${suffix}@example.test`, name: 'Admin US' },
      select: { id: true },
    });
    await owner.agentMembership.createMany({
      data: [
        { licenseId: license.id, agentId: ownerAccount.id, role: 'owner' },
        { licenseId: license.id, agentId: adminAccount.id, role: 'admin' },
      ],
    });

    const scopes = ['access_rules:ro', 'access_rules:rw'];
    const [ownerToken, adminToken] = await Promise.all([
      grantToken(owner, {
        licenseId: license.id,
        organizationId: organization.id,
        ownerId: ownerAccount.id,
        scopes,
      }),
      grantToken(owner, {
        licenseId: license.id,
        organizationId: organization.id,
        ownerId: adminAccount.id,
        scopes,
      }),
    ]);

    return {
      organizationId: organization.id,
      licenseId: license.id,
      ownerAccountId: ownerAccount.id,
      adminAccountId: adminAccount.id,
      ownerToken,
      adminToken,
    };
  }

  /** A token for tenant A's owner — a European workspace, by fixture. */
  function euOwnerToken(): Promise<string> {
    return grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro', 'access_rules:rw'],
    });
  }

  function accept(target: TestServer, token: string): ReturnType<TestServer['post']> {
    return target.post(
      '/settings/compliance/baa',
      { accepted: true },
      { authorization: `Bearer ${token}` },
    );
  }

  function signedAtOf(licenseId: bigint): Promise<Date | null | undefined> {
    return owner.license
      .findUnique({ where: { id: licenseId }, select: { hipaaBaaSignedAt: true } })
      .then((row) => row?.hipaaBaaSignedAt);
  }

  function baaEntries(licenseId: bigint) {
    return owner.auditLogEntry.findMany({
      where: { licenseId, action: 'compliance.baa_signed' },
    });
  }

  // =========================================================================
  // The one path that works
  // =========================================================================

  describe('a US workspace, accepted by its owner', () => {
    it('records the acceptance and says so in the audit trail', async () => {
      const us = await seedUsTenant();

      const response = await accept(usServer, us.ownerToken);

      expect(response.statusCode).toBe(200);
      const body = response.json() as {
        region: string;
        baa_available: boolean;
        hipaa_baa_signed_at: string | null;
      };
      expect(body.region).toBe('us');
      expect(body.baa_available).toBe(true);
      expect(body.hipaa_baa_signed_at).not.toBeNull();

      // The claim is about the row, not the response: an endpoint that answers
      // with a timestamp it never stored would pass a body-only assertion.
      const stored = await signedAtOf(us.licenseId);
      expect(stored).toBeInstanceOf(Date);
      expect(stored?.toISOString()).toBe(body.hipaa_baa_signed_at);

      const entries = await baaEntries(us.licenseId);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.actorId).toBe(us.ownerAccountId);
      expect(entries[0]?.target).toBe(`license:${us.licenseId}`);
      // The region belongs in the entry: it is the other half of the condition
      // that made the acceptance permissible.
      expect(entries[0]?.metadata).toMatchObject({ region: 'us' });
    });

    it('keeps the first date, and does not log a second agreement', async () => {
      // "Covered from" is a date somebody relies on. A second click is not a
      // second agreement, so neither the timestamp nor the trail may move.
      const us = await seedUsTenant();

      const first = await accept(usServer, us.ownerToken);
      const firstDate = (first.json() as { hipaa_baa_signed_at: string }).hipaa_baa_signed_at;

      const second = await accept(usServer, us.ownerToken);

      expect(second.statusCode).toBe(200);
      expect((second.json() as { hipaa_baa_signed_at: string }).hipaa_baa_signed_at).toBe(
        firstDate,
      );
      expect((await signedAtOf(us.licenseId))?.toISOString()).toBe(firstDate);
      expect(await baaEntries(us.licenseId)).toHaveLength(1);
    });

    it('reports the state on the read endpoint, before and after', async () => {
      const us = await seedUsTenant();

      const before = await usServer.get('/settings/compliance', {
        authorization: `Bearer ${us.ownerToken}`,
      });
      expect(before.statusCode).toBe(200);
      expect(before.json()).toEqual({
        region: 'us',
        baa_available: true,
        hipaa_baa_signed_at: null,
      });

      await accept(usServer, us.ownerToken);

      const after = await usServer.get('/settings/compliance', {
        authorization: `Bearer ${us.ownerToken}`,
      });
      expect(
        (after.json() as { hipaa_baa_signed_at: string | null }).hipaa_baa_signed_at,
      ).not.toBeNull();
    });
  });

  // =========================================================================
  // Authority — §C-A20: owner only, admin is not enough
  // =========================================================================

  describe('who may accept', () => {
    it('refuses an admin of the same workspace', async () => {
      // Not a rank test: the admin here can already write every other setting
      // behind `access_rules:rw`. Committing the organisation to a compliance
      // obligation is the one that stops at the owner.
      const us = await seedUsTenant();

      const response = await accept(usServer, us.adminToken);

      expect(response.statusCode).toBe(403);
      expect(await signedAtOf(us.licenseId)).toBeNull();
      expect(await baaEntries(us.licenseId)).toHaveLength(0);
    });

    it('lets that same admin read the state', async () => {
      // The split is deliberate: an admin configuring the workspace should be
      // able to see whether HIPAA cover is in place without being able to
      // create it.
      const us = await seedUsTenant();

      const response = await usServer.get('/settings/compliance', {
        authorization: `Bearer ${us.adminToken}`,
      });

      expect(response.statusCode).toBe(200);
      expect((response.json() as { region: string }).region).toBe('us');
    });

    it('refuses an anonymous caller', async () => {
      const response = await usServer.post('/settings/compliance/baa', { accepted: true });

      expect(response.statusCode).toBe(401);
    });
  });

  // =========================================================================
  // US hosting — the other half of NFR-C4
  // =========================================================================

  describe('where it may be accepted', () => {
    it('refuses a European workspace, even for its owner', async () => {
      const token = await euOwnerToken();

      const response = await accept(server, token);

      expect(response.statusCode).toBe(403);
      expect(response.json().error.type).toBe('not_allowed');
      expect(await signedAtOf(fx.a.licenseId)).toBeNull();
      expect(await baaEntries(fx.a.licenseId)).toHaveLength(0);
    });

    it('tells a European workspace it has nothing to accept', async () => {
      // `baa_available` is the server stating the rule once, so the screen
      // cannot offer a button this endpoint will refuse.
      const token = await euOwnerToken();

      const response = await server.get('/settings/compliance', {
        authorization: `Bearer ${token}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        region: 'eu',
        baa_available: false,
        hipaa_baa_signed_at: null,
      });
    });

    it('refuses a US workspace that reached the European deployment', async () => {
      // C4-b's gate is in front, and it must stay in front: 403 here would
      // mean the request was judged on its merits by a region that should not
      // be holding this workspace at all.
      const us = await seedUsTenant();

      const response = await accept(server, us.ownerToken);

      expect(response.statusCode).toBe(421);
      expect(await signedAtOf(us.licenseId)).toBeNull();
    });

    it('refuses the value in the database too, not only at the endpoint', async () => {
      // The endpoint is not the only writer this column will ever have — the
      // seed, a migration and a psql session all reach it. Attacked as the
      // table owner, which bypasses RLS and every application-level guard.
      await expect(
        owner.license.update({
          where: { id: fx.a.licenseId },
          data: { hipaaBaaSignedAt: new Date() },
        }),
      ).rejects.toThrow(/nexa_baa_requires_us_region/);
    });

    it('refuses a licence created with the value already set', async () => {
      // An INSERT walks past a guard that only watches UPDATE, and creating a
      // pre-signed licence is exactly how a seed or an import would do it.
      const organization = await owner.organization.create({
        data: { name: 'Org EU Presigned', region: 'eu' },
        select: { id: true },
      });

      await expect(
        owner.license.create({
          data: {
            organizationId: organization.id,
            plan: 'growth',
            status: 'active',
            hipaaBaaSignedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/nexa_baa_requires_us_region/);
    });

    it('refuses moving a signed licence under a European organization', async () => {
      // Region is immutable, so the only way a signed licence can end up in
      // the wrong region is by moving the licence rather than the region.
      const us = await seedUsTenant('mover');
      await accept(usServer, us.ownerToken);

      const euOrganization = await owner.organization.create({
        data: { name: 'Org EU Destination', region: 'eu' },
        select: { id: true },
      });

      await expect(
        owner.license.update({
          where: { id: us.licenseId },
          data: { organizationId: euOrganization.id },
        }),
      ).rejects.toThrow(/nexa_baa_requires_us_region/);
    });

    it('lets a US licence clear the value', async () => {
      // The rule is "no cover without US hosting", not "no undoing". Ending an
      // agreement is a different act from claiming one, and the trigger must
      // not accidentally make the column write-once.
      const us = await seedUsTenant('clearer');
      await accept(usServer, us.ownerToken);

      await owner.license.update({
        where: { id: us.licenseId },
        data: { hipaaBaaSignedAt: null },
      });

      expect(await signedAtOf(us.licenseId)).toBeNull();
    });
  });

  // =========================================================================
  // Tenancy and input
  // =========================================================================

  describe('boundaries', () => {
    it('never touches another workspace', async () => {
      // Two US workspaces, so the region rule cannot be what separates them —
      // only tenancy can.
      const one = await seedUsTenant('alpha');
      const two = await seedUsTenant('beta');

      await accept(usServer, one.ownerToken);

      expect(await signedAtOf(one.licenseId)).toBeInstanceOf(Date);
      expect(await signedAtOf(two.licenseId)).toBeNull();
      expect(await baaEntries(two.licenseId)).toHaveLength(0);

      const asTwo = await usServer.get('/settings/compliance', {
        authorization: `Bearer ${two.ownerToken}`,
      });
      expect(
        (asTwo.json() as { hipaa_baa_signed_at: string | null }).hipaa_baa_signed_at,
      ).toBeNull();
    });

    it('refuses a body that does not say yes', async () => {
      // An acceptance nobody made is the failure mode worth naming: an empty
      // or stray POST must not commit the workspace to anything.
      const us = await seedUsTenant();

      for (const payload of [{}, { accepted: false }, { accepted: 'true' }]) {
        const response = await usServer.post('/settings/compliance/baa', payload, {
          authorization: `Bearer ${us.ownerToken}`,
        });
        expect(response.statusCode).toBe(400);
      }

      expect(await signedAtOf(us.licenseId)).toBeNull();
      expect(await baaEntries(us.licenseId)).toHaveLength(0);
    });

    it('refuses a token without the write scope', async () => {
      const us = await seedUsTenant();
      const readOnly = await grantToken(owner, {
        licenseId: us.licenseId,
        organizationId: us.organizationId,
        ownerId: us.ownerAccountId,
        scopes: ['access_rules:ro'],
      });

      const response = await accept(usServer, readOnly);

      expect(response.statusCode).toBe(403);
      expect(await signedAtOf(us.licenseId)).toBeNull();
    });
  });
});
