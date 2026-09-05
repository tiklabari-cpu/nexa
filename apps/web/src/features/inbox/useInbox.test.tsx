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
import {
  applyPush,
  flattenTranscript,
  mergeChatHead,
  useChatList,
  useTranscript,
  useViewCounts,
} from './useInbox.js';
import { useConflictStore } from './conflict.js';
import { ConflictBanner } from './ConflictBanner.js';
import type { PagedResponse } from '../../lib/paged-query.js';
import type { ChatSort } from './chat-sort.js';
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

  it('an event lifts its chat to the top from whichever page holds it, without a request (FR-MOD-02.2.2)', async () => {
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
    // The acceptance criterion's second half: the row *moves*, and it moves all
    // the way to the top — a chat that just produced an event has the greatest
    // `last_event_at` in the view by construction, so first is where the
    // server's own order puts it. `c3` was on page 2 and is now above `c1`.
    expect(result.current.items.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
    // Still no request: the push carried the event, and the event *is* the sort
    // key (`chatActivityAt`), so the new position needs nothing fetched.
    expect(api.get.mock.calls).toHaveLength(requestsBefore);
  });

  it('sorted oldest-first the same event sends the row to the bottom instead', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=')
          ? chatPage([chat('c3', 12)])
          : chatPage([chat('c1', 10), chat('c2', 11)], 'cursor-1'),
      ),
    );

    const { result } = renderHook(() => useChatList('all', 'oldest'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    act(() => {
      result.current.fetchNext();
    });
    await waitFor(() => expect(result.current.items).toHaveLength(3));

    act(() => {
      applyPush(queryClient, 'incoming_event', {
        chat_id: 'c1',
        event: message('e1', 'c1', 'still here'),
      });
    });

    // "Oldest" is the same key read the other way round (FR-MOD-02.2.1), so the
    // most recently active conversation belongs at the far end. Moving it up
    // here would contradict the control the agent just chose.
    await waitFor(() => expect(result.current.items.map((c) => c.id)).toEqual(['c2', 'c3', 'c1']));
  });

  it('lifts the row on one list without disturbing another view that also holds it', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('view=my')
          ? chatPage([chat('c1', 14), chat('c9', 9)])
          : chatPage([chat('c1', 14), chat('c2', 13), chat('c9', 9)]),
      ),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const all = renderHook(() => useChatList('all'), { wrapper });
    const mine = renderHook(() => useChatList('my'), { wrapper });
    await waitFor(() => expect(all.result.current.items).toHaveLength(3));
    await waitFor(() => expect(mine.result.current.items).toHaveLength(2));

    act(() => {
      applyPush(queryClient, 'incoming_event', {
        chat_id: 'c9',
        event: message('e1', 'c9', 'over here'),
      });
    });

    // The sidebar mounts a list per view and the open one mounts a ninth, all
    // in the same cache. One push has to land in every list that holds the row —
    // and land at that list's own top, not at the position it took in another.
    await waitFor(() =>
      expect(all.result.current.items.map((c) => c.id)).toEqual(['c9', 'c1', 'c2']),
    );
    expect(mine.result.current.items.map((c) => c.id)).toEqual(['c9', 'c1']);
  });

  it('survives a neighbour under the same key prefix that is not a page chain', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('page_id=')
          ? chatPage([chat('c3', 12)])
          : chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-1'),
      ),
    );

    const { result, queryClient } = renderChatList();
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    // `AppShell`'s rail badges (FR-MOD-01.2) park their counters under
    // `['chats', 'count', …]` on purpose, so the one invalidate that refreshes
    // the lists refreshes them too. They hold an envelope, not a page chain —
    // and a push walking every `['chats', …]` entry reaches them.
    queryClient.setQueryData(['chats', 'count', 'unassigned'], { items: [], total: 4 });

    act(() => {
      applyPush(queryClient, 'incoming_event', {
        chat_id: 'c2',
        event: message('e1', 'c2', 'still here'),
      });
    });

    // A throw here would not merely skip one row: it escapes `applyPush`, so
    // every push after it in the same handler is lost too, and the list stops
    // being live at all — silently, because nothing rethrows into the UI.
    await waitFor(() => expect(result.current.items.map((c) => c.id)).toEqual(['c2', 'c1']));
    expect(queryClient.getQueryData(['chats', 'count', 'unassigned'])).toEqual({
      items: [],
      total: 4,
    });
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

describe('useChatList — sort (FR-MOD-02.2.1)', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it('carries the server default when no sort is given', async () => {
    api.get.mockResolvedValue(chatPage([chat('c1', 14)]));
    const { result } = renderChatList();
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(String(api.get.mock.calls[0]?.[0])).toContain('sort=newest');
  });

  it('carries the chosen sort on the request', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.get.mockResolvedValue(chatPage([chat('c1', 14)]));
    const { result } = renderHook(() => useChatList('all', 'oldest'), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(String(api.get.mock.calls[0]?.[0])).toContain('sort=oldest');
  });

  it('switching sort starts a fresh page chain rather than paging on the old one', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('sort=oldest')
          ? chatPage([chat('c9', 1)])
          : chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-1'),
      ),
    );

    const { result, rerender } = renderHook(
      ({ sort }: { sort: ChatSort }) => useChatList('all', sort),
      {
        initialProps: { sort: 'newest' as ChatSort },
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        ),
      },
    );
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.hasNext).toBe(true);

    rerender({ sort: 'oldest' });

    // A fresh query for the new sort, not a continuation: the newest-sorted
    // page chain (its cursor included) is left exactly where it was, in its
    // own cache entry — nothing here asks for `page_id=cursor-1`.
    await waitFor(() => expect(result.current.items).toEqual([chat('c9', 1)]));
    expect(result.current.hasNext).toBe(false);
    expect(cursorRequests()).toHaveLength(0);
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

  it('does not let a read taken before a push undo it (FR-MOD-02.2.2)', () => {
    // The race an ordering key that *moves* creates, and one this suite would
    // not have needed while the key was `created_at`. A second conversation
    // starting triggers a head re-read; a message lands on `c2` while that read
    // is in flight, so the push moves `c2` to the top and the read then comes
    // back describing the workspace as it was a moment earlier.
    const pushed = chat('c2', 13, { last_event: message('e9', 'c2', 'are you there?') });
    const afterPush = {
      ...cache,
      pages: [chatPage([pushed, chat('c1', 14)], 'cursor-1'), cache.pages[1]!],
    };

    // The stale read still has `c2` second, with no event on it at all.
    const merged = mergeChatHead(afterPush, chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-2'));

    // Row by row the later of the two wins, so the climb survives the read.
    // Overwriting wholesale would put `c2` back under `c1` — the row would move
    // up and then visibly drop back, which is worse than never moving.
    expect(merged?.pages[0]?.items.map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(merged?.pages[0]?.items[0]?.last_event?.text).toBe('are you there?');
  });

  it('keeps a row bumped above everything the stale read returned', () => {
    // The same race for a row the fresh window never reached: `c3` lives on page
    // 2, a push moved it to the top of page 1, and the read — taken first —
    // returns a window that has no idea. It is newer than every row the server
    // returned, which is what separates it from a row that has left the view.
    const pushed = chat('c3', 12, { last_event: message('e9', 'c3', 'still waiting') });
    const afterPush = {
      ...cache,
      pages: [chatPage([pushed, chat('c1', 14), chat('c2', 13)], 'cursor-1'), chatPage([])],
    };

    const merged = mergeChatHead(afterPush, chatPage([chat('c1', 14), chat('c2', 13)], 'cursor-2'));

    expect(merged?.pages[0]?.items.map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
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

// ---------------------------------------------------------------------------
// The rail counters (FR-MOD-02.1.2 · audit D3)
// ---------------------------------------------------------------------------

/** What the sidebar shows per view, and what the server says each view holds. */
const VIEW_TOTALS: Record<InboxView, number> = {
  all: 240,
  my: 12,
  queued: 3,
  unassigned: 7,
  supervised: 4,
  archived: 180,
  ai: 9,
  // Ten more resolutions than a page can carry, so "counted the page" and
  // "counted the view" cannot give the same answer.
  ai_solved: 137,
};

/** The view a `/chats` request is for. */
function viewOf(url: string): InboxView {
  return (new URLSearchParams(url.slice(url.indexOf('?'))).get('view') ?? 'all') as InboxView;
}

/** One page of a view: capped at the client's own 50, with the real total beside it. */
function viewPage(view: InboxView): PagedResponse<ChatSummary> {
  const total = VIEW_TOTALS[view];
  const rows = Math.min(total, 50);
  return {
    items: Array.from({ length: rows }, (_, i) => chat(`${view}-${i}`, i % 60)),
    total,
    ...(rows < total ? { next_page_id: `cursor-${view}` } : {}),
  };
}

function renderViewCounts() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = renderHook(() => useViewCounts(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...rendered, queryClient };
}

describe('useViewCounts — the count is the view, not the rows fetched', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it('reports the whole view from one page of it', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(viewPage(viewOf(url))));

    const { result } = renderViewCounts();
    await waitFor(() => expect(result.current.ai_solved).toBeDefined());

    // The defect, in one line: fifty rows arrived and a hundred and thirty-seven
    // resolutions exist. Counting what was fetched — which is what this hook did
    // — puts "50" beside Solved and keeps it there however far the number grows,
    // and that number is ADR-09's, the one the invoice meters.
    expect(result.current.ai_solved).toBe(137);
    expect(result.current.ai_solved).not.toBe(50);

    // Every view in the rail, not only the AI ones: they all had the same
    // ceiling, so they all read the server's number now.
    await waitFor(() => expect(result.current.all).toBeDefined());
    expect(result.current).toEqual(VIEW_TOTALS);
  });

  it('says nothing at all until the first page lands', async () => {
    // An unloaded view must not read as an empty one — "0 Solved" is a claim,
    // and before the response there is nothing to claim.
    api.get.mockImplementation(() => new Promise(() => {}));

    const { result } = renderViewCounts();
    expect(Object.values(result.current).every((count) => count === undefined)).toBe(true);
  });

  it('follows the server when a live refresh reports a different total', async () => {
    api.get.mockImplementation((url: string) => Promise.resolve(viewPage(viewOf(url))));

    const { result, queryClient } = renderViewCounts();
    await waitFor(() => expect(result.current.ai_solved).toBe(137));

    // A conversation resolves while the agent is looking at the list. The push
    // re-reads page 1 of every mounted view; the counter has to move with it,
    // not sit on the number the first read happened to carry.
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        viewOf(url) === 'ai_solved'
          ? { ...viewPage('ai_solved'), total: 138 }
          : viewPage(viewOf(url)),
      ),
    );
    act(() => {
      applyPush(queryClient, 'incoming_chat', { chat_id: 'ai_solved-0' });
    });

    await waitFor(() => expect(result.current.ai_solved).toBe(138));
  });
});

// ---------------------------------------------------------------------------
// The paged transcript (NFR-P5 / FR-MOD-02.3.1)
// ---------------------------------------------------------------------------

/**
 * One event, `seq` places into the thread. The sequence lives inside the id
 * (`TJ1H8CFKRV_7`) and both page directions order on it, so the id is what a
 * cursor assertion should be reading — not the timestamp beside it.
 */
function event(seq: number): ChatEvent {
  return {
    ...message(`${CHAT}_${seq}`, CHAT, `m${seq}`),
    created_at: `2026-08-27T10:00:${String(seq).padStart(2, '0')}.000Z`,
  };
}

/** A page as the server sends it: newest first, `next_page_id` = its last item. */
function eventPage(items: ChatEvent[]): PagedResponse<ChatEvent> {
  const oldest = items.at(-1);
  return { items, ...(oldest ? { next_page_id: oldest.id } : {}) };
}

/** The last page of a thread — no cursor, which is what ends the walk. */
function firstEverPage(items: ChatEvent[]): PagedResponse<ChatEvent> {
  return { items };
}

function renderTranscript(chatId: string | null = CHAT) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rendered = renderHook(() => useTranscript(chatId), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { ...rendered, queryClient };
}

function texts(events: ChatEvent[]): string[] {
  return events.map((e) => e.text ?? '');
}

describe('useTranscript — reverse paging', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  it('opens at the newest page and reads oldest-first', async () => {
    api.get.mockResolvedValue(eventPage([event(3), event(2)]));

    const { result } = renderTranscript();
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    // The request asks for the tail of the thread; the render order is the
    // reverse of the answer.
    expect(String(api.get.mock.calls[0]?.[0])).toContain('sort=newest');
    expect(texts(result.current.events)).toEqual(['m2', 'm3']);
    expect(result.current.hasOlder).toBe(true);
  });

  it('walks backwards with before_event_id, and the page lands on top', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('before_event_id=')
          ? firstEverPage([event(1), event(0)])
          : eventPage([event(3), event(2)]),
      ),
    );

    const { result } = renderTranscript();
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    act(() => {
      result.current.loadOlder();
    });
    await waitFor(() => expect(result.current.events).toHaveLength(4));

    // The cursor is the oldest event already loaded, and the history it returns
    // is prepended — the seam between the two pages has no gap and no repeat.
    expect(String(api.get.mock.calls.at(-1)?.[0])).toContain(`before_event_id=${CHAT}_2`);
    expect(texts(result.current.events)).toEqual(['m0', 'm1', 'm2', 'm3']);
    // No cursor came back: that is the start of the thread.
    expect(result.current.hasOlder).toBe(false);
  });

  it('leaves the read receipt where it was while history loads', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('before_event_id=')
          ? firstEverPage([event(1), event(0)])
          : eventPage([event(3), event(2)]),
      ),
    );

    const { result } = renderTranscript();
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    // `useMarkSeen` reads the last element as "the newest thing on screen"
    // (`InboxPage`), so reading backwards must not be able to move it.
    const newest = result.current.events.at(-1);

    act(() => {
      result.current.loadOlder();
    });
    await waitFor(() => expect(result.current.events).toHaveLength(4));

    expect(result.current.events.at(-1)).toEqual(newest);
  });

  it('stops at the start of the thread instead of asking again', async () => {
    api.get.mockResolvedValue(firstEverPage([event(1), event(0)]));

    const { result } = renderTranscript();
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.hasOlder).toBe(false);

    act(() => {
      result.current.loadOlder();
    });
    expect(api.get.mock.calls).toHaveLength(1);
  });

  it('a pushed message joins the newest page, leaving the history loaded above it', async () => {
    api.get.mockImplementation((url: string) =>
      Promise.resolve(
        url.includes('before_event_id=')
          ? firstEverPage([event(1), event(0)])
          : eventPage([event(3), event(2)]),
      ),
    );

    const { result, queryClient } = renderTranscript();
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    act(() => {
      result.current.loadOlder();
    });
    await waitFor(() => expect(result.current.events).toHaveLength(4));
    const requestsBefore = api.get.mock.calls.length;

    act(() => {
      applyPush(queryClient, 'incoming_event', { chat_id: CHAT, event: event(4) });
    });

    await waitFor(() =>
      expect(texts(result.current.events)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4']),
    );
    // The push carries the event, so nothing is re-read — and in particular the
    // pages the agent scrolled back through are not thrown away.
    expect(api.get.mock.calls).toHaveLength(requestsBefore);
  });

  it('replaces the optimistic copy of a message rather than showing it twice', async () => {
    api.get.mockResolvedValue(eventPage([event(3)]));
    const { result, queryClient } = renderTranscript();
    await waitFor(() => expect(result.current.events).toHaveLength(1));

    const pending: ChatEvent = {
      ...message('pending-1', CHAT, 'on its way'),
      author_type: 'agent',
      properties: { pending: true },
    };
    act(() => {
      queryClient.setQueryData(
        ['events', CHAT],
        (cache: { pages: PagedResponse<ChatEvent>[] }) => ({
          ...cache,
          pages: [{ ...cache.pages[0]!, items: [pending, ...cache.pages[0]!.items] }],
        }),
      );
    });
    await waitFor(() => expect(result.current.events).toHaveLength(2));

    act(() => {
      applyPush(queryClient, 'incoming_event', {
        chat_id: CHAT,
        event: { ...message(`${CHAT}_4`, CHAT, 'on its way'), author_type: 'agent' },
      });
    });

    await waitFor(() => expect(texts(result.current.events)).toEqual(['m3', 'on its way']));
    expect(result.current.events.at(-1)?.id).toBe(`${CHAT}_4`);
  });

  it('ignores a push about a conversation nobody has open', () => {
    const queryClient = new QueryClient();
    applyPush(queryClient, 'incoming_event', { chat_id: CHAT, event: event(1) });
    expect(queryClient.getQueryData(['events', CHAT])).toBeUndefined();
  });

  it('flattens an unopened transcript to nothing', () => {
    expect(flattenTranscript(undefined)).toEqual([]);
  });
});
