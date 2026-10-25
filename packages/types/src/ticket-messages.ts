/**
 * A ticket's conversation — replies, internal notes and what the player wrote
 * (SiyahTuş analysis HD-01 · tm 356).
 *
 * Until tm 356 a ticket held only a subject: an agent could open one, assign it
 * and change its status, but not answer it. `ticket_messages` is the thread
 * underneath it, oldest first, and these are the vocabularies the database
 * CHECKs, the contract and the service share. They live here, not in the api,
 * because the console needs the same words — which kinds draw as a note, which
 * delivery states offer "try again".
 *
 * **An internal note never becomes e-mail.** That is the one promise in this
 * module that is a data-leak boundary rather than a product choice, so the
 * database states it on its own: a note row cannot carry a delivery status, a
 * Message-ID or an In-Reply-To (`ticket_messages_note_not_mailed_check`). A
 * mail path that picked a note up by mistake would have nowhere to write what
 * it did.
 */

/**
 * What a row is.
 *
 * - `customer_message` — the player wrote it (an inbound e-mail, the ticket's
 *   opening text). The only kind that may keep sanitised HTML.
 * - `agent_reply` — an agent answered the player; the only kind that is mailed,
 *   so the only kind with a `delivery_status`.
 * - `internal_note` — for the team only; never mailed, never shown to the
 *   player.
 * - `system` — a line the product wrote (a merge, a status the player's reply
 *   reopened).
 */
export const TICKET_MESSAGE_KINDS = [
  'customer_message',
  'agent_reply',
  'internal_note',
  'system',
] as const;
export type TicketMessageKind = (typeof TICKET_MESSAGE_KINDS)[number];

/**
 * Who wrote a row. `bot` is an AI agent answering a ticket; `author_id` is the
 * account for `agent`, the customer for `customer`, and empty for the other
 * two. A customer message is always the customer's and only theirs.
 */
export const TICKET_MESSAGE_AUTHOR_TYPES = ['customer', 'agent', 'system', 'bot'] as const;
export type TicketMessageAuthorType = (typeof TICKET_MESSAGE_AUTHOR_TYPES)[number];

/**
 * Where an agent reply's e-mail is. Null on every other kind.
 *
 * - `queued` — saved, the mail job has not run yet (it runs after the commit).
 * - `sent` — the mail server accepted it.
 * - `failed` — it refused or could not be reached; the console offers
 *   "couldn't send · try again".
 * - `suppressed` — deliberately not sent: the deployment keeps ticket e-mail
 *   off (owner decision K23 — the pilot opens it with its own setting). The
 *   reply is kept and the thread says why it did not go.
 */
export const TICKET_MESSAGE_DELIVERY_STATUSES = ['queued', 'sent', 'failed', 'suppressed'] as const;
export type TicketMessageDeliveryStatus = (typeof TICKET_MESSAGE_DELIVERY_STATUSES)[number];

/** The two things an agent writes from the composer: a reply to the player, a note to the team. */
export const TICKET_COMPOSER_KINDS = ['reply', 'note'] as const;
export type TicketComposerKind = (typeof TICKET_COMPOSER_KINDS)[number];

/** The statuses "send and …" may move a ticket to in the same request. */
export const TICKET_REPLY_SET_STATUSES = ['pending', 'solved'] as const;
export type TicketReplySetStatus = (typeof TICKET_REPLY_SET_STATUSES)[number];

/**
 * The longest reply or note, in characters. Twenty thousand — about eight
 * pages, far more than an answer needs and well under what a mail server takes.
 * An inbound e-mail is not held to it: what the player sent is stored as sent.
 */
export const TICKET_MESSAGE_TEXT_MAX = 20_000;

/** How many uploaded files one reply or note may carry. */
export const TICKET_MESSAGE_ATTACHMENTS_MAX = 10;

/**
 * An attachment's virus-scan verdict, as stored on the message. `pending` until
 * the scanner has run; only a `clean` file is offered for download and mailed.
 */
export const TICKET_ATTACHMENT_SCAN_STATUSES = ['pending', 'clean', 'infected'] as const;
export type TicketAttachmentScanStatus = (typeof TICKET_ATTACHMENT_SCAN_STATUSES)[number];

/** One file on a message — the `attachments` jsonb holds an array of these. */
export interface TicketMessageAttachment {
  /** The upload's storage key (`<licence>/<uuid><ext>`, `POST /uploads`). */
  key: string;
  name: string;
  size: number;
  mime: string;
  scan_status: TicketAttachmentScanStatus;
  /** Marked sensitive (an ID document, a bank statement): hidden behind a click. */
  sensitive: boolean;
}

/** A page of the thread, oldest first. */
export const TICKET_MESSAGE_PAGE_SIZE = 50;

/**
 * A message landed on a ticket (`RTM_PUSH_ACTIONS` `ticket_message_created`,
 * tm 356.2): to the ticket's assignee, its followers and its team.
 *
 * Ids only, never the text. Following is passive and nobody re-checks a
 * follower against the ticket's visibility, and a team audience also reaches
 * every unrestricted connection in the workspace — a body in this push would
 * hand an internal note to whoever happens to be listening. The console
 * refetches the thread (`GET /tickets/{ticketId}/messages`), which is where
 * visibility is decided.
 *
 * `ticket_id` is the thread the message reads in: a player's message on a
 * merged ticket lands on its primary.
 */
export interface TicketMessageCreatedPush {
  ticket_id: string;
  message_id: string;
  kind: TicketMessageKind;
  author_type: TicketMessageAuthorType;
  author_id: string | null;
  created_at: string;
}
