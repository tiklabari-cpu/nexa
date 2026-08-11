/**
 * Real-time inbox tabs — All / Chatting / Queued / Waiting (FR-MOD-03.1.1).
 *
 * These segment the *loaded* conversation list rather than fetching a fourth
 * time: the list is already kept live by the realtime layer (a push invalidates
 * `['chats']`), so deriving the buckets from it means the tab counts move the
 * instant a chat is answered, queued, or transferred — no extra socket state to
 * drift out of sync with the rows the agent is looking at.
 *
 * Pure functions on purpose. The bucketing is where the subtle bugs live (a
 * chat counted in two tabs, or in none), so it is tested in isolation rather
 * than through the rendered list.
 */
import type { ChatSummary, TrafficTab } from './types.js';

export const TRAFFIC_TABS: Array<{ id: TrafficTab; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'chatting', label: 'Chatting' },
  { id: 'queued', label: 'Queued' },
  { id: 'waiting', label: 'Waiting' },
];

/**
 * Whether a chat belongs in a tab.
 *
 * `all` overlaps everything by design — it is the whole list. The other three
 * are mutually exclusive, evaluated most-specific first, so a chat lands in
 * exactly one and the counts sum to the number of active chats:
 *   - queued    — still in the routing queue, no agent yet.
 *   - waiting   — the customer's last message is unanswered (waiting for reply).
 *   - chatting  — an agent is engaged and the ball is not in their court.
 */
export function matchesTrafficTab(chat: ChatSummary, tab: TrafficTab): boolean {
  switch (tab) {
    case 'all':
      return true;
    case 'queued':
      return chat.queue_position !== null;
    case 'waiting':
      return (
        chat.active && chat.queue_position === null && chat.last_event?.author_type === 'customer'
      );
    case 'chatting':
      return (
        chat.active && chat.queue_position === null && chat.last_event?.author_type !== 'customer'
      );
  }
}

export function filterByTrafficTab(chats: ChatSummary[], tab: TrafficTab): ChatSummary[] {
  return tab === 'all' ? chats : chats.filter((chat) => matchesTrafficTab(chat, tab));
}

/** Live per-tab counts derived from the loaded list. */
export function trafficTabCounts(chats: ChatSummary[]): Record<TrafficTab, number> {
  return {
    all: chats.length,
    chatting: chats.filter((chat) => matchesTrafficTab(chat, 'chatting')).length,
    queued: chats.filter((chat) => matchesTrafficTab(chat, 'queued')).length,
    waiting: chats.filter((chat) => matchesTrafficTab(chat, 'waiting')).length,
  };
}
