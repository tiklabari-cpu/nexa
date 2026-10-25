/**
 * The platform process's PrismaClient (tm 389.3 · design.md §A).
 *
 * `plugins/database.ts`'s pattern, over `DATABASE_PLATFORM_URL`: the
 * `siyahtus_platform` role — BYPASSRLS, so it reads every workspace without a
 * tenant context, but not the owner, so the REVOKEs of migration
 * 20261101090000 hold (append-only `audit_log`, no write to the platform audit
 * chain's history).
 *
 * Decorated as `platformDb`, never as `db`, on purpose. Every tenant plugin and
 * service reads `app.db` and relies on row level security for isolation; under
 * this role RLS is off, so a tenant plugin registered here by mistake has to
 * fail to find its client rather than quietly serve every workspace's rows.
 *
 * Not here, and not needed: the replica (`dbRead`) and `events` partition
 * maintenance — the tenant API's scheduler owns both.
 */
import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Env } from '../config/env.js';
import type { PlatformEnv } from '../config/platform-env.js';

declare module 'fastify' {
  interface FastifyInstance {
    /** `siyahtus_platform` — BYPASSRLS. Only the platform process has one. */
    platformDb: PrismaClient;
  }
}

export function createPlatformPrismaClient(env: Env, platform: PlatformEnv): PrismaClient {
  return new PrismaClient({
    datasourceUrl: platform.databaseUrl,
    log: env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }] : [],
  });
}

async function platformDatabasePlugin(
  app: FastifyInstance,
  options: { env: Env; platform: PlatformEnv },
): Promise<void> {
  const db = createPlatformPrismaClient(options.env, options.platform);
  // Eagerly, like the primary: a wrong password or a locked role (pilot without
  // SIYAHTUS_PLATFORM_DB_PASSWORD) fails the boot, not the first sign-in.
  await db.$connect();
  app.decorate('platformDb', db);
  app.addHook('onClose', async () => {
    await db.$disconnect();
  });
}

export default fp(platformDatabasePlugin, { name: 'platform-database' });
