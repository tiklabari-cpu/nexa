/**
 * The period-close sweep (FR-MOD-10.3): freeze each closed billing period into
 * a statement, exactly once.
 *
 * This is the write half of persistent invoice history. Until it existed the
 * history was derived on read and every past period was priced from whatever
 * `subscriptions` said at that moment — so a plan change rewrote statements the
 * workspace had already been shown. Freezing is the only fix that survives the
 * next plan change, and freezing needs something to run when a month ends.
 *
 * Like `sla-sweep.ts` and `knowledge-refresh-sweep.ts` it walks every tenant
 * through the shared SECURITY DEFINER enumerator and does all its work inside
 * `withTenant`, so RLS scopes every read and every insert to one workspace —
 * one tenant's statement can neither be built from nor written into another's
 * data.
 *
 * **Three properties carry it, and they are separable.**
 *
 *   1. **Only closed periods.** The current period is never written. It has not
 *      ended, nothing has been billed, and its figures are supposed to move; the
 *      list endpoint serves it as an `estimate` computed on read. The database
 *      agrees rather than trusting this code — `invoices_status_check` refuses
 *      `open` and `invoices_origin_check` refuses `estimate`.
 *
 *   2. **Idempotent by constraint, not by care.** `UNIQUE (license_id, period)`
 *      is the guarantee. A second pass — the scheduler ticking while an operator
 *      runs the CLI, two API instances, a retry — loses the race on the INSERT
 *      and is told "already closed" (Prisma `P2002`), which is a normal outcome
 *      and not an error. Checking first and inserting after would leave a window
 *      wide enough to bill a workspace twice for the same month.
 *
 *   3. **A statement is all of its lines or none of them.** The invoice and its
 *      line items go in one transaction, so a crash between them cannot leave a
 *      total with nothing to explain it — and because the invoice row is what
 *      the unique index guards, a half-written statement can never be mistaken
 *      for a closed period on the next pass.
 *
 * **Backfill.** A period that closed before this table existed also has no row,
 * and the first pass writes it too — marked `origin: 'reconstructed'` rather
 * than `issued`. The distinction is real, not decorative: an `issued` row was
 * frozen in the month right after its period, from the subscription as it then
 * stood, while a reconstruction can only price the *seat* line from the
 * subscription at write time, because per-period seat history was never
 * retained. Everything else in a reconstruction is exact — a `usage_records`
 * row carries the allowance and unit price that produced it, and each purchase
 * carries its own price. Writing a reconstruction unmarked would be worse than
 * the derivation it replaces: same guess, now permanent and no longer visibly a
 * guess.
 *
 * **What is not swept.** A period with no usage record and no purchase gets no
 * statement, exactly as the derived path listed no such period. A workspace that
 * did nothing for a month leaves no evidence that the month happened, and
 * inventing one would mean inventing statements for every month before the
 * workspace existed.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import type { Env } from '../../config/env.js';
import { type TenantContext, withTenant } from '../../lib/tenant.js';
import {
  composeInvoice,
  INVOICE_CURRENCY,
  invoiceNumber,
  issuedAt,
  periodWindow,
  previousPeriod,
  readComposition,
} from './invoice-service.js';
import { currentPeriod } from './metering.js';

export interface TenantInvoiceCloseResult {
  /** Stringified: a bigint cannot be JSON-serialised, and this report is JSON. */
  licenseId: string;
  organizationId: string;
  /** Closed periods with evidence and no statement yet. */
  candidates: number;
  /** Statements written this pass, by how they were arrived at. */
  issued: number;
  reconstructed: number;
  /** Lost the race for a period another pass had already closed. */
  skipped: number;
}

export interface InvoiceCloseReport {
  startedAt: string;
  finishedAt: string;
  tenants: TenantInvoiceCloseResult[];
  totals: {
    tenants: number;
    issued: number;
    reconstructed: number;
    skipped: number;
  };
}

interface TenantRow {
  license_id: bigint;
  organization_id: string;
}

export class InvoiceCloseSweeper {
  readonly #db: PrismaClient;
  readonly #env: Env;

  constructor(db: PrismaClient, env: Env) {
    this.#db = db;
    this.#env = env;
  }

  async run(options: { now?: Date } = {}): Promise<InvoiceCloseReport> {
    const now = options.now ?? new Date();
    const startedAt = now.toISOString();

    const results: TenantInvoiceCloseResult[] = [];
    for (const tenant of await this.#listTenants()) {
      results.push(await this.#sweepTenant(tenant, now));
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      tenants: results,
      totals: {
        tenants: results.length,
        issued: results.reduce((sum, r) => sum + r.issued, 0),
        reconstructed: results.reduce((sum, r) => sum + r.reconstructed, 0),
        skipped: results.reduce((sum, r) => sum + r.skipped, 0),
      },
    };
  }

  /**
   * Cross-tenant read via the shared SECURITY DEFINER enumerator — the only
   * place this sweep steps outside a single-tenant context, and it reads
   * nothing but the two ids the loop needs. The same function `sla-sweep.ts`,
   * the knowledge refresh and the retention runner already share.
   */
  async #listTenants(): Promise<TenantRow[]> {
    return this.#db.$queryRaw<TenantRow[]>`
      SELECT license_id, organization_id FROM retention_list_tenants()`;
  }

  async #sweepTenant(tenant: TenantRow, now: Date): Promise<TenantInvoiceCloseResult> {
    const context: TenantContext = {
      licenseId: tenant.license_id,
      organizationId: tenant.organization_id,
    };
    const open = currentPeriod(now);
    const justClosed = previousPeriod(open);

    const periods = await this.#closedPeriodsWithoutStatement(context, open);

    const result: TenantInvoiceCloseResult = {
      licenseId: tenant.license_id.toString(),
      organizationId: tenant.organization_id,
      candidates: periods.length,
      issued: 0,
      reconstructed: 0,
      skipped: 0,
    };

    // Oldest first, so a history written in one pass reads in the order it
    // happened — and so an interrupted pass leaves a prefix rather than holes.
    for (const period of periods) {
      const origin = period === justClosed ? 'issued' : 'reconstructed';
      const written = await this.#freeze(context, period, origin);
      if (!written) result.skipped += 1;
      else if (origin === 'issued') result.issued += 1;
      else result.reconstructed += 1;
    }

    return result;
  }

  /**
   * Closed periods this workspace has evidence for and no statement for yet.
   *
   * One query rather than three finds plus a set union in JavaScript: the three
   * sources are the three tables that record something billable happening in a
   * period, and asking the database to distinct them keeps a workspace with a
   * long history from being read into memory just to be de-duplicated. The
   * anti-join against `invoices` is what makes a second pass cheap — after the
   * first, this returns nothing.
   *
   * `license_id` is written out on all four tables even though RLS already
   * scopes them, and here that is not belt and braces. `runtimeDatabaseUrl`
   * falls back to `DATABASE_URL` when no `DATABASE_APP_URL` is configured —
   * every developer machine, and the demo seed — and Postgres exempts a table's
   * owner from row level security. This one query is raw SQL with no Prisma
   * `where` behind it, so under that role it would otherwise union *every*
   * workspace's periods and close them all against one tenant's subscription.
   * The predicate also lets the planner use the `(license_id, period)` indexes
   * directly.
   */
  async #closedPeriodsWithoutStatement(context: TenantContext, open: string): Promise<string[]> {
    const licenseId = context.licenseId;
    const rows = await withTenant(
      this.#db,
      context,
      (tx) =>
        tx.$queryRaw<{ period: string }[]>`
        SELECT period FROM (
          SELECT period FROM usage_records WHERE license_id = ${licenseId}
          UNION
          SELECT period FROM api_package_purchases WHERE license_id = ${licenseId}
          UNION
          SELECT period FROM ai_package_purchases WHERE license_id = ${licenseId}
        ) AS evidence
        WHERE period < ${open}
          AND period NOT IN (SELECT period FROM invoices WHERE license_id = ${licenseId})
        ORDER BY period ASC`,
    );
    return rows.map((row) => row.period);
  }

  /**
   * Freeze one period. `false` means another pass got there first.
   *
   * The composition is read inside the same transaction that writes the
   * statement, so the figures cannot move between being computed and being
   * stored — a purchase landing mid-freeze either makes it onto the statement or
   * is not seen at all, never half of each.
   */
  async #freeze(
    context: TenantContext,
    period: string,
    origin: 'issued' | 'reconstructed',
  ): Promise<boolean> {
    const window = periodWindow(period);

    try {
      await withTenant(this.#db, context, async (tx) => {
        const composed = composeInvoice(await readComposition(tx, context, period, this.#env));

        const invoice = await tx.invoice.create({
          data: {
            licenseId: context.licenseId,
            number: invoiceNumber(period),
            period,
            periodStart: window.start,
            periodEnd: window.end,
            issuedAt: issuedAt(period),
            origin,
            status: composed.trialing ? 'trial' : 'paid',
            currency: INVOICE_CURRENCY,
            subtotalCents: composed.subtotal_cents,
            totalCents: composed.total_cents,
          },
          select: { id: true },
        });

        await tx.invoiceLineItem.createMany({
          data: composed.line_items.map((item, position) => ({
            invoiceId: invoice.id,
            licenseId: context.licenseId,
            position,
            description: item.description,
            amountCents: item.amount_cents,
          })),
        });
      });
      return true;
    } catch (error) {
      // `P2002` is the unique index doing its job: another pass closed this
      // period between the anti-join above and this insert. Not an error — it is
      // the outcome the constraint exists to produce.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }
}
