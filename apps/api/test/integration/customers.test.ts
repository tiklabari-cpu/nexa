/**
 * The customer directory.
 *
 * Two properties carry most of the weight here. Customers are scoped to an
 * *organization* rather than a license, which makes this the one CRUD surface
 * where a tenant-isolation mistake would be easy to make and invisible in
 * ordinary use — so the cross-tenant cases come first. And the chat/ticket
 * counts are computed, because the stored `chats_count` column has never been
 * written by anything and would report 0 for everyone.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('customers', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let readToken: string;
  let writeToken: string;

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

    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:ro'],
    });
    writeToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['customers:rw', 'customers.ban:rw'],
    });
  });

  // --- Tenant isolation ------------------------------------------------------

  describe('tenant isolation', () => {
    it("never lists another organization's customers", async () => {
      const response = await server.get('/customers?limit=100', auth(readToken));
      expect(response.statusCode).toBe(200);

      const body = response.json() as { items: Array<{ id: string }> };
      const ids = body.items.map((c) => c.id);
      expect(ids).toContain(fx.a.customerId);
      expect(ids).not.toContain(fx.b.customerId);
    });

    it('returns 404 — not 403 — for a customer in another organization', async () => {
      // 403 would confirm the id exists, turning the endpoint into an
      // enumeration oracle (NFR-S5).
      const response = await server.get(`/customers/${fx.b.customerId}`, auth(readToken));
      expect(response.statusCode).toBe(404);
      expect((response.json() as { error: { type: string } }).error.type).toBe('not_found');
    });

    it('refuses to edit a customer in another organization', async () => {
      const response = await server.patch(
        `/customers/${fx.b.customerId}`,
        { name: 'Taken over' },
        auth(writeToken),
      );
      expect(response.statusCode).toBe(404);

      const untouched = await owner.customer.findUnique({ where: { id: fx.b.customerId } });
      expect(untouched?.name).not.toBe('Taken over');
    });

    it('refuses to ban a customer in another organization', async () => {
      const response = await server.post(
        `/customers/${fx.b.customerId}/ban`,
        undefined,
        auth(writeToken),
      );
      expect(response.statusCode).toBe(404);

      const untouched = await owner.customer.findUnique({ where: { id: fx.b.customerId } });
      expect(untouched?.bannedAt).toBeNull();
    });
  });

  // --- Scope enforcement -----------------------------------------------------

  describe('scopes', () => {
    it('rejects reading without a customer scope', async () => {
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:ro'],
      });
      const response = await server.get('/customers', auth(token));
      expect(response.statusCode).toBe(403);
    });

    it('rejects editing with only read scope', async () => {
      const response = await server.patch(
        `/customers/${fx.a.customerId}`,
        { name: 'Nope' },
        auth(readToken),
      );
      expect(response.statusCode).toBe(403);
    });

    it('rejects banning with customers:rw alone', async () => {
      // Banning denies a person service. An agent who may fix a misspelled name
      // should not thereby be able to lock someone out.
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['customers:rw'],
      });
      const response = await server.post(
        `/customers/${fx.a.customerId}/ban`,
        undefined,
        auth(token),
      );
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Listing ---------------------------------------------------------------

  describe('listing', () => {
    it('counts conversations rather than reading the stale stored column', async () => {
      // `chats_count` is left at its default 0 on purpose here: the endpoint
      // must not be reading it.
      await owner.chat.create({
        data: { id: 'CUSTCOUNT1', licenseId: fx.a.licenseId, customerId: fx.a.customerId },
      });
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { chatsCount: 0 },
      });

      const response = await server.get('/customers?limit=100', auth(readToken));
      const body = response.json() as { items: Array<{ id: string; chats_count: number }> };
      const customer = body.items.find((c) => c.id === fx.a.customerId);

      expect(customer?.chats_count).toBe(1);
    });

    it('includes visitors who never gave a name', async () => {
      const anonymous = await owner.customer.create({
        data: { organizationId: fx.a.organizationId },
        select: { id: true },
      });

      const response = await server.get('/customers?limit=100', auth(readToken));
      const body = response.json() as { items: Array<{ id: string; name: string | null }> };
      const found = body.items.find((c) => c.id === anonymous.id);

      // Someone who opened the widget and said nothing is still a person
      // waiting for an answer.
      expect(found).toBeDefined();
      expect(found?.name).toBeNull();
    });

    it('searches across name, email and phone, case-insensitively', async () => {
      await owner.customer.create({
        data: {
          organizationId: fx.a.organizationId,
          name: 'Mira Haddad',
          email: 'MIRA@example.test',
          phone: '+441234567',
        },
      });

      for (const query of ['mira', 'MIRA@example', '441234']) {
        const response = await server.get(
          `/customers?query=${encodeURIComponent(query)}`,
          auth(readToken),
        );
        const body = response.json() as { items: Array<{ name: string | null }> };
        expect(
          body.items.map((c) => c.name),
          query,
        ).toContain('Mira Haddad');
      }
    });

    it('filters to leads', async () => {
      await owner.customer.create({
        data: {
          organizationId: fx.a.organizationId,
          name: 'A Lead',
          email: 'lead@example.test',
          isLead: true,
        },
      });
      await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Not A Lead' },
      });

      const response = await server.get('/customers?segment=leads&limit=100', auth(readToken));
      const names = (response.json() as { items: Array<{ name: string | null }> }).items.map(
        (c) => c.name,
      );

      expect(names).toContain('A Lead');
      expect(names).not.toContain('Not A Lead');
    });

    it('filters to banned', async () => {
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { bannedAt: new Date() },
      });

      const response = await server.get('/customers?segment=banned&limit=100', auth(readToken));
      const body = response.json() as { items: Array<{ id: string; banned: boolean }> };

      expect(body.items.map((c) => c.id)).toEqual([fx.a.customerId]);
      expect(body.items[0]?.banned).toBe(true);
    });

    it('pages without skipping or repeating anyone', async () => {
      // Deliberately mixes customers with and without `last_activity_at`: the
      // keyset predicate has to keep working once it crosses into the nulls,
      // which sort last. Getting that wrong ends the page early and hides every
      // inactive customer — a silent failure the count would not reveal.
      const now = Date.now();
      for (let i = 0; i < 6; i++) {
        await owner.customer.create({
          data: {
            organizationId: fx.a.organizationId,
            name: `Active ${i}`,
            lastActivityAt: new Date(now - i * 60_000),
          },
        });
      }
      for (let i = 0; i < 4; i++) {
        await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: `Silent ${i}` },
        });
      }

      const seen: string[] = [];
      let pageId: string | undefined;
      for (let guard = 0; guard < 20; guard++) {
        const url = `/customers?limit=3${pageId ? `&page_id=${encodeURIComponent(pageId)}` : ''}`;
        const response = await server.get(url, auth(readToken));
        expect(response.statusCode).toBe(200);

        const body = response.json() as {
          items: Array<{ id: string }>;
          total: number;
          next_page_id?: string;
        };
        seen.push(...body.items.map((c) => c.id));
        pageId = body.next_page_id;
        if (!pageId) break;
      }

      const total = await owner.customer.count({ where: { organizationId: fx.a.organizationId } });
      expect(seen).toHaveLength(total);
      expect(new Set(seen).size).toBe(total);
    });

    it('reports the total for the filter, not for the page', async () => {
      for (let i = 0; i < 5; i++) {
        await owner.customer.create({
          data: { organizationId: fx.a.organizationId, name: `Person ${i}` },
        });
      }

      const response = await server.get('/customers?limit=2', auth(readToken));
      const body = response.json() as { items: unknown[]; total: number };

      expect(body.items).toHaveLength(2);
      expect(body.total).toBeGreaterThan(2);
    });

    it('starts from the top on a malformed cursor instead of failing', async () => {
      // Almost always a stale bookmark. Failing the whole request for that is
      // worse than showing the first page.
      const response = await server.get('/customers?page_id=not-a-cursor', auth(readToken));
      expect(response.statusCode).toBe(200);
    });
  });

  // --- Detail ----------------------------------------------------------------

  describe('detail', () => {
    it("returns visits and conversations for the caller's license only", async () => {
      await owner.chat.create({
        data: { id: 'CUSTDETAIL', licenseId: fx.a.licenseId, customerId: fx.a.customerId },
      });
      await owner.visit.create({
        data: {
          customerId: fx.a.customerId,
          licenseId: fx.a.licenseId,
          pages: [{ url: 'https://shop.example/pricing', at: new Date().toISOString() }],
          browser: 'Chrome',
        },
      });

      const response = await server.get(`/customers/${fx.a.customerId}`, auth(readToken));
      expect(response.statusCode).toBe(200);

      const body = response.json() as {
        visits: Array<{ browser: string | null; pages: Array<{ url: string }> }>;
        chats: Array<{ id: string }>;
      };
      expect(body.chats.map((c) => c.id)).toContain('CUSTDETAIL');
      expect(body.visits[0]?.browser).toBe('Chrome');
      expect(body.visits[0]?.pages[0]?.url).toBe('https://shop.example/pricing');
    });

    it('rejects an id that is not a uuid', async () => {
      const response = await server.get('/customers/not-a-uuid', auth(readToken));
      expect(response.statusCode).toBe(400);
    });
  });

  // --- Editing ---------------------------------------------------------------

  describe('editing', () => {
    it('changes only the fields that were sent', async () => {
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { name: 'Original Name', phone: '+100' },
      });

      const response = await server.patch(
        `/customers/${fx.a.customerId}`,
        { phone: '+200' },
        auth(writeToken),
      );
      expect(response.statusCode).toBe(200);

      // Two agents editing different fields must not overwrite each other.
      const after = await owner.customer.findUnique({ where: { id: fx.a.customerId } });
      expect(after?.phone).toBe('+200');
      expect(after?.name).toBe('Original Name');
    });

    it('clears a field when null is sent', async () => {
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { phone: '+100' },
      });

      await server.patch(`/customers/${fx.a.customerId}`, { phone: null }, auth(writeToken));

      const after = await owner.customer.findUnique({ where: { id: fx.a.customerId } });
      expect(after?.phone).toBeNull();
    });

    it('marks a customer as a lead when an email is recorded', async () => {
      await server.patch(
        `/customers/${fx.a.customerId}`,
        { email: 'new@example.test' },
        auth(writeToken),
      );

      const after = await owner.customer.findUnique({ where: { id: fx.a.customerId } });
      expect(after?.isLead).toBe(true);
    });

    it('does not un-make a lead when the email is cleared', async () => {
      // They did give it to us. Rewriting that history would quietly corrupt
      // the lead figures in Reports.
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { email: 'given@example.test', isLead: true },
      });

      await server.patch(`/customers/${fx.a.customerId}`, { email: null }, auth(writeToken));

      const after = await owner.customer.findUnique({ where: { id: fx.a.customerId } });
      expect(after?.email).toBeNull();
      expect(after?.isLead).toBe(true);
    });

    it('rejects an empty body', async () => {
      const response = await server.patch(`/customers/${fx.a.customerId}`, {}, auth(writeToken));
      expect(response.statusCode).toBe(400);
    });

    it('rejects a malformed email', async () => {
      const response = await server.patch(
        `/customers/${fx.a.customerId}`,
        { email: 'not-an-email' },
        auth(writeToken),
      );
      expect(response.statusCode).toBe(400);
    });
  });

  // --- Banning ---------------------------------------------------------------

  describe('banning', () => {
    it('bans and lifts the ban', async () => {
      const banned = await server.post(
        `/customers/${fx.a.customerId}/ban`,
        undefined,
        auth(writeToken),
      );
      expect(banned.statusCode).toBe(200);
      expect((banned.json() as { banned: boolean }).banned).toBe(true);

      const lifted = await server.del(`/customers/${fx.a.customerId}/ban`, auth(writeToken));
      expect(lifted.statusCode).toBe(200);
      expect((lifted.json() as { banned: boolean; banned_at: string | null }).banned).toBe(false);
      expect((lifted.json() as { banned_at: string | null }).banned_at).toBeNull();
    });

    it('keeps the conversation history', async () => {
      // A ban is a moderation decision, not an erasure request. Deleting the
      // conversations would also delete the evidence it rested on.
      await owner.chat.create({
        data: { id: 'BANHISTORY', licenseId: fx.a.licenseId, customerId: fx.a.customerId },
      });

      await server.post(`/customers/${fx.a.customerId}/ban`, undefined, auth(writeToken));

      const chats = await owner.chat.count({ where: { customerId: fx.a.customerId } });
      expect(chats).toBeGreaterThan(0);
    });

    it('stops a banned customer from starting a new conversation', async () => {
      // The ban is only meaningful if the rest of the system honours it. The
      // enforcement already existed; until now nothing could set the flag.
      await server.post(`/customers/${fx.a.customerId}/ban`, undefined, auth(writeToken));

      const chatToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['chats--all:rw'],
      });
      const response = await server.post(
        '/chats',
        { customer_id: fx.a.customerId },
        auth(chatToken),
      );

      expect(response.statusCode).toBe(403);
      expect((response.json() as { error: { type: string } }).error.type).toBe('customer_banned');
    });

    it('is idempotent', async () => {
      await server.post(`/customers/${fx.a.customerId}/ban`, undefined, auth(writeToken));
      const again = await server.post(
        `/customers/${fx.a.customerId}/ban`,
        undefined,
        auth(writeToken),
      );
      expect(again.statusCode).toBe(200);
      expect((again.json() as { banned: boolean }).banned).toBe(true);
    });
  });
});
