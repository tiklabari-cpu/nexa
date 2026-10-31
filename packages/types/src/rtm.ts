/**
 * RTM (WebSocket) protocol — ADR-15.
 *
 * The envelope is kept byte-compatible with the source platform so any client
 * SDK written against it stays portable, even though the REST surface is
 * resource-based rather than action-based.
 *
 *   client → server : { version, request_id, action, payload }
 *   server → client : { request_id, action, type: 'response', success, payload }
 *                     { action, type: 'push', payload }
 */

import type {
  ChatEvent,
  EventAuthorType,
  EventRecipients,
  RoutingStatus,
  TransferReason,
} from './domain.js';
import type { AiConversationMode, AiModeReason } from './ai-conversation.js';
import type { ErrorType } from './errors.js';

export const RTM_VERSION = '3.6';

/**
 * Where the gateway listens. Shared rather than gateway-local because a client
 * has to dial it: the web app carries the whole URL in an environment variable,
 * but the mobile app is handed only a host (`expo.extra.rtmBaseUrl`) and has to
 * append the path itself — and a path it copied by hand would be a second
 * definition free to drift from the server's.
 */
export const RTM_PATHS = {
  agent: '/v1/agent/rtm/ws',
  customer: '/v1/customer/rtm/ws',
} as const;

/** Connection limits — v2-03 §7.5, deliberately matched. */
export const RTM_LIMITS = {
  /** Socket is closed if `login` does not arrive within this window. */
  loginTimeoutMs: 30_000,
  /** Client ping interval; server closes an idle socket at 2× this. */
  pingIntervalMs: 15_000,
  idleTimeoutMs: 30_000,
  /** In-flight requests per socket → `pending_requests_limit_reached`. */
  maxPendingRequests: 10,
  /** Per-request deadline → `request_timeout`. */
  requestTimeoutMs: 15_000,
} as const;

// --- Client → server --------------------------------------------------------

export const RTM_ACTIONS = [
  'login',
  'logout',
  'ping',
  'subscribe',
  'unsubscribe',
  'sync',
  'send_event',
  'send_typing_indicator',
  'mark_events_as_seen',
  'set_routing_status',
  'start_chat',
  'resume_chat',
  'deactivate_chat',
  'transfer_chat',
] as const;
export type RtmAction = (typeof RTM_ACTIONS)[number];

export interface RtmRequest<P = Record<string, unknown>> {
  version?: string;
  request_id: string;
  action: RtmAction;
  payload: P;
}

export interface RtmLoginPayload {
  /** `Bearer <access_token>` — same shape as the REST Authorization header. */
  token: string;
  timezone?: string;
  reconnect?: boolean;
  away?: boolean;
  customer_monitoring_level?: 'my' | 'chatting' | 'invited' | 'online' | 'highest_available';
  application?: { name?: string; version?: string };
  /** Version-keyed push subscription, e.g. `{ "3.6": ["incoming_chat"] }`. */
  pushes?: Record<string, RtmPushAction[]>;
}

/**
 * Missed-event recovery. The client reports the last event it durably saw per
 * chat; the server replays everything after it. This is what makes reconnect
 * lossless (NFR-R2) — see slice 5.
 */
export interface RtmSyncPayload {
  /** `{ [chat_id]: last_seen_event_id }`. Chats omitted are fully re-sent. */
  cursors: Record<string, string>;
}

export interface RtmSyncResult {
  chats: Array<{
    chat_id: string;
    thread_id: string;
    events: ChatEvent[];
    /**
     * Events at or before the cursor whose text was corrected in place while
     * the client was away (FR-MOD-02.3.7). Replaced by id, never appended, and
     * they do not move the cursor — an edit mints no `event_sequence`, which is
     * exactly why `events` above cannot carry them.
     */
    corrections: ChatEvent[];
    /** True when the gap was too large to replay and a full refetch is needed. */
    truncated: boolean;
  }>;
  /** Chats the agent lost access to while disconnected. */
  removed_chat_ids: string[];
}

// --- Server → client --------------------------------------------------------

export interface RtmResponse<P = unknown> {
  request_id: string;
  action: RtmAction;
  type: 'response';
  success: boolean;
  payload: P;
}

export interface RtmErrorPayload {
  error: {
    type: ErrorType;
    message: string;
    request_id: string;
    details?: Record<string, unknown>;
  };
}

export const RTM_PUSH_ACTIONS = [
  // Chats
  'incoming_chat',
  'chat_deactivated',
  'chat_transferred',
  'chat_taken_over',
  // Who answers a connection changed — the AI, a person, or the AI held back
  // (AI-11 · tm 293.5); agents only.
  'chat_ai_mode_changed',
  'chat_access_updated',
  // The inactivity sweep (WG-03 · tm 340.2): an agent left a connection
  // unanswered and nobody else could take it (`ChatUnansweredAlertPush`), to
  // the team's leads; a connection went quiet or stopped being
  // (`ChatInactivityChangedPush`), to its agents.
  'chat_unanswered_alert',
  'chat_inactivity_changed',
  // The player rated a connection or commented on its rating (AR-03 · WG-11 ·
  // tm 337, `ChatRatedPush`): to the chat's agents and teams. Ids only — what
  // a caller may see of the rating is the server's call (`ratings.view`).
  'chat_rated',
  // The player has read up to a point (IN-05 · tm 362, `CustomerSeenPush`): to
  // the chat's agents, for the "Read · 14:32" line under the last team message.
  'customer_seen',
  'user_added_to_chat',
  'user_removed_from_chat',
  'queue_positions_updated',
  // Events
  'incoming_event',
  'event_updated',
  'events_marked_as_seen',
  // Indicators
  'incoming_typing_indicator',
  'incoming_sneak_peek',
  // Tags & summary
  'thread_tagged',
  'thread_untagged',
  'thread_summary_set',
  // Agents
  'routing_status_set',
  'agent_disconnected',
  'agent_conflict_warning',
  // Customers
  'customer_updated',
  'incoming_customers',
  'traffic_visitor_updated',
  // Workspace notices — a share of today's AI allowance used (tm 283.3), to
  // the owner and the alert's recipients only.
  'ai_usage_alert',
  // A risk flag raised on a conversation or cleared (tm 302.2 · AI-27,
  // `RiskFlagPush`): to its members, the supervisors and, when urgent, the
  // Responsible Gaming team.
  'risk_flag_raised',
  'risk_flag_cleared',
  // The AI's hand-over card was written (tm 304.1 · AI-10, `AiHandoffCreatedPush`):
  // to the agents who see the conversation and the target team.
  'ai_handoff_created',
  // A cluster of unresolved questions surged or came back after its fix (tm
  // 317.2 · AI-22-S2, `AiUnresolvedAlertPush`): to the Team Leads and up.
  'ai_unresolved_alert',
  // A version of the AI configuration went live (tm 316.3 · AI-20,
  // `AiConfigPublishedPush`): to every agent — the Inbox band.
  'ai_config_published',
  // A suggestion reached the AI coaching queue (tm 318.1 · AI-23,
  // `AiSuggestionCreatedPush`): to its reviewers, each with their open count;
  // and how one ended (`AiSuggestionReviewedPush`): to its author.
  'ai_suggestion_created',
  'ai_suggestion_reviewed',
  // A ticket was opened or handed to somebody (tm 367 · IN-10,
  // `IncomingTicketPush`): to its assignee and its team.
  'incoming_ticket',
  // A reply, an internal note or the player's message landed on a ticket (tm
  // 356.2 · HD-01, `TicketMessageCreatedPush`): to its assignee, its followers
  // and its team.
  'ticket_message_created',
  // A reply's e-mail went out, failed, or was queued again (tm 356.3 · HD-01,
  // `TicketMessageDeliveryChangedPush`): same audience.
  'ticket_message_delivery_changed',
  // Errors
  'incoming_error',
] as const;
export type RtmPushAction = (typeof RTM_PUSH_ACTIONS)[number];

export interface RtmPush<P = unknown> {
  action: RtmPushAction;
  type: 'push';
  payload: P;
}

export type RtmServerMessage = RtmResponse | RtmPush;

// --- Push payloads ----------------------------------------------------------

export interface IncomingChatPush {
  requester_id: string | null;
  chat: {
    id: string;
    users: unknown[];
    access: { group_ids: number[] };
    thread: { id: string; active: boolean; queue_position: number | null };
  };
  transferred_from?: { group_ids: number[]; agent_ids: string[] };
}

/**
 * `chat_rated` (AR-03 · WG-11): the player rated connection `thread_id` of
 * chat `chat_id`, or added a comment to its rating. Carries no value: the
 * reader re-reads the chat, whose `thread.rating` is shown or withheld by the
 * reader's `ratings.view`.
 */
export interface ChatRatedPush {
  chat_id: string;
  thread_id: string;
}

/**
 * `customer_seen` (IN-05): the player's read marker on chat `chat_id` moved
 * forward to `seen_up_to` (an ISO time). Sent only when the stored marker
 * actually advanced — a repeat or an older time says nothing — and only to the
 * chat's agents; the player is not told what the other side has read.
 */
export interface CustomerSeenPush {
  chat_id: string;
  thread_id: string | null;
  seen_up_to: string;
}

export interface IncomingEventPush {
  chat_id: string;
  thread_id: string;
  event: ChatEvent;
}

/**
 * A message that was already delivered has been corrected by its author
 * (FR-MOD-02.3.7). The whole event is carried, not a diff, so a reader replaces
 * the one it holds by id rather than patching it.
 *
 * Deliberately NOT a cursor-advancing push: the edited event may be older than
 * anything the reader has seen, and treating it as new would rewind the
 * missed-event cursor onto an id the client already has.
 */
export interface EventUpdatedPush {
  chat_id: string;
  thread_id: string;
  event: ChatEvent;
}

export interface ChatDeactivatedPush {
  chat_id: string;
  thread_id: string;
  requester_id: string | null;
}

/**
 * A conversation was handed to a team or an agent (IN-04). `outcome` says
 * what became of it: someone has it (`assignee_id`), or it waits in the
 * team's queue. `unstaffed` marks a hand-off to the Responsible Gambling team
 * that found nobody free — the one the supervisors are told of as well
 * (IN-04-S1), so they are in this push's audience.
 */
export interface ChatTransferredPush {
  chat_id: string;
  thread_id: string;
  requester_id: string | null;
  reason: TransferReason;
  transferred_to: { group_ids: number[]; agent_ids: string[] };
  queue?: { position: number; wait_time: number; queued_at: string };
  outcome?: ChatTransferOutcome;
  assignee_id?: string | null;
  unstaffed?: boolean;
}

/** What a hand-off came to (`POST /chats/{id}/transfer` · `ChatTransferResult.outcome`). */
export type ChatTransferOutcome = 'assigned' | 'queued';

/**
 * A supervisor forcibly seized a chat from whoever held it (FR-MOD-08.6.3).
 * Sent to the union of the losing and winning audiences: the previous assignee
 * needs to be told the chat left their hands as much as the new owner needs to
 * be told it arrived. `previous_assignee_id` is null when the chat was
 * unassigned (e.g. queued) at the moment of takeover.
 */
export interface ChatTakenOverPush {
  chat_id: string;
  thread_id: string;
  requester_id: string | null;
  previous_assignee_id: string | null;
  new_assignee_id: string;
}

/**
 * Who answers a connection changed (AI-11 · tm 293.5): the AI took its first
 * turn, a person took it over (writing to the player, a takeover, a transfer,
 * the AI's or a rule bot's hand-off), or someone gave it back to the AI or
 * held the AI back. Sent with the agents-only line the change leaves in the
 * transcript, to the same agents — never to the visitor. A connection a person
 * answered before the AI ever spoke in sends nothing: nothing changed that
 * anyone watching it would notice.
 */
export interface ChatAiModeChangedPush {
  chat_id: string;
  /** The connection (panel "Chat ID"). */
  thread_id: string;
  ai_mode: AiConversationMode;
  /** Null when the AI had not taken part until this change. */
  previous_ai_mode: AiConversationMode | null;
  /** An account id, or the bot's id for the AI and rule bots — never a name. */
  by: string;
  /** Null for the AI's own first turn, which needs no reason. */
  reason: AiModeReason | null;
}

/**
 * A connection's one-line summary changed (`threads.summary`) — the AI's
 * hand-over card writes it (tm 304.1 · AI-10 §4). Agents only.
 */
export interface ThreadSummarySetPush {
  chat_id: string;
  thread_id: string;
  summary: string | null;
}

export interface TypingIndicatorPush {
  chat_id: string;
  thread_id: string | null;
  typing_indicator: {
    author_id: string;
    author_type: EventAuthorType;
    recipients: EventRecipients;
    timestamp: number;
    is_typing: boolean;
  };
}

/**
 * A live preview of what the other side is *about* to send — the "sneak-peek"
 * (FR-MOD-11.8). Only ever addressed to agents (`recipients: 'agents'`): the
 * point is that an agent can start composing before the visitor presses enter,
 * and a visitor must never be shown their own draft echoed back. Never
 * persisted — it is superseded on the next keystroke and gone when typing stops.
 */
export interface SneakPeekPush {
  chat_id: string;
  thread_id: string | null;
  sneak_peek: {
    author_id: string;
    author_type: EventAuthorType;
    recipients: EventRecipients;
    timestamp: number;
    text: string;
  };
}

/**
 * Why the system, rather than the agent, changed an agent's routing status
 * (`RoutingStatusSetPush.reason`, WG-03):
 *
 *   - `agent_unresponsive` — the inactivity sweep took a connection the agent
 *     had not answered in time and stopped routing to them (tm 340.2);
 *   - `agent_disconnected` — the agent's last socket closed and none came back
 *     within the gateway's tolerance, so they went offline (tm 340.3).
 */
export const ROUTING_STATUS_CHANGE_REASONS = ['agent_unresponsive', 'agent_disconnected'] as const;
export type RoutingStatusChangeReason = (typeof ROUTING_STATUS_CHANGE_REASONS)[number];

/**
 * How long an agent may have no open socket before the gateway sets them
 * offline (WG-03 · tm 340.3, RP-03's two-minute tolerance): long enough for a
 * reload, a network blip or a laptop lid closed and opened again, short
 * enough that a closed browser stops receiving chats within minutes. The
 * gateway's `RTM_DISCONNECT_OFFLINE_MS` overrides it.
 */
export const DISCONNECT_OFFLINE_DEFAULT_MS = 120_000;

export interface RoutingStatusSetPush {
  agent_id: string;
  status: RoutingStatus;
  /**
   * Set when the system changed it rather than the agent, so their console can
   * say why (`ROUTING_STATUS_CHANGE_REASONS`). Absent on the agent's own change.
   */
  reason?: RoutingStatusChangeReason;
  /**
   * With a `reason`: the window that ran out — the workspace's
   * `unanswered_transfer_seconds` for `agent_unresponsive`, the gateway's
   * tolerance for `agent_disconnected` — so the notice can say "3 minutes"
   * rather than "a while".
   */
  after_seconds?: number;
}

/**
 * Someone on the real-time traffic board moved (FR-MOD-03.1.1).
 *
 * A signal, not a row. The board is a projection over three sources — an active
 * conversation, a pending campaign invitation, a recent visit — merged, filtered
 * and counted by `TrafficService#listLive`, and the funnel bucket a visitor
 * lands in (`browsing` / `queued` / `waiting` / `chatting` / `supervised` /
 * `invited`) is that read's own decision, made from all three at once. Computing
 * the bucket a second time at the publish site would be a second source of truth
 * free to disagree with the row the agent is looking at, so it is deliberately
 * not on the wire: the client re-reads the board's first page through
 * `GET /traffic` and folds the answer in exactly where the 8-second poll folds
 * its own (`mergeTrafficHead`). One merger, two triggers.
 *
 * That also settles two things the payload would otherwise have to carry and
 * could not carry honestly:
 *
 *   - **The tab badges.** They report the server's `total` for the caller's exact
 *     query (activity + every filter condition). A client-side row upsert cannot
 *     move that number correctly, and a stale badge beside a changed row is the
 *     "loaded window mistaken for the real total" defect over again (13.2
 *     M-COUNT-d).
 *   - **The filters.** `country_code`, `is_lead`, `page_url_contains`,
 *     `came_from_contains` and `group_id` are facts the row itself does not
 *     carry, so no client could decide whether a pushed row still belongs on a
 *     filtered board.
 *
 * The audience is every authenticated agent (`allAgents`), which is the reach
 * `GET /traffic` already has: it rides `customers:ro`/`customers:rw`, and
 * `customers:ro` is in `DEFAULT_AGENT_SCOPES`. Nothing about the visitor travels
 * with it — one opaque customer id and no name, e-mail, page or referrer — so a
 * narrowed token that the endpoint would refuse learns nothing from the signal
 * either.
 */
export interface TrafficVisitorUpdatedPush {
  /**
   * Who the change is about. The board does not filter on it — it re-reads —
   * but an event that cannot name its subject cannot be logged, traced or
   * consumed by anything that is not this one screen.
   */
  customer_id: string;
}

export interface QueuePositionsUpdatedPush {
  positions: Array<{ chat_id: string; thread_id: string; position: number; wait_time: number }>;
}

export interface AgentDisconnectedPush {
  reason: ErrorType;
  details?: Record<string, unknown>;
}

/**
 * Two or more agents composing a reply in the same chat at once
 * (FR-MOD-08.6.3). Detection and dispatch are out of scope here — this is only
 * the wire shape the gateway will push once they exist.
 */
export interface AgentConflictWarningPush {
  chat_id: string;
  thread_id: string;
  agents: Array<{ agent_id: string; since: string }>;
  detected_at: string;
}
