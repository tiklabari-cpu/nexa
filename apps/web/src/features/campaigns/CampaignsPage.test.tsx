/**
 * Campaigns page (FR-MOD-03.3). The two acceptance criteria this pins at the UI:
 * the status sub-tabs narrow the list (03.3.1), and each card shows the campaign's
 * Displayed / Chats / Conversion with a working on/off toggle (03.3.3) — with the
 * write controls hidden from a read-only agent.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Campaign, CampaignStatus } from '@nexa/types';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
  auth: { scopes: [] as string[] },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: auth.scopes } }),
  };
});

const { CampaignsPage } = await import('./CampaignsPage.js');

function campaign(status: CampaignStatus, name: string, over: Partial<Campaign> = {}): Campaign {
  return {
    id: `c-${name}`,
    name,
    status,
    conditions: { url_contains: '/pricing' },
    content: { message: 'Hi' },
    starts_at: null,
    ends_at: null,
    recurring: false,
    created_at: '2026-07-26T12:00:00.000Z',
    performance: { displayed: 0, chats: 0, conversion: 0 },
    ...over,
  };
}

const LIST = {
  items: [
    campaign('ongoing', 'Running', {
      performance: { displayed: 200, chats: 30, conversion: 12 },
    }),
    campaign('scheduled', 'Later'),
    campaign('inactive', 'Off'),
  ],
  total: 3,
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <CampaignsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue(LIST);
  auth.scopes = ['customers:rw'];
});

describe('CampaignsPage', () => {
  it('filters the list by the status sub-tabs (FR-MOD-03.3.1)', async () => {
    renderPage();
    // All three visible on the default "All" tab.
    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Later')).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ongoing/ }));

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByText('Later')).not.toBeInTheDocument();
    expect(screen.queryByText('Off')).not.toBeInTheDocument();
  });

  it("shows each campaign's Displayed / Chats / Conversion (FR-MOD-03.3.3)", async () => {
    renderPage();
    const card = (await screen.findByText('Running')).closest('div.rounded-lg') as HTMLElement;
    const stats = within(card);
    expect(stats.getByText('Displayed').parentElement).toHaveTextContent('200');
    expect(stats.getByText('Chats').parentElement).toHaveTextContent('30');
    // Conversion shows the count and its rate (12 / 200 = 6%).
    expect(stats.getByText('Conversion').parentElement).toHaveTextContent('12');
    expect(stats.getByText('Conversion').parentElement).toHaveTextContent('6%');
  });

  it('toggles a campaign off (FR-MOD-03.3.3)', async () => {
    api.patch.mockResolvedValue(campaign('inactive', 'Running'));
    renderPage();
    const card = (await screen.findByText('Running')).closest('div.rounded-lg') as HTMLElement;

    await userEvent.click(within(card).getByRole('button', { name: 'Turn off' }));
    expect(api.patch).toHaveBeenCalledWith('/campaigns/c-Running', { active: false });
  });

  it('hides the write controls from a read-only agent', async () => {
    auth.scopes = ['customers:ro'];
    renderPage();
    await screen.findByText('Running');
    expect(screen.queryByRole('button', { name: 'New campaign' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});

describe('CampaignsPage localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the page in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <CampaignsPage />
        </QueryClientProvider>
      </MemoryRouter>,
      'tr',
    );

    expect(await screen.findByText('Running')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Müşteriler', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yeni kampanya' })).toBeInTheDocument();
  });
});
