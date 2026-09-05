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
import { generateShortId } from '@nexa/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

/** NFR-P2: reads at p99 < 150 ms. */
const READ_BUDGET_MS = 150;

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

    it("excludes another license's visits from visits_count (NFR-S4)", async () => {
      // A stray row for the same customer but a foreign license — the
      // read must filter on licenseId, not trust customerId alone.
      await owner.visit.create({
        data: { customerId: fx.a.customerId, licenseId: fx.b.licenseId, pages: [] },
      });

      const response = await server.get(`/customers/${fx.a.customerId}`, auth(readToken));
      expect(response.statusCode).toBe(200);
      expect((response.json() as { visits_count: number }).visits_count).toBe(0);
    });

    it("excludes another license's groups from the visitor's groups list", async () => {
      const foreignGroup = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Foreign team' },
        select: { id: true },
      });
      await owner.chat.create({
        data: { id: 'CUSTGRPFOR', licenseId: fx.a.licenseId, customerId: fx.a.customerId },
      });
      await owner.chatAccess.create({
        data: { chatId: 'CUSTGRPFOR', groupId: foreignGroup.id },
      });

      const response = await server.get(`/customers/${fx.a.customerId}`, auth(readToken));
      expect(response.statusCode).toBe(200);
      expect((response.json() as { groups: unknown[] }).groups).toEqual([]);
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

  // --- Filter panel (FR-MOD-03.2.1) -------------------------------------------

  describe('condition filters (FR-MOD-03.2.1)', () => {
    it('filters to a country code, upper-cased at the edge', async () => {
      await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Robin FR', countryCode: 'FR' },
      });
      await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Robin US', countryCode: 'US' },
      });

      // Lower-case on the wire — the route upper-cases before it reaches the
      // service, matching the stored (always upper-case) convention.
      const response = await server.get('/customers?country_code=fr&limit=100', auth(readToken));
      const names = (response.json() as { items: Array<{ name: string | null }> }).items.map(
        (c) => c.name,
      );

      expect(names).toContain('Robin FR');
      expect(names).not.toContain('Robin US');
    });

    it('rejects a country code that is not two letters', async () => {
      const response = await server.get('/customers?country_code=FRA', auth(readToken));
      expect(response.statusCode).toBe(400);
    });

    it("never returns another organization's customer, regardless of which filter matches it", async () => {
      await owner.customer.update({
        where: { id: fx.a.customerId },
        data: { countryCode: 'US' },
      });
      await owner.customer.update({
        where: { id: fx.b.customerId },
        data: { countryCode: 'US' },
      });

      const response = await server.get('/customers?country_code=US&limit=100', auth(readToken));
      const ids = (response.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);

      expect(ids).toContain(fx.a.customerId);
      expect(ids).not.toContain(fx.b.customerId);
    });

    it('filters to a last_activity range', async () => {
      await owner.customer.create({
        data: {
          organizationId: fx.a.organizationId,
          name: 'In range',
          lastActivityAt: new Date('2026-01-15T12:00:00.000Z'),
        },
      });
      await owner.customer.create({
        data: {
          organizationId: fx.a.organizationId,
          name: 'Before range',
          lastActivityAt: new Date('2025-12-01T00:00:00.000Z'),
        },
      });
      await owner.customer.create({
        data: {
          organizationId: fx.a.organizationId,
          name: 'After range',
          lastActivityAt: new Date('2026-02-01T00:00:00.000Z'),
        },
      });

      const response = await server.get(
        '/customers?last_activity_from=2026-01-01&last_activity_to=2026-01-31&limit=100',
        auth(readToken),
      );
      const names = (response.json() as { items: Array<{ name: string | null }> }).items.map(
        (c) => c.name,
      );

      expect(names).toContain('In range');
      expect(names).not.toContain('Before range');
      expect(names).not.toContain('After range');
    });

    it('rejects a malformed date', async () => {
      const response = await server.get(
        '/customers?last_activity_from=01-01-2026',
        auth(readToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it("filters to customers with a ticket in the caller's license", async () => {
      const withTicket = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Has a ticket' },
        select: { id: true },
      });
      await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'No ticket' },
      });
      await owner.ticket.create({
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId: withTicket.id,
          subject: 'Has a ticket subject',
        },
      });

      const withResponse = await server.get(
        '/customers?has_tickets=true&limit=100',
        auth(readToken),
      );
      const withNames = (
        withResponse.json() as { items: Array<{ name: string | null }> }
      ).items.map((c) => c.name);
      expect(withNames).toContain('Has a ticket');
      expect(withNames).not.toContain('No ticket');

      const withoutResponse = await server.get(
        '/customers?has_tickets=false&limit=100',
        auth(readToken),
      );
      const withoutNames = (
        withoutResponse.json() as { items: Array<{ name: string | null }> }
      ).items.map((c) => c.name);
      expect(withoutNames).toContain('No ticket');
      expect(withoutNames).not.toContain('Has a ticket');
    });

    it("excludes another license's ticket from has_tickets (NFR-S4)", async () => {
      // Mirrors "excludes another license's visits from visits_count" above: a
      // stray row for the caller's own customer but a foreign license — the
      // read must filter on licenseId, not customerId alone.
      await owner.ticket.create({
        data: {
          id: generateShortId(),
          licenseId: fx.b.licenseId,
          customerId: fx.a.customerId,
          subject: 'Foreign license ticket',
        },
      });

      const response = await server.get('/customers?has_tickets=true&limit=100', auth(readToken));
      const ids = (response.json() as { items: Array<{ id: string }> }).items.map((c) => c.id);

      expect(ids).not.toContain(fx.a.customerId);
    });

    it('serves the country filter out of an index (EXPLAIN ANALYZE)', async () => {
      // Sparse fixture (tm 183.1's own guidance): enough rows to exercise the
      // predicate, few enough that the planner's row-count guess does not
      // drown out the structural question.
      await owner.customer.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          organizationId: fx.a.organizationId,
          name: `Country Probe ${i}`,
          countryCode: i === 0 ? 'DE' : 'US',
        })),
      });

      // The predicate `CustomerService#list` issues when only `country_code`
      // narrows the query: the tenant scope, the equality (upper-cased before
      // it gets here — see `routes/customers.ts`), the default ordering, and
      // the page's LIMIT.
      // `::uuid` on `$1`: `$queryRawUnsafe` sends parameters as text, and
      // Postgres has no bare `uuid = text` operator to fall back on.
      const sql = `SELECT id FROM customers WHERE organization_id = $1::uuid AND country_code = $2
                   ORDER BY last_activity_at DESC NULLS LAST, id DESC LIMIT 26`;

      const explain = async (plannerSetup: string[] = []): Promise<Record<string, unknown>> =>
        owner.$transaction(async (tx) => {
          for (const statement of plannerSetup) await tx.$executeRawUnsafe(statement);
          const [row] = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
            fx.a.organizationId,
            'DE',
          );
          const raw = row?.['QUERY PLAN'];
          const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<
            Record<string, unknown>
          >;
          return parsed[0] ?? {};
        });

      // Structural: the equality can be served from
      // `customers_organization_id_country_code_idx` rather than a sequential
      // scan of every customer this organization has ever had.
      const indexed = await explain(['SET LOCAL enable_seqscan = off']);
      const indexedPlan = JSON.stringify(indexed['Plan'] ?? {});
      expect(indexedPlan).toContain('customers_organization_id_country_code_idx');

      // Budgetary: sub-millisecond on this fixture either way, so this is a
      // floor a plan regression would blow through rather than a production
      // measurement — the figures are recorded in HANDOFF as the evidence
      // NFR-P2 owes.
      const planned = await explain();
      const plannedMs = planned['Execution Time'];
      const indexedMs = indexed['Execution Time'];
      expect(typeof plannedMs).toBe('number');
      expect(typeof indexedMs).toBe('number');
      console.log(
        'NFR-P2 GET /customers country_code filter — ' +
          `${String(plannedMs)} ms as planned · ${String(indexedMs)} ms forced onto the index`,
      );
      expect(plannedMs as number).toBeLessThan(READ_BUDGET_MS);
      expect(indexedMs as number).toBeLessThan(READ_BUDGET_MS);
    });

    it('serves the has_tickets filter out of an index (EXPLAIN ANALYZE)', async () => {
      const withTicket = await owner.customer.create({
        data: { organizationId: fx.a.organizationId, name: 'Ticket Probe 1' },
        select: { id: true },
      });
      await owner.customer.createMany({
        data: Array.from({ length: 4 }, (_, i) => ({
          organizationId: fx.a.organizationId,
          name: `Ticket Probe ${i + 2}`,
        })),
      });
      await owner.ticket.create({
        data: {
          id: generateShortId(),
          licenseId: fx.a.licenseId,
          customerId: withTicket.id,
          subject: 'Probe ticket',
        },
      });

      // The predicate `has_tickets: true` compiles to: an EXISTS check against
      // this license's tickets for the candidate customer.
      // `::uuid` on `$1` — see the sibling probe above for why.
      const sql = `SELECT c.id FROM customers c WHERE c.organization_id = $1::uuid
                   AND EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.id AND t.license_id = $2)
                   ORDER BY c.last_activity_at DESC NULLS LAST, c.id DESC LIMIT 26`;

      const explain = async (plannerSetup: string[] = []): Promise<Record<string, unknown>> =>
        owner.$transaction(async (tx) => {
          for (const statement of plannerSetup) await tx.$executeRawUnsafe(statement);
          const [row] = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
            fx.a.organizationId,
            fx.a.licenseId,
          );
          const raw = row?.['QUERY PLAN'];
          const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<
            Record<string, unknown>
          >;
          return parsed[0] ?? {};
        });

      // Structural: the EXISTS check can be served from
      // `tickets_license_customer_idx` rather than a sequential scan of the
      // license's tickets for every candidate customer row.
      const indexed = await explain(['SET LOCAL enable_seqscan = off']);
      const indexedPlan = JSON.stringify(indexed['Plan'] ?? {});
      expect(indexedPlan).toContain('tickets_license_customer_idx');

      const planned = await explain();
      const plannedMs = planned['Execution Time'];
      const indexedMs = indexed['Execution Time'];
      expect(typeof plannedMs).toBe('number');
      expect(typeof indexedMs).toBe('number');
      console.log(
        'NFR-P2 GET /customers has_tickets filter — ' +
          `${String(plannedMs)} ms as planned · ${String(indexedMs)} ms forced onto the index`,
      );
      expect(plannedMs as number).toBeLessThan(READ_BUDGET_MS);
      expect(indexedMs as number).toBeLessThan(READ_BUDGET_MS);
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

    it('reports the true visit count, not the truncated visits array (MAX_VISITS=10)', async () => {
      await owner.visit.createMany({
        data: Array.from({ length: 12 }, (_, i) => ({
          customerId: fx.a.customerId,
          licenseId: fx.a.licenseId,
          pages: [],
          startedAt: new Date(Date.now() - i * 60_000),
        })),
      });

      const response = await server.get(`/customers/${fx.a.customerId}`, auth(readToken));
      expect(response.statusCode).toBe(200);

      const body = response.json() as { visits: unknown[]; visits_count: number };
      expect(body.visits.length).toBe(10);
      expect(body.visits_count).toBe(12);
    });

    it('lists distinct groups from the chats this visitor has been routed to', async () => {
      const sales = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
        select: { id: true },
      });
      const support = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });

      // Only one *active* chat per customer+license is allowed (uq_one_active_chat) —
      // these model a visitor's closed history plus their one current chat.
      await owner.chat.create({
        data: {
          id: 'CUSTGRP001',
          licenseId: fx.a.licenseId,
          customerId: fx.a.customerId,
          active: false,
        },
      });
      await owner.chat.create({
        data: {
          id: 'CUSTGRP002',
          licenseId: fx.a.licenseId,
          customerId: fx.a.customerId,
          active: false,
        },
      });
      // A third chat routed to the same team as the first must not
      // duplicate that team in the result.
      await owner.chat.create({
        data: { id: 'CUSTGRP003', licenseId: fx.a.licenseId, customerId: fx.a.customerId },
      });
      await owner.chatAccess.create({ data: { chatId: 'CUSTGRP001', groupId: sales.id } });
      await owner.chatAccess.create({ data: { chatId: 'CUSTGRP002', groupId: support.id } });
      await owner.chatAccess.create({ data: { chatId: 'CUSTGRP003', groupId: sales.id } });

      const response = await server.get(`/customers/${fx.a.customerId}`, auth(readToken));
      expect(response.statusCode).toBe(200);

      const body = response.json() as { groups: Array<{ id: number; name: string }> };
      expect(body.groups.map((g) => g.name).sort()).toEqual(['Sales', 'Support']);
    });

    it('returns an empty groups array for a visitor with no chats', async () => {
      const response = await server.get(`/customers/${fx.a.customerId}`, auth(readToken));
      expect(response.statusCode).toBe(200);
      expect((response.json() as { groups: unknown[] }).groups).toEqual([]);
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
