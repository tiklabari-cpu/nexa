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
  }
}

export function createPrismaClient(env: Env): PrismaClient {
  return new PrismaClient({
    datasourceUrl: env.runtimeDatabaseUrl,
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

  const maintainPartitions = async (): Promise<void> => {
    try {
      await db.$queryRaw`SELECT events_maintain_partitions(${PARTITION_MONTHS_AHEAD}, 1)`;
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
  });
}

export default fp(databasePlugin, { name: 'database' });
