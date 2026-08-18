/**
 * `siem:run` — the manual trigger for the scheduled SIEM sink (NFR-C6 · C6-d).
 *
 * There is no *external* scheduler in this environment (a project boundary) —
 * no host cron, no managed job runner — so, like `retention:run`,
 * `chat-timeout:run` and `scheduled-reports:run`, this is a script an
 * operator (or CI) drives by hand. Since M-SCHED-b the in-process scheduler
 * (`services/scheduler/jobs.ts`) also calls `SiemSink.run()` on its own
 * interval, the same way this script does. It connects as the runtime
 * (RLS-bound) role, so every read and delivery is scoped to its own
 * workspace exactly as a request would be.
 *
 * No dry-run, for the same reason `chat-timeout:run` has none: this sink's
 * failure mode is not something a preview needs to guard against. Retention
 * and the report sweep default to dry-run because their actions are
 * irreversible — a delete cannot be undone, a sent e-mail cannot be recalled.
 * This job's worst case on a crash or a rerun is a *redelivered* file (the
 * whole point of `siem-sink.ts`'s order invariant), which a SIEM consumer is
 * expected to de-duplicate on id — noise, not loss.
 *
 *   pnpm --filter @nexa/api siem:run
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import { parseEnv } from '../../config/env.js';
import { SiemSink } from './siem-sink.js';
import { createSiemTarget } from './siem-target.js';

async function main(): Promise<void> {
  const env = parseEnv();
  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  try {
    const sink = new SiemSink(db, {
      siemDir: env.SIEM_DIR,
      target: createSiemTarget(env.SIEM_PROVIDER, { siemDir: env.SIEM_DIR }),
      auditChainSecret: env.AUDIT_CHAIN_SECRET,
      horizonMs: env.SIEM_EXPORT_HORIZON_MS,
    });
    const report = await sink.run();

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const { totals } = report;
    process.stderr.write(
      `siem: delivered ${totals.delivered} entr${totals.delivered === 1 ? 'y' : 'ies'} ` +
        `(${totals.empty} empty, ${totals.skipped} skipped, ${totals.failed} failed) ` +
        `across ${totals.tenants} tenant(s)\n`,
    );
    if (totals.failed > 0) process.exitCode = 1;
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
