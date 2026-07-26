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
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), patch: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { BillingPage } = await import('./BillingPage.js');

interface UsageOpts {
  used?: number;
  included?: number;
  overage?: number;
  overageCents?: number;
  quotaWarning?: boolean;
  access?: 'trialing' | 'active' | 'read_only';
  /** Billed API calls this period — exercises the FR-MOD-10.1.5 counter/overage. */
  apiUsed?: number;
}

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
