/**
 * Possible matches in the inbox's Details panel (ID-03 · K4 · tm 287.4): while
 * an agent talks to a visitor, other records with the same typed username or
 * e-mail are named — unverified — with a way to the customer's profile, where
 * linking (and its undo) lives. Nothing is drawn when there is nothing to say.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetailsPanel } from './DetailsPanel.js';
import type { ChatDetail } from './types.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  authState: { agent: { role: 'agent', scopes: ['customers:ro'] } },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: (selector: (state: typeof authState) => unknown) => selector(authState),
}));

const CHAT: ChatDetail = {
  id: 'TJ1H8CFKRV',
  license_id: '1000003',
  customer_id: 'cust-1',
  active: true,
  created_at: '2026-07-20T10:00:00.000Z',
  access: { group_ids: [] },
  users: [],
  thread: {
    id: 'TH1',
    chat_id: 'TJ1H8CFKRV',
    active: true,
    assignee_id: null,
    queue_position: null,
    summary: null,
    created_at: '2026-07-20T10:00:00.000Z',
    closed_at: null,
    tags: [],
  },
};

function answerMatches(body: unknown): void {
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path === '/customers/cust-1/possible-matches' ? body : { items: [] }),
  );
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DetailsPanel chat={CHAT} chatId={CHAT.id} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
});

describe('DetailsPanel — possible matches (ID-03)', () => {
  it('names the other records, unverified, and points at their profiles', async () => {
    answerMatches({
      enabled: true,
      items: [
        {
          customer: {
            id: 'cust-2',
            name: 'Phone Mira',
            username: 'mirah_92',
            email: 'mira@example.test',
            last_activity_at: null,
          },
          matched_on: ['username', 'email'],
          linked: true,
        },
        {
          customer: {
            id: 'cust-3',
            name: null,
            username: null,
            email: null,
            last_activity_at: null,
          },
          matched_on: ['email'],
          linked: false,
        },
      ],
    });
    renderPanel();

    expect(await screen.findByText('Possible matches (unverified)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Phone Mira' })).toHaveAttribute(
      'href',
      '/app/customers?customer=cust-2',
    );
    expect(screen.getByText('Same username · Same email · Linked')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Unnamed visitor' })).toHaveAttribute(
      'href',
      '/app/customers?customer=cust-3',
    );
    // Linking is the profile's job, with its confirmation — never one click here.
    expect(screen.queryByRole('button', { name: /Link/ })).not.toBeInTheDocument();
  });

  it.each([
    ['there are none', { enabled: true, items: [] }],
    ['the workspace turned them off', { enabled: false, items: [] }],
  ])('draws no section when %s', async (_case, body) => {
    answerMatches(body);
    renderPanel();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers/cust-1/possible-matches'));
    expect(screen.queryByText(/Possible matches/)).not.toBeInTheDocument();
  });

  it('draws no section when the caller may not read customers', async () => {
    api.get.mockImplementation((path: string) =>
      path === '/customers/cust-1/possible-matches'
        ? Promise.reject(new Error('forbidden'))
        : Promise.resolve({ items: [] }),
    );
    renderPanel();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/customers/cust-1/possible-matches'));
    expect(screen.queryByText(/Possible matches/)).not.toBeInTheDocument();
  });
});
