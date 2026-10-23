/**
 * The player card's read (IN-02 · tm 331.2): `GET /chats/{chatId}/customer-context`.
 *
 * One call answers the card — who the player is, the pre-chat answers, the
 * day's other connections — and the first page of the 90-day history; "Show
 * more" asks for the next page with `page_id`. Every page repeats the card, so
 * the card is read from the first page and the history is every page's items
 * in order.
 *
 * Nothing pushes the card itself (no RTM event of its own): a member back the
 * same day (`incoming_chat`) or a hand-off (`chat_transferred`) re-reads it
 * through {@link customerContextKey} (`useInbox.ts` · `applyPush`).
 */
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query';
import type { ConversationRef, CustomerContext } from '@siyahtus/types';
import { useApiClient } from '../../lib/auth-store.js';

/** The card's cache — every page of one chat's card sits under it. */
export const customerContextKey = (chatId: string) => ['customer-context', chatId] as const;

/** What the card draws: the first page's card, and the history of every page read. */
export interface CustomerContextView {
  context: CustomerContext | null;
  history: ConversationRef[];
  isPending: boolean;
  isError: boolean;
  hasMore: boolean;
  isFetchingMore: boolean;
  fetchMore: () => void;
}

export function useCustomerContext(chatId: string): CustomerContextView {
  const api = useApiClient();
  const query = useInfiniteQuery({
    queryKey: customerContextKey(chatId),
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<CustomerContext>(
        `/chats/${chatId}/customer-context` +
          (pageParam ? `?page_id=${encodeURIComponent(pageParam)}` : ''),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: CustomerContext) => last.history?.next_page_id,
    staleTime: 30_000,
  });
  return {
    ...customerContextOf(query.data),
    isPending: query.isPending,
    isError: query.isError,
    hasMore: query.hasNextPage,
    isFetchingMore: query.isFetchingNextPage,
    fetchMore: () => void query.fetchNextPage(),
  };
}

/**
 * The card from the first page and the history of all of them. A page that is
 * not a card (the read failed into something else) is no card: the panel
 * draws nothing rather than a card of blanks.
 */
export function customerContextOf(
  data: InfiniteData<CustomerContext, unknown> | undefined,
): Pick<CustomerContextView, 'context' | 'history'> {
  const first = data?.pages[0];
  if (!first || typeof first.customer !== 'object' || first.customer === null) {
    return { context: null, history: [] };
  }
  return {
    context: first,
    history: data.pages.flatMap((page) => page.history?.items ?? []),
  };
}

/** How long a connection or a day lasted, in seconds; null while it is open or on a restricted row. */
export function conversationSeconds(
  ref: Pick<ConversationRef, 'started_at' | 'ended_at'>,
): number | null {
  if (!ref.ended_at) return null;
  const seconds = (Date.parse(ref.ended_at) - Date.parse(ref.started_at)) / 1000;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * What a card field shows: the value, "—" when the player gave none, and
 * "hidden" when the caller may not see the player's contact details
 * (`contact_visible: false`, RL-02-S2) — the server sends null either way.
 */
export function contactField(
  value: string | null,
  contactVisible: boolean,
): { kind: 'value'; value: string } | { kind: 'hidden' } | { kind: 'missing' } {
  if (!contactVisible) return { kind: 'hidden' };
  return value ? { kind: 'value', value } : { kind: 'missing' };
}
