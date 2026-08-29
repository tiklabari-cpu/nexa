/**
 * PrismaClient lifecycle.
 *
 * The runtime connection uses DATABASE_APP_URL (the non-owner `nexa_app` role)
 * when present. This matters: PostgreSQL exempts superusers and table owners
 * from row level security, so connecting as the migration role would quietly
 * turn off every tenant isolation policy while all the tests still pass.
 */
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
    /**
     * Where the heavy read-only reports run (M-SCALE-c · NFR-P7 · NFR-R4).
     *
     * The replica when `DATABASE_REPLICA_URL` is configured; otherwise this is
     * the *same object* as `app.db`. Identity rather than `undefined` on
     * purpose: a nullable client would put `app.dbRead ?? app.db` at a dozen
     * call sites, and the one that got forgotten would be the one that keeps
     * working — on the primary, silently, exactly as it does today.
     */
    dbRead: PrismaClient;
  }
}

export function createPrismaClient(env: Env): PrismaClient {
  return new PrismaClient({
    datasourceUrl: env.runtimeDatabaseUrl,
    log: env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }] : [],
  });
}

/**
 * The read-replica client, or null when this deployment has no replica.
 *
 * `env.replicaDatabaseUrl` has already been through `parseEnv`'s check that it
 * does not connect as the table owner — the reason that check lives in the
 * config layer rather than here is that a process which reached this point with
 * an owner-role replica has already decided to serve traffic.
 */
export function createReplicaClient(env: Env): PrismaClient | null {
  if (env.replicaDatabaseUrl === undefined) return null;
  return new PrismaClient({
    datasourceUrl: env.replicaDatabaseUrl,
    log: env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }] : [],
  });
}

/**
 * How far ahead event partitions are kept. An insert into a month with no
 * partition lands in `events_default` rather than failing, but that partition
 * is unindexed for range scans and grows without bound — so the window must
 * stay comfortably ahead of real time.
 */
const PARTITION_MONTHS_AHEAD = 3;
const PARTITION_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;

async function databasePlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const db = createPrismaClient(options.env);

  await db.$connect();
  app.decorate('db', db);

  // Connected eagerly like the primary: a replica whose credentials or host are
  // wrong should fail the boot, not the first report request of the day.
  const replica = createReplicaClient(options.env);
  if (replica) await replica.$connect();
  app.decorate('dbRead', replica ?? db);

  const maintainPartitions = async (): Promise<void> => {
    try {
      // Casts are explicit: Prisma sends JS numbers as bigint, which does not
      // match the function's int signature.
      await db.$queryRaw`SELECT events_maintain_partitions(${PARTITION_MONTHS_AHEAD}::int, 1::int)`;
    } catch (error) {
      // Never fatal: the default partition catches anything that slips through,
      // so a failure here degrades performance rather than losing messages.
      app.log.error({ err: error }, 'event partition maintenance failed');
    }
  };

  // At boot, and periodically, because a process that stays up for months would
  // otherwise outlive its partition window.
  await maintainPartitions();
  const timer = setInterval(() => void maintainPartitions(), PARTITION_MAINTENANCE_INTERVAL_MS);
  timer.unref();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    await db.$disconnect();
    // Guarded on the client rather than on `app.dbRead !== app.db`: without a
    // replica the two are one object, and disconnecting it twice would be a
    // second disconnect on a client the line above already closed.
    if (replica) await replica.$disconnect();
  });
}

export default fp(databasePlugin, { name: 'database' });
