import { act, render, screen, within } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { BillingScreen } from './BillingScreen';
import { BillingContext } from './context';
import type { BillingApi } from './api';
import type { Entitlements, Invoice, Subscription, Usage } from './types';
import { ThemeProvider } from '../../theme/theme';

function subscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    plan: 'growth',
    pricing: 'listed',
    billing_cycle: 'monthly',
    status: 'active',
    access: 'active',
    trial: { ends_at: null, days_remaining: null },
    seats: 5,
    min_seats: 3,
    unit_price_cents: 9900,
    usage: usage(),
    estimated_total_cents: 49500,
    annual_savings_cents: 0,
    provider: 'mock',
    ...overrides,
  };
}

function usage(overrides: Partial<Usage> = {}): Usage {
  return {
    period: '202608',
    period_label: 'August 2026',
    quota_warning: false,
    ai_resolutions: {
      used: 120,
      included: 500,
      overage: 0,
      overage_cents: 0,
      overage_unit: 100,
      overage_unit_price_cents: 50,
    },
    api_calls: {
      used: 1000,
      included: 10000,
      overage: 0,
      overage_cents: 0,
      overage_unit: 100000,
      overage_unit_price_cents: 2950,
    },
    ...overrides,
  };
}

function invoice(overrides: Partial<Invoice> & { period: string }): Invoice {
  return {
    number: `NEXA-${overrides.period}`,
    period_label: 'August 2026',
    issued_at: '2026-08-01T00:00:00.000Z',
    status: 'open',
    currency: 'usd',
    line_items: [{ description: 'Growth plan · 5 seats', amount_cents: 49500 }],
    subtotal_cents: 49500,
    total_cents: 49500,
    ...overrides,
  };
}

function entitlements(overrides: Partial<Entitlements> = {}): Entitlements {
  return {
    plan: 'growth',
    entitlements: {
      white_label: false,
      sandbox: false,
      sla: false,
      sso: false,
      hipaa: false,
      siem_export: false,
    },
    plans: [],
    ...overrides,
  };
}

function api(overrides: Partial<BillingApi> = {}): BillingApi {
  return {
    getSubscription: async () => subscription(),
    getUsage: async () => usage(),
    listInvoices: async () => [],
    getEntitlements: async () => entitlements(),
    ...overrides,
  };
}

async function mount(billingApi: BillingApi): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <BillingContext.Provider value={billingApi}>
        <BillingScreen />
      </BillingContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

describe('BillingScreen', () => {
  it('shows a loading skeleton before billing arrives', async () => {
    let resolve: (value: Subscription) => void = () => {};
    const pending = new Promise<Subscription>((r) => {
      resolve = r;
    });

    const tree: ReactElement = (
      <ThemeProvider>
        <BillingContext.Provider value={api({ getSubscription: async () => pending })}>
          <BillingScreen />
        </BillingContext.Provider>
      </ThemeProvider>
    );
    await render(tree);

    expect(screen.getByTestId('billing-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve(subscription());
    });
  });

  it('shows the plan card with seats, price and estimated total', async () => {
    await mount(
      api({
        getSubscription: async () =>
          subscription({ plan: 'growth', seats: 5, unit_price_cents: 9900 }),
      }),
    );

    expect(await screen.findByText('growth')).toBeOnTheScreen();
    expect(screen.getByText('5')).toBeOnTheScreen();
    expect(screen.getByText('$99.00')).toBeOnTheScreen();
    expect(screen.getByText('$495.00')).toBeOnTheScreen();
  });

  it('warns that a read-only workspace stays readable', async () => {
    await mount(
      api({
        getSubscription: async () => subscription({ access: 'read_only', status: 'read_only' }),
      }),
    );

    expect(
      await screen.findByText(/This workspace is read-only — the trial ended/),
    ).toBeOnTheScreen();
  });

  it('names the days left on a trial', async () => {
    await mount(
      api({
        getSubscription: async () =>
          subscription({
            access: 'trialing',
            status: 'trialing',
            trial: { ends_at: '2026-09-01T00:00:00.000Z', days_remaining: 3 },
          }),
      }),
    );

    expect(await screen.findByText(/3 days left in the trial/)).toBeOnTheScreen();
  });

  it('shows the period usage for AI resolutions and API calls', async () => {
    await mount(
      api({
        getUsage: async () =>
          usage({
            ai_resolutions: {
              used: 120,
              included: 500,
              overage: 0,
              overage_cents: 0,
              overage_unit: 100,
              overage_unit_price_cents: 50,
            },
          }),
      }),
    );

    expect(await screen.findByText('120 / 500')).toBeOnTheScreen();
  });

  it('says there are no invoices rather than showing an empty table', async () => {
    await mount(api({ listInvoices: async () => [] }));

    expect(await screen.findByTestId('billing-invoices-empty')).toBeOnTheScreen();
  });

  it('lists invoices with their period, amount and status', async () => {
    await mount(
      api({
        listInvoices: async () => [
          invoice({ period: '202608', status: 'open', total_cents: 49500 }),
        ],
      }),
    );

    const row = within(await screen.findByTestId('invoice-row-202608'));
    expect(row.getByText('$495.00')).toBeOnTheScreen();
    expect(row.getByText('Open')).toBeOnTheScreen();
  });

  it('shows the entitlement list for the workspace plan', async () => {
    await mount(
      api({
        getEntitlements: async () =>
          entitlements({
            plan: 'enterprise',
            entitlements: {
              white_label: true,
              sandbox: true,
              sla: true,
              sso: false,
              hipaa: false,
              siem_export: false,
            },
          }),
      }),
    );

    expect(await screen.findByText('Entitlements — enterprise')).toBeOnTheScreen();
    expect(within(screen.getByTestId('entitlement-white_label')).getByText('On')).toBeOnTheScreen();
    expect(screen.getAllByText('Off').length).toBeGreaterThan(0);
  });

  it('says what went wrong when billing could not be loaded', async () => {
    await mount(
      api({
        getSubscription: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });
});
