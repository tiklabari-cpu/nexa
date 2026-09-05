/**
 * Inbox data: the chat list, the open transcript, and the live updates that
 * keep both current.
 *
 * The realtime layer feeds the same React Query cache the fetches write to, so
 * a pushed message and a fetched one are indistinguishable downstream. The
 * alternative — a parallel "live events" list merged at render time — is where
 * duplicate and out-of-order messages come from.
 */
import {
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
} from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { ROUTING_STATUSES } from '@nexa/types';
import { RtmClient, type PushHandler } from '../../lib/realtime.js';
import { setRealtimeStatus } from '../../lib/realtime-status.js';
import { useApiClient, useAuth } from '../../lib/auth-store.js';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';
import { usePagedQuery, type PagedQueryResult, type PagedResponse } from '../../lib/paged-query.js';
import { useTypingStore } from './typing.js';
import { useConflictStore, type ConflictAgent } from './conflict.js';
import { useFailedSendStore } from './failedSends.js';
import { DEFAULT_CHAT_SORT, type ChatSort } from './chat-sort.js';
import type { ChatDetail, ChatEvent, ChatSummary, InboxView, SendInput } from './types.js';

const RTM_URL = import.meta.env['VITE_RTM_URL'] ?? 'ws://localhost:4001/v1/agent/rtm/ws';

/** Rows per request. The list chains pages from here, so it is a page, not a cap. */
const CHAT_PAGE_SIZE = 50;

/**
 * Events per request. The transcript walks *backwards* from here, so this too
 * is a page rather than a cap: before it chained, a conversation longer than
 * this simply stopped existing past the two-hundredth message (NFR-P5).
 */
const TRANSCRIPT_PAGE_SIZE = 200;

/**
 * The safety net for a socket that is down without having noticed yet. It
 * re-reads the *first* page only — see `mergeChatHead` for why that is enough.
 */
const CHAT_HEAD_REFRESH_MS = 30_000;

export function chatsKey(view: InboxView, sort: ChatSort = DEFAULT_CHAT_SORT): unknown[] {
  return ['chats', view, sort];
}
export function eventsKey(chatId: string): unknown[] {
  return ['events', chatId];
}

function chatListUrl(view: InboxView, sort: ChatSort, pageId: string | undefined): string {
  const cursor = pageId ? `&page_id=${encodeURIComponent(pageId)}` : '';
  return `/chats?view=${view}&sort=${sort}&limit=${CHAT_PAGE_SIZE}${cursor}`;
}

/**
 * One page of a transcript, newest-first.
 *
 * `sort=newest` is the direction a conversation that opens at the latest
 * message and loads history upward asks for, and the reason the contract
 * carries both: `after_event_id` replays forward for the realtime layer,
 * `before_event_id` walks backward for this (`chats.yaml`, `listEvents`).
 * `next_page_id` is the id of the last item returned — the oldest on the page —
 * and feeding it back as `before_event_id` is what asks for the page above it.
 *
 * Both directions page on the sequence embedded in the event id (`…_7`) rather
 * than on `created_at`, because several events can share a millisecond and an
 * offset page shifts under an active conversation.
 */
function transcriptUrl(chatId: string, beforeEventId: string | undefined): string {
  const cursor = beforeEventId ? `&before_event_id=${encodeURIComponent(beforeEventId)}` : '';
  return `/chats/${chatId}/events?sort=newest&limit=${TRANSCRIPT_PAGE_SIZE}${cursor}`;
}

/** What `usePagedQuery` keeps in the cache for one view. */
type ChatListCache = InfiniteData<PagedResponse<ChatSummary>, string | undefined>;

/**
 * When this conversation last moved — the server's ordering key, read off the
 * row rather than fetched as a field of its own.
 *
 * `chats.last_event_at` is by construction the `created_at` of the chat's
 * newest event, or the chat's own creation time while it has none
 * (`20260905120000_chats_last_event_at`), which is exactly what these two
 * fields already say. So the contract needed no new property for the client to
 * order by the same key the server does — and, more usefully, a push updates
 * `last_event` and therefore updates the sort key in the same stroke.
 */
export function chatActivityAt(chat: ChatSummary): string {
  return chat.last_event?.created_at ?? chat.created_at;
}

/**
 * The server's order, as one predicate: last activity descending, `id`
 * descending as the tie-break (`listChatsInTenant`'s `orderBy`, and the two
 * columns its cursor is built from).
 */
function isOlderChat(a: ChatSummary, b: ChatSummary): boolean {
  const aAt = chatActivityAt(a);
  const bAt = chatActivityAt(b);
  return aAt === bAt ? a.id < b.id : aAt < bAt;
}

/**
 * Folds a freshly read first page into a paged chat list without disturbing the
 * pages below it.
 *
 * Newest-first only (`useChatList`'s default and only user of this): a chat
 * this new is always the newest row there is, which is what lets a refresh
 * stop at page 1. Sorted oldest-first, page 1 holds the *oldest* chats, a set
 * a fresh arrival can never join — see `useChatList`'s `refreshHead` for the
 * plain re-read that sort uses instead.
 *
 * This is the whole reason the contract pages by keyset cursor rather than by
 * offset. The cursor is `(last_event_at, id)`, so page 2 means "everything less
 * recently active than this particular point" — a statement about a point in
 * the order, which stays true even though the row it was taken from can move.
 * A conversation that just spoke is the most recently active row there is: it
 * can only enter at the top of page 1, and every page already scrolled through
 * still describes rows at or below the boundary it was cut at. With an offset
 * cursor `?offset=50` would now point one row later and the agent would
 * silently never see the conversation that slid across the boundary.
 *
 * What the moving key does cost is the opposite direction: a row further down
 * that gets an event climbs *above* the cursors of the pages already loaded, so
 * the chain no longer covers it. That is why every push re-reads the head — it
 * is where the row went — and why `applyPush` moves the row itself rather than
 * only repainting it in place.
 *
 * So a refresh only has to re-read page 1. Two details make the seam exact:
 *
 *   - Rows pushed *out* of the newest-50 window by the arrivals are kept, not
 *     dropped: page 2 starts after the boundary this page already had, so
 *     nothing else covers them. Rows the fresh window *does* reach and did not
 *     return are gone from the view (archived, transferred away) and are
 *     dropped — that is the difference `isOlderChat` decides.
 *   - The stored `next_page_id` stays put while a page follows it, because
 *     that cursor is what page 2 was fetched with.
 *
 * A fresh page that comes back empty is the one case where the pages below are
 * discarded: read from the top, "no rows" is a statement about the whole view.
 */
export function mergeChatHead(
  cache: ChatListCache | undefined,
  fresh: PagedResponse<ChatSummary>,
): ChatListCache | undefined {
  // Nothing loaded yet: the query's own first fetch is the refresh.
  if (!cache || cache.pages.length === 0) return cache;

  const head = cache.pages[0]!;
  const rest = cache.pages.slice(1);

  const oldest = fresh.items.at(-1);
  if (!oldest) {
    return { pages: [fresh], pageParams: cache.pageParams.slice(0, 1) };
  }

  const newest = fresh.items[0]!;
  const returned = new Set(fresh.items.map((chat) => chat.id));
  const cached = new Map(head.items.map((chat) => [chat.id, chat]));

  // Row by row, the later of the two wins. A read that was already in flight
  // when a push landed describes an *earlier* instant than the cache does, and
  // once the ordering key moves, letting it overwrite the cache wholesale is not
  // a cosmetic staleness — it puts the row back where it was, undoing the climb
  // the requirement is about. Measured, because it is a real race rather than a
  // theoretical one: a second visitor opening a conversation starts this read,
  // and a message arriving in the six hundred milliseconds before it returns was
  // silently rolled back (`inbox-ordering.spec.ts` is the case that caught it).
  const freshened = fresh.items.map((chat) => {
    const local = cached.get(chat.id);
    return local && isOlderChat(chat, local) ? local : chat;
  });

  // Cached rows the fresh page did not return, and why each is kept:
  //
  //   - Older than the window's last row: page 2 starts after the boundary this
  //     page already had, so nothing else covers them.
  //   - Newer than the window's *first* row: nothing the server returned is that
  //     recent, so this row was bumped after the read was taken — the same race
  //     as above, for a row the stale window did not reach at all.
  //
  // What is left in between is the gap the fresh window did cover and did not
  // return: rows that have genuinely left the view (archived, transferred away).
  // Those are dropped, which is the whole point of re-reading the head.
  const keptFromCache = head.items.filter(
    (chat) => !returned.has(chat.id) && (isOlderChat(chat, oldest) || isOlderChat(newest, chat)),
  );

  const nextPageId = rest.length > 0 ? head.next_page_id : fresh.next_page_id;
  const merged: PagedResponse<ChatSummary> = {
    // Sorted rather than concatenated: with two sources of truth for a row's
    // recency, neither list is ordered on its own any more. One predicate,
    // `isOlderChat`, is what keeps this page in the server's order.
    items: [...freshened, ...keptFromCache].sort((a, b) => (isOlderChat(a, b) ? 1 : -1)),
    ...(fresh.total !== undefined ? { total: fresh.total } : {}),
    ...(nextPageId !== undefined ? { next_page_id: nextPageId } : {}),
  };

  return { ...cache, pages: [merged, ...rest] };
}

/**
 * Every mounted chat list registers how to re-read its own first page here.
 *
 * `applyPush` holds a `QueryClient` and nothing else, and a `QueryClient` can
 * invalidate but cannot refresh *part* of an infinite query — invalidating one
 * re-requests every page the agent has scrolled through. This registry is how a
 * push reaches the one request that is actually needed. It is the shape
 * `useTypingStore.setEmitter` already uses for the same reason: the socket
 * outlives any one component.
 */
const headRefreshers = new Map<
  symbol,
  { view: InboxView; sort: ChatSort; run: () => Promise<void> }
>();
const headInFlight = new Set<string>();
const headPending = new Set<string>();
let headTicker: ReturnType<typeof setInterval> | null = null;

/** The dedup/collapse key for one mounted list — a view can be mounted twice at once (below), each at its own sort. */
function headKey(view: InboxView, sort: ChatSort): string {
  return `${view}:${sort}`;
}

/**
 * Re-reads every mounted chat list, once per (view, sort) pair — the sidebar
 * counts mount a list for all eight views (always the default sort) and the
 * open one mounts a ninth for whichever it is showing, at whichever sort the
 * agent picked, so the same view can be registered twice at once.
 */
export function refreshChatHeads(): void {
  const done = new Set<string>();
  for (const entry of headRefreshers.values()) {
    const key = headKey(entry.view, entry.sort);
    if (done.has(key)) continue;
    done.add(key);
    void entry.run();
  }
}

/**
 * The conversation list for one view, page by page (NFR-P5).
 *
 * Live and paginated at once: pushes and the periodic refresh write into the
 * same paged cache the scroll reads from, through `mergeChatHead` (arrivals)
 * and `patchChatInPages` (a row that changed). Rows are de-duplicated on the
 * way out — a chat that leaves the view lets the fresh window reach one row
 * further down, which can briefly put that row on two pages.
 *
 * `sort` (FR-MOD-02.2.1, `chat-sort.ts`) is part of the query key, so picking
 * a different one starts an entirely fresh page chain rather than continuing
 * the old one — the newest-sorted pages an agent already scrolled through
 * stay cached under their own key, not spliced into the oldest-sorted list.
 */
export function useChatList(
  view: InboxView,
  sort: ChatSort = DEFAULT_CHAT_SORT,
): PagedQueryResult<ChatSummary> {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const buildUrl = useCallback(
    (pageId: string | undefined) => chatListUrl(view, sort, pageId),
    [view, sort],
  );
  const query = usePagedQuery<ChatSummary>({ queryKey: chatsKey(view, sort), buildUrl });

  // Read through a ref, not a dependency: the merge writes the page array that
  // an in-flight `fetchNext` is about to overwrite with the snapshot it took
  // when it started, so a refresh landing inside that window is simply skipped.
  // The next push or tick re-applies it.
  const fetchingNextRef = useRef(false);
  fetchingNextRef.current = query.isFetchingNext;

  const refreshHead = useCallback(async (): Promise<void> => {
    if (fetchingNextRef.current) return;
    const cacheKey = chatsKey(view, sort);
    // Nothing loaded yet: the query's own first fetch is the refresh.
    if (!queryClient.getQueryData(cacheKey)) return;

    // A burst collapses to one read in flight plus at most one repeat, rather
    // than one read per push. The repeat is not optional: a chat starting and
    // its first message arrive as two pushes a few milliseconds apart, and a
    // read already in flight when the second lands is usually too early to
    // contain it — dropping it would leave the row saying "no messages yet"
    // until the next tick.
    const burstKey = headKey(view, sort);
    if (headInFlight.has(burstKey)) {
      headPending.add(burstKey);
      return;
    }
    headInFlight.add(burstKey);
    try {
      do {
        headPending.delete(burstKey);
        if (sort === 'newest') {
          const fresh = await api.get<PagedResponse<ChatSummary>>(
            chatListUrl(view, sort, undefined),
          );
          queryClient.setQueryData<ChatListCache>(cacheKey, (cache) => mergeChatHead(cache, fresh));
        } else {
          // Sorted oldest-first, page 1 holds the *oldest* chats in the view —
          // a set a brand-new arrival never joins (it is always the newest row
          // there is), so there is no stable "head" to partially re-read the
          // way `mergeChatHead` does above. A plain re-read of every page
          // already loaded is correct rather than cheap, and bounded: this
          // branch only runs for the one list an agent has actually switched
          // to "Oldest" for.
          //
          // `refetchQueries`, not the paged-query's own `refetch` — that one
          // is deliberately fire-and-forget (`void refetch()`) for a scroll
          // button, and this loop's collapsing logic needs to actually await
          // the read to know when it is safe to check `headPending` again.
          await queryClient.refetchQueries({ queryKey: cacheKey, exact: true });
        }
      } while (headPending.has(burstKey));
    } catch {
      // Best-effort, like the interval it replaces: a dropped refresh leaves
      // the list one beat stale until the next push or tick.
      headPending.delete(burstKey);
    } finally {
      headInFlight.delete(burstKey);
    }
  }, [api, queryClient, view, sort]);

  useEffect(() => {
    const token = Symbol('chat-head');
    headRefreshers.set(token, { view, sort, run: refreshHead });
    // One timer for all views rather than one per mounted list, so the eight
    // lists on screen cost seven requests every interval, not eight.
    headTicker ??= setInterval(refreshChatHeads, CHAT_HEAD_REFRESH_MS);
    return () => {
      headRefreshers.delete(token);
      if (headTicker && headRefreshers.size === 0) {
        clearInterval(headTicker);
        headTicker = null;
      }
    };
  }, [view, sort, refreshHead]);

  const items = useMemo(() => {
    const seen = new Set<string>();
    return query.items.filter((chat) => (seen.has(chat.id) ? false : (seen.add(chat.id), true)));
  }, [query.items]);

  return { ...query, items };
}

/**
 * Applies `patch` to one chat wherever it sits in the paged cache, across every
 * view, and moves it to where its new activity time puts it. Returns whether it
 * was found at all — a push about a chat on no loaded page is the signal that it
 * may have just entered a view, and the only case where a request is worth
 * spending.
 *
 * Moving, not just repainting, is the requirement (FR-MOD-02.2.2 — "RTM'de
 * yukarı taşınır"): a visitor who writes has to reach the top of the list the
 * agent is working down, not merely change the preview text of a row buried
 * forty conversations deep. And "the top" is not a guess about the server's
 * order — a chat that just produced an event has, by the column's own
 * invariant, the greatest `last_event_at` in the whole view, so it is the first
 * row sorted newest-first and the last row sorted oldest-first. Either way it
 * lands at an *end* of the loaded chain, which is the one position that needs
 * no knowledge of the rows below the last loaded page.
 *
 * The sort comes off the query key (`chatsKey`) rather than being passed in:
 * the sidebar's eight lists and the open list are all in this cache at once and
 * do not share a sort, so one push has to land differently in different lists.
 */
function patchChatInPages(
  queryClient: QueryClient,
  chatId: string,
  patch: (chat: ChatSummary) => ChatSummary,
): boolean {
  let touched = false;
  for (const [queryKey] of queryClient.getQueriesData<ChatListCache>({ queryKey: ['chats'] })) {
    const oldestFirst = queryKey[2] === 'oldest';
    queryClient.setQueryData<ChatListCache>(queryKey, (cache) => {
      // `['chats']` is a prefix, not a namespace this owns: `AppShell`'s rail
      // badges keep their counters under `['chats', 'count', …]` deliberately,
      // so the one `invalidateQueries({ queryKey: ['chats'] })` that refreshes
      // the lists refreshes the badges with them. Those hold an envelope, not a
      // page chain. Reaching for `.pages` on one throws — and a throw here is
      // not a lost row, it is a *dead push handler*: it escapes `applyPush`,
      // so nothing after it in the same push runs either.
      if (!cache || !Array.isArray(cache.pages) || cache.pages.length === 0) return cache;

      // Lift the row out of whichever page holds it, then put it back at the
      // end the sort calls for. Done in one pass so a row cannot be duplicated
      // by being inserted before it is removed.
      let lifted: ChatSummary | undefined;
      const pages = cache.pages.map((page) => {
        const hit = page.items.find((chat) => chat.id === chatId);
        if (!hit) return page;
        lifted = hit;
        return { ...page, items: page.items.filter((chat) => chat.id !== chatId) };
      });
      if (!lifted) return cache;
      touched = true;

      const moved = patch(lifted);
      const target = oldestFirst ? pages.length - 1 : 0;
      return {
        ...cache,
        pages: pages.map((page, index) =>
          index === target
            ? { ...page, items: oldestFirst ? [...page.items, moved] : [moved, ...page.items] }
            : page,
        ),
      };
    });
  }
  return touched;
}

export function useChat(chatId: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['chat', chatId],
    queryFn: () => api.get<ChatDetail>(`/chats/${chatId}`),
    enabled: chatId !== null,
  });
}

/** What `usePagedQuery` keeps in the cache for one open transcript. */
export type TranscriptCache = InfiniteData<PagedResponse<ChatEvent>, string | undefined>;

/**
 * The pages of a transcript as one oldest-first list — the order it is read in.
 *
 * Both levels reverse, because both run newest-first: the last page holds the
 * oldest events, and inside it the last item is the oldest of all. Reversing
 * here rather than asking the server for ascending pages is what buys the
 * stability — walking backwards means page 2 is "everything before this
 * particular event", which stays true however many messages arrive while the
 * agent reads.
 */
function flattenTranscriptPages(pages: PagedResponse<ChatEvent>[]): ChatEvent[] {
  const events: ChatEvent[] = [];
  for (let i = pages.length - 1; i >= 0; i -= 1) {
    const items = pages[i]!.items;
    for (let j = items.length - 1; j >= 0; j -= 1) events.push(items[j]!);
  }
  return events;
}

/** The same, for a reader holding the cache entry rather than the hook. */
export function flattenTranscript(cache: TranscriptCache | undefined): ChatEvent[] {
  return flattenTranscriptPages(cache?.pages ?? []);
}

/**
 * Puts an event that just happened at the head of the newest page.
 *
 * Page 0 is the newest slice and its items run newest-first, so "newest" is
 * index 0 — and the page's `next_page_id` is the id of its *last* item, which
 * an insert at the front cannot move. That is why the history already loaded
 * above it stays addressable: nothing the conversation does now changes what
 * "the page before event N" means.
 */
function prependToNewestPage(cache: TranscriptCache, event: ChatEvent): TranscriptCache {
  const head = cache.pages[0]!;
  return {
    ...cache,
    pages: [{ ...head, items: [event, ...head.items] }, ...cache.pages.slice(1)],
  };
}

/**
 * The open conversation, page by page, newest first (NFR-P5 / FR-MOD-02.3.1).
 *
 * `loadOlder` is what the transcript calls as the reader approaches the top;
 * `events` comes back oldest-first, so a page landing at the front is a
 * prepend and `Transcript.tsx` compensates the scroll for it.
 */
export interface TranscriptResult {
  /** Every loaded event, oldest-first. */
  events: ChatEvent[];
  /** More history exists above what is loaded. */
  hasOlder: boolean;
  isLoadingOlder: boolean;
  /** Walks one page further back; a no-op at the start of the thread. */
  loadOlder: () => void;
  /** No page has arrived yet. */
  isPending: boolean;
}

export function useTranscript(chatId: string | null): TranscriptResult {
  const buildUrl = useCallback(
    (pageId: string | undefined) => transcriptUrl(chatId ?? '', pageId),
    [chatId],
  );
  const query = usePagedQuery<ChatEvent>({
    queryKey: eventsKey(chatId ?? ''),
    buildUrl,
    enabled: chatId !== null,
  });

  const events = useMemo(() => flattenTranscriptPages(query.pages), [query.pages]);

  return {
    events,
    hasOlder: query.hasNext,
    isLoadingOlder: query.isFetchingNext,
    loadOlder: query.fetchNext,
    isPending: query.isPending,
  };
}

/**
 * Read receipt for the open chat (FR-MOD-02.2.2): the newest visible event's
 * timestamp, debounced 1s, becomes `POST /chats/{chatId}/seen`'s `seen_up_to`.
 * The unread badge itself already comes straight from the server
 * (`ChatSummary.unread_count`, derived from this same marker) — the only gap
 * this closes is that nothing ever wrote the marker, so it never moved.
 *
 * `chatId`/`seenUpTo` should be `null` whenever the chat is not actually on
 * screen (no selection, or another pane — e.g. Tickets — covers it): a chat
 * that keeps fetching in the background must not get silently marked "seen".
 */
export function useMarkSeen(chatId: string | null, seenUpTo: string | null): void {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const apiRef = useRef(api);
  apiRef.current = api;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ chatId: string; seenUpTo: string } | null>(null);

  // Stable across renders — both effects below reach it through refs, not
  // through their own dependency arrays, so a chat switch and an unmount can
  // both flush the exact same in-flight target without duplicating the call.
  const flushRef = useRef<() => void>(() => {});
  flushRef.current = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const target = pendingRef.current;
    if (!target) return;
    pendingRef.current = null;
    void apiRef.current
      .post(`/chats/${target.chatId}/seen`, { seen_up_to: target.seenUpTo })
      .then(() => {
        // Live badge update, not just a reload-survives-it guarantee — the row
        // for this chat reads `unread_count` straight from the list query.
        void queryClient.invalidateQueries({ queryKey: ['chats'] });
      })
      .catch(() => {
        // Best-effort: a dropped request just means the badge clears on the
        // next successful heartbeat instead — nothing here worth surfacing.
      });
  };

  useEffect(() => {
    // Switching chats (or losing the open one) sends whatever was still
    // debouncing for the PREVIOUS chat now, instead of dropping it.
    if (pendingRef.current && pendingRef.current.chatId !== chatId) flushRef.current();

    if (!chatId || !seenUpTo) return;

    pendingRef.current = { chatId, seenUpTo };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), 1_000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [chatId, seenUpTo]);

  useEffect(() => () => flushRef.current(), []);
}

/**
 * A fresh identity for one outgoing message.
 *
 * Minted where the message is *composed*, not where it is posted: every attempt
 * at the same message has to carry the same key, or the retry the agent presses
 * would be a second message rather than a replay of the first.
 */
export function newIdempotencyKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useSendMessage(chatId: string | null) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const agent = useAuth((s) => s.agent);

  // The optimistic transcript update, through the one shared helper every other
  // optimistic mutation uses: append the pending message now, roll the whole
  // list back if the send fails, reconcile with the server once settled
  // (FR-EK-A.2). The chat list shows last-message and time, so it settles too.
  const optimistic = optimisticCacheUpdate<TranscriptCache, SendInput>({
    queryClient,
    queryKey: eventsKey(chatId ?? ''),
    update: (current, input) => {
      const pending: ChatEvent = {
        // An agent who sees nothing happen presses enter again — show the
        // message immediately, marked pending until the server confirms it.
        id: `pending-${Date.now()}`,
        chat_id: chatId ?? '',
        thread_id: '',
        type: 'message',
        text: input.text,
        author_id: agent?.account_id ?? null,
        author_type: 'agent',
        recipients: input.recipients,
        attachment_url: input.attachmentUrl ?? null,
        properties: { pending: true },
        created_at: new Date().toISOString(),
      };
      // Sending into a transcript that has not loaded yet is the one case with
      // no page to prepend to; a bare first page keeps the guess visible, and
      // `onSettled` replaces it with what the server actually has.
      return current && current.pages.length > 0
        ? prependToNewestPage(current, pending)
        : { pages: [{ items: [pending] }], pageParams: [undefined] };
    },
    invalidateKeys: [['chats']],
  });

  return useMutation({
    mutationFn: (input: SendInput) =>
      api.post<ChatEvent>(`/chats/${chatId}/events`, {
        type: 'message',
        text: input.text,
        recipients: input.recipients,
        ...(input.attachmentUrl ? { attachment_url: input.attachmentUrl } : {}),
        // Survives a retry after a timeout without sending twice — the key
        // travels with the input, so the retry replays this message instead of
        // posting a second one (`types.ts` · `SendInput`).
        idempotency_key: input.idempotencyKey,
      }),
    onMutate: (input) => {
      // One representation per message at a time. While this attempt is in
      // flight the transcript shows the optimistic "Sending…" bubble, so the
      // failed row for the same key steps aside; `onError` puts it back.
      if (chatId) useFailedSendStore.getState().clear(chatId, input.idempotencyKey);
      // No open chat means no transcript to touch; skip straight to the request.
      return chatId ? optimistic.onMutate(input) : Promise.resolve({ previous: undefined });
    },
    onError: (error, input, context) => {
      optimistic.onError(error, input, context);
      // The rollback above takes the guess back out of the transcript, which is
      // right — the server does not have this message. What it must not do is
      // lose it: the attempt reappears as a failed row that carries the text,
      // the reason, and the retry (FR-MOD-02.3.3 · FR-MOD-02.3.6).
      if (chatId) useFailedSendStore.getState().record(chatId, input, error);
    },
    onSettled: optimistic.onSettled,
  });
}

export function useChatAction(chatId: string | null) {
  const api = useApiClient();
  const queryClient = useQueryClient();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['chats'] });
    void queryClient.invalidateQueries({ queryKey: ['chat', chatId] });
    if (chatId) void queryClient.invalidateQueries({ queryKey: eventsKey(chatId) });
  };

  return {
    archive: useMutation({
      mutationFn: () => api.post(`/chats/${chatId}/deactivate`),
      onSuccess: invalidate,
    }),
    reopen: useMutation({
      mutationFn: () => api.post(`/chats/${chatId}/resume`),
      onSuccess: invalidate,
    }),
    tag: useMutation({
      mutationFn: (tag: string) => api.post(`/chats/${chatId}/tags`, { tag }),
      onSuccess: invalidate,
    }),
    untag: useMutation({
      mutationFn: (tag: string) => api.delete(`/chats/${chatId}/tags/${encodeURIComponent(tag)}`),
      onSuccess: invalidate,
    }),
    // Supervisor seizure (FR-MOD-08.6.3) — role-gated at the route; this mutation
    // just calls it. A losing race surfaces as `takeover_conflict` (409) on
    // `.error`, left for the caller to render rather than swallowed here.
    takeover: useMutation({
      mutationFn: (reason?: string) =>
        api.post(`/chats/${chatId}/takeover`, reason ? { reason } : undefined),
      onSuccess: invalidate,
    }),
  };
}

/**
 * How many components are currently holding the socket open.
 *
 * There must be exactly one. Two connections mean the gateway delivers every
 * push twice, which `applyPush` absorbs (it de-duplicates events by id) but
 * `useNotifications` does not — the agent hears two chimes and counts two
 * unread for one message. The counter exists so that regression announces
 * itself instead of being noticed as "the sound is weird sometimes".
 *
 * A module-level number rather than a ref: the point is to see *across*
 * components, which is exactly what a ref cannot do. React's StrictMode
 * double-invoke runs setup → cleanup → setup for one component, so it moves
 * this 1 → 0 → 1 and never trips the check.
 */
let realtimeOwners = 0;

/**
 * Opens the realtime connection and folds pushes into the query cache.
 *
 * Kept in one place so there is a single definition of "a new event arrived",
 * whether it came from a push, a reconnect replay, or a refetch.
 *
 * **Mounted exactly once, by the shell** (`components/AppShell.tsx` ·
 * `RealtimeOwner`). It used to be mounted by `InboxPage`, which tied the
 * socket's lifetime to one route: an agent who opened Reports closed their
 * connection and stopped being notified of anything until they navigated back
 * (FR-MOD-13.8 · FR-EK-C.1). The shell outlives every route change under
 * `/app`, so the connection is opened once per session instead of once per
 * visit to the inbox — no reconnect storm as somebody moves around the app.
 *
 * Nothing had to change about how pushes reach the inbox: they land in the
 * app-wide React Query cache (`applyPush`) and in the typing/conflict stores,
 * all of which sit above the router already. Only the connection *status*
 * needed a new channel, and that is `lib/realtime-status.ts`.
 */
export function useRealtime(onPush?: PushHandler): void {
  const queryClient = useQueryClient();
  const accessToken = useAuth((s) => s.accessToken);
  const organizationId = useAuth((s) => s.agent?.organization_id);
  const clientRef = useRef<RtmClient | null>(null);

  // Held in a ref so a new callback identity each render does not tear down and
  // rebuild the socket — the connection outlives any one render.
  const onPushRef = useRef(onPush);
  onPushRef.current = onPush;

  useEffect(() => {
    if (!accessToken || !organizationId) return;

    realtimeOwners += 1;
    if (realtimeOwners > 1) {
      console.error(
        `useRealtime is mounted ${realtimeOwners} times. The shell (AppShell → RealtimeOwner) ` +
          'owns the socket; a second mount opens a second connection and notifies twice.',
      );
    }

    const client = new RtmClient({
      url: RTM_URL,
      organizationId,
      getToken: () => accessToken,
      pushes: [
        'incoming_chat',
        'incoming_event',
        'chat_deactivated',
        'chat_transferred',
        'routing_status_set',
        'incoming_typing_indicator',
        'incoming_sneak_peek',
        'agent_conflict_warning',
      ],
      onStatusChange: setRealtimeStatus,
      onPush: (action, payload) => {
        applyPush(queryClient, action, payload);
        onPushRef.current?.(action, payload);
      },
    });

    clientRef.current = client;
    // The composer sends the agent's own typing through this; wired here because
    // the socket outlives any one component that wants to emit.
    useTypingStore.getState().setEmitter((chatId, isTyping) => client.sendTyping(chatId, isTyping));
    client.connect();
    return () => {
      realtimeOwners -= 1;
      useTypingStore.getState().setEmitter(() => {});
      client.disconnect();
    };
  }, [accessToken, organizationId, queryClient]);
}

/** Exported for `useInbox.test.ts` — a push handler has no other way in. */
export function applyPush(
  queryClient: QueryClient,
  action: string,
  payload: Record<string, unknown>,
): void {
  switch (action) {
    case 'incoming_event': {
      const chatId = payload['chat_id'];
      const event = payload['event'] as ChatEvent | undefined;
      if (typeof chatId !== 'string' || !event) return;

      // A message from the visitor is the end of the draft it was previewing —
      // drop the sneak-peek so the real message is not shadowed by a stale one.
      if (event.author_type === 'customer') useTypingStore.getState().clear(chatId);

      queryClient.setQueryData<TranscriptCache>(eventsKey(chatId), (cache) => {
        if (!cache || cache.pages.length === 0) return cache;
        const head = cache.pages[0]!;
        // Deduplicate by id: a push and a refetch can both deliver the same
        // event, and the optimistic placeholder is replaced by its real one.
        // The newest page is the only one either could land on — an event that
        // exists now is newer than every cursor the pages above were cut at.
        if (head.items.some((e) => e.id === event.id)) return cache;
        const withoutPending = head.items.filter(
          (e) => !(e.properties?.['pending'] === true && e.text === event.text),
        );
        return {
          ...cache,
          pages: [{ ...head, items: [event, ...withoutPending] }, ...cache.pages.slice(1)],
        };
      });

      // The list row for this chat, on whichever page it sits — the point of
      // searching every page rather than invalidating: a conversation the agent
      // scrolled down to is as live as one at the top, and refreshing it costs
      // nothing because the push already carries what changed.
      //
      // Writing `last_event` is also what re-orders the list: it *is* the sort
      // key the client reads (`chatActivityAt`), so the row carries its new
      // position with it and `patchChatInPages` only has to put it at the end
      // the sort calls for.
      //
      // `unread_count` is the server's own rule (`countUnread`): a flag, not a
      // running count — 1 while the newest event is newer than this agent's
      // seen marker, 0 once it is not. An event that just arrived is always
      // newer, and `useMarkSeen` is what puts it back to 0.
      const found = patchChatInPages(queryClient, chatId, (chat) => ({
        ...chat,
        last_event: event,
        unread_count: 1,
      }));
      if (!found) refreshChatHeads();
      return;
    }

    case 'incoming_typing_indicator': {
      // The visitor's on/off state (FR-MOD-02.9). Agent-authored indicators are
      // the agent's own reflection; only a visitor's is worth showing here.
      const chatId = payload['chat_id'];
      const indicator = payload['typing_indicator'] as
        { is_typing?: unknown; author_type?: unknown } | undefined;
      if (typeof chatId !== 'string' || !indicator) return;
      if (indicator.author_type !== 'customer') return;
      useTypingStore.getState().noteCustomer(chatId, indicator.is_typing === true, null);
      return;
    }

    case 'incoming_sneak_peek': {
      // A preview of the visitor's in-progress message (FR-MOD-11.8).
      const chatId = payload['chat_id'];
      const peek = payload['sneak_peek'] as { text?: unknown; author_type?: unknown } | undefined;
      if (typeof chatId !== 'string' || !peek) return;
      if (peek.author_type !== 'customer') return;
      useTypingStore
        .getState()
        .noteCustomer(chatId, true, typeof peek.text === 'string' ? peek.text : null);
      return;
    }

    case 'agent_conflict_warning': {
      // Two or more agents composing a reply at once (FR-MOD-08.6.3). Same
      // pattern as `incoming_typing_indicator`: validate the payload, then
      // hand it to the store — no query cache involved.
      const chatId = payload['chat_id'];
      const rawAgents = payload['agents'];
      const detectedAt = payload['detected_at'];
      if (
        typeof chatId !== 'string' ||
        !Array.isArray(rawAgents) ||
        typeof detectedAt !== 'string'
      ) {
        return;
      }
      const agents: ConflictAgent[] = [];
      for (const entry of rawAgents) {
        const record = entry as Record<string, unknown> | null;
        const agentId = record?.['agent_id'];
        const since = record?.['since'];
        // One malformed member makes the whole warning untrustworthy — drop it
        // rather than show a conflict with a blank agent in it.
        if (typeof agentId !== 'string' || typeof since !== 'string') return;
        agents.push({ agentId, since });
      }
      useConflictStore.getState().note(chatId, agents, detectedAt);
      return;
    }

    case 'routing_status_set': {
      // Presence (FR-MOD-01.1.4). This action has been subscribed to since the
      // socket existed and until now landed in `default:` — nothing consumed
      // it. The shell's avatar group reads the licence roster from the shared
      // `['agents']` key, so folding the push into that cache is the whole of
      // what makes presence live; no new RTM action was opened for it.
      //
      // Written in place rather than invalidated: the push already carries the
      // new value, and a refetch would spend a request to learn what it just
      // said — on every teammate's screen, every time anyone flips their
      // availability.
      const agentId = payload['agent_id'];
      const status = payload['status'];
      if (typeof agentId !== 'string' || typeof status !== 'string') return;
      if (!(ROUTING_STATUSES as readonly string[]).includes(status)) return;

      queryClient.setQueryData<{ items: Array<{ id: string; routing_status: string }> }>(
        ['agents'],
        (current) =>
          current && {
            items: current.items.map((agent) =>
              agent.id === agentId ? { ...agent, routing_status: status } : agent,
            ),
          },
      );
      return;
    }

    case 'chat_deactivated':
      // A closed conversation cannot still be "typing" — or conflicted.
      if (typeof payload['chat_id'] === 'string') {
        useTypingStore.getState().clear(payload['chat_id']);
        useConflictStore.getState().clear(payload['chat_id']);
      }
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      return;

    case 'incoming_chat':
      // A conversation that started just now is the newest row there is, so it
      // can only land at the top of page 1 — re-reading that page is the whole
      // update (`mergeChatHead`). The pages already scrolled past are keyed on
      // `created_at`, which does not move, so they cannot slide underneath it.
      refreshChatHeads();
      return;

    case 'chat_transferred':
    case 'chat_unfollowed':
    case 'chat_appeared':
      // These can move a chat into or out of a view at any depth, and the push
      // does not say where — the loaded chain is re-read in full. Correct
      // rather than cheap, and rare enough to afford it: the keyset cursors
      // re-stitch from the fresh pages, so no row is skipped or repeated.
      void queryClient.invalidateQueries({ queryKey: ['chats'] });
      return;

    case 'sync_truncated': {
      // The gap was too large to replay; refetch rather than showing a
      // transcript with an invisible hole in it.
      const chatId = payload['chat_id'];
      if (typeof chatId === 'string') {
        void queryClient.invalidateQueries({ queryKey: eventsKey(chatId) });
      }
      return;
    }

    default:
      return;
  }
}

/** Live per-view counts for the sidebar. */
export function useViewCounts(): Record<InboxView, number | undefined> {
  const all = useChatList('all');
  const mine = useChatList('my');
  const queued = useChatList('queued');
  const unassigned = useChatList('unassigned');
  // The conversations this agent is watching without owning (PRD 02.1.1). Its
  // count comes from the same place as every other view's — the server `total`
  // on the same list request — because the PRD asks for one live counter per
  // rail item, not for a second mechanism beside it.
  const supervised = useChatList('supervised');
  const archived = useChatList('archived');
  // The AI Agents group (PRD 02.1.2): AI-handled conversations, kept out of the
  // human queue, and the AI resolutions ("Solved") counter.
  const ai = useChatList('ai');
  const aiSolved = useChatList('ai_solved');

  // Read straight through rather than memoised: the counts are consumed as
  // plain numbers by the rail buttons, so a stable object identity buys
  // nothing, and every paged result is a fresh object each render anyway.
  //
  // Each list's `total` — the server's count of the whole view — which is
  // `undefined` until its first page lands, so an unloaded view does not read
  // as an empty one.
  //
  // This used to be `items.length`: the rows this browser happened to have
  // fetched, which is one page (`CHAT_PAGE_SIZE`, 50) until somebody scrolls.
  // That reads as a total and is not one — the moment a workspace resolves its
  // 51st conversation "Solved" says 50, keeps saying 50, and nothing on screen
  // suggests it is wrong. The AI-resolution counter is the sharp end of it,
  // being ADR-09's number and therefore the invoice's, but every view in the
  // rail shared the ceiling, so they all read `total` now.
  //
  // It costs no extra request: `total` arrives on the same response as the
  // rows, and `mergeChatHead` carries the freshest one through a live refresh.
  return {
    all: all.total,
    my: mine.total,
    queued: queued.total,
    unassigned: unassigned.total,
    supervised: supervised.total,
    archived: archived.total,
    ai: ai.total,
    ai_solved: aiSolved.total,
  };
}

/** One connected channel, as the `/channels` list reports it (FR-MOD-08.5.4-.6). */
export interface ConnectedChannel {
  type: string;
  status: string;
  address: string | null;
  connected: boolean;
  created_at: string;
}

/**
 * The workspace's connected channels, for the inbox Views group (FR-MOD-02.1.4).
 * Gated on `enabled`: only owners/admins hold the `channels--all` scope, so the
 * inbox passes `false` for an ordinary agent and the request never fires (it
 * would only 403). Channel connections change rarely, so this is cached longer
 * than the live chat lists.
 */
export function useConnectedChannels(enabled: boolean) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['channels'],
    queryFn: () => api.get<{ items: ConnectedChannel[] }>('/channels'),
    enabled,
    staleTime: 60_000,
  });
}
