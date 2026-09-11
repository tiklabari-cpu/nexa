/**
 * Statement composition and the period calendar (FR-MOD-10.3).
 *
 * `listInvoices` and the period-close sweep need a transaction and are covered
 * against real Postgres in `test/integration/reports-billing.test.ts` and
 * `test/integration/invoice-close.test.ts`. What is unit-testable here is the
 * part both of them route through: the arithmetic that turns one period's
 * figures into lines, and the calendar functions that decide which period a
 * statement belongs to. Those two are what make freezing meaningful — a freeze
 * that composed a period differently from a read would be a different bug
 * wearing the same fix.
 */
import { describe, expect, it } from 'vitest';
import { findApiPackage } from '@nexa/types';
import {
  composeInvoice,
  invoiceCsvRows,
  invoiceFilename,
  invoiceNumber,
  issuedAt,
  periodLabel,
  periodWindow,
  previousPeriod,
  toInvoice,
  type InvoiceComposition,
} from './invoice-service.js';

/** An active, two-seat monthly workspace with no usage and no purchases. */
function base(overrides: Partial<InvoiceComposition> = {}): InvoiceComposition {
  return {
    plan: 'growth',
    seats: 2,
    unitPriceCents: 9900,
    billingCycle: 'monthly',
    trialing: false,
    ai: undefined,
    api: undefined,
    apiPackages: [],
    aiPackages: [],
    ...overrides,
  };
}

describe('the period calendar (FR-MOD-10.3)', () => {
  it('labels a period in English, month then year', () => {
    expect(periodLabel('202607')).toBe('July 2026');
    expect(periodLabel('202601')).toBe('January 2026');
    expect(periodLabel('202612')).toBe('December 2026');
  });

  it('issues on the last day of the period month, at midnight UTC', () => {
    expect(issuedAt('202602').toISOString()).toBe('2026-02-28T00:00:00.000Z');
    // A leap February, so the date is computed rather than assumed.
    expect(issuedAt('202402').toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(issuedAt('202612').toISOString()).toBe('2026-12-31T00:00:00.000Z');
  });

  it('covers a period as a half-open window, so two periods never share a moment', () => {
    const july = periodWindow('202607');
    expect(july.start.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(july.end.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    // August starts exactly where July ends — and July does not include it.
    expect(periodWindow('202608').start.toISOString()).toBe(july.end.toISOString());
  });

  it('steps back a period across a year boundary', () => {
    expect(previousPeriod('202607')).toBe('202606');
    expect(previousPeriod('202601')).toBe('202512');
  });

  it('numbers a statement per workspace, from its period alone', () => {
    expect(invoiceNumber('202607')).toBe('NEXA-202607');
    expect(invoiceFilename('202607')).toBe('nexa-invoice-202607.csv');
  });
});

describe('composeInvoice — the one arithmetic behind a statement (FR-MOD-10.3)', () => {
  it('bills the standing seat charge with nothing else happening', () => {
    const composed = composeInvoice(base());
    expect(composed.line_items).toEqual([
      { description: 'Subscription — 2 seats (monthly)', amount_cents: 19_800 },
    ]);
    expect(composed.total_cents).toBe(19_800);
    expect(composed.subtotal_cents).toBe(19_800);
  });

  it('charges ten months on the annual cycle, not twelve', () => {
    const composed = composeInvoice(base({ billingCycle: 'annual', seats: 1 }));
    expect(composed.line_items[0]).toEqual({
      description: 'Subscription — 1 seat (annual)',
      amount_cents: 99_000,
    });
  });

  it('meters AI overage per resolution, from the allowance the record carries', () => {
    const composed = composeInvoice(
      base({
        ai: { quantity: 260n, included: 200n, overageUnit: 50, overageUnitPriceCents: 50 },
      }),
    );
    // 60 over at $0.50 — priced from the record, not from today's catalogue.
    expect(composed.line_items[1]).toEqual({
      description: 'AI resolutions overage — 60 beyond 200',
      amount_cents: 3_000,
    });
    expect(composed.total_cents).toBe(19_800 + 3_000);
  });

  it('bills API overage by the whole block, so one call over costs a block', () => {
    const composed = composeInvoice(
      base({
        api: {
          quantity: 100_001n,
          included: 100_000n,
          overageUnit: 100_000,
          overageUnitPriceCents: 2_950,
        },
      }),
    );
    expect(composed.line_items[1]).toEqual({
      description: 'API calls overage — 1 block of 100000',
      amount_cents: 2_950,
    });
  });

  it('rounds a part-used block up rather than metering the calls in it', () => {
    // 150,000 over the allowance is two blocks, not 150,000 units — the case
    // above cannot tell those apart (one call over prices the same either way),
    // and that difference is four orders of magnitude of customer money.
    const composed = composeInvoice(
      base({
        api: {
          quantity: 250_000n,
          included: 100_000n,
          overageUnit: 100_000,
          overageUnitPriceCents: 2_950,
        },
      }),
    );
    expect(composed.line_items[1]).toEqual({
      description: 'API calls overage — 2 blocks of 100000',
      amount_cents: 2 * 2_950,
    });
  });

  it('adds no overage line when usage is inside the allowance', () => {
    const composed = composeInvoice(
      base({
        ai: { quantity: 12n, included: 200n, overageUnit: 50, overageUnitPriceCents: 50 },
        api: {
          quantity: 4_812n,
          included: 100_000n,
          overageUnit: 100_000,
          overageUnitPriceCents: 2_950,
        },
      }),
    );
    expect(composed.line_items).toHaveLength(1);
  });

  it('prices a purchase from its own receipt, never from the catalogue', () => {
    // `essential` is 100,000 calls at $29.99 in today's catalogue
    // (`API_PACKAGE_CATALOG`). Both figures below deliberately differ from it,
    // so a line that re-looked-up either one would fail here — which is the
    // whole guarantee: re-pricing a package in code must not restate what a
    // workspace has already paid.
    const composed = composeInvoice(
      base({
        apiPackages: [{ packageId: 'essential', apiCalls: 250_000n, priceCents: 1_234 }],
        aiPackages: [{ packs: 2, resolutions: 100, priceCents: 4_321 }],
      }),
    );
    expect(findApiPackage('essential')).toMatchObject({ api_calls: 100_000, price_cents: 2_999 });
    expect(composed.line_items[1]).toEqual({
      description: 'API package — Essential (250000 calls)',
      amount_cents: 1_234,
    });
    expect(composed.line_items[2]).toEqual({
      description: 'AI resolution packs — 2 packs (100 resolutions)',
      amount_cents: 4_321,
    });
    expect(composed.total_cents).toBe(19_800 + 1_234 + 4_321);
  });

  it('names a withdrawn package by its id rather than dropping the line', () => {
    const composed = composeInvoice(
      base({ apiPackages: [{ packageId: 'retired-tier', apiCalls: 10n, priceCents: 700 }] }),
    );
    expect(composed.line_items[1]?.description).toBe('API package — retired-tier (10 calls)');
  });

  it('owes nothing during a trial, and still itemises a deliberate purchase', () => {
    const composed = composeInvoice(
      base({
        trialing: true,
        // Trial or not, this money was spent — the trial gate never blocks a
        // package purchase, so folding it into "free" would hide a real charge.
        apiPackages: [{ packageId: 'essential', apiCalls: 250_000n, priceCents: 1_234 }],
      }),
    );
    expect(composed.trialing).toBe(true);
    expect(composed.line_items[0]).toEqual({
      description: 'growth plan — free during trial',
      amount_cents: 0,
    });
    expect(composed.total_cents).toBe(1_234);
  });
});

describe('toInvoice — what a period claims about itself (FR-MOD-10.3)', () => {
  it('calls the open period an estimate, never a statement', () => {
    const invoice = toInvoice('202607', composeInvoice(base()), 'estimate');
    expect(invoice).toMatchObject({
      number: 'NEXA-202607',
      period: '202607',
      period_label: 'July 2026',
      period_start: '2026-07-01T00:00:00.000Z',
      period_end: '2026-08-01T00:00:00.000Z',
      issued_at: '2026-07-31T00:00:00.000Z',
      origin: 'estimate',
      status: 'open',
      currency: 'usd',
    });
  });

  it('settles a frozen period, whichever way it was frozen', () => {
    for (const origin of ['issued', 'reconstructed'] as const) {
      expect(toInvoice('202606', composeInvoice(base()), origin).status).toBe('paid');
    }
  });

  it('keeps a trial period a trial even after it is frozen', () => {
    // The retroactivity this whole table exists to stop, in miniature: a
    // workspace that later becomes active must not have its trial months
    // restated as paid ones.
    const invoice = toInvoice('202606', composeInvoice(base({ trialing: true })), 'issued');
    expect(invoice.status).toBe('trial');
    expect(invoice.total_cents).toBe(0);
  });
});

describe('the CSV download (FR-MOD-10.3)', () => {
  it('writes every line and a total row', () => {
    const invoice = toInvoice(
      '202607',
      composeInvoice(
        base({
          ai: { quantity: 260n, included: 200n, overageUnit: 50, overageUnitPriceCents: 50 },
        }),
      ),
      'issued',
    );
    expect(invoiceCsvRows(invoice)).toEqual({
      headers: ['item', 'amount_cents'],
      rows: [
        ['Subscription — 2 seats (monthly)', 19_800],
        ['AI resolutions overage — 60 beyond 200', 3_000],
        ['Total', 22_800],
      ],
    });
  });
});
