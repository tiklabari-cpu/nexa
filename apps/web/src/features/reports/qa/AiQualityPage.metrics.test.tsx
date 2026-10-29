/**
 * The Team Lead's AI quality figures (tm 320.3 · AI-25, RL-02): a lead holds
 * no reports scope, so Raporlar › AI Kalite gives them a "Metrics" view that
 * reads the breakdown (their own teams, by the server's reach) — never the
 * billed `GET /reports/ai-agent` they would be refused. Someone with the
 * reports scope reads the same panel on the AI Agent tab, so the view is not
 * offered to them twice.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { AiQualityPage } = await import('./AiQualityPage.js');
const { useAuth } = await import('../../../lib/auth-store.js');

function signIn(role: string, scopes: string[]): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'x@acme.localhost',
      name: 'X',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes,
      routing_status: 'accepting_chats',
    },
  });
}

function renderAt(path: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/reports/ai-quality" element={<AiQualityPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  // The queue and the figures stay loading: this file is about which read is made.
  api.get.mockReturnValue(new Promise(() => {}));
});

describe('Raporlar › AI Kalite › Metrics (AI-25)', () => {
  it('gives a Team Lead without the reports scope their figures from the breakdown, not the billed report', async () => {
    signIn('team_lead', ['chats--access:rw']);
    renderAt('/app/reports/ai-quality');

    await userEvent.click(screen.getByRole('tab', { name: 'Metrics' }));
    expect(screen.getByRole('tab', { name: 'Metrics' })).toHaveAttribute('aria-selected', 'true');
    const paths = api.get.mock.calls.map(([path]) => path as string);
    const read = paths.find((path) => path.startsWith('/reports/ai-agent/breakdown?'));
    expect(read).toBeDefined();
    const params = new URLSearchParams(read?.split('?')[1]);
    // The last 30 days, and no team named by the screen: the server's reach decides (RL-02).
    const days =
      (Date.parse(params.get('to') ?? '') - Date.parse(params.get('from') ?? '')) / 86_400_000;
    expect(days).toBe(30);
    expect(params.has('team_id')).toBe(false);
    expect(paths.some((path) => /^\/reports\/ai-agent(\?|$)/.test(path))).toBe(false);
  });

  it('opens the view from its address', () => {
    signIn('team_lead', ['chats--access:rw']);
    renderAt('/app/reports/ai-quality?view=metrics');
    expect(screen.getByRole('tab', { name: 'Metrics' })).toHaveAttribute('aria-selected', 'true');
  });

  it('does not offer the view to someone who reads it on the AI Agent tab', () => {
    signIn('admin', ['reports_read']);
    renderAt('/app/reports/ai-quality?view=metrics');
    expect(screen.queryByRole('tab', { name: 'Metrics' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Queue' })).toHaveAttribute('aria-selected', 'true');
  });
});
