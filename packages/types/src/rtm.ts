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
  'chat_access_updated',
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

export interface ChatTransferredPush {
  chat_id: string;
  thread_id: string;
  requester_id: string | null;
  reason: TransferReason;
  transferred_to: { group_ids: number[]; agent_ids: string[] };
  queue?: { position: number; wait_time: number; queued_at: string };
}

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

export interface RoutingStatusSetPush {
  agent_id: string;
  status: RoutingStatus;
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
