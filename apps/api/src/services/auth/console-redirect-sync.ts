/**
 * Boot-time registration of this deployment's console callback on every
 * existing first-party OAuth client (tm 255.17 · PLAN §D189).
 *
 * A new workspace gets the callback inside `auth_signup` itself. A workspace
 * opened before migration `20260925120000_console_redirect_from_config` — or
 * before this deployment's `WEB_APP_URL` changed — does not, and a migration
 * cannot give it one because it does not know the address. So every process
 * hands its own configured callback to `auth_register_console_redirect` once,
 * at boot. After the first boot on an address it matches nothing and writes
 * nothing.
 *
 * Expand-only (CONVENTIONS §6.3): appends, never removes. The SQL function is
 * where that is enforced; this module only calls it and reports.
 *
 * Never fatal. Refusing to boot over this would take the API down for every
 * workspace to protect sign-in for the older ones — the ones signed up after
 * the migration already carry the callback. A failure is one `error` line,
 * naming what to do; a success that changed rows is one `info` line, so the
 * first boot on a new address says what it did.
 */
import type { PrismaClient } from '@prisma/client';
import type { FastifyBaseLogger } from 'fastify';
import { errorCodeOf } from '../chat/event-partitions.js';

/**
 * Registers `redirect` on every first-party client that lacks it.
 *
 * @returns How many clients gained it, or `null` when the call failed (already
 *   logged).
 */
export async function registerConsoleRedirect(options: {
  db: PrismaClient;
  redirect: string;
  logger: FastifyBaseLogger;
}): Promise<number | null> {
  const { db, redirect, logger } = options;
  try {
    const rows = await db.$queryRaw<Array<{ registered: number }>>`
      SELECT auth_register_console_redirect(${redirect}) AS registered`;
    const registered = Number(rows[0]?.registered ?? 0);
    if (registered > 0) {
      logger.info(
        { console_redirect: redirect, clients: registered },
        'registered this deployment’s console callback on existing workspaces',
      );
    }
    return registered;
  } catch (error) {
    logger.error(
      {
        console_redirect: redirect,
        error_code: errorCodeOf(error),
        err: error,
      },
      'could not register the console callback on existing workspaces — their owners are refused at /auth/authorize until a later boot succeeds',
    );
    return null;
  }
}
