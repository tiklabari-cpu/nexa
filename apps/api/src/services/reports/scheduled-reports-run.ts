/**
 * `scheduled-reports:run` — the manual trigger for the scheduled-report sweep
 * (07.9-sched-e/-f).
 *
 * There is no production scheduler in this environment (a project boundary), so
 * — like `retention:run` and `chat-timeout:run` — this is a script an operator
 * (or a host cron outside the app) runs. It connects as the runtime (RLS-bound)
 * role, so every read and delivery is scoped to its own workspace exactly as a
 * request would be.
 *
 * Safety default: **dry-run**, because a sent e-mail cannot be recalled — the
 * same reasoning `retention:run` uses for an irreversible delete. But this
 * sweep's dry-run cannot be a parameter the sweeper itself understands: unlike
 * a delete that a runner can simply not execute, `ScheduledReportSweeper`'s
 * claim (the INSERT into `scheduled_report_runs`) *is* the guarantee — running
 * it "without committing" would defeat the single-delivery property it exists
 * to prove. So dry-run here never calls the sweeper at all. It walks the same
 * tenants and enabled definitions the sweeper would, computes each one's
 * current period with the same `periodFor`, and reports whether that period is
 * still open — writing nothing and sending nothing. `--apply` is the only path
 * that claims and delivers.
 *
 *   pnpm --filter @nexa/api scheduled-reports:run            # dry-run: list only
 *   pnpm --filter @nexa/api scheduled-reports:run --apply    # actually deliver
 */
import { loadEnvFile } from '../../config/load-env-file.js';

loadEnvFile();

import { PrismaClient } from '@prisma/client';
import type { ScheduledExportFrequency } from '@nexa/types';
import { parseEnv } from '../../config/env.js';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import { FileMailer } from '../mail/mailer.js';
import { periodFor } from './scheduled-report-period.js';
import { ScheduledReportSweeper } from './scheduled-report-sweeper.js';

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

interface PreviewDefinition {
  scheduledReportId: string;
  group: string;
  frequency: string;
  /** Null only if the frequency yields no period — unreachable through the
   *  database's own CHECK constraint, kept for symmetry with the sweeper. */
  periodKey: string | null;
  /** A run row already exists for this period — `--apply` would skip it. */
  alreadyClaimed: boolean;
}

interface TenantPreview {
  licenseId: string;
  organizationId: string;
  definitions: PreviewDefinition[];
}

interface PreviewReport {
  startedAt: string;
  finishedAt: string;
  dryRun: true;
  tenants: TenantPreview[];
  totals: { tenants: number; ready: number; alreadyClaimed: number };
}

/** This tenant's enabled definitions — same filter the sweeper applies, so a
 *  disabled schedule never appears as "ready". */
async function enabledDefinitions(
  db: PrismaClient,
  context: TenantContext,
): Promise<{ id: string; groupId: string; frequency: string }[]> {
  return withTenant(db, context, (tx) =>
    tx.scheduledReport.findMany({
      where: { licenseId: context.licenseId, enabled: true },
      select: { id: true, groupId: true, frequency: true },
      orderBy: { createdAt: 'asc' },
    }),
  );
}

async function previewDefinition(
  db: PrismaClient,
  context: TenantContext,
  definition: { id: string; groupId: string; frequency: string },
  now: Date,
): Promise<PreviewDefinition> {
  const base = {
    scheduledReportId: definition.id,
    group: definition.groupId,
    frequency: definition.frequency,
  };

  let periodKey: string;
  try {
    periodKey = periodFor(definition.frequency as ScheduledExportFrequency, now).periodKey;
  } catch {
    return { ...base, periodKey: null, alreadyClaimed: false };
  }

  const existing = await withTenant(db, context, (tx) =>
    tx.scheduledReportRun.findUnique({
      where: { scheduledReportId_periodKey: { scheduledReportId: definition.id, periodKey } },
      select: { id: true },
    }),
  );

  return { ...base, periodKey, alreadyClaimed: existing !== null };
}

async function preview(db: PrismaClient, now: Date): Promise<PreviewReport> {
  const startedAt = now.toISOString();
  const tenantRows = await db.$queryRaw<TenantRow[]>`
    SELECT license_id, organization_id FROM retention_list_tenants()`;

  const tenants: TenantPreview[] = [];
  for (const row of tenantRows) {
    const context: TenantContext = {
      licenseId: row.license_id,
      organizationId: row.organization_id,
    };
    const definitions = await enabledDefinitions(db, context);
    const previewed: PreviewDefinition[] = [];
    for (const definition of definitions) {
      previewed.push(await previewDefinition(db, context, definition, now));
    }
    tenants.push({
      licenseId: row.license_id.toString(),
      organizationId: row.organization_id,
      definitions: previewed,
    });
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    dryRun: true,
    tenants,
    totals: {
      tenants: tenants.length,
      ready: tenants.reduce(
        (sum, t) => sum + t.definitions.filter((d) => !d.alreadyClaimed).length,
        0,
      ),
      alreadyClaimed: tenants.reduce(
        (sum, t) => sum + t.definitions.filter((d) => d.alreadyClaimed).length,
        0,
      ),
    },
  };
}

async function main(): Promise<void> {
  const env = parseEnv();
  const apply = process.argv.includes('--apply');
  const dryRun = !apply;
  const now = new Date();

  const db = new PrismaClient({ datasourceUrl: env.runtimeDatabaseUrl });
  try {
    if (dryRun) {
      const report = await preview(db, now);
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.stderr.write(
        `scheduled-reports dry-run (nothing sent; pass --apply to deliver): ` +
          `${report.totals.ready} ready, ${report.totals.alreadyClaimed} already claimed ` +
          `across ${report.totals.tenants} tenant(s)\n`,
      );
      return;
    }

    const report = await new ScheduledReportSweeper(db, new FileMailer(env.MAIL_DIR)).run({ now });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    const { totals } = report;
    process.stderr.write(
      `scheduled-reports applied: ${totals.delivered} delivered, ${totals.skipped} skipped, ` +
        `${totals.failed} failed across ${totals.tenants} tenant(s)\n`,
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
