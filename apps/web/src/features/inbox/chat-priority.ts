/**
 * The chat list's priority filter (AI-12 · tm 307.3) — "Urgent" / "High" only.
 *
 * Like the channel and the team tab, the server narrows (`GET /chats?priority=`),
 * not a slice of the rows already loaded: a client-side filter would cut one
 * page of fifty and keep asking for the next page of everything, so a busy
 * workspace's urgent list would be mostly empty and its counter wrong. And it
 * is the list's ordering too — the list keeps the server's keyset order
 * (`chat-sort.ts`), which a priority-first sort could not honour across pages,
 * so an agent who wants the pressing ones asks for them and reads them
 * newest-first. A team's queue is already served most pressing first
 * (`queue_position`).
 *
 * The choice lives in the URL, as the sort does. "Normal" is not offered: it is
 * what most chats are, and not a thing to hunt for.
 */
import type { ThreadPriority } from '@siyahtus/types';

export type ChatPriorityFilter = Exclude<ThreadPriority, 'normal'>;

export const CHAT_PRIORITY_FILTERS: readonly ChatPriorityFilter[] = ['urgent', 'high'];

export const CHAT_PRIORITY_PARAM = 'chat_priority';

/** Tolerates a missing or garbled param — anything but the two literals is "every priority". */
export function parseChatPriority(params: URLSearchParams): ChatPriorityFilter | null {
  const value = params.get(CHAT_PRIORITY_PARAM);
  return CHAT_PRIORITY_FILTERS.find((priority) => priority === value) ?? null;
}

/** A copy of `params` with the filter written in; omitted entirely when it is off. */
export function writeChatPriority(
  params: URLSearchParams,
  priority: ChatPriorityFilter | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (priority === null) next.delete(CHAT_PRIORITY_PARAM);
  else next.set(CHAT_PRIORITY_PARAM, priority);
  return next;
}
