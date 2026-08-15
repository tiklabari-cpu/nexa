/**
 * SIEM export (NFR-C6 · C6-b) — the trail's way out.
 *
 * The properties worth testing here are the ones that cannot be asserted on a
 * handler, because they live in Postgres and in the passage of time:
 *
 *   - **Nothing is ever skipped.** The one failure this feature must not have.
 *     A duplicate in a SIEM is noise; a gap is a missing security event that
 *     nothing downstream can tell apart from a quiet period. Three separate
 *     tests attack it: replaying a cursor, writing between pages, and the
 *     horizon that keeps an in-flight transaction from landing behind the
 *     cursor.
 *   - **One tenant only.** RLS, not a clause in the reader.
 *   - **Two gates, on a scope the reading surface does not imply.** An admin
 *     holding `audit_log--all:ro` and nothing else must be refused here.
 *   - **The configuration row's own invariants** — target vocabulary, cursor
 *     halves, no DELETE — enforced by the database rather than by whoever
 *     writes the next caller.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  type Fixtures,
  type TenantFixture,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';

interface ExportRecord {
  id: string;
  license_id: string;
  action: string;
  actor_type: string;
  target: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

describe('SIEM export', () => {
  let owner: PrismaClient;
  /** Horizon off: seeded entries are exportable the instant they exist. */
  let server: TestServer;
  /** Horizon on, wide enough that a freshly written entry is held back. */
  let lagged: TestServer;
  let fx: Fixtures;

  // Owner (≥ admin) holding the export scope — the happy path.
  let exportToken: string;
  // Owner holding only the *reading* scope — isolates the scope separation.
  let readOnlyToken: string;
  // Agent role holding the export scope — isolates the role gate.
  let agentToken: string;
  // Owner holding the security-settings scopes, for /settings/siem.
  let settingsToken: string;
  let settingsReadToken: string;
  let agentSettingsToken: string;
  /** Monotonic source of seed timestamps; reset per test. See `seedTrail`. */
  let clock = 0;

  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const errorType = (res: { json: () => unknown }) =>
    (res.json() as { error: { type: string } }).error.type;

  /** Parse an NDJSON body into records, asserting the framing as it goes. */
  function recordsOf(body: string): ExportRecord[] {
    if (body === '') return [];
    expect(body.endsWith('\n'), 'every line must be terminated, the last one too').toBe(true);
    return body
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as ExportRecord);
  }

  /** Insert an entry straight through the owner connection (bypasses RLS). */
  async function seedEntry(
    tenant: TenantFixture,
    opts: { action?: string; target?: string | null; createdAt?: Date } = {},
  ): Promise<string> {
    const row = await owner.auditLogEntry.create({
      data: {
        licenseId: tenant.licenseId,
        actorId: tenant.ownerAccountId,
        actorType: 'agent',
        action: opts.action ?? 'auth.login',
        target: opts.target ?? null,
        metadata: {} as Prisma.InputJsonObject,
        ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
      },
      select: { id: true },
    });
    return row.id;
  }

  /**
   * A trail of `count` entries, one second apart, oldest first.
   *
   * Timestamps come from a clock that only moves forward across every call in a
   * test, so a second trail genuinely follows the first rather than interleaving
   * with it. Two trails sharing a base would make "written between pages" and
   * "another workspace's entries are newer" assert something other than what
   * they say.
   */
  async function seedTrail(tenant: TenantFixture, count: number, prefix = 'e'): Promise<string[]> {
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      clock += 1_000;
      ids.push(
        await seedEntry(tenant, {
          action: 'settings.security_updated',
          target: `${prefix}${i}`,
          createdAt: new Date(clock),
        }),
      );
    }
    return ids;
  }

  /** A real admin-role principal (fixtures ship only owner + agent). */
  async function createAdmin(tenant: TenantFixture): Promise<string> {
    const account = await owner.account.create({
      data: {
        email: `siem-admin-${tenant.licenseId}@example.test`,
        name: 'Admin',
        passwordHash: null,
      },
      select: { id: true },
    });
    await owner.agentMembership.create({
      data: {
        licenseId: tenant.licenseId,
        agentId: account.id,
        role: 'admin',
        routingStatus: 'accepting_chats',
      },
    });
    return account.id;
  }

  beforeAll(async () => {
    owner = ownerClient();
    // Zero horizon everywhere except the one suite that tests the horizon: a
    // test writes and exports in the same millisecond, and nothing else is
    // writing, so the concurrency the horizon guards against cannot occur.
    server = await startTestServer({ SIEM_EXPORT_HORIZON_MS: '0' });
    lagged = await startTestServer({ SIEM_EXPORT_HORIZON_MS: '60000' });
  });

  afterAll(async () => {
    await server.close();
    await lagged.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(server.app);
    await clearRateLimits(lagged.app);
    // An hour back, so a seeded trail is comfortably older than any horizon and
    // still leaves room for a test to write something "now" after it.
    clock = Date.now() - 3_600_000;

    const grant = (ownerId: string, scopes: string[], tenant: TenantFixture = fx.a) =>
      grantToken(owner, {
        licenseId: tenant.licenseId,
        organizationId: tenant.organizationId,
        ownerId,
        scopes,
      });

    exportToken = await grant(fx.a.ownerAccountId, ['audit_log--export:ro']);
    readOnlyToken = await grant(fx.a.ownerAccountId, ['audit_log--all:ro']);
    agentToken = await grant(fx.a.agentAccountId, ['audit_log--export:ro']);
    settingsToken = await grant(fx.a.ownerAccountId, ['access_rules:rw']);
    settingsReadToken = await grant(await createAdmin(fx.a), ['access_rules:ro']);
    agentSettingsToken = await grant(fx.a.agentAccountId, ['access_rules:rw']);
  });

  // =========================================================================
  // Rejections first — this is a security surface
  // =========================================================================

  describe('gates', () => {
    it('refuses an unauthenticated caller with 401', async () => {
      const res = await server.get('/audit-log/export');
      expect(res.statusCode).toBe(401);
    });

    it('refuses a token holding only the reading scope', async () => {
      // The whole point of the separation: `audit_log--all:ro` pages a screen,
      // it does not stream the trail into somewhere else. If this ever passes,
      // every dashboard integration ever granted the reading scope has silently
      // acquired the firehose.
      await seedTrail(fx.a, 2);
      const res = await server.get('/audit-log/export', auth(readOnlyToken));
      expect(res.statusCode).toBe(403);
      expect(errorType(res)).toBe('authorization');
    });

    it('refuses an agent holding the export scope (role gate)', async () => {
      await seedTrail(fx.a, 2);
      const res = await server.get('/audit-log/export', auth(agentToken));
      expect(res.statusCode).toBe(403);
      expect(errorType(res)).toBe('authorization');
    });

    it('refuses a cursor it cannot read, rather than guessing', async () => {
      await seedTrail(fx.a, 2);
      const res = await server.get('/audit-log/export?page_id=garbage', auth(exportToken));
      expect(res.statusCode).toBe(400);
      expect(errorType(res)).toBe('validation');
    });

    it("refuses the read surface's cursor, which runs the other way", async () => {
      await seedTrail(fx.a, 3);
      const list = await server.get('/audit-log?limit=1', auth(readOnlyToken));
      const listCursor = (list.json() as { next_page_id: string }).next_page_id;
      expect(listCursor).toBeTruthy();

      // Taken at face value this would mean "after entry X" instead of "before
      // entry X" — the export would skip the entire history before X and look
      // perfectly healthy doing it.
      const res = await server.get(
        `/audit-log/export?page_id=${encodeURIComponent(listCursor)}`,
        auth(exportToken),
      );
      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // The stream itself
  // =========================================================================

  describe('NDJSON stream', () => {
    it('returns one complete JSON object per line, oldest first', async () => {
      const ids = await seedTrail(fx.a, 3);

      const res = await server.get('/audit-log/export', auth(exportToken));
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/x-ndjson; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['x-content-type-options']).toBe('nosniff');

      const records = recordsOf(res.body);
      expect(records.map((r) => r.id)).toEqual(ids);
      expect(res.headers['x-nexa-export-count']).toBe('3');
      expect(res.headers['x-nexa-export-has-more']).toBe('false');
      expect(res.headers['x-nexa-export-cursor']).toBeTruthy();
    });

    it('carries the workspace id on every record', async () => {
      await seedTrail(fx.a, 2);
      const res = await server.get('/audit-log/export', auth(exportToken));
      for (const record of recordsOf(res.body)) {
        expect(record.license_id).toBe(fx.a.licenseId.toString());
      }
    });

    it('answers an empty trail with an empty body, not a blank line', async () => {
      const res = await server.get('/audit-log/export', auth(exportToken));
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('');
      expect(res.headers['x-nexa-export-count']).toBe('0');
      expect(res.headers['x-nexa-export-has-more']).toBe('false');
    });

    it('clamps an over-large limit rather than refusing it', async () => {
      await seedTrail(fx.a, 2);
      const res = await server.get('/audit-log/export?limit=999999', auth(exportToken));
      expect(res.statusCode).toBe(200);
      expect(recordsOf(res.body)).toHaveLength(2);
    });

    it('rejects a nonsense limit', async () => {
      for (const limit of ['0', '-5', 'many']) {
        const res = await server.get(`/audit-log/export?limit=${limit}`, auth(exportToken));
        expect(res.statusCode, limit).toBe(400);
      }
    });
  });

  // =========================================================================
  // The cursor: advances, replays, never skips
  // =========================================================================

  describe('cursor', () => {
    it('advances through the trail without overlap or gap', async () => {
      const ids = await seedTrail(fx.a, 5);

      const seen: string[] = [];
      let cursor = '';
      for (let page = 0; page < 3; page++) {
        const url = cursor
          ? `/audit-log/export?limit=2&page_id=${encodeURIComponent(cursor)}`
          : '/audit-log/export?limit=2';
        const res = await server.get(url, auth(exportToken));
        expect(res.statusCode).toBe(200);
        seen.push(...recordsOf(res.body).map((r) => r.id));
        cursor = res.headers['x-nexa-export-cursor'] as string;
        expect(res.headers['x-nexa-export-has-more']).toBe(page < 2 ? 'true' : 'false');
      }

      // Every entry exactly once, in order.
      expect(seen).toEqual(ids);
      expect(new Set(seen).size).toBe(seen.length);
    });

    it('returns the same records when the same cursor is replayed', async () => {
      // At-least-once delivery: a consumer that crashed after reading but
      // before committing its cursor re-reads and loses nothing.
      await seedTrail(fx.a, 4);

      const first = await server.get('/audit-log/export?limit=2', auth(exportToken));
      const cursor = first.headers['x-nexa-export-cursor'] as string;

      const url = `/audit-log/export?limit=2&page_id=${encodeURIComponent(cursor)}`;
      const second = await server.get(url, auth(exportToken));
      const replay = await server.get(url, auth(exportToken));

      expect(recordsOf(replay.body).map((r) => r.id)).toEqual(
        recordsOf(second.body).map((r) => r.id),
      );
      expect(replay.body).toBe(second.body);
    });

    it('keeps its position when a page comes back empty', async () => {
      // A feed that has caught up still has a position. Forgetting it would
      // re-deliver the workspace's entire retained trail on the next poll.
      const ids = await seedTrail(fx.a, 2);

      const drained = await server.get('/audit-log/export', auth(exportToken));
      const cursor = drained.headers['x-nexa-export-cursor'] as string;

      const empty = await server.get(
        `/audit-log/export?page_id=${encodeURIComponent(cursor)}`,
        auth(exportToken),
      );
      expect(empty.body).toBe('');
      expect(empty.headers['x-nexa-export-cursor']).toBe(cursor);

      // And that position still works: a later entry arrives, nothing before it
      // is re-sent.
      const later = await seedEntry(fx.a, { action: 'auth.login', target: 'later' });
      const resumed = await server.get(
        `/audit-log/export?page_id=${encodeURIComponent(cursor)}`,
        auth(exportToken),
      );
      expect(recordsOf(resumed.body).map((r) => r.id)).toEqual([later]);
      expect(ids).not.toContain(later);
    });

    it('picks up entries written between pages', async () => {
      // The classic offset-pagination failure: the table grows underneath the
      // reader and rows fall through the seam. Keyset does not have it, and
      // this is where that is proved rather than asserted.
      const early = await seedTrail(fx.a, 2, 'early');

      const first = await server.get('/audit-log/export?limit=2', auth(exportToken));
      const cursor = first.headers['x-nexa-export-cursor'] as string;
      expect(recordsOf(first.body).map((r) => r.id)).toEqual(early);

      const late = await seedTrail(fx.a, 2, 'late');
      const second = await server.get(
        `/audit-log/export?page_id=${encodeURIComponent(cursor)}`,
        auth(exportToken),
      );
      expect(recordsOf(second.body).map((r) => r.id)).toEqual(late);
    });

    it('breaks ties between entries sharing a timestamp', async () => {
      // Bulk writes land many entries on one `CURRENT_TIMESTAMP`. A cursor
      // carrying only the timestamp would either re-send or skip every one of
      // them; the id is the tiebreak that makes the order total.
      const sameInstant = new Date(Date.now() - 60_000);
      const ids: string[] = [];
      for (let i = 0; i < 4; i++) {
        ids.push(await seedEntry(fx.a, { target: `tie${i}`, createdAt: sameInstant }));
      }

      const seen: string[] = [];
      let cursor = '';
      for (let page = 0; page < 4; page++) {
        const url = cursor
          ? `/audit-log/export?limit=1&page_id=${encodeURIComponent(cursor)}`
          : '/audit-log/export?limit=1';
        const res = await server.get(url, auth(exportToken));
        seen.push(...recordsOf(res.body).map((r) => r.id));
        cursor = res.headers['x-nexa-export-cursor'] as string;
      }

      expect(seen.sort()).toEqual([...ids].sort());
      expect(new Set(seen).size).toBe(4);
    });
  });

  // =========================================================================
  // The horizon — the reason a row cannot land behind the cursor
  // =========================================================================

  describe('horizon', () => {
    it('holds back an entry too recent to be safe, and releases it once it settles', async () => {
      // An entry's `created_at` is fixed when its transaction *starts*, so a
      // transaction still in flight can commit a row behind a cursor that has
      // already moved past it — lost, not delayed, because the cursor only goes
      // forward. Reading only up to `now - horizon` is what prevents it.
      const settled = await seedEntry(fx.a, {
        target: 'settled',
        createdAt: new Date(Date.now() - 120_000),
      });
      const fresh = await seedEntry(fx.a, { target: 'fresh' });

      const held = await lagged.get('/audit-log/export', auth(exportToken));
      expect(held.statusCode).toBe(200);
      expect(recordsOf(held.body).map((r) => r.id)).toEqual([settled]);

      // The same entry, once it is older than the horizon, is exported — the
      // horizon delays, it does not drop.
      await owner.auditLogEntry.update({
        where: { id: fresh },
        data: { createdAt: new Date(Date.now() - 90_000) },
      });
      const released = await lagged.get('/audit-log/export', auth(exportToken));
      expect(recordsOf(released.body).map((r) => r.id)).toEqual([settled, fresh]);
    });

    it('reports a held-back entry as pending, not as caught up', async () => {
      await seedEntry(fx.a, { target: 'fresh' });
      const res = await lagged.get('/settings/siem/status', auth(settingsToken));
      // Below the horizon there is nothing to deliver yet, and the screen must
      // not report a backlog that is merely unsettled.
      expect((res.json() as { pending_count: number }).pending_count).toBe(0);
    });
  });

  // =========================================================================
  // Tenant isolation
  // =========================================================================

  describe('tenant isolation', () => {
    it("never exports another workspace's entries", async () => {
      const mine = await seedTrail(fx.a, 2, 'mine');
      // B's entries are newer, so a broken filter would put them at the end of
      // A's stream rather than nowhere — the failure that looks like data.
      await seedTrail(fx.b, 3, 'theirs');

      const res = await server.get('/audit-log/export?limit=5000', auth(exportToken));
      const records = recordsOf(res.body);
      expect(records.map((r) => r.id)).toEqual(mine);
      for (const record of records) {
        expect(record.license_id).toBe(fx.a.licenseId.toString());
      }
    });

    it("never counts another workspace's entries as pending", async () => {
      await seedTrail(fx.b, 4, 'theirs');
      const res = await server.get('/settings/siem/status', auth(settingsToken));
      expect((res.json() as { pending_count: number }).pending_count).toBe(0);
    });
  });

  // =========================================================================
  // Configuration: /settings/siem
  // =========================================================================

  describe('configuration', () => {
    it('reads as off with no destination before it is ever configured', async () => {
      const res = await server.get('/settings/siem', auth(settingsToken));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: false, target: null });

      // Reading created nothing.
      expect(await owner.siemExportCursor.count()).toBe(0);
    });

    it('creates the configuration on first write and takes the default target', async () => {
      const res = await server.patch('/settings/siem', { enabled: true }, auth(settingsToken));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ enabled: true, target: 'file' });

      const rows = await owner.siemExportCursor.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.licenseId).toBe(fx.a.licenseId);
      expect(rows[0]?.lastExportedId).toBeNull();
      expect(rows[0]?.exportedCount).toBe(0n);
    });

    it('records the change in the audit trail', async () => {
      await server.patch('/settings/siem', { enabled: true }, auth(settingsToken));

      const entry = await owner.auditLogEntry.findFirst({
        where: { licenseId: fx.a.licenseId, action: 'settings.security_updated' },
        orderBy: { createdAt: 'desc' },
      });
      expect(entry?.target).toBe('siem_export:file');
      expect(entry?.metadata).toMatchObject({
        resource: 'siem_export',
        operation: 'updated',
        fields: ['enabled'],
        target: 'file',
        enabled: true,
      });
    });

    it('refuses a destination nothing can deliver to', async () => {
      const res = await server.patch('/settings/siem', { target: 'splunk' }, auth(settingsToken));
      expect(res.statusCode).toBe(400);
      expect(await owner.siemExportCursor.count()).toBe(0);
    });

    it('refuses an empty change, which would audit a change nobody made', async () => {
      const res = await server.patch('/settings/siem', {}, auth(settingsToken));
      expect(res.statusCode).toBe(400);
    });

    it('lets an admin read it but not an ordinary agent', async () => {
      expect((await server.get('/settings/siem', auth(settingsReadToken))).statusCode).toBe(200);

      const agent = await server.patch(
        '/settings/siem',
        { enabled: true },
        auth(agentSettingsToken),
      );
      expect(agent.statusCode).toBe(403);
      expect(errorType(agent)).toBe('authorization');
    });

    it('refuses a read-only scope on the write', async () => {
      const res = await server.patch('/settings/siem', { enabled: true }, auth(settingsReadToken));
      expect(res.statusCode).toBe(403);
    });

    it('keeps the delivery position when the feed is switched off and on', async () => {
      // The invariant behind having no delete: disabling must not lose the
      // position, or re-enabling either re-sends the retained trail or starts
      // at "now" and loses everything written while it was off.
      await server.patch('/settings/siem', { enabled: true }, auth(settingsToken));
      const position = { id: (await seedTrail(fx.a, 1))[0]!, at: new Date(Date.now() - 30_000) };
      await owner.siemExportCursor.updateMany({
        where: { licenseId: fx.a.licenseId },
        data: { lastExportedId: position.id, lastExportedAt: position.at, exportedCount: 7n },
      });

      await server.patch('/settings/siem', { enabled: false }, auth(settingsToken));
      await server.patch('/settings/siem', { enabled: true }, auth(settingsToken));

      const row = await owner.siemExportCursor.findFirstOrThrow({
        where: { licenseId: fx.a.licenseId },
      });
      expect(row.lastExportedId).toBe(position.id);
      expect(row.exportedCount).toBe(7n);
    });

    it("never shows another workspace's configuration", async () => {
      await owner.siemExportCursor.create({
        data: { licenseId: fx.b.licenseId, target: 'file', enabled: true },
      });
      const res = await server.get('/settings/siem', auth(settingsToken));
      expect(res.json()).toEqual({ enabled: false, target: null });
    });
  });

  // =========================================================================
  // Status: /settings/siem/status
  // =========================================================================

  describe('status', () => {
    it('reports a never-run export honestly', async () => {
      await seedTrail(fx.a, 3);
      const res = await server.get('/settings/siem/status', auth(settingsToken));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        enabled: false,
        target: null,
        last_run_at: null,
        last_exported_at: null,
        exported_count: 0,
        // Nothing delivered, so the whole trail is waiting.
        pending_count: 3,
        // Seeded entries are written straight to the table, so this workspace
        // has no chain yet. Not `false`: a log with no chain cannot
        // demonstrate its own completeness, and "no gaps detected" from a
        // system that cannot detect gaps is exactly the false assurance the
        // control prevents. Chained workspaces get a real answer — see
        // `audit-chain.test.ts`.
        chain_gap_detected: null,
      });
    });

    it('counts only what is behind the stored position', async () => {
      const ids = await seedTrail(fx.a, 4);
      const third = await owner.auditLogEntry.findUniqueOrThrow({ where: { id: ids[2]! } });
      await owner.siemExportCursor.create({
        data: {
          licenseId: fx.a.licenseId,
          target: 'file',
          enabled: true,
          lastExportedId: third.id,
          lastExportedAt: third.createdAt,
          lastRunAt: new Date('2026-08-15T10:00:00.000Z'),
          exportedCount: 3n,
        },
      });

      const res = await server.get('/settings/siem/status', auth(settingsToken));
      expect(res.json()).toMatchObject({
        enabled: true,
        target: 'file',
        last_run_at: '2026-08-15T10:00:00.000Z',
        last_exported_at: third.createdAt.toISOString(),
        exported_count: 3,
        pending_count: 1,
      });
    });

    it('separates "ran and found nothing" from "is not running"', async () => {
      // The two figures answer different questions and a screen has to be able
      // to tell them apart: a fresh run with an old position means caught up,
      // a stale run with a backlog means the feed has stopped.
      const ids = await seedTrail(fx.a, 1);
      const only = await owner.auditLogEntry.findUniqueOrThrow({ where: { id: ids[0]! } });
      const ranAt = new Date();
      await owner.siemExportCursor.create({
        data: {
          licenseId: fx.a.licenseId,
          target: 'file',
          enabled: true,
          lastExportedId: only.id,
          lastExportedAt: only.createdAt,
          lastRunAt: ranAt,
          exportedCount: 1n,
        },
      });

      const body = (await server.get('/settings/siem/status', auth(settingsToken))).json() as {
        last_run_at: string;
        last_exported_at: string;
        pending_count: number;
      };
      expect(body.last_run_at).toBe(ranAt.toISOString());
      expect(Date.parse(body.last_exported_at)).toBeLessThan(Date.parse(body.last_run_at));
      expect(body.pending_count).toBe(0);
    });

    it('refuses an ordinary agent', async () => {
      const res = await server.get('/settings/siem/status', auth(agentSettingsToken));
      expect(res.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // The table's own invariants
  // =========================================================================

  describe('siem_export_cursors', () => {
    it('has row level security enabled with a tenant policy', async () => {
      const [table] = await owner.$queryRaw<Array<{ enabled: boolean }>>`
        SELECT relrowsecurity AS enabled FROM pg_class WHERE relname = 'siem_export_cursors'
      `;
      expect(table?.enabled).toBe(true);

      const policies = await owner.$queryRaw<
        Array<{ policyname: string; qual: string; withCheck: string }>
      >`
        SELECT policyname, qual, with_check AS "withCheck" FROM pg_policies
        WHERE tablename = 'siem_export_cursors'
      `;
      expect(policies).toHaveLength(1);
      expect(policies[0]?.qual).toContain('nexa_current_license()');
      // WITH CHECK matters more than USING here: moving another workspace's
      // cursor forward makes their delivery job skip everything it stepped
      // over, permanently. A boundary failure on this table destroys evidence
      // rather than leaking it.
      expect(policies[0]?.withCheck).toContain('nexa_current_license()');
    });

    it('does not let the application delete a row', async () => {
      const [grant] = await owner.$queryRaw<Array<{ can: boolean }>>`
        SELECT has_table_privilege('nexa_app', 'public.siem_export_cursors', 'DELETE') AS can
      `;
      expect(grant?.can).toBe(false);
    });

    it('refuses a target nothing can deliver to', async () => {
      await expect(
        owner.siemExportCursor.create({
          data: { licenseId: fx.a.licenseId, target: 'splunk' },
        }),
      ).rejects.toThrow(/siem_export_cursors_target_check/);
    });

    it('refuses half a cursor', async () => {
      // A timestamp with no id cannot break ties at that timestamp, and an id
      // with no timestamp cannot be placed in the ordering at all. Either way
      // the resume point is ambiguous, and ambiguity here resolves to skipping
      // or re-sending an unbounded number of rows.
      await expect(
        owner.siemExportCursor.create({
          data: { licenseId: fx.a.licenseId, target: 'file', lastExportedAt: new Date() },
        }),
      ).rejects.toThrow(/siem_export_cursors_cursor_halves_check/);
    });

    it('allows one row per workspace and target', async () => {
      await owner.siemExportCursor.create({
        data: { licenseId: fx.a.licenseId, target: 'file' },
      });
      await expect(
        owner.siemExportCursor.create({
          data: { licenseId: fx.a.licenseId, target: 'file' },
        }),
      ).rejects.toThrow();
    });
  });
});
