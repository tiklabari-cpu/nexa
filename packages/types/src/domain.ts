/**
 * Core domain vocabulary. Every literal union here mirrors a CHECK constraint in
 * the schema (PRD §8.4 / rapor-2 §5.3) — if one changes, the other must too.
 */

// --- Identity & tenancy -----------------------------------------------------

export const AGENT_ROLES = ['owner', 'viceowner', 'admin', 'agent'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const ROUTING_STATUSES = ['accepting_chats', 'not_accepting_chats', 'offline'] as const;
export type RoutingStatus = (typeof ROUTING_STATUSES)[number];

export const GROUP_PRIORITIES = ['primary', 'first', 'normal', 'last'] as const;
export type GroupPriority = (typeof GROUP_PRIORITIES)[number];

/** Assignment preference order — ADR-08 step 2. Lower index wins. */
export const GROUP_PRIORITY_ORDER: Record<GroupPriority, number> = {
  primary: 0,
  first: 1,
  normal: 2,
  last: 3,
};

export const TOKEN_KINDS = ['pat', 'oauth', 'bot'] as const;
export type TokenKind = (typeof TOKEN_KINDS)[number];

export type ActorType = 'agent' | 'customer' | 'bot' | 'system';

// --- Chat / thread / event --------------------------------------------------

export const EVENT_TYPES = [
  'message',
  'system_message',
  'rich_message',
  'file',
  'filled_form',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_AUTHOR_TYPES = ['agent', 'customer', 'bot', 'system'] as const;
export type EventAuthorType = (typeof EVENT_AUTHOR_TYPES)[number];

/**
 * `all` reaches the customer; `agents` stays internal (internal notes).
 * The customer-facing API calls this `recipients`; the agent API historically
 * called it `visibility` — the clone uses `recipients` on the wire everywhere.
 */
export const EVENT_RECIPIENTS = ['all', 'agents'] as const;
export type EventRecipients = (typeof EVENT_RECIPIENTS)[number];

export const CHAT_USER_TYPES = ['agent', 'customer'] as const;
export type ChatUserType = (typeof CHAT_USER_TYPES)[number];

export const TRANSFER_REASONS = ['manual', 'routing', 'agent_disconnected', 'ai_handoff'] as const;
export type TransferReason = (typeof TRANSFER_REASONS)[number];

// --- Ticketing --------------------------------------------------------------

export const TICKET_STATUSES = ['open', 'pending', 'solved', 'closed', 'spam'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

// --- AI ---------------------------------------------------------------------

export const AI_AGENT_KINDS = ['ai_agent', 'copilot'] as const;
export type AiAgentKind = (typeof AI_AGENT_KINDS)[number];

export const SKILL_KINDS = ['ai_agent', 'workspace'] as const;
export type SkillKind = (typeof SKILL_KINDS)[number];

export const SKILL_STEP_TYPES = [
  'detect_intent',
  'request_info',
  'tag',
  'summarize',
  'send_message',
  'transfer_to_team',
] as const;
export type SkillStepType = (typeof SKILL_STEP_TYPES)[number];

export const KNOWLEDGE_SOURCE_TYPES = ['website', 'file', 'article', 'faq'] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

/** pgvector column width — knowledge_chunks.embedding VECTOR(1536). */
export const EMBEDDING_DIMENSIONS = 1536;

// --- Configuration ----------------------------------------------------------

export const CHANNEL_TYPES = [
  'website_widget',
  'email',
  'messenger',
  'twilio',
  'whatsapp',
  'instagram',
  'telegram',
  'chat_page',
] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CHANNEL_STATUSES = ['connected', 'off', 'soon'] as const;
export type ChannelStatus = (typeof CHANNEL_STATUSES)[number];

export const ROUTING_RULE_KINDS = ['chat', 'ticket'] as const;
export type RoutingRuleKind = (typeof ROUTING_RULE_KINDS)[number];

export const CANNED_RESPONSE_SCOPES = ['chat', 'ticket'] as const;
export type CannedResponseScope = (typeof CANNED_RESPONSE_SCOPES)[number];

// --- Billing ----------------------------------------------------------------

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'read_only',
  'canceled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const USAGE_METRICS = ['api_calls', 'ai_resolutions'] as const;
export type UsageMetric = (typeof USAGE_METRICS)[number];

export const RATING_VALUES = ['good', 'bad'] as const;
export type RatingValue = (typeof RATING_VALUES)[number];

// --- Region (ADR-12: single region for MVP, field kept immutable) -----------

export const REGIONS = ['eu'] as const;
export type Region = (typeof REGIONS)[number];

// --- Shared shapes ----------------------------------------------------------

export interface Paginated<T> {
  items: T[];
  /** Opaque keyset cursor; absent when there is no further page. */
  next_page_id?: string;
}

export interface Chat {
  id: string;
  license_id: string;
  customer_id: string;
  active: boolean;
  created_at: string;
  users: ChatUser[];
  access: { group_ids: number[] };
  thread?: Thread;
}

export interface ChatUser {
  user_id: string;
  user_type: ChatUserType;
  present: boolean;
  seen_up_to: string | null;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
}

export interface Thread {
  id: string;
  chat_id: string;
  active: boolean;
  queue_position: number | null;
  summary: string | null;
  created_at: string;
  closed_at: string | null;
  tags?: string[];
  events?: ChatEvent[];
}

export interface ChatEvent {
  id: string;
  chat_id: string;
  thread_id: string;
  type: EventType;
  text: string | null;
  author_id: string | null;
  author_type: EventAuthorType;
  recipients: EventRecipients;
  attachment_url: string | null;
  properties: Record<string, unknown>;
  created_at: string;
}
