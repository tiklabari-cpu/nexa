/**
 * Per-chat composer drafts (IN-01, tm 277.2).
 *
 * The composer is keyed on the open chat (tm 277.1), so a chat switch unmounts
 * it. These tests pin what the store keeps across that — text and mode, never an
 * attachment — and every way a draft is meant to end: sent, expired, handed on,
 * closed, signed out.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer.js';
import {
  DRAFT_TTL_MS,
  draftStorageKey,
  loadDraft,
  saveDraft,
  useRetiredDraftStore,
} from './composerDrafts.js';
import { offerDraft, useCopilotDraftStore } from './copilotDraft.js';
import { applyPush } from './useInbox.js';
import { useAuth } from '../../lib/auth-store.js';

const SCOPE = { licenseId: '1000003', accountId: 'a-1' };
const KEY = draftStorageKey(SCOPE);

function mount(chatId = 'CHAT-A') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <Composer key={chatId} chatId={chatId} disabled={false} />
    </QueryClientProvider>,
  );
  const rerenderFor = (next: string, disabled = false) =>
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Composer key={next} chatId={next} disabled={disabled} />
      </QueryClientProvider>,
    );
  return { ...view, queryClient, rerenderFor };
}

function box(): HTMLTextAreaElement {
  return document.getElementById('composer-input') as HTMLTextAreaElement;
}

function stored(): Record<string, { text: string; mode: string; updatedAt: number }> | null {
  const raw = localStorage.getItem(KEY);
  return raw === null ? null : (JSON.parse(raw) as never);
}

beforeEach(() => {
  localStorage.clear();
  useCopilotDraftStore.setState({ byChat: {} });
  useRetiredDraftStore.setState({ byChat: {} });
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: SCOPE.accountId,
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: SCOPE.licenseId,
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ items: [] }),
    })),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Composer drafts — keeping and restoring', () => {
  it('brings the text back when the chat is opened again, and leaves the other chat empty', async () => {
    const { rerenderFor } = mount('CHAT-A');
    await userEvent.type(box(), 'Your refund is on its way');

    rerenderFor('CHAT-B');
    expect(box().value).toBe('');

    rerenderFor('CHAT-A');
    expect(box().value).toBe('Your refund is on its way');
  });

  it('flushes at once on unmount — a switch inside the 300 ms debounce loses nothing', async () => {
    const { rerenderFor } = mount('CHAT-A');
    fireEvent.change(box(), { target: { value: 'half a sent' } });
    // No wait: the debounce has not fired yet.
    expect(stored()).toBeNull();

    rerenderFor('CHAT-B');
    expect(stored()?.['CHAT-A']?.text).toBe('half a sent');
  });

  it('writes after the debounce while the chat stays open', async () => {
    mount();
    fireEvent.change(box(), { target: { value: 'typing…' } });
    await waitFor(() => expect(stored()?.['CHAT-A']?.text).toBe('typing…'));
  });

  it('restores an internal note as a note, not as a reply', async () => {
    const { rerenderFor } = mount('CHAT-A');
    await userEvent.click(screen.getByRole('radio', { name: 'Internal note' }));
    await userEvent.type(box(), 'Player seems upset, check KYC');

    rerenderFor('CHAT-B');
    expect(screen.getByRole('radio', { name: 'Reply' })).toHaveAttribute('aria-checked', 'true');

    rerenderFor('CHAT-A');
    expect(screen.getByRole('radio', { name: 'Internal note' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(box().value).toBe('Player seems upset, check KYC');
  });

  it('stores only text, mode and a timestamp — an attachment has no place to go', async () => {
    const { rerenderFor } = mount('CHAT-A');
    await userEvent.type(box(), 'see attached');
    rerenderFor('CHAT-B');

    expect(Object.keys(stored()?.['CHAT-A'] ?? {}).sort()).toEqual(['mode', 'text', 'updatedAt']);
  });

  it('does not renew the 24 hours merely because the chat was looked at', async () => {
    const stamp = Date.now() - 3 * 60 * 60 * 1000;
    saveDraft(SCOPE, 'CHAT-A', { text: 'old words', mode: 'all' }, stamp);

    const { rerenderFor } = mount('CHAT-A');
    expect(box().value).toBe('old words');
    rerenderFor('CHAT-B');

    expect(stored()?.['CHAT-A']?.updatedAt).toBe(stamp);
  });
});

describe('Composer drafts — TTL', () => {
  it('brings back a draft younger than 24 hours', () => {
    saveDraft(
      SCOPE,
      'CHAT-A',
      { text: 'still here', mode: 'all' },
      Date.now() - DRAFT_TTL_MS + 60_000,
    );
    mount('CHAT-A');
    expect(box().value).toBe('still here');
  });

  it('drops a draft older than 24 hours', () => {
    saveDraft(SCOPE, 'CHAT-A', { text: 'too old', mode: 'all' }, Date.now() - DRAFT_TTL_MS - 1);
    mount('CHAT-A');
    expect(box().value).toBe('');
    expect(loadDraft(SCOPE, 'CHAT-A')).toBeNull();
  });
});

describe('Composer drafts — endings', () => {
  it('deletes the draft the moment it is sent, before any debounce', async () => {
    mount('CHAT-A');
    await userEvent.type(box(), 'On it!');
    await waitFor(() => expect(stored()?.['CHAT-A']).toBeDefined());

    await userEvent.type(box(), '{Enter}');

    expect(box().value).toBe('');
    expect(stored()).toBeNull();
  });

  it('cancels a write still waiting in the debounce when the message is sent', async () => {
    mount('CHAT-A');
    fireEvent.change(box(), { target: { value: 'quick one' } });
    fireEvent.keyDown(box(), { key: 'Enter' });

    // Longer than the debounce: nothing may land afterwards.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(stored()).toBeNull();
  });

  it('keeps no draft for an archived chat, and shows none of an old one', () => {
    saveDraft(SCOPE, 'CHAT-A', { text: 'for a closed chat', mode: 'all' });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Composer chatId="CHAT-A" disabled />
      </QueryClientProvider>,
    );
    expect(loadDraft(SCOPE, 'CHAT-A')).toBeNull();
  });

  it('keeps the draft of a chat whose messages merely failed to load', () => {
    saveDraft(SCOPE, 'CHAT-A', { text: 'still wanted', mode: 'all' });
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Composer chatId="CHAT-A" disabled disabledNotice="could not load" />
      </QueryClientProvider>,
    );
    expect(loadDraft(SCOPE, 'CHAT-A')?.text).toBe('still wanted');
  });

  it('removes every draft of the account on sign-out, and leaves another account alone', async () => {
    saveDraft(SCOPE, 'CHAT-A', { text: 'mine', mode: 'all' });
    saveDraft({ licenseId: SCOPE.licenseId, accountId: 'a-2' }, 'CHAT-A', {
      text: 'a colleague’s',
      mode: 'all',
    });

    await useAuth.getState().signOut();

    expect(localStorage.getItem(KEY)).toBeNull();
    expect(
      localStorage.getItem(draftStorageKey({ licenseId: SCOPE.licenseId, accountId: 'a-2' })),
    ).not.toBeNull();

    // And signing back in finds nothing.
    mount('CHAT-A');
    expect(box().value).toBe('');
  });

  it('survives a corrupt store without throwing', () => {
    localStorage.setItem(KEY, '{not json');
    mount('CHAT-A');
    expect(box().value).toBe('');
  });
});

describe('Composer drafts — the conversation leaves this agent (RTM)', () => {
  const queryClient = new QueryClient();

  it('is deleted on chat_transferred to someone else, and the open box empties', async () => {
    mount('CHAT-A');
    await userEvent.type(box(), 'will not be mine');
    await waitFor(() => expect(stored()?.['CHAT-A']).toBeDefined());

    act(() =>
      applyPush(queryClient, 'chat_transferred', {
        chat_id: 'CHAT-A',
        requester_id: 'a-9',
        transferred_to: { group_ids: [], agent_ids: ['a-7'] },
      }),
    );

    expect(stored()).toBeNull();
    await waitFor(() => expect(box().value).toBe(''));
    // Nothing re-saves it afterwards.
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(stored()).toBeNull();
  });

  it('is kept when the chat is transferred to this agent', () => {
    saveDraft(SCOPE, 'CHAT-A', { text: 'mine again', mode: 'all' });
    applyPush(queryClient, 'chat_transferred', {
      chat_id: 'CHAT-A',
      transferred_to: { group_ids: [], agent_ids: [SCOPE.accountId] },
    });
    expect(loadDraft(SCOPE, 'CHAT-A')?.text).toBe('mine again');
  });

  it('is deleted on chat_deactivated, and only for that chat', () => {
    saveDraft(SCOPE, 'CHAT-A', { text: 'closing', mode: 'all' });
    saveDraft(SCOPE, 'CHAT-B', { text: 'open', mode: 'all' });
    applyPush(queryClient, 'chat_deactivated', { chat_id: 'CHAT-A' });
    expect(loadDraft(SCOPE, 'CHAT-A')).toBeNull();
    expect(loadDraft(SCOPE, 'CHAT-B')?.text).toBe('open');
  });

  it('is deleted for the agent a supervisor took the chat from, not for the supervisor', () => {
    saveDraft(SCOPE, 'CHAT-A', { text: 'taken away', mode: 'all' });
    applyPush(queryClient, 'chat_taken_over', {
      chat_id: 'CHAT-A',
      previous_assignee_id: 'someone-else',
      new_assignee_id: SCOPE.accountId,
    });
    expect(loadDraft(SCOPE, 'CHAT-A')?.text).toBe('taken away');

    applyPush(queryClient, 'chat_taken_over', {
      chat_id: 'CHAT-A',
      previous_assignee_id: SCOPE.accountId,
      new_assignee_id: 'a-supervisor',
    });
    expect(loadDraft(SCOPE, 'CHAT-A')).toBeNull();
  });
});

describe('Composer drafts — two tabs', () => {
  it('fills an empty box when another tab saves a draft for this chat', async () => {
    mount('CHAT-A');
    saveDraft(SCOPE, 'CHAT-A', { text: 'typed in the other tab', mode: 'agents' });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });

    await waitFor(() => expect(box().value).toBe('typed in the other tab'));
    expect(screen.getByRole('radio', { name: 'Internal note' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('never overwrites words already in the box', async () => {
    mount('CHAT-A');
    await userEvent.type(box(), 'mine');
    saveDraft(SCOPE, 'CHAT-A', { text: 'theirs', mode: 'all' });
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }));
    });
    await Promise.resolve();
    expect(box().value).toBe('mine');
  });
});

describe('Composer drafts — Copilot never overwrites unasked', () => {
  it('asks before replacing written words, and keeps them on "Keep my text"', async () => {
    mount('CHAT-A');
    await userEvent.type(box(), 'my own words');

    act(() => offerDraft('CHAT-A', 'Copilot says hello'));

    const prompt = await screen.findByTestId('composer-copilot-confirm');
    expect(box().value).toBe('my own words');
    expect(useCopilotDraftStore.getState().byChat['CHAT-A']).toBeUndefined();

    await userEvent.click(screen.getByRole('button', { name: 'Keep my text' }));
    expect(prompt).not.toBeInTheDocument();
    expect(box().value).toBe('my own words');
  });

  it('replaces on "Replace my text" and comes back as a reply, not a note', async () => {
    mount('CHAT-A');
    await userEvent.click(screen.getByRole('radio', { name: 'Internal note' }));
    await userEvent.type(box(), 'a private note');

    act(() => offerDraft('CHAT-A', 'Copilot says hello'));
    await userEvent.click(await screen.findByRole('button', { name: 'Replace my text' }));

    expect(box().value).toBe('Copilot says hello');
    expect(screen.getByRole('radio', { name: 'Reply' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId('composer-copilot-confirm')).not.toBeInTheDocument();
  });

  it('fills an empty box without asking', async () => {
    mount('CHAT-A');
    act(() => offerDraft('CHAT-A', 'Copilot says hello'));
    await waitFor(() => expect(box().value).toBe('Copilot says hello'));
    expect(screen.queryByTestId('composer-copilot-confirm')).not.toBeInTheDocument();
  });
});
