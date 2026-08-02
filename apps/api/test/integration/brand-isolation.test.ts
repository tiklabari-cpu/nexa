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
    it("404s a brand id that belongs to another license", async () => {
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
          { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId, ...(brandId ? { brandId } : {}) },
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
});
