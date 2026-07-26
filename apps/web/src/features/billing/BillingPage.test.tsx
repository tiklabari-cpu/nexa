/**
 * Billing meter (FR-MOD-10.1.4).
 *
 * The three things the KK asks for: the counter reads `N / limit (% used)`, the
 * quota warning is proactive — it fires at 80%, before the allowance is gone —
 * and the overage package (aşım paketi) states its price up front so the extra
 * usage never arrives as a surprise on the invoice.
 *
 * Every figure comes from `/billing/usage`, the same metering the invoice reads
 * (ADR-09), so the meter can never quote a number the bill disagrees with.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn(), put: vi.fn(), getBlob: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { BillingPage } = await import('./BillingPage.js');

interface InvoiceOpt {
  number: string;
  period: string;
  period_label: string;
  issued_at: string;
  status: 'paid' | 'open' | 'trial';
  currency: string;
  line_items: { description: string; amount_cents: number }[];
  subtotal_cents: number;
  total_cents: number;
}

interface PaymentMethodOpt {
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  holder_name: string;
  updated_at: string;
}

interface UsageOpts {
  used?: number;
  included?: number;
  overage?: number;
  overageCents?: number;
  quotaWarning?: boolean;
  access?: 'trialing' | 'active' | 'read_only';
  /** Billed API calls this period — exercises the FR-MOD-10.1.5 counter/overage. */
  apiUsed?: number;
  /** Invoices the list endpoint returns (FR-MOD-10.3). */
  invoices?: InvoiceOpt[];
  /** Payment method on file, or null (FR-MOD-10.3). */
  paymentMethod?: PaymentMethodOpt | null;
}

const DEFAULT_INVOICE: InvoiceOpt = {
  number: 'NEXA-202607',
  period: '202607',
  period_label: 'July 2026',
  issued_at: '2026-07-31T00:00:00.000Z',
  status: 'open',
  currency: 'usd',
  line_items: [{ description: 'Subscription — 3 seats (monthly)', amount_cents: 29700 }],
  subtotal_cents: 29700,
  total_cents: 29700,
};

/**
 * Wire both queries the page issues. `/billing/usage` carries the metered
 * figures under test; `/billing/subscription` is the surrounding plan view,
 * mocked minimally so the page renders past its loading state.
 */
function mockBilling(opts: UsageOpts): void {
  const used = opts.used ?? 0;
  const included = opts.included ?? 200;
  const overage = opts.overage ?? Math.max(0, used - included);
  const overageUnitPriceCents = 50;
  // API calls: block of 100,000 at $29.50, billed by the block (FR-MOD-10.1.5).
  const apiUsed = opts.apiUsed ?? 0;
  const apiIncluded = 100_000;
  const apiOverage = Math.max(0, apiUsed - apiIncluded);
  const apiOverageUnit = 100_000;
  const apiOverageUnitPriceCents = 2_950;
  const usage = {
    period: '202607',
    ai_resolutions: {
      used,
      included,
      overage,
      overage_cents: opts.overageCents ?? overage * overageUnitPriceCents,
      overage_unit: 50,
      overage_unit_price_cents: overageUnitPriceCents,
    },
    api_calls: {
      used: apiUsed,
      included: apiIncluded,
      overage: apiOverage,
      overage_cents: Math.ceil(apiOverage / apiOverageUnit) * apiOverageUnitPriceCents,
      overage_unit: apiOverageUnit,
      overage_unit_price_cents: apiOverageUnitPriceCents,
    },
  };
  const access = opts.access ?? 'active';

  api.get.mockImplementation((path: string) => {
    if (path === '/billing/usage') {
      return Promise.resolve({
        ...usage,
        quota_warning: opts.quotaWarning ?? (included > 0 && used / included >= 0.8),
        period_label: '202607',
      });
    }
    if (path === '/billing/subscription') {
      return Promise.resolve({
        plan: 'growth',
        billing_cycle: 'monthly',
        status: access === 'trialing' ? 'trialing' : 'active',
        access,
        trial: { ends_at: null, days_remaining: null },
        seats: 3,
        min_seats: 1,
        unit_price_cents: 9900,
        usage,
        estimated_total_cents: 29700,
        annual_savings_cents: 0,
        provider: 'mock',
      });
    }
    if (path === '/billing/invoices') {
      return Promise.resolve({ invoices: opts.invoices ?? [DEFAULT_INVOICE] });
    }
    if (path === '/billing/payment-method') {
      return Promise.resolve({ payment_method: opts.paymentMethod ?? null });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderBilling(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
  api.put.mockReset();
  api.getBlob.mockReset();
});

describe('BillingPage — AI resolutions meter', () => {
  it("reads the counter as 'N / limit (% used)' from the metering", async () => {
    mockBilling({ used: 12, included: 200 });
    renderBilling(<BillingPage />);

    const counter = await screen.findByTestId('ai-counter');
    // 12 / 200 → 6% used, all from the same figures the invoice reads.
    expect(counter.textContent?.replace(/\s+/g, ' ').trim()).toBe('12 / 200 (6% used)');
    expect(screen.getByTestId('quota-percent')).toHaveTextContent('(6% used)');
  });

  it('does not warn while well under the allowance', async () => {
    mockBilling({ used: 100, included: 200 }); // 50%
    renderBilling(<BillingPage />);

    await screen.findByTestId('ai-counter');
    expect(screen.queryByTestId('quota-warning')).not.toBeInTheDocument();
  });

  it('raises a proactive warning once usage reaches 80%', async () => {
    mockBilling({ used: 160, included: 200 }); // exactly 80%
    renderBilling(<BillingPage />);

    const warning = await screen.findByTestId('quota-warning');
    expect(warning).toHaveTextContent('80%');
    // A proactive notice, not an after-the-fact error: still inside the allowance.
    expect(warning).toHaveTextContent(/used 80% of your AI resolutions/i);
  });

  it('prices the overage package up front, before any is spent', async () => {
    mockBilling({ used: 12, included: 200 });
    renderBilling(<BillingPage />);

    const pack = await screen.findByTestId('overage-package');
    // Pack size (50), per-resolution price ($0.50) and the pack price ($25.00).
    expect(pack).toHaveTextContent(/packs of 50/i);
    expect(pack).toHaveTextContent('$0.50');
    expect(pack).toHaveTextContent('$25.00');
    // Nothing over yet, so the charge for the period is zero.
    expect(screen.getByTestId('overage-charge')).toHaveTextContent('$0.00');
  });

  it('shows the overage charge once past the allowance', async () => {
    mockBilling({ used: 210, included: 200, overage: 10, overageCents: 500 });
    renderBilling(<BillingPage />);

    const warning = await screen.findByTestId('quota-warning');
    expect(warning).toHaveTextContent(/past your included/i);
    // 10 over at $0.50 each = $5.00, and the counter is honestly past 100%.
    expect(screen.getByTestId('overage-charge')).toHaveTextContent('$5.00');
    expect(screen.getByTestId('quota-percent')).toHaveTextContent('(105% used)');
  });
});

describe('BillingPage — API calls (FR-MOD-10.1.5)', () => {
  it('reads the API-call counter and quotes the block price up front', async () => {
    mockBilling({ apiUsed: 4_812 });
    renderBilling(<BillingPage />);

    const section = (await screen.findByText('API calls')).closest('section');
    expect(section).not.toBeNull();
    // The counter (sayaç) and the allowance it is measured against.
    expect(section).toHaveTextContent('4,812');
    expect(section).toHaveTextContent('100,000');
    // The overage price is shown before any is spent — $29.50 per 100,000.
    const terms = screen.getByTestId('api-overage-terms');
    expect(terms).toHaveTextContent('$29.50');
    expect(terms).toHaveTextContent('100,000');
  });

  it('prices API-call overage by the block once past the allowance', async () => {
    // 250,000 calls against 100,000 included → 150,000 over = two $29.50 blocks.
    mockBilling({ apiUsed: 250_000 });
    renderBilling(<BillingPage />);

    const section = (await screen.findByText('API calls')).closest('section');
    expect(section).toHaveTextContent('150,000'); // overage, by the call
    // Two blocks × $29.50 = $59.00 on the invoice (aşım faturaya).
    expect(section).toHaveTextContent('$59.00');
  });
});

describe('BillingPage — invoices (FR-MOD-10.3)', () => {
  it('lists invoices with number, amount and status', async () => {
    mockBilling({
      invoices: [
        DEFAULT_INVOICE,
        {
          number: 'NEXA-202606',
          period: '202606',
          period_label: 'June 2026',
          issued_at: '2026-06-30T00:00:00.000Z',
          status: 'paid',
          currency: 'usd',
          line_items: [{ description: 'Subscription — 3 seats (monthly)', amount_cents: 29700 }],
          subtotal_cents: 29700,
          total_cents: 29700,
        },
      ],
    });
    renderBilling(<BillingPage />);

    const rows = await screen.findAllByTestId('invoice-row');
    expect(rows).toHaveLength(2);
    // Newest first, with its number, amount and open status.
    expect(rows[0]).toHaveTextContent('NEXA-202607');
    expect(rows[0]).toHaveTextContent('$297.00');
    expect(rows[0]).toHaveTextContent('Open');
    expect(rows[1]).toHaveTextContent('NEXA-202606');
    expect(rows[1]).toHaveTextContent('Paid');
  });

  it('downloads an invoice as a CSV blob', async () => {
    const user = userEvent.setup();
    // jsdom has no object-URL plumbing; stub it for the download click.
    const createObjectURL = vi.fn(() => 'blob:invoice');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    // jsdom has no navigation, so the anchor's real click would warn; the click
    // itself is not what we assert on.
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    api.getBlob.mockResolvedValue(new Blob(['item,amount_cents\r\n'], { type: 'text/csv' }));

    mockBilling({});
    renderBilling(<BillingPage />);

    const row = await screen.findByTestId('invoice-row');
    await user.click(within(row).getByRole('button', { name: /download invoice/i }));

    expect(api.getBlob).toHaveBeenCalledWith('/billing/invoices/202607/download');
    expect(createObjectURL).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    click.mockRestore();
    vi.unstubAllGlobals();
  });
});

describe('BillingPage — payment method (FR-MOD-10.3)', () => {
  it('shows there is no payment method on file yet', async () => {
    mockBilling({ paymentMethod: null });
    renderBilling(<BillingPage />);

    expect(await screen.findByTestId('payment-method-empty')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add payment method/i })).toBeInTheDocument();
  });

  it('renders the masked method on file without a full card number', async () => {
    mockBilling({
      paymentMethod: {
        brand: 'visa',
        last4: '4242',
        exp_month: 12,
        exp_year: 2030,
        holder_name: 'Jane Doe',
        updated_at: '2026-07-20T00:00:00.000Z',
      },
    });
    renderBilling(<BillingPage />);

    const method = await screen.findByTestId('payment-method');
    expect(method).toHaveTextContent(/visa/i);
    expect(method).toHaveTextContent('ending 4242');
    expect(method).toHaveTextContent('12/2030');
    expect(method).toHaveTextContent('Jane Doe');
  });

  it('saves an updated masked method through PUT', async () => {
    const user = userEvent.setup();
    api.put.mockResolvedValue({
      brand: 'mastercard',
      last4: '1111',
      exp_month: 8,
      exp_year: 2029,
      holder_name: 'Sam Lee',
      updated_at: '2026-07-26T00:00:00.000Z',
    });
    mockBilling({ paymentMethod: null });
    renderBilling(<BillingPage />);

    await user.click(await screen.findByRole('button', { name: /add payment method/i }));

    // The form deliberately has no full-card-number field (PRD §11.1/1).
    expect(screen.queryByLabelText(/card number/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Card brand'), 'mastercard');
    await user.type(screen.getByLabelText('Last 4 digits'), '1111');
    await user.selectOptions(screen.getByLabelText('Expiry month'), '8');
    await user.selectOptions(screen.getByLabelText('Expiry year'), '2029');
    await user.type(screen.getByLabelText('Cardholder name'), 'Sam Lee');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(api.put).toHaveBeenCalledWith('/billing/payment-method', {
      brand: 'mastercard',
      last4: '1111',
      exp_month: 8,
      exp_year: 2029,
      holder_name: 'Sam Lee',
    });
    // The section re-reads from the reply — the saved card is now shown.
    expect(await screen.findByTestId('payment-method')).toHaveTextContent('ending 1111');
  });
});
