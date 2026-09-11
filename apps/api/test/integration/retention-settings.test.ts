/**
 * Per-workspace retention windows (NFR-C8).
 *
 * PRD §7 NFR-C8's own word is *yapılandırılabilir* — 30/60/365/unlimited. Until
 * tm 241 the windows came only from `RETENTION_*_DAYS`, which made them a
 * property of the deployment: every workspace on one installation aged its
 * conversations out on the same schedule. The test that proves the gap is
 * actually closed is not "the setting round-trips" — a column would pass that
 * while nothing read it. It is **two workspaces, two windows, one sweep**: the
 * one that chose the shorter window is pruned and the one that did not is
 * untouched, in the same run, under RLS.
 *
 * The rest of the file is the four things that could go wrong around it:
 *
 *   1. "Unlimited" is a *deletion switched off*, not a zero-day window — which
 *      is the direction the guard in `cutoffFor` points, and getting it
 *      backwards would delete everything the setting was chosen to protect.
 *   2. The HIPAA ceiling still outranks the workspace's choice (NFR-C4 · C4-e),
 *      and a choice above it is refused at the write rather than silently
 *      clamped at the sweep.
 *   3. The sweep is unchanged for a workspace that has chosen nothing — the
 *      deployment default is a fallback, not a thing that stopped working.
 *   4. Cross-tenant: one workspace cannot read or write another's window.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { RetentionPolicy } from '../../src/services/retention/policy.js';
import { RetentionRunner } from '../../src/services/retention/retention.js';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  seedSubscription,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const APP_URL = process.env['DATABASE_APP_URL'];

/** The deployment default the fixtures inherit when they choose nothing. */
const POLICY: RetentionPolicy = { threadDays: 365, visitDays: 90, mailDays: 30, auditDays: 30 };
const DAY = 86_400_000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY);

interface RetentionBody {
  thread_window: string | null;
  visit_window: string | null;
  default_thread_days: number;
  default_visit_days: number;
  effective_thread_days: number | null;
  effective_visit_days: number | null;
  max_thread_days: number | null;
  max_visit_days: number | null;
  hipaa_scope: boolean;
}

describe('per-workspace retention windows (NFR-C8)', () => {
  /** The European deployment — where fixture tenants A and B live. */
  let server: TestServer;
  /**
   * The same build configured as the US deployment. A workspace can only be
   * inside HIPAA scope when its organization is `us` (C4-d enforces that at the
   * database), and the region edge answers 421 to a `us` workspace reaching the
   * European build — so the ceiling cannot be tested through `server`.
   */
  let usServer: TestServer;
  let owner: PrismaClient;
  /** The RLS-bound role the sweep actually runs as — never the owner. */
  let appRole: PrismaClient;
  let fx: Fixtures;
  let seq = 0;

  beforeAll(async () => {
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
    server = await startTestServer();
    usServer = await startTestServer({ NEXA_REGION: 'us' });
  });

  afterAll(async () => {
    await Promise.all([server.close(), usServer.close()]);
    await Promise.all([owner.$disconnect(), appRole.$disconnect()]);
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    seq = 0;
    await clearRateLimits(server.app);
    await clearRateLimits(usServer.app);
  });

  const runner = (): RetentionRunner =>
    new RetentionRunner(appRole, {
      policy: POLICY,
      mailDir: '.data/does-not-exist',
      auditChainSecret: testEnv().AUDIT_CHAIN_SECRET,
    });

  /** Seeded as the owner so a scenario can plant rows with any timestamp. */
  async function seedClosedThread(t: TenantFixture, closedAt: Date): Promise<string> {
    seq += 1;
    const chatId = `c${String(seq).padStart(11, '0')}`;
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: t.licenseId,
        customerId: t.customerId,
        active: false,
        createdAt: closedAt,
        lastEventAt: closedAt,
      },
    });
    const thread = await owner.thread.create({
      data: {
        id: `t${String(seq).padStart(11, '0')}`,
        chatId,
        licenseId: t.licenseId,
        active: false,
        createdAt: closedAt,
        closedAt,
      },
      select: { id: true },
    });
    return thread.id;
  }

  const threadExists = (id: string): Promise<boolean> =>
    owner.thread.findUnique({ where: { id }, select: { id: true } }).then((row) => row !== null);

  const adminToken = (t: TenantFixture, scopes = ['access_rules:ro', 'access_rules:rw']) =>
    grantToken(owner, {
      licenseId: t.licenseId,
      organizationId: t.organizationId,
      ownerId: t.ownerAccountId,
      scopes,
    });

  const read = async (token: string, target: TestServer = server): Promise<RetentionBody> => {
    const response = await target.get('/settings/retention', { authorization: `Bearer ${token}` });
    expect(response.statusCode).toBe(200);
    return response.json() as RetentionBody;
  };

  // ==========================================================================
  // The measure: two workspaces, two windows, one sweep
  // ==========================================================================

  describe('the window is a property of the workspace, not of the deployment', () => {
    it('prunes the workspace that chose 30 days and leaves the one that chose nothing', async () => {
      // One thread each, identical age: old enough for a 30-day window, young
      // enough for the 365-day deployment default. The age is therefore NOT
      // what separates them — the setting is, which is the whole claim.
      const inA = await seedClosedThread(fx.a, daysAgo(100));
      const inB = await seedClosedThread(fx.b, daysAgo(100));

      const tokenA = await adminToken(fx.a);
      const patched = await server.patch(
        '/settings/retention',
        { thread_window: '30d' },
        { authorization: `Bearer ${tokenA}` },
      );
      expect(patched.statusCode).toBe(200);
      expect((patched.json() as RetentionBody).effective_thread_days).toBe(30);

      const report = await runner().run({ dryRun: false });

      expect(await threadExists(inA)).toBe(false);
      expect(await threadExists(inB)).toBe(true);

      // And the report says so per tenant, so an operator reading it can tell
      // which policy each workspace was swept under rather than assuming one.
      const a = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
      const b = report.tenants.find((t) => t.licenseId === fx.b.licenseId.toString());
      expect(a?.policy.threadDays).toBe(30);
      expect(b?.policy.threadDays).toBe(365);
      expect(a?.threads).toBe(1);
      expect(b?.threads).toBe(0);
    });

    it('records the chosen window in the sweep’s own audit entry', async () => {
      // "Why did this conversation disappear a year early" has to be answerable
      // from the trail. The effective number alone cannot distinguish "the
      // workspace chose 30" from "a ceiling cut it to 30", so the chosen tier
      // is recorded beside it.
      await seedClosedThread(fx.a, daysAgo(100));
      const token = await adminToken(fx.a);
      await server.patch(
        '/settings/retention',
        { thread_window: '30d' },
        { authorization: `Bearer ${token}` },
      );

      await runner().run({ dryRun: false });

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'data.retention_pruned' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.metadata).toMatchObject({
        thread_days: 30,
        thread_window: '30d',
        hipaa_scope: false,
      });
    });

    it('is visible to a dry-run too — counting under the same policy it would apply', async () => {
      await seedClosedThread(fx.a, daysAgo(100));
      const token = await adminToken(fx.a);
      await server.patch(
        '/settings/retention',
        { thread_window: '60d' },
        { authorization: `Bearer ${token}` },
      );

      const report = await runner().run({ dryRun: true });

      const a = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());
      expect(a?.threads).toBe(1);
      expect(a?.policy.threadDays).toBe(60);
      // A dry-run writes nothing — not even for a workspace whose window it
      // just read.
      expect(
        await owner.auditLogEntry.count({
          where: { licenseId: fx.a.licenseId, action: 'data.retention_pruned' },
        }),
      ).toBe(0);
    });
  });

  // ==========================================================================
  // "Unlimited" is deletion OFF, not a zero-day window
  // ==========================================================================

  describe('"unlimited" switches the sweep off for that class', () => {
    it('keeps a thread the deployment default would have pruned', async () => {
      // 400 days: past the 365-day default, so without the setting this row is
      // gone. The assertion is that choosing "unlimited" *saves* it — the
      // opposite of what a `0`-encoded unlimited would have done.
      const kept = await seedClosedThread(fx.a, daysAgo(400));
      const swept = await seedClosedThread(fx.b, daysAgo(400));

      const token = await adminToken(fx.a);
      const patched = await server.patch(
        '/settings/retention',
        { thread_window: 'unlimited' },
        { authorization: `Bearer ${token}` },
      );
      expect(patched.statusCode).toBe(200);
      expect((patched.json() as RetentionBody).effective_thread_days).toBeNull();

      await runner().run({ dryRun: false });

      expect(await threadExists(kept)).toBe(true);
      expect(await threadExists(swept)).toBe(false);
    });

    it('does not switch off the OTHER classes, or the audit window', async () => {
      // The failure this guards: an "unlimited" that leaked into a shared
      // cutoff, or a branch that skipped the whole tenant instead of one class.
      const thread = await seedClosedThread(fx.a, daysAgo(400));
      await owner.visit.create({
        data: {
          licenseId: fx.a.licenseId,
          customerId: fx.a.customerId,
          startedAt: daysAgo(400),
        },
      });

      const token = await adminToken(fx.a);
      await server.patch(
        '/settings/retention',
        { thread_window: 'unlimited' },
        { authorization: `Bearer ${token}` },
      );

      const report = await runner().run({ dryRun: false });
      const a = report.tenants.find((t) => t.licenseId === fx.a.licenseId.toString());

      expect(await threadExists(thread)).toBe(true);
      expect(a?.threads).toBe(0);
      // Telemetry still ages out on the 90-day default.
      expect(a?.visits).toBe(1);
      expect(await owner.visit.count({ where: { licenseId: fx.a.licenseId } })).toBe(0);
    });

    it('never stores "unlimited" as a day count', async () => {
      // Read at the column, not through the API: the whole design turns on the
      // off state not being a number, and a serialiser could hide a 0 behind a
      // friendly response.
      const token = await adminToken(fx.a);
      await server.patch(
        '/settings/retention',
        { thread_window: 'unlimited' },
        { authorization: `Bearer ${token}` },
      );

      const row = await owner.license.findUnique({
        where: { id: fx.a.licenseId },
        select: { retentionThreadWindow: true },
      });
      expect(row?.retentionThreadWindow).toBe('unlimited');
      expect(Number(row?.retentionThreadWindow)).toBeNaN();
    });

    it('the database refuses a window outside the four tiers', async () => {
      // The route is not the only way in. A migration, a psql session or a
      // future service are all call sites, so the vocabulary is a CHECK.
      await expect(
        owner.$executeRaw`UPDATE licenses SET retention_thread_window = '90d' WHERE id = ${fx.a.licenseId}`,
      ).rejects.toThrow(/licenses_retention_thread_window_check/);
      await expect(
        owner.$executeRaw`UPDATE licenses SET retention_visit_window = '0' WHERE id = ${fx.a.licenseId}`,
      ).rejects.toThrow(/licenses_retention_visit_window_check/);
    });
  });

  // ==========================================================================
  // "No choice" and "unlimited" are different states
  // ==========================================================================

  describe('clearing a choice returns the window to the deployment default', () => {
    it('an explicit null restores the default; an absent key leaves the other window alone', async () => {
      const token = await adminToken(fx.a);
      await server.patch(
        '/settings/retention',
        { thread_window: '30d', visit_window: '60d' },
        { authorization: `Bearer ${token}` },
      );

      const cleared = await server.patch(
        '/settings/retention',
        { thread_window: null },
        { authorization: `Bearer ${token}` },
      );

      expect(cleared.statusCode).toBe(200);
      const body = cleared.json() as RetentionBody;
      expect(body.thread_window).toBeNull();
      expect(body.effective_thread_days).toBe(POLICY.threadDays);
      // The other window is untouched — the failure an `undefined`/`null`
      // collapse would cause: saving one window silently resets the other.
      expect(body.visit_window).toBe('60d');
      expect(body.effective_visit_days).toBe(60);
    });

    it('an empty body is a 400 rather than an audit entry for nothing', async () => {
      const token = await adminToken(fx.a);
      const response = await server.patch(
        '/settings/retention',
        {},
        { authorization: `Bearer ${token}` },
      );

      expect(response.statusCode).toBe(400);
      expect(
        await owner.auditLogEntry.count({
          where: { licenseId: fx.a.licenseId, action: 'settings.security_updated' },
        }),
      ).toBe(0);
    });

    it('refuses a tier the catalogue does not name', async () => {
      const token = await adminToken(fx.a);
      const response = await server.patch(
        '/settings/retention',
        { thread_window: '90d' },
        { authorization: `Bearer ${token}` },
      );

      expect(response.statusCode).toBe(400);
    });
  });

  // ==========================================================================
  // The default is still the default
  // ==========================================================================

  describe('a workspace that has chosen nothing', () => {
    it('reads as inheriting, and is swept exactly as before', async () => {
      const token = await adminToken(fx.a);
      const body = await read(token);

      expect(body.thread_window).toBeNull();
      expect(body.visit_window).toBeNull();
      expect(body.default_thread_days).toBe(POLICY.threadDays);
      expect(body.default_visit_days).toBe(POLICY.visitDays);
      expect(body.effective_thread_days).toBe(POLICY.threadDays);
      expect(body.effective_visit_days).toBe(POLICY.visitDays);
      expect(body.max_thread_days).toBeNull();
      expect(body.hipaa_scope).toBe(false);

      const recent = await seedClosedThread(fx.a, daysAgo(100));
      const expired = await seedClosedThread(fx.a, daysAgo(400));
      await runner().run({ dryRun: false });

      expect(await threadExists(recent)).toBe(true);
      expect(await threadExists(expired)).toBe(false);
    });

    it('writes settings.security_updated with the resource and the fields touched', async () => {
      const token = await adminToken(fx.a);
      await server.patch(
        '/settings/retention',
        { visit_window: '30d' },
        { authorization: `Bearer ${token}` },
      );

      const entries = await owner.auditLogEntry.findMany({
        where: { licenseId: fx.a.licenseId, action: 'settings.security_updated' },
      });
      expect(entries).toHaveLength(1);
      expect(entries[0]?.target).toBe(`retention:${fx.a.licenseId}`);
      expect(entries[0]?.metadata).toMatchObject({
        resource: 'retention',
        fields: ['visit_window'],
        visit_window: '30d',
      });
    });
  });

  // ==========================================================================
  // The HIPAA ceiling is still the last word (NFR-C4 · C4-e)
  // ==========================================================================

  describe('a workspace under HIPAA scope', () => {
    /**
     * A real `us` workspace on Enterprise with a signed BAA.
     *
     * Built directly rather than through the BAA endpoint: the fact under test
     * here is what the *ceiling* does to a retention choice, not whether the
     * agreement can be accepted, which is `compliance-baa.test.ts`'s claim.
     * Reached through `usServer`, because the region edge answers 421 to a `us`
     * workspace on the European build.
     */
    async function seedCoveredTenant(): Promise<{ licenseId: bigint; token: string }> {
      const organization = await owner.organization.create({
        data: { name: 'Org covered', region: 'us' },
        select: { id: true },
      });
      const license = await owner.license.create({
        data: {
          organizationId: organization.id,
          plan: 'enterprise',
          status: 'active',
          hipaaBaaSignedAt: new Date(),
        },
        select: { id: true },
      });
      await seedSubscription(owner, license.id, 'enterprise');
      const account = await owner.account.create({
        data: { email: `owner-covered-${Date.now()}@example.test`, name: 'Owner covered' },
        select: { id: true },
      });
      await owner.agentMembership.create({
        data: { licenseId: license.id, agentId: account.id, role: 'owner' },
      });
      const token = await grantToken(owner, {
        licenseId: license.id,
        organizationId: organization.id,
        ownerId: account.id,
        scopes: ['access_rules:ro', 'access_rules:rw'],
      });
      return { licenseId: license.id, token };
    }

    it('reports the ceiling so the screen can offer only what is allowed', async () => {
      const covered = await seedCoveredTenant();

      const body = await read(covered.token, usServer);

      expect(body.hipaa_scope).toBe(true);
      expect(body.max_thread_days).toBe(365);
      expect(body.max_visit_days).toBe(90);
    });

    it('refuses "unlimited" outright — indefinite retention of PHI is what a BAA prevents', async () => {
      const covered = await seedCoveredTenant();

      const response = await usServer.patch(
        '/settings/retention',
        { thread_window: 'unlimited' },
        { authorization: `Bearer ${covered.token}` },
      );

      expect(response.statusCode).toBe(403);
      const error = response.json() as { error: { details?: Record<string, unknown> } };
      expect(error.error.details).toMatchObject({ reason: 'hipaa_ceiling', max_days: 365 });
      // The row is UNCHANGED — a refusal that still wrote would be the defect.
      const row = await owner.license.findUnique({
        where: { id: covered.licenseId },
        select: { retentionThreadWindow: true },
      });
      expect(row?.retentionThreadWindow).toBeNull();
    });

    it('refuses a finite window above the ceiling, and names the ceiling', async () => {
      const covered = await seedCoveredTenant();

      // 365 days of telemetry is under the conversation ceiling but four times
      // the telemetry one — so a per-field ceiling is what has to be enforced,
      // not one number for the whole row.
      const response = await usServer.patch(
        '/settings/retention',
        { visit_window: '365d' },
        { authorization: `Bearer ${covered.token}` },
      );

      expect(response.statusCode).toBe(403);
      expect(
        (response.json() as { error: { details?: Record<string, unknown> } }).error.details,
      ).toMatchObject({ reason: 'hipaa_ceiling', field: 'visitDays', max_days: 90 });
    });

    it('accepts a window at or below the ceiling — the rule is a maximum, not a schedule', async () => {
      const covered = await seedCoveredTenant();

      const response = await usServer.patch(
        '/settings/retention',
        { thread_window: '365d', visit_window: '30d' },
        { authorization: `Bearer ${covered.token}` },
      );

      expect(response.statusCode).toBe(200);
      const body = response.json() as RetentionBody;
      expect(body.effective_thread_days).toBe(365);
      expect(body.effective_visit_days).toBe(30);
    });

    it('the sweep clamps a stale "unlimited" rather than aborting the whole run', async () => {
      // The sequence the write gate cannot catch: the workspace chose unlimited
      // first and signed the BAA afterwards. Throwing here would leave every
      // OTHER workspace in the deployment unswept.
      const covered = await seedCoveredTenant();
      await owner.license.update({
        where: { id: covered.licenseId },
        data: { retentionThreadWindow: 'unlimited' },
      });
      const otherTenantThread = await seedClosedThread(fx.a, daysAgo(400));

      const report = await runner().run({ dryRun: false });

      const entry = report.tenants.find((t) => t.licenseId === covered.licenseId.toString());
      expect(entry?.hipaaScope).toBe(true);
      expect(entry?.policy.threadDays).toBe(365);
      // The run completed and the unrelated workspace was still swept.
      expect(await threadExists(otherTenantThread)).toBe(false);
    });
  });

  // ==========================================================================
  // Isolation (NFR-S4 / NFR-S5) and authority
  // ==========================================================================

  describe('one workspace cannot see or set another’s window', () => {
    it('a token for B reads B’s own setting, never A’s', async () => {
      const tokenA = await adminToken(fx.a);
      await server.patch(
        '/settings/retention',
        { thread_window: '30d' },
        { authorization: `Bearer ${tokenA}` },
      );

      const tokenB = await adminToken(fx.b);
      const body = await read(tokenB);

      expect(body.thread_window).toBeNull();
      expect(body.effective_thread_days).toBe(POLICY.threadDays);

      // And writing as B leaves A's row alone.
      await server.patch(
        '/settings/retention',
        { thread_window: 'unlimited' },
        { authorization: `Bearer ${tokenB}` },
      );
      const rowA = await owner.license.findUnique({
        where: { id: fx.a.licenseId },
        select: { retentionThreadWindow: true },
      });
      expect(rowA?.retentionThreadWindow).toBe('30d');
    });

    it('a read-only scope cannot write the window', async () => {
      const token = await adminToken(fx.a, ['access_rules:ro']);

      const response = await server.patch(
        '/settings/retention',
        { thread_window: '30d' },
        { authorization: `Bearer ${token}` },
      );

      expect(response.statusCode).toBe(403);
      const row = await owner.license.findUnique({
        where: { id: fx.a.licenseId },
        select: { retentionThreadWindow: true },
      });
      expect(row?.retentionThreadWindow).toBeNull();
    });

    it('an agent-role credential is refused even holding the scope', async () => {
      // `minimumRole: 'admin'`, the gate every workspace-level surface carries:
      // a broad PAT minted by an agent-role account does not become admin
      // authority (tm 146).
      const token = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: fx.a.agentAccountId,
        scopes: ['access_rules:rw'],
      });

      expect(
        (await server.get('/settings/retention', { authorization: `Bearer ${token}` })).statusCode,
      ).toBe(403);
      expect(
        (
          await server.patch(
            '/settings/retention',
            { thread_window: '30d' },
            { authorization: `Bearer ${token}` },
          )
        ).statusCode,
      ).toBe(403);
    });

    it('is unreachable without a credential', async () => {
      expect((await server.get('/settings/retention')).statusCode).toBe(401);
    });
  });
});
