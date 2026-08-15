/**
 * `retention:run` — the manual trigger for the retention sweep (NFR-C8).
 *
 * There is no production scheduler in this environment (a project boundary), so
 * the sweep is a script an operator runs, not a cron job. It connects as the
 * runtime (RLS-bound) role, so every delete is subject to tenant isolation just
 * as a request would be.
 *
 * Safety default: **dry-run**. Because the sweep is irreversible, it only counts
 * unless invoked with `--apply`. The machine-readable report goes to stdout; a
 * one-line human summary goes to stderr.
 *
 *   pnpm --filter @nexa/api retention:run            # dry-run: count only
 *   pnpm --filter @nexa/api retention:run --apply    # actually delete
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../../config/env.js';
import { resolveRetentionPolicy } from './policy.js';
import { RetentionRunner } from './retention.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;

  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  try {
    const runner = new RetentionRunner(db, {
      policy: resolveRetentionPolicy(env),
      mailDir: env.MAIL_DIR,
      auditChainSecret: env.AUDIT_CHAIN_SECRET,
    });
    const report = await runner.run({ dryRun });

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const { totals } = report;
    process.stderr.write(
      `retention ${dryRun ? 'dry-run (nothing deleted; pass --apply to delete)' : 'applied'}: ` +
        `${totals.threads} thread(s), ${totals.visits} visit(s), ${totals.mailFiles} mail file(s), ` +
        `${totals.auditEntries} audit entr${totals.auditEntries === 1 ? 'y' : 'ies'} ` +
        `across ${totals.tenants} tenant(s)\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
