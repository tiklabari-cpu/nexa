/**
 * Customers below 1024 px (GV-04 · tm 472.1): the seven-column table is a list
 * of cards, sorted from a menu since cards have no headers, and an opened
 * record fills the screen with a way back to the list. At a desktop width the
 * table and the record beside it are unchanged.
 *
 * jsdom has no layout and no `matchMedia`, so the width is stubbed; whether the
 * page then fits 375 px without sideways scroll is a layout fact and lives in
 * `narrow-settings-customers.spec.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CustomersPage } from './CustomersPage.js';
import { useAuth } from '../../lib/auth-store.js';
import { resetLocale, setLocale } from '../../test/i18n.js';
import type { CustomerDetail, CustomerSummary } from './types.js';

function stubWidth(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function customer(id: string, over: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id,
    name: id,
    email: null,
    username: null,
    phone: null,
    country_code: null,
    country: null,
    is_lead: false,
    banned: false,
    chats_count: 0,
    connections_count: 0,
    tickets_count: 0,
    last_activity_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    table_custom_fields: [],
    ...over,
  };
}

const ALEX = customer('C1', {
  name: 'Alex Moreau',
  email: 'alex@example.com',
  is_lead: true,
  chats_count: 3,
  tickets_count: 1,
});
const MIRA = customer('C2', { name: 'Mira Haddad', phone: '+90 555 000 0000' });

function detail(of: CustomerSummary): CustomerDetail {
  return {
    ...of,
    banned_at: null,
    visits_count: 0,
    groups: [],
    visits: [],
    chats: [],
    custom_fields: [],
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function renderPage(path = '/app/customers') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/customers" element={<CustomersPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: ['customers:ro'],
      routing_status: 'accepting_chats',
    },
  });
  fetchMock = vi.fn(async (url: string) => {
    if (/\/customers\/C1(\?|$)/.test(url)) return jsonResponse(detail(ALEX));
    if (/\/customers\?/.test(url)) return jsonResponse({ items: [ALEX, MIRA], total: 2 });
    return jsonResponse({ items: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetLocale();
});

describe('Customers on a phone (tm 472.1)', () => {
  it('lists people as cards, not as a table', async () => {
    stubWidth(375);
    renderPage();

    const list = await screen.findByRole('list', { name: 'Customers' });
    expect(screen.queryByRole('table')).toBeNull();
    const cards = within(list).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    // Name and marks, a way to reach them, and what they have opened.
    expect(cards[0]).toHaveTextContent('Alex Moreau');
    expect(cards[0]).toHaveTextContent('lead');
    expect(cards[0]).toHaveTextContent('alex@example.com');
    expect(cards[0]).toHaveTextContent('Chats 3');
    expect(cards[0]).toHaveTextContent('Tickets 1');
    // No e-mail: the phone number is the way to reach them.
    expect(cards[1]).toHaveTextContent('+90 555 000 0000');
  });

  it('nothing is chosen yet: no empty record panel under the list', async () => {
    stubWidth(375);
    renderPage();
    await screen.findByRole('list', { name: 'Customers' });
    expect(screen.queryByText('Select someone to see their history.')).toBeNull();
  });

  it('a card opens the record in place of the list, with a way back', async () => {
    stubWidth(375);
    const user = userEvent.setup();
    renderPage();
    const list = await screen.findByRole('list', { name: 'Customers' });
    await user.click(within(list).getByRole('button', { name: /Alex Moreau/ }));

    expect(await screen.findByRole('heading', { level: 2, name: 'Alex Moreau' })).toBeVisible();
    expect(screen.queryByRole('list', { name: 'Customers' })).toBeNull();
    expect(screen.queryByRole('tablist', { name: 'Customer segments' })).toBeNull();
    const back = screen.getByRole('button', { name: 'All customers' });
    expect(back).toHaveClass('min-h-11');

    await user.click(back);
    expect(await screen.findByRole('list', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 2, name: 'Alex Moreau' })).toBeNull();
  });

  it('a deep link to one person opens their record alone', async () => {
    stubWidth(375);
    renderPage('/app/customers?customer=C1');
    expect(await screen.findByRole('heading', { level: 2, name: 'Alex Moreau' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'All customers' })).toBeInTheDocument();
  });

  it('sorts from a menu, the request carrying the choice', async () => {
    stubWidth(375);
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('list', { name: 'Customers' });

    const menu = screen.getByRole('combobox', { name: 'Sort by' });
    expect(menu).toHaveValue('last_activity:desc');
    expect(
      within(menu)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual([
      'Name, ascending',
      'Name, descending',
      'Country, ascending',
      'Country, descending',
      'Last active, descending',
      'Last active, ascending',
    ]);
    await user.selectOptions(menu, 'name:asc');

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) => String(url).includes('sort=name') && String(url).includes('order=asc'),
        ),
      ).toBe(true),
    );
    expect(screen.getByRole('combobox', { name: 'Sort by' })).toHaveValue('name:asc');
  });

  it('segments, tabs and search are finger-sized below 1024 px', async () => {
    stubWidth(375);
    renderPage();
    await screen.findByRole('list', { name: 'Customers' });
    expect(screen.getByRole('tab', { name: 'All' })).toHaveClass('max-lg:min-h-11');
    expect(screen.getByRole('link', { name: 'Contacts' })).toHaveClass('max-lg:min-h-11');
    expect(screen.getByRole('searchbox')).toHaveClass('max-lg:min-h-11');
  });

  it('speaks Turkish in the Turkish console', async () => {
    setLocale('tr');
    stubWidth(375);
    const user = userEvent.setup();
    renderPage();
    const list = await screen.findByRole('list', { name: 'Müşteriler' });
    expect(screen.getByRole('combobox', { name: 'Sırala' })).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: /Alex Moreau/ }));
    expect(await screen.findByRole('button', { name: 'Tüm müşteriler' })).toBeInTheDocument();
  });
});

describe('Customers at a desktop width (unchanged)', () => {
  it('keeps the table and the record beside it, sorted by the headers', async () => {
    stubWidth(1280);
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('table', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Sort by' })).toBeNull();
    await user.click(screen.getByRole('button', { name: /Alex Moreau/ }));
    expect(await screen.findByRole('heading', { level: 2, name: 'Alex Moreau' })).toBeVisible();
    // Both panes: the table stays beside the record.
    expect(screen.getByRole('table', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'All customers' })).toBeNull();
  });
});
