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
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CustomersPage } from './CustomersPage.js';
import { useAuth } from '../../lib/auth-store.js';

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
