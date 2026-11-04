/**
 * Playbook › Knowledge in a workspace without an AI agent (tm 400).
 *
 * A new sign-up has no agent, and the add-source form needs one to attach the
 * source to. The tab used to render nothing useful there; it now says why and,
 * for someone who may create one, leads to the "add an AI agent" card.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { AiAgent } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const AGENT: AiAgent = {
  id: 'ai-1',
  kind: 'ai_agent',
  name: 'Ada',
  tone: null,
  avatar_url: null,
  languages: ['en'],
  answer_length: null,
  batch_window_seconds: null,
  active: false,
  skills_count: 0,
};

let roster: AiAgent[];

function signIn(scopes: string[]): void {
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
      scopes,
      routing_status: 'accepting_chats',
    },
  });
}

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/app/playbook?view=knowledge']}>
      <QueryClientProvider client={queryClient}>
        <PlaybookPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  for (const fn of Object.values(api)) fn.mockReset();
  roster = [];
  signIn(['agents-bot--all:rw', 'access_rules:rw']);
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') return Promise.resolve({ items: roster });
    if (path.startsWith('/knowledge-sources')) return Promise.resolve({ items: [] });
    if (path === '/brands') return Promise.resolve({ items: [] });
    if (path.startsWith('/ai-guidance')) return Promise.resolve({ items: [] });
    if (path === '/settings/widget') {
      return Promise.resolve({ welcome_title: 'Hello', welcome_text: null, updated_at: null });
    }
    return Promise.resolve({ items: [] });
  });
});

describe('Playbook › Knowledge — no AI agent yet', () => {
  it('explains why it is empty and links to the add-an-AI-agent card', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Add an AI agent first')).toBeInTheDocument();
    expect(screen.queryByText('Nothing indexed')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add an AI agent' }));

    expect(await screen.findByRole('heading', { name: 'Add an AI agent' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'General settings', selected: true }),
    ).toBeInTheDocument();
  });

  it('gives a reader who cannot create one the explanation only, no button', async () => {
    signIn(['agents-bot--all:ro']);
    renderPage();

    expect(await screen.findByText('Add an AI agent first')).toBeInTheDocument();
    expect(screen.getByText(/Ask an admin to add the AI agent/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add an AI agent' })).not.toBeInTheDocument();
  });

  it('keeps the existing form and empty state once an agent exists', async () => {
    roster = [AGENT];
    renderPage();

    expect(await screen.findByText('Nothing indexed')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    expect(screen.queryByText('Add an AI agent first')).not.toBeInTheDocument();
  });
});
