/**
 * Data retention sweep (NFR-C1/C2/C8 — GDPR/KVKK).
 *
 * This deletes real data and cannot be undone, so the tests are written the way
 * one would want an irreversible operation checked before trusting it in
 * production. Each property that could fail independently is asserted on its own:
 *
 *   1. Expired data is actually gone — a closed thread past the window, and the
 *      events it cascades to.
 *   2. Everything not past the window stays — a recent thread, an active thread
 *      (never mind its age), a recent visit. The window is a floor, not a hint.
 *   3. One tenant's sweep can never reach another tenant's rows. RLS is the
 *      guarantee, and it is tested directly: a delete run in tenant A's context,
 *      against rows that exist identically in B, leaves B untouched.
 *   4. It is idempotent — a second run finds nothing and changes nothing.
 *   5. Dry-run counts but writes nothing: no delete, no audit entry.
 *   6. Each real sweep of a tenant records exactly one audit entry, attributed to
 *      the system, with the counts — the deletion's own paper trail.
 *   7. Outgoing mail files past the window are swept; recent ones are kept.
 *   8. Audit-log entries past the 30-day window are pruned (NFR-S12) through the
 *      one SECURITY DEFINER hole in the append-only log — which refuses a
 *      null/not-past cutoff and scopes every delete to a single tenant.
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import { cutoffFor, type RetentionPolicy } from '../../src/services/retention/policy.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

const POLICY: RetentionPolicy = { threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 30 };
const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

describe('retention sweep (NFR-C8)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let mailDir: string;
  let seq = 0;

  const ctx = (t: TenantFixture) => ({ licenseId: t.licenseId, organizationId: t.organizationId });
  const runner = () => new RetentionRunner(appRole, { policy: POLICY, mailDir });

  const nextId = (prefix: string, width: number): string => {
    seq += 1;
    return prefix + String(seq).padStart(width - 1, '0');
  };

  // Seeding runs as the owner, bypassing RLS, so a scenario can plant rows in
  // both tenants with whatever timestamps it needs to probe the boundary.
  async function seedClosedThread(
    t: TenantFixture,
    closedAt: Date,
    eventCount = 0,
  ): Promise<{ chatId: string; threadId: string }> {
    const chatId = nextId('c', 12);
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: t.customerId,
        active: false,
        createdAt: closedAt,
      },
    });
    const threadId = nextId('t', 12);
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: false,
        closedAt,
        createdAt: closedAt,
      },
    });
    for (let i = 0; i < eventCount; i += 1) {
      await owner.event.create({
        data: {
          id: nextId('e', 40),
          threadId,
          chatId,
          licenseId: t.licenseId,
          type: 'message',
          authorType: 'customer',
          text: `message ${i}`,
        },
      });
    }
    return { chatId, threadId };
  }

  async function seedActiveThread(t: TenantFixture, createdAt: Date): Promise<string> {
    const chatId = nextId('c', 12);
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: t.customerId,
        active: true,
        createdAt,
      },
    });
    const threadId = nextId('t', 12);
    await owner.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: t.licenseId,
        active: true,
        closedAt: null,
        createdAt,
      },
    });
    return threadId;
  }

  async function seedVisit(t: TenantFixture, startedAt: Date): Promise<string> {
    const visit = await owner.visit.create({
      data: { customerId: t.customerId, licenseId: t.licenseId, startedAt },
      select: { id: true },
    });
    return visit.id;
  }

  // Audit rows are planted as the owner (bypassing RLS) so a scenario can set
  // `created_at` on either side of the window. `auth.login` is an arbitrary
  // valid action; the sweep prunes by age, not by what the entry records.
  async function seedAudit(t: TenantFixture, createdAt: Date): Promise<string> {
    const row = await owner.auditLogEntry.create({
      data: {
        licenseId: t.licenseId,
        actorType: 'system',
        action: 'auth.login',
        metadata: {},
        createdAt,
      },
      select: { id: true },
    });
    return row.id;
  }

  async function writeMail(name: string, sentAt: Date): Promise<void> {
    await writeFile(
      join(mailDir, name),
      JSON.stringify({
        to: 'x@example.test',
        subject: 's',
        body: 'b',
        kind: 'notification',
        sent_at: sentAt.toISOString(),
      }),
      'utf8',
    );
  }

  const threadCount = (t: TenantFixture) =>
    owner.thread.count({ where: { licenseId: t.licenseId } });
  const eventCount = (t: TenantFixture) => owner.event.count({ where: { licenseId: t.licenseId } });
  const visitCount = (t: TenantFixture) => owner.visit.count({ where: { licenseId: t.licenseId } });
  const threadExists = async (id: string) =>
    (await owner.thread.findUnique({ where: { id } })) !== null;
  const auditExists = async (id: string) =>
    (await owner.auditLogEntry.findUnique({ where: { id } })) !== null;
  const pruneEntries = (t: TenantFixture) =>
    owner.auditLogEntry.findMany({
      where: { licenseId: t.licenseId, action: 'data.retention_pruned' },
    });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    seq = 0;
    mailDir = await mkdtemp(join(tmpdir(), 'nexa-retention-mail-'));
  });

  afterEach(async () => {
    await rm(mailDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Expired data is deleted; everything else survives
  // ==========================================================================

  describe('deletes what is past the window and keeps the rest', () => {
    it('hard-deletes closed threads past the window and cascades their events', async () => {
      const expired = await seedClosedThread(fx.a, daysAgo(400), 2);
      const recent = await seedClosedThread(fx.a, daysAgo(10), 1);
      const active = await seedActiveThread(fx.a, daysAgo(400));

      const report = await runner().run({ dryRun: false });

      // The expired thread and both its events are gone.
      expect(await threadExists(expired.threadId)).toBe(false);
      // Recent (still within the window) and active (not closed at all) remain.
      expect(await threadExists(recent.threadId)).toBe(true);
      expect(await threadExists(active)).toBe(true);
      // Two threads left for tenant A, and only the recent thread's one event.
      expect(await threadCount(fx.a)).toBe(2);
      expect(await eventCount(fx.a)).toBe(1);

      const a = report.tenants.find((r) => r.licenseId === fx.a.licenseId.toString());
      expect(a?.threads).toBe(1);
    });

    it('hard-deletes visitor telemetry past the window and keeps recent visits', async () => {
      const old = await seedVisit(fx.a, daysAgo(400));
      const fresh = await seedVisit(fx.a, daysAgo(10));

      await runner().run({ dryRun: false });

      expect(await owner.visit.findUnique({ where: { id: old } })).toBeNull();
      expect(await owner.visit.findUnique({ where: { id: fresh } })).not.toBeNull();
      expect(await visitCount(fx.a)).toBe(1);
    });
  });

  // ==========================================================================
  // Cross-tenant isolation (mandatory negative test)
  // ==========================================================================

  describe('one tenant’s sweep never touches another tenant', () => {
    it('a delete run in tenant A’s context leaves an identical row in B intact', async () => {
      // The same expired thread in both workspaces.
      const inA = await seedClosedThread(fx.a, daysAgo(400));
      const inB = await seedClosedThread(fx.b, daysAgo(400));

      // Run the sweep's exact delete, but only in A's context. RLS — not the
      // WHERE clause — is what must keep it out of B.
      const cutoff = cutoffFor(POLICY.threadDays, new Date());
      await withTenant(
        appRole,
        ctx(fx.a),
        (tx) =>
          tx.$executeRaw`
          DELETE FROM threads
           WHERE active = false AND closed_at IS NOT NULL AND closed_at < ${cutoff}`,
      );

      expect(await threadExists(inA.threadId)).toBe(false);
      expect(await threadExists(inB.threadId)).toBe(true);
    });

    it('the full sweep prunes every tenant and attributes each audit entry correctly', async () => {
      const inA = await seedClosedThread(fx.a, daysAgo(400));
      const inB = await seedClosedThread(fx.b, daysAgo(400));

      await runner().run({ dryRun: false });

      expect(await threadExists(inA.threadId)).toBe(false);
      expect(await threadExists(inB.threadId)).toBe(false);
      // Each tenant's own log carries its own single entry — never the other's.
      expect((await pruneEntries(fx.a)).length).toBe(1);
      expect((await pruneEntries(fx.b)).length).toBe(1);
    });
  });

  // ==========================================================================
  // Idempotent
  // ==========================================================================

  describe('idempotent', () => {
    it('a second apply run finds nothing left to prune', async () => {
      await seedClosedThread(fx.a, daysAgo(400), 2);
      await seedVisit(fx.a, daysAgo(400));

      const first = await runner().run({ dryRun: false });
      const firstA = first.tenants.find((r) => r.licenseId === fx.a.licenseId.toString());
      expect((firstA?.threads ?? 0) + (firstA?.visits ?? 0)).toBeGreaterThan(0);

      const second = await runner().run({ dryRun: false });
      const secondA = second.tenants.find((r) => r.licenseId === fx.a.licenseId.toString());
      expect(secondA?.threads).toBe(0);
      expect(secondA?.visits).toBe(0);
      // And the second run wrote no new audit entry — a no-op is not an event.
      expect((await pruneEntries(fx.a)).length).toBe(1);
    });
  });

  // ==========================================================================
  // Dry-run counts but writes nothing
  // ==========================================================================

  describe('dry-run', () => {
    it('reports what would be deleted without deleting or auditing', async () => {
      const expired = await seedClosedThread(fx.a, daysAgo(400), 2);
      const oldVisit = await seedVisit(fx.a, daysAgo(400));

      const report = await runner().run({ dryRun: true });

      // The report shows the blast radius…
      expect(report.dryRun).toBe(true);
      expect(report.totals.threads).toBeGreaterThanOrEqual(1);
      expect(report.totals.visits).toBeGreaterThanOrEqual(1);
      // Nothing here is past the audit window, so the count is zero; the audit
      // window has its own dedicated tests below.
      expect(report.auditEntries).toBe(0);
      expect(report.totals.auditEntries).toBe(0);

      // …but nothing was actually removed, and no audit entry was written.
      expect(await threadExists(expired.threadId)).toBe(true);
      expect(await eventCount(fx.a)).toBe(2);
      expect(await owner.visit.findUnique({ where: { id: oldVisit } })).not.toBeNull();
      expect((await pruneEntries(fx.a)).length).toBe(0);
    });
  });

  // ==========================================================================
  // Audit trail
  // ==========================================================================

  describe('the deletion records its own paper trail', () => {
    it('writes one system-attributed entry with the counts, only where something was deleted', async () => {
      await seedClosedThread(fx.a, daysAgo(400), 1);
      await seedVisit(fx.a, daysAgo(400));
      // Tenant B has nothing expired.

      await runner().run({ dryRun: false });

      const entriesA = await pruneEntries(fx.a);
      expect(entriesA.length).toBe(1);
      expect(entriesA[0]?.actorType).toBe('system');
      expect(entriesA[0]?.actorId).toBeNull();
      expect(entriesA[0]?.metadata).toMatchObject({ threads: 1, visits: 1, dry_run: false });

      // A tenant with nothing to prune gets no entry.
      expect((await pruneEntries(fx.b)).length).toBe(0);
    });
  });

  // ==========================================================================
  // Outgoing mail files
  // ==========================================================================

  describe('outgoing mail files', () => {
    it('sweeps mail past the window, keeps recent mail, and dry-run keeps all', async () => {
      await writeMail('old-notification.json', daysAgo(400));
      await writeMail('fresh-notification.json', daysAgo(1));

      const dry = await runner().run({ dryRun: true });
      expect(dry.mailFiles).toBe(1);
      expect((await readdir(mailDir)).length).toBe(2); // dry-run deleted nothing

      const applied = await runner().run({ dryRun: false });
      expect(applied.mailFiles).toBe(1);
      const remaining = await readdir(mailDir);
      expect(remaining).toEqual(['fresh-notification.json']);
    });
  });

  // ==========================================================================
  // Audit log window (NFR-S12: basic audit kept for "the last 30 days")
  //
  // The audit log is append-only to `nexa_app`, so this window is the one the
  // sweep applies through the SECURITY DEFINER `audit_prune_expired` rather than
  // a `withTenant` delete.
  // ==========================================================================

  describe('audit log entries past the window (NFR-S12)', () => {
    it('deletes an entry older than 30 days and keeps one inside the window', async () => {
      const old = await seedAudit(fx.a, daysAgo(31));
      const recent = await seedAudit(fx.a, daysAgo(29));

      const report = await runner().run({ dryRun: false });

      // 31 days > 30-day window → gone; 29 days < window → kept. This is the
      // literal "last 30 days" of NFR-S12.
      expect(await auditExists(old)).toBe(false);
      expect(await auditExists(recent)).toBe(true);

      const a = report.tenants.find((r) => r.licenseId === fx.a.licenseId.toString());
      expect(a?.auditEntries).toBe(1);
      expect(report.totals.auditEntries).toBe(1);
    });

    it('dry-run counts expired audit rows but deletes none and writes no entry', async () => {
      const old = await seedAudit(fx.a, daysAgo(400));

      const report = await runner().run({ dryRun: true });

      expect(report.auditEntries).toBe(1);
      expect(report.totals.auditEntries).toBe(1);
      expect(await auditExists(old)).toBe(true); // nothing deleted
      expect((await pruneEntries(fx.a)).length).toBe(0); // and no paper trail
    });

    it('is idempotent — a second run finds no expired audit rows', async () => {
      await seedAudit(fx.a, daysAgo(400));

      const first = await runner().run({ dryRun: false });
      const firstA = first.tenants.find((r) => r.licenseId === fx.a.licenseId.toString());
      expect(firstA?.auditEntries).toBe(1);

      const second = await runner().run({ dryRun: false });
      const secondA = second.tenants.find((r) => r.licenseId === fx.a.licenseId.toString());
      expect(secondA?.auditEntries).toBe(0);
      expect(second.totals.auditEntries).toBe(0);
    });

    it('records the audit count in the tenant’s data.retention_pruned metadata', async () => {
      await seedClosedThread(fx.a, daysAgo(400)); // a thread is pruned too
      await seedAudit(fx.a, daysAgo(400));
      await seedAudit(fx.a, daysAgo(400));

      await runner().run({ dryRun: false });

      const entries = await pruneEntries(fx.a);
      expect(entries.length).toBe(1);
      expect(entries[0]?.metadata).toMatchObject({ threads: 1, audit_entries: 2, dry_run: false });
    });
  });

  // ==========================================================================
  // The prune function is a narrow, guarded hole — not a table wipe
  //
  // SECURITY DEFINER bypasses RLS, so the in-function `license_id` predicate is
  // the only cross-tenant defence and the age guard the only thing between it and
  // a wipe. Both are tested directly against the function.
  // ==========================================================================

  describe('audit_prune_expired refuses to wipe the live log', () => {
    it('cross-tenant: pruning license A leaves an identical row in B intact', async () => {
      const inA = await seedAudit(fx.a, daysAgo(400));
      const inB = await seedAudit(fx.b, daysAgo(400));
      const cutoff = cutoffFor(POLICY.auditDays, new Date());

      // Call the definer function directly for A only. It bypasses RLS, so the
      // in-function license predicate — nothing else — must keep it out of B.
      const rows = await appRole.$queryRaw<Array<{ n: bigint }>>`
        SELECT audit_prune_expired(${fx.a.licenseId}, ${cutoff}) AS n`;
      expect(Number(rows[0]?.n)).toBe(1);

      expect(await auditExists(inA)).toBe(false);
      expect(await auditExists(inB)).toBe(true);
    });

    it('refuses a null cutoff without deleting anything', async () => {
      const recent = await seedAudit(fx.a, daysAgo(1));
      await expect(
        appRole.$queryRaw`SELECT audit_prune_expired(${fx.a.licenseId}, NULL::timestamptz) AS n`,
      ).rejects.toThrow();
      expect(await auditExists(recent)).toBe(true);
    });

    it('refuses a cutoff at or after now, so it cannot select live rows', async () => {
      const old = await seedAudit(fx.a, daysAgo(400));
      const recent = await seedAudit(fx.a, daysAgo(1));

      await expect(
        appRole.$queryRaw`SELECT audit_prune_expired(${fx.a.licenseId}, now()) AS n`,
      ).rejects.toThrow();
      const future = new Date(Date.now() + DAY);
      await expect(
        appRole.$queryRaw`SELECT audit_prune_expired(${fx.a.licenseId}, ${future}) AS n`,
      ).rejects.toThrow();

      // The refusal is total: nothing was deleted, not even the genuinely old row.
      expect(await auditExists(old)).toBe(true);
      expect(await auditExists(recent)).toBe(true);
    });

    it('does not open a table-level DELETE for nexa_app', async () => {
      const old = await seedAudit(fx.a, daysAgo(400));
      // A row the function *would* prune still cannot be removed by a direct
      // DELETE: the append-only grant is unchanged; the function is the only door.
      await expect(
        withTenant(
          appRole,
          ctx(fx.a),
          (tx) => tx.$executeRaw`DELETE FROM audit_log WHERE id = ${old}::uuid`,
        ),
      ).rejects.toThrow(/permission denied/i);
      expect(await auditExists(old)).toBe(true);
    });
  });
});
