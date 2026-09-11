/**
 * Invoices (FR-MOD-10.3, "fatura listesi/indirme").
 *
 * Billing is mocked (ADR-13): no external provider issues invoices, so Nexa
 * issues its own. A period's statement is **composed once, when the period
 * closes, and frozen** into `invoices` + `invoice_line_items` by
 * `invoice-close-sweep.ts`; this module reads those rows back.
 *
 * That is the whole change this file exists to record. The history used to be
 * derived on every read, which meant every past period was priced from whatever
 * `subscriptions` said *at the moment of the request* — and the subscription is
 * a single row `updateSubscription` rewrites in place. Changing plan, seats or
 * cycle therefore restated statements the workspace had already been shown and
 * already downloaded, silently and retroactively. A frozen row cannot do that,
 * and the database withholds UPDATE and DELETE from `nexa_app` so it cannot be
 * quietly walked back either.
 *
 * The **current** period is the one thing still computed on read, and it is not
 * an invoice: it has not closed, nothing has been billed, and its figures are
 * *supposed* to move as usage accrues. It carries `origin: 'estimate'` and
 * `status: 'open'` (or `trial`), and its total is the same arithmetic
 * `estimated_total_cents` quotes, so the statement and the estimate can never
 * disagree about the month in progress.
 *
 * One arithmetic, two callers: {@link composeInvoice} is the only place a
 * statement's lines are built, and both the freeze and the estimate go through
 * it. A second copy would be how a period's invoice comes to price its overage
 * differently from the usage endpoint that produced it.
 */
import { findApiPackage } from '@nexa/types';
import type { Env } from '../../config/env.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { currentPeriod, trialState } from './metering.js';
import { priceSeats, type BillingCycle } from './subscription-service.js';

/** English month names, so a period label is deterministic and locale-free. */
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/** Every statement is in US dollars — the catalogue quotes no other currency. */
export const INVOICE_CURRENCY = 'usd';

export interface InvoiceLineItem {
  description: string;
  amount_cents: number;
}

export type InvoiceStatus = 'paid' | 'open' | 'trial';

/**
 * Where an invoice's figures come from.
 *
 * Only the first two are storable — the CHECK on `invoices.origin` refuses the
 * third, because an estimate *is* a period with no row.
 */
export type InvoiceOrigin = 'issued' | 'reconstructed' | 'estimate';

export interface Invoice {
  /** Human invoice number, `NEXA-<yyyymm>`. */
  number: string;
  /** Billing period as `yyyymm`. */
  period: string;
  /** Friendly period label, e.g. `July 2026`. */
  period_label: string;
  /** First instant of the period, UTC. */
  period_start: string;
  /** Exclusive upper bound — the first instant of the next month, UTC. */
  period_end: string;
  /** When the statement is issued — the last day of the period month, UTC. */
  issued_at: string;
  /** `issued`/`reconstructed` for a frozen period, `estimate` for the open one. */
  origin: InvoiceOrigin;
  /**
   * `paid` for a settled past period, `open` for the current one still
   * accruing, `trial` when the workspace owed nothing for that period.
   */
  status: InvoiceStatus;
  currency: 'usd';
  line_items: InvoiceLineItem[];
  subtotal_cents: number;
  total_cents: number;
}

/** `July 2026` from `202607`. */
export function periodLabel(period: string): string {
  const month = Number(period.slice(4, 6));
  return `${MONTH_NAMES[month - 1] ?? period} ${period.slice(0, 4)}`;
}

/** The issue date for a period: the last day of its month, at 00:00 UTC. */
export function issuedAt(period: string): Date {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  // Day 0 of the *next* month is the last day of this one.
  return new Date(Date.UTC(year, month, 0));
}

/**
 * The half-open window `[start, end)` a period covers.
 *
 * Exclusive upper bound so two consecutive periods cannot both claim the same
 * moment — the same shape the database CHECK enforces.
 */
export function periodWindow(period: string): { start: Date; end: Date } {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/** The `yyyymm` immediately before this one. */
export function previousPeriod(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}${String(previous.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** One metered line as `usage_records` stores it. */
export interface MeteredUsage {
  quantity: bigint;
  included: bigint;
  overageUnit: number;
  overageUnitPriceCents: number;
}

/** Everything a statement is composed from, for exactly one period. */
export interface InvoiceComposition {
  /** The plan name printed on a trial statement. */
  plan: string;
  seats: number;
  unitPriceCents: number;
  billingCycle: BillingCycle;
  /** The workspace owed nothing for this period. */
  trialing: boolean;
  ai: MeteredUsage | undefined;
  api: MeteredUsage | undefined;
  apiPackages: { packageId: string; apiCalls: bigint; priceCents: number }[];
  aiPackages: { packs: number; resolutions: number; priceCents: number }[];
}

export interface ComposedInvoice {
  /** `trial` while nothing is owed; the caller decides `paid` vs `open`. */
  trialing: boolean;
  line_items: InvoiceLineItem[];
  subtotal_cents: number;
  total_cents: number;
}

/**
 * Overage charge for one metered line, from the stored record.
 *
 * AI resolutions meter per unit; API calls bill by the block (any part of a
 * block over the allowance costs a whole block). The record carries the price
 * and allowance, so this is the same computation the live meter does — kept in
 * one shape here so a period's invoice cannot price its overage differently from
 * the usage endpoint.
 */
function overageCents(record: MeteredUsage, byBlock: boolean): { overage: number; cents: number } {
  const used = Number(record.quantity);
  const included = Number(record.included);
  const overage = Math.max(0, used - included);
  if (overage === 0) return { overage: 0, cents: 0 };
  const units = byBlock ? Math.ceil(overage / record.overageUnit) : overage;
  return { overage, cents: units * record.overageUnitPriceCents };
}

/**
 * The lines of one statement — the single arithmetic behind both the frozen
 * invoice and the open estimate.
 *
 * Deliberately pure and period-agnostic: it is handed the figures that apply to
 * one period and knows nothing about *when* it is being called. That is what
 * makes freezing honest — the sweep composes a closed period from the same
 * function a read would have, so the freeze changes when the numbers stop
 * moving, not what they are.
 */
export function composeInvoice(input: InvoiceComposition): ComposedInvoice {
  const cycleLabel = input.billingCycle === 'annual' ? 'annual' : 'monthly';
  const { seatChargeCents } = priceSeats(input.unitPriceCents, input.seats, input.billingCycle);

  let lineItems: InvoiceLineItem[];
  if (input.trialing) {
    // The subscription itself is free during the trial, so the statement
    // says why — matching `estimated_total_cents`, which is also 0 while
    // trialing. A package purchase is a separate, deliberate spend (the
    // trial gate never blocks `POST /billing/api-packages`), so it still
    // lands below as its own line rather than being folded into "free".
    lineItems = [{ description: `${input.plan} plan — free during trial`, amount_cents: 0 }];
  } else {
    lineItems = [
      {
        description: `Subscription — ${input.seats} seat${input.seats === 1 ? '' : 's'} (${cycleLabel})`,
        amount_cents: seatChargeCents,
      },
    ];
    if (input.ai) {
      const { overage, cents } = overageCents(input.ai, false);
      if (cents > 0) {
        lineItems.push({
          description: `AI resolutions overage — ${overage} beyond ${Number(input.ai.included)}`,
          amount_cents: cents,
        });
      }
    }
    if (input.api) {
      const { overage, cents } = overageCents(input.api, true);
      if (cents > 0) {
        const blocks = Math.ceil(overage / input.api.overageUnit);
        lineItems.push({
          description: `API calls overage — ${blocks} block${blocks === 1 ? '' : 's'} of ${input.api.overageUnit}`,
          amount_cents: cents,
        });
      }
    }
  }

  // A bought package's quota and price come off its own receipt row, never
  // re-looked-up from today's catalogue — the same reasoning
  // `serialiseApiPackagePurchase` uses: what the workspace was actually
  // charged must not restate itself when a price changes later. Only the
  // display name is joined from the catalogue, and falls back to the id for
  // a package that has since been withdrawn, so a past purchase never drops
  // off its own invoice.
  for (const purchase of input.apiPackages) {
    const name = findApiPackage(purchase.packageId)?.name ?? purchase.packageId;
    lineItems.push({
      description: `API package — ${name} (${Number(purchase.apiCalls)} calls)`,
      amount_cents: purchase.priceCents,
    });
  }

  // AI-resolution packs bought in the period (FR-MOD-10.1.4), each its own
  // line. The resolutions and the price come off the receipt, never
  // recomputed from today's pack size or overage rate — the same reasoning as
  // the API package above, and the reason the row stores both.
  //
  // Listed separately from the "AI resolutions overage" line rather than
  // netted against it, because they are two different events: a pack is
  // capacity bought up front, the overage line is what was spent past *all*
  // the capacity there was. Netting would hide the purchase from the statement
  // that is supposed to explain the charge.
  for (const purchase of input.aiPackages) {
    lineItems.push({
      description: `AI resolution packs — ${purchase.packs} pack${
        purchase.packs === 1 ? '' : 's'
      } (${purchase.resolutions} resolutions)`,
      amount_cents: purchase.priceCents,
    });
  }

  const total = lineItems.reduce((sum, item) => sum + item.amount_cents, 0);
  return {
    trialing: input.trialing,
    line_items: lineItems,
    subtotal_cents: total,
    total_cents: total,
  };
}

/** Wrap composed lines in the period's fixed identity. */
export function toInvoice(
  period: string,
  composed: ComposedInvoice,
  origin: InvoiceOrigin,
): Invoice {
  const window = periodWindow(period);
  return {
    number: invoiceNumber(period),
    period,
    period_label: periodLabel(period),
    period_start: window.start.toISOString(),
    period_end: window.end.toISOString(),
    issued_at: issuedAt(period).toISOString(),
    origin,
    status: composed.trialing ? 'trial' : origin === 'estimate' ? 'open' : 'paid',
    currency: INVOICE_CURRENCY,
    line_items: composed.line_items,
    subtotal_cents: composed.subtotal_cents,
    total_cents: composed.total_cents,
  };
}

/** The invoice number for a period. Per workspace, as the derived path was. */
export function invoiceNumber(period: string): string {
  return `NEXA-${period}`;
}

/**
 * Read everything one period's statement is composed from.
 *
 * Shared by the estimate and the sweep so the two cannot disagree about what
 * "the figures for this period" means — the sweep freezes exactly what a read
 * of that period would have produced.
 */
export async function readComposition(
  tx: TenantClient,
  tenant: TenantContext,
  period: string,
  env: Env,
): Promise<InvoiceComposition> {
  const [subscription, trial, records, purchases, aiPurchases, activeUsers] = await Promise.all([
    tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
    }),
    trialState(tx, tenant),
    tx.usageRecord.findMany({ where: { licenseId: tenant.licenseId, period } }),
    tx.apiPackagePurchase.findMany({ where: { licenseId: tenant.licenseId, period } }),
    tx.aiPackagePurchase.findMany({ where: { licenseId: tenant.licenseId, period } }),
    tx.agentMembership.count({ where: { suspended: false } }),
  ]);

  return {
    plan: subscription?.plan ?? 'growth',
    seats: subscription?.seats ?? activeUsers,
    unitPriceCents: subscription?.unitPriceCents ?? env.UNIT_PRICE_CENTS,
    billingCycle: (subscription?.billingCycle ?? 'monthly') as BillingCycle,
    trialing: trial.access === 'trialing',
    ai: records.find((r) => r.metric === 'ai_resolutions'),
    api: records.find((r) => r.metric === 'api_calls'),
    apiPackages: purchases,
    aiPackages: aiPurchases,
  };
}

/** A stored statement joined to its lines, as `listInvoices` reads it. */
interface StoredInvoice {
  period: string;
  number: string;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  origin: string;
  status: string;
  currency: string;
  subtotalCents: number;
  totalCents: number;
  lineItems: { description: string; amountCents: number }[];
}

function serialiseStored(row: StoredInvoice): Invoice {
  return {
    number: row.number,
    period: row.period,
    period_label: periodLabel(row.period),
    period_start: row.periodStart.toISOString(),
    period_end: row.periodEnd.toISOString(),
    issued_at: row.issuedAt.toISOString(),
    origin: row.origin as InvoiceOrigin,
    status: row.status as InvoiceStatus,
    currency: row.currency as 'usd',
    line_items: row.lineItems.map((item) => ({
      description: item.description,
      amount_cents: item.amountCents,
    })),
    subtotal_cents: row.subtotalCents,
    total_cents: row.totalCents,
  };
}

/**
 * Every invoice for this workspace, newest period first.
 *
 * Closed periods come from `invoices` exactly as they were frozen — read-only
 * history, unaffected by anything the subscription does afterwards. The current
 * period is appended as the `estimate`, always, so the standing plan charge is
 * visible before the period closes and the list is never empty.
 *
 * A closed period the sweep has not reached yet simply does not appear. That is
 * the deliberate half of the design: a statement exists because it was issued,
 * not because somebody asked for the list, and re-deriving one on demand is the
 * behaviour this table was added to end.
 */
export async function listInvoices(
  tx: TenantClient,
  tenant: TenantContext,
  env: Env,
  now = new Date(),
): Promise<Invoice[]> {
  const period = currentPeriod(now);

  const [stored, composition] = await Promise.all([
    tx.invoice.findMany({
      where: { licenseId: tenant.licenseId },
      orderBy: { period: 'desc' },
      include: { lineItems: { orderBy: { position: 'asc' } } },
    }),
    readComposition(tx, tenant, period, env),
  ]);

  // Defensive: the sweep never writes the open period (the CHECK on `status`
  // refuses `open` and the sweep only walks closed ones), but if a row for it
  // ever existed the live estimate is the truthful answer for a month that has
  // not ended, so it wins.
  const closed = stored.filter((row) => row.period !== period);

  return [
    toInvoice(period, composeInvoice(composition), 'estimate'),
    ...closed.map(serialiseStored),
  ];
}

/**
 * One invoice as CSV rows (header + line items + a total row), for the download.
 * The caller wraps these with the shared injection-safe `toCsv`.
 */
export function invoiceCsvRows(invoice: Invoice): {
  headers: string[];
  rows: (string | number)[][];
} {
  return {
    headers: ['item', 'amount_cents'],
    rows: [
      ...invoice.line_items.map((item) => [item.description, item.amount_cents]),
      ['Total', invoice.total_cents],
    ],
  };
}

/** Download filename for an invoice — `nexa-invoice-<yyyymm>.csv`. */
export function invoiceFilename(period: string): string {
  return `nexa-invoice-${period}.csv`;
}
