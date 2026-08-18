/**
 * The customer 360° panel (13.2-j): the summary `dl` block, visit history and
 * the routing groups it belongs to.
 *
 * `Visit.ip` is personal data that must never reach the widget or this panel
 * (schema.prisma `Visit.ip` comment, NFR-S9) — the negative test below stands
 * in for that boundary even though the frontend `Visit` type has no `ip` field
 * to begin with, so a future contract change that adds one cannot silently
 * start rendering it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerDetailPanel } from './CustomerDetailPanel.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { CustomerDetail } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

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
    chats_count: 2,
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

function renderPanel(customer: CustomerDetail) {
  api.get.mockReset();
  api.get.mockResolvedValue(customer);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CustomerDetailPanel
        customerId={customer.id}
        canEdit={false}
        canBan={false}
        onChanged={() => {}}
        onBanToggle={() => {}}
        banPending={false}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.put.mockReset();
  api.patch.mockReset();
});

describe('CustomerDetailPanel — visits summary', () => {
  it('shows the true visits_count and no "Returning visitor" badge for a single visit', async () => {
    renderPanel(baseCustomer({ visits_count: 1 }));

    expect(await screen.findByText('Visits')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('Returning visitor')).not.toBeInTheDocument();
  });

  it('shows the "Returning visitor" badge once visits_count is above 1, independent of the capped visits array', async () => {
    // visits_count is the true total; `visits` is capped separately (13.2-i,
    // MAX_VISITS=10) — a 2-item array must not gate the badge on 12 visits.
    renderPanel(
      baseCustomer({
        visits_count: 12,
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
    );

    expect(await screen.findByText('12')).toBeInTheDocument();
    expect(screen.getByText('Returning visitor')).toBeInTheDocument();
  });
});

describe('CustomerDetailPanel — visit history "came from"', () => {
  it('shows the came_from text for a visit that has one', async () => {
    renderPanel(
      baseCustomer({
        visits: [
          {
            id: 'v1',
            came_from: 'https://google.com/search?q=live+chat',
            pages: [{ url: 'https://shop.example/bikes' }],
            os: 'macOS',
            browser: 'Chrome',
            started_at: '2026-07-20T10:00:00.000Z',
            ended_at: null,
          },
        ],
      }),
    );

    const cameFrom = await screen.findByText('Came from https://google.com/search?q=live+chat');
    expect(cameFrom).toBeInTheDocument();
    // Visitor-supplied — rendered as text, never as a one-click link.
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the visit row silently, with no "Came from" line, when came_from is null', async () => {
    renderPanel(
      baseCustomer({
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
    );

    await screen.findByText('Visited pages');
    expect(screen.queryByText(/Came from/)).not.toBeInTheDocument();
  });
});

describe('CustomerDetailPanel — Groups card (FR-EK-B.1)', () => {
  it('shows a meaningful empty state when the visitor has no groups', async () => {
    renderPanel(baseCustomer({ groups: [] }));

    expect(await screen.findByText('Groups')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Not routed to a team yet. Groups appear here once one of their conversations is assigned.',
      ),
    ).toBeInTheDocument();
  });

  it('lists the routed team names when the visitor has groups', async () => {
    renderPanel(
      baseCustomer({
        groups: [
          { id: 1, name: 'Sales' },
          { id: 2, name: 'Support' },
        ],
      }),
    );

    expect(await screen.findByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('Support')).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Not routed to a team yet. Groups appear here once one of their conversations is assigned.',
      ),
    ).not.toBeInTheDocument();
  });
});

describe('CustomerDetailPanel — NFR-S9: no IP in the DOM', () => {
  it('never renders an IP address, even if the API response carries one on a visit', async () => {
    renderPanel(
      baseCustomer({
        visits: [
          {
            id: 'v1',
            came_from: 'https://google.com',
            pages: [{ url: 'https://shop.example' }],
            os: 'macOS',
            browser: 'Chrome',
            started_at: '2026-07-20T10:00:00.000Z',
            ended_at: null,
            // Simulates a leaked field the contract does not declare — the
            // panel must not surface it even if the wire payload carries it.
            ...({ ip: '203.0.113.7' } as Record<string, unknown>),
          },
        ],
      }),
    );

    await screen.findByText('Visited pages');
    expect(screen.queryByText('203.0.113.7')).not.toBeInTheDocument();
    expect(screen.queryByText(/203\.0\.113\.7/)).not.toBeInTheDocument();
  });
});

describe('CustomerDetailPanel — regression: existing cards still render', () => {
  it('renders Custom fields, Visited pages and Conversations without breaking', async () => {
    renderPanel(
      baseCustomer({
        custom_fields: [
          {
            definition_id: 'df1',
            label: 'Player ID',
            type: 'text',
            required: false,
            value: 'P-42',
          },
        ],
        visits: [
          {
            id: 'v1',
            came_from: null,
            pages: [{ url: 'https://shop.example/bikes' }],
            os: 'macOS',
            browser: 'Chrome',
            started_at: '2026-07-20T10:00:00.000Z',
            ended_at: null,
          },
        ],
        chats: [
          {
            id: 'CHAT0000001',
            active: true,
            created_at: '2026-07-20T10:05:00.000Z',
            last_event_at: null,
          },
        ],
      }),
    );

    expect(await screen.findByText('Custom fields')).toBeInTheDocument();
    expect(screen.getByText('P-42')).toBeInTheDocument();

    expect(screen.getByText('Visited pages')).toBeInTheDocument();
    expect(screen.getByText('https://shop.example/bikes')).toBeInTheDocument();

    // "Conversations" also labels the summary dl row above — the card heading
    // is disambiguated by role.
    expect(screen.getByRole('heading', { name: 'Conversations' })).toBeInTheDocument();
    expect(screen.getByText('CHAT0000001')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });
});

describe('CustomerDetailPanel localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the panel in Turkish when that is the active locale', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <CustomerDetailPanel
          customerId={null}
          canEdit={false}
          canBan={false}
          onChanged={() => {}}
          onBanToggle={() => {}}
          banPending={false}
        />
      </QueryClientProvider>,
      'tr',
    );

    expect(screen.getByText('Geçmişini görmek için birini seçin.')).toBeInTheDocument();
  });
});
