/**
 * Website widgets — FR-MOD-08.5.2.
 *
 * Two properties carry this suite. First, isolation: a website belongs to one
 * license, and another tenant must never read, list or delete it — asserted
 * across the A/B fixtures rather than trusted to a WHERE clause. Second, the
 * duplicate is a *conflict* (`website_exists`, an ADR-06 envelope) and not a raw
 * 500 — the `[license, domain]` unique index must surface as a clean 409.
 *
 * The Connected transition is proved end to end: adding a site leaves it
 * `pending`, and a real widget handshake from its domain flips it to
 * `connected` — the same round trip the product depends on.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface Website {
  id: string;
  domain: string;
  setup: string;
  status: string;
  connected_at: string | null;
  created_at: string;
  snippet: string;
}

describe('websites', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  let readToken: string;
  let adminTokenB: string;

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
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);

    adminToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro'],
    });
    adminTokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['access_rules:rw'],
    });
  });

  // --- CRUD ------------------------------------------------------------------

  it('adds a website, defaulting setup to manual and status to pending', async () => {
    const created = await server.post('/websites', { domain: 'shop.example' }, auth(adminToken));
    expect(created.statusCode).toBe(201);

    const body = created.json() as Website;
    expect(body.domain).toBe('shop.example');
    expect(body.setup).toBe('manual');
    expect(body.status).toBe('pending');
    expect(body.connected_at).toBeNull();
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stores a pasted URL as the hostname the Origin check will match', async () => {
    const created = await server.post(
      '/websites',
      { domain: 'https://Pasted.Example/pricing?utm=ads', setup: 'platform' },
      auth(adminToken),
    );
    expect(created.statusCode).toBe(201);
    const body = created.json() as Website;
    expect(body.domain).toBe('pasted.example');
    expect(body.setup).toBe('platform');
  });

  it('rejects an unknown setup platform', async () => {
    const response = await server.post(
      '/websites',
      { domain: 'shop.example', setup: 'wix' },
      auth(adminToken),
    );
    expect(response.statusCode).toBe(400);
  });

  it('rejects a wildcard instead of storing something that can never match', async () => {
    const response = await server.post('/websites', { domain: '*.example.com' }, auth(adminToken));
    expect(response.statusCode).toBe(400);
  });

  it('lists websites for the license, ordered by domain', async () => {
    await server.post('/websites', { domain: 'zeta.example' }, auth(adminToken));
    await server.post('/websites', { domain: 'alpha.example' }, auth(adminToken));

    const list = await server.get('/websites', auth(readToken));
    expect(list.statusCode).toBe(200);
    const { items } = list.json() as { items: Website[] };
    expect(items.map((w) => w.domain)).toEqual(['alpha.example', 'zeta.example']);
  });

  it('gets a website by id', async () => {
    const created = (await server.post('/websites', { domain: 'shop.example' }, auth(adminToken)))
      .json() as Website;
    const got = await server.get(`/websites/${created.id}`, auth(readToken));
    expect(got.statusCode).toBe(200);
    expect((got.json() as Website).domain).toBe('shop.example');
  });

  it('removes a website', async () => {
    const created = (await server.post('/websites', { domain: 'shop.example' }, auth(adminToken)))
      .json() as Website;

    const removed = await server.del(`/websites/${created.id}`, auth(adminToken));
    expect(removed.statusCode).toBe(204);

    const gone = await server.get(`/websites/${created.id}`, auth(readToken));
    expect(gone.statusCode).toBe(404);
  });

  it('carries an install snippet naming the tenant and widget origin', async () => {
    const created = (await server.post('/websites', { domain: 'shop.example' }, auth(adminToken)))
      .json() as Website;
    expect(created.snippet).toContain(fx.a.organizationId);
    expect(created.snippet).toContain('window.__nexa');
    expect(created.snippet).toContain('/loader.js');
  });

  it('keeps the snippet minimal for a default (un-customised) appearance', async () => {
    // A workspace that never touched the customisation screen gets exactly the
    // snippet it always had — no appearance keys (FR-MOD-11.7).
    const created = (await server.post('/websites', { domain: 'plain.example' }, auth(adminToken)))
      .json() as Website;
    expect(created.snippet).not.toContain('primaryColor');
    expect(created.snippet).not.toContain('poweredBy');
    expect(created.snippet).not.toContain('theme');
  });

  it('bakes a customised appearance into the install snippet', async () => {
    // Only the overrides ride along; defaults are omitted to keep it tidy.
    await server.put(
      '/settings/widget',
      { primary_color: '#e11d48', position: 'bottom-left', powered_by: false },
      auth(adminToken),
    );

    const created = (await server.post('/websites', { domain: 'brand.example' }, auth(adminToken)))
      .json() as Website;
    expect(created.snippet).toContain('primaryColor: "#e11d48"');
    expect(created.snippet).toContain('position: "bottom-left"');
    expect(created.snippet).toContain('poweredBy: false');
    // Theme was left at its default, so it must not appear.
    expect(created.snippet).not.toContain('theme:');
  });

  // --- Duplicate is a conflict, not a 500 ------------------------------------

  it('rejects a duplicate domain with a website_exists envelope, not a raw 500', async () => {
    const first = await server.post('/websites', { domain: 'dup.example' }, auth(adminToken));
    expect(first.statusCode).toBe(201);

    const again = await server.post('/websites', { domain: 'dup.example' }, auth(adminToken));
    expect(again.statusCode).toBe(409);
    expect(again.statusCode).not.toBe(500);

    const body = again.json() as { error: { type: string; message: string; request_id: string } };
    expect(body.error.type).toBe('website_exists');
    expect(body.error.message).toContain('dup.example');
    expect(body.error.request_id).toBeTruthy();
  });

  it('lets a different license reuse the same domain', async () => {
    const a = await server.post('/websites', { domain: 'shared.example' }, auth(adminToken));
    expect(a.statusCode).toBe(201);
    // The unique index is [license_id, domain], so tenant B is unaffected.
    const b = await server.post('/websites', { domain: 'shared.example' }, auth(adminTokenB));
    expect(b.statusCode).toBe(201);
  });

  // --- Cross-tenant isolation (NFR-S5) ---------------------------------------

  it('hides another license\'s website behind a 404', async () => {
    const mine = (await server.post('/websites', { domain: 'a-only.example' }, auth(adminToken)))
      .json() as Website;

    const read = await server.get(`/websites/${mine.id}`, auth(adminTokenB));
    expect(read.statusCode).toBe(404);

    const del = await server.del(`/websites/${mine.id}`, auth(adminTokenB));
    expect(del.statusCode).toBe(404);

    // And it is untouched by the failed cross-tenant delete.
    const stillMine = await server.get(`/websites/${mine.id}`, auth(readToken));
    expect(stillMine.statusCode).toBe(200);
  });

  it('does not leak another license\'s websites into the list', async () => {
    await server.post('/websites', { domain: 'a-site.example' }, auth(adminToken));

    const listB = await server.get('/websites', auth(adminTokenB));
    const { items } = listB.json() as { items: Website[] };
    expect(items).toHaveLength(0);
  });

  // --- Scope enforcement -----------------------------------------------------

  it('refuses to add a website with only read scope', async () => {
    const response = await server.post('/websites', { domain: 'shop.example' }, auth(readToken));
    expect(response.statusCode).toBe(403);
  });

  // --- Connected transition (the widget handshake) ---------------------------

  it('flips a website to Connected on the widget\'s first handshake', async () => {
    // The site is added for a domain that is also a seeded trusted domain, so
    // the widget can actually mint a token there.
    const created = (
      await server.post('/websites', { domain: fx.a.trustedDomain }, auth(adminToken))
    ).json() as Website;
    expect(created.status).toBe('pending');

    const token = await server.post(
      '/customer/token',
      { organization_id: fx.a.organizationId, host_origin: `https://${fx.a.trustedDomain}` },
      { origin: 'https://widget.nexa.example' },
    );
    expect(token.statusCode).toBe(200);

    const after = await server.get(`/websites/${created.id}`, auth(readToken));
    const body = after.json() as Website;
    expect(body.status).toBe('connected');
    expect(body.connected_at).not.toBeNull();
  });

  it('does not connect a website whose domain no widget has handshaked from', async () => {
    const created = (
      await server.post('/websites', { domain: fx.a.trustedDomain }, auth(adminToken))
    ).json() as Website;

    // A handshake for tenant B's trusted domain must not touch tenant A's site.
    await server.post(
      '/customer/token',
      { organization_id: fx.b.organizationId, host_origin: `https://${fx.b.trustedDomain}` },
      { origin: 'https://widget.nexa.example' },
    );

    const after = await server.get(`/websites/${created.id}`, auth(readToken));
    expect((after.json() as Website).status).toBe('pending');
  });
});
