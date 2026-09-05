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

/**
 * The columns `GET /tickets` can order the *whole* collection by.
 *
 * Deliberately a subset of the grid's six columns. A sort is a promise about
 * every row that matches the view, not about the page a browser happens to hold,
 * so a column only belongs here when the database can order by it — which rules
 * two of them out:
 *
 *   - **status** is stored as text, so `ORDER BY status` reads closed, open,
 *     pending, solved, spam. The order the product means is the lifecycle one
 *     (open first, because that is the work), and expressing it needs a rank the
 *     schema does not have.
 *   - **assignee** is displayed as the account's *name*, and a ticket stores only
 *     `assignee_id` with no relation to `accounts` — the name is resolved in a
 *     second query, after the page has already been chosen.
 *
 * Neither loss costs much: the ticket *views* (`unassigned`, `my_open`,
 * `solved`) already slice by exactly those two fields, and they do it across the
 * whole collection.
 */
export const TICKET_SORT_KEYS = ['last_message', 'subject', 'customer', 'priority'] as const;
export type TicketSortKey = (typeof TICKET_SORT_KEYS)[number];

/** Matches the server's default (`GET /tickets` — newest activity first). */
export const DEFAULT_TICKET_SORT_KEY: TicketSortKey = 'last_message';

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/**
 * The columns `GET /customers` can order the *whole* collection by
 * (FR-MOD-03.2.3).
 *
 * `chats_count` and `tickets_count` are absent for the same reason
 * `TICKET_SORT_KEYS` leaves out `status`/`assignee`: what the table shows is a
 * license-scoped count (`CustomerService#counts`'s `_count` with a `where`),
 * and Prisma's relation-aggregate `orderBy` cannot carry that filter — sorting
 * by the *unscoped* relation count would silently disagree with the number
 * printed in the cell next to it.
 */
export const CUSTOMER_SORT_KEYS = ['last_activity', 'name', 'country'] as const;
export type CustomerSortKey = (typeof CUSTOMER_SORT_KEYS)[number];

/** Matches the server's existing default (`GET /customers` — most recent activity first). */
export const DEFAULT_CUSTOMER_SORT_KEY: CustomerSortKey = 'last_activity';

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

// --- Region (ADR-12: chosen at signup, immutable afterwards) ----------------
//
// Two values since C4 (NFR-C4/C9): an enterprise buying HIPAA cover needs its
// data to sit in the United States, and the single-region MVP could not answer
// that. The half of ADR-12 that survives — and matters more — is immutability:
// a workspace picks its region when it is created and cannot move afterwards,
// because "move" would mean copying every conversation across the border the
// choice exists to draw. The database enforces it (a trigger on
// `organizations`), not this list.
//
// The PRD names these regions `fra` and `dal` after their datacentres; this
// repository has said `eu`/`us` since ADR-12 and keeps saying so (PLAN §D
// A20.2). Existing workspaces stay in `eu` — there is no backfill, for the
// same reason there is no move.
export const REGIONS = ['eu', 'us'] as const;
export type Region = (typeof REGIONS)[number];

/** Where a workspace lands when its creator expresses no preference. */
export const DEFAULT_REGION: Region = 'eu';

/**
 * Whether a door that serves `serving` may answer for a workspace whose data
 * lives in `home` (C4-b). A mismatch is `misdirected_request` (421), never 403:
 * the credential is genuine and the caller is not short of permission — they
 * are at the wrong address, and the answer tells them which one is theirs.
 *
 * One comparison, deliberately in the shared package, because the same answer
 * has to come out of four separate doors — the REST edge, the RTM `login`, the
 * widget token mint and signup — and one of those runs in a *different
 * process*. A rule spelled out four times is a rule that eventually disagrees
 * with itself, and the shape of that disagreement ("REST refuses but the socket
 * accepts") is exactly what a data-residency guarantee is sold to prevent.
 *
 * Sharing the function was not enough on its own, so the invariant is written
 * here as well: **`serving` is always the calling process's own configuration**,
 * never a value the caller supplied. The REST edge once passed `X-Region`
 * instead, which let a caller who named the workspace's own home region compare
 * that region against itself and walk through (tm 145). A header may narrow the
 * answer — that is a separate refusal — but it is never one side of this
 * comparison. `apps/api/test/integration/region.test.ts` ("cannot be widened by
 * a header at any door this process holds") is what keeps the four in step now.
 */
export function servesRegion(serving: string, home: string): boolean {
  return serving === home;
}

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
 * Choices for the one-time "What are you tracking?" survey popover
 * (FR-MOD-07.2, rapor-1-fonksiyonel.md:1253). `other` is a submitted choice
 * like the rest, just an uncategorised one — a dismissed popover is `null` on
 * the wire, not a sixth value here.
 */
export const ONBOARDING_SURVEY_ANSWERS = [
  'agent_performance',
  'team_sharing',
  'spotting_problems',
  'revenue_impact',
  'other',
] as const;
export type OnboardingSurveyAnswer = (typeof ONBOARDING_SURVEY_ANSWERS)[number];

/**
 * First-run setup state for a workspace. `completed` flips once the new owner
 * finishes or skips the wizard — a per-license fact (the workspace is set up),
 * not a per-agent one — so it gates the wizard for the whole workspace exactly
 * once. `demo_seeded` records whether the sample data has been laid down, so the
 * seed step never runs twice. `survey_answer`/`survey_answered_at` are the
 * Reports survey popover's outcome — set together, once, whether the popover
 * was answered or skipped, so it is never shown a second time either way.
 */
export interface OnboardingState {
  completed: boolean;
  completed_at: string | null;
  demo_seeded: boolean;
  demo_seeded_at: string | null;
  survey_answer: OnboardingSurveyAnswer | null;
  survey_answered_at: string | null;
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

// --- Goals (FR-MOD-13.3) -----------------------------------------------------

/**
 * A goal's trigger predicate (FR-MOD-13.3) — same vocabulary as
 * {@link CampaignConditions}. `url_contains` is the one condition v1 ships;
 * the shape stays an open object so geo/event conditions slot in later
 * without a contract change.
 */
export interface GoalDefinition {
  /** Case-insensitive substring the visitor's current page URL must contain. */
  url_contains?: string;
}

/** A tracked conversion target (FR-MOD-13.3). */
export interface Goal {
  id: string;
  name: string;
  definition: GoalDefinition;
  active: boolean;
  created_at: string;
}

/** The visitor→chat→conversion funnel for a goal, or goals in aggregate (FR-MOD-13.3). */
export interface GoalFunnel {
  visitors: number;
  chats: number;
  conversions: number;
  /** `conversions / chats`; null when there are no chats to divide by. */
  conversion_rate: number | null;
}

/** The status sub-tabs on the Goals screen. */
export const GOAL_FILTERS = ['all', 'active', 'inactive'] as const;
export type GoalFilter = (typeof GOAL_FILTERS)[number];

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

// --- Single sign-on (NFR-S11) -----------------------------------------------

/**
 * The account fields a SAML assertion may fill (NFR-S11). Bounded on purpose:
 * an assertion is attacker-adjacent input — it arrives through the browser,
 * signed by a party outside this system — so the set of columns it can reach is
 * fixed here rather than inferred from whatever attribute names an IdP happens
 * to send. Anything outside this list is ignored, which is what keeps a rogue
 * `role` or `suspended` attribute from ever meaning anything.
 */
export const SSO_ATTRIBUTE_MAPPING_KEYS = ['email', 'name'] as const;
export type SsoAttributeMappingKey = (typeof SSO_ATTRIBUTE_MAPPING_KEYS)[number];

/**
 * Which assertion attribute carries which account field, e.g.
 * `{ email: 'urn:oid:0.9.2342.19200300.100.1.3' }`.
 *
 * Every key is optional and an unset key is not a default — it means "this
 * connection did not say", and the resolver that consumes the assertion
 * (S11-d) decides what to fall back to. No fallback is guessed here: the
 * mapping is configuration, and a value invented in a type would silently
 * become one.
 */
export type SsoAttributeMapping = Partial<Record<SsoAttributeMappingKey, string>>;

/**
 * One SAML 2.0 identity provider a workspace federates sign-in to (NFR-S11).
 *
 * Configuration only: the row records who the IdP is and how to reach it.
 * Nothing consumes it to authenticate anyone yet — assertion validation is
 * S11-b, the SP endpoints S11-d. Written by the owner-only surface (S11-a2).
 *
 * `idp_certificate_pem` is deliberately returned in full. It is the IdP's
 * *public* signing certificate — the thing an admin compares against what their
 * IdP console shows to confirm a rotation landed — so redacting it would hide
 * the one field a misconfiguration is diagnosed from while protecting nothing.
 * The SCIM bearer token (S11-e) is the secret in this feature, and it is hashed.
 */
/**
 * The anonymous face of an SSO connection (NFR-S11 · S11-i).
 *
 * An identity-provider-initiated sign-in ends with the browser back at the app
 * holding only a connection id, and no password to spend at `/auth/login` —
 * which is where every other entry learns which OAuth client its workspace
 * uses. This is that one missing fact, and nothing else: the certificate, the
 * IdP URL and the entity id describe the trust anchor and stay in the
 * authenticated admin view ({@link SsoConnection}).
 */
export interface PublicSsoConnection {
  id: string;
  /** The workspace this connection signs in to, so a screen can name it. */
  organization_name: string | null;
  /**
   * The OAuth client to start the login with. `null` when the workspace
   * registers none or more than one — which client a session is capped by is
   * not a question to answer with a guess.
   */
  client_id: string | null;
}

/**
 * One domain an SSO connection claims, and how far its ownership proof has got
 * (NFR-S11 · PLAN §D134).
 *
 * Claiming a domain and proving it are two acts. The claim is written with the
 * connection; the proof is a token mailed to a reserved mailbox at the domain
 * itself (`postmaster@`, `admin@`, `administrator@`, `hostmaster@`,
 * `webmaster@`) and returned through the API. Until it comes back the domain is
 * inert: it appears here, it does not appear in {@link
 * SsoConnection.verified_domains}, and just-in-time provisioning ignores it.
 *
 * The token itself never appears in a response — it exists in the message and as
 * a digest on the row, and the digest is discarded the moment it is spent.
 */
export interface SsoDomain {
  /** Lowercase, no trailing dot — the form it is matched in. */
  domain: string;
  /** Whether ownership has been proved. The field that decides everything. */
  verified: boolean;
  /** When the challenge token came back. `null` while unproved. */
  verified_at: string | null;
  /** Where the outstanding (or last) challenge went. `null` when none was sent. */
  challenge_mailbox: string | null;
  /** When it was sent. The token stops being answerable 72 hours later. */
  challenge_sent_at: string | null;
}

export interface SsoConnection {
  id: string;
  /** Human label for the connection, e.g. `Okta (corp)`. */
  name: string;
  /** The IdP's SAML EntityID — what an assertion's `Issuer` must equal. */
  idp_entity_id: string;
  /** Absolute URL an AuthnRequest is sent to (HTTP-Redirect binding). */
  idp_sso_url: string;
  /** The IdP's public signing certificate, PEM-encoded. Not a secret. */
  idp_certificate_pem: string;
  /**
   * The certificate this connection was rotated away from, still trusted until
   * {@link previous_certificate_expires_at}. `null` unless a rotation asked to
   * bridge an IdP key roll: replacing a certificate revokes the old one at once
   * by default, because the rotation that matters most is the one answering a
   * compromise. Reported only while the window is open — a lapsed overlap reads
   * as no overlap, here and in the verifier.
   */
  previous_certificate_pem: string | null;
  /** When the overlap above stops being trusted. `null` when there is none. */
  previous_certificate_expires_at: string | null;
  /**
   * The domains this connection may actually provision from: the subset of
   * {@link domains} whose ownership has been proved. Just-in-time provisioning —
   * SAML sign-in and the workspace's SCIM connector alike — may only *create* an
   * account or a membership for an address inside them, so an identity provider
   * cannot adopt a stranger's account or occupy the address of somebody who
   * never signed up (PLAN §D116, §D134).
   *
   * Stored lowercase and matched *exactly*, never by suffix: a workspace that
   * proved `acme.test` has said nothing about `mail.acme.test`, and one form of
   * suffix matching is all it takes for "verified" to stop meaning "we checked
   * this exact name". An empty list provisions nobody — the fail-closed reading,
   * which is why the write surface requires at least one claim.
   *
   * A domain the workspace has merely *claimed* is not here. The claim list is
   * written by the workspace about itself, so on its own it is an assertion
   * rather than a fact — and the actor the finding is about is the workspace's
   * own owner.
   */
  verified_domains: string[];
  /**
   * Every domain this connection claims, proved or not, in the order the
   * workspace wrote them. Writing `verified_domains` replaces this list.
   */
  domains: SsoDomain[];
  attribute_mapping: SsoAttributeMapping;
  /**
   * Accept an assertion the IdP sends unsolicited, with no AuthnRequest of ours
   * to correlate it against. Off by default: an IdP-initiated flow gives up the
   * `InResponseTo` binding that makes assertion replay detectable, so it is a
   * deliberate choice a workspace makes, never a default it inherits.
   */
  allow_idp_initiated: boolean;
  /** Whether sign-in through this connection is live. Off until configured. */
  enabled: boolean;
  /**
   * Make this connection the only way into the workspace: password sign-in is
   * refused for the license while this and {@link enabled} are both set
   * (S11-h). Reported and applied as that pair — a disabled connection enforces
   * nothing, which is how a workspace whose IdP has broken gets its password
   * door back without first having to sign in to turn enforcement off.
   *
   * The workspace's owners keep theirs regardless: an enterprise that federates
   * sign-in still has to be able to get in when the identity provider cannot
   * answer, and the account that can undo the federation is the one that has to
   * be able to. Every such sign-in is marked in the audit trail.
   */
  enforced: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A SCIM provisioning credential a workspace has issued (NFR-S11 · S11-e).
 *
 * The bearer token an identity provider's connector presents at `/scim/v2` to
 * keep the member list in step with its directory. This is the shape the
 * management surface reads — it deliberately has no token field, because the
 * plaintext is stored nowhere: only a SHA-256 digest is kept, and the credential
 * itself appears exactly once, in {@link ScimTokenCreated}.
 */
export interface ScimToken {
  id: string;
  /** Human label, e.g. `Okta (corp) provisioning`. Required at creation. */
  name: string | null;
  created_at: string;
  /**
   * When the connector last presented this token, or null if it never has.
   *
   * The only operational signal a workspace has that a provisioning integration
   * is still running — and the one that says a token nobody remembers is safe to
   * revoke.
   */
  last_used_at: string | null;
  /** Null when the token does not expire. */
  expires_at: string | null;
}

/**
 * The one response that carries the credential. Returned by
 * `POST /settings/scim-tokens` and never obtainable again — the management
 * surface has to show it once and say so.
 */
export interface ScimTokenCreated extends ScimToken {
  token: string;
}
