export interface ChatEvent {
  id: string;
  chat_id: string;
  thread_id: string;
  type: 'message' | 'system_message' | 'rich_message' | 'file' | 'filled_form';
  text: string | null;
  author_id: string | null;
  author_type: 'agent' | 'customer' | 'bot' | 'system';
  recipients: 'all' | 'agents';
  attachment_url: string | null;
  properties: Record<string, unknown>;
  created_at: string;
}

export interface ChatSummary {
  id: string;
  customer_id: string;
  customer_name: string | null;
  active: boolean;
  created_at: string;
  thread_id: string | null;
  assignee_id: string | null;
  queue_position: number | null;
  unread_count: number;
  last_event: ChatEvent | null;
  tags: string[];
}

/** The customer's most recent visit, projected onto the chat (FR-MOD-02.4). */
export interface ChatVisitor {
  visited_pages: Array<{ url: string; at?: string }>;
  visit_info: {
    device: string | null;
    referrer: string | null;
    duration_seconds: number | null;
    ip: string | null;
  };
}

export interface ChatDetail {
  id: string;
  license_id: string;
  customer_id: string;
  active: boolean;
  created_at: string;
  access: { group_ids: number[] };
  users: Array<{
    user_id: string;
    user_type: string;
    present: boolean;
    seen_up_to: string | null;
  }>;
  thread: {
    id: string;
    chat_id: string;
    active: boolean;
    assignee_id: string | null;
    queue_position: number | null;
    summary: string | null;
    created_at: string;
    closed_at: string | null;
    tags: string[];
  } | null;
  /** Present only on the agent's fetch of a single chat; null when unrecorded. */
  visitor?: ChatVisitor | null;
}

export type InboxView = 'all' | 'my' | 'queued' | 'unassigned' | 'archived' | 'ai' | 'ai_solved';

/** Real-time list tabs — a live segmentation of the loaded chats (FR-MOD-03.1.1). */
export type TrafficTab = 'all' | 'chatting' | 'queued' | 'waiting';

export interface Agent {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  role: string;
  routing_status: 'accepting_chats' | 'not_accepting_chats' | 'offline';
  concurrent_chats_limit: number;
}

/** Tickets — the asynchronous half of the inbox (PRD FR-MOD-02.1.3). */
export type TicketStatus = 'open' | 'pending' | 'solved' | 'closed' | 'spam';
export type TicketView = 'all' | 'unassigned' | 'my_open' | 'solved';

/**
 * A ticket as it appears in a list (the summary the `/tickets` collection
 * returns). `priority` and `merged_into_id` are HelpDesk fields (FR-MOD-13.6);
 * a merged ticket never appears in a list on its own, so `merged_into_id` is
 * always `null` here — it is meaningful only on {@link TicketDetail}.
 */
export interface Ticket {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: number;
  assignee_id: string | null;
  assignee_name: string | null;
  group_id: number | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  source_chat_id: string | null;
  merged_into_id: string | null;
  last_message_at: string | null;
  created_at: string;
}

/** An agent watching a ticket without owning it (FR-MOD-13.6). */
export interface TicketFollower {
  account_id: string;
  name: string | null;
}

/**
 * The single-ticket view, which carries what a list omits: the originating
 * chat, the followers, and — when this ticket is a merge primary — the ids of
 * the tickets folded into it (FR-MOD-13.6).
 */
export interface TicketDetail extends Ticket {
  source_chat: { id: string; active: boolean; created_at: string } | null;
  followers: TicketFollower[];
  merged_ticket_ids: string[];
}
