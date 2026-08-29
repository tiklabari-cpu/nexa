/**
 * The scheduled-report sweep (07.9-sched-e): deliver each due report exactly
 * once, to its own workspace's recipients.
 *
 * There is no production scheduler in this environment (a project boundary), so
 * — like the retention and chat-timeout sweeps — this is a job an operator runs
 * rather than a cron entry. That is precisely why it has to be safe to run
 * twice: a human retrying a job, an overlapping invocation, two API instances
 * both reaching for it. Where those two sweeps get idempotency for free (a
 * deleted row is not a candidate again; a closed chat is not idle again), this
 * one cannot: **a sent e-mail cannot be recalled**, and the only record of
 * whether it went out is a row this code writes itself.
 *
 * Three guards carry the feature, and they are separable:
 *
 *   1. **The period is deterministic** — `periodFor` derives a label from the
 *      frequency alone (never from the moment of the run), so two sweeps agree
 *      on what "this delivery" is. See `scheduled-report-period.ts`.
 *   2. **The claim precedes the side effect.** A run row is INSERTed *before*
 *      the mail is built or sent. `UNIQUE (scheduled_report_id, period_key)`
 *      turns the race into a constraint violation, so the loser of a tie learns
 *      "already taken" (Prisma `P2002`) and skips silently — that is a normal
 *      outcome, not an error. The order matters as much as the constraint: mail
 *      first and claim after would send twice whenever the claim failed. And
 *      the claim commits in its *own* transaction, because a claim rolled back
 *      alongside a failed delivery would release the period and let the next
 *      sweep mail the same report again.
 *   3. **RLS is the cross-tenant guard.** Every read, every write and the CSV
 *      itself run inside `withTenant`, so one workspace's report can neither be
 *      built from nor delivered to another's data. The tenant list comes from
 *      the one SECURITY DEFINER enumerator, `retention_list_tenants()` — the
 *      same one the other two sweeps share.
 *
 * A failed delivery keeps its row as `failed` rather than releasing it: the
 * period is *consumed*, not retried. Retry and backoff are out of scope for v1
 * (assumption #11), and the alternative — deleting the row so a later sweep
 * tries again — cannot distinguish "the mail never went out" from "the mail
 * went out and the bookkeeping failed after it", so it would risk a duplicate
 * every time it was wrong. The row is what a later window's history endpoint
 * (07.9-sched-g) reads, so nothing fails quietly either way.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ScheduledExportFrequency } from '@nexa/types';
import { type TenantContext, withTenant, withTenantRead } from '../../lib/tenant.js';
import { exportFilename, reportGroup, toCsv } from '../../routes/reports-export.js';
import type { Mailer } from '../mail/mailer.js';
import { buildGroupCsv } from './report-csv.js';
import { buildScheduledReportMail } from './scheduled-report-mail.js';
import { periodFor, type ReportPeriod } from './scheduled-report-period.js';

/**
 * How much of a failure's message is kept. Long enough to name the cause,
 * bounded because the text is written to a column the history screen renders
 * and an unbounded provider error (a stack, a whole rejected payload) belongs
 * in logs rather than in a workspace-visible field.
 */
const ERROR_MAX_LENGTH = 500;

export interface ScheduledReportDelivery {
  scheduledReportId: string;
  /** The `REPORT_GROUPS` id the definition names. */
  group: string;
  /** The period claimed, or null when none could be derived — see `#deliver`. */
  periodKey: string | null;
  /**
   * `delivered` is the run row's `sent`: the row's spelling is fixed by
   * `scheduled_report_runs_status_check`, and this report reads as prose.
   * `skipped` never reaches the table — it means the period was already taken
   * (or is being taken right now by another sweep).
   */
  status: 'delivered' | 'skipped' | 'failed';
  /** Recipients the mail actually reached — not the number configured. */
  recipientCount: number;
  /** Data rows in the CSV, excluding the header row. */
  rowCount: number;
  error: string | null;
}

export interface TenantScheduledReportResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  deliveries: ScheduledReportDelivery[];
  delivered: number;
  skipped: number;
  failed: number;
}

export interface ScheduledReportSweepReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantScheduledReportResult[];
  totals: { tenants: number; delivered: number; skipped: number; failed: number };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

/** One enabled definition, as the sweep needs it. */
interface DefinitionRow {
  id: string;
  groupId: string;
  frequency: string;
  recipients: string[];
}

export class ScheduledReportSweeper {
  readonly #db: PrismaClient;
  readonly #readDb: PrismaClient;
  readonly #mailer: Mailer;

  /**
   * `readDb` is the read path (M-SCALE-c): the replica when one is configured,
   * the primary otherwise, and it defaults to `db` so a caller with no opinion
   * — every test in this repo, both CLI entry points — behaves as before.
   *
   * Only the CSV is built there. The claim and the resolution stay on `db`, and
   * that split is guard 2 above, not a preference: the whole point of INSERTing
   * the run row before the mail is that the database serialises the race, and a
   * claim written to the primary but *read back* from a replica that has not
   * caught up would let two sweeps both believe they won. Nothing here reads the
   * claim back — the constraint violation is the answer — but a future guard
   * that does must not find it on a lagging connection.
   */
  constructor(db: PrismaClient, mailer: Mailer, readDb: PrismaClient = db) {
    this.#db = db;
    this.#readDb = readDb;
    this.#mailer = mailer;
  }

  /**
   * `now` is injected for the same reason `periodFor` takes it: a test must be
   * able to sweep the same instant twice and prove the second pass sends
   * nothing, which is the whole single-delivery guarantee.
   */
  async run(options: { now?: Date } = {}): Promise<ScheduledReportSweepReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const tenants = await this.#listTenants();
    const results: TenantScheduledReportResult[] = [];
    for (const tenant of tenants) {
      results.push(await this.#sweepTenant(tenant, now));
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        delivered: results.reduce((sum, r) => sum + r.delivered, 0),
        skipped: results.reduce((sum, r) => sum + r.skipped, 0),
        failed: results.reduce((sum, r) => sum + r.failed, 0),
      },
    };
  }

  /**
   * Cross-tenant read via the shared SECURITY DEFINER enumerator — the only
   * place the job steps outside a single-tenant context, and it reads nothing
   * but the two ids the loop needs.
   */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantScheduledReportResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };

    const definitions = await this.#enabledDefinitions(context);
    const deliveries: ScheduledReportDelivery[] = [];
    for (const definition of definitions) {
      deliveries.push(await this.#deliver(context, definition, now));
    }

    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      deliveries,
      delivered: deliveries.filter((d) => d.status === 'delivered').length,
      skipped: deliveries.filter((d) => d.status === 'skipped').length,
      failed: deliveries.filter((d) => d.status === 'failed').length,
    };
  }

  /**
   * This tenant's live definitions. `enabled: false` is filtered here rather
   * than skipped later, so a disabled schedule never claims a period — turning
   * one off and back on would otherwise find its periods already consumed and
   * silently deliver nothing.
   */
  async #enabledDefinitions(context: TenantContext): Promise<DefinitionRow[]> {
    return withTenant(this.#db, context, async (tx) =>
      tx.scheduledReport.findMany({
        where: { licenseId: context.licenseId, enabled: true },
        select: { id: true, groupId: true, frequency: true, recipients: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * One definition, one period: claim it, then build and send.
   *
   * The period is computed before the claim because the claim is *keyed* on it.
   * That is also why a definition whose frequency yields no period is reported
   * as `failed` with no run row: there is no key to write a row under. The
   * database's `scheduled_reports_frequency_check` makes it unreachable; it is
   * reported rather than thrown so one broken definition cannot stop the sweep
   * for the rest of the workspace.
   */
  async #deliver(
    context: TenantContext,
    definition: DefinitionRow,
    now: Date,
  ): Promise<ScheduledReportDelivery> {
    let period: ReportPeriod;
    try {
      period = periodFor(definition.frequency as ScheduledExportFrequency, now);
    } catch (error) {
      return {
        scheduledReportId: definition.id,
        group: definition.groupId,
        periodKey: null,
        status: 'failed',
        recipientCount: 0,
        rowCount: 0,
        error: sanitiseError(error),
      };
    }

    const base = {
      scheduledReportId: definition.id,
      group: definition.groupId,
      periodKey: period.periodKey,
    };

    const runId = await this.#claim(context, definition.id, period);
    // Someone else holds this period — the second sweep of a repeated trigger,
    // or a concurrent one that won the insert. Not an error: the report is
    // already delivered, or is being delivered right now.
    if (runId === null) {
      return { ...base, status: 'skipped', recipientCount: 0, rowCount: 0, error: null };
    }

    // Past this point the period is consumed. Everything that can fail is
    // resolved onto the claimed row rather than left `pending`, so no delivery
    // ends without a record of how it ended.
    let recipientCount = 0;
    let rowCount = 0;
    try {
      const table = await withTenantRead(this.#readDb, context, (tx) =>
        buildGroupCsv(tx, context.licenseId, definition.groupId, period.from, period.to),
      );
      rowCount = table.rows.length;

      const mail = buildScheduledReportMail({
        groupLabel: reportGroup(definition.groupId)?.label ?? definition.groupId,
        periodFrom: period.from,
        periodTo: period.to,
        csv: toCsv(table.headers, table.rows),
        rowCount,
        filename: exportFilename(definition.groupId, period.from, period.to),
      });

      // One message per recipient rather than one with many addressees: the
      // recipients are colleagues, but a combined header would still tell each
      // of them who else receives the workspace's figures. Counted as they go
      // out, so a provider that fails halfway records what actually landed.
      for (const to of definition.recipients) {
        await this.#mailer.send({
          to,
          subject: mail.subject,
          body: mail.body,
          kind: 'scheduled_report',
        });
        recipientCount += 1;
      }

      await this.#resolve(context, runId, definition.id, {
        status: 'sent',
        recipientCount,
        rowCount,
        error: null,
        deliveredAt: now,
      });
      return { ...base, status: 'delivered', recipientCount, rowCount, error: null };
    } catch (error) {
      const message = sanitiseError(error);
      await this.#resolve(context, runId, definition.id, {
        status: 'failed',
        recipientCount,
        rowCount,
        error: message,
        deliveredAt: null,
      });
      return { ...base, status: 'failed', recipientCount, rowCount, error: message };
    }
  }

  /**
   * Take the period, or discover it is already taken. Returns the new run's id,
   * or null when the unique constraint refused the insert.
   *
   * A `findFirst`-then-`create` check would look equivalent and be wrong: two
   * sweeps could both read "no row" before either wrote one, and both would
   * mail. The INSERT *is* the test — the database serialises it, so exactly one
   * caller can win, whether the other is in this process, another instance, or
   * the same operator running the job twice.
   *
   * This commits on its own. A claim sharing a transaction with the delivery
   * would be rolled back by a delivery failure, releasing the period.
   */
  async #claim(
    context: TenantContext,
    scheduledReportId: string,
    period: ReportPeriod,
  ): Promise<string | null> {
    try {
      const run = await withTenant(this.#db, context, (tx) =>
        tx.scheduledReportRun.create({
          data: {
            licenseId: context.licenseId,
            scheduledReportId,
            periodKey: period.periodKey,
            periodFrom: period.from,
            periodTo: period.to,
            status: 'pending',
          },
          select: { id: true },
        }),
      );
      return run.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /**
   * Close out a claimed run. `updateMany` with the licence in the filter, like
   * the rest of this surface: RLS already narrows the table, and the redundant
   * predicate means a mistake here cannot become a cross-tenant write.
   *
   * `last_run_at` moves only on success — it is the "you are receiving these"
   * signal the settings screen shows (07.9-sched-h), and a failed attempt did
   * not deliver anything.
   */
  async #resolve(
    context: TenantContext,
    runId: string,
    scheduledReportId: string,
    outcome: {
      status: 'sent' | 'failed';
      recipientCount: number;
      rowCount: number;
      error: string | null;
      deliveredAt: Date | null;
    },
  ): Promise<void> {
    await withTenant(this.#db, context, async (tx) => {
      await tx.scheduledReportRun.updateMany({
        where: { id: runId, licenseId: context.licenseId },
        data: {
          status: outcome.status,
          recipientCount: outcome.recipientCount,
          rowCount: outcome.rowCount,
          error: outcome.error,
        },
      });
      if (outcome.deliveredAt !== null) {
        await tx.scheduledReport.updateMany({
          where: { id: scheduledReportId, licenseId: context.licenseId },
          data: { lastRunAt: outcome.deliveredAt },
        });
      }
    });
  }
}

/**
 * A failure as one bounded line.
 *
 * Whitespace is collapsed because the text lands in a single-line column and a
 * driver error arrives as a paragraph; the length cap is the real point, since
 * what a provider or the query layer puts in a message is not under this code's
 * control and this field is read back by the workspace.
 */
function sanitiseError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const message = collapsed === '' ? 'Delivery failed.' : collapsed;
  return message.length > ERROR_MAX_LENGTH ? `${message.slice(0, ERROR_MAX_LENGTH - 1)}…` : message;
}
