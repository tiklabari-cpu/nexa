/**
 * Brand isolation — the Multibrand negative tests (MULTIBRAND-b · PRD §5.3 ·
 * NFR-S4/S5).
 *
 * Cross-*license* isolation is proven in tenant-isolation.test.ts. This proves
 * the layer 78.2 adds, and it is proven on `channels`:
 *
 *   1. Within one license, a query opened in one brand's context cannot see
 *      another brand's channel (the `channels_tenant` brand condition).
 *   2. The brand setting does not leak past its transaction — the pooled-
 *      connection trap v2-02:476 warns about, now for a third context value.
 *   3. A brand id in `X-Nexa-Brand` that is not one of the caller's own is a 404,
 *      never a 403, so brand ids stay un-enumerable across licenses.
 *   4. With no brand named, the request sees every brand of the license — a
 *      single-brand workspace is unchanged.
 *
 * These are written to fail without the implementation: strip the brand
 * condition from `channels_tenant` and every "cannot see the other brand"
 * assertion reads the other brand's row; drop the resolver and the cross-license
 * id is served instead of refused.
 *
 * 78.8 (MULTIBRAND-h) extends this file with two schema-driven layers: a
 * coverage *alarm* that fails if the set of brand-scoped tables the matrix knows
 * and the set of `brand_id` columns the schema actually has ever diverge, and a
 * *matrix* that generates the cross-brand invisibility test for every one of
 * those tables from a single list — so a brand-scoped table added later cannot
 * ship untested (v2-04 §7.1: a forgotten table is a silent leak).
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

interface ConnectedChannel {
  type: string;
  brand_id: string;
  status: string;
  connected: boolean;
}

// === The brand-scope matrix (78.8) ==========================================
// The single source of truth for which tables are brand-scoped. Each entry
// knows how to plant one minimal row under a given brand, so the matrix can
// prove isolation for every table from this one list. The coverage alarm
// cross-checks these names against the schema's `brand_id` columns, so a table
// added without an entry here breaks the build.
const BRAND_SCOPED_TABLES: ReadonlyArray<{
  table: string;
  plant: (db: PrismaClient, at: { licenseId: bigint; brandId: string }) => Promise<unknown>;
}> = [
  {
    table: 'channels',
    plant: (db, at) =>
      db.channel.create({
        data: {
          licenseId: at.licenseId,
          brandId: at.brandId,
          type: 'messenger',
          status: 'connected',
          config: {},
        },
      }),
  },
  {
    table: 'websites',
    plant: (db, at) =>
      db.website.create({
        data: { licenseId: at.licenseId, brandId: at.brandId, domain: 'probe.example.test' },
      }),
  },
  {
    table: 'widget_settings',
    plant: (db, at) =>
      db.widgetSettings.create({ data: { licenseId: at.licenseId, brandId: at.brandId } }),
  },
  {
    table: 'security_settings',
    plant: (db, at) =>
      db.securitySettings.create({ data: { licenseId: at.licenseId, brandId: at.brandId } }),
  },
  {
    table: 'inbox_settings',
    plant: (db, at) =>
      db.inboxSettings.create({ data: { licenseId: at.licenseId, brandId: at.brandId } }),
  },
];

/** Every public table carrying a `brand_id` column, read straight from the
 *  catalogue — the authoritative set the matrix must match. */
async function brandScopedTablesInSchema(
  db: Pick<PrismaClient, '$queryRaw'>,
): Promise<Set<string>> {
  const rows = await db.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'brand_id'
    ORDER BY table_name
  `;
  return new Set(rows.map((r) => r.table_name));
}

/** The two-way diff (the contract-parity shape): schema tables the matrix omits
 *  (untested leak surface), and matrix names the schema has no `brand_id` for. */
function scopeCoverageGaps(
  declared: ReadonlySet<string>,
  inSchema: ReadonlySet<string>,
): { undeclared: string[]; phantom: string[] } {
  return {
    undeclared: [...inSchema].filter((t) => !declared.has(t)).sort(),
    phantom: [...declared].filter((t) => !inSchema.has(t)).sort(),
  };
}

/** Sentinel that rolls an interactive transaction back after inspecting it. */
const ROLLBACK_PROBE = new Error('rollback brand-scope probe');

describe('brand isolation (Multibrand RLS · NFR-S4/S5)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;

  // License A carries two brands — intra-license isolation is the new property —
  // and license B one, for the cross-license resolver check.
  let brandA1: string; // license A, default
  let brandA2: string; // license A, a second brand
  let brandB: string; // license B, default
  let adminA: string;

  const auth = (token: string, brand?: string): Record<string, string> => ({
    authorization: `Bearer ${token}`,
    ...(brand ? { 'x-nexa-brand': brand } : {}),
  });

  const connect = (brand: string | undefined, pageId: string) =>
    server.post(
      '/channels/messenger/connect',
      { code: 'AQD_mock', page_id: pageId, page_name: 'Acme' },
      auth(adminA, brand),
    );
  const list = (brand?: string) => server.get('/channels', auth(adminA, brand));
  const items = async (brand?: string): Promise<ConnectedChannel[]> =>
    ((await list(brand)).json() as { items: ConnectedChannel[] }).items;

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

    const [a1, a2, b] = await Promise.all([
      owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Default', slug: 'default', isDefault: true },
        select: { id: true },
      }),
      owner.brand.create({
        data: { licenseId: fx.a.licenseId, name: 'Acme EU', slug: 'acme-eu' },
        select: { id: true },
      }),
      owner.brand.create({
        data: { licenseId: fx.b.licenseId, name: 'Default', slug: 'default', isDefault: true },
        select: { id: true },
      }),
    ]);
    brandA1 = a1.id;
    brandA2 = a2.id;
    brandB = b.id;

    adminA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['channels--all:rw', 'channels--all:ro'],
    });
  });

  // === Intra-license isolation — the property Multibrand adds =================
  describe('one brand cannot see another brand of the same license', () => {
    it("hides a brand's channel from another brand's context", async () => {
      const connected = await connect(brandA2, '100000000000001');
      expect(connected.statusCode).toBe(200);
      expect((connected.json() as ConnectedChannel).brand_id).toBe(brandA2);

      // brandA1's context: the brandA2 channel is invisible (zero rows).
      expect(await items(brandA1)).toHaveLength(0);

      // brandA2's context: it is right there.
      const underA2 = await items(brandA2);
      expect(underA2).toHaveLength(1);
      expect(underA2[0]).toMatchObject({ type: 'messenger', brand_id: brandA2 });
    });

    it("cannot disconnect another brand's channel — 404, indistinguishable from absent", async () => {
      await connect(brandA2, '100000000000001');
      // Under brandA1 the messenger is invisible, so the update touches nothing and
      // the route answers 404 — the same un-enumerable answer a stranger id gets.
      const res = await server.post(
        '/channels/messenger/disconnect',
        undefined,
        auth(adminA, brandA1),
      );
      expect(res.statusCode).toBe(404);
      // Still connected under its own brand.
      expect((await items(brandA2))[0]).toMatchObject({ connected: true });
    });

    it('runs the same channel type once per brand and shows them all license-wide', async () => {
      // The old (license, type) key rejected a second messenger; the new
      // (license, brand, type) key allows one per brand.
      expect((await connect(brandA1, '100000000000001')).statusCode).toBe(200);
      expect((await connect(brandA2, '100000000000002')).statusCode).toBe(200);
      expect(
        await owner.channel.count({ where: { licenseId: fx.a.licenseId, type: 'messenger' } }),
      ).toBe(2);

      // No brand named → the whole license, both brands' channels.
      const wide = await items();
      expect(wide).toHaveLength(2);
      expect(wide.map((i) => i.brand_id).sort()).toEqual([brandA1, brandA2].sort());
    });
  });

  // === The resolver — a foreign or bad brand id is 404, never 403 =============
  describe('X-Nexa-Brand resolution (un-enumerable, NFR-S5)', () => {
    it('404s a brand id that belongs to another license', async () => {
      // brandB is a real brand — just not one of A's — so RLS makes it invisible
      // to A's lookup and it comes back as not-found, not forbidden.
      expect((await list(brandB)).statusCode).toBe(404);
    });

    it('404s a malformed brand id rather than admitting the format with a 400', async () => {
      expect((await list('not-a-uuid')).statusCode).toBe(404);
    });

    it('404s a well-formed brand id that does not exist', async () => {
      expect((await list('00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    });
  });

  // === The pooled-connection trap (v2-02:476), now for the brand setting ======
  describe('brand context does not leak past its transaction', () => {
    it('unwinds the brand setting on commit', async () => {
      await withTenant(
        app,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId, brandId: brandA2 },
        (tx) => tx.channel.findMany(),
      );
      const [row] = await app.$queryRaw<Array<{ brand: string | null }>>`
        SELECT nexa_current_brand() AS brand
      `;
      expect(row?.brand).toBeNull();
    });

    it('unwinds the brand setting even when the transaction fails', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId, brandId: brandA2 },
          async (tx) => {
            await tx.channel.findMany();
            throw new Error('boom');
          },
        ),
      ).rejects.toThrow('boom');
      const [row] = await app.$queryRaw<Array<{ brand: string | null }>>`
        SELECT nexa_current_brand() AS brand
      `;
      expect(row?.brand).toBeNull();
    });

    it('rejects a malformed brand id instead of running unscoped', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId, brandId: 'garbage' },
          async () => 1,
        ),
      ).rejects.toThrow(/invalid tenant brand id/);
    });
  });

  // === The RLS policy itself, at the data layer, not just the HTTP resolver ===
  describe('channels_tenant enforces the brand condition', () => {
    beforeEach(async () => {
      // Seeded as the owner (not subject to RLS): one channel under brandA2.
      await owner.channel.create({
        data: {
          licenseId: fx.a.licenseId,
          brandId: brandA2,
          type: 'messenger',
          status: 'connected',
          config: {},
        },
      });
    });

    it('narrows reads to the active brand, and shows all brands when none is set', async () => {
      const readUnder = (brandId?: string) =>
        withTenant(
          app,
          {
            licenseId: fx.a.licenseId,
            organizationId: fx.a.organizationId,
            ...(brandId ? { brandId } : {}),
          },
          (tx) => tx.channel.findMany({ select: { brandId: true } }),
        );

      expect(await readUnder(brandA1)).toHaveLength(0); // wrong brand → invisible
      const underA2 = await readUnder(brandA2);
      expect(underA2).toHaveLength(1);
      expect(underA2[0]?.brandId).toBe(brandA2);
      expect(await readUnder()).toHaveLength(1); // license-wide → visible
    });

    it('WITH CHECK forbids writing a channel into a brand other than the context', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId, brandId: brandA1 },
          (tx) =>
            tx.channel.create({
              data: {
                licenseId: fx.a.licenseId,
                brandId: brandA2,
                type: 'twilio',
                status: 'connected',
                config: {},
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // === The coverage alarm — the matrix must equal the schema (78.8) ===========
  // Modelled on contract-parity.test.ts: derive one set from a declaration and
  // one from the live schema, then fail in both directions. Here the declaration
  // is BRAND_SCOPED_TABLES and the schema set is every `brand_id` column, so a
  // brand-scoped table can never be added without a matching isolation test.
  describe('brand-scope coverage alarm (schema-derived · v2-04 §7.1)', () => {
    const declared = new Set(BRAND_SCOPED_TABLES.map((t) => t.table));

    it('covers exactly the brand_id tables the schema has — no leak, no phantom', async () => {
      const inSchema = await brandScopedTablesInSchema(owner);
      // Guard against a vacuously-passing comparison of two empty sets.
      expect(inSchema.size).toBeGreaterThanOrEqual(BRAND_SCOPED_TABLES.length);

      const gaps = scopeCoverageGaps(declared, inSchema);
      expect(
        gaps.undeclared,
        `brand_id tables missing from BRAND_SCOPED_TABLES — each is an untested ` +
          `isolation surface (v2-04 §7.1). Add it to the matrix.`,
      ).toEqual([]);
      expect(
        gaps.phantom,
        `matrix names a table with no brand_id column — a stale entry proving nothing.`,
      ).toEqual([]);
    });

    it('fires when a new brand_id table goes undeclared — the alarm proves itself', async () => {
      // A real public table with a brand_id column, created then rolled back, so
      // the exact live-schema query the alarm runs above has to notice it.
      const probe = '_brand_scope_probe';
      let seen: Set<string> | null = null;
      await owner
        .$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`CREATE TABLE ${probe} (brand_id uuid)`);
          seen = await brandScopedTablesInSchema(tx);
          throw ROLLBACK_PROBE;
        })
        .catch((error: unknown) => {
          if (error !== ROLLBACK_PROBE) throw error;
        });

      expect(seen, 'the probe transaction did not run').not.toBeNull();
      // The detector sees the injected table...
      expect([...seen!]).toContain(probe);
      // ...and the two-way diff turns it into the failure the build would show.
      expect(scopeCoverageGaps(declared, seen!).undeclared).toContain(probe);
      // Rolled back cleanly: the probe leaves nothing behind for the next test.
      expect([...(await brandScopedTablesInSchema(owner))]).not.toContain(probe);
    });

    it('fires in reverse — a declared table with no brand_id column', () => {
      // The phantom direction, on the comparison itself: a matrix entry the
      // schema cannot back must not pass silently.
      const gaps = scopeCoverageGaps(new Set([...declared, 'accounts']), declared);
      expect(gaps.phantom).toContain('accounts');
    });
  });

  // === The matrix — cross-brand invisibility, one test per table (78.8) =======
  // v2-04:441 requires an isolation test for every brand-scoped repository
  // method. Generated from BRAND_SCOPED_TABLES so the requirement is met by
  // construction: the day a table joins the list, its test exists.
  describe('cross-brand isolation matrix (every brand-scoped table · NFR-S4/S5)', () => {
    const countByBrand = (
      ctx: { licenseId: bigint; organizationId: string; brandId?: string },
      table: string,
      target: string,
    ): Promise<number> =>
      withTenant(app, ctx, async (tx) => {
        const rows = await tx.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT count(*)::int AS count FROM ${table} WHERE brand_id = $1::uuid`,
          target,
        );
        return Number(rows[0]?.count ?? -1);
      });

    it.each(BRAND_SCOPED_TABLES.map((t) => t.table))(
      '%s: a brand-A2 row is hidden from brand A1 and from license B, shown only under A2',
      async (table) => {
        const entry = BRAND_SCOPED_TABLES.find((t) => t.table === table)!;
        await entry.plant(owner, { licenseId: fx.a.licenseId, brandId: brandA2 });

        const underA = (
          brandId?: string,
        ): { licenseId: bigint; organizationId: string; brandId?: string } => ({
          licenseId: fx.a.licenseId,
          organizationId: fx.a.organizationId,
          ...(brandId ? { brandId } : {}),
        });

        // Its own brand sees it; a sibling brand of the same license does not —
        // the property Multibrand adds on top of tenant isolation.
        expect(await countByBrand(underA(brandA2), table, brandA2)).toBe(1);
        expect(await countByBrand(underA(brandA1), table, brandA2)).toBe(0);
        // License-wide (no brand set) still sees it — a single-brand workspace
        // is unchanged.
        expect(await countByBrand(underA(), table, brandA2)).toBe(1);
        // Another license never sees it — the cross-tenant floor still holds.
        expect(
          await countByBrand(
            { licenseId: fx.b.licenseId, organizationId: fx.b.organizationId, brandId: brandB },
            table,
            brandA2,
          ),
        ).toBe(0);
      },
    );
  });
});
