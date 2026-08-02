/**
 * Brands — the Multibrand catalogue (PRD §5.3 · NFR-S4/S5).
 *
 * Two properties carry this suite. First, isolation: a brand belongs to one
 * license, and another license must never read, list, rename or delete it — a
 * cross-license id is answered 404 (`brand_not_found`), never 403, so ids stay
 * un-enumerable (NFR-S5), asserted across the A/B fixtures rather than trusted to
 * a WHERE clause. Second, two brand-specific guardrails: the license default
 * cannot be deleted, and a brand that still owns data (a channel or website) is
 * not silently cascaded away — the delete is refused (`not_allowed`).
 *
 * Negatives run before the happy-path CRUD cycle, the same order the KK is
 * written in.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedDefaultBrand, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Brand {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  is_default: boolean;
  created_at: string;
}

interface ErrorBody {
  error: { type: string; message: string; request_id: string };
}

describe('brands', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  let readToken: string;
  let adminTokenB: string;
  let noBrandToken: string;
  // Every license is created with exactly one default brand; seed it so the
  // "cannot delete the default" and list-ordering behaviours have one to see.
  let defaultBrandA: string;

  const auth = (token: string, brand?: string) => ({
    authorization: `Bearer ${token}`,
    ...(brand ? { 'x-nexa-brand': brand } : {}),
  });

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    [defaultBrandA] = await Promise.all([
      seedDefaultBrand(owner, fx.a.licenseId),
      seedDefaultBrand(owner, fx.b.licenseId),
    ]);
    await clearRateLimits(server.app);

    // The catalogue is license-level, but creating websites (for the "still has
    // data" delete guard) needs access_rules:rw too — bundled onto the admin token.
    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['brands--all:rw', 'access_rules:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['brands--all:ro'],
    });
    adminTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['brands--all:rw'],
    });
    // A token that holds no brand scope at all — for the "no access" case.
    noBrandToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:ro'],
    });
  });

  const create = (name: string, token = adminToken, extra: Record<string, unknown> = {}) =>
    server.post('/brands', { name, ...extra }, auth(token));

  // --- Cross-license isolation (NFR-S5), asserted first -----------------------

  it("404s another license's brand by id, never 403 (un-enumerable)", async () => {
    const mine = (await create('Acme EU')).json() as Brand;

    // Every verb the id could be probed through is a 404 for license B.
    expect((await server.get(`/brands/${mine.id}`, auth(adminTokenB))).statusCode).toBe(404);
    expect(
      (await server.patch(`/brands/${mine.id}`, { name: 'Hijacked' }, auth(adminTokenB))).statusCode,
    ).toBe(404);
    expect((await server.del(`/brands/${mine.id}`, auth(adminTokenB))).statusCode).toBe(404);

    // The type is the brand-specific 404, and the failed cross-license writes
    // left it untouched.
    const stillMine = await server.get(`/brands/${mine.id}`, auth(readToken));
    expect(stillMine.statusCode).toBe(200);
    expect((stillMine.json() as Brand).name).toBe('Acme EU');
    const notFound = await server.get(`/brands/${mine.id}`, auth(adminTokenB));
    expect((notFound.json() as ErrorBody).error.type).toBe('brand_not_found');
  });

  it("does not leak another license's brands into the list", async () => {
    await create('Acme EU');

    const listB = await server.get('/brands', auth(adminTokenB));
    const slugs = (listB.json() as { items: Brand[] }).items.map((b) => b.slug);
    expect(slugs).not.toContain('acme-eu');
    // B still sees exactly its own default.
    expect(slugs).toEqual(['default']);
  });

  // --- Default brand is protected --------------------------------------------

  it('refuses to delete the license default brand (not_allowed)', async () => {
    const del = await server.del(`/brands/${defaultBrandA}`, auth(adminToken));
    expect(del.statusCode).toBe(403);
    expect((del.json() as ErrorBody).error.type).toBe('not_allowed');

    // Still there.
    expect((await server.get(`/brands/${defaultBrandA}`, auth(readToken))).statusCode).toBe(200);
  });

  // --- A brand that still owns data is not cascaded away ----------------------

  it('refuses to delete a brand that still has a website (not_allowed)', async () => {
    const brand = (await create('Acme EU')).json() as Brand;
    // Attach a website to that brand via the brand header.
    const site = await server.post('/websites', { domain: 'eu.example' }, auth(adminToken, brand.id));
    expect(site.statusCode).toBe(201);

    const del = await server.del(`/brands/${brand.id}`, auth(adminToken));
    expect(del.statusCode).toBe(403);
    expect((del.json() as ErrorBody).error.type).toBe('not_allowed');

    // Both the brand and its website survive the refused delete.
    expect((await server.get(`/brands/${brand.id}`, auth(readToken))).statusCode).toBe(200);
  });

  // --- Duplicate slug is a conflict ------------------------------------------

  it('rejects a duplicate slug with a brand_exists 409, not a raw 500', async () => {
    const first = await create('Acme EU', adminToken, { slug: 'acme-eu' });
    expect(first.statusCode).toBe(201);

    const again = await create('Acme Europe', adminToken, { slug: 'acme-eu' });
    expect(again.statusCode).toBe(409);
    expect(again.statusCode).not.toBe(500);
    const body = again.json() as ErrorBody;
    expect(body.error.type).toBe('brand_exists');
    expect(body.error.request_id).toBeTruthy();
  });

  it('treats a derived slug collision the same way', async () => {
    expect((await create('Acme EU')).statusCode).toBe(201);
    // Same name → same derived slug `acme-eu` → conflict.
    expect((await create('Acme EU')).statusCode).toBe(409);
  });

  // --- Scope enforcement -----------------------------------------------------

  it('refuses to create a brand with only read scope', async () => {
    const response = await create('Acme EU', readToken);
    expect(response.statusCode).toBe(403);
  });

  it('refuses all brand access to a token without a brands scope', async () => {
    expect((await server.get('/brands', auth(noBrandToken))).statusCode).toBe(403);
    expect((await create('Acme EU', noBrandToken)).statusCode).toBe(403);
  });

  // --- Happy-path CRUD cycle (KK maddesi 1) ----------------------------------

  it('creates, lists, renames and removes a brand', async () => {
    // Create → 201, non-default, slug derived from name.
    const created = await create('Acme EU');
    expect(created.statusCode).toBe(201);
    const brand = created.json() as Brand;
    expect(brand.slug).toBe('acme-eu');
    expect(brand.is_default).toBe(false);
    expect(brand.logo_url).toBeNull();
    expect(brand.id).toMatch(/^[0-9a-f-]{36}$/);

    // List → default first, then the new brand.
    const list = await server.get('/brands', auth(readToken));
    expect(list.statusCode).toBe(200);
    const items = (list.json() as { items: Brand[] }).items;
    expect(items[0]?.is_default).toBe(true);
    expect(items.map((b) => b.slug)).toContain('acme-eu');

    // Rename → name changes, id and slug stay.
    const renamed = await server.patch(`/brands/${brand.id}`, { name: 'Acme Europe' }, auth(adminToken));
    expect(renamed.statusCode).toBe(200);
    expect((renamed.json() as Brand).name).toBe('Acme Europe');
    expect((renamed.json() as Brand).slug).toBe('acme-eu');

    // Delete → 204, then gone.
    expect((await server.del(`/brands/${brand.id}`, auth(adminToken))).statusCode).toBe(204);
    expect((await server.get(`/brands/${brand.id}`, auth(readToken))).statusCode).toBe(404);
  });

  it('lets a different license reuse the same slug', async () => {
    expect((await create('Acme EU', adminToken, { slug: 'shared' })).statusCode).toBe(201);
    // The unique key is [license_id, slug], so license B is unaffected.
    expect((await create('Acme EU', adminTokenB, { slug: 'shared' })).statusCode).toBe(201);
  });

  it('validates a bad slug and an empty patch', async () => {
    expect((await create('Acme', adminToken, { slug: 'Not Valid' })).statusCode).toBe(400);
    const brand = (await create('Acme EU')).json() as Brand;
    expect((await server.patch(`/brands/${brand.id}`, {}, auth(adminToken))).statusCode).toBe(400);
  });
});
