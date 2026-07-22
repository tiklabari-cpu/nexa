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

async function databasePlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const db = createPrismaClient(options.env);

  await db.$connect();
  app.decorate('db', db);
  app.addHook('onClose', async () => {
    await db.$disconnect();
  });
}

export default fp(databasePlugin, { name: 'database' });
