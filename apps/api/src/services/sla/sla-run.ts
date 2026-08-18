/**
 * `sla:run` — the manual trigger for the SLA sweep (FR-MOD-11.5 · 11.5-d).
 *
 * There is no *external* scheduler in this environment (a project boundary) —
 * no host cron, no managed job runner — so this script is how an operator (or
 * CI) drives the sweep by hand. Since M-SCHED-b the in-process scheduler
 * (`services/scheduler/jobs.ts`) also calls `SlaSweeper.run()` on its own
 * interval, the same way this script does. It connects as the runtime
 * (RLS-bound) role, so every read and every mark is scoped to its own
 * workspace exactly as a request would be.
 *
 * No dry-run: the sweep writes breach rows and sends alerts, neither of which
 * changes a conversation, a queue or an invoice (§C-A27). The blast radius of a
 * wrong pass is a mail nobody needed and a row Reports shows — recoverable, and
 * a preview would cost more than it saved.
 *
 * The machine-readable report goes to stdout; a one-line human summary to stderr.
 *
 *   pnpm --filter @nexa/api sla:run
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../../config/env.js';
import { createMailer } from '../mail/mailer.js';
import { SlaSweeper } from './sla-sweep.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  try {
    // Mail is written to disk like everything else outgoing (PLAN A4), so the
    // alert is inspectable rather than sent.
    const report = await new SlaSweeper(
      db,
      createMailer(env.MAIL_PROVIDER, { dir: env.MAIL_DIR }),
    ).run();

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.stderr.write(
      `sla: marked ${report.totals.marked} breach(es) and announced ` +
        `${report.totals.notified} across ${report.totals.tenants} tenant(s)\n`,
    );
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`sla: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
