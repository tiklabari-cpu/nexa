/**
 * The scheduled SIEM sink (NFR-C6 · C6-d) — the job that actually ships the
 * trail, where `siem-export.test.ts` (C6-b) proves the pull endpoint and
 * `audit-chain.test.ts` (C6-c) proves the chain itself.
 *
 * The property that gives this module its reason to exist is the order
 * invariant in its header: **the file is written and closed, then the cursor
 * advances — a failure between the two must redeliver, never skip.** Every
 * test in the first two groups below is aimed at that one claim from a
 * different angle: a plain failure, a race between two sweeps for the same
 * licence, and the retention rule (`C6-c`) that only holds if the cursor never
 * lies about what actually reached disk.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SiemSink } from '../../src/services/audit/siem-sink.js';
import {
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** Any string works — `deriveChainKey` is plain HMAC, and `parseEnv`'s length
 *  rule for `AUDIT_CHAIN_SECRET` is not in this constructor's path. */
const AUDIT_CHAIN_SECRET = 'siem-sink-integration-test-secret-value';

interface SinkRecord {
  id: string;
  license_id: string;
  action: string;
  created_at: string;
}

describe('SIEM sink (NFR-C6 · C6-d)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let siemDir: string;
  let fx: Fixtures;
  /** Monotonic source of seed timestamps; reset per test. See `seedEntry`. */
  let clock = 0;

  const sink = (options: { horizonMs?: number; dir?: string } = {}) =>
    new SiemSink(appRole, {
      siemDir: options.dir ?? siemDir,
      auditChainSecret: AUDIT_CHAIN_SECRET,
      horizonMs: options.horizonMs ?? 0,
    });

  async function enableSiem(t: TenantFixture): Promise<void> {
    await owner.siemExportCursor.create({
      data: { licenseId: t.licenseId, target: 'file', enabled: true },
    });
  }

  /**
   * Insert an entry straight through the owner connection (bypasses RLS).
   *
   * `createdAt` defaults to a monotonic clock anchored an hour in the past,
   * like `siem-export.test.ts`'s `seedTrail` — never Postgres's own
   * `CURRENT_TIMESTAMP`. The horizon compares against `Date.now()` read in
   * *this* process, and letting the database stamp its own clock leaves the
   * zero-horizon tests hostage to however far the two clocks happen to drift,
   * which is exactly the flake this sidesteps.
   */
  async function seedEntry(
    t: TenantFixture,
    opts: { action?: string; createdAt?: Date } = {},
  ): Promise<string> {
    clock += 1_000;
    const row = await owner.auditLogEntry.create({
      data: {
        licenseId: t.licenseId,
        actorId: t.ownerAccountId,
        actorType: 'agent',
        action: opts.action ?? 'auth.login',
        target: null,
        metadata: {} as Prisma.InputJsonObject,
        createdAt: opts.createdAt ?? new Date(clock),
      },
      select: { id: true },
    });
    return row.id;
  }

  async function ndjsonFiles(t: TenantFixture, dir: string = siemDir): Promise<string[]> {
    try {
      return (await readdir(join(dir, t.licenseId.toString())))
        .filter((n) => n.endsWith('.ndjson'))
        .sort();
    } catch {
      return [];
    }
  }

  async function recordsIn(
    t: TenantFixture,
    file: string,
    dir: string = siemDir,
  ): Promise<SinkRecord[]> {
    const body = await readFile(join(dir, t.licenseId.toString(), file), 'utf8');
    return body
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as SinkRecord);
  }

  const cursorOf = (t: TenantFixture) =>
    owner.siemExportCursor.findFirstOrThrow({ where: { licenseId: t.licenseId } });

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    // The sink refuses to deliver for a plan without `siem_export`
    // (FR-MOD-11.5), so the workspaces it sweeps here hold it. The refusal
    // itself is proved in `entitlements.test.ts`.
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    siemDir = await mkdtemp(join(tmpdir(), 'nexa-siem-'));
    // An hour back, so a seeded entry is comfortably older than any horizon
    // and still leaves room for a test to write something "now" after it.
    clock = Date.now() - 3_600_000;
  });

  afterEach(async () => {
    await rm(siemDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // Delivery, and the cursor it leaves behind
  // ==========================================================================

  it('writes a signed NDJSON file and advances the cursor to the last record', async () => {
    await enableSiem(fx.a);
    const ids = [await seedEntry(fx.a), await seedEntry(fx.a)];

    const report = await sink().run();
    // fx.b never configured an export, so it is the one `skipped` tenant.
    expect(report.totals).toMatchObject({ delivered: 2, empty: 0, skipped: 1, failed: 0 });

    const files = await ndjsonFiles(fx.a);
    expect(files).toHaveLength(1);
    expect((await recordsIn(fx.a, files[0]!)).map((r) => r.id)).toEqual(ids);

    // Detached signature sidecar — the file sink's equivalent of the pull
    // endpoint's `x-nexa-export-signature` header.
    const sig = await readFile(join(siemDir, fx.a.licenseId.toString(), `${files[0]}.sig`), 'utf8');
    expect(sig.length).toBeGreaterThan(0);

    const cursor = await cursorOf(fx.a);
    expect(cursor.lastExportedId).toBe(ids[1]);
    expect(cursor.exportedCount).toBe(2n);
    expect(cursor.lastRunAt).not.toBeNull();
  });

  it('ships nothing twice: a second run of the same trail delivers nothing new', async () => {
    await enableSiem(fx.a);
    await seedEntry(fx.a);
    await sink().run();
    const before = await ndjsonFiles(fx.a);

    const second = await sink().run();
    expect(second.totals).toMatchObject({ delivered: 0, empty: 1 });
    expect(await ndjsonFiles(fx.a)).toEqual(before);

    // Ran, found nothing new: last_run_at moves, the delivery position does not.
    const cursorBefore = await cursorOf(fx.a);
    expect(cursorBefore.lastRunAt).not.toBeNull();
  });

  it('delivers only what arrived since the last run, in its own file', async () => {
    await enableSiem(fx.a);
    await seedEntry(fx.a);
    await sink().run();

    const second = await seedEntry(fx.a);
    const report = await sink().run();
    expect(report.totals.delivered).toBe(1);

    const files = await ndjsonFiles(fx.a);
    expect(files).toHaveLength(2);
    expect((await recordsIn(fx.a, files[1]!)).map((r) => r.id)).toEqual([second]);
  });

  // ==========================================================================
  // Skip vs. deliver
  // ==========================================================================

  it('skips a workspace that has never configured a SIEM export', async () => {
    await seedEntry(fx.a);
    const report = await sink().run();

    const mine = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
    expect(mine).toMatchObject({ status: 'skipped', delivered: 0, target: null });
    expect(await ndjsonFiles(fx.a)).toEqual([]);
    expect(await owner.siemExportCursor.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
  });

  it('skips a disabled export and never sets last_run_at for it', async () => {
    await owner.siemExportCursor.create({
      data: { licenseId: fx.a.licenseId, target: 'file', enabled: false },
    });
    await seedEntry(fx.a);

    const report = await sink().run();
    const mine = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
    expect(mine?.status).toBe('skipped');

    const cursor = await cursorOf(fx.a);
    expect(cursor.lastRunAt).toBeNull();
    expect(await ndjsonFiles(fx.a)).toEqual([]);
  });

  it('holds back an entry too recent for the horizon, without marking it delivered', async () => {
    await enableSiem(fx.a);
    // A genuinely fresh timestamp, not the monotonic clock `seedEntry` anchors
    // an hour back for every other test — the horizon has nothing to hold
    // back otherwise.
    await seedEntry(fx.a, { createdAt: new Date() });

    const report = await sink({ horizonMs: 60_000 }).run();
    expect(report.totals).toMatchObject({ delivered: 0, empty: 1 });
    expect(await ndjsonFiles(fx.a)).toEqual([]);

    const cursor = await cursorOf(fx.a);
    expect(cursor.lastExportedId).toBeNull();
  });

  // ==========================================================================
  // The order invariant: write-then-advance, crash means redeliver not skip
  // ==========================================================================

  it('leaves the cursor untouched when the write fails, and redelivers next run', async () => {
    await enableSiem(fx.a);
    const ids = [await seedEntry(fx.a), await seedEntry(fx.a)];

    // Block the sink's own per-licence directory with a plain file, so the
    // `mkdir` inside the write step fails deterministically — no mocking of
    // fs internals required to force a mid-delivery failure.
    const conflict = join(siemDir, fx.a.licenseId.toString());
    await writeFile(conflict, 'not a directory', 'utf8');

    const failed = await sink().run();
    const mine = failed.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
    expect(mine?.status).toBe('failed');
    expect(mine?.error).toBeTruthy();

    // The whole per-licence transaction rolled back: no partial position.
    const cursorAfterFailure = await cursorOf(fx.a);
    expect(cursorAfterFailure.lastExportedId).toBeNull();
    expect(cursorAfterFailure.lastRunAt).toBeNull();

    await rm(conflict, { force: true });
    const recovered = await sink().run();
    expect(recovered.totals).toMatchObject({ delivered: 2, failed: 0 });

    // Rewrite, not a resumed partial: both rows land in the one file the
    // successful run produces.
    const files = await ndjsonFiles(fx.a);
    expect(files).toHaveLength(1);
    expect((await recordsIn(fx.a, files[0]!)).map((r) => r.id)).toEqual(ids);
  });

  it('never skips a row when two sweeps race for the same licence', async () => {
    await enableSiem(fx.a);
    const ids = [
      await seedEntry(fx.a),
      await seedEntry(fx.a),
      await seedEntry(fx.a),
      await seedEntry(fx.a),
      await seedEntry(fx.a),
    ];

    // Concurrent, not sequential: the advisory lock — not a prior read — has
    // to be what decides who delivers what.
    const [first, second] = await Promise.all([sink().run(), sink().run()]);
    expect(first.totals.delivered + second.totals.delivered).toBe(5);

    const files = await ndjsonFiles(fx.a);
    const seen = (await Promise.all(files.map((f) => recordsIn(fx.a, f)))).flat().map((r) => r.id);

    // Every row delivered by exactly one of the two sweeps: nothing skipped,
    // nothing duplicated (the loser blocks until the winner's cursor has
    // already moved, so it sees an empty backlog rather than a stale one).
    expect(seen.sort()).toEqual([...ids].sort());
    expect(new Set(seen).size).toBe(5);

    const cursor = await cursorOf(fx.a);
    expect(cursor.exportedCount).toBe(5n);
  });

  // ==========================================================================
  // Retention (C6-c) only holds if this job never lies about the position
  // ==========================================================================

  it('lets retention prune what was delivered, and refuses what was not', async () => {
    await enableSiem(fx.a);
    const old = new Date(Date.now() - 40 * 24 * 3_600_000);
    const delivered = await seedEntry(fx.a, { createdAt: old });
    await sink().run();

    // A second, undelivered entry — also old enough to be "expired" by age,
    // but ahead of the cursor.
    const pending = await seedEntry(fx.a, { createdAt: new Date(old.getTime() + 1_000) });

    const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000);
    const pruneRows = await appRole.$queryRaw<
      Array<{ audit_prune_expired: bigint }>
    >`SELECT audit_prune_expired(${fx.a.licenseId}, ${cutoff})`;
    expect(pruneRows[0]?.audit_prune_expired).toBe(1n);

    const remaining = await owner.auditLogEntry.findMany({ where: { licenseId: fx.a.licenseId } });
    expect(remaining.map((r) => r.id)).toEqual([pending]);
    expect(remaining.map((r) => r.id)).not.toContain(delivered);
  });

  // ==========================================================================
  // Tenant isolation
  // ==========================================================================

  it("never writes one workspace's entries into another's file", async () => {
    await enableSiem(fx.a);
    await enableSiem(fx.b);
    const mine = [await seedEntry(fx.a)];
    const theirs = [await seedEntry(fx.b)];

    const report = await sink().run();
    expect(report.totals.delivered).toBe(2);

    const filesA = await ndjsonFiles(fx.a);
    const filesB = await ndjsonFiles(fx.b);
    expect((await recordsIn(fx.a, filesA[0]!)).map((r) => r.id)).toEqual(mine);
    expect((await recordsIn(fx.b, filesB[0]!)).map((r) => r.id)).toEqual(theirs);

    for (const record of await recordsIn(fx.a, filesA[0]!)) {
      expect(record.license_id).toBe(fx.a.licenseId.toString());
    }
  });

  it("a write failure for one licence does not stop another's delivery", async () => {
    await enableSiem(fx.a);
    await enableSiem(fx.b);
    await seedEntry(fx.a);
    await seedEntry(fx.b);

    await writeFile(join(siemDir, fx.a.licenseId.toString()), 'not a directory', 'utf8');

    const report = await sink().run();
    expect(report.totals).toMatchObject({ delivered: 1, failed: 1 });
    expect(await ndjsonFiles(fx.b)).toHaveLength(1);
  });

  // ==========================================================================
  // The operator script (siem:run)
  // ==========================================================================

  describe('siem:run script', () => {
    const run = promisify(execFile);
    // test/integration → test → api → apps → repo root.
    const repoRoot = resolve(import.meta.dirname, '../../../..');
    let scriptSiemDir: string;

    async function runScript(
      envOverrides: Record<string, string> = {},
    ): Promise<{ stdout: string; stderr: string }> {
      return run('pnpm', ['--filter', '@nexa/api', 'run', 'siem:run'], {
        cwd: repoRoot,
        env: { ...process.env, SIEM_DIR: scriptSiemDir, ...envOverrides },
        // See scheduled-reports-sweep.test.ts: pnpm is a shell shim on this
        // platform, so a shell is required for CreateProcess to find it.
        shell: true,
        maxBuffer: 4 * 1024 * 1024,
      });
    }

    beforeEach(async () => {
      scriptSiemDir = await mkdtemp(join(tmpdir(), 'nexa-siem-run-'));
    });

    afterEach(async () => {
      await rm(scriptSiemDir, { recursive: true, force: true });
    });

    it('delivers the pending trail and reports it on stdout/stderr', async () => {
      await enableSiem(fx.a);
      await seedEntry(fx.a);

      const { stdout, stderr } = await runScript({ SIEM_EXPORT_HORIZON_MS: '0' });
      const report = JSON.parse(stdout) as { totals: { delivered: number; failed: number } };
      expect(report.totals).toMatchObject({ delivered: 1, failed: 0 });
      expect(stderr).toContain('delivered 1');

      const files = await ndjsonFiles(fx.a, scriptSiemDir);
      expect(files).toHaveLength(1);
    }, 30_000);

    it('delivers once across two consecutive triggers', async () => {
      await enableSiem(fx.a);
      await seedEntry(fx.a);

      const first = JSON.parse((await runScript({ SIEM_EXPORT_HORIZON_MS: '0' })).stdout) as {
        totals: { delivered: number };
      };
      const second = JSON.parse((await runScript({ SIEM_EXPORT_HORIZON_MS: '0' })).stdout) as {
        totals: { delivered: number; empty: number };
      };

      expect(first.totals.delivered).toBe(1);
      expect(second.totals).toMatchObject({ delivered: 0, empty: 1 });
      expect(await ndjsonFiles(fx.a, scriptSiemDir)).toHaveLength(1);
    }, 30_000);

    it('exits with a non-zero code and writes nothing when the database is unreachable', async () => {
      await expect(
        runScript({ DATABASE_APP_URL: 'postgresql://nexa_app:wrong@127.0.0.1:1/nexa_unreachable' }),
      ).rejects.toMatchObject({ code: 1 });
      expect(await ndjsonFiles(fx.a, scriptSiemDir)).toEqual([]);
    }, 30_000);
  });
});
