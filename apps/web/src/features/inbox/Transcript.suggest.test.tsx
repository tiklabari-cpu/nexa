/**
 * "AI'ı düzelt" and "AI bilgisine öner" in the transcript (tm 318.2 · AI-23):
 * the AI's own message offers a correction with a reason chip and a note, an
 * agent's message offers its answer to the AI's knowledge, nothing else
 * offers either, and a surface that does not pass `canSuggest` shows neither.
 * The suggestion names the message, the connection and the day.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_BOT_ID } from '@siyahtus/types';
import { ApiClientError } from '../../lib/api-client.js';
import type * as AuthStore from '../../lib/auth-store.js';
import type { ChatEvent } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { Transcript } = await import('./Transcript.js');

const NOW = new Date().toISOString();

function event(overrides: Partial<ChatEvent>): ChatEvent {
  return {
    id: 'TJ1H8CFKRV_1',
    chat_id: 'TJ1H8CFKRV',
    thread_id: 'TJ1H8CFKRV-2',
    type: 'message',
    text: 'Papara 7/24 çalışır.',
    author_id: AI_BOT_ID,
    author_type: 'bot',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: NOW,
    ...overrides,
  };
}

const AI_MESSAGE = event({});
const AGENT_MESSAGE = event({
  id: 'TJ1H8CFKRV_2',
  text: 'Geceleri bakım var.',
  author_id: 'agent-1',
  author_type: 'agent',
});
const PLAYER_MESSAGE = event({
  id: 'TJ1H8CFKRV_3',
  text: 'Merhaba',
  author_id: 'cust-1',
  author_type: 'customer',
});
const RULE_BOT_MESSAGE = event({ id: 'TJ1H8CFKRV_4', text: 'Kural botu', author_id: 'rule-bot' });
const NOTE = event({
  id: 'TJ1H8CFKRV_5',
  text: 'iç not',
  author_id: 'agent-1',
  author_type: 'agent',
  recipients: 'agents',
});

function mount(events: ChatEvent[], canSuggest = true) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <Transcript
        chatId="TJ1H8CFKRV"
        events={events}
        loading={false}
        currentAgentId="agent-1"
        {...(canSuggest ? { canSuggest: true } : {})}
      />
    </QueryClientProvider>,
  );
}

const menus = () => screen.queryAllByRole('button', { name: 'Message actions' });

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('Transcript — suggesting about a message (AI-23)', () => {
  it('offers the menu on the AI’s and on an agent’s message, and on nothing else', () => {
    mount([AI_MESSAGE, AGENT_MESSAGE, PLAYER_MESSAGE, RULE_BOT_MESSAGE, NOTE]);
    expect(menus()).toHaveLength(2);
  });

  it('offers nothing on a surface that does not pass canSuggest', () => {
    mount([AI_MESSAGE, AGENT_MESSAGE], false);
    expect(menus()).toHaveLength(0);
  });

  it('sends the AI’s message as a wrong answer with the chosen reason and the note', async () => {
    api.post.mockResolvedValue({ id: 's-1' });
    mount([AI_MESSAGE]);

    await userEvent.click(menus()[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Correct the AI' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Papara 7/24 çalışır.')).toBeInTheDocument();
    // The first reason is selected; the others are one click away.
    expect(within(dialog).getByRole('radio', { name: 'Wrong answer' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Should have handed over' }));
    await userEvent.type(within(dialog).getByLabelText(/Note/), '  Artık 7/24 değil ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send correction' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/ai/suggestions', {
        chat_id: 'TJ1H8CFKRV',
        thread_id: 'TJ1H8CFKRV-2',
        event_id: 'TJ1H8CFKRV_1',
        kind: 'should_have_handed_off',
        note: 'Artık 7/24 değil',
      }),
    );
    expect(await within(dialog).findByText(/correction is in the reviewers/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('offers an agent’s answer to the AI’s knowledge without a reason to pick', async () => {
    api.post.mockResolvedValue({ id: 's-2' });
    mount([AGENT_MESSAGE]);

    await userEvent.click(menus()[0]!);
    await userEvent.click(screen.getByRole('button', { name: "Offer to the AI's knowledge" }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('radio')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Offer' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/ai/suggestions', {
        chat_id: 'TJ1H8CFKRV',
        thread_id: 'TJ1H8CFKRV-2',
        event_id: 'TJ1H8CFKRV_2',
        kind: 'promote_agent_answer',
      }),
    );
  });

  it('says why the second mark on the same message was refused', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'ai_suggestion_state',
        status: 409,
        message: 'You already made this suggestion about this message.',
        requestId: 'req-1',
        details: { reason: 'duplicate' },
      }),
    );
    mount([AI_MESSAGE]);

    await userEvent.click(menus()[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Correct the AI' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send correction' }));

    expect(await within(dialog).findByRole('alert')).toBeInTheDocument();
    // Still open: the agent can cancel, nothing was recorded.
    expect(within(dialog).getByRole('button', { name: 'Send correction' })).toBeEnabled();
  });
});
