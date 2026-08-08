/**
 * Tenant isolation — the negative tests.
 *
 * These run before the feature tests deliberately. A cross-tenant leak is
 * silent: every positive test still passes while the system hands one
 * customer's conversations to another. The only way to know isolation holds is
 * to attack it on purpose, from the same layer the application uses.
 *
 * Two properties are asserted separately, because they fail independently:
 *   1. The API's database role is genuinely subject to RLS (not the owner).
 *   2. With a tenant context set, no query can reach outside that tenant —
 *      including queries that explicitly ask to.
 */
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import { withTenant } from '../../src/lib/tenant.js';
import {
  buildCasesReport,
  buildLeadsReport,
  buildSalesReport,
  buildTeamPerformanceReport,
} from '../../src/routes/reports.js';
import { buildGroupCsv } from '../../src/services/reports/report-csv.js';
import { toPdf, type CsvCell } from '../../src/routes/reports-export.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const OWNER_URL = process.env['DATABASE_URL'];

describe('tenant isolation (RLS)', () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let fixtures: Fixtures;

  beforeAll(async () => {
    if (!APP_URL || !OWNER_URL) throw new Error('DATABASE_URL and DATABASE_APP_URL must be set');
    owner = ownerClient();
    app = new PrismaClient({ datasourceUrl: APP_URL });
    fixtures = await seedFixtures(owner);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  describe('the runtime role is actually constrained', () => {
    it('does not connect as a superuser or the table owner', async () => {
      // If this ever becomes true, every policy below silently stops applying
      // while all the other tests keep passing — the failure mode this suite
      // exists to prevent.
      const [role] = await app.$queryRaw<Array<{ rolname: string; rolsuper: boolean }>>`
        SELECT rolname, rolsuper FROM pg_roles WHERE rolname = current_user
      `;
      expect(role?.rolname).toBe('nexa_app');
      expect(role?.rolsuper).toBe(false);

      const [ownership] = await app.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM pg_tables
        WHERE schemaname = 'public' AND tableowner = current_user
      `;
      expect(Number(ownership?.count ?? 0)).toBe(0);
    });

    it('has row level security enabled on every tenant table', async () => {
      const rows = await app.$queryRaw<Array<{ tablename: string; rowsecurity: boolean }>>`
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public'
          AND tablename IN ('organizations','licenses','accounts','agent_memberships',
                            'oauth_clients','oauth_authorization_codes','oauth_refresh_tokens',
                            'api_tokens','customers','trusted_domains','ip_allowlist_entries',
                            'brands','work_schedules','agent_presence_events')
      `;
      expect(rows.length).toBe(14);
      for (const row of rows) {
        expect(row.rowsecurity, `${row.tablename} must have RLS enabled`).toBe(true);
      }
    });
  });

  describe('without a tenant context', () => {
    it('sees nothing at all — fail closed, not fail open', async () => {
      // The dangerous default is "no filter set → return everything". Every
      // tenant table must return zero rows instead.
      for (const table of [
        'organizations',
        'licenses',
        'agent_memberships',
        'api_tokens',
        'customers',
        'trusted_domains',
        'ip_allowlist_entries',
        'oauth_clients',
      ]) {
        const [row] = await app.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*) AS count FROM ${table}`,
        );
        expect(Number(row?.count ?? -1), `${table} must be empty without a tenant`).toBe(0);
      }
    });

    it('cannot insert either', async () => {
      await expect(
        app.$executeRaw`INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'sneaky')`,
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('with tenant A context', () => {
    it('reads only tenant A rows', async () => {
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        async (tx) => ({
          licenses: await tx.license.findMany({ select: { id: true } }),
          customers: await tx.customer.findMany({ select: { organizationId: true } }),
        }),
      );

      expect(result.licenses.map((l) => l.id)).toEqual([fixtures.a.licenseId]);
      expect(result.customers.every((c) => c.organizationId === fixtures.a.organizationId)).toBe(
        true,
      );
    });

    it('returns nothing when asked for a tenant B row by id', async () => {
      // The query is correct SQL and the row exists — RLS is what makes it
      // invisible. This is the exact shape of an IDOR attempt.
      const found = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.customer.findUnique({ where: { id: fixtures.b.customerId } }),
      );
      expect(found).toBeNull();
    });

    it('cannot reach tenant B rows through a join either', async () => {
      const rows = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.$queryRaw<Array<{ count: bigint }>>`
          SELECT count(*) AS count
          FROM api_tokens t
          JOIN licenses l ON l.id = t.license_id
          WHERE l.organization_id = ${fixtures.b.organizationId}::uuid
        `,
      );
      expect(Number(rows[0]?.count ?? -1)).toBe(0);
    });

    it('cannot update a tenant B row', async () => {
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) =>
          tx.customer.updateMany({
            where: { id: fixtures.b.customerId },
            data: { name: 'hijacked' },
          }),
      );
      expect(result.count).toBe(0);

      const untouched = await owner.customer.findUnique({ where: { id: fixtures.b.customerId } });
      expect(untouched?.name).toBe('Customer b');
    });

    it('cannot delete a tenant B row', async () => {
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.customer.deleteMany({ where: { id: fixtures.b.customerId } }),
      );
      expect(result.count).toBe(0);
      expect(
        await owner.customer.findUnique({ where: { id: fixtures.b.customerId } }),
      ).not.toBeNull();
    });

    it('cannot write a row belonging to tenant B', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.customer.create({
              data: { organizationId: fixtures.b.organizationId, name: 'planted' },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot see tenant B accounts, even though accounts are a global table', async () => {
      // `accounts` has no organization column — visibility comes from shared
      // membership, which is easy to get wrong.
      const visible = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.account.findMany({ select: { id: true } }),
      );
      const ids = visible.map((a) => a.id);
      expect(ids).toContain(fixtures.a.ownerAccountId);
      expect(ids).not.toContain(fixtures.b.ownerAccountId);
    });
  });

  describe('ip_allowlist_entries — the allow-side of IP security', () => {
    // The counterpart to banned_customer_ips: the sources a license trusts for
    // its own staff. Proven the same way as every tenant table — by attacking
    // tenant A's context against tenant B's rows — plus the uniqueness invariant
    // that stops the same entry being listed twice for one license.
    const aEntry = '203.0.113.10';
    const bEntry = '198.51.100.20';

    beforeAll(async () => {
      // Seeded as the owner, which is not subject to RLS.
      await owner.ipAllowlistEntry.createMany({
        data: [
          {
            organizationId: fixtures.a.organizationId,
            licenseId: fixtures.a.licenseId,
            entry: aEntry,
            label: 'office a',
          },
          {
            organizationId: fixtures.b.organizationId,
            licenseId: fixtures.b.licenseId,
            entry: bEntry,
          },
        ],
      });
    });

    afterAll(async () => {
      await owner.ipAllowlistEntry.deleteMany({ where: { entry: { in: [aEntry, bEntry] } } });
    });

    it('reads only its own license entries', async () => {
      const rows = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.ipAllowlistEntry.findMany({ select: { entry: true } }),
      );
      expect(rows.map((r) => r.entry)).toEqual([aEntry]);
    });

    it('cannot fetch a tenant B entry by id', async () => {
      // Correct SQL and the row exists — RLS is what makes it invisible.
      const planted = await owner.ipAllowlistEntry.findFirstOrThrow({ where: { entry: bEntry } });
      const found = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.ipAllowlistEntry.findUnique({ where: { id: planted.id } }),
      );
      expect(found).toBeNull();
    });

    it('cannot plant an entry for tenant B (WITH CHECK)', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.ipAllowlistEntry.create({
              data: {
                organizationId: fixtures.b.organizationId,
                licenseId: fixtures.b.licenseId,
                entry: '192.0.2.99',
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('rejects a duplicate (license_id, entry) for the same license', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.ipAllowlistEntry.create({
              data: {
                organizationId: fixtures.a.organizationId,
                licenseId: fixtures.a.licenseId,
                entry: aEntry,
              },
            }),
        ),
      ).rejects.toThrow(/unique constraint/i);
    });
  });

  describe('agent expertise (FR-MOD-08.6.3) — skill-based routing isolation', () => {
    // expertise and agent_expertise both carry a license_id, so the policy is the
    // plain license match. The join is the row routing (08.6.3-c) will trust to
    // decide who is qualified for a chat, so a cross-tenant leak here would offer
    // one workspace's conversations to another workspace's agents.
    let aExpertiseId: bigint;
    let bExpertiseId: bigint;
    let bChatId: string;
    let bThreadId: string;

    beforeAll(async () => {
      // Seeded as the owner, which is not subject to RLS.
      const aArea = await owner.expertise.create({
        data: { licenseId: fixtures.a.licenseId, name: 'Refunds', slug: 'refunds' },
        select: { id: true },
      });
      const bArea = await owner.expertise.create({
        data: { licenseId: fixtures.b.licenseId, name: 'Refunds', slug: 'refunds' },
        select: { id: true },
      });
      aExpertiseId = aArea.id;
      bExpertiseId = bArea.id;
      await owner.agentExpertise.create({
        data: {
          licenseId: fixtures.a.licenseId,
          agentId: fixtures.a.agentAccountId,
          expertiseId: aExpertiseId,
        },
      });
      await owner.agentExpertise.create({
        data: {
          licenseId: fixtures.b.licenseId,
          agentId: fixtures.b.agentAccountId,
          expertiseId: bExpertiseId,
        },
      });

      // A tenant B chat + assigned thread, so the takeover surface (a
      // conditional assignee update) can be attacked cross-tenant below. Seeded
      // as the owner, which is not subject to RLS.
      bChatId = randomBytes(6).toString('hex');
      bThreadId = randomBytes(6).toString('hex');
      await owner.chat.create({
        data: { id: bChatId, licenseId: fixtures.b.licenseId, customerId: fixtures.b.customerId },
      });
      await owner.thread.create({
        data: {
          id: bThreadId,
          chatId: bChatId,
          licenseId: fixtures.b.licenseId,
          assigneeId: fixtures.b.agentAccountId,
        },
      });
    });

    afterAll(async () => {
      await owner.chat.deleteMany({ where: { id: bChatId } });
      await owner.expertise.deleteMany({ where: { slug: 'refunds' } });
    });

    it('reads only its own license expertise and assignments', async () => {
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        async (tx) => ({
          expertise: await tx.expertise.findMany({ select: { id: true } }),
          links: await tx.agentExpertise.findMany({ select: { expertiseId: true } }),
        }),
      );
      expect(result.expertise.map((e) => e.id)).toEqual([aExpertiseId]);
      expect(result.links.map((l) => l.expertiseId)).toEqual([aExpertiseId]);
    });

    it('cannot fetch a tenant B expertise by id', async () => {
      // Correct SQL and the row exists — RLS is what makes it invisible (IDOR).
      const found = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) =>
          tx.expertise.findUnique({
            where: { licenseId_id: { licenseId: fixtures.b.licenseId, id: bExpertiseId } },
          }),
      );
      expect(found).toBeNull();
    });

    it('cannot plant an expertise for tenant B (WITH CHECK)', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.expertise.create({
              data: { licenseId: fixtures.b.licenseId, name: 'Planted', slug: 'planted' },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot assign a tenant B agent to a tenant B expertise (WITH CHECK)', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.agentExpertise.create({
              data: {
                licenseId: fixtures.b.licenseId,
                agentId: fixtures.b.agentAccountId,
                expertiseId: bExpertiseId,
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot delete a tenant B assignment', async () => {
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.agentExpertise.deleteMany({ where: { expertiseId: bExpertiseId } }),
      );
      expect(result.count).toBe(0);
      const survivors = await owner.agentExpertise.count({
        where: { licenseId: fixtures.b.licenseId, expertiseId: bExpertiseId },
      });
      expect(survivors).toBe(1);
    });

    it('cannot qualify one of its agents through a cross-tenant expertise (skill routing)', async () => {
      // The membership test routing's #selectAgent trusts to decide who is
      // qualified is a lookup into agent_expertise. Run under tenant A against
      // tenant B's expertise id: RLS empties it, so B's assignment can never
      // make one of A's chats land on an agent the rule does not really fit.
      const qualified = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.$queryRaw<Array<{ agent_id: string }>>`
          SELECT ae.agent_id::text AS agent_id
          FROM agent_expertise ae
          WHERE ae.expertise_id = ${bExpertiseId}
        `,
      );
      expect(qualified).toEqual([]);
    });

    it('cannot take over a tenant B chat by flipping its assignee', async () => {
      // Supervisor takeover (08.6.3-d) is a conditional assignee update:
      // updateMany where the current assignee still matches. Run under tenant A
      // against tenant B's thread it must touch nothing — the same fail-closed
      // boundary the HTTP layer answers with a 404 (chats.test.ts).
      const result = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) =>
          tx.thread.updateMany({
            where: { id: bThreadId, assigneeId: fixtures.b.agentAccountId },
            data: { assigneeId: fixtures.a.agentAccountId },
          }),
      );
      expect(result.count).toBe(0);

      const untouched = await owner.thread.findUnique({ where: { id: bThreadId } });
      expect(untouched?.assigneeId).toBe(fixtures.b.agentAccountId);
    });
  });

  describe('work scheduler (PRD §5.3-Vardiya) — roster and presence isolation', () => {
    // work_schedules and agent_presence_events both carry a license_id, so the
    // policy is the plain license match. What is behind it is a workspace's
    // internal operating detail: who is rostered when, and who was actually at
    // their desk. A leak here hands one company its competitor's staffing
    // levels and its agents' working patterns — and, because the forecast
    // (WORKSCHED-g) reads both tables, a cross-tenant row would also silently
    // corrupt the coverage numbers the other workspace plans against.
    beforeAll(async () => {
      // Seeded as the owner, which is not subject to RLS.
      await owner.workSchedule.createMany({
        data: [
          {
            licenseId: fixtures.a.licenseId,
            agentId: fixtures.a.agentAccountId,
            timezone: 'Europe/Istanbul',
            schedule: [{ day: 'monday', start: '09:00', end: '18:00', enabled: true }],
          },
          {
            licenseId: fixtures.b.licenseId,
            agentId: fixtures.b.agentAccountId,
            timezone: 'Europe/Berlin',
            schedule: [{ day: 'monday', start: '10:00', end: '19:00', enabled: true }],
          },
        ],
      });
      await owner.agentPresenceEvent.createMany({
        data: [
          {
            licenseId: fixtures.a.licenseId,
            agentId: fixtures.a.agentAccountId,
            status: 'accepting_chats',
          },
          {
            licenseId: fixtures.b.licenseId,
            agentId: fixtures.b.agentAccountId,
            status: 'offline',
          },
        ],
      });
    });

    afterAll(async () => {
      await owner.agentPresenceEvent.deleteMany({});
      await owner.workSchedule.deleteMany({});
    });

    it('shows neither table to a connection with no tenant context', async () => {
      // The suite's global fail-closed check runs before this block seeds, so
      // for these two tables it can only ever pass vacuously. Asserted here
      // instead, where both tables genuinely hold rows for two licenses: with
      // no tenant set the count must still be 0, because the dangerous default
      // for a roster is "return everyone's".
      for (const table of ['work_schedules', 'agent_presence_events']) {
        const [row] = await app.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*) AS count FROM ${table}`,
        );
        expect(Number(row?.count ?? -1), `${table} must be empty without a tenant`).toBe(0);
      }
      // Guards the guard: the rows really are there for someone to leak.
      expect(await owner.workSchedule.count()).toBe(2);
      expect(await owner.agentPresenceEvent.count()).toBe(2);
    });

    it("cannot read another license's roster", async () => {
      const rows = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.workSchedule.findMany({ select: { licenseId: true, timezone: true } }),
      );
      expect(rows).toEqual([{ licenseId: fixtures.a.licenseId, timezone: 'Europe/Istanbul' }]);
    });

    it('cannot fetch a tenant B work schedule by its exact key', async () => {
      // Correct SQL, and the row is really there — RLS is the only reason it
      // comes back empty. The shape of an IDOR against `GET
      // /agents/{agentId}/work-schedule` (WORKSCHED-c), which will look the row
      // up by exactly this composite key.
      const found = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) =>
          tx.workSchedule.findUnique({
            where: {
              licenseId_agentId: {
                licenseId: fixtures.b.licenseId,
                agentId: fixtures.b.agentAccountId,
              },
            },
          }),
      );
      expect(found).toBeNull();
    });

    it("cannot read another license's presence history", async () => {
      const rows = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.agentPresenceEvent.findMany({ select: { licenseId: true, status: true } }),
      );
      expect(rows).toEqual([{ licenseId: fixtures.a.licenseId, status: 'accepting_chats' }]);
    });

    it('cannot plant a work schedule for tenant B (WITH CHECK)', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.workSchedule.create({
              data: {
                licenseId: fixtures.b.licenseId,
                agentId: fixtures.b.ownerAccountId,
                timezone: 'UTC',
                schedule: [{ day: 'sunday', start: '00:00', end: '23:59', enabled: true }],
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it('cannot plant a presence event for tenant B (WITH CHECK)', async () => {
      // Forging presence history is how a cross-tenant writer would move the
      // other workspace's forecast: enough fabricated `offline` rows and it
      // under-reports its own coverage.
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.agentPresenceEvent.create({
              data: {
                licenseId: fixtures.b.licenseId,
                agentId: fixtures.b.ownerAccountId,
                status: 'offline',
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("cannot overwrite or delete tenant B's roster", async () => {
      // updateMany/deleteMany do not error under RLS — they silently match
      // nothing. Asserting the count *and* the surviving row is what separates
      // "the policy filtered it" from "the write went through elsewhere".
      const updated = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) =>
          tx.workSchedule.updateMany({
            where: { agentId: fixtures.b.agentAccountId },
            data: { timezone: 'Pacific/Auckland' },
          }),
      );
      expect(updated.count).toBe(0);

      const deleted = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.agentPresenceEvent.deleteMany({ where: { agentId: fixtures.b.agentAccountId } }),
      );
      expect(deleted.count).toBe(0);

      const survivor = await owner.workSchedule.findUnique({
        where: {
          licenseId_agentId: {
            licenseId: fixtures.b.licenseId,
            agentId: fixtures.b.agentAccountId,
          },
        },
      });
      expect(survivor?.timezone).toBe('Europe/Berlin');
      expect(
        await owner.agentPresenceEvent.count({ where: { licenseId: fixtures.b.licenseId } }),
      ).toBe(1);
    });
  });

  describe('scheduled report exports (PRD §5.3-Reports) — definition and run isolation', () => {
    // Both tables carry a license_id, so the policy is the plain license match.
    // What sits behind it is a workspace's reporting: the definition names who
    // inside the company receives its business figures, and the runs are the
    // delivery record. The write side is the graver half — adding an address to
    // another workspace's recipient list would turn their own scheduler into a
    // standing exfiltration channel for their numbers, with no anomaly to see
    // anywhere except a recipient list nobody re-reads.
    let aReportId: string;
    let bReportId: string;

    beforeAll(async () => {
      // Seeded as the owner, which is not subject to RLS.
      const [a, b] = await Promise.all([
        owner.scheduledReport.create({
          data: {
            licenseId: fixtures.a.licenseId,
            groupId: 'overview',
            frequency: 'weekly',
            recipients: ['ops@alpha.test'],
          },
          select: { id: true },
        }),
        owner.scheduledReport.create({
          data: {
            licenseId: fixtures.b.licenseId,
            groupId: 'sales',
            frequency: 'monthly',
            recipients: ['finance@beta.test'],
          },
          select: { id: true },
        }),
      ]);
      aReportId = a.id;
      bReportId = b.id;

      await owner.scheduledReportRun.createMany({
        data: [
          {
            licenseId: fixtures.a.licenseId,
            scheduledReportId: aReportId,
            periodKey: '2026-W31',
            periodFrom: new Date('2026-07-27T00:00:00Z'),
            periodTo: new Date('2026-08-03T00:00:00Z'),
            status: 'sent',
            recipientCount: 1,
          },
          {
            licenseId: fixtures.b.licenseId,
            scheduledReportId: bReportId,
            periodKey: '2026-07',
            periodFrom: new Date('2026-07-01T00:00:00Z'),
            periodTo: new Date('2026-08-01T00:00:00Z'),
            status: 'sent',
            recipientCount: 1,
          },
        ],
      });
    });

    afterAll(async () => {
      await owner.scheduledReportRun.deleteMany({});
      await owner.scheduledReport.deleteMany({});
    });

    it('shows neither table to a connection with no tenant context', async () => {
      // The suite's global fail-closed check runs before this block seeds, so
      // for these two tables it could only pass vacuously there. Asserted here
      // instead, where both tables hold rows for two licenses.
      for (const table of ['scheduled_reports', 'scheduled_report_runs']) {
        const [row] = await app.$queryRawUnsafe<Array<{ count: bigint }>>(
          `SELECT count(*) AS count FROM ${table}`,
        );
        expect(Number(row?.count ?? -1), `${table} must be empty without a tenant`).toBe(0);
      }
      // Guards the guard: the rows really are there for someone to leak.
      expect(await owner.scheduledReport.count()).toBe(2);
      expect(await owner.scheduledReportRun.count()).toBe(2);
    });

    it("cannot read another license's schedules — including its recipient list", async () => {
      const rows = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.scheduledReport.findMany({ select: { licenseId: true, recipients: true } }),
      );
      expect(rows).toEqual([{ licenseId: fixtures.a.licenseId, recipients: ['ops@alpha.test'] }]);
    });

    it('cannot fetch a tenant B schedule by its exact id', async () => {
      // Correct SQL against a row that is really there — RLS is the only reason
      // it comes back empty. The shape of an IDOR against `GET
      // /reports/scheduled-exports/{id}` (07.9-sched-c).
      const found = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.scheduledReport.findUnique({ where: { id: bReportId } }),
      );
      expect(found).toBeNull();
    });

    it("cannot read another license's delivery history", async () => {
      const rows = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.scheduledReportRun.findMany({ select: { licenseId: true, periodKey: true } }),
      );
      expect(rows).toEqual([{ licenseId: fixtures.a.licenseId, periodKey: '2026-W31' }]);
    });

    it('cannot plant a schedule for tenant B (WITH CHECK)', async () => {
      // The exfiltration move: a schedule owned by B, mailing B's figures to an
      // address of A's choosing, on B's own cadence.
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.scheduledReport.create({
              data: {
                licenseId: fixtures.b.licenseId,
                groupId: 'overview',
                frequency: 'daily',
                recipients: ['attacker@alpha.test'],
              },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });

    it("cannot append a recipient to tenant B's schedule", async () => {
      // updateMany does not error under RLS — it silently matches nothing.
      // Asserting the count *and* the surviving recipient list is what separates
      // "the policy filtered it" from "the write went through elsewhere".
      const updated = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) =>
          tx.scheduledReport.updateMany({
            where: { id: bReportId },
            data: { recipients: ['finance@beta.test', 'attacker@alpha.test'] },
          }),
      );
      expect(updated.count).toBe(0);

      const survivor = await owner.scheduledReport.findUnique({ where: { id: bReportId } });
      expect(survivor?.recipients).toEqual(['finance@beta.test']);
    });

    it("cannot cancel tenant B's schedule, nor rewrite its history", async () => {
      const deleted = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.scheduledReport.deleteMany({ where: { id: bReportId } }),
      );
      expect(deleted.count).toBe(0);

      const rewritten = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) =>
          tx.scheduledReportRun.updateMany({
            where: { scheduledReportId: bReportId },
            data: { status: 'failed', error: 'planted' },
          }),
      );
      expect(rewritten.count).toBe(0);

      expect(await owner.scheduledReport.count({ where: { id: bReportId } })).toBe(1);
      const [theirRun] = await owner.scheduledReportRun.findMany({
        where: { scheduledReportId: bReportId },
      });
      expect(theirRun?.status).toBe('sent');
      expect(theirRun?.error).toBeNull();
    });

    it("cannot claim a period on tenant B's schedule, under either license", async () => {
      // Denial of delivery rather than disclosure: whoever holds the
      // (schedule, period) claim, the report is not sent again for that period.
      // Under B's license RLS refuses the row; under A's own license the row
      // would pass `WITH CHECK` — the composite foreign key is what stops it,
      // which is the whole reason it is composite.
      const period = {
        periodKey: '2026-08',
        periodFrom: new Date('2026-08-01T00:00:00Z'),
        periodTo: new Date('2026-09-01T00:00:00Z'),
      };

      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.scheduledReportRun.create({
              data: { licenseId: fixtures.b.licenseId, scheduledReportId: bReportId, ...period },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);

      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.scheduledReportRun.create({
              data: { licenseId: fixtures.a.licenseId, scheduledReportId: bReportId, ...period },
            }),
        ),
      ).rejects.toThrow(/foreign key constraint/i);

      // B's next monthly period is still free to claim.
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.b.licenseId, organizationId: fixtures.b.organizationId },
          (tx) =>
            tx.scheduledReportRun.create({
              data: { licenseId: fixtures.b.licenseId, scheduledReportId: bReportId, ...period },
            }),
        ),
      ).resolves.toBeDefined();
    });

    it('cannot delete a run at all — not even its own', async () => {
      // No DELETE grant: a deletable run is a way to release a claimed period
      // and mail the same report twice. Distinct from the RLS cases above,
      // which match nothing rather than being refused outright.
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) => tx.scheduledReportRun.deleteMany({ where: { scheduledReportId: aReportId } }),
        ),
      ).rejects.toThrow(/permission denied/i);

      expect(
        await owner.scheduledReportRun.count({ where: { licenseId: fixtures.a.licenseId } }),
      ).toBe(1);
    });
  });

  describe('brands — Multibrand tenant isolation (NFR-S4)', () => {
    // Brands carry only a license_id, so the policy is the plain license match,
    // like websites/widget_settings. Proven the same way as every tenant table:
    // attack tenant A's context against tenant B's rows.
    let aBrandId: string;
    let bBrandId: string;

    beforeAll(async () => {
      // Seeded as the owner, which is not subject to RLS.
      const [a, b] = await Promise.all([
        owner.brand.create({
          data: {
            licenseId: fixtures.a.licenseId,
            name: 'Brand A',
            slug: 'brand-a',
            isDefault: true,
          },
          select: { id: true },
        }),
        owner.brand.create({
          data: {
            licenseId: fixtures.b.licenseId,
            name: 'Brand B',
            slug: 'brand-b',
            isDefault: true,
          },
          select: { id: true },
        }),
      ]);
      aBrandId = a.id;
      bBrandId = b.id;
    });

    afterAll(async () => {
      await owner.brand.deleteMany({ where: { id: { in: [aBrandId, bBrandId] } } });
    });

    it('reads only its own license brands', async () => {
      const rows = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.brand.findMany({ select: { slug: true } }),
      );
      expect(rows.map((r) => r.slug)).toEqual(['brand-a']);
    });

    it('cannot fetch a tenant B brand by id', async () => {
      // Correct SQL and the row exists — RLS is what makes it invisible.
      const found = await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.brand.findUnique({ where: { id: bBrandId } }),
      );
      expect(found).toBeNull();
    });

    it('cannot plant a brand for tenant B (WITH CHECK)', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          (tx) =>
            tx.brand.create({
              data: { licenseId: fixtures.b.licenseId, name: 'Sneaky', slug: 'sneaky' },
            }),
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  describe('context handling', () => {
    it('does not leak the tenant setting to the next transaction', async () => {
      // SET LOCAL unwinds with the transaction. If it ever escaped to the
      // pooled connection, the next request would silently inherit a tenant —
      // the worst kind of bug, because the wrong data still looks plausible.
      await withTenant(
        app,
        { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
        (tx) => tx.license.findMany(),
      );

      const [row] = await app.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM licenses
      `;
      expect(Number(row?.count ?? -1)).toBe(0);
    });

    it('clears the tenant setting even when the transaction fails', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: fixtures.a.licenseId, organizationId: fixtures.a.organizationId },
          async (tx) => {
            await tx.license.findMany();
            throw new Error('boom');
          },
        ),
      ).rejects.toThrow('boom');

      const [row] = await app.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) AS count FROM licenses
      `;
      expect(Number(row?.count ?? -1)).toBe(0);
    });

    it('rejects a malformed tenant context instead of running unscoped', async () => {
      await expect(
        withTenant(
          app,
          { licenseId: 0n, organizationId: fixtures.a.organizationId },
          async () => 1,
        ),
      ).rejects.toThrow(/invalid tenant license id/);

      await expect(
        withTenant(
          app,
          { licenseId: 1n, organizationId: "'; DROP TABLE licenses; --" },
          async () => 1,
        ),
      ).rejects.toThrow(/invalid tenant organization id/);
    });

    it('does not let a crafted context string smuggle a second setting', async () => {
      // The organization id is validated as a uuid before it reaches SQL, and
      // set_config takes it as a bound parameter — so injection has two
      // independent barriers.
      await expect(
        withTenant(
          app,
          {
            licenseId: fixtures.a.licenseId,
            organizationId: `${fixtures.b.organizationId}', true); SELECT set_config('app.current_license', '${fixtures.b.licenseId}`,
          },
          async () => 1,
        ),
      ).rejects.toThrow(/invalid tenant organization id/);
    });
  });

  // =========================================================================

  /**
   * Leads report — the license boundary *within one organization* (FR-MOD-07.7,
   * 07.7-b). The other suites pit organization A against organization B; this is
   * the harder case the leads report was built for. `customers` is
   * organization-scoped and holds no `license_id`, and one organization may own
   * several licenses, so every lead is visible under *every* license of its org.
   * A leads count taken straight off `customers.is_lead` would therefore report
   * a sibling license's leads as this one's. The report closes that leak by
   * binding a lead to a license only through a chat or ticket it has touched.
   */
  describe('leads report — license boundary within one organization (FR-MOD-07.7)', () => {
    let orgId: string;
    let l1: bigint;
    let l2: bigint;
    // A fixed touch day, so the by-day bucket is deterministic (no midnight-UTC
    // race) and both licenses report the same date.
    const touchDay = new Date('2026-05-15T12:00:00.000Z');
    const day = '2026-05-15';
    const from = new Date('2026-05-01T00:00:00.000Z');
    const to = new Date('2026-06-01T00:00:00.000Z');

    beforeAll(async () => {
      // A dedicated organization with two licenses — the sibling-license
      // scenario. Owner-written (RLS bypassed) so the fixture can span both.
      const org = await owner.organization.create({
        data: { name: 'Org SIBLING', region: 'eu' },
        select: { id: true },
      });
      orgId = org.id;
      const mkLicense = () =>
        owner.license.create({
          data: { organizationId: orgId, plan: 'growth', status: 'trialing' },
          select: { id: true },
        });
      l1 = (await mkLicense()).id;
      l2 = (await mkLicense()).id;

      const mkLead = () =>
        owner.customer.create({
          data: { organizationId: orgId, name: 'Lead', isLead: true },
          select: { id: true },
        });

      // Two leads bound to L1 — one through a chat, one through a ticket (both
      // license-scoped touch tables, so both must respect the boundary).
      const leadChat = await mkLead();
      await owner.chat.create({
        data: {
          id: generateShortId(),
          licenseId: l1,
          customerId: leadChat.id,
          createdAt: touchDay,
        },
      });
      const leadTicket = await mkLead();
      await owner.ticket.create({
        data: {
          id: generateShortId(),
          licenseId: l1,
          customerId: leadTicket.id,
          subject: 'Lead ticket',
          status: 'open',
          createdAt: touchDay,
        },
      });

      // One lead bound to L2 — so L2 reports its own, and a "L2 sees 0" pass
      // could not hide behind an empty tenant. What matters is *which* leads
      // each license claims.
      const leadOnL2 = await mkLead();
      await owner.chat.create({
        data: {
          id: generateShortId(),
          licenseId: l2,
          customerId: leadOnL2.id,
          createdAt: touchDay,
        },
      });
    });

    /** Count is_lead customers the way a *naive* report would — straight off the org-scoped table. */
    async function naiveOrgWideLeadCount(licenseId: bigint): Promise<number> {
      const [row] = await withTenant(
        app,
        { licenseId, organizationId: orgId },
        (tx) =>
          tx.$queryRaw<
            Array<{ n: bigint }>
          >`SELECT count(*) AS n FROM customers WHERE is_lead = TRUE`,
      );
      return Number(row?.n ?? 0n);
    }

    it('sees all three org leads under either license — the trap the report must not fall into', async () => {
      // customers is organization-scoped: both licenses of the org see every
      // lead. A count taken here reports 3 for each — which is exactly why the
      // report cannot count customers directly.
      expect(await naiveOrgWideLeadCount(l1)).toBe(3);
      expect(await naiveOrgWideLeadCount(l2)).toBe(3);
    });

    it('attributes each lead only to the license it actually touched', async () => {
      const l1Report = (await withTenant(app, { licenseId: l1, organizationId: orgId }, (tx) =>
        buildLeadsReport(tx, l1, from, to),
      )) as { by_day: Array<{ date: string; count: number }>; totals: { leads: number } };
      const l2Report = (await withTenant(app, { licenseId: l2, organizationId: orgId }, (tx) =>
        buildLeadsReport(tx, l2, from, to),
      )) as { by_day: Array<{ date: string; count: number }>; totals: { leads: number } };

      // L1 claims its two (chat + ticket); L2's lead never leaks in.
      expect(l1Report.totals.leads).toBe(2);
      expect(l1Report.by_day).toEqual([{ date: day, count: 2 }]);

      // L2 claims only its own — the two L1 leads are absent, not counted as 3.
      expect(l2Report.totals.leads).toBe(1);
      expect(l2Report.by_day).toEqual([{ date: day, count: 1 }]);
    });

    it('never lists a sibling license’s lead in the CSV either', async () => {
      const l2Csv = await withTenant(app, { licenseId: l2, organizationId: orgId }, (tx) =>
        buildGroupCsv(tx, l2, 'leads', from, to),
      );
      // The CSV is the same license-bound series: one row, count 1 — L1's leads
      // would push it to 3 if the boundary leaked.
      expect(l2Csv.headers).toEqual(['date', 'count']);
      expect(l2Csv.rows).toEqual([[day, 1]]);

      const l1Csv = await withTenant(app, { licenseId: l1, organizationId: orgId }, (tx) =>
        buildGroupCsv(tx, l1, 'leads', from, to),
      );
      expect(l1Csv.rows).toEqual([[day, 2]]);
    });
  });

  // =========================================================================

  /**
   * The v2 report groups, swept across the license boundary (FR-MOD-07.7, 07.7-l).
   *
   * The block above proves the *hardest* case for one group: `customers` is
   * organization-scoped, so Leads had to invent a license binding. The other
   * three v2 groups (Cases, Team performance, Sales) read license-scoped tables
   * and so lean on RLS plus an explicit `license_id` predicate — a much shorter
   * argument, and exactly the kind that is assumed rather than checked.
   *
   * So this sweeps all four, on every surface a caller can reach them through:
   * the JSON report, the CSV table and the PDF bytes. And it does so against a
   * **second, independent** two-license organization, deliberately not reusing
   * `Org SIBLING`: 07.7-b's boundary decision passing on the fixture built to
   * demonstrate it is weaker evidence than it passing on one built afterwards,
   * for a different purpose, without that decision in mind.
   *
   * The agent name is the tracer: the one piece of free text any of these four
   * reports carries, and the field a cross-tenant `LEFT JOIN accounts` would
   * surface first. Both names are deliberately *short*. Team performance has
   * fourteen columns, and the PDF lays a table out in fixed columns and
   * ellipsises a cell too wide for its own — a realistic full name would print
   * as `Swe…` and a substring search for it would pass whether the name leaked
   * or not. Three letters fit whole in that column, so the search really is
   * looking at what the page shows. (The agent *id* is a uuid and never fits;
   * it is swept in the CSV, where nothing is elided.)
   */
  describe('v2 report groups — cross-license sweep (FR-MOD-07.7, 07.7-l)', () => {
    /** The four groups 07.7 added; the ones already swept by earlier slices are not re-proved here. */
    const V2_GROUPS = ['cases', 'leads', 'team-performance', 'sales'] as const;

    const AGENT_ONE = 'Ada';
    const AGENT_TWO = 'Bo';
    // A fixed window and a fixed touch day, so every bucket is deterministic and
    // no assertion can race midnight UTC.
    const touch = new Date('2026-03-10T12:00:00.000Z');
    const day = '2026-03-10';
    const from = new Date('2026-03-01T00:00:00.000Z');
    const to = new Date('2026-04-01T00:00:00.000Z');

    let orgId: string;
    let s1: bigint;
    let s2: bigint;
    let agentOneId: string;
    let agentTwoId: string;

    beforeAll(async () => {
      // Owner-written (RLS bypassed) so one fixture can span both licenses —
      // which is the whole point: a leak is only observable from a dataset that
      // has something to leak.
      const org = await owner.organization.create({
        data: { name: 'Org SWEEP', region: 'eu' },
        select: { id: true },
      });
      orgId = org.id;
      const mkLicense = async (): Promise<bigint> =>
        (
          await owner.license.create({
            data: { organizationId: orgId, plan: 'growth', status: 'trialing' },
            select: { id: true },
          })
        ).id;
      s1 = await mkLicense();
      s2 = await mkLicense();

      const mkAgent = async (name: string, licenseId: bigint): Promise<string> => {
        const account = await owner.account.create({
          data: { email: `${generateShortId()}@sweep.test`, name },
          select: { id: true },
        });
        // `accounts` is a global table whose visibility comes from shared
        // membership, so the report's `LEFT JOIN accounts` only resolves a name
        // for a real member of the license — the same fixture shape the CSV
        // formula-injection test uses.
        await owner.agentMembership.create({
          data: { licenseId, agentId: account.id, role: 'agent' },
        });
        return account.id;
      };
      agentOneId = await mkAgent(AGENT_ONE, s1);
      agentTwoId = await mkAgent(AGENT_TWO, s2);

      /** A lead reached through a chat, plus a closed thread on that chat assigned to `agentId`. */
      const mkLeadChatWithThread = async (licenseId: bigint, agentId: string): Promise<void> => {
        const lead = await owner.customer.create({
          data: { organizationId: orgId, name: 'Sweep lead', isLead: true },
          select: { id: true },
        });
        const chatId = generateShortId();
        await owner.chat.create({
          data: { id: chatId, licenseId, customerId: lead.id, createdAt: touch },
        });
        await owner.thread.create({
          data: {
            id: generateShortId(),
            chatId,
            licenseId,
            assigneeId: agentId,
            active: false,
            createdAt: touch,
            closedAt: touch,
          },
        });
      };

      // S1: two leads (one through a chat, one through a ticket), two tickets
      // (one still open, one solved), one closed thread on agent one.
      await mkLeadChatWithThread(s1, agentOneId);
      const s1LeadByTicket = await owner.customer.create({
        data: { organizationId: orgId, name: 'Sweep lead', isLead: true },
        select: { id: true },
      });
      await owner.ticket.create({
        data: {
          id: generateShortId(),
          licenseId: s1,
          customerId: s1LeadByTicket.id,
          subject: 'S1 open',
          status: 'open',
          createdAt: touch,
        },
      });
      await owner.ticket.create({
        data: {
          id: generateShortId(),
          licenseId: s1,
          subject: 'S1 solved',
          status: 'solved',
          createdAt: touch,
        },
      });

      // S2: one lead through a chat, one open ticket, one closed thread on agent
      // two. Deliberately *fewer* of everything than S1, so a leak shows up as a
      // number that is too big rather than as a coincidence.
      await mkLeadChatWithThread(s2, agentTwoId);
      await owner.ticket.create({
        data: {
          id: generateShortId(),
          licenseId: s2,
          subject: 'S2 open',
          status: 'open',
          createdAt: touch,
        },
      });
    });

    interface CsvTable {
      headers: string[];
      rows: CsvCell[][];
    }

    /** Every v2 group's CSV table for one license, as the export route would build it. */
    async function tablesFor(licenseId: bigint): Promise<Record<string, CsvTable>> {
      const tables: Record<string, CsvTable> = {};
      for (const group of V2_GROUPS) {
        tables[group] = await withTenant(app, { licenseId, organizationId: orgId }, (tx) =>
          buildGroupCsv(tx, licenseId, group, from, to),
        );
      }
      return tables;
    }

    /** A table as one searchable blob — the CSV surface, where nothing is elided. */
    const csvText = (table: CsvTable): string =>
      [table.headers, ...table.rows].map((row) => row.join(' ')).join('\n');

    /**
     * The strings a PDF actually draws, read back out of its content stream.
     * The layout ellipsises a cell too wide for its column, so what reaches the
     * page is not always what went in; searching what it prints is what makes a
     * "not present" assertion mean something.
     */
    const pdfStrings = (table: CsvTable): string[] =>
      [
        ...toPdf('Report', table.headers, table.rows, { subtitle: day })
          .toString('latin1')
          .matchAll(/\((.*?)\) Tj/g),
      ].map((match) => match[1] ?? '');

    it('reports each license only its own figures, on all four JSON groups', async () => {
      const report = async (licenseId: bigint) =>
        withTenant(app, { licenseId, organizationId: orgId }, async (tx) => ({
          cases: await buildCasesReport(tx, licenseId, from, to),
          leads: await buildLeadsReport(tx, licenseId, from, to),
          team: await buildTeamPerformanceReport(tx, licenseId, from, to),
          sales: await buildSalesReport(tx, licenseId, from, to),
        }));

      const one = await report(s1);
      const two = await report(s2);

      // Cases: S1 owns two tickets (one still open — the lead's — and one
      // solved); S2 owns one. Sum the day split rather than trusting a total, so
      // a leaked row cannot hide in a bucket nobody asserted on.
      const totalCases = (report: Record<string, unknown>): number =>
        (report['by_day'] as Array<{ total: number }>).reduce((sum, row) => sum + row.total, 0);
      expect(totalCases(one.cases)).toBe(2);
      expect(totalCases(two.cases)).toBe(1);

      // Leads: S1's two, S2's one — never the organization's three.
      expect((one.leads as { totals: { leads: number } }).totals.leads).toBe(2);
      expect((two.leads as { totals: { leads: number } }).totals.leads).toBe(1);
      expect((one.leads as { by_day: unknown[] }).by_day).toEqual([{ date: day, count: 2 }]);
      expect((two.leads as { by_day: unknown[] }).by_day).toEqual([{ date: day, count: 1 }]);

      // Team performance: one agent each, and never the sibling's.
      const agentIds = (report: Record<string, unknown>): string[] =>
        (report['agents'] as Array<{ agent_id: string }>).map((row) => row.agent_id);
      expect(agentIds(one.team)).toEqual([agentOneId]);
      expect(agentIds(two.team)).toEqual([agentTwoId]);

      // Sales is the honest skeleton for both — there is no source, so there is
      // nothing to leak, and the assertion is that it stays that way rather than
      // quietly acquiring a figure from somewhere.
      for (const sales of [one.sales, two.sales]) {
        expect(sales).toMatchObject({ configured: false, tracked_sales: null, conversions: null });
      }
    });

    it('never lets a sibling license’s agent reach either export format', async () => {
      const [oneTables, twoTables] = [await tablesFor(s1), await tablesFor(s2)];

      for (const group of V2_GROUPS) {
        const mine = twoTables[group];
        const theirs = oneTables[group];
        if (!mine || !theirs) throw new Error(`no table built for ${group}`);

        // Guards the guard: the tracer really is findable, in both formats, when
        // it belongs there — so a clean sweep means "absent", not "unsearchable".
        if (group === 'team-performance') {
          expect(csvText(theirs), `${group} csv fixture`).toContain(AGENT_ONE);
          expect(pdfStrings(theirs), `${group} pdf fixture`).toContain(AGENT_ONE);
          expect(csvText(theirs), `${group} csv fixture`).toContain(agentOneId);
        }

        expect(csvText(mine), `${group} csv`).not.toContain(AGENT_ONE);
        expect(csvText(mine), `${group} csv`).not.toContain(agentOneId);
        // Read back out of the content stream rather than searched for as raw
        // bytes: what the page prints is what a reader would see leak.
        expect(pdfStrings(mine), `${group} pdf`).not.toContain(AGENT_ONE);
      }
    });

    it('carries no identity at all in Cases, Leads and Sales — nothing there to leak (§V3)', async () => {
      // These three are aggregate-only by design: a lead's name, a ticket's
      // subject and a customer's email never enter them, so isolation for them
      // is not only "the right rows" but "no identifying cell exists in either
      // format". Asserted as a closed vocabulary, because the way this decision
      // erodes is one helpful column at a time.
      const SALES_METRICS = [
        'configured',
        'false',
        'true',
        'tracked_sales',
        'attributed_revenue_cents',
        'currency',
        'conversions',
      ];
      const isAggregate = (cell: CsvCell): boolean =>
        cell == null ||
        typeof cell === 'number' ||
        /^\d{4}-\d{2}-\d{2}$/.test(cell) ||
        SALES_METRICS.includes(cell);

      for (const tables of [await tablesFor(s1), await tablesFor(s2)]) {
        for (const group of ['cases', 'leads', 'sales'] as const) {
          const table = tables[group];
          if (!table) throw new Error(`no table built for ${group}`);
          // Both formats render this one table, so a cell that carries no
          // identity carries none in the PDF either.
          expect(table.rows.length, `${group} must have rows to sweep`).toBeGreaterThan(0);
          for (const row of table.rows) {
            for (const cell of row) {
              expect(isAggregate(cell), `${group} cell ${String(cell)}`).toBe(true);
            }
          }
        }
      }
    });

    it('keeps every export row count to the license that owns the rows', async () => {
      const [oneTables, twoTables] = [await tablesFor(s1), await tablesFor(s2)];

      // Cases and Leads are day series, Team performance is one row per agent:
      // S1 has strictly more of each, so an equal count on S2 would mean the
      // sibling's rows arrived.
      expect(twoTables['leads']?.rows).toEqual([[day, 1]]);
      expect(oneTables['leads']?.rows).toEqual([[day, 2]]);
      expect(twoTables['cases']?.rows).toEqual([[day, 1, 0, 1]]);
      expect(oneTables['cases']?.rows).toEqual([[day, 1, 1, 2]]);
      expect(twoTables['team-performance']?.rows).toHaveLength(1);
      expect(oneTables['team-performance']?.rows).toHaveLength(1);
      expect(twoTables['team-performance']?.rows[0]?.[0]).toBe(agentTwoId);
      expect(oneTables['team-performance']?.rows[0]?.[0]).toBe(agentOneId);
    });

    it('still refuses the organization-wide lead count, on an independent fixture', async () => {
      // 07.7-b's decision, re-derived here rather than inherited: `customers` is
      // organization-scoped, so both licenses of this org see all three leads.
      // The report must still claim only the ones that touched it.
      const naive = async (licenseId: bigint): Promise<number> => {
        const [row] = await withTenant(
          app,
          { licenseId, organizationId: orgId },
          (tx) =>
            tx.$queryRaw<
              Array<{ n: bigint }>
            >`SELECT count(*) AS n FROM customers WHERE is_lead = TRUE`,
        );
        return Number(row?.n ?? 0n);
      };
      expect(await naive(s1)).toBe(3);
      expect(await naive(s2)).toBe(3);

      const csv = await withTenant(app, { licenseId: s2, organizationId: orgId }, (tx) =>
        buildGroupCsv(tx, s2, 'leads', from, to),
      );
      expect(csv.rows).toEqual([[day, 1]]);
    });
  });
});
