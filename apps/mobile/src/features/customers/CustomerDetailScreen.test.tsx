import { act, render, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { CustomerDetailScreen } from './CustomerDetailScreen';
import { CustomersContext } from './context';
import type { CustomersApi } from './api';
import type { CustomerDetail } from './types';
import { ThemeProvider } from '../../theme/theme';

function detail(overrides: Partial<CustomerDetail> = {}): CustomerDetail {
  return {
    id: 'cust-1',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: null,
    country_code: 'GB',
    country: 'United Kingdom',
    is_lead: true,
    banned: false,
    chats_count: 4,
    tickets_count: 1,
    last_activity_at: '2026-08-16T10:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    banned_at: null,
    visits_count: 2,
    groups: [],
    visits: [],
    chats: [],
    custom_fields: [],
    ...overrides,
  };
}

function api(overrides: Partial<CustomersApi> = {}): CustomersApi {
  return {
    listCustomers: async () => ({ items: [], total: 0 }),
    getCustomer: async () => detail(),
    ...overrides,
  };
}

async function mount(customerId: string, customersApi: CustomersApi): Promise<void> {
  const tree: ReactElement = (
    <ThemeProvider>
      <CustomersContext.Provider value={customersApi}>
        <CustomerDetailScreen customerId={customerId} />
      </CustomersContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
}

describe('CustomerDetailScreen', () => {
  it('shows a loading skeleton before the record arrives', async () => {
    let resolve: (value: CustomerDetail) => void = () => {};
    const pending = new Promise<CustomerDetail>((r) => {
      resolve = r;
    });

    const tree: ReactElement = (
      <ThemeProvider>
        <CustomersContext.Provider value={api({ getCustomer: async () => pending })}>
          <CustomerDetailScreen customerId="cust-1" />
        </CustomersContext.Provider>
      </ThemeProvider>
    );
    await render(tree);

    // The skeleton itself is `accessibilityElementsHidden` (a visual courtesy,
    // not content — same reasoning as the web `ListSkeleton`), so it is queried
    // through its non-hidden container rather than its own testID.
    expect(screen.getByTestId('customer-detail-loading')).toBeOnTheScreen();

    await act(async () => {
      resolve(detail());
    });
  });

  it('shows the basic fields of a customer', async () => {
    await mount(
      'cust-1',
      api({
        getCustomer: async () =>
          detail({
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            phone: '+44 20 1234 5678',
            country: 'United Kingdom',
            chats_count: 4,
            tickets_count: 1,
          }),
      }),
    );

    expect(await screen.findByText('Ada Lovelace')).toBeOnTheScreen();
    expect(screen.getByText('ada@example.com')).toBeOnTheScreen();
    expect(screen.getByText('+44 20 1234 5678')).toBeOnTheScreen();
    expect(screen.getByText('United Kingdom')).toBeOnTheScreen();
    expect(screen.getByText('4')).toBeOnTheScreen();
    expect(screen.getByText('1')).toBeOnTheScreen();
  });

  it('names an anonymous visitor rather than showing a blank title', async () => {
    await mount('cust-1', api({ getCustomer: async () => detail({ name: null }) }));

    expect(await screen.findByText('Unnamed visitor')).toBeOnTheScreen();
  });

  it('marks a banned customer', async () => {
    await mount('cust-1', api({ getCustomer: async () => detail({ banned: true }) }));

    expect(await screen.findByText('Banned')).toBeOnTheScreen();
  });

  it('says what went wrong when the record could not be loaded', async () => {
    await mount(
      'cust-1',
      api({
        getCustomer: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });
});
