/**
 * The transcript header's AI badge and its actions (AI-11 · tm 293.5): the
 * badge says who answers, follows the `chat_ai_mode_changed` push without a
 * reload, and the actions call the routes that move the mode — refusals worded
 * in the dialog, in the console's language.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../lib/api-client.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { AiModeControls } from './AiModeControls.js';
import { applyPush, useChat } from './useInbox.js';
import type { ChatDetail } from './types.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  authState: { agent: null as { account_id: string; role: string } | null },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: Object.assign((selector: (state: typeof authState) => unknown) => selector(authState), {
    getState: () => authState,
  }),
}));

type ThreadOverrides = Partial<NonNullable<ChatDetail['thread']>>;

function chat(overrides: ThreadOverrides = {}): ChatDetail {
  return {
    id: 'TJ1H8CFKRV',
    license_id: '1000003',
    customer_id: 'cust-1',
    active: true,
    created_at: '2026-10-17T10:00:00.000Z',
    access: { group_ids: [] },
    users: [],
    thread: {
      id: 'TH1',
      chat_id: 'TJ1H8CFKRV',
      active: true,
      assignee_id: 'agent-1',
      queue_position: null,
      summary: null,
      created_at: '2026-10-17T10:00:00.000Z',
      closed_at: null,
      ai_mode: 'ai',
      ai_took_part: true,
      tags: [],
      ...overrides,
    },
  };
}

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderControls(detail: ChatDetail, queryClient = client()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <AiModeControls chat={detail} chatId={detail.id} compact={false} />
    </QueryClientProvider>,
  );
}

const refusal = (type: ApiClientError['type'], status: number) =>
  new ApiClientError({ type, status, message: 'refused', requestId: 'req-1' });

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockResolvedValue({ items: [] });
  api.post.mockResolvedValue({});
  authState.agent = { account_id: 'agent-1', role: 'agent' };
});

afterEach(() => resetLocale());

describe('AiModeControls — the badge (AI-11)', () => {
  it.each([
    ['ai', 'AI answering'],
    ['paused', 'AI paused'],
    ['human', 'With a person'],
  ] as const)('names who answers a %s connection', (mode, word) => {
    renderControls(chat({ ai_mode: mode }));
    expect(screen.getByText(word)).toBeInTheDocument();
  });

  it('shows nothing where a person answered from the start', () => {
    const { container } = renderControls(chat({ ai_mode: 'human', ai_took_part: false }));
    expect(container).toBeEmptyDOMElement();
  });

  it('words the badge in Turkish', () => {
    renderWithLocale(
      <QueryClientProvider client={client()}>
        <AiModeControls chat={chat({ ai_mode: 'ai' })} chatId="TJ1H8CFKRV" compact={false} />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByText('AI görüşüyor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "AI'ı duraklat" })).toBeInTheDocument();
  });

  it('moves the moment the push lands, without a reload (AI-11 · RTM)', async () => {
    // The server the re-read after the push asks: already `human`.
    let server = chat({ ai_mode: 'ai' });
    api.get.mockImplementation((path: string) =>
      path === '/chats/TJ1H8CFKRV' ? Promise.resolve(server) : Promise.resolve({ items: [] }),
    );
    const queryClient = client();
    function Live(): ReactElement | null {
      const query = useChat('TJ1H8CFKRV');
      return query.data ? (
        <AiModeControls chat={query.data} chatId="TJ1H8CFKRV" compact={false} />
      ) : null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <Live />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('AI answering')).toBeInTheDocument();

    server = chat({ ai_mode: 'human' });
    act(() => {
      applyPush(queryClient, 'chat_ai_mode_changed', {
        chat_id: 'TJ1H8CFKRV',
        thread_id: 'TH1',
        ai_mode: 'human',
        previous_ai_mode: 'ai',
        by: 'agent-2',
        reason: 'agent_message',
      });
    });

    expect(await screen.findByText('With a person')).toBeInTheDocument();
    expect(screen.queryByText('AI answering')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Return to AI' })).toBeInTheDocument();
  });
});

describe('AiModeControls — the actions (AI-11)', () => {
  it('holds the AI back with the note given (POST pause-ai)', async () => {
    renderControls(chat({ ai_mode: 'ai' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause AI' }));
    const dialog = await screen.findByRole('dialog', { name: 'Pause the AI on this chat?' });
    fireEvent.change(within(dialog).getByLabelText('Note for the team (optional)'), {
      target: { value: 'Checking the refund first' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pause AI' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/chats/TJ1H8CFKRV/pause-ai', {
        note: 'Checking the refund first',
      }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('gives the chat back with the resume chosen and no empty note (POST return-to-ai)', async () => {
    renderControls(chat({ ai_mode: 'human' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to AI' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return this chat to the AI?' });
    fireEvent.change(within(dialog).getByLabelText('How the AI goes on'), {
      target: { value: 'fresh' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Return to AI' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/chats/TJ1H8CFKRV/return-to-ai', { resume: 'fresh' }),
    );
  });

  it('says why a risk-flagged chat cannot go back, and keeps the dialog open', async () => {
    api.post.mockRejectedValue(refusal('ai_return_blocked', 409));
    renderControls(chat({ ai_mode: 'paused' }));
    fireEvent.click(screen.getByRole('button', { name: 'Return to AI' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return this chat to the AI?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Return to AI' }));

    expect(
      await within(dialog).findByText(/flagged and has to stay with a person/),
    ).toBeInTheDocument();
    // The type's sentence, not the server's English.
    expect(within(dialog).queryByText('refused')).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('offers a teammate nothing on a colleague’s chat, and an admin the same as its assignee', () => {
    authState.agent = { account_id: 'agent-2', role: 'agent' };
    const { unmount } = renderControls(chat({ ai_mode: 'ai' }));
    expect(screen.getByText('AI answering')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    unmount();

    authState.agent = { account_id: 'admin-1', role: 'admin' };
    renderControls(chat({ ai_mode: 'ai' }));
    expect(screen.getByRole('button', { name: 'Pause AI' })).toBeInTheDocument();
    // Taken off the AI with the Details panel's own takeover, not a second one here.
    expect(screen.queryByRole('button', { name: 'Take over' })).not.toBeInTheDocument();
  });
});
