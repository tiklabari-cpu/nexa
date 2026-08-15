/**
 * Data residency: choosing a region, never moving one (NFR-C4/C9 · C4-a), and
 * refusing to serve a workspace that belongs somewhere else (C4-b).
 *
 * For C4-a, two properties, and the second is the one that carries weight.
 * Choosing is a signup parameter; *not being able to change it afterwards* is
 * the claim the compliance item actually sells, and until this slice it was
 * true only because `eu` was the sole legal value — an accident, not a rule.
 *
 * So immutability is attacked here through the database directly, not through
 * an endpoint. No endpoint updates `region` today; a guard that only exists in
 * a service is one new call site away from being absent, and C4-b and C4-e both
 * build their enforcement on top of this column. The attacks run as the
 * application role *and* as the table owner, because a rule that the owner can
 * step around is a rule the next migration steps around.
 *
 * C4-b is the enforcement built on it. A column saying `us` means nothing while
 * a European process happily answers for that workspace, so the tests below
 * boot a *second* server configured as a US deployment and prove the same
 * credential is served at one door and refused at the other. The socket half of
 * the same rule lives in `apps/rtm/test/integration/region.test.ts` — a separate
 * process, so a separate suite, deliberately not a shared one.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REGIONS } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const STRONG_PASSWORD = 'a-quite-long-passphrase';

describe('region (C4-a)', () => {
  let server: TestServer;
  /** The same build, configured as a US deployment (C4-b). */
  let usServer: TestServer;
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
    usServer = await startTestServer({ NEXA_REGION: 'us' });
  });

  afterAll(async () => {
    await Promise.all([server.close(), usServer.close()]);
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
  });

  async function regionOf(organizationName: string): Promise<string | undefined> {
    const organization = await owner.organization.findFirst({
      where: { name: organizationName },
      select: { region: true },
    });
    return organization?.region;
  }

  /** A personal access token for tenant A's owner — the ordinary caller. */
  function tokenForA(): Promise<string> {
    return grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['accounts--my:ro'],
    });
  }

  // =========================================================================
  // Choosing — the one moment the value is writable
  // =========================================================================

  describe('signup', () => {
    it('creates the workspace in the region the founder asked for', async () => {
      // At the door that serves it — which is the whole of C4-h below.
      const response = await usServer.post('/auth/signup', {
        email: 'founder@us-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'US NewCo',
        region: 'us',
      });

      expect(response.statusCode).toBe(201);
      expect(await regionOf('US NewCo')).toBe('us');
    });

    it('lands in the region the deployment serves when none is named', async () => {
      const response = await server.post('/auth/signup', {
        email: 'founder@quiet-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'Quiet NewCo',
      });

      expect(response.statusCode).toBe(201);
      expect(await regionOf('Quiet NewCo')).toBe('eu');
    });

    it('lands a silent signup in us at the us deployment, not in eu', async () => {
      // The mirror of the test above, and the reason "omitted means `eu`" had
      // to stop being the rule (C4-h): a fixed default is a wrong-region write
      // at every deployment that is not the default one, produced by a request
      // that asked for nothing.
      const response = await usServer.post('/auth/signup', {
        email: 'founder@quiet-us-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'Quiet US NewCo',
      });

      expect(response.statusCode).toBe(201);
      expect(await regionOf('Quiet US NewCo')).toBe('us');
    });

    it('refuses a region that does not exist, and creates nothing', async () => {
      const before = await owner.organization.count();

      const response = await server.post('/auth/signup', {
        email: 'founder@apac-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'APAC NewCo',
        region: 'apac',
      });

      expect(response.statusCode).toBe(400);
      // Not "created in eu because the value was ignored" — the whole point of
      // an unknown region is that nobody can say where the data would sit.
      expect(await owner.organization.count()).toBe(before);
      expect(await regionOf('APAC NewCo')).toBeUndefined();
    });

    it('gives the US workspace a working sign-in, not just a row', async () => {
      // The region is a column on the tenant root that every token resolution
      // reads (`auth_resolve_token` returns `organization_region`). A value
      // nothing downstream expected would surface here first.
      await usServer.post('/auth/signup', {
        email: 'founder2@us-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'US NewCo Two',
        region: 'us',
      });

      const login = await usServer.post('/auth/login', {
        email: 'founder2@us-newco.test',
        password: STRONG_PASSWORD,
      });
      expect(login.statusCode).toBe(200);
    });

    it('leaves every workspace that predates the choice in eu', async () => {
      // No backfill, and none wanted: a backfill *is* a move, which is the
      // thing forbidden below.
      const regions = await owner.organization.findMany({
        where: { id: { in: [fx.a.organizationId, fx.b.organizationId] } },
        select: { region: true },
      });
      expect(regions.map((r) => r.region)).toEqual(['eu', 'eu']);
    });
  });

  // =========================================================================
  // The signup gate (C4-h) — the door in front of every door below
  //
  // Signup is anonymous, so `plugins/auth.ts` never sees it: that gate compares
  // against a credential's region, and here there is no credential and no
  // workspace to have issued one. Until this gate existed the European
  // deployment happily *wrote* a `us` workspace into its own database and only
  // then began refusing it (421) forever — a founder locked out of rows nobody
  // could move, because `region` is immutable. Everything below is therefore
  // asserted as "nothing was created", never as "created somewhere sensible".
  // =========================================================================

  describe('signup refuses a region this deployment does not serve', () => {
    /** Everything `auth_signup` writes, so "nothing was created" can be checked as a whole. */
    async function tenantRowCounts(): Promise<{
      organizations: number;
      accounts: number;
      licenses: number;
    }> {
      const [organizations, accounts, licenses] = await Promise.all([
        owner.organization.count(),
        owner.account.count(),
        owner.license.count(),
      ]);
      return { organizations, accounts, licenses };
    }

    it('answers 421 and writes nothing when eu is asked for a us workspace', async () => {
      const before = await tenantRowCounts();

      const response = await server.post('/auth/signup', {
        email: 'founder@misplaced.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'Misplaced NewCo',
        region: 'us',
      });

      expect(response.statusCode).toBe(421);
      expect(response.json().error.type).toBe('misdirected_request');
      // The region asked for — the one to retry against, the same meaning the
      // three authenticated doors give it.
      expect(response.json().error.details.region).toBe('us');
      // And the one thing the caller cannot look up: no workspace exists whose
      // home would answer it.
      expect(response.json().error.details.served_region).toBe('eu');

      // Not "downgraded to eu" and not "half created": nothing at all. The
      // account is counted too, because `auth_signup` writes the founder and the
      // licence in the same transaction as the organization — a gate placed
      // after the call would have left all three.
      expect(await tenantRowCounts()).toEqual(before);
      expect(await regionOf('Misplaced NewCo')).toBeUndefined();
    });

    it('answers 421 the same way at the us deployment for an eu workspace', async () => {
      // The mirror, on the same build with `NEXA_REGION=us`. Without it the gate
      // could be `region !== 'us'` — refusing correctly on this deployment for
      // the wrong reason, and refusing every legitimate signup on the other.
      const before = await tenantRowCounts();

      const response = await usServer.post('/auth/signup', {
        email: 'founder@misplaced-eu.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'Misplaced EU NewCo',
        region: 'eu',
      });

      expect(response.statusCode).toBe(421);
      expect(response.json().error.type).toBe('misdirected_request');
      expect(response.json().error.details.region).toBe('eu');
      expect(response.json().error.details.served_region).toBe('us');
      expect(await tenantRowCounts()).toEqual(before);
    });

    it('cannot be talked out of it with X-Region', async () => {
      // The authenticated gate reads `X-Region` as "where the caller believes
      // they are", which can only ever narrow: the right-hand side comes from
      // the database. Here there is no row yet, so honouring the header would
      // make the caller both sides of the comparison and hand back the exact
      // bug this gate exists to close.
      const before = await tenantRowCounts();

      const response = await server.post(
        '/auth/signup',
        {
          email: 'founder@header-trick.test',
          password: STRONG_PASSWORD,
          name: 'Founder',
          organization_name: 'Header Trick NewCo',
          region: 'us',
        },
        { 'x-region': 'us' },
      );

      expect(response.statusCode).toBe(421);
      expect(await tenantRowCounts()).toEqual(before);
      expect(await regionOf('Header Trick NewCo')).toBeUndefined();
    });

    it('still creates a workspace in the region it does serve', async () => {
      // The gate refuses a region, not signup. Without this the suite would pass
      // just as well with the endpoint switched off.
      const response = await server.post('/auth/signup', {
        email: 'founder@welcome.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'Welcome NewCo',
        region: 'eu',
      });

      expect(response.statusCode).toBe(201);
      expect(await regionOf('Welcome NewCo')).toBe('eu');
    });
  });

  // =========================================================================
  // The legal set — one place, and it is the database
  // =========================================================================

  describe('the value set', () => {
    it('accepts both regions on a direct insert', async () => {
      for (const region of REGIONS) {
        const organization = await owner.organization.create({
          data: { name: `Direct ${region}`, region },
          select: { region: true },
        });
        expect(organization.region).toBe(region);
      }
    });

    it('refuses an unknown region even from the table owner', async () => {
      await expect(
        owner.organization.create({ data: { name: 'Direct apac', region: 'apac' } }),
      ).rejects.toThrow(/organizations_region_check/i);
    });

    it('is the same set the shared types declare', async () => {
      // The CHECK constraint and `REGIONS` are two spellings of one rule, and
      // they are edited in different files. Reading the constraint back is what
      // notices when only one of them moves.
      const [constraint] = await owner.$queryRaw<Array<{ definition: string }>>`
        SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint
        WHERE conname = 'organizations_region_check'
      `;
      for (const region of REGIONS) {
        expect(constraint?.definition).toContain(`'${region}'`);
      }
    });
  });

  // =========================================================================
  // Immutability — the half of ADR-12 that survives
  // =========================================================================

  describe('a workspace cannot be moved', () => {
    it('refuses the change through the application role, inside its own tenant context', async () => {
      // The realistic shape of the attack and of the accident: the workspace's
      // own connection, with RLS satisfied, updating its own row. Nothing about
      // tenancy stops this — only the trigger does.
      await expect(
        withTenant(app, { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId }, (tx) =>
          tx.organization.update({
            where: { id: fx.a.organizationId },
            data: { region: 'us' },
          }),
        ),
      ).rejects.toThrow(/nexa_region_immutable/);

      expect(
        (await owner.organization.findUnique({
          where: { id: fx.a.organizationId },
          select: { region: true },
        }))!.region,
      ).toBe('eu');
    });

    it('refuses the change from the table owner too', async () => {
      // A column privilege would have stopped only `nexa_app`. The owner is the
      // role a migration, a seed and a support session all run as, which is
      // where a quiet `UPDATE organizations SET region` would actually come
      // from.
      await expect(
        owner.organization.update({
          where: { id: fx.a.organizationId },
          data: { region: 'us' },
        }),
      ).rejects.toThrow(/nexa_region_immutable/);
    });

    it('refuses raw SQL, not just the ORM', async () => {
      await expect(
        owner.$executeRaw`UPDATE organizations SET region = 'us' WHERE id = ${fx.a.organizationId}::uuid`,
      ).rejects.toThrow(/nexa_region_immutable/);
    });

    it('refuses a sweep that would move every workspace at once', async () => {
      // FOR EACH ROW, so a set-wide update fails on the first row it would move
      // rather than moving the ones it reached first.
      await expect(owner.$executeRaw`UPDATE organizations SET region = 'us'`).rejects.toThrow(
        /nexa_region_immutable/,
      );

      const regions = await owner.organization.findMany({ select: { region: true } });
      expect(regions.every((r) => r.region === 'eu')).toBe(true);
    });

    it('still lets the workspace be renamed', async () => {
      // The trigger is `BEFORE UPDATE OF region`; over-reaching to the whole row
      // would make the rest of the tenant root read-only, which nobody asked for.
      const renamed = await owner.organization.update({
        where: { id: fx.a.organizationId },
        data: { name: 'Org A, renamed' },
        select: { name: true, region: true },
      });
      expect(renamed).toEqual({ name: 'Org A, renamed', region: 'eu' });
    });

    it('allows an update that writes the region it already holds', async () => {
      // `IS DISTINCT FROM`, not "was the column in the statement": an ORM or a
      // full-row rewrite that carries the unchanged value is not a move, and
      // failing it would be a mystery error on an unrelated save.
      await expect(
        owner.organization.update({
          where: { id: fx.a.organizationId },
          data: { region: 'eu', name: 'Org A, again' },
        }),
      ).resolves.toMatchObject({ region: 'eu' });
    });

    it('does not stand in the way of deleting a workspace', async () => {
      // Ending is not moving. The row leaves with its region intact.
      const doomed = await owner.organization.create({
        data: { name: 'Doomed US', region: 'us' },
        select: { id: true },
      });
      await expect(owner.organization.delete({ where: { id: doomed.id } })).resolves.toBeTruthy();
    });

    it('holds for a workspace that was born in us as well', async () => {
      // Symmetry matters: the rule is "no moves", not "no leaving eu". Born at
      // the door that serves `us`, because since C4-h no other one will make it.
      await usServer.post('/auth/signup', {
        email: 'founder3@us-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'US NewCo Three',
        region: 'us',
      });
      const created = await owner.organization.findFirstOrThrow({
        where: { name: 'US NewCo Three' },
        select: { id: true },
      });

      await expect(
        owner.organization.update({ where: { id: created.id }, data: { region: 'eu' } }),
      ).rejects.toThrow(/nexa_region_immutable/);
    });
  });

  // =========================================================================
  // C4-b — the column is enforced at the door
  // =========================================================================

  describe('a request that reached the wrong region (C4-b)', () => {
    /** A workspace that genuinely lives in `us`, with a token and a domain. */
    async function seedUsTenant(): Promise<{
      organizationId: string;
      licenseId: bigint;
      trustedDomain: string;
      token: string;
    }> {
      const organization = await owner.organization.create({
        data: { name: 'Org US', region: 'us' },
        select: { id: true },
      });
      const license = await owner.license.create({
        data: { organizationId: organization.id, plan: 'growth', status: 'active' },
        select: { id: true },
      });
      const account = await owner.account.create({
        data: { email: 'owner-us@example.test', name: 'Owner US' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: license.id, agentId: account.id, role: 'owner' },
      });
      const trustedDomain = 'shop-us.example.test';
      await owner.trustedDomain.create({
        data: {
          organizationId: organization.id,
          licenseId: license.id,
          domain: trustedDomain,
          includeSubdomains: true,
        },
      });

      const token = await grantToken(owner, {
        licenseId: license.id,
        organizationId: organization.id,
        ownerId: account.id,
        scopes: ['accounts--my:ro'],
      });
      return { organizationId: organization.id, licenseId: license.id, trustedDomain, token };
    }

    /** Mint a widget token the way the loader does, from a trusted origin. */
    function mintCustomerToken(
      target: TestServer,
      organizationId: string,
      host: string,
    ): ReturnType<TestServer['post']> {
      return target.post(
        '/customer/token',
        { organization_id: organizationId },
        { origin: `https://${host}` },
      );
    }

    // --- The agent surface -------------------------------------------------

    it('refuses an agent token whose workspace lives elsewhere, and says where', async () => {
      const token = await tokenForA();

      const response = await usServer.get('/auth/me', { authorization: `Bearer ${token}` });

      expect(response.statusCode).toBe(421);
      expect(response.json().error.type).toBe('misdirected_request');
      // The *workspace's* region — the whole correction this slice makes. Read
      // from configuration it would have said `us`, which is where the caller
      // already is and therefore useless.
      expect(response.json().error.details.region).toBe('eu');
    });

    it('serves the very same token at the region that holds the workspace', async () => {
      // The pair is the property: the credential is fine, the address was not.
      const token = await tokenForA();

      expect(
        (await usServer.get('/auth/me', { authorization: `Bearer ${token}` })).statusCode,
      ).toBe(421);
      expect((await server.get('/auth/me', { authorization: `Bearer ${token}` })).statusCode).toBe(
        200,
      );
    });

    it('refuses a US workspace at the European deployment', async () => {
      // The production direction: the workspace moved region, not the process.
      const us = await seedUsTenant();

      const response = await server.get('/auth/me', { authorization: `Bearer ${us.token}` });

      expect(response.statusCode).toBe(421);
      expect(response.json().error.details.region).toBe('us');
    });

    it('reports the workspace region, not the process region, to a caller it does serve', async () => {
      // C4-a's leftover: `/auth/me` used to answer from configuration. Only a
      // deployment whose region matches can observe the difference, which is
      // exactly this pairing.
      const us = await seedUsTenant();

      const response = await usServer.get('/auth/me', { authorization: `Bearer ${us.token}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().region).toBe('us');
    });

    it('decides residency before it reads anything belonging to the workspace', async () => {
      // `X-Nexa-Brand` resolution queries the caller's brands and answers 404
      // for one it cannot see. Getting 421 here means the request was turned
      // away before that query ran — a workspace kept in another region must
      // not have its rows read to produce an error about it.
      const token = await tokenForA();

      const response = await usServer.get('/auth/me', {
        authorization: `Bearer ${token}`,
        'x-nexa-brand': '99999999-9999-4999-8999-999999999999',
      });

      expect(response.statusCode).toBe(421);
    });

    it('keeps a customer token out of the agent surface with 404, not 421', async () => {
      // The principal-kind gate stays in front. 421 would confirm the token is
      // genuine and merely misplaced; on a route the widget may never touch,
      // that is more than the 404 policy (NFR-S5) is willing to say.
      const minted = await mintCustomerToken(server, fx.a.organizationId, fx.a.trustedDomain);
      expect(minted.statusCode).toBe(200);

      const response = await usServer.get('/agents', {
        authorization: `Bearer ${minted.json().token}`,
      });

      expect(response.statusCode).toBe(404);
    });

    // --- The header ---------------------------------------------------------

    it('refuses a caller who names a region the workspace does not live in', async () => {
      // The header says where the caller believes they are. Believing wrongly
      // is the misdirection, even when they happen to have reached a
      // deployment that does hold the workspace.
      const token = await tokenForA();

      const response = await server.get('/auth/me', {
        authorization: `Bearer ${token}`,
        'x-region': 'us',
      });

      expect(response.statusCode).toBe(421);
      expect(response.json().error.details.region).toBe('eu');
    });

    it('serves a caller who names the workspace region correctly', async () => {
      const token = await tokenForA();

      const response = await server.get('/auth/me', {
        authorization: `Bearer ${token}`,
        'x-region': 'eu',
      });

      expect(response.statusCode).toBe(200);
    });

    // --- The widget token mint ----------------------------------------------

    it('refuses to mint a widget token for a workspace kept in another region', async () => {
      const response = await mintCustomerToken(usServer, fx.a.organizationId, fx.a.trustedDomain);

      expect(response.statusCode).toBe(421);
      expect(response.json().error.type).toBe('misdirected_request');
      expect(response.json().error.details.region).toBe('eu');
    });

    it('creates no visitor row when it refuses', async () => {
      // The reason this door refuses *before* the rest of the route: a visitor
      // with no `customer_id` gets one created for them, and creating it would
      // put a European workspace's customer in the American database — the
      // breach itself, committed while producing the error that reports it.
      const before = await owner.customer.count();

      await mintCustomerToken(usServer, fx.a.organizationId, fx.a.trustedDomain);

      expect(await owner.customer.count()).toBe(before);
    });

    it('mints for the same workspace at its own region', async () => {
      const response = await mintCustomerToken(server, fx.a.organizationId, fx.a.trustedDomain);

      expect(response.statusCode).toBe(200);
      expect(typeof response.json().token).toBe('string');
    });

    it('refuses a widget token minted elsewhere, wherever it is presented', async () => {
      // The third door hands out a credential the other two have to recognise.
      const minted = await mintCustomerToken(server, fx.a.organizationId, fx.a.trustedDomain);
      const token = minted.json().token as string;

      // `/auth/me` is the one route a customer principal may reach, so the
      // refusal cannot be confused with the principal-kind gate above.
      expect((await server.get('/auth/me', { authorization: `Bearer ${token}` })).statusCode).toBe(
        200,
      );

      const response = await usServer.get('/auth/me', { authorization: `Bearer ${token}` });
      expect(response.statusCode).toBe(421);
      expect(response.json().error.details.region).toBe('eu');
    });

    it('mints a US workspace a token that carries its own region', async () => {
      const us = await seedUsTenant();

      const minted = await mintCustomerToken(usServer, us.organizationId, us.trustedDomain);
      expect(minted.statusCode).toBe(200);

      // Same token, European deployment: refused, and told where to go.
      const response = await server.get('/auth/me', {
        authorization: `Bearer ${minted.json().token}`,
      });
      expect(response.statusCode).toBe(421);
      expect(response.json().error.details.region).toBe('us');
    });

    // --- The trail ----------------------------------------------------------

    it('records the refusal as security.region_rejected, naming only the licence and the region asked for', async () => {
      const token = await tokenForA();

      await usServer.get('/auth/me', { authorization: `Bearer ${token}` });

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'security.region_rejected' },
      });
      expect(entries).toHaveLength(1);
      const entry = entries[0]!;
      expect(entry.target).toBe(`license:${fx.a.licenseId}`);
      expect(entry.metadata).toMatchObject({ requested_region: 'us' });
      // Deliberately absent: this region should not be holding this
      // workspace's people, so the entry does not name one — nor the address
      // they came from, nor the credential they held.
      expect(entry.ip).toBeNull();
      expect(entry.actorId).toBeNull();
      expect(entry.actorType).toBe('system');
      expect(JSON.stringify(entry.metadata)).not.toContain(token);
    });

    it('writes the trail under the refused workspace, not a neighbouring one', async () => {
      // Tenant isolation still holds on the new write path: an entry landing on
      // the wrong licence would be a cross-tenant leak dressed as an audit log.
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });

      await usServer.get('/auth/me', { authorization: `Bearer ${tokenB}` });

      const [a, b] = await Promise.all([
        owner.auditLogEntry.count({
          where: { licenseId: fx.a.licenseId, action: 'security.region_rejected' },
        }),
        owner.auditLogEntry.count({
          where: { licenseId: fx.b.licenseId, action: 'security.region_rejected' },
        }),
      ]);
      expect(a).toBe(0);
      expect(b).toBe(1);
    });

    it('still refuses another tenant its neighbour, at the right region', async () => {
      // Residency is an extra gate, not a replacement: the deployment that does
      // serve both workspaces keeps them apart exactly as before.
      const tokenB = await grantToken(owner, {
        licenseId: fx.b.licenseId,
        organizationId: fx.b.organizationId,
        ownerId: fx.b.ownerAccountId,
        scopes: ['accounts--my:ro'],
      });

      const response = await server.get('/auth/me', { authorization: `Bearer ${tokenB}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().organization_id).toBe(fx.b.organizationId);
      expect(response.json().organization_id).not.toBe(fx.a.organizationId);
    });
  });
});
