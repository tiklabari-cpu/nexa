/**
 * Two things live here, both reached through the seams `useInbox.ts` exports
 * for them.
 *
 * 1. The realtime push → store wiring for the multi-agent conflict warning
 *    (FR-MOD-08.6.3). `applyPush` is exported for exactly this — there is no
 *    other way to reach a push handler without standing up a real socket.
 * 2. The paged conversation list (NFR-P5) and its meeting point with those same
 *    pushes: the list is live, so what a push does to a cache that now holds
 *    several pages is the whole difficulty. The properties asserted below are
 *    the three that make paging and realtime survive each other — a new chat
 *    enters page 1 without page 2 moving, an update finds its chat on any page,
 *    and a refresh re-reads the first page instead of throwing the rest away.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPush, mergeChatHead, useChatList } from './useInbox.js';
import { useConflictStore } from './conflict.js';
import { ConflictBanner } from './ConflictBanner.js';
import type { PagedResponse } from '../../lib/paged-query.js';
import type { ChatEvent, ChatSummary, InboxView } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
}));

const CHAT = 'TJ1H8CFKRV';

const TWO_AGENTS_PAYLOAD = {
  chat_id: CHAT,
  thread_id: 'thread-1',
  agents: [
    { agent_id: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
    { agent_id: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
  ],
  detected_at: '2026-08-02T10:00:01.000Z',
};

describe('applyPush — agent_conflict_warning', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    useConflictStore.getState().clear(CHAT);
    useConflictStore.setState({ byChat: {} });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('folds a conflict warning into the store', () => {
    applyPush(queryClient, 'agent_conflict_warning', TWO_AGENTS_PAYLOAD);
    expect(useConflictStore.getState().byChat[CHAT]).toEqual({
      agents: [
        { agentId: 'agent-1', since: '2026-08-02T10:00:00.000Z' },
        { agentId: 'agent-2', since: '2026-08-02T10:00:01.000Z' },
      ],
      detectedAt: '2026-08-02T10:00:01.000Z',
    });
  });

  it('the warning appears on screen — push → store → banner, the full chain', () => {
    applyPush(queryClient, 'agent_conflict_warning', TWO_AGENTS_PAYLOAD);
    render(<ConflictBanner chatId={CHAT} />);
    const banner = screen.getByTestId('conflict-banner');
    expect(banner).toHaveTextContent('agent-1');
    expect(banner).toHaveTextContent('agent-2');
  });

  it('ignores a payload with no chat_id', () => {
    const { chat_id: _chatId, ...rest } = TWO_AGENTS_PAYLOAD;
    applyPush(queryClient, 'agent_conflict_warning', rest);
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('ignores a payload whose agents is not an array', () => {
    applyPush(queryClient, 'agent_conflict_warning', { ...TWO_AGENTS_PAYLOAD, agents: 'nope' });
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('ignores a payload with a malformed agent entry', () => {
    applyPush(queryClient, 'agent_conflict_warning', {
      ...TWO_AGENTS_PAYLOAD,
      agents: [{ agent_id: 'agent-1', since: '2026-08-02T10:00:00.000Z' }, { since: 'no id' }],
    });
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });

  it('does not throw on a push with no payload fields at all', () => {
    expect(() => applyPush(queryClient, 'agent_conflict_warning', {})).not.toThrow();
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });
});

describe('applyPush — chat_deactivated clears a live conflict', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    useConflictStore.getState().clear(CHAT);
    useConflictStore.setState({ byChat: {} });
  });

  afterEach(() => {
    queryClient.clear();
  });

  it('a closed chat cannot stay "conflicting"', () => {
    applyPush(queryClient, 'agent_conflict_warning', TWO_AGENTS_PAYLOAD);
    expect(useConflictStore.getState().byChat[CHAT]).toBeDefined();

    applyPush(queryClient, 'chat_deactivated', { chat_id: CHAT });
    expect(useConflictStore.getState().byChat[CHAT]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The paged conversation list (NFR-P5)
// ---------------------------------------------------------------------------

/** Newest first, one minute apart — the order `listChatsInTenant` returns. */
function chat(id: string, minute: number, over: Partial<ChatSummary> = {}): ChatSummary {
  return {
    id,
    customer_id: `customer-${id}`,
    customer_name: id,
    active: true,
    created_at: `2026-08-27T10:${String(minute).padStart(2, '0')}:00.000Z`,
    thread_id: `thread-${id}`,
    assignee_id: null,
    queue_position: null,
    unread_count: 0,
    last_event: null,
    tags: [],
    ...over,
  };
}

function chatPage(items: ChatSummary[], next?: string): PagedResponse<ChatSummary> {
  return { items, ...(next != null ? { next_page_id: next } : {}) };
}

function message(id: string, chatId: string, text: string): ChatEvent {
  return {
    id,
    chat_id: chatId,
    thread_id: `thread-${chatId}`,
    type: 'message',
    text,
    author_id: null,
    author_type: 'customer',
    recipients: 'all',
    attachment_url: null,
    properties: {},
    created_at: '2026-08-27T10:30:00.000Z',
  };
}

function renderChatList(view: InboxView = 'all') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = renderHook(() => useChatList(view), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...rendered, queryClient };
}

/** Requests that carried a cursor — i.e. pages other than the first. */
function cursorRequests(): string[] {
  return api.get.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes('page_id='));
}

describe('useChatList — paging', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it('walks past the first page', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=cursor-1')
          ? chatPage([chat('c3', 12), chat('c4', 11)])
          : chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-1'),
      ),
    );

    const { result } = renderChatList();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasNext).toBe(true);

    act(() => {
      result.current.fetchNext();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(4));
    expect(result.current.items.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(result.current.hasNext).toBe(false);
  });

  it('a conversation that starts now lands on page 1, and page 2 is left where it was', async () => {
    let head = chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-1');
    api.get.mockImplementation((url: string) =>
      Promise.resolve(url.includes('page_id=') ? chatPage([chat('c3', 12)]) : head),
    );

    const { result, queryClient } = renderChatList();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => {
      result.current.fetchNext();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(cursorRequests()).toHaveLength(1);

    // The newest-50 window has shifted: `c0` arrived, `c2` fell out of the
    // bottom of it and now lives only in what page 1 already held.
    head = chatPage([chat('c0', 15), chat('c1', 14)], 'cursor-fresh');
    act(() => {
      applyPush(queryClient, 'incoming_chat', { chat_id: 'c0' });
    });

    await waitFor(() => expect(result.current.items).toHaveLength(4));
    expect(result.current.items.map((c) => c.id)).toEqual(['c0', 'c1', 'c2', 'c3']);
    // Nothing below the first page was re-requested — that is what paging by
    // keyset cursor buys, and what an offset cursor could not have promised.
    expect(cursorRequests()).toHaveLength(1);
  });

  it('an event updates its chat on whichever page holds it, without a request', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=')
          ? chatPage([chat('c3', 12)])
          : chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-1'),
      ),
    );

    const { result, queryClient } = renderChatList();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => {
      result.current.fetchNext();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(3));
    const requestsBefore = api.get.mock.calls.length;

    act(() => {
      applyPush(queryClient, 'incoming_event', {
        chat_id: 'c3',
        event: message('e1', 'c3', 'still here'),
      });
    });

    await waitFor(() => {
      const updated = result.current.items.find((c) => c.id === 'c3');
      expect(updated?.last_event?.text).toBe('still here');
      expect(updated?.unread_count).toBe(1);
    });
    expect(api.get.mock.calls).toHaveLength(requestsBefore);
    // The rows around it are untouched.
    expect(result.current.items.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });

  it('an event about a chat on no loaded page re-reads the first page', async () => {
    let head = chatPage([chat('c1', 14)]);
    api.get.mockImplementation(() => Promise.resolve(head));

    const { result, queryClient } = renderChatList();
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    head = chatPage([chat('c9', 20), chat('c1', 14)]);
    act(() => {
      applyPush(queryClient, 'incoming_event', {
        chat_id: 'c9',
        event: message('e2', 'c9', 'just moved in'),
      });
    });

    await waitFor(() => expect(result.current.items.map((c) => c.id)).toEqual(['c9', 'c1']));
  });

  it('lists a chat once even when the server hands it back on two pages', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=')
          ? chatPage([chat('c2', 13), chat('c3', 12)])
          : chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-1'),
      ),
    );

    const { result } = renderChatList();
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => {
      result.current.fetchNext();
    });

    await waitFor(() => expect(result.current.items).toHaveLength(3));
    expect(result.current.items.map((c) => c.id)).toEqual(['c1', 'c2', 'c3']);
  });
});

describe('mergeChatHead', () => {
  const cache = {
    pages: [chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-1'), chatPage([chat('c3', 12)])],
    pageParams: [undefined, 'cursor-1'] as Array<string | undefined>,
  };

  it('keeps the row the arrivals pushed out of the newest window', () => {
    const merged = mergeChatHead(cache, chatPage([chat('c0', 15), chat('c1', 14)], 'cursor-fresh'));
    expect(merged?.pages[0]?.items.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
    // The cursor page 2 was fetched with, not the fresh one: replacing it would
    // leave `c2` covered by no page at all.
    expect(merged?.pages[0]?.next_page_id).toBe('cursor-1');
    expect(merged?.pages[1]).toBe(cache.pages[1]);
    expect(merged?.pageParams).toEqual([undefined, 'cursor-1']);
  });

  it('drops a row the fresh window reached and did not return', () => {
    // `c2` is inside the range the fresh page covers and is absent from it —
    // archived, or transferred out of this view. Keeping it would strand a row
    // the agent can no longer act on.
    const merged = mergeChatHead(cache, chatPage([chat('c1', 14), chat('c3', 12)], 'cursor-fresh'));
    expect(merged?.pages[0]?.items.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('takes the fresh cursor when no page follows the first', () => {
    const single = { pages: [chatPage([chat('c1', 14)])], pageParams: [undefined] };
    const merged = mergeChatHead(
      single,
      chatPage([chat('c0', 15), chat('c1', 14)], 'cursor-fresh'),
    );
    expect(merged?.pages[0]?.next_page_id).toBe('cursor-fresh');
  });

  it('an empty first page empties the whole list', () => {
    const merged = mergeChatHead(cache, chatPage([]));
    expect(merged?.pages).toHaveLength(1);
    expect(merged?.pages[0]?.items).toEqual([]);
    expect(merged?.pageParams).toEqual([undefined]);
  });

  it('leaves an unloaded list alone — its own first fetch is the refresh', () => {
    expect(mergeChatHead(undefined, chatPage([chat('c1', 14)]))).toBeUndefined();
  });
});
