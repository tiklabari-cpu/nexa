/**
 * Workspace settings.
 *
 * The property worth the most here is that adding a trusted domain actually
 * makes the widget work on that site. Storing a hostname in a shape the token
 * endpoint never derives would leave an admin looking at a correct-seeming
 * allowlist while their widget is refused, with nothing anywhere to explain it —
 * so the round trip is tested through both endpoints rather than asserted on
 * the stored string.
 */
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { grantToken, ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

describe('settings', () => {
  let owner: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let adminToken: string;
  let readToken: string;

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
      scopes: ['access_rules:rw', 'canned_responses--all:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro', 'canned_responses--all:ro'],
    });
  });

  // --- Trusted domains -------------------------------------------------------

  describe('trusted domains', () => {
    it('makes the widget work on a domain right after adding it', async () => {
      // The whole point of the feature, end to end.
      const before = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: 'https://newshop.example' },
        { origin: 'https://widget.nexa.example' },
      );
      expect(before.statusCode).toBe(403);

      const added = await server.post(
        '/settings/trusted-domains',
        { domain: 'newshop.example' },
        auth(adminToken),
      );
      expect(added.statusCode).toBe(201);

      const after = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: 'https://newshop.example' },
        { origin: 'https://widget.nexa.example' },
      );
      expect(after.statusCode).toBe(200);
    });

    it('stores a pasted URL as a hostname the Origin check will match', async () => {
      const added = await server.post(
        '/settings/trusted-domains',
        { domain: 'https://Pasted.Example/pricing?utm=ads' },
        auth(adminToken),
      );
      expect(added.statusCode).toBe(201);
      expect((added.json() as { domain: string }).domain).toBe('pasted.example');

      const token = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: 'https://pasted.example' },
        { origin: 'https://widget.nexa.example' },
      );
      expect(token.statusCode).toBe(200);
    });

    it('rejects a wildcard instead of storing something that can never match', async () => {
      const response = await server.post(
        '/settings/trusted-domains',
        { domain: '*.example.com' },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('refuses a duplicate', async () => {
      await server.post('/settings/trusted-domains', { domain: 'dup.example' }, auth(adminToken));
      const again = await server.post(
        '/settings/trusted-domains',
        { domain: 'dup.example' },
        auth(adminToken),
      );
      expect(again.statusCode).toBe(403);
    });

    it('removes a domain and stops minting tokens for it', async () => {
      const added = await server.post(
        '/settings/trusted-domains',
        { domain: 'temporary.example' },
        auth(adminToken),
      );
      const { id } = added.json() as { id: string };

      const removed = await server.del(`/settings/trusted-domains/${id}`, auth(adminToken));
      expect(removed.statusCode).toBe(204);

      const token = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: 'https://temporary.example' },
        { origin: 'https://widget.nexa.example' },
      );
      expect(token.statusCode).toBe(403);
    });

    it("never shows or deletes another tenant's domain", async () => {
      const list = await server.get('/settings/trusted-domains', auth(readToken));
      const domains = (list.json() as { items: Array<{ domain: string }> }).items.map(
        (d) => d.domain,
      );
      expect(domains).toContain(fx.a.trustedDomain);
      expect(domains).not.toContain(fx.b.trustedDomain);

      const otherTenants = await owner.trustedDomain.findFirst({
        where: { licenseId: fx.b.licenseId },
        select: { id: true },
      });
      const response = await server.del(
        `/settings/trusted-domains/${otherTenants!.id}`,
        auth(adminToken),
      );
      expect(response.statusCode).toBe(404);
      expect(await owner.trustedDomain.count({ where: { id: otherTenants!.id } })).toBe(1);
    });

    it('requires write scope to change the allowlist', async () => {
      const response = await server.post(
        '/settings/trusted-domains',
        { domain: 'nope.example' },
        auth(readToken),
      );
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Canned responses ------------------------------------------------------

  describe('canned responses', () => {
    it('creates, edits and deletes a saved reply', async () => {
      const created = await server.post(
        '/settings/canned-responses',
        { shortcut: 'refund', text: 'Refunds take 3-5 working days.' },
        auth(adminToken),
      );
      expect(created.statusCode).toBe(201);
      const { id } = created.json() as { id: string };

      const edited = await server.patch(
        `/settings/canned-responses/${id}`,
        { text: 'Refunds take up to 5 working days.' },
        auth(adminToken),
      );
      expect(edited.statusCode).toBe(200);
      expect((edited.json() as { text: string; shortcut: string }).shortcut).toBe('refund');
      expect((edited.json() as { text: string }).text).toContain('up to 5');

      const deleted = await server.del(`/settings/canned-responses/${id}`, auth(adminToken));
      expect(deleted.statusCode).toBe(204);
    });

    it('refuses a duplicate shortcut in the same scope', async () => {
      await server.post(
        '/settings/canned-responses',
        { shortcut: 'hello', text: 'Hi' },
        auth(adminToken),
      );
      const again = await server.post(
        '/settings/canned-responses',
        { shortcut: 'hello', text: 'Hello again' },
        auth(adminToken),
      );
      expect(again.statusCode).toBe(403);
    });

    it('allows the same shortcut in a different scope', async () => {
      // `#hello` for a chat and `#hello` for a ticket are different replies.
      await server.post(
        '/settings/canned-responses',
        { shortcut: 'greet', text: 'Hi', scope: 'chat' },
        auth(adminToken),
      );
      const ticket = await server.post(
        '/settings/canned-responses',
        { shortcut: 'greet', text: 'Hello', scope: 'ticket' },
        auth(adminToken),
      );
      expect(ticket.statusCode).toBe(201);
    });

    it.each(['has space', 'has/slash', '', 'a'.repeat(41)])(
      'rejects the invalid shortcut %j',
      async (shortcut) => {
        const response = await server.post(
          '/settings/canned-responses',
          { shortcut, text: 'x' },
          auth(adminToken),
        );
        expect(response.statusCode).toBe(400);
      },
    );

    it('filters by scope', async () => {
      await server.post(
        '/settings/canned-responses',
        { shortcut: 'onlyticket', text: 'T', scope: 'ticket' },
        auth(adminToken),
      );

      const chats = await server.get('/settings/canned-responses?scope=chat', auth(readToken));
      const shortcuts = (chats.json() as { items: Array<{ shortcut: string }> }).items.map(
        (c) => c.shortcut,
      );
      expect(shortcuts).not.toContain('onlyticket');
    });

    it("never returns another tenant's replies", async () => {
      await owner.cannedResponse.create({
        data: {
          licenseId: fx.b.licenseId,
          shortcut: 'secret',
          text: 'Other tenant only',
          updatedAt: new Date(),
        },
      });

      const response = await server.get('/settings/canned-responses', auth(readToken));
      const shortcuts = (response.json() as { items: Array<{ shortcut: string }> }).items.map(
        (c) => c.shortcut,
      );
      expect(shortcuts).not.toContain('secret');
    });

    it('requires write scope to create', async () => {
      const response = await server.post(
        '/settings/canned-responses',
        { shortcut: 'nope', text: 'x' },
        auth(readToken),
      );
      expect(response.statusCode).toBe(403);
    });
  });

  // --- Routing rules ---------------------------------------------------------

  describe('routing rules', () => {
    // The shared fixtures deliberately carry no routing rules — routing is set
    // up per test in its own suite — so this one builds the arrangement it
    // needs rather than depending on data it does not own.
    let fallbackId: string;
    let conditionalId: string;

    beforeEach(async () => {
      const support = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Support' },
        select: { id: true },
      });
      const fallback = await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'Everything else',
          kind: 'chat',
          isFallback: true,
          targetGroupId: support.id,
          priority: 100,
        },
        select: { id: true },
      });
      fallbackId = fallback.id;

      const conditional = await owner.routingRule.create({
        data: {
          licenseId: fx.a.licenseId,
          name: 'Pricing page',
          kind: 'chat',
          conditions: { url_contains: '/pricing' },
          targetGroupId: support.id,
          priority: 10,
        },
        select: { id: true },
      });
      conditionalId = conditional.id;

      // A rule in the other tenant, to prove it stays out of reach.
      const otherGroup = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Their team' },
        select: { id: true },
      });
      await owner.routingRule.create({
        data: {
          licenseId: fx.b.licenseId,
          kind: 'chat',
          isFallback: true,
          targetGroupId: otherGroup.id,
          priority: 100,
        },
      });
    });

    it('lists rules with their target team resolved', async () => {
      const response = await server.get('/settings/routing-rules', auth(readToken));
      expect(response.statusCode).toBe(200);

      const items = (
        response.json() as {
          items: Array<{ is_fallback: boolean; target_group_name: string | null }>;
        }
      ).items;
      expect(items.length).toBeGreaterThan(0);
      // A bare group number tells an admin nothing about where work is going.
      expect(items.some((r) => r.target_group_name === 'Support')).toBe(true);
    });

    it('refuses to disable the fallback rule', async () => {
      // Without it, conversations matching nothing sit unassigned and the
      // configuration looks entirely healthy.
      const response = await server.patch(
        `/settings/routing-rules/${fallbackId}`,
        { enabled: false },
        auth(adminToken),
      );

      expect(response.statusCode).toBe(403);
      const after = await owner.routingRule.findUnique({ where: { id: fallbackId } });
      expect(after?.enabled).toBe(true);
    });

    it('disables a rule that is not the fallback', async () => {
      const response = await server.patch(
        `/settings/routing-rules/${conditionalId}`,
        { enabled: false },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(200);
      expect((response.json() as { enabled: boolean }).enabled).toBe(false);
    });

    it('retargets a rule to another team', async () => {
      const sales = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
        select: { id: true },
      });

      const response = await server.patch(
        `/settings/routing-rules/${conditionalId}`,
        { target_group_id: Number(sales.id) },
        auth(adminToken),
      );

      expect(response.statusCode).toBe(200);
      expect((response.json() as { target_group_name: string }).target_group_name).toBe('Sales');
    });

    it('rejects a target team that does not exist', async () => {
      const response = await server.patch(
        `/settings/routing-rules/${fallbackId}`,
        { target_group_id: 999_999 },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('rejects a team belonging to another tenant', async () => {
      // The id is real, which is exactly why the check has to be tenant-scoped
      // rather than a plain existence lookup.
      const otherGroup = await owner.group.findFirst({
        where: { licenseId: fx.b.licenseId },
        select: { id: true },
      });
      const response = await server.patch(
        `/settings/routing-rules/${fallbackId}`,
        { target_group_id: Number(otherGroup!.id) },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it("never touches another tenant's rule", async () => {
      const other = await owner.routingRule.findFirst({
        where: { licenseId: fx.b.licenseId },
        select: { id: true, priority: true },
      });
      const response = await server.patch(
        `/settings/routing-rules/${other!.id}`,
        { priority: 99 },
        auth(adminToken),
      );

      expect(response.statusCode).toBe(404);
      const after = await owner.routingRule.findUnique({ where: { id: other!.id } });
      expect(after?.priority).toBe(other!.priority);
    });

    it("lists only this tenant's rules", async () => {
      const response = await server.get('/settings/routing-rules', auth(readToken));
      const ids = (response.json() as { items: Array<{ id: string }> }).items.map((r) => r.id);

      const otherIds = (
        await owner.routingRule.findMany({
          where: { licenseId: fx.b.licenseId },
          select: { id: true },
        })
      ).map((r) => r.id);

      expect(ids).toContain(fallbackId);
      for (const id of otherIds) expect(ids).not.toContain(id);
    });
  });
});
