/**
 * "New skill" opens a blank editor; nothing is stored until the first Save (O12, tm 259.23).
 *
 * Until now the button posted `POST /skills` on the spot and the editor opened
 * on the row it had just minted — so every click left an unnamed draft behind,
 * whether or not anyone typed a word. Driven through the real page: the click
 * sends nothing, Cancel sends nothing, and the first Save sends exactly one POST.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import type { Skill } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const EXISTING: Skill = {
  id: 'skill-1',
  ai_agent_id: 'ai-1',
  name: 'Order status',
  kind: 'ai_agent',
  instruction: null,
  steps: [],
  active: false,
  runs_count: 0,
  updated_at: '2026-01-01T00:00:00.000Z',
  created_by_name: null,
  created_by_id: null,
};

function renderPage(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PlaybookPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
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
      scopes: ['agents-bot--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [EXISTING] });
    if (path === '/ai-agents') {
      return Promise.resolve({
        items: [{ id: 'ai-1', kind: 'ai_agent', name: 'Ada', active: true, skills_count: 1 }],
      });
    }
    if (path === '/knowledge-sources') return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Playbook — New skill (O12)', () => {
  it('opens an empty editor and sends nothing', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Order status');

    await user.click(screen.getByRole('button', { name: /^New skill$/ }));

    expect(await screen.findByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Instruction')).toHaveValue('');
    expect(api.post).not.toHaveBeenCalled();
    // Nothing to save yet, and nothing to run, switch or delete — it is not a skill yet.
    expect(screen.getByRole('button', { name: 'Create skill' })).toBeDisabled();
    const editor = screen.getByRole('region', { name: 'New skill' });
    expect(within(editor).queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: /runs?$/ })).not.toBeInTheDocument();
    expect(within(editor).queryByRole('button', { name: 'Enable' })).not.toBeInTheDocument();
  });

  it('posts exactly once, on the first Create, and then opens the stored skill', async () => {
    const user = userEvent.setup();
    const created: Skill = { ...EXISTING, id: 'skill-2', name: 'Refunds' };
    api.post.mockResolvedValue(created);
    // The server has it by the time the list is refetched.
    const listed: Skill[] = [EXISTING];
    api.get.mockImplementation((path: string) => {
      if (path === '/skills') return Promise.resolve({ items: listed });
      if (path === '/ai-agents') {
        return Promise.resolve({
          items: [{ id: 'ai-1', kind: 'ai_agent', name: 'Ada', active: true, skills_count: 1 }],
        });
      }
      if (path === '/knowledge-sources') return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    api.post.mockImplementation(() => {
      listed.unshift(created);
      return Promise.resolve(created);
    });
    renderPage();
    await screen.findByText('Order status');

    await user.click(screen.getByRole('button', { name: /^New skill$/ }));
    await user.type(await screen.findByLabelText('Name'), 'Refunds');
    await user.type(screen.getByLabelText('Instruction'), 'Explain refunds.');
    await user.click(screen.getByRole('button', { name: 'Create skill' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/skills', {
      name: 'Refunds',
      instruction: 'Explain refunds.',
      steps: [],
      ai_agent_id: 'ai-1',
    });
    // Now it is a stored skill: the editor is the saved-skill one, with a Delete.
    expect(await screen.findByRole('button', { name: /^Delete/ })).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('Cancel on an untouched draft leaves no request and no row', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Order status');

    await user.click(screen.getByRole('button', { name: /^New skill$/ }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
    expect(screen.getByText('No skill selected')).toBeInTheDocument();
  });

  it('clicking New skill twice does not stack drafts', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Order status');

    await user.click(screen.getByRole('button', { name: /^New skill$/ }));
    await user.click(screen.getByRole('button', { name: /^New skill$/ }));

    expect(screen.getAllByLabelText('Name')).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
  });

  it('opening a stored skill from the list replaces the draft', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Order status');

    await user.click(screen.getByRole('button', { name: /^New skill$/ }));
    await screen.findByRole('button', { name: 'Create skill' });
    await user.click(screen.getByRole('button', { name: /Order status/ }));

    expect(await screen.findByLabelText('Name')).toHaveValue('Order status');
    expect(screen.queryByRole('button', { name: 'Create skill' })).not.toBeInTheDocument();
  });
});
