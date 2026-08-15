/**
 * Export integrity against a real database (NFR-C6 · C6-c).
 *
 * The unit suite (`src/services/audit/audit-chain.test.ts`) proves the
 * cryptography: what the hash covers, what the signature covers, what the
 * verifier can see. None of that is worth anything unless the chain is actually
 * *built* correctly under the conditions a live system creates, and those
 * conditions only exist in Postgres:
 *
 *   - Positions must be gapless even when two requests write at once. If
 *     concurrent writers can read the same head, the chain forks into two runs
 *     that each verify perfectly and together are missing half the trail.
 *   - A rolled-back request must consume no position, or every failed request
 *     punches a hole the verifier will report as tampering.
 *   - Retention must not delete an entry the SIEM has not received. This is the
 *     one failure the chain cannot survive: the rows that would prove the loss
 *     are the rows that went, and what is left verifies cleanly.
 *   - The head is a tenant object like any other, and a cross-tenant write to it
 *     does not leak data — it destroys the trail's ability to speak.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/lib/tenant.js';
import {
  deriveChainKey,
  verifyAuditChain,
  verifyExportSignature,
  type VerifiableRow,
} from '../../src/services/audit/audit-chain.js';
import { writeAuditEntry, type AuditAction } from '../../src/services/audit/audit-log.js';
import { detectChainGap } from '../../src/services/audit/siem-export.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import type { RetentionPolicy } from '../../src/services/retention/policy.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const CHAIN_SECRET = testEnv().AUDIT_CHAIN_SECRET;
const DAY = 86_400_000;

interface ExportRecord {
  id: string;
  chain_seq: number | null;
  prev_hash: string | null;
  hash: string | null;
}

describe('audit chain (NFR-C6 · C6-c)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let server: TestServer;
  let fx: Fixtures;
  let exportToken: string;
  let settingsToken: string;

  const ctx = (t: TenantFixture) => ({
    licenseId: t.licenseId,
    organizationId: t.organizationId,
  });
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const keyFor = (t: TenantFixture) => deriveChainKey(CHAIN_SECRET, t.licenseId);

  /** Write one entry the way the application does — through the chained writer. */
  const append = (t: TenantFixture, target: string, at?: Date) =>
    withTenant(appRole, ctx(t), (tx) =>
      writeAuditEntry(
        tx,
        { licenseId: t.licenseId, chainSecret: CHAIN_SECRET },
        { action: 'settings.security_updated' as AuditAction, target },
        ...(at ? [{ now: at }] : []),
      ),
    );

  /** The tenant's entries in chain order, shaped for the verifier. */
  async function trailOf(t: TenantFixture): Promise<VerifiableRow[]> {
    return owner.auditLogEntry.findMany({
      where: { licenseId: t.licenseId },
      orderBy: [{ chainSeq: 'asc' }],
    });
  }

  const headOf = (t: TenantFixture) =>
    owner.auditChainHead.findUniqueOrThrow({ where: { licenseId: t.licenseId } });

  const verify = async (t: TenantFixture) => {
    const head = await headOf(t);
    return verifyAuditChain(await trailOf(t), {
      key: keyFor(t),
      prunedThroughSeq: head.prunedThroughSeq ?? 0n,
      genesisAt: head.genesisAt,
    });
  };

  const gapFlag = (t: TenantFixture) => withTenant(appRole, ctx(t), (tx) => detectChainGap(tx));

  beforeAll(async () => {
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    // Horizon off: an entry written in a test must be exportable in the same
    // test. Nothing else is writing, so the race the horizon guards against
    // cannot occur here.
    server = await startTestServer({ SIEM_EXPORT_HORIZON_MS: '0' });
  });

  afterAll(async () => {
    await server.close();
    await appRole.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    const grant = (t: TenantFixture, scopes: string[]) =>
      grantToken(owner, {
        licenseId: t.licenseId,
        organizationId: t.organizationId,
        ownerId: t.ownerAccountId,
        scopes,
      });
    exportToken = await grant(fx.a, ['audit_log--export:ro']);
    settingsToken = await grant(fx.a, ['access_rules:rw']);
  });

  // =========================================================================
  // Building the chain
  // =========================================================================

  describe('writing', () => {
    it('numbers a workspace’s entries from one, without gaps', async () => {
      for (const n of [1, 2, 3]) await append(fx.a, `entry-${n}`);

      const trail = await trailOf(fx.a);
      expect(trail.map((row) => row.chainSeq)).toEqual([1n, 2n, 3n]);
      expect(trail[0]?.prevHash).toBeNull(); // genesis has no predecessor
      expect(trail[1]?.prevHash).toBe(trail[0]?.hash);
      expect(trail[2]?.prevHash).toBe(trail[1]?.hash);
      expect((await verify(fx.a)).ok).toBe(true);
    });

    it('numbers each workspace separately', async () => {
      // Positions are per licence, not global: a workspace's export must be
      // contiguous on its own, and it cannot be if the numbers are shared with
      // tenants whose rows it will never see.
      await append(fx.a, 'a1');
      await append(fx.b, 'b1');
      await append(fx.a, 'a2');

      expect((await trailOf(fx.a)).map((r) => r.chainSeq)).toEqual([1n, 2n]);
      expect((await trailOf(fx.b)).map((r) => r.chainSeq)).toEqual([1n]);
    });

    it('does not fork the chain when two writers run at once', async () => {
      // The failure this test exists for: both transactions read the same head,
      // both build on the same predecessor, and the result is two runs that
      // each verify while together holding half the trail. The head's row lock
      // is what prevents it, so the assertion is that ten concurrent writes
      // produce ten distinct positions and one intact chain.
      await Promise.all(Array.from({ length: 10 }, (_, i) => append(fx.a, `concurrent-${i}`)));

      const trail = await trailOf(fx.a);
      expect(trail).toHaveLength(10);
      expect(trail.map((r) => r.chainSeq)).toEqual(
        Array.from({ length: 10 }, (_, i) => BigInt(i + 1)),
      );
      expect((await verify(fx.a)).ok).toBe(true);
    });

    it('consumes no position when the surrounding request rolls back', async () => {
      // Otherwise every failed request leaves a hole, and a system under normal
      // load reports itself as tampered with. The reservation is inside the
      // caller's transaction precisely so a rollback un-reserves it.
      await append(fx.a, 'first');
      await expect(
        withTenant(appRole, ctx(fx.a), async (tx) => {
          await writeAuditEntry(
            tx,
            { licenseId: fx.a.licenseId, chainSecret: CHAIN_SECRET },
            { action: 'auth.login', target: 'doomed' },
          );
          throw new Error('caller failed after writing its trail entry');
        }),
      ).rejects.toThrow(/doomed|caller failed/);

      await append(fx.a, 'second');
      expect((await trailOf(fx.a)).map((r) => r.chainSeq)).toEqual([1n, 2n]);
      expect((await verify(fx.a)).ok).toBe(true);
    });

    it('refuses to write an entry with no chain secret', async () => {
      // An unchained entry is a row nothing later can vouch for, so a caller
      // that forgot the key fails loudly rather than quietly writing one.
      await expect(
        withTenant(appRole, ctx(fx.a), (tx) =>
          writeAuditEntry(
            tx,
            { licenseId: fx.a.licenseId, chainSecret: '' },
            { action: 'auth.login' },
          ),
        ),
      ).rejects.toThrow(/chain secret/i);
    });

    it('records the genesis instant, so a later unchained row is a finding', async () => {
      await append(fx.a, 'first');
      const head = await headOf(fx.a);
      expect(head.seq).toBe(1n);
      expect(head.genesisAt.getTime()).toBeLessThanOrEqual(Date.now() + 1_000);

      // A row planted straight into the table, after genesis, carrying no
      // chain. It breaks no link and leaves no hole — this is the only thing
      // that catches it.
      await owner.auditLogEntry.create({
        data: {
          licenseId: fx.a.licenseId,
          actorType: 'system',
          action: 'auth.login',
          target: 'smuggled',
        },
      });

      const result = await verify(fx.a);
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.kind)).toContain('unchained_entry');
      expect(await gapFlag(fx.a)).toBe(true);
    });
  });

  // =========================================================================
  // Detecting damage
  // =========================================================================

  describe('gap detection', () => {
    it('catches an entry deleted from the middle', async () => {
      for (const n of [1, 2, 3, 4]) await append(fx.a, `entry-${n}`);
      const trail = await trailOf(fx.a);

      // The owner connection is not bound by the append-only grant — this is
      // the "somebody reached the database underneath the application" case the
      // chain exists for.
      await owner.auditLogEntry.delete({ where: { id: trail[1]!.id } });

      const result = await verify(fx.a);
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.kind)).toEqual(['sequence_gap']);
      expect(await gapFlag(fx.a)).toBe(true);
    });

    it('catches entries deleted from the newest end', async () => {
      // Invisible to contiguity alone: what is left is a perfect run from 1. The
      // head knows the last position it issued, and a position only becomes
      // visible once its entry committed, so a head ahead of the table means
      // rows went.
      for (const n of [1, 2, 3]) await append(fx.a, `entry-${n}`);
      const trail = await trailOf(fx.a);
      await owner.auditLogEntry.delete({ where: { id: trail[2]!.id } });

      expect(await gapFlag(fx.a)).toBe(true);
    });

    it('catches an entry that was edited in place', async () => {
      for (const n of [1, 2, 3]) await append(fx.a, `entry-${n}`);
      const trail = await trailOf(fx.a);
      await owner.auditLogEntry.update({
        where: { id: trail[1]!.id },
        data: { action: 'auth.login', target: 'covered-up' },
      });

      const result = await verify(fx.a);
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.kind)).toContain('hash_mismatch');
    });

    it('reports a healthy workspace as healthy', async () => {
      for (const n of [1, 2, 3]) await append(fx.a, `entry-${n}`);
      expect(await gapFlag(fx.a)).toBe(false);
      expect((await verify(fx.a)).ok).toBe(true);
    });

    it('has no opinion about a workspace that has never written a chained entry', async () => {
      // `null`, not `false`. A log with no chain cannot demonstrate its own
      // completeness, and answering "no gaps" from a system that cannot detect
      // gaps is the false assurance the control exists to prevent.
      expect(await gapFlag(fx.a)).toBeNull();
    });

    it("never sees another workspace's chain", async () => {
      await append(fx.a, 'a1');
      await append(fx.b, 'b1');
      const trail = await trailOf(fx.b);
      await owner.auditLogEntry.delete({ where: { id: trail[0]!.id } });

      // B is damaged; A is not, and A's answer must not be contaminated by it.
      expect(await gapFlag(fx.a)).toBe(false);
      expect(await gapFlag(fx.b)).toBe(true);
    });

    it("cannot be verified with another workspace's key", async () => {
      // The keys are derived per licence so that learning one is not learning
      // another. If this ever passes, that separation is gone.
      await append(fx.a, 'a1');
      const result = verifyAuditChain(await trailOf(fx.a), { key: keyFor(fx.b) });
      expect(result.ok).toBe(false);
    });
  });

  // =========================================================================
  // The head is a tenant object
  // =========================================================================

  describe('audit_chain_heads', () => {
    it('is invisible across the tenant boundary', async () => {
      await append(fx.a, 'a1');
      const seen = await withTenant(
        appRole,
        ctx(fx.b),
        (tx) =>
          tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM audit_chain_heads`,
      );
      expect(Number(seen[0]?.n ?? 0n)).toBe(0);
    });

    it('cannot be deleted by the application role', async () => {
      // Deleting the head erases the memory that a chain existed: the next
      // entry starts at 1 with no predecessor, and everything before it reads
      // as "pre-genesis" — rows nobody has to account for.
      await append(fx.a, 'a1');
      await expect(
        withTenant(
          appRole,
          ctx(fx.a),
          (tx) =>
            tx.$executeRaw`DELETE FROM audit_chain_heads WHERE license_id = ${fx.a.licenseId}`,
        ),
      ).rejects.toThrow(/permission denied/i);
    });

    it('refuses a head planted for another workspace', async () => {
      await expect(
        withTenant(
          appRole,
          ctx(fx.a),
          (tx) =>
            tx.$executeRaw`
            INSERT INTO audit_chain_heads (license_id, seq, genesis_at, created_at, updated_at)
            VALUES (${fx.b.licenseId}, 0, now(), now(), now())`,
        ),
      ).rejects.toThrow(/row-level security/i);
    });
  });

  // =========================================================================
  // Retention may not delete what has not shipped
  // =========================================================================

  describe('retention', () => {
    const FOREVER: RetentionPolicy = {
      threadDays: 3_650,
      visitDays: 3_650,
      mailDays: 3_650,
      auditDays: 30,
    };
    const sweep = () =>
      new RetentionRunner(appRole, {
        policy: FOREVER,
        mailDir: '.data/mail-audit-chain-test',
        auditChainSecret: CHAIN_SECRET,
      }).run({ dryRun: false });

    /** Three entries, all older than the 30-day audit window. */
    async function seedExpiredTrail(t: TenantFixture): Promise<void> {
      for (const n of [1, 2, 3]) {
        await append(t, `old-${n}`, new Date(Date.now() - (100 - n) * DAY));
      }
    }

    const enableExport = (t: TenantFixture, delivered: { id: string; createdAt: Date } | null) =>
      owner.siemExportCursor.create({
        data: {
          licenseId: t.licenseId,
          target: 'file',
          enabled: true,
          ...(delivered
            ? { lastExportedId: delivered.id, lastExportedAt: delivered.createdAt }
            : {}),
        },
      });

    it('prunes expired entries when nothing is shipping them', async () => {
      // The behaviour before this slice, preserved: with no export configured,
      // retention is the only policy there is.
      await seedExpiredTrail(fx.a);
      await sweep();
      expect(await owner.auditLogEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });

    it('keeps an expired entry the SIEM has not received yet', async () => {
      // The invariant the whole slice turns on. Without it a workspace whose
      // sink has been broken for a month loses those entries permanently — and
      // in the one way the chain cannot repair, because the rows that would
      // prove the loss are the rows that went.
      await seedExpiredTrail(fx.a);
      const trail = await trailOf(fx.a);
      await enableExport(fx.a, { id: trail[0]!.id, createdAt: trail[0]!.createdAt });

      await sweep();

      const left = await trailOf(fx.a);
      // 1 went — it had been delivered. 2 and 3 stay, and 4 is the sweep's own
      // `data.retention_pruned` entry, which takes the next position like any
      // other write: the record of a deletion is itself part of the chain.
      expect(left.map((r) => r.chainSeq)).toEqual([2n, 3n, 4n]);
      // And what remains still verifies: the watermark accounts for the one
      // entry that legitimately went.
      expect((await verify(fx.a)).ok).toBe(true);
      expect(await gapFlag(fx.a)).toBe(false);
    });

    it('keeps everything when the export has never delivered', async () => {
      // A sink that has never run has a backlog of the whole trail. The visible
      // cost is storage that stops shrinking — a symptom an operator can act on
      // — and the alternative cost is invisible.
      await seedExpiredTrail(fx.a);
      await enableExport(fx.a, null);

      await sweep();

      // All three, and no fourth: a sweep that removed nothing writes no
      // `data.retention_pruned` entry either, so the trail is untouched.
      expect(await owner.auditLogEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(3);
      expect((await verify(fx.a)).ok).toBe(true);
    });

    it('prunes normally when the export is switched off', async () => {
      // Turning the feed off is a decision that the trail is not being shipped.
      // Honouring a stale cursor after that would freeze the log forever.
      await seedExpiredTrail(fx.a);
      await owner.siemExportCursor.create({
        data: { licenseId: fx.a.licenseId, target: 'file', enabled: false },
      });

      await sweep();

      expect(await owner.auditLogEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(1);
    });

    it('records how far it pruned, so the remainder still verifies', async () => {
      // Without the watermark, a legitimately shortened trail and a trail
      // somebody cut the front off are the same shape.
      await seedExpiredTrail(fx.a);
      const trail = await trailOf(fx.a);
      await enableExport(fx.a, { id: trail[1]!.id, createdAt: trail[1]!.createdAt });

      await sweep();

      expect((await headOf(fx.a)).prunedThroughSeq).toBe(2n);
      expect((await verify(fx.a)).ok).toBe(true);
    });

    it('still catches a deletion at the front of what retention left behind', async () => {
      // The watermark must license exactly what retention removed and nothing
      // more, or it becomes a place to hide a deletion.
      await seedExpiredTrail(fx.a);
      const trail = await trailOf(fx.a);
      await enableExport(fx.a, { id: trail[0]!.id, createdAt: trail[0]!.createdAt });
      await sweep();

      const left = await trailOf(fx.a);
      await owner.auditLogEntry.delete({ where: { id: left[0]!.id } });

      const result = await verify(fx.a);
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.kind)).toContain('start_mismatch');
      expect(await gapFlag(fx.a)).toBe(true);
    });

    it("one workspace's export does not hold up another's pruning", async () => {
      await seedExpiredTrail(fx.a);
      await seedExpiredTrail(fx.b);
      await enableExport(fx.a, null); // A ships nothing yet, so A keeps everything

      await sweep();

      expect(await owner.auditLogEntry.count({ where: { licenseId: fx.a.licenseId } })).toBe(3);
      expect(await owner.auditLogEntry.count({ where: { licenseId: fx.b.licenseId } })).toBe(1);
    });
  });

  // =========================================================================
  // What leaves the building
  // =========================================================================

  describe('export', () => {
    const recordsOf = (body: string): ExportRecord[] =>
      body
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ExportRecord);

    it('carries each record’s position and hashes inline', async () => {
      for (const n of [1, 2, 3]) await append(fx.a, `entry-${n}`);

      const res = await server.get('/audit-log/export', auth(exportToken));
      expect(res.statusCode).toBe(200);
      const records = recordsOf(res.body);

      expect(records.map((r) => r.chain_seq)).toEqual([1, 2, 3]);
      expect(records[0]?.prev_hash).toBeNull();
      expect(records[1]?.prev_hash).toBe(records[0]?.hash);
      expect(records[2]?.prev_hash).toBe(records[1]?.hash);
      expect(res.headers['x-nexa-export-chain-ok']).toBe('true');
    });

    it('signs the exact bytes it delivered', async () => {
      for (const n of [1, 2]) await append(fx.a, `entry-${n}`);

      const res = await server.get('/audit-log/export', auth(exportToken));
      const signature = res.headers['x-nexa-export-signature'] as string;
      const records = recordsOf(res.body);
      const subject = {
        licenseId: fx.a.licenseId,
        count: records.length,
        firstSeq: BigInt(records[0]!.chain_seq!),
        lastSeq: BigInt(records[records.length - 1]!.chain_seq!),
        body: res.body,
      };

      expect(verifyExportSignature(keyFor(fx.a), subject, signature)).toBe(true);
      // One byte of the file changed, and the seal stops matching. This is the
      // assertion an auditor actually relies on.
      expect(
        verifyExportSignature(
          keyFor(fx.a),
          { ...subject, body: res.body.replace('entry-1', 'entry-X') },
          signature,
        ),
      ).toBe(false);
    });

    it("seals under the caller's own workspace key", async () => {
      // The signature means something only because it names one workspace. If
      // B's key verified A's export, the seal would say nothing about whose
      // trail this is.
      await append(fx.a, 'a1');
      const res = await server.get('/audit-log/export', auth(exportToken));
      const records = recordsOf(res.body);

      expect(
        verifyExportSignature(
          keyFor(fx.b),
          {
            licenseId: fx.b.licenseId,
            count: records.length,
            firstSeq: 1n,
            lastSeq: 1n,
            body: res.body,
          },
          res.headers['x-nexa-export-signature'] as string,
        ),
      ).toBe(false);
    });

    it('marks a damaged page rather than withholding it', async () => {
      // PLAN's open question, resolved: refusing to export a damaged trail
      // converts detected tampering into a silent stop of the feed, which is
      // what the tampering was for. The evidence of damage belongs downstream
      // in the SIEM, where somebody is looking.
      for (const n of [1, 2, 3]) await append(fx.a, `entry-${n}`);
      const trail = await trailOf(fx.a);
      await owner.auditLogEntry.update({
        where: { id: trail[1]!.id },
        data: { target: 'rewritten' },
      });

      const res = await server.get('/audit-log/export', auth(exportToken));
      expect(res.statusCode).toBe(200);
      expect(recordsOf(res.body)).toHaveLength(3);
      expect(res.headers['x-nexa-export-chain-ok']).toBe('false');
    });

    it('signs an empty page too', async () => {
      // A consumer that has caught up still receives a statement, and "nothing
      // happened" is a claim worth being able to check.
      const res = await server.get('/audit-log/export', auth(exportToken));
      expect(res.body).toBe('');
      expect(
        verifyExportSignature(
          keyFor(fx.a),
          { licenseId: fx.a.licenseId, count: 0, firstSeq: null, lastSeq: null, body: '' },
          res.headers['x-nexa-export-signature'] as string,
        ),
      ).toBe(true);
    });

    it('reports the gap on the settings status once the chain is chained', async () => {
      // C6-b left this `null` because nothing could answer it. It answers now.
      await append(fx.a, 'entry-1');
      const before = await server.get('/settings/siem/status', auth(settingsToken));
      expect((before.json() as { chain_gap_detected: boolean | null }).chain_gap_detected).toBe(
        false,
      );

      const trail = await trailOf(fx.a);
      await owner.auditLogEntry.delete({ where: { id: trail[0]!.id } });

      const after = await server.get('/settings/siem/status', auth(settingsToken));
      expect((after.json() as { chain_gap_detected: boolean | null }).chain_gap_detected).toBe(
        true,
      );
    });

    it('chains an entry written through a real request', async () => {
      // End to end rather than through the helper: a request that changes
      // security settings writes an audit entry, and that entry has to join the
      // same chain the export reads.
      const res = await server.patch('/settings/siem', { enabled: true }, auth(settingsToken));
      expect(res.statusCode).toBe(200);

      const trail = await trailOf(fx.a);
      expect(trail).toHaveLength(1);
      expect(trail[0]?.chainSeq).toBe(1n);
      expect((await verify(fx.a)).ok).toBe(true);
    });
  });

  // =========================================================================
  // Regression guard on the id the writer now assigns
  // =========================================================================

  it('gives every entry a distinct id, as the database did before', async () => {
    // The writer generates the uuid now (the hash has to commit to it, and the
    // row cannot be stamped after insert — `audit_log` has no UPDATE grant).
    // Uniqueness moved from the database's default to this code, so it is
    // asserted here.
    for (let i = 0; i < 20; i++) await append(fx.a, `entry-${i}`);
    const ids = (await trailOf(fx.a)).map((r) => r.id);
    expect(new Set(ids).size).toBe(20);
    expect(ids.every((id) => id !== randomUUID())).toBe(true);
  });
});
