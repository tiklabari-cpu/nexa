/**
 * Tenant isolation — the negative tests.
 *
 * These run before the feature tests deliberately. A cross-tenant leak is
 * silent: every positive test still passes while the system hands one
 * customer's conversations to another. The only way to know isolation holds is
 * to attack it on purpose, from the same layer the application uses.
 *
 * Two properties are asserted separately, because they fail independently:
 *   1. The API's database role is genuinely subject to RLS (not the owner).
 *   2. With a tenant context set, no query can reach outside that tenant —
 *      including queries that explicitly ask to.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const OWNER_URL = process.env['DATABASE_URL'];

describe('tenant isolation (RLS)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fixtures: Fixtures;

  beforeAll(async () => {
    if (!APP_URL || !OWNER_URL) throw new Error('DATABASE_URL and DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    fixtures = await seedFixtures(owner);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  describe('the runtime role is actually constrained', () => {
    it('does not connect as a superuser or the table owner', async () => {
      // If this ever becomes true, every policy below silently stops applying
      // while all the other tests keep passing — the failure mode this suite
      // exists to prevent.
      const [role] = await app.$queryRaw<Array<{ rolname: string; rolsuper: boolean }>>`
        SELECT rolname, rolsuper FROM pg_roles WHERE rolname = current_user
      `;
      expect(role?.rolname).toBe('nexa_app');
      expect(role?.rolsuper).toBe(false);

      const [ownership] = await app.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = current_user
      `;
      expect(Number(ownership?.count ?? 0)).toBe(0);
    });

    it('has row level security enabled on every tenant table', async () => {
      const rows = await app.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('organizations','licenses','accounts','agent_memberships',
                            'oauth_clients','oauth_authorization_codes','oauth_refresh_tokens',
                            'api_tokens','customers','trusted_domains')
      `;
      expect(rows.length).toBe(10);
      for (const row of rows) {
        expect(row.rowsecurity, `${row.tablename} must have RLS enabled`).toBe(true);
      }
    });
  });

  describe('without a tenant context', () => {
    it('sees nothing at all — fail closed, not fail open', async () => {
      // The dangerous default is "no filter set → return everything". Every
      // tenant table must return zero rows instead.
      for (const table of [
        'organizations',
        'licenses',
        'agent_memberships',
        'api_tokens',
        'customers',
        'trusted_domains',
        'oauth_clients',
      ]) {
        const [row] = await app.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*) AS count FROM ${table}`,
        );
        expect(Number(row?.count ?? -1), `${table} must be empty without a tenant`).toBe(0);
      }
    });

    it('cannot insert either', async () => {
      await expect(
        app.$executeRaw`INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'sneaky')`,
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('with tenant A context', () => {
    it('reads only tenant A rows', async () => {
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        async (tx) => ({
          licenses: await tx.license.findMany({ select: { id: true } }),
          customers: await tx.customer.findMany({ select: { organizationId: true } }),
        }),
      );

      expect(result.licenses.map((l) => l.id)).toEqual([fixtures.a.licenseId]);
      expect(result.customers.every((c) => c.organizationId === fixtures.a.organizationId)).toBe(
        true,
      );
    });

    it('returns nothing when asked for a tenant B row by id', async () => {
      // The query is correct SQL and the row exists — RLS is what makes it
      // invisible. This is the exact shape of an IDOR attempt.
      const found = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.customer.findUnique({ where: { id: fixtures.b.customerId } }),
      );
      expect(found).toBeNull();
    });

    it('cannot reach tenant B rows through a join either', async () => {
      const rows = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS count
          FROM api_tokens t
          JOIN licenses l ON l.id = t.license_id
          WHERE l.organization_id = ${fixtures.b.organizationId}::uuid
        `,
      );
      expect(Number(rows[0]?.count ?? -1)).toBe(0);
    });

    it('cannot update a tenant B row', async () => {
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) =>
          tx.customer.updateMany({
            where: { id: fixtures.b.customerId },
            data: { name: 'hijacked' },
          }),
      );
      expect(result.count).toBe(0);

      const untouched = await owner.customer.findUnique({ where: { id: fixtures.b.customerId } });
      expect(untouched?.name).toBe('Customer b');
    });

    it('cannot delete a tenant B row', async () => {
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.customer.deleteMany({ where: { id: fixtures.b.customerId } }),
      );
      expect(result.count).toBe(0);
      expect(
        await owner.customer.findUnique({ where: { id: fixtures.b.customerId } }),
      ).not.toBeNull();
    });

    it('cannot write a row belonging to tenant B', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.customer.create({
              data: { organizationId: fixtures.b.organizationId, name: 'planted' },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot see tenant B accounts, even though accounts are a global table', async () => {
      // `accounts` has no organization column — visibility comes from shared
      // membership, which is easy to get wrong.
      const visible = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.account.findMany({ select: { id: true } }),
      );
      const ids = visible.map((a) => a.id);
      expect(ids).toContain(fixtures.a.ownerAccountId);
      expect(ids).not.toContain(fixtures.b.ownerAccountId);
    });
  });

  describe('context handling', () => {
    it('does not leak the tenant setting to the next transaction', async () => {
      // SET LOCAL unwinds with the transaction. If it ever escaped to the
      // pooled connection, the next request would silently inherit a tenant —
      // the worst kind of bug, because the wrong data still looks plausible.
      await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.license.findMany(),
      );

      const [row] = await app.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM licenses
      `;
      expect(Number(row?.count ?? -1)).toBe(0);
    });

    it('clears the tenant setting even when the transaction fails', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          async (tx) => {
            await tx.license.findMany();
            throw new Error('boom');
          },
        ),
      ).rejects.toThrow('boom');

      const [row] = await app.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM licenses
      `;
      expect(Number(row?.count ?? -1)).toBe(0);
    });

    it('rejects a malformed tenant context instead of running unscoped', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: 0n, organizationId: fixtures.a.organizationId },
          async () => 1,
        ),
      ).rejects.toThrow(/invalid tenant license id/);

      await expect(
        withTenant(
          app,
          { licenseId: 1n, organizationId: "'; DROP TABLE licenses; --" },
          async () => 1,
        ),
      ).rejects.toThrow(/invalid tenant organization id/);
    });

    it('does not let a crafted context string smuggle a second setting', async () => {
      // The organization id is validated as a uuid before it reaches SQL, and
      // set_config takes it as a bound parameter — so injection has two
      // independent barriers.
      await expect(
        withTenant(
          app,
          {
            licenseId: fixtures.a.licenseId,
            organizationId: `${fixtures.b.organizationId}', true); SELECT set_config('app.current_license', '${fixtures.b.licenseId}`,
          },
          async () => 1,
        ),
      ).rejects.toThrow(/invalid tenant organization id/);
    });
  });
});
