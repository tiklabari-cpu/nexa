/**
 * Invoices (FR-MOD-10.3, "fatura listesi/indirme").
 *
 * Billing is mocked (ADR-13): no external provider issues invoices, so Nexa
 * *derives* them from the two things that are real — the subscription and the
 * per-period usage records — rather than persisting a parallel invoice table
 * that could drift from them. One invoice per billing period the workspace has
 * touched, plus the current (open) one; its total is the same arithmetic the
 * subscription view quotes, so the current invoice and `estimated_total_cents`
 * can never disagree.
 *
 * The seat charge is taken from the *current* subscription applied to each
 * period — an honest approximation for a mock, since historical seat counts are
 * not retained. The overage figures are exact: each usage record carries the
 * allowance and price that produced it, and this reads them back rather than
 * re-deriving.
 */
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

export interface InvoiceLineItem {
  description: string;
  amount_cents: number;
}

export type InvoiceStatus = 'paid' | 'open' | 'trial';

export interface Invoice {
  /** Human invoice number, `NEXA-<yyyymm>`. */
  number: string;
  /** Billing period as `yyyymm`. */
  period: string;
  /** Friendly period label, e.g. `July 2026`. */
  period_label: string;
  /** When the statement is issued — the last day of the period month, UTC. */
  issued_at: string;
  /**
   * `paid` for a settled past period, `open` for the current one still
   * accruing, `trial` while the workspace owes nothing.
   */
  status: InvoiceStatus;
  currency: 'usd';
  line_items: InvoiceLineItem[];
  subtotal_cents: number;
  total_cents: number;
}

/** `July 2026` from `202607`. */
function periodLabel(period: string): string {
  const month = Number(period.slice(4, 6));
  return `${MONTH_NAMES[month - 1] ?? period} ${period.slice(0, 4)}`;
}

/** The issue date for a period: the last day of its month, at 00:00 UTC. */
function issuedAt(period: string): string {
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(4, 6));
  // Day 0 of the *next* month is the last day of this one.
  return new Date(Date.UTC(year, month, 0)).toISOString();
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
function overageCents(
  record: { quantity: bigint; included: bigint; overageUnit: number; overageUnitPriceCents: number },
  byBlock: boolean,
): { overage: number; cents: number } {
  const used = Number(record.quantity);
  const included = Number(record.included);
  const overage = Math.max(0, used - included);
  if (overage === 0) return { overage: 0, cents: 0 };
  const units = byBlock ? Math.ceil(overage / record.overageUnit) : overage;
  return { overage, cents: units * record.overageUnitPriceCents };
}

/**
 * Every invoice for this workspace, newest period first.
 *
 * Always includes the current period (the open invoice), even with no usage
 * yet, so the list is never empty and the standing plan charge is always
 * visible. Past periods appear when a usage record exists for them.
 */
export async function buildInvoices(
  tx: TenantClient,
  tenant: TenantContext,
  env: Env,
): Promise<Invoice[]> {
  const [subscription, trial, records, activeUsers] = await Promise.all([
    tx.subscription.findFirst({
      where: { licenseId: tenant.licenseId },
      orderBy: { createdAt: 'desc' },
    }),
    trialState(tx, tenant),
    tx.usageRecord.findMany({ where: { licenseId: tenant.licenseId } }),
    tx.agentMembership.count({ where: { suspended: false } }),
  ]);

  const now = currentPeriod();
  const unitPrice = subscription?.unitPriceCents ?? env.UNIT_PRICE_CENTS;
  const billingCycle = (subscription?.billingCycle ?? 'monthly') as BillingCycle;
  const seats = subscription?.seats ?? activeUsers;
  const plan = subscription?.plan ?? 'growth';
  const cycleLabel = billingCycle === 'annual' ? 'annual' : 'monthly';
  const { seatChargeCents } = priceSeats(unitPrice, seats, billingCycle);
  const trialing = trial.access === 'trialing';

  // Every period with usage, plus the current one — so the open invoice always
  // exists. A Set de-duplicates the current period if a usage record already
  // wrote it.
  const periods = [...new Set([now, ...records.map((r) => r.period)])].sort((a, b) =>
    b.localeCompare(a),
  );

  return periods.map((period) => {
    const ai = records.find((r) => r.metric === 'ai_resolutions' && r.period === period);
    const api = records.find((r) => r.metric === 'api_calls' && r.period === period);

    const status: InvoiceStatus = trialing ? 'trial' : period < now ? 'paid' : 'open';

    let lineItems: InvoiceLineItem[];
    if (trialing) {
      // Nothing is billed during the trial, so the statement is $0 and says why —
      // matching `estimated_total_cents`, which is also 0 while trialing.
      lineItems = [{ description: `${plan} plan — free during trial`, amount_cents: 0 }];
    } else {
      lineItems = [
        {
          description: `Subscription — ${seats} seat${seats === 1 ? '' : 's'} (${cycleLabel})`,
          amount_cents: seatChargeCents,
        },
      ];
      if (ai) {
        const { overage, cents } = overageCents(ai, false);
        if (cents > 0) {
          lineItems.push({
            description: `AI resolutions overage — ${overage} beyond ${Number(ai.included)}`,
            amount_cents: cents,
          });
        }
      }
      if (api) {
        const { overage, cents } = overageCents(api, true);
        if (cents > 0) {
          const blocks = Math.ceil(overage / api.overageUnit);
          lineItems.push({
            description: `API calls overage — ${blocks} block${blocks === 1 ? '' : 's'} of ${api.overageUnit}`,
            amount_cents: cents,
          });
        }
      }
    }

    const total = lineItems.reduce((sum, item) => sum + item.amount_cents, 0);

    return {
      number: `NEXA-${period}`,
      period,
      period_label: periodLabel(period),
      issued_at: issuedAt(period),
      status,
      currency: 'usd',
      line_items: lineItems,
      subtotal_cents: total,
      total_cents: total,
    };
  });
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
