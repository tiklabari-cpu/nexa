import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import { CustomerListScreen } from './CustomerListScreen';
import { CustomersContext } from './context';
import type { CustomersApi, CustomersPage } from './api';
import type { CustomerSummary } from './types';
import { ThemeProvider } from '../../theme/theme';

function customer(overrides: Partial<CustomerSummary> & { id: string }): CustomerSummary {
  return {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: null,
    country_code: null,
    country: null,
    is_lead: false,
    banned: false,
    chats_count: 3,
    tickets_count: 0,
    last_activity_at: '2026-08-16T10:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function api(overrides: Partial<CustomersApi> = {}): CustomersApi {
  return {
    listCustomers: async () => ({ items: [], total: 0 }),
    getCustomer: async () => {
      throw new Error('not used by this screen');
    },
    ...overrides,
  };
}

/**
 * RNTL v14 renders through a concurrent root, so `render` returns a promise —
 * an un-awaited one leaves `screen` empty rather than failing loudly.
 */
async function mount(
  customersApi: CustomersApi,
  onOpenCustomer = jest.fn(),
): Promise<{ onOpenCustomer: jest.Mock }> {
  const tree: ReactElement = (
    <ThemeProvider>
      <CustomersContext.Provider value={customersApi}>
        <CustomerListScreen onOpenCustomer={onOpenCustomer} />
      </CustomersContext.Provider>
    </ThemeProvider>
  );
  await render(tree);
  await act(async () => {});
  return { onOpenCustomer };
}

describe('CustomerListScreen', () => {
  it('says there are no customers rather than showing a blank rectangle', async () => {
    await mount(api());

    expect(await screen.findByText('No customers yet.')).toBeOnTheScreen();
  });

  it('says what went wrong when the list could not be loaded', async () => {
    await mount(
      api({
        listCustomers: async () => {
          throw new Error('Could not reach the server.');
        },
      }),
    );

    expect(await screen.findByText('Could not reach the server.')).toBeOnTheScreen();
  });

  it('lists customers with their contact details', async () => {
    await mount(
      api({
        listCustomers: async () => ({
          items: [customer({ id: 'cust-1', name: 'Ada Lovelace', email: 'ada@example.com' })],
          total: 1,
        }),
      }),
    );

    expect(await screen.findByText('Ada Lovelace')).toBeOnTheScreen();
    expect(screen.getByText('ada@example.com')).toBeOnTheScreen();
  });

  it('names an anonymous visitor rather than showing a blank row', async () => {
    await mount(
      api({
        listCustomers: async () => ({
          items: [customer({ id: 'cust-1', name: null, email: null })],
          total: 1,
        }),
      }),
    );

    expect(await screen.findByText('Unnamed visitor')).toBeOnTheScreen();
  });

  it('opens the customer that was tapped', async () => {
    const { onOpenCustomer } = await mount(
      api({
        listCustomers: async () => ({
          items: [customer({ id: 'cust-7', name: 'Grace Hopper' })],
          total: 1,
        }),
      }),
    );

    await fireEvent.press(await screen.findByTestId('customer-row-cust-7'));

    expect(onOpenCustomer).toHaveBeenCalledWith({ customerId: 'cust-7', title: 'Grace Hopper' });
  });

  it('searches by name, email or phone, debounced', async () => {
    const listCustomers = jest.fn(async (): Promise<CustomersPage> => ({ items: [], total: 0 }));
    await mount(api({ listCustomers }));
    listCustomers.mockClear();

    await fireEvent.changeText(screen.getByTestId('customer-search'), 'grace');

    // The debounce timer has not fired yet — nothing sent so far.
    expect(listCustomers).not.toHaveBeenCalled();

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(listCustomers).toHaveBeenCalledWith(
      expect.objectContaining({ segment: 'all', query: 'grace' }),
    );
  });

  it('switches segment and refetches with the new filter', async () => {
    const listCustomers = jest.fn(async (): Promise<CustomersPage> => ({ items: [], total: 0 }));
    await mount(api({ listCustomers }));
    listCustomers.mockClear();

    await fireEvent.press(screen.getByTestId('customer-segment-banned'));
    await waitFor(() =>
      expect(listCustomers).toHaveBeenCalledWith(expect.objectContaining({ segment: 'banned' })),
    );
  });

  it('says nobody matches a search rather than reusing the empty-list message', async () => {
    await mount(
      api({
        listCustomers: async ({ query }) =>
          query ? { items: [], total: 0 } : { items: [customer({ id: 'cust-1' })], total: 1 },
      }),
    );
    await screen.findByText('Ada Lovelace');

    await fireEvent.changeText(screen.getByTestId('customer-search'), 'nobody');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(await screen.findByText('Nobody matches that search.')).toBeOnTheScreen();
  });
});
