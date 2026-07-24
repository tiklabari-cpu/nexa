/**
 * The command palette: opening, route jumping, and content search.
 *
 * Route jumping needs no network and is asserted against a real router. Content
 * search is gated on the caller's scopes and hits three endpoints, so `fetch`
 * is stubbed: the point is that a query becomes the right requests and that
 * picking a result navigates to that record's deep link — not the wire format,
 * which the API's own suites own.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { CommandPalette } from './CommandPalette.js';
import { useAuth } from '../lib/auth-store.js';

/** Surfaces the current location so navigation can be asserted. */
function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const CUSTOMER = {
  id: 'cust-mira',
  name: 'Mira Haddad',
  email: 'mira@acme-customer.localhost',
  phone: null,
  country_code: null,
  country: null,
  is_lead: false,
  banned: false,
  chats_count: 0,
  tickets_count: 0,
  last_activity_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

const TICKET = {
  id: 'TCK123',
  subject: 'Refund for order 42',
  status: 'open',
  assignee_id: null,
  assignee_name: null,
  group_id: null,
  customer_id: 'cust-mira',
  customer_name: 'Mira Haddad',
  customer_email: null,
  source_chat_id: null,
  last_message_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

function stubFetch(): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string) => {
    if (input.includes('/customers')) return jsonResponse({ items: [CUSTOMER] });
    if (input.includes('/tickets')) return jsonResponse({ items: [TICKET] });
    if (input.includes('/chats')) return jsonResponse({ items: [] });
    return jsonResponse({ items: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPalette(scopes: string[]) {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'owner@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes,
      routing_status: 'accepting_chats',
    },
  });

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/inbox']}>
        <CommandPalette />
        <LocationProbe />
        <Routes>
          <Route path="/app/inbox" element={<p>Inbox module</p>} />
          <Route path="/app/reports" element={<p>Reports module</p>} />
          <Route path="/app/customers" element={<p>Customers module</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Meta>}k{/Meta}');
  return screen.findByRole('dialog', { name: 'Command palette' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('command palette', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ items: [] })));
  });

  it('opens on ⌘K and closes on Escape', async () => {
    const user = userEvent.setup();
    renderPalette([]);

    expect(screen.queryByRole('dialog')).toBeNull();
    await openPalette(user);
    expect(screen.getByRole('combobox', { name: 'Search or jump to' })).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists every module as a jump target when empty', async () => {
    const user = userEvent.setup();
    renderPalette([]);
    await openPalette(user);

    for (const name of ['Inbox', 'Customers', 'Team', 'Playbook', 'Reports', 'Billing', 'Settings']) {
      expect(screen.getByRole('option', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it('filters modules and jumps to the chosen one on Enter', async () => {
    const user = userEvent.setup();
    renderPalette([]);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'report');
    expect(screen.getByRole('option', { name: /Reports/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Inbox/ })).toBeNull();

    await user.keyboard('{Enter}');
    expect(screen.getByText('Reports module')).toBeInTheDocument();
    // The palette closes behind the jump rather than lingering over the target.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('matches a module by keyword, not only its label', async () => {
    const user = userEvent.setup();
    renderPalette([]);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'subscription');
    expect(screen.getByRole('option', { name: /Billing/ })).toBeInTheDocument();
  });

  it('searches customers and tickets and opens the record deep link', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderPalette(['customers:ro', 'tickets--all:ro', 'chats--all:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'mira');

    // Both content groups resolve from the stubbed API. The customer is matched
    // by e-mail because the ticket also carries the customer's name.
    const customer = await screen.findByRole('option', { name: /mira@acme-customer/ });
    expect(await screen.findByRole('option', { name: /Refund for order 42/ })).toBeInTheDocument();

    await user.click(customer);
    expect(screen.getByTestId('location')).toHaveTextContent('/app/customers?customer=cust-mira');
    expect(screen.getByText('Customers module')).toBeInTheDocument();
  });

  it('does not query a resource the caller has no scope to read', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    // Chats scope only: customers and tickets must never be requested.
    renderPalette(['chats--all:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'mira');
    await screen.findByRole('combobox', { name: 'Search or jump to' });
    // Give the debounce and any queries time to fire before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 250));

    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes('/customers'))).toBe(false);
    expect(requested.some((url) => url.includes('/tickets'))).toBe(false);
  });
});
