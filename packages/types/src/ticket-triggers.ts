/**
 * What a rated chat and a ticket's life say outside the panel (AU-03 · tm 374).
 *
 * Five webhook deliveries join the vocabulary (`WEBHOOK_ACTIONS`,
 * `apps/api/src/services/webhooks/webhook-service.ts`, and
 * `INTEGRATION_TRIGGERS`): `chat_rated`, `ticket_updated`,
 * `ticket_status_changed`, `ticket_assigned` and `ticket_message_added`. Each
 * is announced after its transaction committed and carries ids and the fields
 * the event is about — the minimum a subscriber needs to act and come back for
 * more over the API. No message text leaves: a ticket message is announced by
 * its id, kind and author type; a rating's comment is the one exception the
 * brief asks for, and it leaves masked (AI-26), as it is stored.
 *
 * The bad-rating automation (05 AU-03 karar 1) lives here too: what a "bad"
 * vote sets off, per brand (`inbox_settings.bad_rating_actions`).
 */
import type { RatingValue, TicketStatus } from './domain.js';
import type { TicketMessageAuthorType, TicketMessageKind } from './ticket-messages.js';

/** `chat_rated`: the player judged a connection — a new vote, or one changed. */
export interface ChatRatedSignal {
  rating_id: string;
  chat_id: string;
  thread_id: string;
  value: RatingValue;
  /** The comment sent with the vote, masked as stored; null without one. */
  comment: string | null;
  customer_id: string;
  /** The team the connection belonged to, when it had one. */
  group_id: number | null;
  rated_at: string;
}

/** The ticket fields a `ticket_updated` reports as moved. */
export const TICKET_CHANGE_FIELDS = [
  'subject',
  'status',
  'priority',
  'assignee_id',
  'group_id',
] as const;
export type TicketChangeField = (typeof TICKET_CHANGE_FIELDS)[number];

/** `ticket_updated`: a person changed the ticket; the rules' own changes included. */
export interface TicketUpdatedSignal {
  ticket_id: string;
  /** What moved, in `TICKET_CHANGE_FIELDS` order. Never empty. */
  changed: TicketChangeField[];
  status: TicketStatus;
  priority: number;
  assignee_id: string | null;
  group_id: number | null;
  updated_at: string;
}

/** `ticket_status_changed`: the status moved from one value to another. */
export interface TicketStatusChangedSignal {
  ticket_id: string;
  from: TicketStatus;
  to: TicketStatus;
  changed_at: string;
}

/** `ticket_assigned`: who works the ticket changed — the person, the team, or both. */
export interface TicketAssignedSignal {
  ticket_id: string;
  assignee_id: string | null;
  group_id: number | null;
  previous_assignee_id: string | null;
  previous_group_id: number | null;
  assigned_at: string;
}

/** `ticket_message_added`: a reply, a note or the player's message landed. No text. */
export interface TicketMessageAddedSignal {
  ticket_id: string;
  message_id: string;
  kind: TicketMessageKind;
  author_type: TicketMessageAuthorType;
  created_at: string;
}

// --- The bad-rating automation (05 AU-03 karar 1) ---------------------------

/**
 * What a bad vote sets off, per brand. The defaults are the decision's: the
 * team's leads hear of it in the panel and the connection goes to the AI QA
 * queue (AI-24) — the latter only when the AI took part, the queue being the
 * AI's. Opening a follow-up ticket is off unless chosen; the webhook needs no
 * switch here — subscribing to `chat_rated` is the choice.
 */
export interface BadRatingActions {
  notify_team_leads: boolean;
  add_to_qa_queue: boolean;
  open_ticket: boolean;
}

export const DEFAULT_BAD_RATING_ACTIONS: BadRatingActions = Object.freeze({
  notify_team_leads: true,
  add_to_qa_queue: true,
  open_ticket: false,
});

/**
 * A stored or sent value as a whole `BadRatingActions`: a key missing or not a
 * boolean reads as its default, so a row written before a switch existed acts
 * as the decision says rather than as "off".
 */
export function readBadRatingActions(raw: unknown): BadRatingActions {
  const value = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const pick = (key: keyof BadRatingActions): boolean =>
    typeof value[key] === 'boolean' ? (value[key] as boolean) : DEFAULT_BAD_RATING_ACTIONS[key];
  return {
    notify_team_leads: pick('notify_team_leads'),
    add_to_qa_queue: pick('add_to_qa_queue'),
    open_ticket: pick('open_ticket'),
  };
}

/**
 * `chat_bad_rating_alert` (RTM push): to the leads of the connection's team —
 * or, a team nobody leads, the admins and up — when the player voted it bad.
 * Ids only, like `chat_rated`; the reader opens the chat to see the comment.
 */
export interface ChatBadRatingAlertPush {
  chat_id: string;
  thread_id: string;
  rating_id: string;
  group_id: number | null;
  /** The follow-up ticket the automation opened, when it opened one. */
  ticket_id: string | null;
}
