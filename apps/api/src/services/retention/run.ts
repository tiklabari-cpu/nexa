/**
 * `retention:run` — the manual trigger for the retention sweep (NFR-C8).
 *
 * There is no *external* scheduler in this environment (a project boundary) —
 * no host cron, no managed job runner — so this script is how an operator (or
 * CI) drives the sweep by hand. Since M-SCHED-b the in-process scheduler
 * (`services/scheduler/jobs.ts`) also calls `RetentionRunner.run()` on its own
 * interval, gated by `RETENTION_ENABLED` (see `.env.example`) — that flag
 * stands in for the `--apply` an operator would type here, because a
 * scheduled pass has no operator to ask. This script's own `--apply` is
 * unaffected by that flag and is still required every time. It connects as
 * the runtime (RLS-bound) role, so every delete is subject to tenant
 * isolation just as a request would be.
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
