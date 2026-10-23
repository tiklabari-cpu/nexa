import type { AiHandoffCardView, CustomFieldValue, ThreadPriority } from '@siyahtus/types';

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

/**
 * One outgoing message, as the composer hands it to the send mutation.
 *
 * The idempotency key is part of the input rather than something the mutation
 * mints for itself, because a retry has to replay *this* message: the server
 * answers a repeat of a key it has already seen with the event it created the
 * first time, so the same key is what stands between "try again" and two
 * messages in the customer's transcript (`FR-MOD-02.3.6`).
 */
export interface SendInput {
  text: string;
  recipients: 'all' | 'agents';
  attachmentUrl?: string;
  idempotencyKey: string;
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
  /**
   * The team whose queue the newest connection waits in (AU-01); null when it
   * waits in none. Optional: fixtures and older servers omit it.
   */
  queue_group_id?: number | null;
  /** How pressing the newest connection is (ADR-08a); omitted by older servers. */
  priority?: ThreadPriority;
  unread_count: number;
  /** The day's connections (ID-02); absent from a server that predates them. */
  connection_count?: number;
  last_event: ChatEvent | null;
  tags: string[];
}

/** How a connection came to exist (ID-02); null on one opened before the daily model. */
export type ConnectionOpenedVia =
  'first_of_day' | 'same_day_return' | 'agent_start' | 'agent_reopen' | 'day_rollover';

/**
 * One connection of a chat's day, as `Chat.connections` lists it (ID-02) —
 * the code's `thread`, the panel's `ids.chat`.
 */
export interface ChatConnection {
  id: string;
  active: boolean;
  created_at: string;
  closed_at: string | null;
  assignee_id: string | null;
  opened_via: ConnectionOpenedVia | null;
  group_id: number | null;
}

/** The customer's most recent visit, projected onto the chat (FR-MOD-02.4). */
export interface ChatVisitor {
  visited_pages: Array<{ url: string; at?: string }>;
  visit_info: {
    device: string | null;
    referrer: string | null;
    duration_seconds: number | null;
    ip: string | null;
    /** Where the visit came from (tm 330): resolved once at its start, no map. */
    country_code: string | null;
    city: string | null;
    /** Still open, so `duration_seconds` may be ticked forward (`visitDuration.ts`). */
    ongoing: boolean;
  };
}

/** Who answers a connection (`Thread.ai_mode`, AI-11). */
export type AiMode = 'ai' | 'human' | 'paused';

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
    /**
     * Who answers the connection (AI-11): the AI, a person, or the AI held
     * back; null until anyone takes part. Optional: fixtures and older
     * servers omit it.
     */
    ai_mode?: AiMode | null;
    /** Whether the AI ever answered in the connection — on the single-chat read only. */
    ai_took_part?: boolean;
    tags: string[];
  } | null;
  /** The conversation day (`YYYY-MM-DD`) this chat is filed under; null before ID-02. */
  local_day?: string | null;
  /**
   * The day's connections, oldest first; only the newest for a chat with no
   * `local_day`. Optional because fixtures and older servers omit it.
   */
  connections?: ChatConnection[];
  /** Present only on the agent's fetch of a single chat; null when unrecorded. */
  visitor?: ChatVisitor | null;
  /**
   * The newest card the AI wrote when it handed this chat to a person (AI-10),
   * on the single-chat read only; null when it handed nothing over.
   */
  latest_ai_handoff?: AiHandoffCardView | null;
}

/** `POST /chats/{id}/transfer`'s answer (IN-04): the chat, and what became of it. */
export interface ChatTransferResult extends ChatDetail {
  /** Someone has it, or it waits in the receiving team's queue. */
  outcome: 'assigned' | 'queued';
  /** False once a team hand-off took it out of the caller's sight. */
  visible_to_caller: boolean;
}

/** Where a hand-off goes: one teammate, or a team, and what the receiver should know. */
export type TransferTarget = ({ agent_id: string } | { group_id: number }) & { note?: string };

export type InboxView =
  'all' | 'my' | 'queued' | 'unassigned' | 'supervised' | 'archived' | 'ai' | 'ai_solved';

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
  /** The customer left an address; true when `customer_email` is masked (tm 325.6). */
  customer_has_email?: boolean;
  source_chat_id: string | null;
  /** The connection it was opened from (`threads.id`); null off a chat and on older tickets. */
  source_thread_id?: string | null;
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
  /** Custom fields defined for tickets, with this ticket's values (FR-MOD-08.7.6). */
  custom_fields: CustomFieldValue[];
}
