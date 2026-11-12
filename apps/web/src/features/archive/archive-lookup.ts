/**
 * The archive bar's direct lookup (ID-06 · tm 468): a number, an e-mail address
 * or a player's name typed into the Archive's search bar finds the conversation
 * or the player at once, above the message text search's own hits.
 *
 * It asks the server's lookup, the one ⌘K uses (`GET /search`,
 * `services/search/lookup.ts`), for the conversation kinds and the member — no
 * new path and no change to the contract. So the rules are that endpoint's:
 * a number is matched exactly (the day's, the connection's, a message's), an address
 * exactly and only for a caller who may see players' contact details, a name
 * through the Contacts search; a conversation the caller may not open produces
 * no row, the same answer as a number that does not exist. The bar's day range
 * narrows the text search only: a number names one record, whenever it was.
 *
 * A player found by address or name is a way to their conversations, so each
 * one found is shown with their newest connections (the Archive list's own
 * `customer_id` filter, `status=all`), and each of those opens in place.
 *
 * Like the text search, the searched value lives in component state only and
 * goes to the API, never into the address bar (GV-05).
 */
import { useQuery } from '@tanstack/react-query';
import {
  searchShape,
  type ArchiveConversationList,
  type SearchKind,
  type SearchResult,
} from '@siyahtus/types';
import { useApiClient } from '../../lib/auth-store.js';

/** What the lookup asks for: the conversation kinds and the member — no tickets here. */
export const ARCHIVE_LOOKUP_KINDS: readonly SearchKind[] = [
  'chat',
  'connection',
  'event',
  'customer',
];

/** Rows the lookup may return (the endpoint's own default). */
export const ARCHIVE_LOOKUP_LIMIT = 10;

/** Players whose conversations are listed under the lookup; more would bury the text hits. */
export const LOOKUP_PLAYERS_SHOWN = 3;

/** Connections listed per player found, newest first. */
export const LOOKUP_PLAYER_CONVERSATIONS = 5;

/** Where a lookup row opens: a connection (and a message in it), or a day by its number. */
export interface LookupTarget {
  chatId: string;
  /** Null for a day found by its own number (`ids.thread`): its newest connection is meant. */
  threadId: string | null;
  eventId: string | null;
}

export function archiveLookupUrl(query: string): string {
  // url-pii-ok: API request, not the address bar; the server log masks `query`
  const params = new URLSearchParams({ query });
  params.set('types', ARCHIVE_LOOKUP_KINDS.join(','));
  params.set('limit', String(ARCHIVE_LOOKUP_LIMIT));
  return `/search?${params.toString()}`;
}

/** One player's newest connections, the Archive list's own read (ids only in it). */
export function playerConversationsUrl(customerId: string): string {
  const params = new URLSearchParams({
    status: 'all',
    customer_id: customerId,
    limit: String(LOOKUP_PLAYER_CONVERSATIONS),
  });
  return `/archive/conversations?${params.toString()}`;
}

/**
 * Whether a value names a record by its shape — a number or an address — and so
 * is worth looking up even when the text search's own rules would refuse it
 * (`a@b.co` holds no three-letter run). A plain word is searched as text first.
 */
export function isDirectLookup(query: string): boolean {
  return searchShape(query) !== 'text';
}

/** The conversation rows of a lookup answer, in the server's order. */
export function lookupConversations(items: readonly SearchResult[]): SearchResult[] {
  return items.filter(
    (item) =>
      (item.kind === 'chat' || item.kind === 'connection' || item.kind === 'event') && item.chat_id,
  );
}

/** The players a lookup found, at most {@link LOOKUP_PLAYERS_SHOWN}. */
export function lookupPlayers(items: readonly SearchResult[]): SearchResult[] {
  return items
    .filter((item) => item.kind === 'customer' && item.customer_id)
    .slice(0, LOOKUP_PLAYERS_SHOWN);
}

/** Where a conversation row of the lookup opens. */
export function lookupTarget(item: SearchResult): LookupTarget {
  return {
    chatId: item.chat_id ?? '',
    threadId: item.thread_id ?? null,
    eventId: item.kind === 'event' ? (item.event_id ?? null) : null,
  };
}

/**
 * The lookup for what the bar holds; idle while `query` is null. Its key is
 * outside the `['chats', …]` namespace for the text search's reason: a live
 * update must not reorder an answer.
 */
export function useArchiveLookup(query: string | null) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['archive-lookup', query ?? ''],
    queryFn: async () =>
      (await api.get<{ items: SearchResult[] }>(archiveLookupUrl(query ?? ''))).items,
    enabled: query !== null,
    staleTime: 30_000,
  });
}

/** One found player's newest connections. */
export function usePlayerConversations(customerId: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: ['archive-lookup', 'player', customerId],
    queryFn: () => api.get<ArchiveConversationList>(playerConversationsUrl(customerId)),
    staleTime: 30_000,
  });
}
