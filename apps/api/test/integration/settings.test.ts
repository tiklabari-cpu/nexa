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
import { generateShortId } from '@nexa/types';
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
      scopes: ['access_rules:rw', 'canned_responses--all:rw', 'tags--all:rw'],
    });
    readToken = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['access_rules:ro', 'canned_responses--all:ro', 'tags--all:ro'],
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

  // --- Tag library -----------------------------------------------------------

  describe('tags', () => {
    it('creates, renames and deletes a tag', async () => {
      const created = await server.post('/settings/tags', { name: 'VIP' }, auth(adminToken));
      expect(created.statusCode).toBe(201);
      const body = created.json() as {
        id: string;
        name: string;
        group_ids: number[];
        usage_count: number;
      };
      // Stored with the same normalisation the inbox applies when tagging a chat,
      // so the library and live tagging never split into two spellings.
      expect(body.name).toBe('vip');
      expect(body.group_ids).toEqual([]);
      expect(body.usage_count).toBe(0);

      const renamed = await server.patch(
        `/settings/tags/${body.id}`,
        { name: 'priority' },
        auth(adminToken),
      );
      expect(renamed.statusCode).toBe(200);
      expect((renamed.json() as { name: string }).name).toBe('priority');

      const deleted = await server.del(`/settings/tags/${body.id}`, auth(adminToken));
      expect(deleted.statusCode).toBe(204);
    });

    it('scopes a tag to specific teams', async () => {
      const group = await owner.group.create({
        data: { licenseId: fx.a.licenseId, name: 'Sales' },
      });
      const created = await server.post(
        '/settings/tags',
        { name: 'sales-lead', group_ids: [Number(group.id)] },
        auth(adminToken),
      );
      expect(created.statusCode).toBe(201);
      expect((created.json() as { group_ids: number[] }).group_ids).toEqual([Number(group.id)]);
    });

    it("rejects a team that isn't this workspace's", async () => {
      // A group id from another tenant must not scope a tag here — RLS hides it,
      // so it reads as an unknown team.
      const theirGroup = await owner.group.create({
        data: { licenseId: fx.b.licenseId, name: 'Theirs' },
      });
      const response = await server.post(
        '/settings/tags',
        { name: 'x', group_ids: [Number(theirGroup.id)] },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
    });

    it('refuses a duplicate name, comparing after normalisation', async () => {
      await server.post('/settings/tags', { name: 'refund' }, auth(adminToken));
      const again = await server.post('/settings/tags', { name: 'Refund' }, auth(adminToken));
      expect(again.statusCode).toBe(403);
    });

    it.each(['', 'a'.repeat(65)])('rejects the invalid name %j', async (name) => {
      const response = await server.post('/settings/tags', { name }, auth(adminToken));
      expect(response.statusCode).toBe(400);
    });

    it('shares the library with chat tagging, counting live usage', async () => {
      const created = await server.post('/settings/tags', { name: 'refunds' }, auth(adminToken));
      const { id } = created.json() as { id: string };

      // A conversation carrying the tag points at this very row — the library and
      // chat tagging are one table, not two lists — so the count reflects real
      // usage. This is what "chat tagging fed from the library" means concretely.
      const chatId = generateShortId();
      const threadId = generateShortId();
      await owner.chat.create({
        data: { id: chatId, licenseId: fx.a.licenseId, customerId: fx.a.customerId },
      });
      await owner.thread.create({ data: { id: threadId, chatId, licenseId: fx.a.licenseId } });
      await owner.threadTag.create({ data: { threadId, tagId: id } });

      const listed = await server.get('/settings/tags', auth(readToken));
      const found = (
        listed.json() as { items: Array<{ id: string; usage_count: number }> }
      ).items.find((t) => t.id === id);
      expect(found?.usage_count).toBe(1);
    });

    it("never returns or deletes another tenant's tag", async () => {
      const theirs = await owner.tag.create({
        data: { licenseId: fx.b.licenseId, name: 'their-secret' },
      });

      const listed = await server.get('/settings/tags', auth(readToken));
      const names = (listed.json() as { items: Array<{ name: string }> }).items.map((t) => t.name);
      expect(names).not.toContain('their-secret');

      // The id alone must not reach across tenants.
      const attempt = await server.del(`/settings/tags/${theirs.id}`, auth(adminToken));
      expect(attempt.statusCode).toBe(404);

      const still = await owner.tag.findUnique({ where: { id: theirs.id } });
      expect(still).not.toBeNull();
    });

    it('requires write scope to create', async () => {
      const response = await server.post('/settings/tags', { name: 'nope' }, auth(readToken));
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

  // --- Security / file sharing -----------------------------------------------

  describe('security settings', () => {
    // These fields decide what FR-MOD-08.9.4 lets through. Until this endpoint
    // existed they could only be changed by editing the database, so every
    // workspace ran on the shipped defaults whether they suited it or not.

    it('returns the schema defaults when no row exists', async () => {
      // Signup does not create this row — only the seed does — so this is what
      // a real workspace reads until it saves for the first time.
      const none = await owner.securitySettings.findUnique({
        where: { licenseId: fx.a.licenseId },
      });
      expect(none).toBeNull();

      const response = await server.get('/settings/security', auth(readToken));
      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown>;

      // Pins the constants in routes/settings.ts to the column defaults: a row
      // created with nothing but its key must match what the endpoint invents.
      const fromSchema = await owner.securitySettings.create({
        data: { licenseId: fx.b.licenseId },
      });
      expect(body).toMatchObject({
        banned_customer_ips: fromSchema.bannedCustomerIps,
        file_sharing_enabled: fromSchema.fileSharingEnabled,
        allowed_file_types: fromSchema.allowedFileTypes,
        max_file_size_bytes: fromSchema.maxFileSizeBytes,
        spam_filter_enabled: fromSchema.spamFilterEnabled,
        require_two_factor: fromSchema.requireTwoFactor,
        ip_allowlist_enforced: fromSchema.ipAllowlistEnforced,
        session_idle_timeout_seconds: fromSchema.sessionIdleTimeoutSeconds,
        max_concurrent_sessions: fromSchema.maxConcurrentSessions,
      });
      // Session policy is off until something writes it: the allowlist flag
      // is false, both limits are null.
      expect(body.ip_allowlist_enforced).toBe(false);
      expect(body.session_idle_timeout_seconds).toBeNull();
      expect(body.max_concurrent_sessions).toBeNull();
      // No blocked addresses until a workspace adds one.
      expect(body.banned_customer_ips).toEqual([]);
      // No row was written to answer a read.
      expect(
        await owner.securitySettings.findUnique({ where: { licenseId: fx.a.licenseId } }),
      ).toBeNull();
      expect(body.updated_at).toBeNull();
    });

    it('creates the row on first save and reads it back', async () => {
      const saved = await server.patch(
        '/settings/security',
        { allowed_file_types: ['image/png', 'text/csv'], max_file_size_bytes: 2_000_000 },
        auth(adminToken),
      );
      expect(saved.statusCode).toBe(200);

      const after = await server.get('/settings/security', auth(readToken));
      expect(after.json()).toMatchObject({
        allowed_file_types: ['image/png', 'text/csv'],
        max_file_size_bytes: 2_000_000,
        // Untouched fields keep their defaults rather than becoming null.
        file_sharing_enabled: true,
        spam_filter_enabled: true,
      });
    });

    it('stores MIME types lowercased so they match what a browser sends', async () => {
      const response = await server.patch(
        '/settings/security',
        { allowed_file_types: ['IMAGE/PNG'] },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(200);
      expect((response.json() as { allowed_file_types: string[] }).allowed_file_types).toEqual([
        'image/png',
      ]);
    });

    it('refuses an extension where a MIME type belongs', async () => {
      // `.pdf` would sit in the allowlist looking like a rule and match nothing
      // a browser ever labels, so file sharing would look configured and block
      // every upload.
      for (const bad of ['.pdf', 'pdf', 'image/', 'image']) {
        const response = await server.patch(
          '/settings/security',
          { allowed_file_types: [bad] },
          auth(adminToken),
        );
        expect(response.statusCode, `${bad} should be rejected`).toBe(400);
        expect((response.json() as { error: { type: string } }).error.type).toBe('validation');
      }
    });

    it('refuses a size above the ceiling and a body with nothing in it', async () => {
      const tooBig = await server.patch(
        '/settings/security',
        { max_file_size_bytes: 104_857_601 },
        auth(adminToken),
      );
      expect(tooBig.statusCode).toBe(400);

      const empty = await server.patch('/settings/security', {}, auth(adminToken));
      expect(empty.statusCode).toBe(400);
    });

    it('refuses to write with a read-only token', async () => {
      const response = await server.patch(
        '/settings/security',
        { file_sharing_enabled: false },
        auth(readToken),
      );
      expect(response.statusCode).toBe(403);
    });

    it('stores banned customer IPs and reads them back (FR-MOD-08.9.2)', async () => {
      const saved = await server.patch(
        '/settings/security',
        { banned_customer_ips: ['203.0.113.5', '2001:db8::1'] },
        auth(adminToken),
      );
      expect(saved.statusCode).toBe(200);

      const after = await server.get('/settings/security', auth(readToken));
      expect((after.json() as { banned_customer_ips: string[] }).banned_customer_ips).toEqual([
        '203.0.113.5',
        '2001:db8::1',
      ]);
    });

    it('refuses an entry that is not a valid IP address', async () => {
      for (const bad of ['not-an-ip', '999.0.0.1', '203.0.113.5/24', '']) {
        const response = await server.patch(
          '/settings/security',
          { banned_customer_ips: [bad] },
          auth(adminToken),
        );
        expect(response.statusCode, `${bad} should be rejected`).toBe(400);
        expect((response.json() as { error: { type: string } }).error.type).toBe('validation');
      }
    });

    it('normalises and dedupes an address given in two shapes', async () => {
      // The IPv4-mapped IPv6 form and the bare IPv4 are one address; storing two
      // entries would let one linger after the other is removed.
      const response = await server.patch(
        '/settings/security',
        { banned_customer_ips: ['203.0.113.5', '::ffff:203.0.113.5', '2001:DB8::2'] },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(200);
      expect((response.json() as { banned_customer_ips: string[] }).banned_customer_ips).toEqual([
        '203.0.113.5',
        '2001:db8::2',
      ]);
    });

    it("never lets one tenant's banned IPs reach another's row", async () => {
      await owner.securitySettings.create({
        data: { licenseId: fx.b.licenseId, bannedCustomerIps: ['198.51.100.7'] },
      });

      // Their list must not leak into our read...
      const read = await server.get('/settings/security', auth(readToken));
      expect((read.json() as { banned_customer_ips: string[] }).banned_customer_ips).toEqual([]);

      // ...and our write must not reach it.
      const written = await server.patch(
        '/settings/security',
        { banned_customer_ips: ['203.0.113.9'] },
        auth(adminToken),
      );
      expect(written.statusCode).toBe(200);

      const theirs = await owner.securitySettings.findUnique({
        where: { licenseId: fx.b.licenseId },
      });
      expect(theirs?.bannedCustomerIps).toEqual(['198.51.100.7']);
    });

    it("never reads or writes another tenant's rules", async () => {
      await owner.securitySettings.create({
        data: { licenseId: fx.b.licenseId, fileSharingEnabled: false, maxFileSizeBytes: 999 },
      });

      // Their row must not leak into our read...
      const read = await server.get('/settings/security', auth(readToken));
      expect(read.json()).toMatchObject({ file_sharing_enabled: true, max_file_size_bytes: 10_485_760 });

      // ...and our write must not reach it.
      const written = await server.patch(
        '/settings/security',
        { max_file_size_bytes: 5_000 },
        auth(adminToken),
      );
      expect(written.statusCode).toBe(200);

      const theirs = await owner.securitySettings.findUnique({
        where: { licenseId: fx.b.licenseId },
      });
      expect(theirs?.maxFileSizeBytes).toBe(999);
      expect(theirs?.fileSharingEnabled).toBe(false);
    });

    // --- Session policy write surface (FR-MOD-08.9.6-f) -----------------------
    //
    // Validation and storage only — nothing enforces these yet (that is
    // 08.9.6-g). What matters here is that a saved value round-trips exactly,
    // a value that could never be enforced (zero, negative, or above the
    // ceiling) is rejected before it is stored, and `null` is the one way to
    // turn a limit back off.

    it('stores session policy fields and reads them back, off by null', async () => {
      const saved = await server.patch(
        '/settings/security',
        {
          ip_allowlist_enforced: true,
          session_idle_timeout_seconds: 900,
          max_concurrent_sessions: 3,
        },
        auth(adminToken),
      );
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        ip_allowlist_enforced: true,
        session_idle_timeout_seconds: 900,
        max_concurrent_sessions: 3,
      });

      const after = await server.get('/settings/security', auth(readToken));
      expect(after.json()).toMatchObject({
        ip_allowlist_enforced: true,
        session_idle_timeout_seconds: 900,
        max_concurrent_sessions: 3,
      });

      // null turns a limit back off, the same as never having saved it.
      const cleared = await server.patch(
        '/settings/security',
        { session_idle_timeout_seconds: null, max_concurrent_sessions: null },
        auth(adminToken),
      );
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json()).toMatchObject({
        session_idle_timeout_seconds: null,
        max_concurrent_sessions: null,
        // Untouched field keeps its saved value rather than resetting.
        ip_allowlist_enforced: true,
      });
    });

    it('rejects a zero, negative, non-integer or above-ceiling session-policy limit', async () => {
      // 2_592_001 and 26 sit one past the 30-day / MAX_ACTIVE_TOKENS_PER_OWNER
      // ceilings — a value the enforcement sweep (08.9.6-g) could never act on
      // as written.
      const bad = [
        { session_idle_timeout_seconds: 0 },
        { session_idle_timeout_seconds: -1 },
        { session_idle_timeout_seconds: 1.5 },
        { session_idle_timeout_seconds: 2_592_001 },
        { max_concurrent_sessions: 0 },
        { max_concurrent_sessions: -1 },
        { max_concurrent_sessions: 1.5 },
        { max_concurrent_sessions: 26 },
      ];
      for (const body of bad) {
        const response = await server.patch('/settings/security', body, auth(adminToken));
        expect(response.statusCode, `${JSON.stringify(body)} should be rejected`).toBe(400);
        expect((response.json() as { error: { type: string } }).error.type).toBe('validation');
      }
    });

    it('records a session-policy change with only the changed field names', async () => {
      const auditWhere = { licenseId: fx.a.licenseId, action: 'settings.security_updated' };
      const before = await owner.auditLogEntry.count({ where: auditWhere });

      const response = await server.patch(
        '/settings/security',
        { ip_allowlist_enforced: true, max_concurrent_sessions: 5 },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(200);
      expect(await owner.auditLogEntry.count({ where: auditWhere })).toBe(before + 1);

      const entry = await owner.auditLogEntry.findFirst({
        where: auditWhere,
        orderBy: { createdAt: 'desc' },
      });
      const fields = (entry?.metadata as { fields: string[] }).fields;
      expect(fields).toEqual(
        expect.arrayContaining(['ip_allowlist_enforced', 'max_concurrent_sessions']),
      );
      expect(fields).toHaveLength(2);
    });

    it("never lets one tenant's session policy reach another's row", async () => {
      await owner.securitySettings.create({
        data: { licenseId: fx.b.licenseId, ipAllowlistEnforced: true, maxConcurrentSessions: 7 },
      });

      // Their policy must not leak into our read...
      const read = await server.get('/settings/security', auth(readToken));
      expect(read.json()).toMatchObject({ ip_allowlist_enforced: false, max_concurrent_sessions: null });

      // ...and our write must not reach it.
      const written = await server.patch(
        '/settings/security',
        { ip_allowlist_enforced: false, max_concurrent_sessions: 1 },
        auth(adminToken),
      );
      expect(written.statusCode).toBe(200);

      const theirs = await owner.securitySettings.findUnique({
        where: { licenseId: fx.b.licenseId },
      });
      expect(theirs?.ipAllowlistEnforced).toBe(true);
      expect(theirs?.maxConcurrentSessions).toBe(7);
    });
  });

  // --- Chat timeout (idle auto-close) ----------------------------------------

  describe('chat timeout', () => {
    // FR-MOD-08.7.3: the positive window a "dead" chat is auto-closed after. The
    // property that matters is that a non-positive window can never be stored —
    // reaching the sweep it would close every live chat at once — so the
    // rejection is tested on the endpoint, not just asserted about the column.

    it('reads as disabled until it is set, without writing a row', async () => {
      const none = await owner.inboxSettings.findUnique({
        where: { licenseId: fx.a.licenseId },
      });
      expect(none).toBeNull();

      const response = await server.get('/settings/chat-timeout', auth(readToken));
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ chat_timeout_seconds: null, updated_at: null });

      // No row was written to answer a read.
      expect(
        await owner.inboxSettings.findUnique({ where: { licenseId: fx.a.licenseId } }),
      ).toBeNull();
    });

    it('enables a positive window on first save and reads it back', async () => {
      const saved = await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: 3600 },
        auth(adminToken),
      );
      expect(saved.statusCode).toBe(200);
      expect((saved.json() as { chat_timeout_seconds: number }).chat_timeout_seconds).toBe(3600);

      const after = await server.get('/settings/chat-timeout', auth(readToken));
      expect((after.json() as { chat_timeout_seconds: number }).chat_timeout_seconds).toBe(3600);
      expect((after.json() as { updated_at: string | null }).updated_at).not.toBeNull();
    });

    it('disables again by saving null', async () => {
      await server.put('/settings/chat-timeout', { chat_timeout_seconds: 900 }, auth(adminToken));
      const disabled = await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: null },
        auth(adminToken),
      );
      expect(disabled.statusCode).toBe(200);
      expect((disabled.json() as { chat_timeout_seconds: number | null }).chat_timeout_seconds).toBeNull();
    });

    it.each([0, -1, -3600])('rejects the non-positive window %j', async (seconds) => {
      const response = await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: seconds },
        auth(adminToken),
      );
      expect(response.statusCode).toBe(400);
      expect((response.json() as { error: { type: string } }).error.type).toBe('validation');
      // Nothing was stored — a rejected window must not leave a row behind.
      expect(
        await owner.inboxSettings.findUnique({ where: { licenseId: fx.a.licenseId } }),
      ).toBeNull();
    });

    it('rejects a non-integer or absurdly large window', async () => {
      for (const bad of [1.5, 2_592_001]) {
        const response = await server.put(
          '/settings/chat-timeout',
          { chat_timeout_seconds: bad },
          auth(adminToken),
        );
        expect(response.statusCode, `${bad} should be rejected`).toBe(400);
      }
    });

    it('requires the field rather than treating an empty body as disable', async () => {
      const response = await server.put('/settings/chat-timeout', {}, auth(adminToken));
      expect(response.statusCode).toBe(400);
    });

    it('requires write scope to change the window', async () => {
      const response = await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: 60 },
        auth(readToken),
      );
      expect(response.statusCode).toBe(403);
    });

    it("never reads or writes another tenant's window", async () => {
      await owner.inboxSettings.create({
        data: { licenseId: fx.b.licenseId, chatTimeoutSeconds: 120 },
      });

      // Their row must not leak into our read…
      const read = await server.get('/settings/chat-timeout', auth(readToken));
      expect((read.json() as { chat_timeout_seconds: number | null }).chat_timeout_seconds).toBeNull();

      // …and our write must not reach it.
      const written = await server.put(
        '/settings/chat-timeout',
        { chat_timeout_seconds: 999 },
        auth(adminToken),
      );
      expect(written.statusCode).toBe(200);

      const theirs = await owner.inboxSettings.findUnique({
        where: { licenseId: fx.b.licenseId },
      });
      expect(theirs?.chatTimeoutSeconds).toBe(120);
    });
  });

  describe('widget appearance', () => {
    // FR-MOD-11.7: the customisable surface of the widget. A partial save must
    // land a complete, valid row (defaults fill the rest), and nothing but a
    // colour/enum can be stored — the values ride in the install snippet and CSS.

    it('reads the shipped defaults until it is set, without writing a row', async () => {
      expect(
        await owner.widgetSettings.findUnique({ where: { licenseId: fx.a.licenseId } }),
      ).toBeNull();

      const response = await server.get('/settings/widget', auth(readToken));
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        primary_color: '#2f6bff',
        position: 'bottom-right',
        theme: 'auto',
        mobile_fullscreen: true,
        powered_by: true,
        updated_at: null,
      });

      // A read must not materialise a row.
      expect(
        await owner.widgetSettings.findUnique({ where: { licenseId: fx.a.licenseId } }),
      ).toBeNull();
    });

    it('saves a partial change and fills the rest from the defaults', async () => {
      const saved = await server.put(
        '/settings/widget',
        { primary_color: '#E11D48' },
        auth(adminToken),
      );
      expect(saved.statusCode).toBe(200);
      expect(saved.json()).toMatchObject({
        // Normalised to lower case on the way in.
        primary_color: '#e11d48',
        position: 'bottom-right',
        theme: 'auto',
        mobile_fullscreen: true,
        powered_by: true,
      });
      expect((saved.json() as { updated_at: string | null }).updated_at).not.toBeNull();
    });

    it('saves the whole appearance and reads it back', async () => {
      await server.put(
        '/settings/widget',
        {
          primary_color: '#0a7f3f',
          position: 'bottom-left',
          theme: 'dark',
          mobile_fullscreen: false,
          powered_by: false,
        },
        auth(adminToken),
      );
      const after = await server.get('/settings/widget', auth(readToken));
      expect(after.json()).toMatchObject({
        primary_color: '#0a7f3f',
        position: 'bottom-left',
        theme: 'dark',
        mobile_fullscreen: false,
        powered_by: false,
      });
    });

    it.each(['red', '#12g', '#12345', 'rgb(0,0,0)'])(
      'rejects the non-hex colour %j and stores nothing',
      async (color) => {
        const response = await server.put('/settings/widget', { primary_color: color }, auth(adminToken));
        expect(response.statusCode).toBe(400);
        expect((response.json() as { error: { type: string } }).error.type).toBe('validation');
        expect(
          await owner.widgetSettings.findUnique({ where: { licenseId: fx.a.licenseId } }),
        ).toBeNull();
      },
    );

    it.each([
      { position: 'top-left' },
      { theme: 'neon' },
    ])('rejects an out-of-range enum %j', async (body) => {
      const response = await server.put('/settings/widget', body, auth(adminToken));
      expect(response.statusCode).toBe(400);
    });

    it('rejects an empty body rather than treating it as a reset', async () => {
      const response = await server.put('/settings/widget', {}, auth(adminToken));
      expect(response.statusCode).toBe(400);
    });

    it('requires write scope to change the appearance', async () => {
      const response = await server.put(
        '/settings/widget',
        { theme: 'dark' },
        auth(readToken),
      );
      expect(response.statusCode).toBe(403);
    });

    it('serves the appearance in the customer token response', async () => {
      // The hosted Chat page has no snippet to bake it into, so the server is
      // its only source; the token mint carries it (FR-MOD-11.7).
      await server.put('/settings/widget', { primary_color: '#0a7f3f', theme: 'dark' }, auth(adminToken));

      const minted = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId, host_origin: `https://${fx.a.trustedDomain}` },
        { origin: 'https://widget.nexa.example' },
      );
      expect(minted.statusCode).toBe(200);
      expect((minted.json() as { widget: { primary_color: string; theme: string } }).widget).toMatchObject({
        primary_color: '#0a7f3f',
        theme: 'dark',
      });
    });

    it("never reads or writes another tenant's appearance", async () => {
      await owner.widgetSettings.create({
        data: { licenseId: fx.b.licenseId, primaryColor: '#abcdef', updatedAt: new Date() },
      });

      // Their row must not leak into our read…
      const read = await server.get('/settings/widget', auth(readToken));
      expect((read.json() as { primary_color: string }).primary_color).toBe('#2f6bff');

      // …and our write must not reach it.
      const written = await server.put('/settings/widget', { primary_color: '#111111' }, auth(adminToken));
      expect(written.statusCode).toBe(200);

      const theirs = await owner.widgetSettings.findUnique({
        where: { licenseId: fx.b.licenseId },
      });
      expect(theirs?.primaryColor).toBe('#abcdef');
    });
  });
});
