/**
 * Raporlar › AI Kalite's door (tm 319.3 · AI-24): a Team Lead holds no
 * reports scope, so Reports sends them straight to the QA queue rather than a
 * page whose every read is refused; an administrator keeps Reports and finds
 * "AI quality" in its sidebar.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { ReportsPage } = await import('./ReportsPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

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
          <Route path="/app/reports" element={<ReportsPage />} />
          <Route path="/app/reports/ai-quality" element={<p>qa queue</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  // Every report read stays pending: this file is about where the page leads.
  api.get.mockReturnValue(new Promise(() => {}));
});

describe('Reports › AI quality door (AI-24)', () => {
  it('sends a Team Lead without the reports scope to the QA queue', async () => {
    signIn('team_lead', ['chats--access:rw']);
    renderAt('/app/reports');
    expect(await screen.findByText('qa queue')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('keeps Reports for an administrator, with AI quality in its sidebar', () => {
    signIn('admin', ['reports_read']);
    renderAt('/app/reports');
    expect(screen.getByRole('link', { name: 'AI quality' })).toHaveAttribute(
      'href',
      '/app/reports/ai-quality',
    );
  });

  it('draws no AI quality link for someone below Team Lead', () => {
    signIn('agent', ['reports_read']);
    renderAt('/app/reports');
    expect(screen.queryByRole('link', { name: 'AI quality' })).toBeNull();
  });
});
