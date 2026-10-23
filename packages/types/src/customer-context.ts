/**
 * The player card's read (IN-02 · tm 331): who the player is, what they said
 * before the chat started, the day's earlier connections and the days before
 * it — one call, `GET /chats/{chatId}/customer-context`.
 *
 * Names follow the identity glossary (ID-01, K1 = A): `chat_id` is the
 * member's day ("Thread ID" in the panel), `thread_id` one connection inside it
 * ("Chat ID").
 *
 * A conversation the caller may not open (another team's, RL-02) stays in the
 * history as a restricted row: when it started and the topic of the team it went to,
 * nothing else (IN-02-S2) — no id, no summary, no tags, no card.
 */
import type { AiConversationOutcome } from './ai-conversation.js';
import type { AiHandoffCardView } from './ai-handoff-card.js';
import type { RatingValue } from './domain.js';
import type { QueueTopicRole } from './team-queues.js';

/** How far back the history reaches (IN-02-S3); "All" opens the archive. */
export const CUSTOMER_CONTEXT_HISTORY_DAYS = 90;

/** History rows per page. */
export const CUSTOMER_CONTEXT_PAGE_SIZE = 20;

/** One answer the player gave before the chat started. */
export interface PreChatAnswer {
  label: string;
  value: string;
}

/** One earlier connection of the day, or one earlier day, as the card lists it. */
export interface ConversationRef {
  /** False: another team's conversation — every field below but `started_at` and `topics` is empty. */
  accessible: boolean;
  /** The day ("Thread ID"); null on a restricted row. */
  chat_id: string | null;
  /** The connection ("Chat ID") — the day's newest on a history row; null on a restricted row. */
  thread_id: string | null;
  started_at: string;
  /** Null while it is still open, and on a restricted row. */
  ended_at: string | null;
  /** Connections the row stands for: 1 for a connection, the day's count for a day. */
  connections_count: number | null;
  /** Who had the (newest) connection. */
  assignee: { id: string; name: string } | null;
  /** The teams its connections went to. */
  teams: Array<{ id: number; name: string }>;
  /** Those teams' queue topics (AU-01) — the one thing a restricted row says about itself. */
  topics: QueueTopicRole[];
  tags: string[];
  /** The connection's written summary — what the card falls back to without a hand-over card. */
  summary: string | null;
  /** How the AI's part ended (AI-02); null when it took no part or nothing is settled. */
  outcome: AiConversationOutcome | null;
  /** The player's rating of it (AR-03), the newest. */
  rating: RatingValue | null;
  /** The AI's hand-over card (AI-10), the newest. */
  ai_handoff: AiHandoffCardView | null;
}

/** `GET /chats/{chatId}/customer-context`. */
export interface CustomerContext {
  chat_id: string;
  customer: {
    id: string;
    name: string | null;
    /** Typed by the player; unverified. Null when not given — or not visible to the caller. */
    username: string | null;
    email: string | null;
    country_code: string | null;
    country: string | null;
    city: string | null;
    banned: boolean;
  };
  /**
   * Whether the caller may see the player's email and username
   * (`customers.contact.view`, RL-02-S2). False: both are null whatever the
   * player gave — the panel says "hidden", not "—".
   */
  contact_visible: boolean;
  pre_chat: PreChatAnswer[];
  /** The day's other connections, the newest 20, newest first. */
  today: ConversationRef[];
  /** Earlier days within {@link CUSTOMER_CONTEXT_HISTORY_DAYS}, newest first, one row each. */
  history: { items: ConversationRef[]; next_page_id?: string };
  /** Restricted days in the whole window, not only this page. */
  restricted_count: number;
}
