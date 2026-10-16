/**
 * Possible matches and agent-confirmed links between customer records
 * (SiyahTuş analysis ID-03 · owner decision K4 · tm 287.4).
 *
 * A visitor from another device is a new customer; what they typed into the
 * pre-chat form only surfaces the other record to agents, unverified, and only
 * a team lead or above (admin and above until RL-01) links the two. Pinned
 * here, against the real server and database:
 *
 *   - **The matches**: same folded username or same e-mail, this organization
 *     only, never the record itself, most recently active first, at most ten;
 *     blank fields match nobody; the licence's switch turns the list off.
 *   - **Linking**: 201 and an audit entry for a new link, 200 and nothing
 *     written for one that holds, symmetric from either record, undone with a
 *     204 and its own entry, the row kept with who undid it.
 *   - **Who may**: every agent reads; linking needs `customers:rw` and the
 *     admin rank — an agent-role holder with the scope is refused.
 *   - **Tenant isolation**: another organization's customer is a 404 on every
 *     door, whichever of the two ids it is, and nothing is written.
 *   - **The AI never sees a link**: a linked record's conversation does not
 *     reach the model answering the other record's visitor.
 */
import { PrismaClient } from '@prisma/client';
import { POSSIBLE_MATCH_LIMIT } from '@siyahtus/types';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { AI_QUESTION, customerAsks, seedAiWorkspace } from '../helpers/ai-workspace.js';
import { FakeLlmProvider } from '../helpers/fake-llm-provider.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface MatchSummary {
  id: string;
  name: string | null;
  username: string | null;
  email: string | null;
  last_activity_at: string | null;
}

interface PossibleMatches {
  enabled: boolean;
  items: Array<{ customer: MatchSummary; matched_on: string[]; linked: boolean }>;
}

interface IdentityLink {
  customer_id: string;
  linked_customer: MatchSummary;
  linked_at: string;
  linked_by: string;
}

describe('customer identity — possible matches and links (ID-03 · K4)', () => {
  let server: TestServer;
  let owner: PrismaClient;
  let fx: Fixtures;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /** The workspace owner's credential — the rank and scope that may link. */
  function ownerToken(tenant: TenantFixture, scopes = ['customers:rw']): Promise<string> {
    return grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.ownerAccountId,
      scopes,
    });
  }

  /** The seeded Agent-role member's credential, with whatever scopes a test asks for. */
  function agentToken(tenant: TenantFixture, scopes: string[]): Promise<string> {
    return grantToken(owner, {
      licenseId: tenant.licenseId,
      organizationId: tenant.organizationId,
      ownerId: tenant.agentAccountId,
      scopes,
    });
  }

  let minutesAgo = 0;
  /** A customer of `tenant`; each one active a minute before the previous one. */
  async function customer(
    tenant: TenantFixture,
    data: { name: string; username?: string | null; email?: string | null },
  ): Promise<string> {
    minutesAgo += 1;
    const created = await owner.customer.create({
      data: {
        organizationId: tenant.organizationId,
        name: data.name,
        username: data.username ?? null,
        email: data.email ?? null,
        lastActivityAt: new Date(Date.now() - minutesAgo * 60_000),
      },
      select: { id: true },
    });
    return created.id;
  }

  async function matches(customerId: string, token: string): Promise<PossibleMatches> {
    const response = await server.get(`/customers/${customerId}/possible-matches`, auth(token));
    expect(response.statusCode).toBe(200);
    return response.json() as PossibleMatches;
  }

  async function links(customerId: string, token: string): Promise<IdentityLink[]> {
    const response = await server.get(`/customers/${customerId}/links`, auth(token));
    expect(response.statusCode).toBe(200);
    return (response.json() as { items: IdentityLink[] }).items;
  }

  function link(customerId: string, otherId: string, token: string) {
    return server.post(`/customers/${customerId}/links`, { customer_id: otherId }, auth(token));
  }

  function unlink(customerId: string, otherId: string, token: string) {
    return server.del(`/customers/${customerId}/links/${otherId}`, auth(token));
  }

  function auditEntries(tenant: TenantFixture, action: string) {
    return owner.auditLogEntry.findMany({
      where: { licenseId: tenant.licenseId, action },
      orderBy: { createdAt: 'asc' },
    });
  }

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
    minutesAgo = 0;
  });

  // ==========================================================================
  // Possible matches
  // ==========================================================================

  describe('possible matches', () => {
    it('lists the records with the same folded username or e-mail, unverified, most recent first (NFR-S4)', async () => {
      const mira = await customer(fx.a, {
        name: 'Mira',
        username: ' MiraH_92 ',
        email: 'mira@example.test',
      });
      const byUsername = await customer(fx.a, { name: 'Phone Mira', username: 'mirah_92' });
      const byEmail = await customer(fx.a, { name: 'Laptop Mira', email: 'MIRA@example.test' });
      const byBoth = await customer(fx.a, {
        name: 'Tablet Mira',
        username: 'MIRAH_92',
        email: 'mira@example.test',
      });
      await customer(fx.a, { name: 'Someone else', username: 'mira_h', email: 'mh@example.test' });
      // Another organization's visitor who typed the very same handle and address.
      await customer(fx.b, { name: 'Elsewhere', username: 'mirah_92', email: 'mira@example.test' });

      const list = await matches(mira, await agentToken(fx.a, ['customers:ro']));

      expect(list.enabled).toBe(true);
      expect(list.items).toEqual([
        {
          customer: {
            id: byUsername,
            name: 'Phone Mira',
            username: 'mirah_92',
            email: null,
            last_activity_at: expect.any(String),
          },
          matched_on: ['username'],
          linked: false,
        },
        {
          customer: expect.objectContaining({ id: byEmail, email: 'MIRA@example.test' }),
          matched_on: ['email'],
          linked: false,
        },
        {
          customer: expect.objectContaining({ id: byBoth }),
          matched_on: ['username', 'email'],
          linked: false,
        },
      ]);
    });

    it(`shows at most ${POSSIBLE_MATCH_LIMIT}, the most recently active`, async () => {
      const target = await customer(fx.a, { name: 'Target', username: 'popular' });
      const others: string[] = [];
      for (let i = 0; i < POSSIBLE_MATCH_LIMIT + 2; i += 1) {
        others.push(await customer(fx.a, { name: `Popular ${i}`, username: 'Popular' }));
      }

      const list = await matches(target, await ownerToken(fx.a, ['customers:ro']));

      expect(list.items.map((item) => item.customer.id)).toEqual(
        others.slice(0, POSSIBLE_MATCH_LIMIT),
      );
    });

    it('matches nobody on a blank username or a record with neither field', async () => {
      const blank = await customer(fx.a, { name: 'Blank', username: '   ', email: null });
      await customer(fx.a, { name: 'Also blank', username: '  ' });
      const anonymous = await customer(fx.a, { name: 'Anonymous' });
      await customer(fx.a, { name: 'Anonymous too' });
      const token = await ownerToken(fx.a, ['customers:ro']);

      expect(await matches(blank, token)).toEqual({ enabled: true, items: [] });
      expect(await matches(anonymous, token)).toEqual({ enabled: true, items: [] });
    });

    it('is empty and says so when the licence turned possible matches off', async () => {
      const mira = await customer(fx.a, { name: 'Mira', username: 'mirah_92' });
      await customer(fx.a, { name: 'Phone Mira', username: 'mirah_92' });
      const switched = await server.patch(
        '/settings/member-recognition',
        { possible_matches_enabled: false },
        auth(await ownerToken(fx.a, ['access_rules:rw'])),
      );
      expect(switched.statusCode).toBe(200);

      expect(await matches(mira, await ownerToken(fx.a, ['customers:ro']))).toEqual({
        enabled: false,
        items: [],
      });
    });

    it('marks a match an agent has already linked', async () => {
      const mira = await customer(fx.a, { name: 'Mira', username: 'mirah_92' });
      const phone = await customer(fx.a, { name: 'Phone Mira', username: 'mirah_92' });
      const laptop = await customer(fx.a, { name: 'Laptop Mira', username: 'mirah_92' });
      expect((await link(phone, mira, await ownerToken(fx.a))).statusCode).toBe(201);

      const list = await matches(mira, await ownerToken(fx.a, ['customers:ro']));
      expect(list.items.map((item) => [item.customer.id, item.linked])).toEqual([
        [phone, true],
        [laptop, false],
      ]);
    });
  });

  // ==========================================================================
  // Linking and unlinking
  // ==========================================================================

  describe('linking', () => {
    it('links two records for the history view, from either side, audited by id only', async () => {
      const mira = await customer(fx.a, { name: 'Mira', username: 'mirah_92' });
      const phone = await customer(fx.a, {
        name: 'Phone Mira',
        username: 'mirah_92',
        email: 'mira@example.test',
      });

      const response = await link(mira, phone, await ownerToken(fx.a));

      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({
        customer_id: mira,
        linked_customer: {
          id: phone,
          name: 'Phone Mira',
          username: 'mirah_92',
          email: 'mira@example.test',
          last_activity_at: expect.any(String),
        },
        linked_at: expect.any(String),
        linked_by: fx.a.ownerAccountId,
      });

      const reader = await agentToken(fx.a, ['customers:ro']);
      expect((await links(mira, reader)).map((row) => row.linked_customer.id)).toEqual([phone]);
      const fromTheOtherSide = await links(phone, reader);
      expect(fromTheOtherSide).toEqual([
        expect.objectContaining({
          customer_id: phone,
          linked_customer: expect.objectContaining({ id: mira, name: 'Mira' }),
          linked_by: fx.a.ownerAccountId,
        }),
      ]);

      const [entry, ...more] = await auditEntries(fx.a, 'customer.identity_linked');
      expect(more).toEqual([]);
      expect(entry).toMatchObject({
        target: `customer:${mira}`,
        actorId: fx.a.ownerAccountId,
        metadata: { linked_customer_id: phone },
      });
      // What the visitor typed is what the agent judged by — it stays out.
      expect(JSON.stringify(entry?.metadata)).not.toMatch(/mirah_92|mira@example/);
    });

    it('answers 200 and writes nothing for a link that already holds, named either way round', async () => {
      const mira = await customer(fx.a, { name: 'Mira' });
      const phone = await customer(fx.a, { name: 'Phone Mira' });
      const token = await ownerToken(fx.a);
      expect((await link(mira, phone, token)).statusCode).toBe(201);

      const again = await link(mira, phone, token);
      const reversed = await link(phone, mira, token);

      expect(again.statusCode).toBe(200);
      expect((again.json() as IdentityLink).linked_customer.id).toBe(phone);
      expect(reversed.statusCode).toBe(200);
      expect((reversed.json() as IdentityLink).customer_id).toBe(phone);
      expect(await auditEntries(fx.a, 'customer.identity_linked')).toHaveLength(1);
      expect(await owner.customerIdentityLink.count()).toBe(1);
    });

    it('undoes a link, keeping who linked and who undid it; a second undo is a 404', async () => {
      const mira = await customer(fx.a, { name: 'Mira' });
      const phone = await customer(fx.a, { name: 'Phone Mira' });
      const token = await ownerToken(fx.a);
      await link(mira, phone, token);

      // Either record may be named first.
      const undone = await unlink(phone, mira, token);

      expect(undone.statusCode).toBe(204);
      expect(await links(mira, token)).toEqual([]);
      expect(await links(phone, token)).toEqual([]);
      expect(
        await owner.customerIdentityLink.findFirstOrThrow({
          select: { linkedBy: true, unlinkedBy: true, unlinkedAt: true },
        }),
      ).toEqual({
        linkedBy: fx.a.ownerAccountId,
        unlinkedBy: fx.a.ownerAccountId,
        unlinkedAt: expect.any(Date),
      });
      const [entry] = await auditEntries(fx.a, 'customer.identity_unlinked');
      expect(entry).toMatchObject({
        target: `customer:${phone}`,
        metadata: { linked_customer_id: mira },
      });

      expect((await unlink(mira, phone, token)).statusCode).toBe(404);
      expect(await auditEntries(fx.a, 'customer.identity_unlinked')).toHaveLength(1);
    });

    it('links an undone pair again as a new decision, with its own author and entry', async () => {
      const mira = await customer(fx.a, { name: 'Mira' });
      const phone = await customer(fx.a, { name: 'Phone Mira' });
      await link(mira, phone, await ownerToken(fx.a));
      await unlink(mira, phone, await ownerToken(fx.a));

      const admin = await owner.account.create({
        data: { email: `admin-relink-${Date.now()}@example.test`, name: 'Admin' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: fx.a.licenseId, agentId: admin.id, role: 'admin' },
      });
      const adminToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: admin.id,
        scopes: ['customers:rw'],
      });

      const relinked = await link(phone, mira, adminToken);

      expect(relinked.statusCode).toBe(201);
      expect((relinked.json() as IdentityLink).linked_by).toBe(admin.id);
      expect(await auditEntries(fx.a, 'customer.identity_linked')).toHaveLength(2);
      expect(
        await owner.customerIdentityLink.findFirstOrThrow({
          select: { linkedBy: true, unlinkedBy: true, unlinkedAt: true },
        }),
      ).toEqual({ linkedBy: admin.id, unlinkedBy: null, unlinkedAt: null });
    });

    it('refuses a record linked to itself — in any letter case — and a malformed id', async () => {
      const mira = await customer(fx.a, { name: 'Mira' });
      const token = await ownerToken(fx.a);

      expect((await link(mira, mira, token)).statusCode).toBe(400);
      expect((await link(mira, mira.toUpperCase(), token)).statusCode).toBe(400);
      expect((await link(mira, 'not-a-uuid', token)).statusCode).toBe(400);
      expect((await server.post(`/customers/${mira}/links`, {}, auth(token))).statusCode).toBe(400);
      expect((await unlink(mira, 'not-a-uuid', token)).statusCode).toBe(400);
      expect(await owner.customerIdentityLink.count()).toBe(0);
    });
  });

  // ==========================================================================
  // Who may
  // ==========================================================================

  describe('permissions', () => {
    it('lets every agent read, and only the admin rank with customers:rw link or undo (NFR-S3)', async () => {
      const mira = await customer(fx.a, { name: 'Mira', username: 'mirah_92' });
      const phone = await customer(fx.a, { name: 'Phone Mira', username: 'mirah_92' });
      const reader = await agentToken(fx.a, ['customers:ro']);
      // The Agent role holding the write scope — a broad PAT — is still refused:
      // linking is a team lead's call (ID-03-S4), admin and above until RL-01.
      const agentWriter = await agentToken(fx.a, ['customers:rw']);
      const ownerReader = await ownerToken(fx.a, ['customers:ro']);

      expect((await matches(mira, reader)).items).toHaveLength(1);
      expect(await links(mira, reader)).toEqual([]);
      for (const token of [reader, agentWriter, ownerReader]) {
        expect((await link(mira, phone, token)).statusCode).toBe(403);
      }
      expect(await owner.customerIdentityLink.count()).toBe(0);

      expect((await link(mira, phone, await ownerToken(fx.a))).statusCode).toBe(201);
      for (const token of [reader, agentWriter, ownerReader]) {
        expect((await unlink(mira, phone, token)).statusCode).toBe(403);
      }
      expect(await links(mira, reader)).toHaveLength(1);
    });

    it('needs customers:ro to read at all, and refuses a widget customer token outright', async () => {
      const mira = await customer(fx.a, { name: 'Mira' });
      const unrelated = await ownerToken(fx.a, ['tickets--all:rw']);
      for (const path of [`/customers/${mira}/possible-matches`, `/customers/${mira}/links`]) {
        expect((await server.get(path, auth(unrelated))).statusCode).toBe(403);
      }

      const minted = await server.post(
        '/customer/token',
        { organization_id: fx.a.organizationId },
        { origin: `https://${fx.a.trustedDomain}` },
      );
      const { token: customerToken } = minted.json() as { token: string };
      // Agent doors are not a customer's at all; which refusal answers is the
      // auth layer's business (`member-token.test.ts` reads it the same way).
      expect([401, 403, 404]).toContain(
        (await server.get(`/customers/${mira}/possible-matches`, auth(customerToken))).statusCode,
      );
      expect([401, 403, 404]).toContain(
        (await link(mira, fx.a.customerId, customerToken)).statusCode,
      );
      expect(await owner.customerIdentityLink.count()).toBe(0);
    });
  });

  // ==========================================================================
  // Tenant isolation
  // ==========================================================================

  describe('tenant isolation', () => {
    it("answers 404 for another organization's customer on every door, and writes nothing (NFR-S4 · NFR-S5)", async () => {
      const mine = await customer(fx.a, { name: 'Mira', username: 'mirah_92' });
      const theirs = await customer(fx.b, { name: 'Theirs', username: 'mirah_92' });
      const token = await ownerToken(fx.a);

      expect(
        (await server.get(`/customers/${theirs}/possible-matches`, auth(token))).statusCode,
      ).toBe(404);
      expect((await server.get(`/customers/${theirs}/links`, auth(token))).statusCode).toBe(404);
      // Whichever of the two ids is foreign, the same 404: the answer never
      // says which one exists.
      expect((await link(mine, theirs, token)).statusCode).toBe(404);
      expect((await link(theirs, mine, token)).statusCode).toBe(404);
      expect((await unlink(mine, theirs, token)).statusCode).toBe(404);
      expect(await owner.customerIdentityLink.count()).toBe(0);
      expect(await auditEntries(fx.a, 'customer.identity_linked')).toEqual([]);
      // And the foreign record is no possible match either.
      expect((await matches(mine, token)).items).toEqual([]);
    });

    it("never shows one organization the other's links", async () => {
      const a1 = await customer(fx.a, { name: 'A one' });
      const a2 = await customer(fx.a, { name: 'A two' });
      const b1 = await customer(fx.b, { name: 'B one' });
      const b2 = await customer(fx.b, { name: 'B two' });
      await link(a1, a2, await ownerToken(fx.a));
      await link(b1, b2, await ownerToken(fx.b));

      expect(
        (await links(a1, await ownerToken(fx.a))).map((row) => row.linked_customer.id),
      ).toEqual([a2]);
      expect(
        (await server.get(`/customers/${b1}/links`, auth(await ownerToken(fx.a)))).statusCode,
      ).toBe(404);
    });
  });

  // ==========================================================================
  // Measured under row level security
  // ==========================================================================

  it('serves the username half of the lookup out of its index as the app role (EXPLAIN ANALYZE · NFR-P2)', async () => {
    for (let i = 0; i < 5; i += 1) {
      await customer(fx.a, { name: `Probe ${i}`, username: i === 0 ? 'mirah_92' : `player_${i}` });
    }
    const target = await customer(fx.a, { name: 'Target', username: 'MiraH_92' });

    // The statement `CustomerIdentityService#possibleMatches` issues for the
    // username half, bound the same way. As `siyahtus_app` inside the tenant
    // context, because that is where it can go wrong (a non-leakproof qual
    // stays out of the index condition). A private client, so the
    // `enable_seqscan = off` pin cannot reach another test through Prisma's
    // plan cache.
    const appRole = new PrismaClient({ datasourceUrl: process.env['DATABASE_APP_URL'] });
    try {
      const plan = await withTenant(
        appRole,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
          const [row] = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
            `EXPLAIN (ANALYZE, FORMAT JSON)
             SELECT id FROM customers
             WHERE organization_id = $1::uuid AND username_normalized = $2::text AND id <> $3::uuid`,
            fx.a.organizationId,
            'mirah_92',
            target,
          );
          const raw = row?.['QUERY PLAN'];
          const parsed = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Array<
            Record<string, unknown>
          >;
          return parsed[0] ?? {};
        },
      );
      const text = JSON.stringify(plan['Plan'] ?? {});
      expect(text).toContain('customers_organization_id_username_normalized_idx');
      expect(text).toMatch(/"Index Cond":"[^"]*username_normalized/);
      expect(plan['Execution Time'] as number).toBeLessThan(150);
    } finally {
      await appRole.$disconnect();
    }
  });
});

// ============================================================================
// The AI never reads a link
// ============================================================================

describe('a linked record stays out of the AI (ID-03 · K4 · K5)', () => {
  const fake = new FakeLlmProvider();
  let server: TestServer;
  let owner: PrismaClient;

  beforeAll(async () => {
    owner = ownerClient();
    server = await startTestServer({}, { llm: fake });
  });

  afterAll(async () => {
    await server.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await seedFixtures(owner);
    await clearRateLimits(server.app);
    fake.reset();
  });

  it("does not give the model a linked record's conversation", async () => {
    const ws = await seedAiWorkspace(owner);
    const secret = 'IBAN TR33 0006 1005 1978 6457 8413 26';

    // The member on their laptop, earlier: their conversation holds something
    // only they should ever be answered with.
    const laptop = await customerAsks(
      owner,
      server,
      ws,
      `About delivery to my account ${secret}, please.`,
    );
    const laptopCustomer = await owner.chat.findUniqueOrThrow({
      where: { id: laptop.chatId },
      select: { customerId: true },
    });

    // Someone on a phone the agent then links to that member — rightly or not.
    const phone = await customerAsks(owner, server, ws, 'Hello?');
    const phoneCustomer = await owner.chat.findUniqueOrThrow({
      where: { id: phone.chatId },
      select: { customerId: true },
    });
    const adminToken = await grantToken(owner, {
      licenseId: ws.licenseId,
      organizationId: ws.organizationId,
      ownerId: ws.ownerId,
      scopes: ['customers:rw'],
    });
    const linked = await server.post(
      `/customers/${phoneCustomer.customerId}/links`,
      { customer_id: laptopCustomer.customerId },
      { authorization: `Bearer ${adminToken}` },
    );
    expect(linked.statusCode).toBe(201);
    fake.reset();

    // The phone's visitor asks the AI.
    const sent = await server.post(
      '/customer/chat/events',
      { text: AI_QUESTION },
      { authorization: `Bearer ${phone.customerToken}` },
    );
    expect(sent.statusCode).toBe(201);

    expect(fake.calls.length).toBeGreaterThan(0);
    const prompt = JSON.stringify(fake.calls);
    expect(prompt).toContain(AI_QUESTION);
    expect(prompt).not.toContain(secret);
    expect(prompt).not.toContain('TR33');
  });
});
