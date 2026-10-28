/**
 * The AI Agent page and its guardrails (tm 301.4 · AI-08): the "Guardrails" tab
 * is on the page, and a switch-on the API refuses for want of an approved crisis
 * text says so and points at the tab instead of failing silently.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import type { AiAgent } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { PlaybookPage } = await import('./PlaybookPage.js');
const { useAuth } = await import('../../lib/auth-store.js');

const AGENT: AiAgent = {
  id: 'agent-1',
  name: 'Ada',
  kind: 'ai_agent',
  tone: null,
  avatar_url: null,
  languages: ['tr'],
  answer_length: null,
  batch_window_seconds: null,
  active: false,
  skills_count: 1,
};

// Ready to switch on (a knowledge source with chunks, an active skill with steps), so the
// agent's own switch is enabled and the API's refusal is what stops it.
const SOURCE = {
  id: 'ks-1',
  ai_agent_id: 'agent-1',
  name: 'Help centre',
  type: 'website',
  status: 'ready',
  source_url: null,
  chunk_count: 3,
  updated_at: '2026-10-19T10:00:00Z',
  added_by_name: null,
  refresh_after_days: null,
  next_refresh_at: null,
};

const SKILL = {
  id: 'skill-1',
  ai_agent_id: 'agent-1',
  name: 'Order status',
  kind: 'ai_agent',
  instruction: null,
  steps: [{ type: 'send_message', text: 'Hello' }],
  active: true,
  runs_count: 0,
  updated_at: '2026-10-19T10:00:00Z',
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
  for (const fn of Object.values(api)) fn.mockReset();
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
    if (path === '/skills') return Promise.resolve({ items: [SKILL] });
    if (path === '/ai-agents') return Promise.resolve({ items: [AGENT] });
    if (path === '/knowledge-sources') return Promise.resolve({ items: [SOURCE] });
    if (path === '/ai-guardrails/platform') return Promise.resolve({ version: 'v1', rules: [] });
    if (path.startsWith('/ai-guardrails/settings')) {
      return Promise.resolve({
        ai_agent_id: 'agent-1',
        crisis_text: null,
        complaint_text: null,
        judge_enabled: false,
        crisis_text_approved: false,
        approved_by: null,
        approved_at: null,
        crisis_text_draft: null,
        setup_problem: 'crisis_text_missing',
        updated_at: null,
      });
    }
    if (path.startsWith('/ai-guardrails/')) return Promise.resolve({ items: [] });
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

describe('Playbook guardrails tab (AI-08)', () => {
  it('opens the guardrails on their own tab', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('tab', { name: 'Guardrails' }));

    expect(
      await screen.findByRole('heading', { name: 'Crisis and complaint texts' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Platform rules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your rules' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Forbidden phrases' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What the guardrails caught' })).toBeInTheDocument();
  });

  it('answers a switch-on the API refuses for want of a crisis text, and takes the owner to the tab', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'ai_guardrail_setup_incomplete',
        status: 409,
        message: 'raw english from the server',
        requestId: 'r-1',
        details: { reason: 'crisis_text_missing' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Resume' }));
    // Through the review line's own switch (AI-20 · tm 316.4), not a PATCH of the agent.
    expect(api.post).toHaveBeenCalledWith('/ai/resume', { ai_agent_id: 'agent-1' });

    expect(
      await screen.findByText(
        'The AI agent cannot go live until its crisis text is written and approved by the owner.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/raw english/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Open Guardrails' }));
    expect(
      await screen.findByRole('heading', { name: 'Crisis and complaint texts' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Guardrails' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('shows no jump button for any other refusal', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({ type: 'not_allowed', status: 403, message: 'raw', requestId: 'r-1' }),
    );
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Open Guardrails' })).toBeNull();
  });
});
