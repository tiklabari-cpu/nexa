/**
 * The Copilot drawer (IN-09) against a stubbed API.
 *
 * What is held: the key opens and closes it from any page, an answer from the
 * knowledge store names its sources and when each was reviewed, a report
 * question a role may not ask is refused in the console's words, the
 * conversation survives a change of page and is gone with a fresh store, and
 * beside an open chat the answer can be handed to the reply composer — and only
 * then.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));

vi.mock('../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { CopilotDrawer } = await import('./CopilotDrawer.js');
const { ShortcutsHost } = await import('./ShortcutsModal.js');
const { useCopilotDrawerStore, resetCopilotDrawer, MAX_ENTRIES } =
  await import('../features/copilot/copilotDrawerStore.js');
const { useCopilotDraftStore } = await import('../features/inbox/copilotDraft.js');
const { useShortcut } = await import('../lib/shortcuts.js');
const { ApiClientError } = await import('../lib/api-client.js');

/** The two bits of the shell the drawer lives in: the key, and the drawer. */
function Shell(): React.ReactElement {
  const toggle = useCopilotDrawerStore((s) => s.toggle);
  useShortcut('copilot.toggle-drawer', toggle);
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate('/app/settings')}>
        go to settings
      </button>
      <Routes>
        <Route path="/app/reports" element={<h1>Reports page</h1>} />
        <Route path="/app/settings" element={<h1>Settings page</h1>} />
      </Routes>
      <CopilotDrawer />
    </>
  );
}

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={['/app/reports']}>
      <QueryClientProvider client={queryClient}>
        <ShortcutsHost />
        <Shell />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const CHORD = { key: 'C', code: 'KeyC', altKey: true, shiftKey: true };
const drawer = () => screen.queryByRole('complementary', { name: 'Ask Copilot' });

async function openDrawer() {
  fireEvent.keyDown(document.body, CHORD);
  return await screen.findByRole('complementary', { name: 'Ask Copilot' });
}

const PAPARA = {
  answer: 'Papara ile günlük çekim limiti 50.000 TL.',
  kind: 'kb',
  sources: [
    {
      id: '8d1c9f0a-0000-4000-8000-000000000001',
      title: 'Papara limitleri',
      reviewed_at: '2026-10-01T09:00:00.000Z',
    },
  ],
};

beforeEach(() => {
  resetCopilotDrawer();
  useCopilotDraftStore.setState({ byChat: {} });
  api.post.mockReset();
  api.get.mockReset();
});

describe('opening the drawer (IN-09)', () => {
  it('Alt+Shift+C opens it on any page and a second press closes it', async () => {
    renderShell();
    expect(drawer()).toBeNull();
    const panel = await openDrawer();
    // Focus lands in the question field.
    expect(within(panel).getByLabelText('Your question')).toHaveFocus();

    fireEvent.keyDown(within(panel).getByLabelText('Your question'), CHORD);
    await waitFor(() => expect(drawer()).toBeNull());
  });

  it('is not a modal: it does not mute the shell shortcuts behind it', async () => {
    renderShell();
    const panel = await openDrawer();
    expect(panel.closest('[aria-modal="true"]')).toBeNull();
    // "?" still opens the shortcuts window with the drawer open.
    fireEvent.keyDown(document.body, { key: '?', shiftKey: true });
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('Esc closes it and hands focus back to where it came from', async () => {
    const user = userEvent.setup();
    renderShell();
    const opener = screen.getByRole('button', { name: 'go to settings' });
    opener.focus();
    fireEvent.keyDown(opener, CHORD);
    const panel = await screen.findByRole('complementary', { name: 'Ask Copilot' });
    await user.click(within(panel).getByLabelText('Your question'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(drawer()).toBeNull());
    expect(opener).toHaveFocus();
  });
});

describe('asking a question (IN-09)', () => {
  it('answers from a knowledge source and names it with when it was last reviewed', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(PAPARA);
    renderShell();
    const panel = await openDrawer();

    await user.type(within(panel).getByLabelText('Your question'), 'Papara çekim limiti{Enter}');

    expect(await within(panel).findByText(PAPARA.answer)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/copilot/ask', {
      question: 'Papara çekim limiti',
      context: { route: '/app/reports' },
    });
    expect(within(panel).getByText('Papara limitleri')).toBeInTheDocument();
    expect(within(panel).getByText(/Reviewed Oct 1, 2026/)).toBeInTheDocument();
    // The box is emptied for the next question.
    expect(within(panel).getByLabelText('Your question')).toHaveValue('');
  });

  it('Shift+Enter writes a new line instead of asking', async () => {
    const user = userEvent.setup();
    renderShell();
    const panel = await openDrawer();
    await user.type(within(panel).getByLabelText('Your question'), 'a{Shift>}{Enter}{/Shift}b');
    expect(within(panel).getByLabelText('Your question')).toHaveValue('a\nb');
    expect(api.post).not.toHaveBeenCalled();
  });

  it('tells a role without report access it may not ask — in the console’s words', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({
      answer: 'server prose that must not be shown',
      kind: 'bi',
      sources: [],
      reason: 'not_permitted',
    });
    renderShell();
    const panel = await openDrawer();
    await user.type(within(panel).getByLabelText('Your question'), 'how many chats{Enter}');

    expect(
      await within(panel).findByText('You are not allowed to ask this question.'),
    ).toBeVisible();
    expect(within(panel).queryByText(/server prose/)).toBeNull();
  });

  it('says it does not know when no source answers, and shows no source', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue({ answer: '', kind: 'unknown', sources: [], reason: 'no_answer' });
    renderShell();
    const panel = await openDrawer();
    await user.type(within(panel).getByLabelText('Your question'), 'something obscure{Enter}');
    expect(await within(panel).findByText(/I do not know/)).toBeVisible();
    expect(within(panel).queryByText('Sources')).toBeNull();
  });

  it('shows a report answer as the sentence, and offers examples when it was not understood', async () => {
    const user = userEvent.setup();
    api.post
      .mockResolvedValueOnce({ answer: '12 chats started this week.', kind: 'bi', sources: [] })
      .mockResolvedValueOnce({
        answer: 'I could not place that figure.',
        kind: 'bi',
        sources: [],
        reason: 'not_understood',
      });
    renderShell();
    const panel = await openDrawer();
    const field = within(panel).getByLabelText('Your question');

    await user.type(field, 'How many chats started this week?{Enter}');
    expect(await within(panel).findByText('12 chats started this week.')).toBeVisible();

    await user.type(field, 'weather{Enter}');
    expect(await within(panel).findByText('Not sure what you mean')).toBeVisible();
    // An example fills the box; it does not ask.
    const calls = api.post.mock.calls.length;
    await user.click(within(panel).getAllByRole('button', { name: /^How many chats closed/ })[0]!);
    expect(field).toHaveValue('How many chats closed this week?');
    expect(api.post).toHaveBeenCalledTimes(calls);
  });

  it('tells today’s AI allowance apart from a plain failure', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'limit_reached',
        status: 429,
        message: 'cap',
        requestId: 'r1',
        details: { reason: 'ai_daily_cap' },
      }),
    );
    renderShell();
    const panel = await openDrawer();
    await user.type(within(panel).getByLabelText('Your question'), 'anything{Enter}');
    const alert = await within(panel).findByRole('alert');
    expect(alert).toHaveTextContent('AI allowance is used up');

    api.post.mockRejectedValue(new Error('network'));
    await user.type(within(panel).getByLabelText('Your question'), 'again{Enter}');
    await waitFor(() =>
      expect(
        within(panel)
          .getAllByRole('alert')
          .some((a) => /could not answer/.test(a.textContent ?? '')),
      ).toBe(true),
    );
  });
});

describe('the conversation (IN-09)', () => {
  it('stays open, with its history, when the page changes', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(PAPARA);
    renderShell();
    const panel = await openDrawer();
    await user.type(within(panel).getByLabelText('Your question'), 'Papara çekim limiti{Enter}');
    await within(panel).findByText(PAPARA.answer);

    await user.click(screen.getByRole('button', { name: 'go to settings' }));
    expect(await screen.findByRole('heading', { name: 'Settings page' })).toBeInTheDocument();
    expect(drawer()).not.toBeNull();
    expect(screen.getByText(PAPARA.answer)).toBeInTheDocument();
    expect(screen.getByText('Papara çekim limiti')).toBeInTheDocument();
  });

  it('is empty again in a fresh session, and Clear empties it', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(PAPARA);
    const { unmount } = renderShell();
    const panel = await openDrawer();
    await user.type(within(panel).getByLabelText('Your question'), 'q{Enter}');
    await within(panel).findByText(PAPARA.answer);

    await user.click(within(panel).getByRole('button', { name: 'Clear' }));
    expect(within(panel).queryByText(PAPARA.answer)).toBeNull();
    expect(useCopilotDrawerStore.getState().entries).toHaveLength(0);

    unmount();
    resetCopilotDrawer(); // what the shell does as it goes away
    renderShell();
    expect(drawer()).toBeNull();
    expect(useCopilotDrawerStore.getState().entries).toHaveLength(0);
  });

  it('keeps only the latest entries', () => {
    const { add } = useCopilotDrawerStore.getState();
    for (let i = 0; i < MAX_ENTRIES + 5; i += 1) {
      add({ kind: 'ask', question: `q${i}`, status: 'done', chatId: null });
    }
    const { entries } = useCopilotDrawerStore.getState();
    expect(entries).toHaveLength(MAX_ENTRIES);
    expect(entries[0]!.question).toBe('q5');
  });
});

describe('beside an open conversation (IN-09)', () => {
  it('sends the chat with the question and hands a cited answer to the reply composer', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(PAPARA);
    renderShell();
    act(() => useCopilotDrawerStore.getState().setChat({ id: 'chat-1', canDraft: true }));
    const panel = await openDrawer();

    await user.type(within(panel).getByLabelText('Your question'), 'Papara çekim limiti{Enter}');
    await within(panel).findByText(PAPARA.answer);
    expect(api.post).toHaveBeenCalledWith('/copilot/ask', {
      question: 'Papara çekim limiti',
      context: { route: '/app/reports', chat_id: 'chat-1' },
    });

    await user.click(within(panel).getByRole('button', { name: 'Insert into reply' }));
    expect(useCopilotDraftStore.getState().byChat['chat-1']).toBe(PAPARA.answer);
  });

  it('offers no insert button without a chat, or on an archived chat', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(PAPARA);
    renderShell();
    const panel = await openDrawer();
    await user.type(within(panel).getByLabelText('Your question'), 'one{Enter}');
    await within(panel).findByText(PAPARA.answer);
    expect(within(panel).queryByRole('button', { name: 'Insert into reply' })).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Summarise conversation' })).toBeNull();

    act(() => useCopilotDrawerStore.getState().setChat({ id: 'chat-2', canDraft: false }));
    expect(within(panel).getByRole('button', { name: 'Draft a reply' })).toBeDisabled();
    expect(within(panel).getByRole('button', { name: 'Summarise conversation' })).toBeEnabled();
  });

  it('summarises the open chat into an internal note, and drafts a reply from the knowledge base', async () => {
    const user = userEvent.setup();
    api.post.mockImplementation((url: string) => {
      if (url.endsWith('/summary')) {
        return Promise.resolve({
          summary: 'The player asked about a withdrawal.',
          note_event_id: 'e1',
        });
      }
      return Promise.resolve({ draft: 'Your withdrawal is on its way.', sources: [] });
    });
    renderShell();
    act(() => useCopilotDrawerStore.getState().setChat({ id: 'chat-1', canDraft: true }));
    const panel = await openDrawer();

    await user.click(within(panel).getByRole('button', { name: 'Summarise conversation' }));
    expect(await within(panel).findByText('The player asked about a withdrawal.')).toBeVisible();
    expect(api.post).toHaveBeenCalledWith('/copilot/chats/chat-1/summary', { language: 'en' });

    await user.click(within(panel).getByRole('button', { name: 'Draft a reply' }));
    expect(await within(panel).findByText('Your withdrawal is on its way.')).toBeVisible();
    await user.click(within(panel).getByRole('button', { name: 'Insert into reply' }));
    expect(useCopilotDraftStore.getState().byChat['chat-1']).toBe('Your withdrawal is on its way.');
  });

  it('does not offer to insert into a chat that is no longer the open one', async () => {
    const user = userEvent.setup();
    api.post.mockResolvedValue(PAPARA);
    renderShell();
    act(() => useCopilotDrawerStore.getState().setChat({ id: 'chat-1', canDraft: true }));
    const panel = await openDrawer();
    await user.type(within(panel).getByLabelText('Your question'), 'q{Enter}');
    await within(panel).findByText(PAPARA.answer);

    act(() => useCopilotDrawerStore.getState().setChat({ id: 'chat-9', canDraft: true }));
    expect(within(panel).queryByRole('button', { name: 'Insert into reply' })).toBeNull();
  });
});
