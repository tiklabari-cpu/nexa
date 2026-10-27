/**
 * The Playbook's iGaming templates, wired to the page (tm 311.4 · AI-15): the
 * workspace's sector decides whether the gallery leads with iGaming, the
 * onboarding's `?gallery=igaming` link opens it there, and an installed draft
 * opens in the editor and joins the skills list.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { resetLocale } from '../../test/i18n.js';
import type { AiAgent, Skill } from './types.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const AGENT = {
  id: 'agent-1',
  name: 'Sia',
  kind: 'ai_agent',
  tone: null,
  avatar_url: null,
  languages: ['tr'],
  answer_length: null,
  batch_window_seconds: null,
  active: true,
} as unknown as AiAgent;

const DRAFT: Skill = {
  id: 'skill-9',
  ai_agent_id: 'agent-1',
  name: 'Yatırım hesaba geçmedi',
  kind: 'ai_agent',
  instruction: null,
  steps: [],
  active: false,
  runs_count: 0,
  updated_at: '2026-10-21T00:00:00.000Z',
  created_by_name: null,
  created_by_id: null,
};

function mockApi(sector: string | null): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/skills') return Promise.resolve({ items: [] });
    if (path === '/ai-agents') return Promise.resolve({ items: [AGENT] });
    if (path === '/settings/company') return Promise.resolve({ sector });
    if (path.startsWith('/knowledge-sources')) return Promise.resolve({ items: [] });
    if (path.startsWith('/ai-templates')) {
      return Promise.resolve({
        items: [
          {
            key: 'deposit_not_credited',
            name: 'Yatırım hesaba geçmedi',
            summary: 'Özet',
            version: 1,
            locked: false,
            topics: [],
            tenant_must_fill_count: 0,
            installed_version: null,
          },
        ],
        packs: [],
      });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
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
  resetLocale();
  api.get.mockReset();
  api.post.mockReset();
  window.history.replaceState(null, '', '/app/playbook?view=skills');
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
});

afterEach(() => {
  window.history.replaceState(null, '', '/');
  resetLocale();
});

describe('Playbook gallery — iGaming first for a gaming/gambling workspace (AI-15)', () => {
  it('leads with iGaming once the sector is known to be gaming_gambling', async () => {
    mockApi('gaming_gambling');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Browse templates' }));
    const dialog = await screen.findByRole('dialog');

    await waitFor(() => {
      expect(within(dialog).getAllByRole('tab')[0]).toHaveTextContent('iGaming');
    });
    expect(within(dialog).getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    expect(await within(dialog).findByText('Yatırım hesaba geçmedi')).toBeInTheDocument();
  });

  it('keeps the usual order, on "All", for any other sector', async () => {
    mockApi('ecommerce_retail');
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Browse templates' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/settings/company'));

    const tabs = within(dialog).getAllByRole('tab');
    expect(tabs[0]).toHaveTextContent('All');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('/ai-templates'));
  });

  it('does not take a tab back from an admin who already picked one', async () => {
    // The sector answers late: the admin has gone to "All" by then.
    let release: (value: { sector: string }) => void = () => {};
    mockApi('gaming_gambling');
    const base = api.get.getMockImplementation()!;
    api.get.mockImplementation((path: string) =>
      path === '/settings/company'
        ? new Promise((resolve) => {
            release = resolve;
          })
        : base(path),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Browse templates' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('tab', { name: /All/ }));
    release({ sector: 'gaming_gambling' });

    await waitFor(() => expect(within(dialog).getAllByRole('tab')[0]).toHaveTextContent('iGaming'));
    expect(within(dialog).getByRole('tab', { name: /All/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('opens on iGaming from the onboarding link, whatever the sector says', async () => {
    window.history.replaceState(null, '', '/app/playbook?gallery=igaming');
    mockApi(null);
    renderPage();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('tab', { name: 'iGaming' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await within(dialog).findByText('Yatırım hesaba geçmedi')).toBeInTheDocument();
  });

  it('opens an installed draft in the editor and closes the gallery', async () => {
    window.history.replaceState(null, '', '/app/playbook?gallery=igaming');
    mockApi('gaming_gambling');
    api.post.mockResolvedValue({
      created: true,
      skill: DRAFT,
      tenant_must_fill: [],
      unfilled_placeholders: [],
      unmapped_topics: [],
    });
    const user = userEvent.setup();
    renderPage();

    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('button', { name: /Install the Yatırım/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Install as a draft' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Open the draft' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.post).toHaveBeenCalledWith('/ai-templates/deposit_not_credited/install', {
      ai_agent_id: 'agent-1',
    });
  });
});
