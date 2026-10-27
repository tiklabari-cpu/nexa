/**
 * Playbook › AI Agent layout (tm 390.2): the "add an AI agent" empty state, the
 * General / Behaviour tabs, and the `?view=` addresses Settings and the command
 * palette link to.
 *
 * Driven through the real page with a fake API: a workspace without an agent
 * lands on the card, creating one posts exactly `{name, tone}` and moves to the
 * persona form, a second creator who loses the race sees the roster reload, and
 * the old `?view=profile` links still open the persona.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
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
  tone: 'Friendly',
  avatar_url: null,
  languages: ['en'],
  answer_length: null,
  batch_window_seconds: null,
  active: false,
  skills_count: 0,
};

let roster: AiAgent[];
let brands: unknown[];

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

function renderPage(entry = '/app/playbook'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={[entry]}>
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
  brands = [];
  signIn(['agents-bot--all:rw', 'access_rules:rw']);
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') return Promise.resolve({ items: roster });
    if (path === '/knowledge-sources') return Promise.resolve({ items: [] });
    if (path === '/settings/widget') {
      return Promise.resolve({ welcome_title: 'Hello', welcome_text: null, updated_at: null });
    }
    if (path === '/brands') return Promise.resolve({ items: brands });
    if (path.startsWith('/ai-guidance')) return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

describe('Playbook › AI Agent — add an AI agent', () => {
  it('shows the card instead of a persona form when the workspace has no agent', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Add an AI agent' })).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'General settings', selected: true }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Avatar URL')).not.toBeInTheDocument();
  });

  it('creates the agent with its name and tone, then shows its General settings', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation(() => {
      roster = [AGENT];
      return Promise.resolve(AGENT);
    });
    renderPage();

    await user.type(await screen.findByLabelText('Name'), '  Ada ');
    await user.type(screen.getByLabelText('Tone'), 'Friendly');
    await user.click(screen.getByRole('button', { name: 'Add AI agent' }));

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/ai-agents', { name: 'Ada', tone: 'Friendly' });
    // The persona form is open on the new agent, which is created switched off.
    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add an AI agent' })).not.toBeInTheDocument();
    // Nothing to answer from yet: the set-up steps say what is left.
    expect(screen.getByRole('heading', { name: 'Set-up steps' })).toBeInTheDocument();
  });

  it('sends no tone when none was typed, and asks for a name first', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(AGENT);
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Add AI agent' }));
    expect(await screen.findByText('Give the AI agent a name.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.click(screen.getByRole('button', { name: 'Add AI agent' }));
    expect(api.post).toHaveBeenCalledWith('/ai-agents', { name: 'Ada' });
  });

  it('reloads the roster when somebody else created the agent first (409)', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation(() => {
      roster = [AGENT];
      return Promise.reject(
        new ApiClientError({
          type: 'ai_agent_exists',
          status: 409,
          message: 'This workspace already has an AI agent.',
          requestId: 'req-1',
        }),
      );
    });
    renderPage();

    await user.type(await screen.findByLabelText('Name'), 'Eve');
    await user.click(screen.getByRole('button', { name: 'Add AI agent' }));

    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument();
  });

  it('tells a reader who cannot create one to ask an admin, with no form', async () => {
    signIn(['agents-bot--all:ro']);
    renderPage();

    expect(await screen.findByText('No AI agent yet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add AI agent' })).not.toBeInTheDocument();
  });
});

describe('Playbook › AI Agent — tabs and addresses', () => {
  beforeEach(() => {
    roster = [AGENT];
  });

  it('opens on General settings with the persona form', async () => {
    renderPage();

    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'General settings', selected: true }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Profile' })).not.toBeInTheDocument();
  });

  it('maps the old ?view=profile address to General settings', async () => {
    renderPage('/app/playbook?view=profile');

    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument();
    expect(
      screen.getByRole('tab', { name: 'General settings', selected: true }),
    ).toBeInTheDocument();
  });

  it('opens the tab ?view= names', async () => {
    renderPage('/app/playbook?view=behaviour');
    expect(await screen.findByRole('heading', { name: 'Behaviour rules' })).toBeInTheDocument();
  });

  it('lands on General for an address naming no tab', async () => {
    renderPage('/app/playbook?view=nonsense');
    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument();
  });

  it('keeps the behaviour cards off the General tab', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByDisplayValue('Ada');
    expect(screen.queryByRole('heading', { name: 'Behaviour rules' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Behaviour' }));
    expect(await screen.findByRole('heading', { name: 'Behaviour rules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hand-over' })).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Ada')).not.toBeInTheDocument();
  });

  it('follows a link opened while the page is already showing another tab', async () => {
    const user = userEvent.setup();
    renderPage('/app/playbook?view=skills');
    await screen.findByRole('tab', { name: 'Skills', selected: true });

    await user.click(screen.getByRole('tab', { name: 'General settings' }));
    expect(await screen.findByDisplayValue('Ada')).toBeInTheDocument();
  });
});

describe('Playbook › AI Agent — welcome message', () => {
  beforeEach(() => {
    roster = [AGENT];
  });

  it('edits the default brand’s welcome message through PUT /settings/widget', async () => {
    const user = userEvent.setup();
    api.put.mockResolvedValue({ welcome_title: 'Hi there', welcome_text: null, updated_at: null });
    renderPage();

    const title = await screen.findByLabelText('Title');
    expect(title).toHaveValue('Hello');
    await user.clear(title);
    await user.type(title, 'Hi there');
    await user.click(screen.getByRole('button', { name: 'Save welcome message' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/settings/widget', {
        welcome_title: 'Hi there',
        welcome_text: '',
      }),
    );
  });

  it('points at the widget settings when the workspace has several brands', async () => {
    brands = [{ id: 'b1' }, { id: 'b2' }];
    renderPage();

    const link = await screen.findByRole('link', { name: 'Go to widget settings' });
    expect(link).toHaveAttribute('href', '/app/settings/widget');
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('leaves the card out when the widget settings cannot be read', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/ai-agents') return Promise.resolve({ items: roster });
      if (path === '/skills') return Promise.resolve({ items: [] });
      if (path === '/knowledge-sources') return Promise.resolve({ items: [] });
      if (path === '/brands') return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderPage();

    await screen.findByDisplayValue('Ada');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/settings/widget'));
    expect(screen.queryByRole('heading', { name: 'Welcome message' })).not.toBeInTheDocument();
  });
});
