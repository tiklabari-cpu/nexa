/**
 * The harness that keeps two concurrent test runs out of each other's data
 * (tm 105).
 *
 * This suite is the acceptance criterion in miniature: rather than trusting that
 * two windows would now behave, it provisions two runs *in one process* and
 * asserts they cannot see each other. The destructive half — a sweep that issues
 * `DROP DATABASE` — is tested from the other direction too, because the failure
 * mode there is not a red test, it is somebody's development database.
 */
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';
import {
  adminUrl,
  assertDroppableDatabaseName,
  isolatedDatabaseName,
  licenseIdOffsetFor,
  provisionIsolatedDatastores,
  sweepAbandonedDatabases,
  withDatabaseName,
  withRedisIndex,
  withTestConnectionBudget,
  type IsolatedDatastores,
} from '../../scripts/test-datastores.js';

const OWNER_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];

/** Databases created by the harness itself, as opposed to by a test double. */
const provisioned: IsolatedDatastores[] = [];

async function provision(): Promise<IsolatedDatastores> {
  const datastores = await provisionIsolatedDatastores();
  provisioned.push(datastores);
  return datastores;
}

async function databaseExists(admin: PrismaClient, name: string): Promise<boolean> {
  const rows = await admin.$queryRawUnsafe<Array<{ ok: boolean }>>(
    `SELECT true AS ok FROM pg_database WHERE datname = '${name}'`,
  );
  return rows.length > 0;
}

describe('isolated test datastores', () => {
  // =========================================================================
  // Negatives first — the destructive paths
  // =========================================================================

  describe('drop guard', () => {
    it.each(['nexa', 'postgres', 'template1', 'nexa_test', 'nexa_test_', 'nexa_test_zzzzzzzzzzzz'])(
      'refuses to drop %s',
      (name) => {
        expect(() => assertDroppableDatabaseName(name)).toThrow(/refusing to drop/);
      },
    );

    it('accepts a name it minted itself', () => {
      expect(() => assertDroppableDatabaseName(isolatedDatabaseName())).not.toThrow();
    });

    it('mints a fresh name every time', () => {
      const names = new Set(Array.from({ length: 50 }, () => isolatedDatabaseName()));
      expect(names.size).toBe(50);
    });
  });

  describe('url rewriting', () => {
    it('keeps credentials, host and port when repointing Postgres', () => {
      expect(
        withDatabaseName('postgresql://u:p@db.example:5433/nexa', 'nexa_test_0123456789ab'),
      ).toBe('postgresql://u:p@db.example:5433/nexa_test_0123456789ab');
    });

    it('preserves connection options', () => {
      expect(withDatabaseName('postgresql://u:p@h:5433/nexa?sslmode=disable', 'other')).toContain(
        'sslmode=disable',
      );
    });

    it('replaces a Redis index that is already there', () => {
      expect(withRedisIndex('redis://h:6380/9', 3)).toBe('redis://h:6380/3');
      expect(withRedisIndex('redis://h:6380', 3)).toBe('redis://h:6380/3');
    });

    it('points the maintenance connection at postgres with a single connection', () => {
      const url = new URL(adminUrl('postgresql://u:p@h:5433/nexa'));
      expect(url.pathname).toBe('/postgres');
      expect(url.searchParams.get('connection_limit')).toBe('1');
    });

    it('spaces licence id offsets far enough apart to never overlap', () => {
      expect(licenseIdOffsetFor(2) - licenseIdOffsetFor(1)).toBeGreaterThan(100_000);
    });

    it('bounds the connection pool so two runs do not starve one server', () => {
      const url = new URL(
        withTestConnectionBudget('postgresql://u:p@h:5433/nexa_test_0123456789ab'),
      );
      expect(Number(url.searchParams.get('connection_limit'))).toBeLessThanOrEqual(10);
      expect(Number(url.searchParams.get('connect_timeout'))).toBeGreaterThan(5);
    });

    it('never overrides a budget the caller set deliberately', () => {
      const url = new URL(
        withTestConnectionBudget('postgresql://u:p@h:5433/nexa?connection_limit=1'),
      );
      expect(url.searchParams.get('connection_limit')).toBe('1');
    });
  });

  // =========================================================================
  // The property the whole thing exists for
  // =========================================================================

  describe('two concurrent runs', () => {
    it('cannot see each other in Postgres, Redis or the licence sequence', async () => {
      const [first, second] = await Promise.all([provision(), provision()]);

      expect(first.databaseName).not.toBe(second.databaseName);
      expect(first.redisIndex).not.toBe(second.redisIndex);
      expect(first.licenseIdOffset).not.toBe(second.licenseIdOffset);
      expect(first.env.REDIS_URL).not.toBe(second.env.REDIS_URL);

      const a = new PrismaClient({ datasourceUrl: first.env.DATABASE_URL });
      const b = new PrismaClient({ datasourceUrl: second.env.DATABASE_URL });
      try {
        // Migrations really ran: an empty database would throw here instead.
        expect(await a.organization.count()).toBe(0);
        expect(await b.organization.count()).toBe(0);

        await a.organization.create({ data: { name: 'Only in A', region: 'eu' } });

        expect(await a.organization.count()).toBe(1);
        expect(await b.organization.count()).toBe(0);
      } finally {
        await a.$disconnect();
        await b.$disconnect();
      }

      const redisA = new Redis(first.env.REDIS_URL);
      const redisB = new Redis(second.env.REDIS_URL);
      try {
        await redisA.set('shared-key-name', 'from-a');
        expect(await redisA.get('shared-key-name')).toBe('from-a');
        expect(await redisB.get('shared-key-name')).toBeNull();
      } finally {
        await redisA.quit();
        await redisB.quit();
      }
    }, 180_000);

    it('frees the database and the Redis lease on release', async () => {
      const datastores = await provisionIsolatedDatastores();
      const admin = new PrismaClient({ datasourceUrl: adminUrl(OWNER_URL!) });
      const bookkeeping = new Redis(withRedisIndex(REDIS_URL!, 0));

      try {
        expect(await databaseExists(admin, datastores.databaseName)).toBe(true);
        expect(await bookkeeping.exists(`nexa:test:redis-slot:${datastores.redisIndex}`)).toBe(1);

        await datastores.release();

        expect(await databaseExists(admin, datastores.databaseName)).toBe(false);
        expect(await bookkeeping.exists(`nexa:test:redis-slot:${datastores.redisIndex}`)).toBe(0);

        // Releasing twice is what a failed run does: the `finally` fires and
        // then the process exits. It must not throw on the second pass.
        await expect(datastores.release()).resolves.toBeUndefined();
      } finally {
        await admin.$disconnect();
        await bookkeeping.quit();
      }
    }, 180_000);
  });

  // =========================================================================
  // Recovering from a window that died without cleaning up
  // =========================================================================

  describe('sweep', () => {
    it('drops an abandoned database but leaves a leased one alone', async () => {
      const admin = new PrismaClient({ datasourceUrl: adminUrl(OWNER_URL!) });
      const bookkeeping = new Redis(withRedisIndex(REDIS_URL!, 0));

      const abandoned = isolatedDatabaseName();
      const leased = isolatedDatabaseName();

      try {
        await admin.$executeRawUnsafe(`CREATE DATABASE "${abandoned}"`);
        await admin.$executeRawUnsafe(`CREATE DATABASE "${leased}"`);
        // Only one of them has a live owner.
        await bookkeeping.set(`nexa:test:database:${leased}`, 'still-running', 'PX', 60_000);

        const dropped = await sweepAbandonedDatabases(admin, bookkeeping);

        expect(dropped).toContain(abandoned);
        expect(dropped).not.toContain(leased);
        expect(await databaseExists(admin, abandoned)).toBe(false);
        expect(await databaseExists(admin, leased)).toBe(true);

        // And the database this very suite is running against — whose lease is
        // being renewed by the wrapper outside — survived its own sweep.
        const current = new URL(OWNER_URL!).pathname.slice(1);
        if (current.startsWith('nexa_test_')) {
          expect(dropped).not.toContain(current);
          expect(await databaseExists(admin, current)).toBe(true);
        }
      } finally {
        await bookkeeping.del(`nexa:test:database:${leased}`);
        await admin
          .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${leased}" WITH (FORCE)`)
          .catch(() => undefined);
        await admin
          .$executeRawUnsafe(`DROP DATABASE IF EXISTS "${abandoned}" WITH (FORCE)`)
          .catch(() => undefined);
        await admin.$disconnect();
        await bookkeeping.quit();
      }
    }, 180_000);
  });

  // Anything a failing assertion above left behind.
  it('cleans up after itself', async () => {
    await Promise.all(provisioned.map((d) => d.release().catch(() => undefined)));
    const admin = new PrismaClient({ datasourceUrl: adminUrl(OWNER_URL!) });
    try {
      for (const { databaseName } of provisioned) {
        expect(await databaseExists(admin, databaseName)).toBe(false);
      }
    } finally {
      await admin.$disconnect();
    }
  }, 120_000);
});
