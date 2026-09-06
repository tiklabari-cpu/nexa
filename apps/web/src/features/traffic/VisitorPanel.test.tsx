/**
 * The Traffic visitor 360° panel (203.1, FR-MOD-13.2) — identity, visit
 * count, "came from" and groups, opened in place rather than by navigating to
 * the Customers page. Visited pages and pre-chat form answers are 203.2's
 * addition to this same panel.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { CustomerDetail } from '../customers/types.js';
import { VisitorPanel } from './VisitorPanel.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

function baseCustomer(overrides?: Partial<CustomerDetail>): CustomerDetail {
  return {
    id: 'cust-1',
    name: 'Ada Visitor',
    email: 'ada@example.com',
    phone: null,
    country_code: 'US',
    country: 'United States',
    is_lead: false,
    banned: false,
    banned_at: null,
    chats_count: 1,
    tickets_count: 0,
    last_activity_at: '2026-07-20T10:00:00.000Z',
    created_at: '2026-07-01T10:00:00.000Z',
    visits_count: 1,
    groups: [],
    visits: [],
    chats: [],
    custom_fields: [],
    ...overrides,
  };
}

function renderPanel(props?: {
  customer?: CustomerDetail;
  canViewPii?: boolean;
  stillOnBoard?: boolean;
  onClose?: () => void;
}): ReturnType<typeof render> {
  const customer = props?.customer ?? baseCustomer();
  api.get.mockReset();
  api.get.mockResolvedValue(customer);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <VisitorPanel
        customerId={customer.id}
        canViewPii={props?.canViewPii ?? true}
        stillOnBoard={props?.stillOnBoard ?? true}
        onClose={props?.onClose ?? (() => {})}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
});

describe('VisitorPanel — identity and visits (FR-MOD-13.2)', () => {
  it('shows the name as the dialog title, the email, and the true visit count', async () => {
    renderPanel({ customer: baseCustomer({ name: 'Robin Lee', email: 'robin@example.com' }) });

    expect(await screen.findByRole('dialog', { name: 'Robin Lee' })).toBeInTheDocument();
    expect(screen.getByText('robin@example.com')).toBeInTheDocument();
    expect(screen.getByText('Visits')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('Returning visitor')).not.toBeInTheDocument();
  });

  it('shows the "Returning visitor" badge once visits_count is above 1', async () => {
    renderPanel({ customer: baseCustomer({ visits_count: 3 }) });

    expect(await screen.findByText('3')).toBeInTheDocument();
    expect(screen.getByText('Returning visitor')).toBeInTheDocument();
  });

  it('falls back to "Unnamed visitor" in the title when the visitor has no name', async () => {
    renderPanel({ customer: baseCustomer({ name: null }) });
    expect(await screen.findByRole('dialog', { name: 'Unnamed visitor' })).toBeInTheDocument();
  });

  it('shows "came from" for the most recent visit, as plain text, never a link', async () => {
    renderPanel({
      customer: baseCustomer({
        visits: [
          {
            id: 'v1',
            came_from: 'https://google.com/search?q=live+chat',
            pages: [],
            os: null,
            browser: null,
            started_at: '2026-07-20T10:00:00.000Z',
            ended_at: null,
          },
        ],
      }),
    });

    expect(
      await screen.findByText('Came from https://google.com/search?q=live+chat'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('shows no "Came from" line when the visit carries none', async () => {
    renderPanel({
      customer: baseCustomer({
        visits: [
          {
            id: 'v1',
            came_from: null,
            pages: [],
            os: null,
            browser: null,
            started_at: '2026-07-20T10:00:00.000Z',
            ended_at: null,
          },
        ],
      }),
    });

    await screen.findByText('Groups');
    expect(screen.queryByText(/Came from/)).not.toBeInTheDocument();
  });

  it('shows a meaningful empty state when the visitor has no groups', async () => {
    renderPanel({ customer: baseCustomer({ groups: [] }) });
    expect(
      await screen.findByText(
        'Not routed to a team yet. Groups appear here once one of their conversations is assigned.',
      ),
    ).toBeInTheDocument();
  });

  it('lists the routed team names when the visitor has groups', async () => {
    renderPanel({
      customer: baseCustomer({
        groups: [
          { id: 1, name: 'Sales' },
          { id: 2, name: 'Support' },
        ],
      }),
    });
    expect(await screen.findByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
  });

  it('shows an honest error when the customer fails to load', async () => {
    api.get.mockReset();
    api.get.mockRejectedValue(new Error('boom'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <VisitorPanel customerId="missing" canViewPii onClose={() => {}} stillOnBoard />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load this customer.');
  });
});

describe('VisitorPanel — PII gate (FR-MOD-13.2)', () => {
  it('withholds name and email without customer edit access, but keeps visits/came from/groups visible', async () => {
    renderPanel({
      canViewPii: false,
      customer: baseCustomer({
        name: 'Robin Lee',
        email: 'robin@example.com',
        visits_count: 2,
        visits: [
          {
            id: 'v1',
            came_from: 'https://example.com/blog',
            pages: [],
            os: null,
            browser: null,
            started_at: '2026-07-20T10:00:00.000Z',
            ended_at: null,
          },
        ],
        groups: [{ id: 1, name: 'Sales' }],
      }),
    });

    // The dialog title never names the visitor without the scope — true from
    // the first render, since it never depends on the fetch resolving.
    expect(await screen.findByRole('dialog', { name: 'Visitor' })).toBeInTheDocument();
    // Wait for the fetch before asserting on its (withheld) content.
    expect(
      await screen.findByText(
        'Contact details are hidden. Ask an admin for customer edit access to view them.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Robin Lee')).not.toBeInTheDocument();
    expect(screen.queryByText('robin@example.com')).not.toBeInTheDocument();

    // Not treated as PII in this slice — a supervising agent without customer
    // edit access still gets situational awareness from the board.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Returning visitor')).toBeInTheDocument();
    expect(screen.getByText('Came from https://example.com/blog')).toBeInTheDocument();
    expect(screen.getByText('Sales')).toBeInTheDocument();
  });
});

describe('VisitorPanel — live board honesty (FR-MOD-13.2)', () => {
  it('says the visitor is no longer online when they have dropped off the board, without hiding what already loaded', async () => {
    renderPanel({ stillOnBoard: false, customer: baseCustomer({ name: 'Robin Lee' }) });

    // Shown immediately — it never depends on the fetch resolving.
    expect(await screen.findByText('This visitor is no longer online.')).toBeInTheDocument();
    // What was already loaded stays visible alongside the notice.
    expect(await screen.findByRole('dialog', { name: 'Robin Lee' })).toBeInTheDocument();
    expect(screen.getByText('Visits')).toBeInTheDocument();
  });

  it('shows no "no longer online" notice while the visitor is still on the board', async () => {
    renderPanel({ stillOnBoard: true });
    await screen.findByText('Visits');
    expect(screen.queryByText('This visitor is no longer online.')).not.toBeInTheDocument();
  });
});

describe('VisitorPanel localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the panel in Turkish when that is the active locale', () => {
    api.get.mockResolvedValue(baseCustomer({ name: null }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <VisitorPanel customerId="cust-1" canViewPii onClose={() => {}} stillOnBoard />
      </QueryClientProvider>,
      'tr',
    );

    expect(screen.getByRole('dialog', { name: 'İsimsiz ziyaretçi' })).toBeInTheDocument();
  });
});
