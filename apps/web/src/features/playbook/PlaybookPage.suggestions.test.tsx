/**
 * The suggestion queue inside the Playbook page (tm 318.2 · AI-23): an
 * administrator has it as a tab with the open count on it; a Team Lead —
 * who holds no scope on the AI's configuration — is given the queue alone,
 * and the page asks the API for nothing else.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

function signIn(role: string, scopes: string[]): void {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role,
      organization_id: 'o-1',
      license_id: '1000003',
      scopes,
      routing_status: 'accepting_chats',
    },
  });
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PlaybookPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
});

describe('Playbook › Suggestions (AI-23)', () => {
  it('is a tab for an administrator, with the open count on it', async () => {
    window.history.replaceState(null, '', '/app/playbook?view=suggestions');
    signIn('admin', ['agents-bot--all:rw']);
    api.get.mockImplementation((path: string) => {
      if (path.startsWith('/ai/suggestions?')) {
        return Promise.resolve({ suggestions: [], total: 0, open_count: 4 });
      }
      if (path === '/skills' || path === '/ai-agents') return Promise.resolve({ items: [] });
      if (path.startsWith('/knowledge-sources')) return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderPage();

    const tab = await screen.findByRole('tab', { name: /Suggestions/ });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(screen.getByTestId('ai-suggestions-badge')).toHaveTextContent('4'));
    expect(tab).toHaveAccessibleName('Suggestions 4 open suggestions');
    expect(await screen.findByTestId('ai-suggestions')).toBeInTheDocument();
  });

  it('is the whole page for a Team Lead, who reads nothing of the AI’s configuration', async () => {
    window.history.replaceState(null, '', '/app/playbook?view=skills');
    signIn('team_lead', ['chats--access:rw']);
    api.get.mockImplementation((path: string) =>
      path.startsWith('/ai/suggestions?')
        ? Promise.resolve({ suggestions: [], total: 0, open_count: 0 })
        : Promise.reject(new Error(`unexpected ${path}`)),
    );
    renderPage();

    expect(await screen.findByTestId('ai-suggestions')).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).toBeNull();
    // Only the queue is read, and as a reviewer: not narrowed to their own.
    expect(api.get.mock.calls.map(([path]) => path)).toEqual([
      '/ai/suggestions?status=open&limit=50',
    ]);
  });
});
