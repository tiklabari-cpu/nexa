/**
 * The root panel's workspace read surface and the support lookup (tm 389.9 ·
 * FR-ADMIN-08/10 · docs/platform-admin/design.md §C workspaces/support).
 *
 * Three workspaces — A and B from the shared fixtures, C seeded here — each with
 * its own members, brand, meters, invoice, audit entry, note, impersonation and
 * conversation. The platform connection bypasses row level security, so the
 * cross-visibility block is the proof that every query names its licence: A's
 * tabs must carry none of B's rows.
 *
 * FR-ADMIN codes are not Ek A catalogue IDs, so no test title carries one as a
 * requirement tag (CONVENTIONS §7.3).
 */
import type { PrismaClient } from '@prisma/client';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId, type PlatformRole } from '@siyahtus/types';
import { PLATFORM_PREFIX } from '../../src/platform-server.js';
import { currentPeriod } from '../../src/services/billing/metering.js';
import { LOOKUP_FLOOR_MS } from '../../src/services/platform/support-lookup.js';
import {
  grantToken,
  ownerClient,
  platformClient,
  seedFixtures,
  type Fixtures,
} from '../helpers/fixtures.js';
import { bearer, createOperator, openActiveSession, TestClock } from '../helpers/platform-admin.js';
import { buildPlatformTestServer, type PlatformTestServer } from '../helpers/platform-server.js';
import { startTestServer, type TestServer } from '../helpers/server.js';

const DAY = 86_400_000;
const owner = ownerClient();
afterAll(async () => {
  await owner.$disconnect();
});

const dayKey = (at: Date) => at.toISOString().slice(0, 10).replaceAll('-', '');
const reason = { reason: 'Customer called about the invoice' };

interface Seeded {
  fx: Fixtures;
  c: { licenseId: bigint; organizationId: string };
  a: { chatId: string; threadId: string; ticketId: string };
  b: { chatId: string; threadId: string; ticketId: string; extraEmail: string };
}

describe('the platform workspace surface (tm 389.9)', () => {
  let platform: PlatformTestServer;
  let tenant: TestServer;
  let db: PrismaClient;
  let clock: TestClock;
  let seeded: Seeded;
  const tokens = new Map<PlatformRole, string>();

  const get = (path: string, role: PlatformRole = 'superadmin'): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method: 'GET',
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(tokens.get(role)!),
    });
  const post = (
    path: string,
    body: unknown,
    role: PlatformRole = 'superadmin',
  ): Promise<LightMyRequestResponse> =>
    platform.app.inject({
      method: 'POST',
      url: `${PLATFORM_PREFIX}${path}`,
      headers: bearer(tokens.get(role)!),
      payload: body as object,
    });
  const ok = async (response: Promise<LightMyRequestResponse>) => {
    const settled = await response;
    expect(settled.statusCode, settled.body).toBe(200);
    return settled.json();
  };

  async function conversation(t: { licenseId: bigint; customerId: string }) {
    const chatId = generateShortId();
    const threadId = generateShortId();
    const ticketId = generateShortId();
    await owner.chat.create({
      data: { id: chatId, licenseId: t.licenseId, customerId: t.customerId, active: true },
    });
    await owner.thread.create({
      data: { id: threadId, chatId, licenseId: t.licenseId, active: true },
    });
    await owner.ticket.create({
      data: {
        id: ticketId,
        licenseId: t.licenseId,
        customerId: t.customerId,
        subject: `Secret subject ${ticketId}`,
      },
    });
    return { chatId, threadId, ticketId };
  }

  async function seed(): Promise<Seeded> {
    const fx = await seedFixtures(owner);
    const now = new Date(clock.now);
    const period = currentPeriod(now);

    // C: a paying US workspace on enterprise, created last.
    const cOrg = await owner.organization.create({ data: { name: 'Gamma Casino', region: 'us' } });
    const cLicense = await owner.license.create({
      data: { organizationId: cOrg.id, status: 'active', trialEndsAt: null },
    });
    await owner.subscription.create({
      data: { licenseId: cLicense.id, plan: 'enterprise', status: 'active', seats: 5 },
    });
    const cOwner = await owner.account.create({
      data: { email: 'founder-c@gamma.test', name: 'Founder C' },
    });
    await owner.agentMembership.create({
      data: { licenseId: cLicense.id, agentId: cOwner.id, role: 'owner' },
    });

    // A ends its trial in 3 days, B in 10; A was created first.
    await owner.license.update({
      where: { id: fx.a.licenseId },
      data: {
        trialEndsAt: new Date(clock.now + 3 * DAY),
        createdAt: new Date(clock.now - 3 * DAY),
      },
    });
    await owner.license.update({
      where: { id: fx.b.licenseId },
      data: {
        trialEndsAt: new Date(clock.now + 10 * DAY),
        createdAt: new Date(clock.now - 2 * DAY),
      },
    });
    await owner.license.update({
      where: { id: cLicense.id },
      data: { createdAt: new Date(clock.now - DAY) },
    });

    // B has a third member (a team lead), so its seat floor differs from A's.
    const extra = await owner.account.create({
      data: { email: 'lead-b@example.test', name: 'Lead B' },
    });
    await owner.agentMembership.create({
      data: { licenseId: fx.b.licenseId, agentId: extra.id, role: 'team_lead' },
    });

    for (const [t, label, used, tokensUsed, total] of [
      [fx.a, 'Alpha', 7n, 1234n, 111],
      [fx.b, 'Beta', 99n, 9999n, 222],
    ] as const) {
      await owner.brand.create({
        data: {
          licenseId: t.licenseId,
          name: `${label} brand`,
          slug: label.toLowerCase(),
          isDefault: true,
        },
      });
      await owner.usageRecord.create({
        data: {
          licenseId: t.licenseId,
          metric: 'ai_resolutions',
          period,
          quantity: used,
          included: 200n,
        },
      });
      await owner.aiDailyUsage.create({
        data: { licenseId: t.licenseId, day: dayKey(now), meter: 'llm', used: tokensUsed },
      });
      await owner.invoice.create({
        data: {
          licenseId: t.licenseId,
          number: 'SIYAHTUS-202001',
          period: '202001',
          periodStart: new Date('2020-01-01T00:00:00Z'),
          periodEnd: new Date('2020-02-01T00:00:00Z'),
          issuedAt: new Date('2020-01-31T00:00:00Z'),
          origin: 'issued',
          status: 'paid',
          currency: 'usd',
          subtotalCents: total,
          totalCents: total,
          lineItems: {
            create: [
              {
                licenseId: t.licenseId,
                position: 0,
                description: `${label} seats`,
                amountCents: total,
              },
            ],
          },
        },
      });
      await owner.auditLogEntry.create({
        data: {
          licenseId: t.licenseId,
          actorId: t.ownerAccountId,
          actorType: 'agent',
          action: 'billing.subscription_updated',
          target: `marker:${label}`,
          metadata: {},
        },
      });
      await owner.aiAgent.create({
        data: { licenseId: t.licenseId, name: `${label} bot`, active: label === 'Alpha' },
      });
    }

    // Customers' emails: one only A knows, one both know.
    await owner.customer.update({
      where: { id: fx.a.customerId },
      data: { email: 'player-a@example.test', name: 'Player Alpha Name' },
    });
    await owner.customer.create({
      data: { organizationId: fx.a.organizationId, email: 'shared@example.test' },
    });
    await owner.customer.create({
      data: { organizationId: fx.b.organizationId, email: 'Shared@Example.test' },
    });

    const a = await conversation(fx.a);
    const b = await conversation(fx.b);
    return {
      fx,
      c: { licenseId: cLicense.id, organizationId: cOrg.id },
      a,
      b: { ...b, extraEmail: extra.email },
    };
  }

  beforeAll(async () => {
    db = platformClient();
    clock = new TestClock(Date.now());
    platform = await buildPlatformTestServer({}, { now: clock.read });
    tenant = await startTestServer();
  });

  afterAll(async () => {
    await platform?.close();
    await tenant?.close();
    await db?.$disconnect();
  });

  beforeEach(async () => {
    clock.now = Date.now();
    seeded = await seed();
    tokens.clear();
    for (const role of ['superadmin', 'support', 'billing', 'readonly'] as const) {
      const operator = await createOperator(db, { role, clock });
      tokens.set(role, await openActiveSession(db, operator, clock));
    }
  });

  describe('the list', () => {
    it('lists every workspace but sandboxes, newest first, with its plan, Kurucu and headcount', async () => {
      const { fx, c } = seeded;
      const sandboxOrg = await owner.organization.create({ data: { name: 'Org A sandbox' } });
      await owner.license.create({
        data: { organizationId: sandboxOrg.id, sandboxOfLicenseId: fx.a.licenseId },
      });

      const page = await ok(get('/workspaces'));
      expect(page.next_cursor).toBeNull();
      expect(page.data.map((row: { license_id: string }) => row.license_id)).toEqual([
        c.licenseId.toString(),
        fx.b.licenseId.toString(),
        fx.a.licenseId.toString(),
      ]);
      expect(page.data[0]).toEqual({
        license_id: c.licenseId.toString(),
        organization_name: 'Gamma Casino',
        region: 'us',
        status: 'active',
        plan: 'enterprise',
        trial_ends_at: null,
        created_at: expect.any(String),
        owner_email: 'founder-c@gamma.test',
        member_count: 1,
      });
      expect(page.data[1]).toMatchObject({
        plan: 'growth',
        owner_email: fx.b.ownerEmail,
        member_count: 3,
      });
    });

    it('filters by status, plan, region, trial end and free text', async () => {
      const { fx, c } = seeded;
      const ids = async (query: string) =>
        (await ok(get(`/workspaces?${query}`))).data.map(
          (row: { license_id: string }) => row.license_id,
        );

      expect(await ids('status=active')).toEqual([c.licenseId.toString()]);
      expect(await ids('status=suspended')).toEqual([]);
      expect(await ids('plan=growth')).toEqual([
        fx.b.licenseId.toString(),
        fx.a.licenseId.toString(),
      ]);
      expect(await ids('plan=enterprise')).toEqual([c.licenseId.toString()]);
      expect(await ids('region=us')).toEqual([c.licenseId.toString()]);
      const fiveDays = new Date(clock.now + 5 * DAY).toISOString();
      expect(await ids(`trial_ends_before=${encodeURIComponent(fiveDays)}`)).toEqual([
        fx.a.licenseId.toString(),
      ]);
      // Organization name, anywhere, any case; the Kurucu's email; the licence number.
      expect(await ids('q=gamma')).toEqual([c.licenseId.toString()]);
      expect(await ids(`q=${encodeURIComponent('OWNER-B@')}`)).toEqual([fx.b.licenseId.toString()]);
      expect(await ids(`q=${fx.a.licenseId}`)).toEqual([fx.a.licenseId.toString()]);
      // A wildcard is a character, not a pattern.
      expect(await ids('q=%25')).toEqual([]);
      expect((await get('/workspaces?status=gone')).statusCode).toBe(400);
      expect((await get('/workspaces?sort=size')).statusCode).toBe(400);
    });

    it('pages by keyset in every order: a second page never repeats the first, and the cursor belongs to its list', async () => {
      const { fx, c } = seeded;
      const walk = async (sort: string) => {
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const page: { data: Array<{ license_id: string }>; next_cursor: string | null } =
            await ok(get(`/workspaces?sort=${sort}&limit=1${cursor ? `&cursor=${cursor}` : ''}`));
          expect(page.data).toHaveLength(1);
          seen.push(page.data[0]!.license_id);
          cursor = page.next_cursor;
        } while (cursor);
        return seen;
      };
      const [a, b, cc] = [fx.a.licenseId, fx.b.licenseId, c.licenseId].map(String);
      expect(await walk('created_desc')).toEqual([cc, b, a]);
      expect(await walk('created_asc')).toEqual([a, b, cc]);
      expect(await walk('name_asc')).toEqual([cc, a, b]);
      // C has no trial end, so it sorts last.
      expect(await walk('trial_ends_asc')).toEqual([a, b, cc]);

      const first = await ok(get('/workspaces?limit=1'));
      const reused = await get(`/workspaces?limit=1&status=trialing&cursor=${first.next_cursor}`);
      expect(reused.statusCode).toBe(400);
      expect((await get('/workspaces?cursor=not-a-cursor')).statusCode).toBe(400);
    });
  });

  describe('the detail', () => {
    it('describes the organization, licence, Kurucu, counts and status history — counts of A only', async () => {
      const { fx } = seeded;
      const superadmin = await owner.platformAdmin.findFirstOrThrow({
        where: { role: 'superadmin' },
      });
      await platform.app.platformAuditLog.record({
        adminId: superadmin.id,
        action: 'workspace.trial_extended',
        targetType: 'workspace',
        targetId: fx.a.licenseId.toString(),
        licenseId: fx.a.licenseId,
        reason: 'Asked nicely',
      });
      const { workspace } = await ok(get(`/workspaces/${fx.a.licenseId}`));
      expect(workspace.organization).toMatchObject({
        id: fx.a.organizationId,
        name: 'Org A',
        region: 'eu',
      });
      expect(workspace.license).toMatchObject({
        status: 'trialing',
        plan: 'growth',
        sandbox_of_license_id: null,
        suspended_at: null,
      });
      expect(workspace.owner).toEqual({
        account_id: fx.a.ownerAccountId,
        name: 'Owner a',
        email: fx.a.ownerEmail,
        email_verified_at: expect.any(String),
      });
      // A: owner + agent, one brand, two customers, one conversation, one ticket, one AI agent.
      expect(workspace.counts).toEqual({
        members: 2,
        brands: 1,
        customers: 2,
        chats: 1,
        tickets: 1,
        ai_agents: 1,
      });
      expect(workspace.status_history.map((entry: { action: string }) => entry.action)).toEqual([
        'workspace.trial_extended',
        'created',
      ]);
      expect(workspace.status_history[0].reason).toBe('Asked nicely');
    });

    it('answers 404 for an unknown, a malformed and a UUID licence, on every tab', async () => {
      for (const id of ['999999999', 'abc', '00000000-0000-4000-8000-000000000000', '0']) {
        for (const tab of [
          '',
          '/members',
          '/brands',
          '/usage',
          '/subscription',
          '/invoices',
          '/sandbox',
          '/notes',
          '/impersonations',
          '/ai-summary',
          '/invoices/202001/download',
        ]) {
          const response = await get(`/workspaces/${id}${tab}`);
          expect(response.statusCode, `${id}${tab}`).toBe(404);
        }
      }
      expect(
        (await get(`/workspaces/${seeded.fx.a.licenseId}/invoices/209912/download`)).statusCode,
      ).toBe(404);
    });
  });

  describe('cross-visibility: A carries none of B', () => {
    it('members, brands, usage, subscription, invoices, audit, notes, impersonations and AI counts are A’s alone', async () => {
      const { fx, b } = seeded;
      const A = `/workspaces/${fx.a.licenseId}`;
      const superadmin = await owner.platformAdmin.findFirstOrThrow({
        where: { role: 'superadmin' },
      });
      for (const t of [fx.a, fx.b]) {
        await owner.platformImpersonationSession.create({
          data: {
            adminId: superadmin.id,
            licenseId: t.licenseId,
            accountId: t.ownerAccountId,
            endsAt: new Date(clock.now + 3_600_000),
          },
        });
      }
      expect(
        (await post(`/workspaces/${fx.b.licenseId}/notes`, { body: 'About B only', ...reason }))
          .statusCode,
      ).toBe(201);

      const members = await ok(get(`${A}/members`));
      expect(members.data.map((m: { email: string }) => m.email)).toEqual([
        fx.a.ownerEmail,
        fx.a.agentEmail,
      ]);
      expect(members.data.map((m: { role: string }) => m.role)).toEqual(['owner', 'agent']);
      expect(JSON.stringify(members)).not.toContain(b.extraEmail);
      // B's team lead is listed with its role name, after the Kurucu.
      const bMembers = await ok(get(`/workspaces/${fx.b.licenseId}/members`));
      expect(bMembers.data.map((m: { role: string }) => m.role)).toEqual([
        'owner',
        'team_lead',
        'agent',
      ]);

      const brands = await ok(get(`${A}/brands`));
      expect(brands.data.map((row: { name: string }) => row.name)).toEqual(['Alpha brand']);

      const usage = await ok(get(`${A}/usage?days=7`));
      expect(usage.current.ai_resolutions.used).toBe(7);
      expect(usage.periods).toEqual([
        {
          period: currentPeriod(new Date(clock.now)),
          metric: 'ai_resolutions',
          quantity: 7,
          included: 200,
        },
      ]);
      expect(usage.ai_daily).toHaveLength(7);
      expect(usage.ai_daily.at(-1)).toEqual({
        date: new Date(clock.now).toISOString().slice(0, 10),
        llm: 1234,
        embedding: 0,
      });
      expect(JSON.stringify(usage)).not.toContain('9999');

      const subscription = await ok(get(`${A}/subscription`));
      expect(subscription.min_seats).toBe(2);
      expect(subscription.seats).toBe(2);

      const invoices = await ok(get(`${A}/invoices`));
      const closed = invoices.invoices.find((row: { period: string }) => row.period === '202001');
      expect(closed.total_cents).toBe(111);
      expect(JSON.stringify(invoices)).not.toMatch(/Beta seats|\b222\b/);
      // The open estimate counts A's two members, not everyone's six.
      expect(invoices.invoices[0].origin).toBe('estimate');

      const audit = await ok(get(`/audit/workspaces/${fx.a.licenseId}`));
      const targets = audit.items.map((item: { target: string | null }) => item.target);
      expect(targets).toContain('marker:Alpha');
      expect(targets).not.toContain('marker:Beta');

      const notes = await ok(get(`${A}/notes`));
      expect(notes.data).toEqual([]);

      const impersonations = await ok(get(`${A}/impersonations`));
      expect(impersonations.data.map((row: { account_id: string }) => row.account_id)).toEqual([
        fx.a.ownerAccountId,
      ]);
      expect(impersonations.data[0]).toMatchObject({
        admin_email: superadmin.email,
        mode: 'read_only',
        ended_at: null,
      });

      // The counts of one workspace's agents; the rest of the summary has its own suite
      // (`platform-ai-catalogs.test.ts`).
      expect((await ok(get(`${A}/ai-summary`))).ai_agents).toEqual({ total: 1, active: 1 });
      expect((await ok(get(`/workspaces/${fx.b.licenseId}/ai-summary`))).ai_agents).toEqual({
        total: 1,
        active: 0,
      });
    });

    it('serves the subscription, the invoices and the CSV exactly as the workspace itself reads them', async () => {
      const { fx } = seeded;
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.ownerAccountId,
        scopes: ['billing_manage'],
      });
      const auth = { authorization: `Bearer ${token}` };
      const A = `/workspaces/${fx.a.licenseId}`;
      // Past its trial and without a subscription row, A is billed for its headcount — the count
      // a connection without row level security must still take from A alone.
      await owner.license.update({
        where: { id: fx.a.licenseId },
        data: { status: 'active', trialEndsAt: null },
      });

      // The platform first: the tenant API meters its own call once it has answered, so read
      // the other way round the second view would count the first.
      const seen = await ok(get(`${A}/subscription`));
      const own = await tenant.get('/billing/subscription', auth);
      expect(own.statusCode, own.body).toBe(200);
      expect(seen).toEqual(own.json());

      const seenInvoices = await ok(get(`${A}/invoices`));
      const ownInvoices = await tenant.get('/billing/invoices', auth);
      expect(seenInvoices).toEqual(ownInvoices.json());
      expect(seen.min_seats).toBe(2);
      expect(seenInvoices.invoices[0].total_cents).toBeGreaterThan(0);
      expect(seenInvoices.invoices[0].total_cents).toBe(seen.estimated_total_cents);

      const ownCsv = await tenant.get('/billing/invoices/202001/download', auth);
      const csv = await get(`${A}/invoices/202001/download`);
      expect(csv.statusCode).toBe(200);
      expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(csv.headers['content-disposition']).toBe(ownCsv.headers['content-disposition']);
      expect(csv.body).toBe(ownCsv.body);
      expect(csv.body).toContain('Alpha seats');
    });

    it('reads the sandbox from both ends, and lists it under its parent only', async () => {
      const { fx } = seeded;
      const sandboxOrg = await owner.organization.create({ data: { name: 'Org A sandbox' } });
      const sandbox = await owner.license.create({
        data: { organizationId: sandboxOrg.id, sandboxOfLicenseId: fx.a.licenseId },
      });
      expect(await ok(get(`/workspaces/${fx.a.licenseId}/sandbox`))).toEqual({
        is_sandbox: false,
        sandbox_of_license_id: null,
        sandbox: {
          license_id: sandbox.id.toString(),
          region: 'eu',
          created_at: sandbox.createdAt.toISOString(),
          reset_at: null,
        },
      });
      expect(await ok(get(`/workspaces/${sandbox.id}/sandbox`))).toEqual({
        is_sandbox: true,
        sandbox_of_license_id: fx.a.licenseId.toString(),
        sandbox: null,
      });
      expect((await ok(get(`/workspaces/${fx.b.licenseId}/sandbox`))).sandbox).toBeNull();
      const detail = await ok(get(`/workspaces/${sandbox.id}`));
      expect(detail.workspace.license.sandbox_of_license_id).toBe(fx.a.licenseId.toString());
    });

    it('rejects a usage window outside 1–90 days', async () => {
      const A = `/workspaces/${seeded.fx.a.licenseId}/usage`;
      for (const days of ['0', '91', 'abc']) {
        expect((await get(`${A}?days=${days}`)).statusCode, days).toBe(400);
      }
      expect((await ok(get(A))).ai_daily).toHaveLength(30);
    });
  });

  describe('notes', () => {
    it('lets support write one — recorded on both trails without its text — and readonly or billing none', async () => {
      const { fx } = seeded;
      const A = `/workspaces/${fx.a.licenseId}/notes`;
      const created = await post(A, { body: 'Prefers email over phone.', ...reason }, 'support');
      expect(created.statusCode, created.body).toBe(201);
      const note = created.json();
      expect(note).toMatchObject({
        license_id: fx.a.licenseId.toString(),
        body: 'Prefers email over phone.',
        admin_email: expect.stringContaining('@'),
      });

      for (const role of ['readonly', 'billing'] as const) {
        const refused = await post(A, { body: 'Nope', ...reason }, role);
        expect(refused.statusCode, role).toBe(403);
        expect(refused.json().error.type).toBe('authorization');
      }
      expect((await post(A, { body: 'No reason given' }, 'support')).json().error.type).toBe(
        'platform_reason_required',
      );
      expect((await post(A, { body: '   ', ...reason }, 'support')).statusCode).toBe(400);

      const platformEntry = await owner.platformAuditLog.findFirstOrThrow({
        where: { action: 'workspace.note_added' },
      });
      expect(platformEntry).toMatchObject({
        licenseId: fx.a.licenseId,
        targetType: 'workspace',
        targetId: fx.a.licenseId.toString(),
        reason: reason.reason,
        payload: { note_id: note.id, length: note.body.length },
      });
      const tenantEntry = await owner.auditLogEntry.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId, action: 'platform.workspace_note_added' },
      });
      expect(tenantEntry.actorType).toBe('platform');
      expect(JSON.stringify([platformEntry.payload, tenantEntry.metadata])).not.toContain(
        'Prefers',
      );
      expect(await owner.platformNote.count()).toBe(1);

      // readonly reads them.
      const listed = await ok(get(A, 'readonly'));
      expect(listed.data).toEqual([note]);
    });

    it('pages newest first by keyset', async () => {
      const A = `/workspaces/${seeded.fx.a.licenseId}/notes`;
      for (const text of ['first', 'second', 'third']) {
        expect((await post(A, { body: text, ...reason })).statusCode).toBe(201);
      }
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page: { data: Array<{ body: string }>; next_cursor: string | null } = await ok(
          get(`${A}?limit=2${cursor ? `&cursor=${cursor}` : ''}`),
        );
        seen.push(...page.data.map((row) => row.body));
        cursor = page.next_cursor;
      } while (cursor);
      expect(seen).toEqual(['third', 'second', 'first']);
      expect((await get(`${A}?cursor=garbage`)).statusCode).toBe(400);
    });
  });

  describe('the support lookup', () => {
    const lookup = (q: string, role: PlatformRole = 'superadmin') =>
      get(`/support/lookup?q=${encodeURIComponent(q)}`, role);

    it('resolves a Thread ID, a Chat ID, a ticket and a customer email to the workspace — and nothing more', async () => {
      const { fx, a, b } = seeded;
      const expectOne = async (q: string, kind: string, licenseId: bigint, name: string) => {
        const body = await ok(lookup(q));
        expect(body).toEqual({
          data: [{ kind, license_id: licenseId.toString(), organization_name: name }],
        });
        for (const item of body.data) {
          expect(Object.keys(item).sort()).toEqual(['kind', 'license_id', 'organization_name']);
        }
        expect(JSON.stringify(body)).not.toMatch(/Secret subject|Player Alpha Name|Customer a/);
      };
      await expectOne(a.chatId, 'thread_id', fx.a.licenseId, 'Org A');
      await expectOne(` ${b.threadId.toLowerCase()} `, 'chat_id', fx.b.licenseId, 'Org B');
      await expectOne(a.ticketId, 'ticket', fx.a.licenseId, 'Org A');
      await expectOne('PLAYER-A@example.test', 'customer_email', fx.a.licenseId, 'Org A');

      const shared = await ok(lookup('shared@example.test'));
      expect(shared.data.map((row: { license_id: string }) => row.license_id).sort()).toEqual(
        [fx.a.licenseId.toString(), fx.b.licenseId.toString()].sort(),
      );
      // readonly may look up too — the answer is what the list already shows it.
      expect((await lookup(a.chatId, 'readonly')).statusCode).toBe(200);
    });

    it('answers an unknown id and a malformed one with the same 404, no sooner than the floor', async () => {
      const probes = [generateShortId(), 'not an id', '!!', 'nobody@example.test'];
      const bodies: string[] = [];
      for (const q of probes) {
        const started = performance.now();
        const response = await lookup(q);
        const elapsed = performance.now() - started;
        expect(response.statusCode, q).toBe(404);
        expect(response.json().error.type).toBe('not_found');
        expect(elapsed, q).toBeGreaterThanOrEqual(LOOKUP_FLOOR_MS - 5);
        bodies.push(response.json().error.message);
      }
      expect(new Set(bodies).size).toBe(1);
      const started = performance.now();
      expect((await lookup(seeded.a.chatId)).statusCode).toBe(200);
      expect(performance.now() - started).toBeGreaterThanOrEqual(LOOKUP_FLOOR_MS - 5);
      expect((await get('/support/lookup')).statusCode).toBe(400);
    });
  });
});
