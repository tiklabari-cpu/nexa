/**
 * The provider seams, from the setting to the effect (M-PROV-a · §D113/K3).
 *
 * The unit tests next to each factory prove `createMailer('file', …)` writes a
 * file. None of them can prove the thing the finding was actually about: that
 * the *running server* picks its providers from those keys. `server.ts` used to
 * default them off `NODE_ENV` — `NullMailer` under test, `FileMailer` otherwise
 * — so `MAIL_PROVIDER` was validated at boot and then never read, and a factory
 * could have been added beside that branch without changing a thing.
 *
 * Hence a suite that boots the real server with nothing but an env override and
 * then looks on disk. The first case below fails against the pre-seam code by
 * construction: `NODE_ENV` is `test` here, so the old branch would hand back a
 * `NullMailer` no matter what `MAIL_PROVIDER` said, and the spool would be empty.
 *
 * The SIEM cases are the same claim one layer down — the sink was given a
 * destination rather than a directory, so `SIEM_PROVIDER` chooses where a
 * workspace's trail goes — and they also pin the loud failure the seam has to
 * keep: a workspace whose stored target this build cannot deliver to is reported
 * `failed` with its cursor untouched, never quietly shipped nowhere.
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SiemSink, type SiemSinkDelivery } from '../../src/services/audit/siem-sink.js';
import type { SiemBatch, SiemTarget } from '../../src/services/audit/siem-target.js';
import { ownerClient, seedFixtures, type Fixtures } from '../helpers/fixtures.js';
import { startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];
const AUDIT_CHAIN_SECRET = 'provider-selection-integration-test-secret';

/** Records what it was handed instead of writing it. */
function recordingTarget(name: string): SiemTarget & { seen: SiemBatch[] } {
  const seen: SiemBatch[] = [];
  return {
    name,
    seen,
    async deliver(batch: SiemBatch): Promise<string> {
      seen.push(batch);
      return `recorded://${seen.length}`;
    },
  };
}

describe('provider selection (M-PROV-a)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;
  let dir: string;

  beforeAll(async () => {
    if (!APP_URL) throw new Error('DATABASE_APP_URL must be set');
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    // Enterprise, because the sink refuses a plan without `siem_export`
    // (FR-MOD-11.5) — that refusal is `entitlements.test.ts`'s to prove.
    fx = await seedFixtures(owner, { plan: 'enterprise' });
    dir = await mkdtemp(join(tmpdir(), 'nexa-provider-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  describe('MAIL_PROVIDER', () => {
    /**
     * Password reset is the cheapest route that sends mail without a token: it
     * is public, and it mails only an address that really exists — the property
     * `account-lifecycle.test.ts` owns. Here it is only the trigger.
     */
    const requestReset = (server: TestServer) =>
      server.post('/auth/password-reset', { email: fx.a.ownerEmail });

    it('spools the message when the key says "file", under NODE_ENV=test', async () => {
      const server = await startTestServer({ MAIL_PROVIDER: 'file', MAIL_DIR: dir });
      try {
        expect((await requestReset(server)).statusCode).toBe(202);
        const written = await readdir(dir);
        expect(written).toHaveLength(1);
        expect(written[0]).toContain('password_reset');
      } finally {
        await server.close();
      }
    });

    it('keeps nothing when the key says "null" — the fixture default', async () => {
      // No provider override: `testEnv` names `null` for every suite, which is
      // what the `NODE_ENV` branch used to do implicitly. Same outcome, said
      // out loud, and now overridable by the test above.
      const server = await startTestServer({ MAIL_DIR: dir });
      try {
        expect((await requestReset(server)).statusCode).toBe(202);
        await expect(readdir(dir)).resolves.toEqual([]);
      } finally {
        await server.close();
      }
    });
  });

  describe('SIEM_PROVIDER', () => {
    async function enableSiem(): Promise<void> {
      await owner.siemExportCursor.create({
        data: { licenseId: fx.a.licenseId, target: 'file', enabled: true },
      });
      await owner.auditLogEntry.create({
        data: {
          licenseId: fx.a.licenseId,
          actorId: fx.a.ownerAccountId,
          actorType: 'agent',
          action: 'auth.login',
          target: null,
          metadata: {} as Prisma.InputJsonObject,
          // An hour back, so no horizon can exclude it.
          createdAt: new Date(Date.now() - 3_600_000),
        },
      });
    }

    const sink = (target: SiemTarget) =>
      new SiemSink(appRole, {
        siemDir: dir,
        target,
        auditChainSecret: AUDIT_CHAIN_SECRET,
        horizonMs: 0,
      });

    const mine = (tenants: SiemSinkDelivery[]): SiemSinkDelivery | undefined =>
      tenants.find((t) => t.licenseId === fx.a.licenseId.toString());

    it('delivers through the target it was given, and reports its locator', async () => {
      await enableSiem();

      // A recording stand-in rather than the file target: this is the assertion
      // the seam exists for — the sink no longer knows *how* delivery happens,
      // so a build with a real destination would ship there without the sink
      // changing. The locator it hands back is what lands in the report.
      const target = recordingTarget('file');
      const report = await sink(target).run();

      expect(mine(report.tenants)?.status).toBe('delivered');
      expect(mine(report.tenants)?.file).toBe('recorded://1');
      expect(target.seen).toHaveLength(1);
      expect(target.seen[0]!.licenseId).toBe(fx.a.licenseId);
      expect(target.seen[0]!.body).toContain('auth.login');
      expect(target.seen[0]!.signature.length).toBeGreaterThan(0);
      // Nothing on disk: the file target was never involved, which is the whole
      // point — a passing assertion here with an empty `dir` proves the sink
      // stopped writing the file itself.
      await expect(readdir(dir)).resolves.toEqual([]);
    });

    it('refuses to deliver a workspace target this build has no implementation for', async () => {
      // The reachable half of the mismatch: the row says `file` (the only value
      // the `siem_export_cursors_target_check` constraint allows), while this
      // deployment was built against something else. Shipping nowhere quietly
      // is the failure that costs a workspace its trail with nobody noticing,
      // so it is reported `failed` — and the cursor does not move, which is
      // what keeps `audit_prune_expired` off the range that is still owed.
      await enableSiem();

      const target = recordingTarget('splunk');
      const report = await sink(target).run();

      expect(mine(report.tenants)?.status).toBe('failed');
      expect(mine(report.tenants)?.error).toContain(
        'no delivery implementation for SIEM target "file"',
      );
      expect(target.seen).toHaveLength(0);

      const cursor = await owner.siemExportCursor.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(cursor.lastExportedId).toBeNull();
      expect(cursor.lastRunAt).toBeNull();
    });
  });
});
