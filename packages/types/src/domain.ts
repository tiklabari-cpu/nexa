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

/**
 * Ticket queue priority (FR-MOD-13.6, HelpDesk layer). A signed integer — higher
 * is more urgent, `0` is the default. Bounded so the column stays a small int and
 * a UI has a finite scale to render rather than an open-ended number field.
 */
export const TICKET_PRIORITY_MIN = -100;
export const TICKET_PRIORITY_MAX = 100;
export const TICKET_PRIORITY_DEFAULT = 0;

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

/**
 * Longest name an expertise area may carry (FR-MOD-08.6.3 — skill-based
 * routing). Shared so the API validator and the OpenAPI contract agree on the
 * bound. Called "expertise" at the data layer because "skills" is the
 * AI-automation Skill (ADR-14, a different concept).
 */
export const EXPERTISE_NAME_MAX_LENGTH = 100;

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

// --- Onboarding (FR-MOD-00.4) -----------------------------------------------

/**
 * First-run setup state for a workspace. `completed` flips once the new owner
 * finishes or skips the wizard — a per-license fact (the workspace is set up),
 * not a per-agent one — so it gates the wizard for the whole workspace exactly
 * once. `demo_seeded` records whether the sample data has been laid down, so the
 * seed step never runs twice.
 */
export interface OnboardingState {
  completed: boolean;
  completed_at: string | null;
  demo_seeded: boolean;
  demo_seeded_at: string | null;
}

/**
 * Outcome of the sample-data step. `seeded` is false when the demo was already
 * laid down (the call is idempotent), in which case the counts are all zero.
 */
export interface OnboardingSeedResult {
  seeded: boolean;
  counts: {
    canned_responses: number;
    tags: number;
    customers: number;
    chats: number;
  };
  state: OnboardingState;
}

// --- Campaigns (FR-MOD-03.3) ------------------------------------------------

/**
 * A campaign's lifecycle state (PRD §8.4 `campaigns.status`). Computed from the
 * owner's on/off intent plus the schedule window and stored, so the status tabs
 * (FR-MOD-03.3.1) filter on it directly:
 *   - `ongoing`   — active and running now.
 *   - `scheduled` — active but its start time has not arrived.
 *   - `inactive`  — switched off, or past its end.
 * The card's toggle (FR-MOD-03.3.3) flips between running and `inactive`; see
 * the `active` flag on the create/update request rather than a status enum.
 */
export const CAMPAIGN_STATUSES = ['ongoing', 'scheduled', 'inactive'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** The status sub-tabs (FR-MOD-03.3.1): every lifecycle state, plus "all". */
export const CAMPAIGN_STATUS_FILTERS = ['all', ...CAMPAIGN_STATUSES] as const;
export type CampaignStatusFilter = (typeof CAMPAIGN_STATUS_FILTERS)[number];

/**
 * The trigger predicate (FR-MOD-03.3.2). A visitor matches when every key set
 * here holds. `url_contains` targets the page they are on — the one condition
 * v1 ships; the shape stays an open object so geo/time rules slot in later
 * without a contract change. An empty predicate matches nobody: a campaign with
 * no trigger is not "send to everyone", it is simply not ready to send.
 */
export interface CampaignConditions {
  /** Case-insensitive substring the visitor's current page URL must contain. */
  url_contains?: string;
}

/** What the campaign delivers to a matching visitor (FR-MOD-03.3.2). */
export interface CampaignContent {
  message?: string;
}

/** Displayed / Chats / Conversion — the campaign card's numbers (FR-MOD-03.3.3). */
export interface CampaignPerformance {
  /** Visitors the message was delivered to. */
  displayed: number;
  /** Of those, how many opened a conversation. */
  chats: number;
  /** Of those, how many reached a goal. */
  conversion: number;
}

export interface Campaign {
  id: string;
  name: string;
  /** Lifecycle state the tabs filter by; see {@link CAMPAIGN_STATUSES}. */
  status: CampaignStatus;
  conditions: CampaignConditions;
  content: CampaignContent;
  starts_at: string | null;
  ends_at: string | null;
  recurring: boolean;
  created_at: string;
  performance: CampaignPerformance;
}

// --- Ticket rules (FR-MOD-08.6.2) -------------------------------------------

/**
 * Where a ticket came from — the one non-text condition a ticket rule can key
 * on. `chat` is a ticket opened from a conversation, `email` one forwarded in
 * through an inbound channel. A ticket created directly through the API has
 * neither origin and is never matched by a `source` condition.
 */
export const TICKET_RULE_SOURCES = ['chat', 'email'] as const;
export type TicketRuleSource = (typeof TICKET_RULE_SOURCES)[number];

/**
 * A ticket rule's trigger (FR-MOD-08.6.2). Every key that is set must hold
 * (AND). An empty predicate matches nothing: a rule with no condition is not
 * "apply to every ticket", it is simply not ready — which is what keeps the
 * "condition required" half of the KK honest even for a row that reached the
 * engine without one. The shape stays open so future condition kinds slot in
 * without a contract change.
 */
export interface TicketRuleConditions {
  /** Case-insensitive substring the ticket subject must contain. */
  subject_contains?: string;
  /** Restrict the rule to tickets opened from a chat, or forwarded by email. */
  source?: TicketRuleSource;
}

/**
 * What a matching rule does to the ticket (FR-MOD-08.6.2): assign it, set its
 * priority, tag it — or any combination. At least one action must be set: a
 * rule that does nothing is rejected rather than saved inert (the "action
 * required" half of the KK).
 */
export interface TicketRuleActions {
  /** Assign the ticket to this agent (account uuid). */
  assign_agent_id?: string;
  /** Assign the ticket to this team. */
  assign_group_id?: number;
  /** Set the ticket's queue priority (higher is more urgent). */
  priority?: number;
  /** Apply this tag (by name, created in the tag library if new). */
  add_tag?: string;
}

export interface TicketRule {
  id: string;
  name: string;
  conditions: TicketRuleConditions;
  actions: TicketRuleActions;
  /** Whether the rule fires. Off keeps it configured without acting. */
  enabled: boolean;
  /** Evaluation order; lower runs first, so a later rule's assignment wins. */
  position: number;
  created_at: string;
}

/**
 * A branded, variabled ticket e-mail template (FR-MOD-08.7.5). `subject` and
 * `body` may carry `{{ group.field }}` placeholders drawn from the fixed
 * `TEMPLATE_VARIABLES` catalogue; both are validated on save so a template can
 * never be stored naming a variable the product cannot fill (KK "Geçersiz
 * değişken/format engeli"). The placeholder catalogue, validator and renderer
 * live in `template-variables.ts`.
 */
export interface TicketEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  /** Whether the template is offered to agents. Off keeps it authored but hidden. */
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * How often a scheduled export is delivered (PRD §5.3-Reports).
 *
 * Not cosmetic: the scheduler derives the period key it deduplicates on *from*
 * this value (`2026-07-31` daily, `2026-W31` weekly, `2026-07` monthly), so an
 * unknown frequency would mean an undefined period and no "already delivered"
 * answer. The database constrains the same three values.
 */
export type ScheduledExportFrequency = 'daily' | 'weekly' | 'monthly';

/**
 * A standing instruction to mail one report group on a schedule
 * (PRD §5.3-Reports). The definition only — each delivery attempt is a run,
 * read separately.
 *
 * `recipients` are mailboxes of agents on this same license. A schedule is the
 * one place in the product where report data leaves the workspace unattended,
 * so the addresses it may name are bounded by the team roster rather than free
 * text; anything else would turn "define a schedule" into a data-exfiltration
 * primitive available to any admin token.
 */
export interface ScheduledExport {
  id: string;
  /** A `REPORT_GROUPS` id — the same vocabulary `GET /reports/export?group=` uses. */
  group: string;
  frequency: ScheduledExportFrequency;
  /** `csv` — the only shape the scheduler produces today. */
  format: 'csv';
  recipients: string[];
  /** Whether the scheduler picks this definition up. Off keeps it configured, inert. */
  enabled: boolean;
  created_at: string;
  /** Last successful delivery, or null while none has happened. */
  last_run_at: string | null;
}

/**
 * How one delivery attempt ended.
 *
 * `pending` is a period the sweep has claimed but not yet resolved — normally a
 * flash, but a process killed mid-delivery leaves one behind, and the history
 * says so rather than pretending the run never happened.
 *
 * `delivered` is the row's `sent`: the stored spelling is fixed by a database
 * CHECK, while the wire vocabulary matches the sweep report an operator reads,
 * so one word means one thing across everything a human looks at.
 */
export type ScheduledExportRunStatus = 'pending' | 'delivered' | 'failed';

/**
 * One delivery attempt of a scheduled export (PRD §5.3-Reports).
 *
 * The counterpart to `ScheduledExport`: the definition says what should be
 * mailed and to whom, a run says what happened when it was. A period is claimed
 * before anything is sent, so every attempt leaves one of these behind — a
 * failure included, with its reason — and "did last Monday's report go out?" is
 * answerable rather than inferred from a mailbox (NFR-M5).
 *
 * Deliberately no recipient addresses: `recipient_count` is how many mailboxes
 * the run actually reached. The addresses belong to the definition, which is
 * read under the stricter `reports_manage`; the history stays readable by
 * anyone who may read reports because it carries no such thing.
 */
export interface ScheduledExportRun {
  id: string;
  /**
   * The period this run covers, as the deterministic label the single-delivery
   * claim is keyed on: `2026-07-31` (daily), `2026-W31` (weekly), `2026-07`
   * (monthly).
   */
  period_key: string;
  period_from: string;
  period_to: string;
  status: ScheduledExportRunStatus;
  /** Data rows in the CSV that was sent, excluding the header. */
  row_count: number;
  /** Mailboxes the run actually reached — not the number configured. */
  recipient_count: number;
  /** Why the delivery failed: one bounded, sanitised line, or null. */
  error: string | null;
  /** When the period was claimed — i.e. when the attempt started. */
  created_at: string;
}
