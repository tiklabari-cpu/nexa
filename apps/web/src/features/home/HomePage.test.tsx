/**
 * Home dashboard screen (FR-MOD-13.1).
 *
 * The three sections rendered from one read: the activation checklist reflects
 * each step's done/to-do state (a done step is struck through and offers no
 * link; a to-do step offers a "Set up" link to the right module), the live
 * counters show their numbers, and the weekly KPIs show a value with a
 * week-over-week delta. A caller the API refuses (403) sees an honest panel, not
 * a raw error.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { HomeDashboard } from '@nexa/types';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { HomePage } = await import('./HomePage.js');

const DASHBOARD: HomeDashboard = {
  activation: {
    steps: [
      { key: 'install_widget', done: false },
      { key: 'invite_teammate', done: true },
      { key: 'customize_widget', done: false },
      { key: 'add_canned_response', done: false },
      { key: 'set_up_ai_agent', done: false },
    ],
    completed: 1,
    total: 5,
  },
  live: { visitors_online: 7, ongoing_chats: 3, agents_online: 2 },
  weekly: {
    range: { from: '2026-07-19T00:00:00.000Z', to: '2026-07-26T00:00:00.000Z' },
    chats: 40,
    resolved: 34,
    satisfaction: { good: 6, bad: 2, responses: 8, score: 0.75 },
    previous: {
      range: { from: '2026-07-12T00:00:00.000Z', to: '2026-07-18T23:59:59.999Z' },
      chats: 30,
      resolved: 34,
      satisfaction_score: 0.6,
    },
  },
};

function renderHome(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>
    </QueryClientProvider>
  );
  render(ui);
}

beforeEach(() => {
  api.get.mockReset();
});

describe('HomePage', () => {
  it('renders the activation checklist with done and to-do steps', async () => {
    api.get.mockResolvedValue(DASHBOARD);
    renderHome();

    expect(await screen.findByText('1 of 5 steps complete')).toBeInTheDocument();

    // A done step is struck through and offers no "Set up" link…
    const invited = screen.getByText('Invite a teammate');
    expect(invited).toHaveClass('line-through');

    // …a to-do step offers a link to the module that completes it.
    const install = screen.getByText('Install the chat widget').closest('li');
    expect(install).not.toBeNull();
    expect(
      within(install as HTMLElement).getByRole('link', { name: 'Set up' }),
    ).toBeInTheDocument();

    // Four of five steps still show a "Set up" link.
    expect(screen.getAllByRole('link', { name: 'Set up' })).toHaveLength(4);
  });

  it('shows the live counters', async () => {
    api.get.mockResolvedValue(DASHBOARD);
    renderHome();

    const visitors = (await screen.findByText('Visitors online')).closest('div');
    expect(within(visitors as HTMLElement).getByText('7')).toBeInTheDocument();

    expect(screen.getByText('Ongoing chats')).toBeInTheDocument();
    expect(screen.getByText('Agents online')).toBeInTheDocument();
  });

  it('shows weekly performance with week-over-week deltas', async () => {
    api.get.mockResolvedValue(DASHBOARD);
    renderHome();

    const chats = (await screen.findByText('New chats')).closest('div');
    expect(within(chats as HTMLElement).getByText('40')).toBeInTheDocument();
    // 40 vs 30 last week → up 10.
    expect(within(chats as HTMLElement).getByText(/↑ 10 vs last week/)).toBeInTheDocument();

    // Resolved unchanged (34 vs 34) → neutral note, not a false arrow.
    const resolved = (await screen.findByText('Resolved')).closest('div');
    expect(within(resolved as HTMLElement).getByText('No change vs last week')).toBeInTheDocument();

    // Satisfaction 75% vs 60% → up 15 points.
    const csat = (await screen.findByText('Satisfaction')).closest('div');
    expect(within(csat as HTMLElement).getByText(/↑ 15 pts vs last week/)).toBeInTheDocument();
  });

  it('shows an honest panel when the caller may not see the dashboard', async () => {
    api.get.mockRejectedValue(
      new ApiClientError({
        type: 'authorization',
        status: 403,
        message: 'nope',
        requestId: '-',
      }),
    );
    renderHome();

    expect(await screen.findByText('Dashboard not available')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to inbox' })).toBeInTheDocument();
  });
});
