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

import type { ChatEvent, EventRecipients, RoutingStatus, TransferReason } from './domain.js';
import type { ErrorType } from './errors.js';

export const RTM_VERSION = '3.6';

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
  // Customers
  'customer_updated',
  'incoming_customers',
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

export interface TypingIndicatorPush {
  chat_id: string;
  thread_id: string;
  typing_indicator: {
    author_id: string;
    recipients: EventRecipients;
    timestamp: number;
    is_typing: boolean;
  };
}

export interface RoutingStatusSetPush {
  agent_id: string;
  status: RoutingStatus;
}

export interface QueuePositionsUpdatedPush {
  positions: Array<{ chat_id: string; thread_id: string; position: number; wait_time: number }>;
}

export interface AgentDisconnectedPush {
  reason: ErrorType;
  details?: Record<string, unknown>;
}
