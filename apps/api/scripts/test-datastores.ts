/**
 * Per-run isolation for the datastores the test suites actually hit.
 *
 * The problem this solves is *cross-process*, not cross-file. `vitest.config.ts`
 * already serialises files inside one run, and CONVENTIONS warns about turbo
 * running `@nexa/api` and `@nexa/rtm` at the same time. Neither helps when two
 * autonomous windows are open at once: both point at the same local Postgres
 * (`nexa-db:5433`) and the same Redis (`nexa-redis:6380`), and every suite
 * begins with `TRUNCATE ... CASCADE`. One window wipes the other's fixtures
 * mid-flight, and the damage surfaces as unique-constraint violations and 401s
 * in code the window never touched — a red gate that says nothing about the
 * change under test (tm 105).
 *
 * The fix is to stop sharing:
 *
 * - **Postgres** — each run gets its own database (`nexa_test_<id>`), created
 *   and migrated at start, dropped at the end. A fresh `migrate deploy` costs
 *   ~3 s against ~15 min of suite, so cloning a template database would be
 *   optimising the wrong number while adding a cache to invalidate.
 * - **Redis** — each run leases one logical database (index 1-15). Every key
 *   the product writes (rate limits, idempotency, typing, composer registries)
 *   is scoped by the selected index, so leasing one is enough.
 * - **Pub/sub** — Redis channels are *not* scoped by logical database, and
 *   `licenseChannel()` is keyed by an autoincrement id, so two runs would both
 *   publish on `nexa:rtm:license:1`. The lease therefore also carries a licence
 *   id offset that `resetDatabase()` applies to `licenses_id_seq`, which makes
 *   the channel names disjoint without touching production code.
 *
 * Separate databases still share one server, so the isolated URLs also carry a
 * connection budget — Prisma sizes its pool from the CPU count, and two suites
 * doing that at once turn a busy server into "Can't reach database server".
 *
 * Liveness is tracked in Redis rather than by wall-clock age: a window that
 * dies (quota, crash, Ctrl-C) stops renewing its lease, and the next run sweeps
 * the database it left behind. Nothing outside the `nexa_test_` prefix is ever
 * dropped.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { PrismaClient } from '@prisma/client';
import { Redis } from 'ioredis';

const run = promisify(execFile);
const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every database this module is allowed to create — and, crucially, to drop. */
export const TEST_DATABASE_PREFIX = 'nexa_test_';
const TEST_DATABASE_PATTERN = /^nexa_test_[0-9a-f]{12}$/;

/**
 * Logical Redis databases handed out to runs. Index 0 is left alone: it is what
 * `make dev`, the e2e suite and the lease bookkeeping below use, and a run
 * flushes the index it leases.
 */
export const FIRST_REDIS_INDEX = 1;
export const LAST_REDIS_INDEX = 15;

/**
 * How long a lease survives without a heartbeat, and how often it is renewed.
 *
 * Both numbers matter. Expire too early and another run sweeps a *live* database
 * out from under a suite; expire too late and a killed run holds one of fifteen
 * slots for that long — which is not hypothetical, because turbo SIGKILLs the
 * sibling tasks of a failing one and the wrapper never gets to clean up.
 *
 * Five missed heartbeats before expiry is the compromise: the wrapper process
 * does nothing but wait on its child, so its timer cannot plausibly slip that
 * far, and a crashed run's slot comes back within five minutes.
 */
const LEASE_MS = 5 * 60_000;
const HEARTBEAT_MS = 60_000;

/** Licence ids are spaced far enough apart that no run can reach the next one. */
const LICENSE_ID_STRIDE = 1_000_000;

const slotKey = (index: number): string => `nexa:test:redis-slot:${index}`;
const databaseKey = (name: string): string => `nexa:test:database:${name}`;

/** Overrides to hand the test command — nothing else needs to change. */
export interface IsolatedDatastoreEnv {
  DATABASE_URL: string;
  DATABASE_APP_URL: string;
  REDIS_URL: string;
  NEXA_TEST_LICENSE_ID_OFFSET: string;
}

export interface IsolatedDatastores {
  env: IsolatedDatastoreEnv;
  databaseName: string;
  redisIndex: number;
  licenseIdOffset: number;
  /** Drops the database and frees the lease. Safe to call more than once. */
  release: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// URL helpers — pure, so the rewriting rules can be tested without a server
// ---------------------------------------------------------------------------

/** Repoints a Postgres URL at another database, keeping credentials and options. */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** Repoints a Redis URL at a logical database index, replacing any existing one. */
export function withRedisIndex(url: string, index: number): string {
  const parsed = new URL(url);
  parsed.pathname = `/${index}`;
  return parsed.toString();
}

/**
 * The maintenance connection. `CREATE DATABASE` cannot run from inside the
 * database being created, and one connection is all this needs.
 */
export function adminUrl(url: string): string {
  const parsed = new URL(withDatabaseName(url, 'postgres'));
  parsed.searchParams.set('connection_limit', '1');
  return parsed.toString();
}

/**
 * Connection budget for a test run.
 *
 * Separate databases stop two runs corrupting each other's *data*, but they
 * still share one server, and Prisma's default pool is sized from the CPU count
 * — so two suites on one machine open far more connections than either needs
 * and then time out reaching a server busy serving the other. Tests run one file
 * at a time; ten connections is already generous, and the longer timeouts absorb
 * a server that is briefly busy rather than turning that into a red test.
 *
 * Values the caller set explicitly are left alone.
 */
export function withTestConnectionBudget(url: string): string {
  const parsed = new URL(url);
  const defaults: Record<string, string> = {
    connection_limit: '10',
    connect_timeout: '20',
    pool_timeout: '30',
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, value);
  }
  return parsed.toString();
}

export function isolatedDatabaseName(): string {
  return `${TEST_DATABASE_PREFIX}${randomBytes(6).toString('hex')}`;
}

/**
 * Guard for every destructive statement in this module.
 *
 * A drop is built from a name that came back from `pg_database`, so a typo in
 * the filter would hand `DROP DATABASE` the development database. Checking the
 * exact minted shape — not just the prefix — makes that impossible by
 * construction rather than by review.
 */
export function assertDroppableDatabaseName(name: string): void {
  if (!TEST_DATABASE_PATTERN.test(name)) {
    throw new Error(`refusing to drop "${name}": not a ${TEST_DATABASE_PREFIX}<id> database`);
  }
}

export function licenseIdOffsetFor(redisIndex: number): number {
  return redisIndex * LICENSE_ID_STRIDE;
}

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

/**
 * Closes a Redis connection without the parting shot.
 *
 * `disconnect()` drops the socket where it stands, and ioredis reports the
 * server's reset as an unhandled `ECONNRESET` on stderr — noise in the middle of
 * a passing suite that reads like a real failure. Same idiom as `plugins/redis.ts`.
 */
async function closeRedis(client: Redis): Promise<void> {
  await client.quit().catch(() => client.disconnect());
}

async function dropDatabase(admin: PrismaClient, name: string): Promise<void> {
  assertDroppableDatabaseName(name);
  // FORCE terminates leftover backends — an autonomous window that died mid-run
  // leaves `idle in transaction` connections that would otherwise block the drop.
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}

/**
 * Drops databases whose owning run is gone.
 *
 * Liveness is the Redis lease, not the database's age: an age threshold either
 * reaps a slow-but-healthy run or leaves rubbish behind, depending on which
 * number you pick.
 */
export async function sweepAbandonedDatabases(
  admin: PrismaClient,
  redis: Redis,
): Promise<string[]> {
  const rows = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
    `SELECT datname FROM pg_database WHERE starts_with(datname, '${TEST_DATABASE_PREFIX}')`,
  );

  const dropped: string[] = [];
  for (const { datname } of rows) {
    if (!TEST_DATABASE_PATTERN.test(datname)) continue;
    if ((await redis.exists(databaseKey(datname))) > 0) continue;
    try {
      await dropDatabase(admin, datname);
      dropped.push(datname);
    } catch {
      // Another run may be dropping the same orphan, or a connection may have
      // arrived between the check and the drop. Both are benign; the next run
      // sweeps again.
    }
  }
  return dropped;
}

/** Leases a Redis logical database, or throws if every index is taken. */
async function leaseRedisIndex(redis: Redis, runId: string): Promise<number> {
  for (let index = FIRST_REDIS_INDEX; index <= LAST_REDIS_INDEX; index += 1) {
    const acquired = await redis.set(slotKey(index), runId, 'PX', LEASE_MS, 'NX');
    if (acquired === 'OK') return index;
  }
  throw new Error(
    `all Redis test slots (${FIRST_REDIS_INDEX}-${LAST_REDIS_INDEX}) are leased — ` +
      'too many concurrent test runs, or a stale lease that has not expired yet',
  );
}

async function migrate(databaseUrl: string): Promise<void> {
  // Resolved rather than spawned through the shell: the `.bin` shim is a `.cmd`
  // on Windows, which `CreateProcess` will not find without `shell: true`, and
  // going through a shell drags quoting rules into a path we control.
  const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  try {
    await run(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        // No version check: the harness must work offline and must not add
        // seconds of network wait to every test run.
        CHECKPOINT_DISABLE: '1',
      },
      timeout: 180_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`prisma migrate deploy failed for the isolated test database: ${detail}`);
  }
}

/**
 * Creates a private database and leases a private Redis index for one test run.
 *
 * Reads `DATABASE_URL` / `DATABASE_APP_URL` / `REDIS_URL` from `source` and
 * returns the overrides that repoint them; the caller decides whether to put
 * them in a child process's environment or in its own.
 */
export async function provisionIsolatedDatastores(
  source: NodeJS.ProcessEnv = process.env,
): Promise<IsolatedDatastores> {
  const ownerUrl = source['DATABASE_URL'];
  const redisUrl = source['REDIS_URL'];
  if (!ownerUrl) throw new Error('DATABASE_URL must be set to isolate the test database');
  if (!redisUrl) throw new Error('REDIS_URL must be set to isolate the test Redis database');
  const appUrl = source['DATABASE_APP_URL'] ?? ownerUrl;

  const runId = randomBytes(8).toString('hex');
  const databaseName = isolatedDatabaseName();

  // Index 0 holds the lease bookkeeping and is never flushed.
  const bookkeeping = new Redis(withRedisIndex(redisUrl, 0), {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });
  await bookkeeping.connect();

  const admin = new PrismaClient({ datasourceUrl: adminUrl(ownerUrl) });

  // Provisioning happens in stages, and `cleanup` has to be able to undo
  // whichever of them got as far as running — from the failure path below or
  // from the caller's `release()`. Index 0 is never handed out, so it doubles as
  // "no lease yet".
  let redisIndex = 0;
  let created = false;
  const heartbeats: NodeJS.Timeout[] = [];

  const cleanup = async (): Promise<void> => {
    for (const timer of heartbeats) clearInterval(timer);
    try {
      if (created) await dropDatabase(admin, databaseName);
    } finally {
      try {
        // Both deletes are attempted independently: a slot held by a run that is
        // already gone is the scarcer resource of the two (there are fifteen),
        // and it must not be forfeited because the database key delete failed.
        const keys = [databaseKey(databaseName)];
        if (redisIndex > 0) keys.push(slotKey(redisIndex));
        await Promise.allSettled(keys.map((key) => bookkeeping.del(key)));
      } finally {
        await admin.$disconnect().catch(() => undefined);
        await closeRedis(bookkeeping);
      }
    }
  };

  try {
    // Sweep first: a run that was killed rather than closed still holds its
    // lease until it expires, and there are only fifteen. Reclaiming what is
    // provably dead before asking for a slot is the difference between "wait
    // five minutes" and "fail".
    await sweepAbandonedDatabases(admin, bookkeeping);
    redisIndex = await leaseRedisIndex(bookkeeping, runId);

    // Claim the name before the database exists, so a sweep that runs while
    // migrations are still going cannot mistake it for an orphan.
    await bookkeeping.set(databaseKey(databaseName), runId, 'PX', LEASE_MS);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${databaseName}"`);
    created = true;

    await migrate(withDatabaseName(ownerUrl, databaseName));

    // Whatever a previous tenant of this index left behind (a crashed run's
    // rate-limit counters, a half-written session) is not ours to inherit.
    const leased = new Redis(withRedisIndex(redisUrl, redisIndex), {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });
    await leased.connect();
    try {
      await leased.flushdb();
    } finally {
      await closeRedis(leased);
    }
  } catch (error) {
    await cleanup().catch(() => undefined);
    throw error;
  }

  const heartbeat = setInterval(() => {
    void bookkeeping.pexpire(databaseKey(databaseName), LEASE_MS).catch(() => undefined);
    void bookkeeping.pexpire(slotKey(redisIndex), LEASE_MS).catch(() => undefined);
  }, HEARTBEAT_MS);
  // Never hold the process open on account of the lease timer.
  heartbeat.unref();
  heartbeats.push(heartbeat);

  let released = false;
  const licenseIdOffset = licenseIdOffsetFor(redisIndex);

  return {
    databaseName,
    redisIndex,
    licenseIdOffset,
    env: {
      DATABASE_URL: withTestConnectionBudget(withDatabaseName(ownerUrl, databaseName)),
      DATABASE_APP_URL: withTestConnectionBudget(withDatabaseName(appUrl, databaseName)),
      REDIS_URL: withRedisIndex(redisUrl, redisIndex),
      NEXA_TEST_LICENSE_ID_OFFSET: String(licenseIdOffset),
    },
    release: async () => {
      if (released) return;
      released = true;
      await cleanup();
    },
  };
}
