/**
 * "Talk like a player" (tm 314.5 · AI-19 §8): every reply shows its decision
 * trace — the procedure and why, what it collected, the source and its page,
 * the guardrails, the hand-over, the flags — and the conversation is saved as
 * a scenario under the name given. A session left open is picked up again in
 * the same browser session; one that has expired is forgotten.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AiTestTurnTrace } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import type { SandboxSession } from './ai-testing.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { SandboxChat, sandboxStorageKey } = await import('./SandboxChat.js');

const AGENT_ID = '22222222-2222-4222-8222-222222222222';

const SESSION: SandboxSession = {
  id: '33333333-3333-4333-8333-333333333333',
  ai_agent_id: AGENT_ID,
  target: 'draft',
  config_version_id: null,
  transcript: [],
  tokens: 0,
  created_at: '2026-10-21T10:00:00.000Z',
  expires_at: '2026-10-22T10:00:00.000Z',
};

const TRACE: AiTestTurnTrace = {
  decision: 'asked',
  procedure: {
    skill_id: '44444444-4444-4444-8444-444444444444',
    name: 'Yatırım geçmedi',
    reason: 'deposit not credited',
  },
  slots: { yontem: 'Papara' },
  sources: [{ source_id: 'ks-1', title: 'Yatırım rehberi', page: 3 }],
  guardrails: [{ rule_key: 'G7', action: 'rewrite' }],
  handoff: null,
  flags: ['rg_signal'],
  tokens: 128,
};

function renderChat(canEdit = true) {
  const onSavedScenario = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SandboxChat
        agentId={AGENT_ID}
        canEdit={canEdit}
        onClose={() => {}}
        onSavedScenario={onSavedScenario}
      />
    </QueryClientProvider>,
  );
  return { onSavedScenario };
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
  window.sessionStorage.clear();
  api.post.mockImplementation((path: string, body: Record<string, unknown>) => {
    if (path === '/ai/sandbox-sessions') return Promise.resolve(SESSION);
    if (path.endsWith('/turns')) {
      return Promise.resolve({
        reply: 'Hangi yöntemle yatırdınız?',
        trace: TRACE,
        session: {
          ...SESSION,
          tokens: 128,
          transcript: [
            { role: 'player', text: body['message'], at: '2026-10-21T10:00:05.000Z' },
            {
              role: 'ai',
              text: 'Hangi yöntemle yatırdınız?',
              at: '2026-10-21T10:00:05.000Z',
              trace: TRACE,
            },
          ],
        },
      });
    }
    if (path.endsWith('/save-as-scenario')) {
      return Promise.resolve({ id: 'sc-1', name: body['name'] });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

afterEach(() => {
  window.sessionStorage.clear();
});

describe('SandboxChat', () => {
  it('shows the procedure, its reason and the source page beside the reply', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.click(screen.getByRole('button', { name: 'Start a conversation' }));
    expect(api.post).toHaveBeenCalledWith('/ai/sandbox-sessions', {
      ai_agent_id: AGENT_ID,
      target: 'draft',
    });
    expect(window.sessionStorage.getItem(sandboxStorageKey(AGENT_ID))).toBe(SESSION.id);

    await user.type(
      await screen.findByLabelText('Your message as the player'),
      'Yatırımım geçmedi',
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.post).toHaveBeenCalledWith(`/ai/sandbox-sessions/${SESSION.id}/turns`, {
      message: 'Yatırımım geçmedi',
    });

    const panel = await screen.findByTestId('decision-trace');
    expect(within(panel).getByText('Asked for information')).toBeInTheDocument();
    expect(within(panel).getByText('Yatırım geçmedi — deposit not credited')).toBeInTheDocument();
    expect(within(panel).getByText('yontem: Papara')).toBeInTheDocument();
    expect(within(panel).getByText('Yatırım rehberi (page 3)')).toBeInTheDocument();
    expect(within(panel).getByText('G7 (rewrite)')).toBeInTheDocument();
    expect(within(panel).getByText('Responsible gaming signal')).toBeInTheDocument();
    expect(within(panel).getByText('128')).toBeInTheDocument();
    // The box is emptied for the next line.
    expect(screen.getByLabelText('Your message as the player')).toHaveValue('');
  });

  it('saves the conversation as a scenario under the name given', async () => {
    const user = userEvent.setup();
    const { onSavedScenario } = renderChat();

    await user.click(screen.getByRole('button', { name: 'Start a conversation' }));
    await user.type(await screen.findByLabelText('Your message as the player'), 'Merhaba{Enter}');
    await user.type(await screen.findByLabelText('Scenario name'), 'Papara sorusu');
    await user.click(screen.getByRole('button', { name: 'Save as scenario' }));

    expect(api.post).toHaveBeenCalledWith(`/ai/sandbox-sessions/${SESSION.id}/save-as-scenario`, {
      name: 'Papara sorusu',
    });
    expect(
      await screen.findByText('“Papara sorusu” was saved to the scenarios.'),
    ).toBeInTheDocument();
    expect(onSavedScenario).toHaveBeenCalledTimes(1);
  });

  it('picks up the session left open in this browser session', async () => {
    window.sessionStorage.setItem(sandboxStorageKey(AGENT_ID), SESSION.id);
    api.get.mockResolvedValue({
      ...SESSION,
      transcript: [{ role: 'player', text: 'Önceki mesajım', at: SESSION.created_at }],
    });
    renderChat();

    expect(await screen.findByText('Önceki mesajım')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/ai/sandbox-sessions/${SESSION.id}`);
    expect(screen.getByRole('button', { name: 'Start over' })).toBeInTheDocument();
  });

  it('forgets a session that has expired', async () => {
    window.sessionStorage.setItem(sandboxStorageKey(AGENT_ID), SESSION.id);
    api.get.mockRejectedValue(
      new ApiClientError({ type: 'not_found', status: 404, message: 'gone', requestId: 'r' }),
    );
    renderChat();

    await waitFor(() =>
      expect(window.sessionStorage.getItem(sandboxStorageKey(AGENT_ID))).toBeNull(),
    );
    expect(screen.getByRole('button', { name: 'Start a conversation' })).toBeInTheDocument();
  });

  it('keeps nothing and says why when the turn is refused', async () => {
    const user = userEvent.setup();
    renderChat();
    await user.click(screen.getByRole('button', { name: 'Start a conversation' }));
    api.post.mockRejectedValueOnce(
      new ApiClientError({
        type: 'service_unavailable',
        status: 503,
        message: 'x',
        requestId: 'r',
      }),
    );

    await user.type(await screen.findByLabelText('Your message as the player'), 'Merhaba');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Your message as the player')).toHaveValue('Merhaba');
    expect(screen.queryByTestId('decision-trace')).not.toBeInTheDocument();
  });
});
