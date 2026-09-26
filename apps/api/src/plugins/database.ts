/**
 * PrismaClient lifecycle.
 *
 * The runtime connection uses DATABASE_APP_URL (the non-owner `siyahtus_app` role)
 * when present. This matters: PostgreSQL exempts superusers and table owners
 * from row level security, so connecting as the migration role would quietly
 * turn off every tenant isolation policy while all the tests still pass.
 */
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import { EventPartitionMaintenance } from '../services/chat/event-partitions.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: PrismaClient;
    /**
     * `events` partition maintenance (SEMA-MIMARI.8.4c · tm 255.14). Its last
     * pass is the `event_partitions` block of the admin `/health` body.
     */
    eventPartitions: EventPartitionMaintenance;
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

async function databasePlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const db = createPrismaClient(options.env);

  await db.$connect();
  app.decorate('db', db);

  // Connected eagerly like the primary: a replica whose credentials or host are
  // wrong should fail the boot, not the first report request of the day.
  const replica = createReplicaClient(options.env);
  if (replica) await replica.$connect();
  app.decorate('dbRead', replica ?? db);

  // Through the runtime role, like every other query: since migration
  // 20260925100000 the partition functions carry the owner's rights themselves
  // (SECURITY DEFINER, §D187), so no deployment has to hand the API an owner
  // connection for this — and before it, this role could not open a month at
  // all (§D131).
  const eventPartitions = new EventPartitionMaintenance({
    ensureMonth: (monthStart) =>
      db.$queryRaw`SELECT events_ensure_partition(${monthStart}::timestamptz)`,
    logger: app.log.child({ component: 'event-partitions' }),
  });
  app.decorate('eventPartitions', eventPartitions);

  // At boot, and periodically, because a process that stays up for months would
  // otherwise outlive its partition window. Never fatal (`run()` does not
  // reject): the default partition catches anything that slips through, so a
  // failure here degrades performance rather than losing messages — and is on
  // `/health` rather than only in a log line.
  await eventPartitions.run();
  const timer = setInterval(() => void eventPartitions.run(), eventPartitions.intervalMs);
  timer.unref();

  app.addHook('onClose', async () => {
    clearInterval(timer);
    // A pass still running would otherwise meet a closed pool and record a
    // failure nobody caused.
    await eventPartitions.settled();
    await db.$disconnect();
    // Guarded on the client rather than on `app.dbRead !== app.db`: without a
    // replica the two are one object, and disconnecting it twice would be a
    // second disconnect on a client the line above already closed.
    if (replica) await replica.$disconnect();
  });
}

export default fp(databasePlugin, { name: 'database' });
