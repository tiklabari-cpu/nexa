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
 *
 * One refusal is not a failure: the daily mail cap (tm 257.14). When it
 * refuses a delivery before anything went out, nothing can be sent twice by
 * trying again — the cap answered before the carrier was asked — so the run
 * is resolved `failed` with {@link MAIL_CAP_DEFERRED} as its error, and the
 * next sweep *re-claims* that row (one conditional UPDATE, which the database
 * serialises like the INSERT) instead of skipping it. Re-claimed rather than
 * deleted: the application role has no DELETE on runs (see the migration),
 * and the row tells the history screen what happened in the meantime. A cap
 * that stops a delivery halfway, after some recipient may already have it,
 * consumes the period as any failure does.
 *
 * **Recipients are checked again at send time (tm 440 · F23).** The stored
 * list was validated when the schedule was saved; a member suspended, removed
 * or stripped of report access since then is dropped here, by the same roster
 * the save used (`reportRecipientRoster`). The drop is logged with the
 * addresses masked and counted on the run (`skipped_recipient_count`); when
 * nobody is left, the period is resolved `skipped` (`no_recipients`) rather
 * than mailed to no one or failed.
 *
 * **Missed periods are caught up, within a bound (tm 460 · F46).** A host that
 * was down when a period fell due used to skip it without a trace, because
 * each sweep only ever looked at the current period. `duePeriods` now walks
 * back to the schedule's newest run: the newest few missed periods are claimed
 * and mailed oldest first, the older ones are recorded `skipped`
 * (`missed_window`). Every one of them goes through the same unique claim, so
 * two sweeps catching up at once still mail each period once.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { ScheduledExportFrequency, ScheduledExportSkipReason } from '@siyahtus/types';
import { type TenantContext, withTenant, withTenantRead } from '../../lib/tenant.js';
import { exportFilename, reportGroup, toCsv } from '../../routes/reports-export.js';
import { deliver, isCapRefusal } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import { buildGroupCsv } from './report-csv.js';
import { storedReportFilter, toThreadFilter } from './report-filter.js';
import { buildScheduledReportMail } from './scheduled-report-mail.js';
import type { MailLocale } from '../mail/templates/layout.js';
import { duePeriods, type DuePeriods, type ReportPeriod } from './scheduled-report-period.js';
import {
  maskRecipient,
  reportRecipientRoster,
  splitRecipients,
  type ReportRecipientRoster,
} from './scheduled-report-recipients.js';

/** Where the sweep writes the one line it has to say (a dropped recipient) — pino or Fastify's logger. */
export interface ScheduledReportSweepLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

/**
 * How much of a failure's message is kept. Long enough to name the cause,
 * bounded because the text is written to a column the history screen renders
 * and an unbounded provider error (a stack, a whole rejected payload) belongs
 * in logs rather than in a workspace-visible field.
 */
const ERROR_MAX_LENGTH = 500;

/**
 * The error a run carries while the daily mail cap holds it back (tm 257.14):
 * nothing went out, and the next sweep re-claims the period. Read back by
 * {@link isDeferredRun} — the text is the marker, so it must not change.
 */
export const MAIL_CAP_DEFERRED =
  "Today's email limit was reached before this report went out; the next sweep sends it.";

/** Whether a stored run is one the daily mail cap deferred, and so re-claimable. */
export function isDeferredRun(run: {
  status: string;
  recipientCount: number;
  error: string | null;
}): boolean {
  return run.status === 'failed' && run.recipientCount === 0 && run.error === MAIL_CAP_DEFERRED;
}

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
   * (or is being taken right now by another sweep). `deferred` is a run the
   * daily mail cap refused before anything went out (tm 257.14): stored as
   * `failed` with {@link MAIL_CAP_DEFERRED}, re-claimed by the next sweep.
   * `not_sent` is a period this sweep recorded as the row's `skipped` without
   * mailing it — `skipReason` says why (tm 440 · tm 460).
   */
  status: 'delivered' | 'skipped' | 'failed' | 'deferred' | 'not_sent';
  /** Recipients the mail actually reached — not the number configured. */
  recipientCount: number;
  /** Configured recipients the send-time roster check left out (tm 440). */
  skippedRecipientCount: number;
  /** Why a `not_sent` period was not mailed; null otherwise. */
  skipReason: ScheduledExportSkipReason | null;
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
  deferred: number;
  notSent: number;
}

export interface ScheduledReportSweepReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantScheduledReportResult[];
  totals: {
    tenants: number;
    delivered: number;
    skipped: number;
    failed: number;
    deferred: number;
    notSent: number;
  };
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
  /** The stored report filter (RP-01), a JSONB `ReportFilter`. */
  filters: unknown;
  /** When the schedule last started — the floor of its catch-up (tm 460). */
  enabledAt: Date;
}

type Outcome = Omit<ScheduledReportDelivery, 'scheduledReportId' | 'group' | 'periodKey'>;

const NOTHING_SENT = {
  recipientCount: 0,
  skippedRecipientCount: 0,
  skipReason: null,
  rowCount: 0,
  error: null,
} as const;

export class ScheduledReportSweeper {
  readonly #db: PrismaClient;
  readonly #readDb: PrismaClient;
  readonly #mailer: Mailer;
  readonly #logger: ScheduledReportSweepLogger | null;

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
   * that does must not find it on a lagging connection. The recipient roster
   * is read on `db` too: it is the check that stops a suspended member's mail,
   * and a replica that has not seen the suspension yet would let one through.
   */
  constructor(
    db: PrismaClient,
    mailer: Mailer,
    readDb: PrismaClient = db,
    options: { logger?: ScheduledReportSweepLogger } = {},
  ) {
    this.#db = db;
    this.#readDb = readDb;
    this.#mailer = mailer;
    this.#logger = options.logger ?? null;
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
        deferred: results.reduce((sum, r) => sum + r.deferred, 0),
        notSent: results.reduce((sum, r) => sum + r.notSent, 0),
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
    if (definitions.length > 0) {
      // Both read before any claim, so a database error here throws before a
      // single period is consumed — like a failure to list the definitions.
      const lastClaimed = await this.#lastClaimedFrom(context);
      const roster = await withTenant(
        this.#db,
        context,
        (tx) => reportRecipientRoster(tx, context.licenseId),
        { readOnly: true },
      );
      for (const definition of definitions) {
        deliveries.push(
          ...(await this.#sweepDefinition(
            context,
            definition,
            now,
            lastClaimed.get(definition.id) ?? null,
            roster,
          )),
        );
      }
    }

    const count = (status: ScheduledReportDelivery['status']): number =>
      deliveries.filter((d) => d.status === status).length;
    return {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      deliveries,
      delivered: count('delivered'),
      skipped: count('skipped'),
      failed: count('failed'),
      deferred: count('deferred'),
      notSent: count('not_sent'),
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
        select: {
          id: true,
          groupId: true,
          frequency: true,
          recipients: true,
          filters: true,
          enabledAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    );
  }

  /**
   * The start of each definition's newest claimed period, whatever became of
   * it — the floor of the catch-up (tm 460). Read on the primary: it decides
   * which periods are claimed next, the same side of the split as the claim.
   */
  async #lastClaimedFrom(context: TenantContext): Promise<Map<string, Date>> {
    const rows = await withTenant(
      this.#db,
      context,
      (tx) =>
        tx.scheduledReportRun.groupBy({
          by: ['scheduledReportId'],
          where: { licenseId: context.licenseId },
          _max: { periodFrom: true },
        }),
      { readOnly: true },
    );
    const out = new Map<string, Date>();
    for (const row of rows) {
      if (row._max.periodFrom) out.set(row.scheduledReportId, row._max.periodFrom);
    }
    return out;
  }

  /**
   * Every period one definition owes: the missed ones beyond the catch-up
   * allowance recorded `skipped`, then the due ones delivered, oldest first.
   *
   * The periods are computed before any claim because each claim is *keyed*
   * on one. That is also why a definition whose frequency yields no period is
   * reported as `failed` with no run row: there is no key to write a row
   * under. The database's `scheduled_reports_frequency_check` makes it
   * unreachable; it is reported rather than thrown so one broken definition
   * cannot stop the sweep for the rest of the workspace.
   */
  async #sweepDefinition(
    context: TenantContext,
    definition: DefinitionRow,
    now: Date,
    lastClaimedFrom: Date | null,
    roster: ReportRecipientRoster,
  ): Promise<ScheduledReportDelivery[]> {
    let due: DuePeriods;
    try {
      due = duePeriods(definition.frequency as ScheduledExportFrequency, now, {
        lastClaimedFrom,
        enabledAt: definition.enabledAt,
      });
    } catch (error) {
      return [
        {
          scheduledReportId: definition.id,
          group: definition.groupId,
          periodKey: null,
          ...NOTHING_SENT,
          status: 'failed',
          error: sanitiseError(error),
        },
      ];
    }

    const out: ScheduledReportDelivery[] = [];
    for (const period of due.missed) {
      out.push(
        this.#labelled(
          definition,
          period,
          await this.#recordMissed(context, definition.id, period),
        ),
      );
    }
    for (const period of due.deliver) {
      out.push(
        this.#labelled(
          definition,
          period,
          await this.#deliver(context, definition, period, now, roster),
        ),
      );
    }
    return out;
  }

  #labelled(
    definition: DefinitionRow,
    period: ReportPeriod,
    outcome: Outcome,
  ): ScheduledReportDelivery {
    return {
      scheduledReportId: definition.id,
      group: definition.groupId,
      periodKey: period.periodKey,
      ...outcome,
    };
  }

  /**
   * A missed period past the catch-up allowance (tm 460): recorded `skipped`
   * (`missed_window`) instead of mailed late, through the same unique claim —
   * a period another sweep already holds keeps its row.
   */
  async #recordMissed(
    context: TenantContext,
    scheduledReportId: string,
    period: ReportPeriod,
  ): Promise<Outcome> {
    try {
      await withTenant(this.#db, context, (tx) =>
        tx.scheduledReportRun.create({
          data: {
            licenseId: context.licenseId,
            scheduledReportId,
            periodKey: period.periodKey,
            periodFrom: period.from,
            periodTo: period.to,
            status: 'skipped',
            skipReason: 'missed_window',
          },
          select: { id: true },
        }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { ...NOTHING_SENT, status: 'skipped' };
      }
      throw error;
    }
    return { ...NOTHING_SENT, status: 'not_sent', skipReason: 'missed_window' };
  }

  /**
   * One period: claim it, check who may still receive it, then build and send.
   */
  async #deliver(
    context: TenantContext,
    definition: DefinitionRow,
    period: ReportPeriod,
    now: Date,
    roster: ReportRecipientRoster,
  ): Promise<Outcome> {
    const runId = await this.#claim(context, definition.id, period);
    // Someone else holds this period — the second sweep of a repeated trigger,
    // or a concurrent one that won the insert. Not an error: the report is
    // already delivered, or is being delivered right now.
    if (runId === null) {
      return { ...NOTHING_SENT, status: 'skipped' };
    }

    // The roster as it stands now, not as it stood when the schedule was saved
    // (tm 440). Dropped addresses are logged masked and counted on the run.
    const { kept, dropped } = splitRecipients(definition.recipients, roster);
    const skippedRecipientCount = dropped.length;
    if (dropped.length > 0) {
      this.#logger?.warn(
        {
          event: 'scheduled_report.recipients_dropped',
          scheduled_report_id: definition.id,
          period_key: period.periodKey,
          dropped_count: dropped.length,
          kept_count: kept.length,
          recipients_masked: dropped.map(maskRecipient),
        },
        'scheduled report recipients no longer on the roster were left out',
      );
    }
    if (kept.length === 0) {
      await this.#resolve(context, runId, definition.id, {
        status: 'skipped',
        recipientCount: 0,
        skippedRecipientCount,
        skipReason: 'no_recipients',
        rowCount: 0,
        error: null,
        deliveredAt: null,
      });
      return {
        ...NOTHING_SENT,
        status: 'not_sent',
        skippedRecipientCount,
        skipReason: 'no_recipients',
      };
    }

    // Past this point the period is consumed. Everything that can fail is
    // resolved onto the claimed row rather than left `pending`, so no delivery
    // ends without a record of how it ended.
    let recipientCount = 0;
    let rowCount = 0;
    try {
      const { table, workspaceName } = await withTenantRead(this.#readDb, context, async (tx) => {
        const [csvTable, organization] = await Promise.all([
          buildGroupCsv(
            tx,
            context.licenseId,
            definition.groupId,
            period.from,
            period.to,
            undefined,
            {
              // The definition's own report filter (RP-01), every run alike.
              thread: toThreadFilter(storedReportFilter(definition.filters)),
            },
          ),
          tx.organization.findUnique({
            where: { id: context.organizationId },
            select: { name: true },
          }),
        ]);
        return { table: csvTable, workspaceName: organization?.name ?? 'SiyahTuş' };
      });
      rowCount = table.rows.length;

      const csv = toCsv(table.headers, table.rows);
      const mailIn = (locale: MailLocale) =>
        buildScheduledReportMail({
          groupLabel: reportGroup(definition.groupId)?.label ?? definition.groupId,
          periodFrom: period.from,
          periodTo: period.to,
          csv,
          rowCount,
          filename: exportFilename(definition.groupId, period.from, period.to),
          workspaceName,
          locale,
        });
      const mails = { en: mailIn('en'), tr: mailIn('tr') };

      // One message per recipient rather than one with many addressees: the
      // recipients are colleagues, but a combined header would still tell each
      // of them who else receives the workspace's figures. Counted as they go
      // out, so a provider that fails halfway records what actually landed.
      //
      // Every recipient is tried (tm 255.4). A failure used to end the loop, and
      // because the period is consumed rather than retried, one colleague's
      // full mailbox cost everyone after them in the list this period's report
      // for good. The first failure is still what the run records, after the
      // others have had their turn. `unconfirmed` is not counted — it may have
      // landed, and this count only claims what is known to have.
      //
      // The daily mail cap (tm 257.14) ends the loop instead: every later
      // recipient would be refused too. If nothing can have gone out yet —
      // nothing sent, nothing `unconfirmed` — the period is handed to the next
      // sweep rather than consumed.
      let firstFailure: { error: unknown } | null = null;
      let mayHaveArrived = false;
      let capped = false;
      for (const member of kept) {
        const outcome = await deliver(this.#mailer, {
          to: member.email,
          licenseId: context.licenseId,
          // Each member reads the report in their panel language (tm 265).
          ...mails[member.locale],
          kind: 'scheduled_report',
        });
        if (outcome.status === 'sent') {
          recipientCount += 1;
        } else if (isCapRefusal(outcome)) {
          capped = true;
          break;
        } else {
          if (outcome.status === 'unconfirmed') mayHaveArrived = true;
          firstFailure ??= { error: outcome.error };
        }
      }
      if (capped && recipientCount === 0 && !mayHaveArrived) {
        await this.#resolve(context, runId, definition.id, {
          status: 'failed',
          recipientCount: 0,
          skippedRecipientCount,
          skipReason: null,
          rowCount,
          error: MAIL_CAP_DEFERRED,
          deliveredAt: null,
        });
        return {
          ...NOTHING_SENT,
          status: 'deferred',
          skippedRecipientCount,
          rowCount,
          error: MAIL_CAP_DEFERRED,
        };
      }
      if (capped) {
        throw new Error(
          `Today's email limit was reached after ${recipientCount} of ${kept.length} recipients.`,
        );
      }
      if (firstFailure) throw firstFailure.error;

      await this.#resolve(context, runId, definition.id, {
        status: 'sent',
        recipientCount,
        skippedRecipientCount,
        skipReason: null,
        rowCount,
        error: null,
        deliveredAt: now,
      });
      return {
        ...NOTHING_SENT,
        status: 'delivered',
        recipientCount,
        skippedRecipientCount,
        rowCount,
      };
    } catch (error) {
      const message = sanitiseError(error);
      await this.#resolve(context, runId, definition.id, {
        status: 'failed',
        recipientCount,
        skippedRecipientCount,
        skipReason: null,
        rowCount,
        error: message,
        deliveredAt: null,
      });
      return {
        ...NOTHING_SENT,
        status: 'failed',
        recipientCount,
        skippedRecipientCount,
        rowCount,
        error: message,
      };
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
   *
   * A period the daily mail cap deferred (tm 257.14) is taken back from its
   * `failed` row by a conditional UPDATE: the first sweep to reach the row
   * locks it, the second re-reads it once the first commits and no longer
   * matches — so exactly one caller wins here too.
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
        return this.#reclaimDeferred(context, scheduledReportId, period);
      }
      throw error;
    }
  }

  /** Take back a period the daily mail cap deferred, or null when it is not one. */
  async #reclaimDeferred(
    context: TenantContext,
    scheduledReportId: string,
    period: ReportPeriod,
  ): Promise<string | null> {
    return withTenant(this.#db, context, async (tx) => {
      const { count } = await tx.scheduledReportRun.updateMany({
        where: {
          licenseId: context.licenseId,
          scheduledReportId,
          periodKey: period.periodKey,
          status: 'failed',
          recipientCount: 0,
          error: MAIL_CAP_DEFERRED,
        },
        data: { status: 'pending', error: null },
      });
      if (count === 0) return null;
      const run = await tx.scheduledReportRun.findUnique({
        where: { scheduledReportId_periodKey: { scheduledReportId, periodKey: period.periodKey } },
        select: { id: true },
      });
      return run?.id ?? null;
    });
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
      status: 'sent' | 'failed' | 'skipped';
      recipientCount: number;
      skippedRecipientCount: number;
      skipReason: ScheduledExportSkipReason | null;
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
          skippedRecipientCount: outcome.skippedRecipientCount,
          skipReason: outcome.skipReason,
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
