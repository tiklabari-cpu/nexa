/**
 * `invoice-close:run` — the manual trigger for the period-close sweep
 * (FR-MOD-10.3).
 *
 * Mirrors `sla-run.ts` and `knowledge-refresh-run.ts`: there is no external
 * scheduler in this environment (a project boundary), so this script is how an
 * operator (or CI) drives the sweep by hand. The in-process scheduler
 * (`services/scheduler/jobs.ts`) calls the same `InvoiceCloseSweeper.run()` on
 * its own interval. It connects as the runtime (RLS-bound) role, so every read
 * and every write is scoped to its own workspace exactly as a request would be.
 *
 * **Run this once after deploying the persistent-invoice migration.** Periods
 * that closed before the `invoices` table existed have no statement, and the
 * list endpoint no longer invents one; the first pass writes them, marked
 * `reconstructed`. Waiting for the scheduler works too — it just leaves the
 * history short until the next tick.
 *
 * No dry-run, and the reason is the opposite of `scheduled-reports:run`'s. That
 * sweep sends mail, which cannot be recalled. This one writes a row that says
 * what a month already cost — running it changes no money, no quota and nothing
 * a customer receives; it only stops the figures moving. A period it has closed
 * cannot be closed again (`UNIQUE (license_id, period)`), so the safe thing is
 * to run it, not to preview it.
 *
 *   pnpm --filter @nexa/api invoice-close:run
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../../config/env.js';
import { InvoiceCloseSweeper } from './invoice-close-sweep.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  try {
    const report = await new InvoiceCloseSweeper(db, env).run();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const { totals } = report;
    process.stderr.write(
      `invoice-close: issued ${totals.issued}, reconstructed ${totals.reconstructed}, ` +
        `skipped ${totals.skipped} across ${totals.tenants} tenant(s)\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `invoice-close: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
