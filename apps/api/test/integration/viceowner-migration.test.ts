/**
 * The vice owner retires (tm 324.3 · RL-01 · owner decision K6): migration
 * `20261022200000_viceowner_to_admin`, and the boot pass that signs the audit
 * entries it leaves (`services/audit/pending-audit.ts`).
 *
 * The migration runs once, on whatever memberships a deployment has when it is
 * applied — which, for a test database migrated empty, is none. So the move is
 * replayed here the way `prisma migrate deploy` runs it: the statement read out
 * of the migration file, as the table owner, against vice owners seeded for
 * the purpose. What is under test is that file's text, not a copy of it.
 *
 * Three promises, and the order matters because the change cannot be undone:
 *
 *   - every vice owner becomes an admin, and nobody else moves;
 *   - every move leaves exactly one `member.role_changed` entry, `via:
 *     'migration'`, inside the workspace's tamper-evident chain — not beside it,
 *     where the verifier would call it tampering;
 *   - the moved member loses nothing an admin has, and gains no rank over one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { deriveCodeChallenge, generateToken } from '../../src/lib/crypto.js';
import { withTenant } from '../../src/lib/tenant.js';
import {
  deriveChainKey,
  verifyAuditChain,
  type VerifiableRow,
} from '../../src/services/audit/audit-chain.js';
import { writeAuditEntry } from '../../src/services/audit/audit-log.js';
import { signPendingAuditEntries } from '../../src/services/audit/pending-audit.js';
import {
  grantToken,
  ownerClient,
  seedDefaultBrand,
  seedFixtures,
  TEST_PASSWORD,
  testEnv,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

const MIGRATION = '20261022200000_viceowner_to_admin';
const APP_URL = process.env['DATABASE_APP_URL'];
const CHAIN_SECRET = testEnv().AUDIT_CHAIN_SECRET;

/** The migration's data statement — everything from the move to the end of the file. */
function moveStatement(): string {
  const sql = readFileSync(
    join(process.cwd(), 'prisma', 'migrations', MIGRATION, 'migration.sql'),
    'utf8',
  )
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
  const start = sql.indexOf('WITH moved AS');
  expect(start).toBeGreaterThan(0);
  return sql.slice(start).trim().replace(/;$/, '');
}

interface PendingRow {
  license_id: bigint;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
}

describe('vice owner → admin (RL-01 · K6 · tm 324.3)', () => {
  let owner: PrismaClient;
  let appRole: PrismaClient;
  let fx: Fixtures;

  const ctx = (t: TenantFixture) => ({ licenseId: t.licenseId, organizationId: t.organizationId });

  /** Run the move as `prisma migrate deploy` does: the table owner, one statement. */
  const runMove = () => owner.$executeRawUnsafe(moveStatement());

  const sign = (db: PrismaClient = appRole) =>
    signPendingAuditEntries(db, { chainSecret: CHAIN_SECRET });

  const pending = () =>
    owner.$queryRaw<PendingRow[]>`
      SELECT license_id, action, target, metadata FROM pending_audit_entries ORDER BY id`;

  const roleOf = async (t: TenantFixture, agentId: string) =>
    (
      await owner.agentMembership.findUniqueOrThrow({
        where: { licenseId_agentId: { licenseId: t.licenseId, agentId } },
      })
    ).role;

  let seq = 0;
  async function member(t: TenantFixture, role: string, passwordHash?: string | null) {
    const email = `${role}-${(seq += 1)}-${t.licenseId}@example.test`;
    const account = await owner.account.create({
      data: { email, name: role, ...(passwordHash ? { passwordHash } : {}) },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: { licenseId: t.licenseId, agentId: account.id, role },
    });
    return { id: account.id, email };
  }

  /** The workspace's trail in chain order, shaped for the verifier. */
  const trailOf = (t: TenantFixture): Promise<VerifiableRow[]> =>
    owner.auditLogEntry.findMany({
      where: { licenseId: t.licenseId },
      orderBy: [{ chainSeq: 'asc' }],
    });

  async function verify(t: TenantFixture) {
    const head = await owner.auditChainHead.findUniqueOrThrow({
      where: { licenseId: t.licenseId },
    });
    return verifyAuditChain(await trailOf(t), {
      key: deriveChainKey(CHAIN_SECRET, t.licenseId),
      prunedThroughSeq: head.prunedThroughSeq ?? 0n,
      genesisAt: head.genesisAt,
    });
  }

  /** An entry written before the deploy, so each chain has a genesis to be measured against. */
  const priorEntry = (t: TenantFixture) =>
    withTenant(appRole, ctx(t), (tx) =>
      writeAuditEntry(
        tx,
        { licenseId: t.licenseId, chainSecret: CHAIN_SECRET },
        { action: 'settings.security_updated', target: 'settings:security' },
      ),
    );

  const roleEntries = (t: TenantFixture) =>
    owner.auditLogEntry.findMany({
      where: { licenseId: t.licenseId, action: 'member.role_changed' },
      orderBy: [{ chainSeq: 'asc' }],
    });

  beforeAll(() => {
    owner = ownerClient();
    appRole = new PrismaClient({ datasourceUrl: APP_URL });
  });

  afterAll(async () => {
    await appRole.$disconnect();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
  });

  // ==========================================================================
  // The migration
  // ==========================================================================

  describe('the move', () => {
    it('moves every vice owner to admin in every workspace, and nobody else (FR-MOD-04.RBAC)', async () => {
      const viceA1 = await member(fx.a, 'viceowner');
      const viceA2 = await member(fx.a, 'viceowner');
      const viceB = await member(fx.b, 'viceowner');
      const admin = await member(fx.a, 'admin');
      const lead = await member(fx.a, 'team_lead');

      expect(await runMove()).toBe(3);

      for (const [t, id] of [
        [fx.a, viceA1.id],
        [fx.a, viceA2.id],
        [fx.b, viceB.id],
        [fx.a, admin.id],
      ] as const) {
        expect(await roleOf(t, id)).toBe('admin');
      }
      expect(await roleOf(fx.a, lead.id)).toBe('team_lead');
      expect(await roleOf(fx.a, fx.a.ownerAccountId)).toBe('owner');
      expect(await roleOf(fx.a, fx.a.agentAccountId)).toBe('agent');
      expect(await roleOf(fx.b, fx.b.ownerAccountId)).toBe('owner');
      expect(await owner.agentMembership.count({ where: { role: 'viceowner' } })).toBe(0);
    });

    it('records one pending role-change entry per move, in the statement that moves it (NFR-S12)', async () => {
      // One statement is the atomicity claim: no commit can hold a moved role
      // without its entry, or an entry for a role that did not move.
      const move = moveStatement();
      expect(move).not.toContain(';');
      expect(move).toMatch(/^WITH moved AS \(\s*UPDATE agent_memberships\b/);

      const viceA = await member(fx.a, 'viceowner');
      const viceB = await member(fx.b, 'viceowner');
      await member(fx.a, 'admin');

      await runMove();

      const rows = await pending();
      expect(rows).toHaveLength(2);
      const expected = (t: TenantFixture, id: string) => ({
        license_id: t.licenseId,
        action: 'member.role_changed',
        target: `account:${id}`,
        metadata: { from: 'viceowner', to: 'admin', via: 'migration', migration: MIGRATION },
      });
      expect(rows).toEqual(
        expect.arrayContaining([expected(fx.a, viceA.id), expected(fx.b, viceB.id)]),
      );
    });

    it('moves nothing and records nothing a second time', async () => {
      await member(fx.a, 'viceowner');
      expect(await runMove()).toBe(1);
      expect(await runMove()).toBe(0);
      expect(await pending()).toHaveLength(1);
    });
  });

  // ==========================================================================
  // Signing the entries into the chain
  // ==========================================================================

  describe('signing', () => {
    it('signs each move into the workspace chain once — system actor, via migration — and the chain verifies (NFR-S12 · NFR-C6)', async () => {
      await priorEntry(fx.a);
      await priorEntry(fx.b);
      const viceA1 = await member(fx.a, 'viceowner');
      const viceA2 = await member(fx.a, 'viceowner');
      const viceB = await member(fx.b, 'viceowner');
      const before = new Date();
      await runMove();

      expect(await sign()).toEqual({ tenants: 2, signed: 3, failed: [] });

      const entriesA = await roleEntries(fx.a);
      const entriesB = await roleEntries(fx.b);
      expect(entriesA.map((e) => e.target).sort()).toEqual(
        [`account:${viceA1.id}`, `account:${viceA2.id}`].sort(),
      );
      expect(entriesB.map((e) => e.target)).toEqual([`account:${viceB.id}`]);
      for (const entry of [...entriesA, ...entriesB]) {
        expect(entry).toMatchObject({ actorType: 'system', actorId: null });
        expect(entry.chainSeq).not.toBeNull();
        expect(entry.hash).not.toBeNull();
        const metadata = entry.metadata as Record<string, unknown>;
        expect(metadata).toMatchObject({
          from: 'viceowner',
          to: 'admin',
          via: 'migration',
          migration: MIGRATION,
        });
        // When the role moved, which the entry's own timestamp (when it was
        // signed) does not say.
        const occurredAt = new Date(String(metadata['occurred_at']));
        expect(occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 5_000);
        // Host and database clocks may differ by a little.
        expect(occurredAt.getTime()).toBeLessThanOrEqual(entry.createdAt.getTime() + 5_000);
      }

      for (const t of [fx.a, fx.b]) {
        const result = await verify(t);
        expect(result.findings).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.checked).toBe(t === fx.a ? 3 : 2);
      }
      expect(await pending()).toHaveLength(0);

      // Nothing is signed twice.
      expect(await sign()).toEqual({ tenants: 0, signed: 0, failed: [] });
      expect(await roleEntries(fx.a)).toHaveLength(2);
    });

    it('is why the migration does not write the log itself: an entry it inserted would read as tampering (NFR-C6)', async () => {
      await priorEntry(fx.a);
      await owner.auditLogEntry.create({
        data: {
          licenseId: fx.a.licenseId,
          actorType: 'system',
          action: 'member.role_changed',
          target: 'account:00000000-0000-4000-8000-000000000000',
          metadata: { from: 'viceowner', to: 'admin', via: 'migration' },
        },
      });

      const result = await verify(fx.a);
      expect(result.ok).toBe(false);
      expect(result.findings.map((f) => f.kind)).toEqual(['unchained_entry']);
    });

    it('signs each entry exactly once when two passes race', async () => {
      await priorEntry(fx.a);
      const vices = [];
      for (let i = 0; i < 6; i += 1) vices.push(await member(fx.a, 'viceowner'));
      await runMove();

      // Separate connections, so the two passes are two transactions in flight.
      const second = new PrismaClient({ datasourceUrl: APP_URL });
      try {
        await second.$connect();
        await appRole.$connect();
        const [one, two] = await Promise.all([
          signPendingAuditEntries(appRole, { chainSecret: CHAIN_SECRET, batchSize: 2 }),
          signPendingAuditEntries(second, { chainSecret: CHAIN_SECRET, batchSize: 2 }),
        ]);
        expect(one.failed).toEqual([]);
        expect(two.failed).toEqual([]);
        expect(one.signed + two.signed).toBe(6);
      } finally {
        await second.$disconnect();
      }

      const targets = (await roleEntries(fx.a)).map((e) => e.target).sort();
      expect(targets).toEqual(vices.map((v) => `account:${v.id}`).sort());
      expect((await verify(fx.a)).findings).toEqual([]);
      expect(await pending()).toHaveLength(0);
    });

    it("keeps a workspace's entries pending when one cannot be signed, without holding back the others", async () => {
      const viceA = await member(fx.a, 'viceowner');
      await member(fx.b, 'viceowner');
      await runMove();
      // A row naming an action this release does not know — written as the
      // owner, the only role that can insert one.
      await owner.$executeRaw`
        INSERT INTO pending_audit_entries (license_id, action, target)
        VALUES (${fx.b.licenseId}, 'member.not_an_action', 'account:x')`;

      const report = await sign();
      expect(report.tenants).toBe(2);
      expect(report.signed).toBe(1);
      expect(report.failed.map((f) => f.licenseId)).toEqual([fx.b.licenseId]);
      expect(String(report.failed[0]?.error)).toMatch(/unknown action "member\.not_an_action"/);

      expect((await roleEntries(fx.a)).map((e) => e.target)).toEqual([`account:${viceA.id}`]);
      // B's batch rolled back whole: its valid entry is still waiting with the
      // bad one, and B's trail holds nothing from this pass.
      expect(await roleEntries(fx.b)).toHaveLength(0);
      expect((await pending()).map((r) => r.license_id)).toEqual([fx.b.licenseId, fx.b.licenseId]);
    });

    it("lets the application read and delete only its own workspace's entries, and never write one", async () => {
      await member(fx.a, 'viceowner');
      await member(fx.b, 'viceowner');
      await runMove();

      const seen = await withTenant(
        appRole,
        ctx(fx.a),
        (tx) =>
          tx.$queryRaw<Array<{ license_id: bigint }>>`SELECT license_id FROM pending_audit_entries`,
      );
      expect(seen.map((r) => r.license_id)).toEqual([fx.a.licenseId]);

      await expect(
        withTenant(
          appRole,
          ctx(fx.a),
          (tx) =>
            tx.$executeRaw`
            INSERT INTO pending_audit_entries (license_id, action)
            VALUES (${fx.a.licenseId}, 'member.role_changed')`,
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withTenant(
          appRole,
          ctx(fx.a),
          (tx) => tx.$executeRaw`UPDATE pending_audit_entries SET target = 'account:forged'`,
        ),
      ).rejects.toThrow(/permission denied/);

      const [fn] = await owner.$queryRaw<
        Array<{
          definer: boolean;
          config: string[] | null;
          public_exec: boolean;
          app_exec: boolean;
        }>
      >`
        SELECT p.prosecdef AS definer,
               p.proconfig AS config,
               has_function_privilege('public', p.oid, 'EXECUTE') AS public_exec,
               has_function_privilege('siyahtus_app', p.oid, 'EXECUTE') AS app_exec
          FROM pg_proc p
         WHERE p.proname = 'pending_audit_tenants'`;
      expect(fn).toEqual({
        definer: true,
        config: ['search_path=public, pg_temp'],
        public_exec: false,
        app_exec: true,
      });
    });
  });

  // ==========================================================================
  // Boot, and the moved member afterwards
  // ==========================================================================

  describe('on a running server', () => {
    let server: TestServer | null = null;

    afterAll(async () => {
      await server?.close();
    });

    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

    it('signs the pending entries at boot, before the server is ready (NFR-S12)', async () => {
      await priorEntry(fx.a);
      const vice = await member(fx.a, 'viceowner');
      await runMove();

      server = await startTestServer();

      expect(await pending()).toHaveLength(0);
      expect((await roleEntries(fx.a)).map((e) => e.target)).toEqual([`account:${vice.id}`]);
      expect((await verify(fx.a)).findings).toEqual([]);
    });

    it("keeps the moved member's open session an admin's, and puts them within an admin's reach (FR-MOD-04.RBAC)", async () => {
      server ??= await startTestServer();
      await clearRateLimits(server.app);
      await seedDefaultBrand(owner, fx.a.licenseId);
      const { passwordHash } = await owner.account.findUniqueOrThrow({
        where: { id: fx.a.ownerAccountId },
        select: { passwordHash: true },
      });
      const vice = await member(fx.a, 'viceowner', passwordHash);
      const admin = await member(fx.a, 'admin');
      const adminToken = await grantToken(owner, {
        licenseId: fx.a.licenseId,
        organizationId: fx.a.organizationId,
        ownerId: admin.id,
        scopes: ['agents--all:rw'],
      });

      // The vice owner signs in before the deploy.
      const verifier = generateToken(48).slice(0, 64);
      const authorized = await server.post('/auth/authorize', {
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
        code_challenge: deriveCodeChallenge(verifier),
        email: vice.email,
        password: TEST_PASSWORD,
        license_id: fx.a.licenseId.toString(),
      });
      expect(authorized.statusCode).toBe(200);
      const granted = await server.post('/auth/token', {
        grant_type: 'authorization_code',
        code: authorized.json().code,
        code_verifier: verifier,
        client_id: fx.a.clientId,
        redirect_uri: fx.a.redirectUri,
      });
      expect(granted.statusCode).toBe(200);
      const session = (granted.json() as { access_token: string }).access_token;

      // Before: ranked above the admin, who cannot touch them.
      expect(
        (await server.put(`/agents/${vice.id}/role`, { role: 'agent' }, bearer(adminToken)))
          .statusCode,
      ).toBe(403);

      await runMove();

      // The same session still opens the admin surface: nothing to reissue.
      const me = await server.get('/auth/me', bearer(session));
      expect(me.statusCode).toBe(200);
      expect((me.json() as { scopes: string[] }).scopes).toContain('access_rules:rw');
      expect(
        (
          await server.patch(
            '/settings/security',
            { ip_allowlist_enforced: false },
            bearer(session),
          )
        ).statusCode,
      ).toBe(200);

      // After: peers. The admin may now move them.
      const moved = await server.put(
        `/agents/${vice.id}/role`,
        { role: 'agent' },
        bearer(adminToken),
      );
      expect(moved.statusCode).toBe(200);
      expect(await roleOf(fx.a, vice.id)).toBe('agent');
    });
  });
});
