/**
 * The `?segment=` deep link (FR-MOD-01.1.2).
 *
 * The rail's Leads pill (`AppShell.tsx`) points at
 * `/app/customers?segment=leads` expecting the page to land on the Leads tab
 * rather than the default "all" segment — this is the half of that contract
 * only the page itself can prove. `?customer=` (a different deep link, already
 * wired) is left alone; this file adds coverage for `?segment=` only.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CustomersPage } from './CustomersPage.js';
import { useAuth } from '../../lib/auth-store.js';
import type { CustomerDetail, CustomerSummary } from './types.js';

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function renderPage(initialPath: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
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
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => jsonResponse({ items: [], total: 0 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('segment deep link (FR-MOD-01.1.2)', () => {
  it('selects the Leads tab when the URL asks for the leads segment', async () => {
    renderPage('/app/customers?segment=leads');

    expect(await screen.findByRole('tab', { name: 'Leads' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('defaults to the All tab without a segment param', async () => {
    renderPage('/app/customers');

    expect(await screen.findByRole('tab', { name: 'All' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

/**
 * Paging (P5-PAGE-e). `CustomersPage`'s `useQuery` moved onto 153.1's
 * `usePagedQuery`, the same wrapper Tickets (153.4) and Inbox (153.2) already
 * consume — `TicketGrid.test.tsx` established that a page small enough to fit
 * the virtualizer's fallback viewport already sits in `onEndReached`'s
 * trailing zone on mount, so these fixtures (two rows) walk to a second page
 * without simulating a real scroll.
 */
function customer(id: string, over: Partial<CustomerSummary> = {}): CustomerSummary {
  return {
    id,
    name: id,
    email: null,
    phone: null,
    country_code: null,
    country: null,
    is_lead: false,
    banned: false,
    chats_count: 0,
    tickets_count: 0,
    last_activity_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function customerDetail(id: string, over: Partial<CustomerSummary> = {}): CustomerDetail {
  return {
    ...customer(id, over),
    banned_at: null,
    visits_count: 0,
    groups: [],
    visits: [],
    chats: [],
    custom_fields: [],
  };
}

function customerPage(items: CustomerSummary[], total: number, next?: string): Response {
  return jsonResponse({ items, total, ...(next != null ? { next_page_id: next } : {}) });
}

describe('paging (P5-PAGE-e)', () => {
  it('walks past the first page and reports the shown/total indicator', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('page_id=cursor-1')) {
        return Promise.resolve(customerPage([customer('C3', { name: 'Robin Lee' })], 3));
      }
      return Promise.resolve(
        customerPage(
          [customer('C1', { name: 'Alex Moreau' }), customer('C2', { name: 'Mira Haddad' })],
          3,
          'cursor-1',
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage('/app/customers');

    await screen.findByText('Alex Moreau');
    // Second page arrives on its own — see the block comment above.
    await screen.findByText('Robin Lee');
    expect(screen.getByText('3 / 3 shown')).toBeInTheDocument();
  });

  it('a search change starts a new chain instead of appending to the loaded one', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('query=mira')) {
        return Promise.resolve(customerPage([customer('C2', { name: 'Mira Haddad' })], 1));
      }
      if (url.includes('page_id=cursor-1')) {
        return Promise.resolve(customerPage([customer('C3', { name: 'Robin Lee' })], 3));
      }
      return Promise.resolve(
        customerPage(
          [customer('C1', { name: 'Alex Moreau' }), customer('C2', { name: 'Mira Haddad' })],
          3,
          'cursor-1',
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage('/app/customers');
    // Load past the first page before searching, so a chain genuinely exists
    // to be thrown away rather than appended to.
    await screen.findByText('Robin Lee');

    fetchMock.mockClear();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search customers' }), {
      target: { value: 'mira' },
    });

    // "Mira Haddad" is already on screen before the search (she is on the
    // loaded first page too), and the new query key goes through its own
    // pending/skeleton state before its data lands — so the wait has to hold
    // for both halves of the final state at once, not either alone.
    await waitFor(
      () => {
        expect(screen.queryByText('Alex Moreau')).not.toBeInTheDocument();
        expect(screen.getByText('Mira Haddad')).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
    // A fresh chain, not a continuation: no request in this search ever asked
    // for a cursor.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('page_id='))).toBe(false);
  });

  it('a deep-linked customer on the second page still opens', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (/\/customers\/C3$/.test(url)) {
        return Promise.resolve(jsonResponse(customerDetail('C3', { name: 'Robin Lee' })));
      }
      if (url.includes('page_id=cursor-1')) {
        return Promise.resolve(customerPage([customer('C3', { name: 'Robin Lee' })], 3));
      }
      return Promise.resolve(
        customerPage(
          [customer('C1', { name: 'Alex Moreau' }), customer('C2', { name: 'Mira Haddad' })],
          3,
          'cursor-1',
        ),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage('/app/customers?customer=C3');

    // The panel opens straight from the deep link, before the row it points at
    // has even loaded — the selection must not be cleared while a further page
    // is still on its way (`!list.hasNext` gate). `level: 2` disambiguates the
    // panel's heading from the table row, which renders the same name as text.
    expect(await screen.findByRole('heading', { name: 'Robin Lee', level: 2 })).toBeInTheDocument();
    expect(screen.queryByText('Select someone to see their history.')).not.toBeInTheDocument();
  });
});

/**
 * The filter panel (FR-MOD-03.2.1). `TrafficPage`'s own condition panel
 * already proved the panel's internal behaviour (`CustomersFilters.test.tsx`
 * covers the same ground for Contacts' field set); what only this page can
 * prove is that a condition actually reaches the request, and that the URL
 * carries it across a reload.
 */
describe('filter panel (FR-MOD-03.2.1)', () => {
  it('selecting a condition sends the request with the matching query parameter', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('country_code=US')) {
        return Promise.resolve(customerPage([customer('C1', { name: 'Robin US' })], 1));
      }
      return Promise.resolve(customerPage([], 0));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage('/app/customers');
    await screen.findByText('No customers yet');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(screen.getByRole('button', { name: 'Country' }));
    fireEvent.change(screen.getByLabelText('Country'), { target: { value: 'US' } });

    // The field debounces 250ms before it commits (`ConditionFilters`) — the
    // same generous timeout the search-box debounce test above uses.
    await waitFor(() => expect(screen.getByText('Robin US')).toBeInTheDocument(), {
      timeout: 2000,
    });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('country_code=US'))).toBe(
      true,
    );
  });

  it('restores the same filter from a reloaded URL', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes('country_code=DE')) {
        return Promise.resolve(customerPage([customer('C2', { name: 'Mira DE' })], 1));
      }
      return Promise.resolve(customerPage([], 0));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderPage('/app/customers?country_code=DE');

    expect(await screen.findByLabelText('Country')).toHaveValue('DE');
    await screen.findByText('Mira DE');
  });
});
