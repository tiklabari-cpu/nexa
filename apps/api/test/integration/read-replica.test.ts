/**
 * The read-replica seam (M-SCALE-c · NFR-P7 · NFR-R4).
 *
 * There is no standby to test against — this repo has no infrastructure
 * (CLAUDE.md's deploy boundary), and a real replica would add replication lag,
 * which is exactly the variable a test should not depend on. So the seam is
 * driven the way it is designed to be driven: `DATABASE_REPLICA_URL` points a
 * **second Prisma client at the same database**. Everything that makes the seam
 * either safe or unsafe survives that substitution, because none of it is about
 * the bytes being on another host:
 *
 *   - whether report routes actually reach `app.dbRead` rather than `app.db`,
 *   - whether the second client is still subject to row level security,
 *   - whether the read path refuses writes,
 *   - whether an unconfigured deployment is byte-for-byte what it was.
 *
 * What this substitution cannot test is staleness, and nothing here pretends
 * to: the surfaces that cannot tolerate lag (billing, ADR-09's metering
 * counters) are kept off the read path by construction, not by a test — see
 * `routes/reports.ts`'s plugin comment for that argument.
 *
 * The isolation half is the reason this file exists at all. tm 150 closed a
 * class of bug where a second access path quietly escaped RLS; a replica is a
 * second access path, and a URL carrying the owner's credentials would make
 * every report return every tenant's rows while looking like it worked.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateShortId } from '@nexa/types';
import {
  grantToken,
  ownerClient,
  seedFixtures,
  testEnv,
  type Fixtures,
} from '../helpers/fixtures.js';
import { clearRateLimits, startTestServer, type TestServer } from '../helpers/server.js';
import { withTenant, withTenantRead } from '../../src/lib/tenant.js';

/** Only the field these tests read — the report's full body is not the subject. */
interface Overview {
  totals: { chats: number };
}

describe('read replica seam', () => {
  let owner: PrismaClient;
  /** No `DATABASE_REPLICA_URL` — every deployment in this repo. */
  let primaryOnly: TestServer;
  /** `DATABASE_REPLICA_URL` set to a second client on the same database. */
  let withReplica: TestServer;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;

  /**
   * The app-role URL the harness gave this run. Used verbatim as the replica:
   * same database, same non-owner role, separate client — which is what
   * `parseEnv` demands and what a real standby would look like minus the lag.
   */
  const appUrl = (): string => {
    const url = process.env['DATABASE_APP_URL'];
    if (!url) throw new Error('DATABASE_APP_URL must be set');
    return url;
  };

  beforeAll(async () => {
    owner = ownerClient();
    primaryOnly = await startTestServer();
    withReplica = await startTestServer({ DATABASE_REPLICA_URL: appUrl() });
  });

  afterAll(async () => {
    await Promise.all([primaryOnly.close(), withReplica.close()]);
    await owner.$disconnect();
  });

  beforeEach(async () => {
    fx = await seedFixtures(owner);
    await clearRateLimits(primaryOnly.app);

    tokenA = await grantToken(owner, {
      licenseId: fx.a.licenseId,
      organizationId: fx.a.organizationId,
      ownerId: fx.a.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw', 'reports_read', 'audit_log--all:ro'],
    });
    tokenB = await grantToken(owner, {
      licenseId: fx.b.licenseId,
      organizationId: fx.b.organizationId,
      ownerId: fx.b.ownerAccountId,
      scopes: ['chats--all:rw', 'customers:rw', 'reports_read'],
    });
  });

  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  /**
   * A closed conversation for one tenant, written through the owner client so
   * the fixture can be built for either without holding a token for both.
   *
   * Stamped a minute back for the same reason `reports-billing.test.ts` does
   * it: a report's `to` comes from the API process' clock and the column
   * default comes from Postgres', which was measured up to ~10ms ahead — a row
   * written "now" can land after the window closes.
   */
  async function closedChat(tenant: Fixtures['a']): Promise<void> {
    const at = new Date(Date.now() - 60_000);
    const chatId = generateShortId();
    await owner.chat.create({
      data: {
        id: chatId,
        licenseId: tenant.licenseId,
        customerId: tenant.customerId,
        active: false,
        createdAt: at,
      },
    });
    await owner.thread.create({
      data: {
        id: generateShortId(),
        chatId,
        licenseId: tenant.licenseId,
        active: false,
        createdAt: at,
        closedAt: at,
      },
    });
  }

  /** A window wide enough to hold the fixtures and inside `REPORT_MAX_RANGE_DAYS`. */
  const WINDOW = (() => {
    const to = new Date(Date.now() + 60_000);
    const from = new Date(to.getTime() - 30 * 24 * 3_600_000);
    return `from=${from.toISOString()}&to=${to.toISOString()}`;
  })();

  describe('wiring', () => {
    it('is the same client as the primary when no replica is configured', () => {
      // Identity, not equality: a nullable `dbRead` would put `?? db` at every
      // call site, and the one that got forgotten would keep working silently.
      expect(primaryOnly.app.dbRead).toBe(primaryOnly.app.db);
      expect(primaryOnly.app.dbRead).not.toBe(withReplica.app.dbRead);
    });

    it('is a separate client when one is configured', () => {
      expect(withReplica.app.dbRead).not.toBe(withReplica.app.db);
    });

    it('refuses to boot a replica that connects as the table owner', () => {
      // The failure being bought out: Postgres exempts table owners from RLS,
      // so this URL would answer report queries with every tenant's rows — and
      // the harness's owner URL is a real one, not a hand-written example.
      const ownerUrl = process.env['DATABASE_URL'];
      if (!ownerUrl) throw new Error('DATABASE_URL must be set');
      expect(ownerUrl).not.toBe(appUrl());
      expect(() => testEnv({ DATABASE_REPLICA_URL: ownerUrl })).toThrow(/row level security/);
    });
  });

  describe('behaviour is unchanged by the replica', () => {
    beforeEach(async () => {
      await closedChat(fx.a);
      await closedChat(fx.a);
    });

    it('serves the same overview report from either configuration', async () => {
      const [direct, replica] = await Promise.all([
        primaryOnly.get(`/reports/overview?${WINDOW}`, bearer(tokenA)),
        withReplica.get(`/reports/overview?${WINDOW}`, bearer(tokenA)),
      ]);

      expect(direct.statusCode).toBe(200);
      expect(replica.statusCode).toBe(200);
      expect(replica.json()).toEqual(direct.json());
      // Guards the comparison against being vacuously true on two empty reports.
      expect((direct.json() as Overview).totals.chats).toBe(2);
    });

    it('serves the same CSV export from either configuration', async () => {
      const query = `/reports/export?group=overview&${WINDOW}`;
      const [direct, replica] = await Promise.all([
        primaryOnly.get(query, bearer(tokenA)),
        withReplica.get(query, bearer(tokenA)),
      ]);

      expect(direct.statusCode).toBe(200);
      expect(replica.statusCode).toBe(200);
      expect(replica.body).toBe(direct.body);
      expect(direct.body.split('\n').length).toBeGreaterThan(1);
    });

    it('serves the access review from the replica', async () => {
      const response = await withReplica.get('/reports/access-review', bearer(tokenA));

      expect(response.statusCode).toBe(200);
      const body = response.json() as { members: unknown[] };
      // The workspace's own roster, not nobody's and not everybody's.
      expect(body.members.length).toBeGreaterThan(0);
    });
  });

  describe('tenant isolation on the read path', () => {
    beforeEach(async () => {
      await closedChat(fx.a);
      await closedChat(fx.b);
      await closedChat(fx.b);
    });

    it("counts only the caller's own chats through the replica", async () => {
      const [a, b] = await Promise.all([
        withReplica.get(`/reports/overview?${WINDOW}`, bearer(tokenA)),
        withReplica.get(`/reports/overview?${WINDOW}`, bearer(tokenB)),
      ]);

      // 1 and 2, not 3 and 3: a replica connected as the owner would have
      // returned the union to both, and both responses would still be 200.
      expect((a.json() as Overview).totals.chats).toBe(1);
      expect((b.json() as Overview).totals.chats).toBe(2);
    });

    it('applies RLS to the replica client directly, not just through the routes', async () => {
      const chats = await withTenantRead(
        withReplica.app.dbRead,
        { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId },
        (tx) => tx.chat.findMany({ select: { licenseId: true } }),
      );

      expect(chats).toHaveLength(1);
      expect(chats.every((c) => c.licenseId === fx.a.licenseId)).toBe(true);
    });

    it('sees nothing at all without a tenant context — the policies are on, not permissive', async () => {
      // No `withTenant`, so `app.current_license` is unset. RLS answers with
      // zero rows rather than everything, which is what proves the replica
      // connection is the non-owner role.
      const rows = await withReplica.app.dbRead.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*)::bigint AS n FROM chats`;

      expect(rows[0]?.n).toBe(0n);
    });
  });

  describe('the read path refuses writes', () => {
    it('rejects a write inside withTenantRead', async () => {
      const context = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };

      await expect(
        withTenantRead(withReplica.app.dbRead, context, (tx) =>
          tx.tag.create({ data: { licenseId: fx.a.licenseId, name: 'from-the-read-path' } }),
        ),
      ).rejects.toThrow(/read-only transaction/i);
    });

    it('rejects it on the primary too, so the constraint is testable without a replica', async () => {
      // The seam would otherwise be correct only in the configuration nobody
      // runs: with no replica, `dbRead` *is* the primary and a write would
      // succeed here and fail later against a real standby.
      const context = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };

      await expect(
        withTenantRead(primaryOnly.app.dbRead, context, (tx) =>
          tx.tag.create({ data: { licenseId: fx.a.licenseId, name: 'from-the-read-path' } }),
        ),
      ).rejects.toThrow(/read-only transaction/i);
    });

    it('still allows the same write through withTenant — the refusal is the seam, not the fixture', async () => {
      const context = { licenseId: fx.a.licenseId, organizationId: fx.a.organizationId };

      const tag = await withTenant(primaryOnly.app.db, context, (tx) =>
        tx.tag.create({
          data: { licenseId: fx.a.licenseId, name: 'from-the-write-path' },
          select: { name: true },
        }),
      );

      expect(tag.name).toBe('from-the-write-path');
    });
  });
});
