/**
 * Data residency: choosing a region, and never moving one (NFR-C4/C9 · C4-a).
 *
 * Two properties, and the second is the one that carries weight. Choosing is a
 * signup parameter; *not being able to change it afterwards* is the claim the
 * compliance item actually sells, and until this slice it was true only because
 * `eu` was the sole legal value — an accident, not a rule.
 *
 * So immutability is attacked here through the database directly, not through
 * an endpoint. No endpoint updates `region` today; a guard that only exists in
 * a service is one new call site away from being absent, and C4-b and C4-e both
 * build their enforcement on top of this column. The attacks run as the
 * application role *and* as the table owner, because a rule that the owner can
 * step around is a rule the next migration steps around.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { REGIONS } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const STRONG_PASSWORD = 'a-quite-long-passphrase';

describe('region (C4-a)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let app: PrismaClient;
  let fx: Fixtures;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
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

  // =========================================================================
  // Choosing — the one moment the value is writable
  // =========================================================================

  describe('signup', () => {
    it('creates the workspace in the region the founder asked for', async () => {
      const response = await server.post('/auth/signup', {
        email: 'founder@us-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'US NewCo',
        region: 'us',
      });

      expect(response.statusCode).toBe(201);
      expect(await regionOf('US NewCo')).toBe('us');
    });

    it('lands in eu when no region is named', async () => {
      const response = await server.post('/auth/signup', {
        email: 'founder@quiet-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'Quiet NewCo',
      });

      expect(response.statusCode).toBe(201);
      expect(await regionOf('Quiet NewCo')).toBe('eu');
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
      await server.post('/auth/signup', {
        email: 'founder2@us-newco.test',
        password: STRONG_PASSWORD,
        name: 'Founder',
        organization_name: 'US NewCo Two',
        region: 'us',
      });

      const login = await server.post('/auth/login', {
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
        withTenant(
          app,
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
          (tx) =>
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
      // Symmetry matters: the rule is "no moves", not "no leaving eu".
      await server.post('/auth/signup', {
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
});
