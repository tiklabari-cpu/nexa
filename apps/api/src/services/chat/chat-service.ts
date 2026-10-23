/**
 * The conversation core: chat → thread → event.
 *
 * Invariants this service upholds, and where they are actually enforced:
 *
 *   one active chat per license+customer  → partial unique index (database)
 *   one active thread per chat            → partial unique index (database)
 *   one chat per license+customer+day     → partial unique index (database,
 *                                           `uq_chat_customer_day`, ID-02)
 *   no events on a closed conversation    → checked here, inside the same
 *                                           transaction that writes the event
 *   event sequence is gapless and unique  → `UPDATE ... RETURNING` on the thread
 *   internal notes never reach a customer → `recipients` filtered on read
 *
 * The database-level ones are deliberate: a rule checked only here is one
 * concurrent request away from being violated.
 */
import { isMailLocale, type MailLocale } from '../mail/templates/layout.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AGENT_COMPOSING_TTL_SECONDS,
  AGENT_ROLES,
  buildEventId,
  composerStateKey,
  CONTINUED_FROM_CHAT_PROPERTY,
  EDITED_AT_PROPERTY,
  EDITED_BY_PROPERTY,
  generateShortId,
  isEditableEventType,
  isWithinEditWindow,
  MESSAGE_EDIT_WINDOW_SECONDS,
  readSensitiveTypes,
  RESPONSIBLE_GAMBLING_ROLE,
  SENSITIVE_TYPES,
  SENSITIVE_TYPES_PROPERTY,
  SENSITIVE_WARNING_SYSTEM_EVENT,
  sensitiveWarningText,
  sensitiveWarningTypes,
  SNEAK_PEEK_MAX_LENGTH,
  stripEditMarkers,
  THREAD_PRIORITY_RANK,
  threadPriorityFromRank,
  transferNoteRequired,
  type AdapterChannelType,
  type AgentConflictWarningPush,
  type AiConversationMode,
  type AiReturnResume,
  type ChatAiModeChangedPush,
  type ChatTakenOverPush,
  type ChatTransferOutcome,
  type ChatTransferredPush,
  type ConnectionOpenedVia,
  type EventRecipients,
  type EventType,
  type QueueEntryOutcome,
  type SensitiveType,
  type ThreadPriority,
  type TransferReason,
  type AiHandoffCardView,
  type MessageSearchMatch,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { maskForWrite, sensitiveAuthorOf, type MaskedForWrite } from '../../lib/sensitive-mask.js';
import { visitedPagesOf } from '../campaigns/campaign-matching.js';
import {
  createGoalConversionRecorder,
  type GoalConversionRecorder,
} from '../goals/goal-triggers.js';
import type { WorkspaceEventDispatcher } from '../webhooks/workspace-events.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import { roleAtLeast, type Principal } from '../auth/principal.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { recordAiResolution } from '../billing/metering.js';
import { aiResolvedThreadWhere, recordHandledBy } from '../billing/ai-resolution.js';
import { deliver } from '../mail/delivery.js';
import type { Mailer } from '../mail/mailer.js';
import {
  renderTranscript,
  transcriptRecipients,
  type TranscriptLine,
} from '../notifications/chat-transcript.js';
import {
  RoutingService,
  type DrainedAssignment,
  type RoutingContext,
  type TeamHandOff,
} from '../routing/routing-service.js';
import { enterQueue, leaveQueue } from '../routing/queue-entries.js';
import { loadDailyDigests, settleDailyDigest, type DailyDigest } from './ai-digest.js';
import { recordAbandonment } from './ai-unresolved.js';
import { serialiseAiHandoff } from './ai-handoff-view.js';
import { seesPlayerContact } from '../customers/player-contact.js';
import {
  AI_MODE_SYSTEM_ACTOR,
  aiModeNoteText,
  aiModeStep,
  aiReturnBlockers,
  endAiProcedure,
  writeAiMode,
  type AiModeChange,
  type AiModeRequest,
} from './ai-mode.js';
import { opensAiFirst } from './ai-first.js';
import { aiStalled } from './ai-stall.js';
import { publishTrafficChange } from '../traffic/traffic-events.js';
import { SupervisionService } from '../traffic/supervision-service.js';
import { evaluate as evaluateSla, evaluateSubject, readClock } from '../sla/sla-service.js';
import {
  canSeeChat,
  chatVisibilityFilter,
  resolveVisibility,
  type ChatVisibility,
} from './access.js';
import {
  ConnectionRaceLost,
  connectionGroup,
  continuesConnection,
  isConnectionRace,
  reopensInPlace,
  resolveLocalDay,
  rolloverIdleSeconds,
  visitorOpenedVia,
  type ConversationDay,
} from './conversation-day.js';
import { searchMessages, type MessageSearchInput } from './event-search.js';

/** How long a completed request stays replayable by idempotency key. */
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Chat ids are random; a collision is vanishingly unlikely but not impossible. */
const ID_GENERATION_ATTEMPTS = 5;

export interface ChatListOptions {
  view: 'all' | 'my' | 'queued' | 'unassigned' | 'supervised' | 'archived' | 'ai' | 'ai_solved';
  customerId?: string;
  groupId?: bigint;
  /**
   * The inbox's queue tabs (AU-01 · ADR-08a §2.1): chats whose open connection
   * waits in this team's queue (`threads.queue_group_id`). Not `groupId`, which
   * is the team that grants access — a chat one team can see may wait in
   * another's queue.
   */
  queueGroupId?: bigint;
  /**
   * Chats whose open connection is this pressing (AI-12 · tm 307.1). An
   * archived chat has no open connection and never matches.
   */
  priority?: ThreadPriority;
  /**
   * The inbox's channel views (FR-MOD-02.1.4) — an axis of its own, deliberately
   * NOT a ninth `view`. The two compose (`view=my&channel=whatsapp`), and the
   * counters, saved views and rail labels are all keyed on `view`, so folding a
   * channel into that enum would have made "my WhatsApp chats" unaskable.
   */
  channel?: AdapterChannelType;
  sort: 'newest' | 'oldest';
  limit: number;
  pageId?: string;
}

export interface NewEventInput {
  type: EventType;
  text?: string;
  recipients: EventRecipients;
  attachmentUrl?: string;
  properties?: Record<string, unknown>;
  idempotencyKey?: string;
  /**
   * What the caller already masked out of `text` (tm 300.2 · AI-26): a write
   * path masks the moment a message arrives — before its spam filter and the
   * AI see it — and hands the types on, since the masked text no longer
   * shows them. Stored as `properties.sensitive_types`, merged with whatever
   * the append's own pass still finds.
   */
  sensitiveTypes?: readonly SensitiveType[];
}

interface RedisLike {
  set(key: string, value: string, mode: 'EX', ttl: number, nx: 'NX'): Promise<string | null>;
  get(key: string): Promise<string | null>;
  /**
   * Reads the members and scores of a sorted set within a score range — the
   * shape `08.6.3-conflict-b` maintains for the composer registry. Optional so a
   * service built with a minimal Redis double still constructs; when absent, the
   * transfer-time conflict read is skipped, best-effort like the bus itself.
   */
  zrangebyscore?(
    key: string,
    min: number | string,
    max: number | string,
    withScores: 'WITHSCORES',
  ): Promise<string[]>;
}

/** Everything the shared close path produces that the realtime fan-out needs. */
interface CloseResult {
  detail: ChatDetail;
  /** The thread that was just closed — what the transcript e-mail reads from. */
  threadId: string;
  audience: { groupIds: number[]; agentIds: string[]; customerId: string };
  drained: DrainedAssignment[];
}

/** A visitor's message, as `openOrContinueConnection` takes it (ID-02). */
export interface ConnectionInput {
  customerId: string;
  /** The message itself — a customer's is always addressed to `all`. */
  event: NewEventInput;
  /** Where the visitor wrote from, for the routing rules of a connection it opens. */
  routing?: RoutingContext;
  /**
   * The brand of the site the visitor wrote from — the one their widget token
   * was minted for (WG-01 `resolveWidgetBrandId`). A chat this message opens
   * is filed under it (`chats.brand_id`, tm 309.1); a chat it joins that
   * names another brand is left with none (`#keepChatBrand`). Absent: the
   * brand is not known (a channel, a token that named none).
   */
  brandId?: string;
  /**
   * The AI is asked to answer the message — the widget's path, whose `outbox`
   * writes its job. Only then may a connection it opens open AI-first (tm
   * 293.2): a channel message no AI turn follows is routed on open, or nobody
   * would ever answer it.
   */
  aiAnswers?: boolean;
  /**
   * The request's audit context. A connection the message opens under the
   * day's chat is recorded against it (`chat.connection_opened`); a rollover
   * close is recorded as the system's, built from it with the person removed.
   */
  audit: AuditContext;
  /** Written with the message, in its transaction (ADR-11a §2.1 — see {@link EventOutbox}). */
  outbox?: EventOutbox;
}

/** An event a write has just appended, as its {@link EventOutbox} sees it. */
export interface OutboxEvent {
  tenant: TenantContext;
  /** The day container (panel "Thread ID"). */
  chatId: string;
  /** The connection (panel "Chat ID") the event landed in. */
  threadId: string;
  event: SerialisedEvent;
  /** How the connection came to exist when this write opened it; null when it continued one. */
  openedVia: ConnectionOpenedVia | null;
}

/**
 * Something that must commit with an event or not at all — the outbox
 * (ADR-11a §2.1 · tm 289.2): the AI job a visitor's message is owed. `start`,
 * `sendEvent` and `openOrContinueConnection` open their own transaction, so
 * this is how a caller puts a write into it.
 *
 * Called inside that transaction right after the event is appended, which is
 * after the chat row and the thread's sequence are locked: whatever it writes
 * for one chat is written in the order the events were (`ai_jobs.created_at`
 * is that order). If it throws, the event rolls back with it. Never called for
 * a replay, which writes nothing; called again on a race retry, whose first
 * attempt rolled back along with whatever this wrote — so it writes through
 * `tx` and nowhere else.
 */
export type EventOutbox = (tx: TenantClient, written: OutboxEvent) => Promise<void>;

/** What a visitor's message did (ID-02). */
export interface ConnectionResult {
  /** The chat — the member's day — after the write. */
  chat: ChatDetail;
  /** The visitor's message as stored, or the earlier one an idempotency key replayed. */
  event: SerialisedEvent;
  replayed: boolean;
  /**
   * How the connection the message opened came to exist, or null when it
   * continued the open one (and on a replay).
   */
  openedVia: ConnectionOpenedVia | null;
}

/** The transaction's answer, before anything is announced. */
type ConnectionOutcome =
  | { kind: 'replayed'; chat: ChatRow; event: SerialisedEvent }
  | {
      kind: 'continued';
      chat: ChatRow;
      event: SerialisedEvent;
      recipients: EventRecipients;
      /** The sensitive-data warning the message earned the player (AI-26 §4), if any. */
      warning: SerialisedEvent | null;
    }
  | {
      kind: 'opened';
      chat: ChatRow;
      /** True when the day's chat was created by this message, false for a further connection. */
      createdChat: boolean;
      threadId: string;
      openedVia: ConnectionOpenedVia;
      event: SerialisedEvent;
      /** Yesterday's silent connection, closed under the member on the way in. */
      rolledOver: RolledOver | null;
      warning: SerialisedEvent | null;
    };

/** Yesterday's silent connection, closed at the turn of the day (`day_rollover`). */
interface RolledOver {
  chatId: string;
  close: CloseResult;
}

/**
 * Who a connection goes to (ID-02 · tm 286.3) — the routing decision, the
 * team(s) named by the caller, or an agent taking it themselves.
 */
interface ConnectionRoute {
  /** Teams the chat's access gains. Added, never replacing (ID-02-S7). */
  groupIds: bigint[];
  assigneeId: string | null;
  queuePosition: number | null;
  /**
   * The team whose queue it waits in — `threads.queue_group_id` (ADR-08a
   * §2.1), routing's `RoutingDecision.queueGroupId`; written with
   * `queuePosition`, absent when not queued.
   */
  queueGroupId?: bigint | null;
  /** The one team the connection went to — `threads.group_id` (`connectionGroup`). */
  groupId: bigint | null;
  /**
   * Opened for the AI to answer first (tm 293.2 · `ai-first.ts`): nobody
   * assigned, nothing queued, the connection in `ai` mode.
   */
  aiFirst?: true;
}

/** The line a further connection opens with, if any — how the transcript marks where it begins. */
interface ConnectionMarker {
  authorId: string | null;
  text: string;
  recipients: EventRecipients;
  properties: Record<string, unknown>;
}

/** `start`'s transaction answer, before anything is announced (tm 286.3). */
type StartOutcome =
  | { kind: 'existing'; chat: ChatRow }
  | {
      kind: 'opened';
      chat: ChatRow;
      /** True when the day's chat was created by this start, false for a further connection. */
      createdChat: boolean;
      threadId: string;
      rolledOver: RolledOver | null;
      /** The initial event's idempotency key, registered once the transaction commits. */
      registration: { key: string; eventId: string } | null;
    };

/** What a chat's audience is computed from (`#audienceFor`). */
interface AudienceSource {
  customerId: string;
  access: Array<{ groupId: bigint }>;
  users: Array<{ userId: string; userType: string }>;
}

/** A committed event and who it is announced to (`#announceEvent`). */
interface AnnouncedEvent {
  event: SerialisedEvent;
  recipients: EventRecipients;
  audience: { groupIds: number[]; agentIds: string[]; customerId: string };
}

/**
 * The agents-only line a change of AI mode leaves (`#changeAiMode`), with the
 * change itself: `#announceAiMode` pushes both after commit.
 */
interface AiModeNote extends AnnouncedEvent {
  change: AiModeChange;
}

/** `resume`'s transaction answer: the chat the conversation continues in, and the connection. */
interface ResumeOutcome {
  chat: ChatRow;
  /** True when the reopening opened the member's chat for today. */
  createdChat: boolean;
  threadId: string;
}

/**
 * Delivers an agent's reply out through the channel a conversation arrived on.
 *
 * One verb, deliberately: `ChannelService` already calls into `ChatService` to
 * turn an inbound webhook into a chat, so depending on the whole class in the
 * other direction would make the two mutually recursive. A structural interface
 * declared here — and implemented there — keeps the dependency one-way.
 *
 * Contract: **never throws, and never blocks the reply.** A chat that did not
 * arrive over a channel is a no-op, and a provider that fails is logged, not
 * propagated — the agent's message is already committed by the time this runs.
 */
export interface ChannelDispatcher {
  dispatchAgentReply(tenant: TenantContext, chatId: string, text: string): Promise<void>;
}

/**
 * Who answers a chat's open connection after a person gave it back to the AI
 * or held the AI back on it (tm 293.3) — the `ChatAiMode` body.
 */
export interface ChatAiModeResult {
  chat_id: string;
  thread_id: string;
  ai_mode: AiConversationMode;
  /** Null when the AI had not taken part in the connection. */
  previous_ai_mode: AiConversationMode | null;
  /** False when the connection was already in `ai_mode`; nothing was written. */
  changed: boolean;
  assignee_id: string | null;
}

/** The more pressing of two priorities, by the rank `threads.priority` stores. */
function morePressing(a: ThreadPriority, b: ThreadPriority): ThreadPriority {
  return THREAD_PRIORITY_RANK[b] > THREAD_PRIORITY_RANK[a] ? b : a;
}

/**
 * What an AI hand-over (`handOverFromAi`, `transfer`) writes with it, in its
 * own transaction: the risk flags its turn raised (tm 302.2 · AI-27), so a
 * flag is never there without the hand-over, nor the hand-over without it.
 */
export interface HandOverOptions {
  alongside?: (tx: TenantClient) => Promise<void>;
  /**
   * What the AI's hand-over adds to the system events it writes — the transfer
   * line and the AI-mode line (tm 303.2 · AI-09 §6): `handoff_id`,
   * `reason_codes`, `primary_reason`, `priority`, for the reports and the
   * search. Never the event's own keys: those are written after.
   */
  properties?: Record<string, unknown>;
  /**
   * How pressing the hand-over is (AI-09 §6 · ADR-08a §2.3): raises
   * `threads.priority`, never lowers it, so an urgent hand-over waits at the
   * front of its own team's queue (`RoutingService.raisePriority`).
   */
  priority?: ThreadPriority;
  /** Why (`threads.priority_reason`, tm 307.1): the hand-over's primary reason code. */
  priorityReason?: string;
  /**
   * How pressing it is when a team hand-off leaves it waiting instead — the
   * floor `priority` is raised to then (AI-12 §2 · tm 307.2: a conversation
   * whose route requires an expertise nobody free holds waits urgent).
   */
  queuedPriority?: ThreadPriority;
  /**
   * The team `handOverFromAi` routes a connection nobody has into, in place of
   * the team the rules gave it on open (ADR-08a §2.4: the hand-over's target
   * team is the pool). The AI's hand-over names it for the Responsible
   * Gambling team it could not transfer to, so the conversation waits in that
   * team's queue rather than reach another team (§2.6 · tm 305.3).
   */
  groupId?: bigint;
}

export class ChatService {
  /**
   * The hand-back's watch (tm 293.3): whoever gave an AI-first connection back
   * keeps it on their Supervised list.
   */
  readonly #supervisions = new SupervisionService();

  constructor(
    private readonly db: PrismaClient,
    private readonly redis: RedisLike,
    /**
     * Optional so unit tests and scripts can build a service without a bus.
     * Realtime delivery is an enhancement over polling, never a precondition
     * for the write succeeding.
     */
    private readonly publisher?: RealtimePublisher,
    private readonly routing: RoutingService = new RoutingService(),
    /**
     * ADR-13 — overage price and monthly allowance, from env. `adr09aEffectiveAt`
     * is a test's own moment for the counter's hand-off rule (ADR-09a); left
     * out — as every route and job leaves it — the counter reads the one
     * constant the reports read (`ai-resolution.ts`).
     */
    private readonly billing: {
      aiOverageCents: number;
      aiIncluded: number;
      adr09aEffectiveAt?: Date;
    } = {
      aiOverageCents: 50,
      aiIncluded: 200,
    },
    /**
     * Sends the end-of-chat transcript (FR-MOD-08.7.4). Optional for the same
     * reason `publisher` is: a service built without one still closes chats,
     * it just skips the courtesy e-mail — never a precondition for the close.
     */
    private readonly mailer?: Mailer,
    /**
     * Carries an agent's reply back out to the channel the conversation arrived
     * on (FR-MOD-08.5.4-.8). Optional on the same terms as the two above: a
     * service built without one still records the reply, it just does not leave
     * the building — which is exactly what every caller did before this existed,
     * so a Website chat is unaffected either way.
     */
    private readonly channels?: ChannelDispatcher,
    /**
     * Fans a committed lifecycle event out to whatever subscribed to it
     * (FR-MOD-09.4 — a Zapier zap or a Make scenario, over the webhook stack
     * `08.8.4` already built). Optional on exactly the terms `publisher`,
     * `mailer` and `channels` are: a service built without one still starts,
     * closes and transfers chats, it just tells nobody outside the building.
     */
    private readonly automations?: WorkspaceEventDispatcher,
    /**
     * Records the goals a visitor has reached once a conversation is archived
     * (FR-MOD-13.3 — the "resolution" funnel).
     *
     * Unlike the four collaborators above this one is **not** optional: it has
     * a default, built from the same `db` handle, so a close records a
     * conversion wherever it happens — including from a construction site
     * written after this one. Conversion tracking is a domain write rather than
     * an outward-facing side effect (`routing` is defaulted for the same
     * reason), and a silently unwired trigger is precisely how this funnel came
     * to be missing in the first place. Injectable so a test can watch it.
     */
    private readonly goals: GoalConversionRecorder = createGoalConversionRecorder(db),
    /**
     * The clock a visitor's message is filed by (ID-02): which conversation day
     * it is, and how long the open connection has been silent. Injectable — the
     * `ai-daily-budget.ts` pattern — so a test can move the day rather than wait
     * for one. Timestamps the database writes (`created_at`) keep its own clock.
     */
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Everyone entitled to see activity on a chat: the teams it is routed to,
   * anyone personally in it, and the customer.
   *
   * Computed here, where team membership and tenant context are available, and
   * carried in the envelope — the gateway has neither and could only guess.
   */
  #audienceFor(chat: AudienceSource) {
    return {
      groupIds: chat.access.map((a) => Number(a.groupId)),
      agentIds: chat.users.filter((u) => u.userType === 'agent').map((u) => u.userId),
      customerId: chat.customerId,
    };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    tenant: TenantContext,
    principal: Principal,
    options: ChatListOptions,
  ): Promise<{ items: ChatSummary[]; total: number; nextPageId?: string }> {
    return withTenant(this.db, tenant, (tx) => listChatsInTenant(tx, principal, options));
  }

  /** `GET /chats?query=` — the list as a message text search (ID-07). */
  async search(
    tenant: TenantContext,
    principal: Principal,
    options: MessageSearchInput,
  ): Promise<{ items: ChatSummary[]; total: number; nextPageId?: string }> {
    return withTenant(this.db, tenant, (tx) => searchChatsInTenant(tx, principal, options));
  }

  async get(tenant: TenantContext, principal: Principal, chatId: string): Promise<ChatDetail> {
    return withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'read');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);
      const detail = serialiseChat(chat);
      // Visit context (FR-MOD-02.4) is an agent-side surface. The widget never
      // needs it, and the IP in particular is personal data that must not reach
      // the customer (NFR-S9) — so it is attached only for agent/bot principals.
      if (principal.kind !== 'customer') {
        detail.visitor = await this.#latestVisitor(tx, tenant.licenseId, chat.customerId);
        // A `human` connection the AI was taken off, or one a person answered
        // from the start (AI-11): only the first is the AI's to be given back,
        // and only it earns the inbox's badge. The AI's conversation row opens
        // with its first turn (`AiResponder`).
        if (detail.thread) {
          const turn = await tx.aiConversation.findFirst({
            where: { threadId: detail.thread.id },
            select: { id: true },
          });
          detail.thread.ai_took_part = turn !== null;
        }
        // The newest hand-over card (tm 304.1 · AI-10 §9): the inbox reads it
        // with the chat, in one query.
        const card = await tx.aiHandoff.findFirst({
          where: { chatId: chat.id },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        detail.latest_ai_handoff = card
          ? serialiseAiHandoff(card, seesPlayerContact(principal))
          : null;
      }
      return detail;
    });
  }

  /**
   * The AI's summaries of the chat's connections (tm 294 · AI-02), newest
   * first — what the AI recalls of the member's day, for the agent's screen
   * (shown by IN-02, tm 331). Every connection the AI took part in, the open
   * one included, with its details: the identity filter (K4) is the AI's, an
   * agent reads the transcript anyway.
   */
  async listAiDigests(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
  ): Promise<DailyDigest[]> {
    return withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'read');
      await this.#loadVisibleChat(tx, visibility, chatId);
      return loadDailyDigests(tx, chatId, { limit: null });
    });
  }

  /**
   * Read one of the chat's connections behind the chat's visibility
   * (`resolveVisibility`), like its transcript: the newest connection unless
   * `threadId` names another, and a thread of another chat is a 404 too.
   * `read` gets the connection in the same transaction, or is not called
   * when the chat has none (`threadId` null). What is read is the caller's —
   * `GET /chats/{chatId}/ai-conversation` (tm 296.4) reads the AI's state
   * through it, so this service imports nothing of the AI (the rule bot's
   * closure, FR-MOD-06.6).
   */
  async readConnection<T>(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    threadId: string | undefined,
    read: (tx: TenantClient, connection: { chatId: string; threadId: string }) => Promise<T>,
  ): Promise<{ chatId: string; threadId: string | null; value: T | null }> {
    return withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'read');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);
      const thread = threadId ?? chat.threads[0]?.id ?? null;
      if (thread !== null && !chat.threads.some((t) => t.id === thread)) {
        throw ApiError.notFound('Thread not found.');
      }
      const value = thread ? await read(tx, { chatId: chat.id, threadId: thread }) : null;
      return { chatId: chat.id, threadId: thread, value };
    });
  }

  async listEvents(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    options: {
      threadId?: string;
      afterEventId?: string;
      beforeEventId?: string;
      /** `newest` walks the thread backwards — see the contract note. */
      sort?: 'oldest' | 'newest';
      limit: number;
    },
  ): Promise<{ items: SerialisedEvent[]; nextPageId?: string }> {
    return withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'read');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      const threadId = options.threadId ?? chat.threads[0]?.id;
      if (!threadId) return { items: [] };
      // A thread id from another chat must not act as a back door into it.
      if (!chat.threads.some((t) => t.id === threadId)) {
        throw ApiError.notFound('Thread not found.');
      }

      const after = options.afterEventId
        ? parseSequence(options.afterEventId, threadId, 'after_event_id')
        : 0;
      const before = options.beforeEventId
        ? parseSequence(options.beforeEventId, threadId, 'before_event_id')
        : null;
      const newestFirst = options.sort === 'newest';

      // Sequence lives inside the id, so "everything after N" — and its mirror,
      // "the page just before N" — is answerable without comparing timestamps,
      // which matters because several events can share a millisecond. The same
      // key orders and bounds the page, so the two directions cannot disagree
      // about what "next" means.
      //
      // `event_sequence` is that number as a stored generated column, and it is
      // read here rather than dug back out of the id with `split_part` for one
      // measured reason (NFR-P6, migration `20260911170000_events_sequence_
      // column`): `events` carries row level security, which makes it a
      // security barrier, and PostgreSQL will not push a non-leakproof qual
      // below a barrier into an index condition. `split_part` is not leakproof,
      // so an index on the expression left the cursor bound as a row filter —
      // the plan still said `Index Scan` while the scan restarted at event one
      // and discarded everything before the cursor. `bigint` comparison is
      // leakproof, so the bound rides into `events_thread_id_event_sequence_idx`
      // and the page costs the same wherever it sits in the thread. Keep the
      // two sides in step: `test/integration/transcript-page-plan.test.ts`
      // explains this very statement and fails if the plan degrades.
      //
      // Internal notes are filtered in SQL rather than after fetching: dropping
      // them afterwards would return short pages and let a customer infer, from
      // the gap, that a note exists.
      const rows = await tx.$queryRaw<RawEvent[]>(Prisma.sql`
        SELECT id, chat_id, thread_id, type, text, author_id, author_type,
               recipients, attachment_url, properties, created_at
        FROM events
        WHERE thread_id = ${threadId}
          AND event_sequence > ${after}
          ${before === null ? Prisma.empty : Prisma.sql`AND event_sequence < ${before}`}
          ${principal.kind === 'customer' ? Prisma.sql`AND recipients = 'all'` : Prisma.empty}
        ORDER BY event_sequence ${newestFirst ? Prisma.sql`DESC` : Prisma.sql`ASC`}
        LIMIT ${options.limit + 1}
      `);

      const hasMore = rows.length > options.limit;
      const page = hasMore ? rows.slice(0, options.limit) : rows;

      return {
        items: page.map(serialiseRawEvent),
        ...(hasMore && page.at(-1) ? { nextPageId: page.at(-1)!.id } : {}),
      };
    });
  }

  // -------------------------------------------------------------------------
  // Writes
  // -------------------------------------------------------------------------

  /**
   * An agent (or bot) starts a conversation with a customer — `POST /chats`
   * (ID-02 · tm 286.3, 05 coding logic 3).
   *
   * The customer's open conversation is reused when there is one, by the
   * visitor's own rule (`openOrContinueConnection` 2a), so an agent and the
   * member can never disagree about whether yesterday's connection is still
   * going: it is reused unless it is filed under an earlier day and has been
   * silent past the idle window, in which case it is closed as a
   * `day_rollover` first. Otherwise the conversation opens in the member's day
   * — a further connection under the day's chat when the member already has
   * one (its team(s) added to the chat's access, `chat.connection_opened` in
   * the trail), the day's chat itself when not — opened as `agent_start`
   * either way: what opened it is the agent, even when yesterday's connection
   * had to be closed on the way in. A race (another tab, the member writing at
   * the same moment) is retried once, the visitor path's rule.
   *
   * `created` is true whenever a connection was opened, so the route answers
   * 201 for a further connection under an existing chat as well.
   */
  async start(
    tenant: TenantContext,
    principal: Principal,
    input: {
      customerId: string;
      groupIds?: bigint[];
      assignToMe: boolean;
      initialEvent?: NewEventInput;
      routing?: RoutingContext;
      /**
       * The request's audit context: a further connection under the day's
       * archived chat is recorded against it (`chat.connection_opened`), and a
       * rollover close as the system's, built from it with the person removed.
       */
      audit: AuditContext;
      /** Written with `initialEvent`, in its transaction; unused without one ({@link EventOutbox}). */
      outbox?: EventOutbox;
    },
  ): Promise<{ chat: ChatDetail; created: boolean }> {
    // One instant for both attempts, as on the visitor's path.
    const now = this.now();
    let outcome: StartOutcome;
    try {
      outcome = await this.#startInTransaction(tenant, principal, input, now);
    } catch (error) {
      if (!isConnectionRace(error)) throw error;
      outcome = await this.#startInTransaction(tenant, principal, input, now);
    }

    // Reusing an open conversation creates nothing, and re-announcing one
    // moves nobody.
    if (outcome.kind === 'existing') return { chat: serialiseChat(outcome.chat), created: false };

    // After commit: a key pointing at an event that was rolled back would make
    // the retry replay something that does not exist.
    if (outcome.registration) {
      await this.redis.set(
        outcome.registration.key,
        outcome.registration.eventId,
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
    }
    if (outcome.rolledOver) await this.#announceRollover(tenant, outcome.rolledOver);

    const detail = serialiseChat(outcome.chat);
    await this.#announceOpenedConnection(
      tenant,
      principal,
      outcome.chat,
      detail,
      outcome.createdChat ? null : { threadId: outcome.threadId, openedVia: 'agent_start' },
    );
    return { chat: detail, created: true };
  }

  /**
   * Tell everyone watching that a connection opened (ID-02): the inboxes, the
   * real-time board, and the workspace's subscribers.
   *
   * `incoming_chat` because, to an inbox, a member back the same day is an
   * arrival exactly like a new chat — `resume` announces a reopening the same
   * way. The board's own signal (FR-MOD-03.1.1) because this visitor just left
   * whichever of browsing/invited they were in for a live conversation.
   *
   * Outside, each connection is announced exactly once (FR-MOD-09.4): the day's
   * first by `chat_started`, which names it in `thread_id`, and every later one
   * by `thread_started` — never both, because a subscriber that heard two
   * openings for one connection would open two tickets. `further` is null for
   * a chat that was just created, else the further connection and how it opened.
   */
  async #announceOpenedConnection(
    tenant: TenantContext,
    principal: Principal,
    raw: ChatRow,
    detail: ChatDetail,
    further: { threadId: string; openedVia: ConnectionOpenedVia } | null,
  ): Promise<void> {
    await this.publisher?.publish(tenant, 'incoming_chat', this.#audienceFor(raw), {
      requester_id: actorOf(principal),
      chat: detail,
    });
    await publishTrafficChange(this.publisher, tenant, raw.customerId);

    if (further === null) {
      await this.automations?.emit(tenant, 'chat_started', {
        chat_id: detail.id,
        thread_id: detail.thread?.id ?? null,
        customer_id: raw.customerId,
        active: true,
        created_at: raw.createdAt.toISOString(),
      });
      return;
    }

    // The body matches the manifest's `thread_started` sample
    // (`INTEGRATION_TRIGGERS`), which is what an integrator builds against.
    const thread = raw.threads.find((t) => t.id === further.threadId);
    await this.automations?.emit(tenant, 'thread_started', {
      chat_id: detail.id,
      thread_id: further.threadId,
      customer_id: raw.customerId,
      reason: further.openedVia,
      created_at: (thread?.createdAt ?? new Date()).toISOString(),
    });
  }

  async #startInTransaction(
    tenant: TenantContext,
    principal: Principal,
    input: {
      customerId: string;
      groupIds?: bigint[];
      assignToMe: boolean;
      initialEvent?: NewEventInput;
      routing?: RoutingContext;
      audit: AuditContext;
      outbox?: EventOutbox;
    },
    now: Date,
  ): Promise<StartOutcome> {
    const actorId = actorOf(principal);

    return withTenant(this.db, tenant, async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { id: true, bannedAt: true },
      });
      if (!customer) throw ApiError.notFound('Customer not found.');
      if (customer.bannedAt) throw new ApiError('customer_banned', 'This customer is banned.');

      const day = await resolveLocalDay(tx, now);

      // Reusing an existing active chat is not just convenience: the database
      // refuses a second one, so the alternative is an error the caller can do
      // nothing useful with.
      const open = await tx.chat.findFirst({
        where: { customerId: input.customerId, active: true },
        include: chatInclude,
      });
      let rolledOver: RolledOver | null = null;
      if (open) {
        const openThread = open.threads.find((t) => t.active);
        // An active chat with no active thread is a broken record, not a day
        // boundary; it is handed back as it always was.
        if (!openThread) return { kind: 'existing', chat: open };
        // Locked before the activity is read, for `#connectInTransaction`'s
        // reason: a chat from an earlier day may be about to be closed here.
        const chatDay = localDayOf(open.localDay);
        if (chatDay !== null && chatDay < day.key && !(await lockActiveChat(tx, open.id))) {
          throw new ConnectionRaceLost('the open chat closed');
        }
        if (await openChatTakesMessage(tx, open, openThread, now, day)) {
          return { kind: 'existing', chat: open };
        }
        rolledOver = await this.#rollOver(tx, tenant, open, openThread, input.audit);
      }

      const route = () => this.#routeNewChat(tx, tenant, { ...input, actorId });
      const dayChat = await tx.chat.findFirst({
        where: { customerId: input.customerId, localDay: day.date },
        include: chatInclude,
      });
      let chatId: string;
      let threadId: string;
      if (dayChat) {
        chatId = dayChat.id;
        ({ threadId } = await this.#openFurtherConnection(tx, tenant, dayChat, {
          openedVia: 'agent_start',
          route,
          // No marker: the agent's own opening line, when there is one, is
          // where the connection visibly begins.
          marker: null,
          audit: {
            context: input.audit,
            action: 'chat.connection_opened',
            metadata: { opened_via: 'agent_start' },
          },
        }));
      } else {
        const created = await this.#createChatWithThread(tx, {
          licenseId: tenant.licenseId,
          customerId: input.customerId,
          ...(await route()),
          day,
          openedVia: 'agent_start',
        });
        chatId = created.id;
        threadId = created.threads[0]!.id;
      }

      let registration: { key: string; eventId: string } | null = null;
      if (input.initialEvent) {
        const initial = await this.#appendEvent(tx, {
          licenseId: tenant.licenseId,
          chatId,
          threadId,
          authorId: actorId,
          authorType: authorTypeOf(principal),
          input: {
            ...input.initialEvent,
            recipients: recipientsFor(principal, input.initialEvent.recipients ?? 'all'),
          },
        });
        await input.outbox?.(tx, {
          tenant,
          chatId,
          threadId,
          event: initial,
          openedVia: 'agent_start',
        });
        // An agent who opens the connection by writing to the player has it
        // (AI-11-S2). The connection is new, so the AI was never in it and
        // there is no line to leave.
        if (initial.author_type === 'agent' && initial.recipients === 'all') {
          await writeAiMode(
            tx,
            { chatId, threadId },
            { to: 'human', reason: 'agent_message', by: actorId },
          );
        }

        // Registered under the same key `sendEvent` checks.
        //
        // A client retrying a timed-out start finds the conversation open and
        // takes the `sendEvent` path instead of this one. Without this the key
        // would be unknown there, and the opening line would be posted twice.
        if (input.initialEvent.idempotencyKey) {
          registration = {
            key: idempotencyRedisKey(tenant, chatId, input.initialEvent.idempotencyKey),
            eventId: initial.id,
          };
        }
      }

      const chat = await tx.chat.findUniqueOrThrow({ where: { id: chatId }, include: chatInclude });
      return {
        kind: 'opened',
        chat,
        createdChat: dayChat === null,
        threadId,
        rolledOver,
        registration,
      };
    });
  }

  /**
   * Close the member's open connection at the turn of the day (`day_rollover`,
   * 05 ID-02 2a): filed under an earlier day and silent past the idle window.
   * Nobody closed it — the day turned while it was silent — so the trail names
   * the system; the request that noticed is kept for correlation, the person
   * is not (the timeout sweep's rule, `chat-timeout.ts`).
   */
  async #rollOver(
    tx: TenantClient,
    tenant: TenantContext,
    open: ChatRow,
    openThread: { id: string; createdAt: Date; firstResponseAt: Date | null },
    audit: AuditContext,
  ): Promise<RolledOver> {
    return {
      chatId: open.id,
      close: await this.#closeConversation(tx, tenant, open, openThread, {
        authorId: null,
        text: 'Chat closed at the end of the day',
        properties: { system_event: 'chat_deactivated', reason: 'day_rollover' },
        audit: { ...audit, actorId: null, actorType: 'system', ip: null },
        // The day ended under the wait; nobody chose to end it.
        queueOutcome: 'timeout',
      }),
    };
  }

  /**
   * Announce a rollover close once it has committed, before the connection
   * that replaced it — in the order they happened. It is closed exactly as the
   * idle sweep would have closed it, so it is announced, counted and mailed
   * the same way.
   */
  async #announceRollover(tenant: TenantContext, rolledOver: RolledOver): Promise<void> {
    const { chatId, close } = rolledOver;
    await this.#publishDeactivation(tenant, chatId, close, null);
    await this.#emitDeactivation(tenant, chatId, close);
    await this.#recordConversions(tenant, close);
    await this.#emailTranscript(tenant, chatId, close.threadId);
  }

  /**
   * Who a new chat goes to. Explicit teams win; otherwise the routing engine
   * decides, so a chat opened from the widget lands with whoever should
   * actually take it. An agent starting one for themselves takes it.
   */
  async #routeNewChat(
    tx: TenantClient,
    tenant: TenantContext,
    input: {
      groupIds?: bigint[];
      assignToMe: boolean;
      actorId: string;
      routing?: RoutingContext;
    },
  ): Promise<ConnectionRoute> {
    const decision = input.groupIds?.length
      ? null
      : await this.routing.route(tx, tenant.licenseId, input.routing ?? {});

    const groupIds = input.groupIds?.length
      ? input.groupIds
      : (decision?.groupIds ?? (await defaultGroupIds(tx, tenant.licenseId)));
    return {
      groupIds,
      assigneeId: input.assignToMe ? input.actorId : (decision?.assigneeId ?? null),
      queuePosition: input.assignToMe ? null : (decision?.queuePosition ?? null),
      queueGroupId: input.assignToMe ? null : (decision?.queueGroupId ?? null),
      groupId: connectionGroup(groupIds),
    };
  }

  /**
   * Who a member's further connection of the day goes to (ID-02-S5): the agent
   * who had their latest connection today, when that agent can take a chat
   * right now; otherwise the routing engine, exactly as for a new chat. Never
   * the acting principal — that is `resume`'s rule for an agent reopening a
   * conversation, and the reason a same-day return does not go through it.
   */
  async #routeReturn(
    tx: TenantClient,
    tenant: TenantContext,
    dayChat: ChatRow,
    routing: RoutingContext | undefined,
  ): Promise<ConnectionRoute> {
    // Newest first (`chatInclude`), so this is the most recent agent the
    // member actually had today — a connection that ended unassigned (queued,
    // or answered by the AI alone) is skipped rather than ending the search.
    const previous = dayChat.threads.find((t) => t.assigneeId !== null) ?? null;
    if (
      previous?.assigneeId &&
      (await this.routing.assignIfAvailable(
        tx,
        tenant.licenseId,
        previous.assigneeId,
        routing ?? {},
      ))
    ) {
      // The day's chat already carries the team that agent took it in, and the
      // connection goes to that same team.
      return {
        groupIds: [],
        assigneeId: previous.assigneeId,
        queuePosition: null,
        groupId: previous.groupId,
      };
    }
    const decision = await this.routing.route(tx, tenant.licenseId, routing ?? {});
    return {
      groupIds: decision.groupIds,
      assigneeId: decision.assigneeId,
      queuePosition: decision.queuePosition,
      queueGroupId: decision.queueGroupId,
      groupId: connectionGroup(decision.groupIds),
    };
  }

  /**
   * Who a connection a visitor's message opens goes to: nobody yet when the AI
   * answers first (tm 293.2 · K9, `ai-first.ts`), else `route` — the routing
   * this kind of opening has always had (a new chat's, or a same-day return's).
   *
   * AI-first, the connection keeps the team the routing rules pick for it —
   * its access is written as on any open, so that team's agents see it under
   * the AI view — but no agent is chosen and nothing is queued: no concurrent
   * limit is spent, the drain does not hand it out, and `last_assigned_at`
   * does not move. It is routed when it leaves the AI (`#routeHandover`).
   */
  async #routeVisitor(
    tx: TenantClient,
    tenant: TenantContext,
    input: ConnectionInput,
    route: () => Promise<ConnectionRoute>,
  ): Promise<ConnectionRoute> {
    if (!input.aiAnswers || !(await opensAiFirst(tx))) return route();
    const groupIds = await this.routing.team(tx, tenant.licenseId, input.routing ?? {});
    return {
      groupIds,
      assigneeId: null,
      queuePosition: null,
      groupId: connectionGroup(groupIds),
      aiFirst: true,
    };
  }

  /**
   * Would a message from this visitor, sent now, open a connection rather than
   * continue one (ID-02)? Asked before anything is written, because what
   * screens an opening message — the spam filter, the brand's pre-chat form —
   * must be able to refuse it without a trace. The same decision
   * `openOrContinueConnection` makes, on the same reads; a request racing this
   * one can change the answer in between, which costs at most one screening
   * more or less, never a write.
   */
  async opensConnection(tenant: TenantContext, customerId: string): Promise<boolean> {
    const now = this.now();
    return withTenant(this.db, tenant, async (tx) => {
      const open = await tx.chat.findFirst({
        where: { customerId, active: true },
        select: {
          id: true,
          localDay: true,
          threads: { where: { active: true }, select: { id: true, createdAt: true }, take: 1 },
        },
      });
      if (!open) return true;
      const thread = open.threads[0];
      if (!thread) return false;
      return !(await openChatTakesMessage(tx, open, thread, now));
    });
  }

  /**
   * A visitor's message (ID-02 · tm 286.2; decisions K1 = A, K2, K3): continue
   * the member's open connection, or open one under the member's chat for the
   * day — one transaction either way, so nothing can land between the decision
   * and the write.
   *
   *   (a) An open chat filed under no day or under today takes the message,
   *       as it always has. One filed under an earlier day takes it too while
   *       it is live (midnight never splits a conversation); silent for longer
   *       than the idle window, it is closed as a `day_rollover` and the
   *       message falls through to (b).
   *   (b) No open connection: the member's chat for today, if there is one, is
   *       reopened with a further connection (`same_day_return`) — routed like
   *       an arrival, preferring the agent the member had earlier today
   *       (ID-02-S5), its team added to the chat's access and the earlier ones
   *       kept (ID-02-S7), an agents-only line marking the return, and the
   *       opening recorded as `chat.connection_opened`. `resume` is not used:
   *       it hands the connection to whoever reopened it. With no chat for
   *       today, the message opens the day's chat (`first_of_day`).
   *   (c) Two tabs sending the day's first message at once: the loser of the
   *       race — refused by a partial unique index, or finding the chat
   *       changed under it — rolls back and runs once more, now joining the
   *       winner's connection. Once is enough: after the first commit there is
   *       an open connection, and every later attempt only appends.
   *
   * What the visitor sees does not change: a reply lands in the open
   * connection, and the widget reads only that one.
   */
  async openOrContinueConnection(
    tenant: TenantContext,
    principal: Principal,
    input: ConnectionInput,
  ): Promise<ConnectionResult> {
    // One instant for both attempts: the retry files the same message.
    const now = this.now();
    let outcome: ConnectionOutcome;
    try {
      outcome = await this.#connectInTransaction(tenant, principal, input, now);
    } catch (error) {
      if (!isConnectionRace(error)) throw error;
      outcome = await this.#connectInTransaction(tenant, principal, input, now);
    }

    if (outcome.kind === 'replayed') {
      return {
        chat: serialiseChat(outcome.chat),
        event: outcome.event,
        replayed: true,
        openedVia: null,
      };
    }

    // After commit, for `#startInTransaction`'s reason: a key naming an event
    // that was rolled back would make the retry replay something that does not
    // exist. Keyed by the chat the message landed in — the one the next
    // attempt, or `sendEvent`, looks it up under.
    if (input.event.idempotencyKey) {
      await this.redis.set(
        idempotencyRedisKey(tenant, outcome.chat.id, input.event.idempotencyKey),
        outcome.event.id,
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
    }

    if (outcome.kind === 'continued') {
      await this.#announceEvent(tenant, {
        event: outcome.event,
        recipients: outcome.recipients,
        audience: this.#audienceFor(outcome.chat),
      });
      await this.#announceWarning(tenant, outcome.chat, outcome.warning);
      return {
        chat: serialiseChat(outcome.chat),
        event: outcome.event,
        replayed: false,
        openedVia: null,
      };
    }

    // Yesterday's connection is announced closed before today's opens, in the
    // order they happened.
    if (outcome.rolledOver) await this.#announceRollover(tenant, outcome.rolledOver);

    const detail = serialiseChat(outcome.chat);
    await this.#announceOpenedConnection(
      tenant,
      principal,
      outcome.chat,
      detail,
      outcome.createdChat ? null : { threadId: outcome.threadId, openedVia: outcome.openedVia },
    );
    await this.#announceWarning(tenant, outcome.chat, outcome.warning);
    return { chat: detail, event: outcome.event, replayed: false, openedVia: outcome.openedVia };
  }

  async #connectInTransaction(
    tenant: TenantContext,
    principal: Principal,
    input: ConnectionInput,
    now: Date,
  ): Promise<ConnectionOutcome> {
    const actorId = actorOf(principal);
    const authorType = authorTypeOf(principal);
    const message: NewEventInput = {
      ...input.event,
      recipients: recipientsFor(principal, input.event.recipients),
    };
    // The outbox right behind the append, inside the locks it took.
    const append = async (
      tx: TenantClient,
      chatId: string,
      threadId: string,
      openedVia: ConnectionOpenedVia | null,
    ) => {
      const event = await this.#appendEvent(tx, {
        licenseId: tenant.licenseId,
        chatId,
        threadId,
        authorId: actorId,
        authorType,
        input: message,
      });
      await input.outbox?.(tx, { tenant, chatId, threadId, event, openedVia });
      const warning = await this.#warnSensitive(tx, tenant, {
        chatId,
        threadId,
        customerId: input.customerId,
        authorType,
        event,
      });
      return { event, warning };
    };

    return withTenant(this.db, tenant, async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { bannedAt: true },
      });
      if (!customer) throw ApiError.notFound('Customer not found.');

      const day = await resolveLocalDay(tx, now);
      const open = await tx.chat.findFirst({
        where: { customerId: input.customerId, active: true },
        include: chatInclude,
      });
      const openThread = open?.threads.find((t) => t.active);
      if (open && !openThread) {
        // An active chat with no active thread is a broken record, not a day
        // boundary; refused exactly as `sendEvent` refuses it.
        throw ApiError.chatInactive('Chat is not active. Resume it before sending events.');
      }

      if (open && openThread) {
        // A chat from an earlier day may be about to be closed under the
        // member. Lock it first, so neither a reply landing between the
        // activity read and the close nor a second tab rolling the same chat
        // over can overtake this one; chat row first, the order `#appendEvent`
        // takes the pair in. Today's chat needs no lock — it only takes the
        // message, as `sendEvent` would.
        const chatDay = localDayOf(open.localDay);
        if (chatDay !== null && chatDay < day.key && !(await lockActiveChat(tx, open.id))) {
          throw new ConnectionRaceLost('the open chat closed');
        }
        if (await openChatTakesMessage(tx, open, openThread, now, day)) {
          const replay = await this.#replayedEvent(tx, tenant, [open.id], message.idempotencyKey);
          if (replay) return { kind: 'replayed', chat: open, event: replay };
          await this.#keepChatBrand(tx, open, input.brandId);
          const { event, warning } = await append(tx, open.id, openThread.id, null);
          return {
            kind: 'continued',
            chat: open,
            event,
            recipients: message.recipients,
            warning,
          };
        }
      }

      // From here the message opens a connection. Everything that can refuse
      // it comes before the first write, so a refusal leaves nothing behind —
      // not even yesterday's connection closed.
      if (customer.bannedAt) throw new ApiError('customer_banned', 'This customer is banned.');
      const dayChat = await tx.chat.findFirst({
        where: { customerId: input.customerId, localDay: day.date },
        include: chatInclude,
      });
      // A retry of a message whose first attempt committed just before the
      // connection it landed in closed: answer it, do not post it again.
      const replay = await this.#replayedEvent(
        tx,
        tenant,
        [open?.id, dayChat?.id],
        message.idempotencyKey,
      );
      if (replay) return { kind: 'replayed', chat: dayChat ?? open!, event: replay };

      const rolledOver =
        open && openThread ? await this.#rollOver(tx, tenant, open, openThread, input.audit) : null;
      const openedVia = visitorOpenedVia({
        rolledOver: rolledOver !== null,
        dayChatExists: dayChat !== null,
      });

      if (dayChat) {
        await this.#keepChatBrand(tx, dayChat, input.brandId);
        const { threadId } = await this.#openFurtherConnection(tx, tenant, dayChat, {
          openedVia,
          route: () =>
            this.#routeVisitor(tx, tenant, input, () =>
              this.#routeReturn(tx, tenant, dayChat, input.routing),
            ),
          // For the agents only: the visitor is simply talking, and a line
          // telling them they came back would be the product narrating them to
          // themselves. Before the message, so the connection reads in the
          // order it happened.
          marker: {
            authorId: null,
            text:
              openedVia === 'day_rollover'
                ? 'Customer is back for the new day'
                : 'Customer reconnected the same day',
            recipients: 'agents',
            properties: { system_event: 'connection_opened', opened_via: openedVia },
          },
          // What the visitor's message did, in the trail.
          audit: {
            context: input.audit,
            action: 'chat.connection_opened',
            metadata: { opened_via: openedVia },
          },
        });
        const { event, warning } = await append(tx, dayChat.id, threadId, openedVia);
        const chat = await tx.chat.findUniqueOrThrow({
          where: { id: dayChat.id },
          include: chatInclude,
        });
        return {
          kind: 'opened',
          chat,
          createdChat: false,
          threadId,
          openedVia,
          event,
          rolledOver,
          warning,
        };
      }

      const created = await this.#createChatWithThread(tx, {
        licenseId: tenant.licenseId,
        customerId: input.customerId,
        ...(await this.#routeVisitor(tx, tenant, input, () =>
          this.#routeNewChat(tx, tenant, { assignToMe: false, actorId, routing: input.routing }),
        )),
        day,
        openedVia,
        brandId: input.brandId ?? null,
      });
      const threadId = created.threads[0]!.id;
      const { event, warning } = await append(tx, created.id, threadId, openedVia);
      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: created.id },
        include: chatInclude,
      });
      return {
        kind: 'opened',
        chat: reloaded,
        createdChat: true,
        threadId,
        openedVia,
        event,
        rolledOver,
        warning,
      };
    });
  }

  /**
   * A further connection under the member's chat for today (05 ID-02 2b and
   * 3): the day's chat is reopened and a connection opened under it — no new
   * chat, so the day keeps one Thread ID.
   *
   * Shared by the three ways a day gains a connection after its first: the
   * member coming back (`same_day_return`, or `day_rollover` once yesterday's
   * was closed on the way in), an agent starting a conversation
   * (`agent_start`), and an agent reopening an earlier day's conversation
   * (`agent_reopen`, ID-02-S6). They differ in who the connection goes to
   * (`route`), the line that marks where it begins (`marker`), and what the
   * trail calls the opening (`audit`); the rest — the conditional reopen, the
   * additive access, who is present, the thread itself — is one rule. The
   * caller appends whatever the connection opens with (the visitor's message,
   * the agent's first line) and reloads the chat.
   */
  async #openFurtherConnection(
    tx: TenantClient,
    tenant: TenantContext,
    dayChat: ChatRow,
    opening: {
      openedVia: ConnectionOpenedVia;
      /** Who the connection goes to — asked once the reopen has won its race. */
      route: () => Promise<ConnectionRoute>;
      marker: ConnectionMarker | null;
      audit: {
        context: AuditContext;
        action: 'chat.connection_opened' | 'chat.reopened';
        /** Beside the new connection's `thread_id`. */
        metadata: Record<string, unknown>;
      };
    },
  ): Promise<{ threadId: string }> {
    // Conditional, so a second tab reopening the same chat at the same moment
    // waits on this row, finds it already open, and retries into the
    // connection this one opened rather than opening a second.
    const reopened = await tx.chat.updateMany({
      where: { id: dayChat.id, active: false },
      data: { active: true },
    });
    if (reopened.count === 0) throw new ConnectionRaceLost('the day chat was reopened');

    const route = await opening.route();
    // ID-02-S7: the team this connection was routed to joins the chat's
    // access, and the teams of the day's earlier connections keep theirs — a
    // returning member's whole day stays readable to everyone who handled part
    // of it. (`transfer` still replaces; a hand-off is a different act.)
    if (route.groupIds.length > 0) {
      await tx.chatAccess.createMany({
        data: route.groupIds.map((groupId) => ({ chatId: dayChat.id, groupId })),
        skipDuplicates: true,
      });
    }
    await tx.chatUser.updateMany({
      where: { chatId: dayChat.id, userType: 'customer' },
      data: { present: true },
    });
    if (route.assigneeId) {
      await tx.chatUser.upsert({
        where: { chatId_userId: { chatId: dayChat.id, userId: route.assigneeId } },
        create: { chatId: dayChat.id, userId: route.assigneeId, userType: 'agent', present: true },
        update: { present: true },
      });
    }

    const threadId = await this.#allocateThreadId(tx);
    const queuedAt = new Date();
    await tx.thread.create({
      data: {
        id: threadId,
        chatId: dayChat.id,
        licenseId: tenant.licenseId,
        active: true,
        assigneeId: route.assigneeId,
        groupId: route.groupId,
        openedVia: opening.openedVia,
        ...(route.queuePosition != null
          ? { queuePosition: route.queuePosition, queuedAt, queueGroupId: route.queueGroupId }
          : {}),
        ...(route.aiFirst ? { aiMode: 'ai' } : {}),
      },
    });
    if (route.queuePosition != null) {
      await enterQueue(tx, {
        licenseId: tenant.licenseId,
        threadId,
        groupId: queueGroup(route),
        enteredAt: queuedAt,
      });
    }

    if (opening.marker) await this.#appendMarker(tx, tenant, dayChat.id, threadId, opening.marker);

    // The opening, in the trail: same transaction, so an opening that rolled
    // back leaves no line. PII-minimal — which connection, and why it opened.
    await writeAuditEntry(tx, opening.audit.context, {
      action: opening.audit.action,
      target: `chat:${dayChat.id}`,
      metadata: { thread_id: threadId, ...opening.audit.metadata },
    });

    return { threadId };
  }

  /**
   * The event an earlier attempt of this same send already wrote into one of
   * `chatIds`, if any — the key `sendEvent` and `start` register under.
   */
  async #replayedEvent(
    tx: TenantClient,
    tenant: TenantContext,
    chatIds: Array<string | undefined>,
    key: string | undefined,
  ): Promise<SerialisedEvent | null> {
    if (!key) return null;
    for (const chatId of new Set(chatIds)) {
      if (!chatId) continue;
      const eventId = await this.redis.get(idempotencyRedisKey(tenant, chatId, key));
      if (!eventId) continue;
      const rows = await tx.$queryRaw<RawEvent[]>`
        SELECT id, chat_id, thread_id, type, text, author_id, author_type,
               recipients, attachment_url, properties, created_at
        FROM events WHERE id = ${eventId} LIMIT 1
      `;
      if (rows[0]) return serialiseRawEvent(rows[0]);
    }
    return null;
  }

  /**
   * Append an event to the chat's open connection.
   *
   * An agent writing to the player (`recipients = 'all'`) takes the connection
   * over from the AI, in the event's own transaction (AI-11 · K9, AI-11-S2):
   * the connection turns `human` and the AI stays silent on it from then on.
   * An internal note does not — the player never saw it. `aiMode` asks for a
   * change of its own in the same transaction (a rule bot that answered). The
   * change is returned as `aiMode` when one was made.
   */
  async sendEvent(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    input: NewEventInput,
    /** `outbox` is written with the event, in its transaction ({@link EventOutbox}). */
    options: { outbox?: EventOutbox; aiMode?: AiModeRequest } = {},
  ): Promise<{ event: SerialisedEvent; replayed: boolean; aiMode?: AiModeChange }> {
    // Idempotency is checked before the transaction so a retry costs one Redis
    // read rather than a write transaction that then has to be rolled back.
    const idempotencyKey = input.idempotencyKey
      ? idempotencyRedisKey(tenant, chatId, input.idempotencyKey)
      : null;

    if (idempotencyKey) {
      const existingId = await this.redis.get(idempotencyKey);
      if (existingId) {
        const replayed = await this.#findEventById(tenant, existingId);
        if (replayed) return { event: replayed, replayed: true };
      }
    }

    const result = await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      const thread = chat.threads.find((t) => t.active);
      // Writing into an archived conversation would silently reopen it or
      // append to history nobody is watching; the caller must resume first.
      if (!chat.active || !thread) {
        throw ApiError.chatInactive('Chat is not active. Resume it before sending events.');
      }

      const authorType = authorTypeOf(principal);
      const recipients = recipientsFor(principal, input.recipients);

      const event = await this.#appendEvent(tx, {
        licenseId: tenant.licenseId,
        chatId: chat.id,
        threadId: thread.id,
        authorId: actorOf(principal),
        authorType,
        input: { ...input, recipients },
      });
      await options.outbox?.(tx, {
        tenant,
        chatId: chat.id,
        threadId: thread.id,
        event,
        openedVia: null,
      });
      const warning = await this.#warnSensitive(tx, tenant, {
        chatId: chat.id,
        threadId: thread.id,
        customerId: chat.customerId,
        authorType,
        event,
      });

      // The implicit takeover (AI-11 §4): the thread's row is locked by the
      // append above, so an AI reply racing this one either committed before it
      // or finds the connection `human` in its own transaction and is not sent.
      const modeRequest: AiModeRequest | null =
        options.aiMode ??
        (authorType === 'agent' && recipients === 'all'
          ? { to: 'human', reason: 'agent_message' }
          : null);
      const mode = modeRequest
        ? await this.#changeAiMode(tx, tenant, chat, thread.id, actorOf(principal), modeRequest)
        : null;

      // The AI's hand-over card is taken up by the first message an agent
      // writes to the player after it (tm 304.1 · AI-10 §7) — once: AI-25's
      // time to a person. Only where the AI took part (`ai_mode` set).
      if (authorType === 'agent' && recipients === 'all' && thread.aiMode !== null) {
        await tx.aiHandoff.updateMany({
          where: { threadId: thread.id, acceptedAt: null },
          data: { acceptedBy: actorOf(principal), acceptedAt: new Date(event.created_at) },
        });
      }

      // First agent reply drives the first-response-time report; recorded here
      // so it cannot drift from the events it summarises.
      if (authorType === 'agent' && recipients === 'all' && !thread.firstResponseAt) {
        const firstResponseAt = new Date(event.created_at);
        await tx.thread.update({
          where: { id: thread.id },
          data: { firstResponseAt },
        });
        // The moment the first-response clock stops is the only moment it can be
        // judged from inside a request (FR-MOD-11.5 · 11.5-d). A thread whose
        // clock is still running is the sweep's job — nobody is here to notice.
        // Costs one primary-key lookup on a workspace with no policy, and runs
        // once per thread rather than once per message.
        await evaluateSubject(tx, tenant, {
          subjectType: 'thread',
          subjectId: thread.id,
          target: 'first_response',
          startedAt: thread.createdAt,
          stoppedAt: firstResponseAt,
        });
      }

      return {
        event,
        recipients,
        audience: this.#audienceFor(chat),
        id: event.id,
        mode,
        chat,
        warning,
      };
    });

    if (idempotencyKey) {
      // NX so a concurrent duplicate cannot overwrite the winner's id.
      await this.redis.set(idempotencyKey, result.id, 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    }

    // After the transaction, never inside it: announcing an event a subscriber
    // could then fail to read would be worse than announcing it a moment late.
    await this.#announceEvent(tenant, result);
    await this.#announceWarning(tenant, result.chat, result.warning);
    if (result.mode?.note) await this.#announceAiMode(tenant, result.mode.note);
    await this.#announceHandover(tenant, result.mode?.assigned ?? null);
    return {
      event: result.event,
      replayed: false,
      ...(result.mode ? { aiMode: result.mode.change } : {}),
    };
  }

  /**
   * Move a connection's AI mode (`ai-mode.ts`) inside the caller's transaction,
   * and leave the agents-only line that says so (05 AI-11 §9) — unless the AI
   * had not taken part, when there is nothing for anyone to notice: a person
   * answering a connection the AI never spoke in is how every chat used to go.
   *
   * A connection that leaves the AI with nobody assigned and nothing queued —
   * one opened AI-first (tm 293.2) — is routed to a person here, in the same
   * transaction (`#routeHandover`).
   *
   * `line` is what a person asked for besides the change (tm 293.3): their note,
   * written into the line after its words, and properties the line carries.
   *
   * `targetGroupId` is the team the hand-over routes into in place of the
   * connection's own (`HandOverOptions.groupId`).
   *
   * Returns the change, the line to announce after commit and the assignment
   * the hand-over made, or null when there was no change to make.
   */
  async #changeAiMode(
    tx: TenantClient,
    tenant: TenantContext,
    chat: ChatRow,
    threadId: string,
    by: string,
    request: AiModeRequest,
    line: { note?: string | null; properties?: Record<string, unknown> } = {},
    targetGroupId?: bigint,
  ): Promise<{
    change: AiModeChange;
    note: AiModeNote | null;
    assigned: DrainedAssignment | null;
  } | null> {
    const change = await writeAiMode(tx, { chatId: chat.id, threadId }, { ...request, by });
    if (!change) return null;
    // A person handing the AI a connection it never spoke in is still news (tm 293.3).
    if (change.from === null && change.to === 'human')
      return { change, note: null, assigned: null };
    const assigned =
      change.to === 'human'
        ? await this.#routeHandover(tx, tenant, chat, threadId, change, targetGroupId)
        : null;
    const words = aiModeNoteText(change);
    const event = await this.#appendEvent(tx, {
      licenseId: tenant.licenseId,
      chatId: chat.id,
      threadId,
      authorId: by === AI_MODE_SYSTEM_ACTOR ? null : by,
      authorType: 'system',
      input: {
        type: 'system_message',
        text: line.note ? `${words}. Note: ${line.note}` : words,
        recipients: 'agents',
        properties: {
          ...line.properties,
          system_event: 'ai_mode_changed',
          ai_mode: change.to,
          previous_ai_mode: change.from,
          reason: change.reason,
        },
      },
    });
    return {
      change,
      note: { event, recipients: 'agents', audience: this.#audienceFor(chat), change },
      assigned,
    };
  }

  /**
   * Route a connection to a person at the moment it leaves the AI (tm 293.2 ·
   * K9: "atama devir anında"). Only a connection that is still nobody's — no
   * assignee, not queued — is touched: one opened AI-first. Every other one
   * was routed when it opened, or the change itself just routed it (a
   * takeover seats the supervisor, a hand-off to a named agent seats them, a
   * transfer of a queued connection keeps its place).
   *
   *   - **An agent wrote to the player** (`agent_message`, AI-11-S2): they
   *     took it, so it is theirs — whatever their load, as a chat they start
   *     for themselves is.
   *   - **Handed to a team** (a transfer, the AI's or a rule bot's hand-off):
   *     someone in that team, by today's routing — its fallback team and the
   *     queue included (`route()` with the team requested).
   *   - **Nobody named a team** (a rule bot answered; the watchdog, tm 293.6):
   *     routed as the connection would have been on open — the agent the
   *     member had earlier today if they can take it now (ID-02-S5), else
   *     `route()` in the team the rules gave it then.
   *
   * `route()` stands in for AI-12's hand-over target (tm 307). A queued
   * connection's wait starts here, so in AI-first the queue reports count from
   * the hand-over (RP-02/04), and it waits in that team's queue (ADR-08a
   * §2.1). The team request carries no rule's expertise requirement; the
   * team's own (`group_expertise`) holds, as in the drain (`routing-service.ts`).
   *
   * `targetGroupId` is the hand-over's own team when it names one the
   * connection is not in (`HandOverOptions.groupId`): routing is asked for
   * that team instead of the connection's.
   *
   * Returns the assignment to announce after commit; null when nobody was
   * assigned (it waits in the queue, or the workspace has no team).
   */
  async #routeHandover(
    tx: TenantClient,
    tenant: TenantContext,
    chat: ChatRow,
    threadId: string,
    change: AiModeChange,
    targetGroupId?: bigint,
  ): Promise<DrainedAssignment | null> {
    // Read after the change's own writes, under the row lock `writeAiMode` took.
    const thread = await tx.thread.findUnique({
      where: { id: threadId },
      select: { assigneeId: true, queuePosition: true, groupId: true },
    });
    if (!thread || thread.assigneeId !== null || thread.queuePosition !== null) return null;

    const team = targetGroupId ?? thread.groupId;
    const inTeam: RoutingContext = team !== null ? { requestedGroupId: team } : {};
    let route: ConnectionRoute;
    if (change.reason === 'agent_message') {
      route = { groupIds: [], assigneeId: change.by, queuePosition: null, groupId: thread.groupId };
      // As `route()` records an assignment, so the longest-waiting tie-break stays honest.
      await tx.agentMembership.updateMany({
        where: { licenseId: tenant.licenseId, agentId: change.by },
        data: { lastAssignedAt: new Date() },
      });
    } else if (
      change.reason === 'transfer' ||
      change.reason === 'ai_handoff' ||
      change.reason === 'bot_handoff'
    ) {
      const decision = await this.routing.route(tx, tenant.licenseId, inTeam);
      route = {
        groupIds: decision.groupIds,
        assigneeId: decision.assigneeId,
        queuePosition: decision.queuePosition,
        queueGroupId: decision.queueGroupId,
        groupId: connectionGroup(decision.groupIds) ?? thread.groupId,
      };
    } else {
      const returned = await this.#routeReturn(tx, tenant, chat, inTeam);
      route = { ...returned, groupId: returned.groupId ?? thread.groupId };
    }

    // Additive, as on open (ID-02-S7): a fallback team that took it joins the
    // chat's access beside the team it was in.
    if (route.groupIds.length > 0) {
      await tx.chatAccess.createMany({
        data: route.groupIds.map((groupId) => ({ chatId: chat.id, groupId })),
        skipDuplicates: true,
      });
    }
    if (route.assigneeId) {
      await tx.thread.update({
        where: { id: threadId },
        data: { assigneeId: route.assigneeId, groupId: route.groupId },
      });
      await tx.chatUser.upsert({
        where: { chatId_userId: { chatId: chat.id, userId: route.assigneeId } },
        create: { chatId: chat.id, userId: route.assigneeId, userType: 'agent', present: true },
        update: { present: true },
      });
      return {
        chatId: chat.id,
        threadId,
        assigneeId: route.assigneeId,
        customerId: chat.customerId,
      };
    }
    if (route.queuePosition != null) {
      const queuedAt = new Date();
      await tx.thread.update({
        where: { id: threadId },
        data: {
          queuePosition: route.queuePosition,
          queuedAt,
          queueGroupId: route.queueGroupId,
          groupId: route.groupId,
        },
      });
      await enterQueue(tx, {
        licenseId: tenant.licenseId,
        threadId,
        groupId: queueGroup(route),
        enteredAt: queuedAt,
      });
      // The hand-over may have raised its priority (`HandOverOptions.priority`):
      // it takes its place in the team's order, not just the next number.
      if (route.queueGroupId != null) {
        await this.routing.renumberQueue(tx, tenant.licenseId, route.queueGroupId);
      }
    }
    return null;
  }

  /**
   * Tell the agent a hand-over just gave a connection to (`#routeHandover`),
   * the way a drained queue's assignment is told (`#publishDeactivation`): their
   * inbox, and the board, where the visitor moved from the AI to a person.
   */
  async #announceHandover(
    tenant: TenantContext,
    assigned: DrainedAssignment | null,
  ): Promise<void> {
    if (!assigned) return;
    await this.publisher?.publish(
      tenant,
      'incoming_chat',
      { agentIds: [assigned.assigneeId] },
      { requester_id: null, chat: { id: assigned.chatId, thread: { id: assigned.threadId } } },
    );
    await publishTrafficChange(this.publisher, tenant, assigned.customerId);
  }

  /**
   * A line only the agents see, written by the system into one connection —
   * the AI job worker's hand-over note (tm 289.3 · ADR-11a §2.5: the AI's
   * answer came too late, a person takes it from here).
   *
   * Authored by `system`, not by the AI bot: a bot-authored line in a thread
   * with no agent in it files the chat under "AI conversations"
   * (`listChatsInTenant`), and this note says the opposite.
   *
   * Writes nothing and returns null when that connection is no longer open —
   * there is nobody left to hand the conversation to. `outbox` runs in the
   * note's transaction ({@link EventOutbox}); the worker settles its job
   * there, so only the claim that still holds the job leaves a note.
   */
  async addSystemNote(
    tenant: TenantContext,
    at: { chatId: string; threadId: string },
    note: { text: string; properties: Record<string, unknown> },
    options: { outbox?: EventOutbox } = {},
  ): Promise<SerialisedEvent | null> {
    const result = await withTenant(this.db, tenant, async (tx) => {
      const chat = await tx.chat.findUnique({ where: { id: at.chatId }, include: chatInclude });
      const thread = chat?.threads.find((t) => t.id === at.threadId);
      if (!chat?.active || !thread?.active) return null;

      const event = await this.#appendEvent(tx, {
        licenseId: tenant.licenseId,
        chatId: chat.id,
        threadId: thread.id,
        authorId: null,
        authorType: 'system',
        input: {
          type: 'system_message',
          text: note.text,
          recipients: 'agents',
          properties: note.properties,
        },
      });
      await options.outbox?.(tx, {
        tenant,
        chatId: chat.id,
        threadId: thread.id,
        event,
        openedVia: null,
      });
      return { event, recipients: 'agents' as const, audience: this.#audienceFor(chat) };
    });
    if (!result) return null;

    await this.#announceEvent(tenant, result);
    return result.event;
  }

  /**
   * The AI hand-over card's line for the agents (tm 304.1 · AI-10 §5), in the
   * hand-over's own transaction: the card as text, authored by `system`, so
   * the archive, the search and an export carry it. Never to the visitor
   * (`recipients: 'agents'`). Null when the connection is closed already.
   */
  async appendAgentsNote(
    tx: TenantClient,
    tenant: TenantContext,
    at: { chatId: string; threadId: string },
    note: { text: string; properties: Record<string, unknown> },
  ): Promise<SerialisedEvent | null> {
    const thread = await tx.thread.findFirst({
      where: { id: at.threadId, chatId: at.chatId },
      select: { active: true },
    });
    if (!thread?.active) return null;
    return this.#appendEvent(tx, {
      licenseId: tenant.licenseId,
      chatId: at.chatId,
      threadId: at.threadId,
      authorId: null,
      authorType: 'system',
      input: {
        type: 'system_message',
        text: note.text,
        recipients: 'agents',
        properties: note.properties,
      },
    });
  }

  /**
   * After commit: an agents-only line written by {@link appendAgentsNote} to
   * the chat's agents as it stands now, and that audience — what the caller's
   * own pushes go to. Null when the chat is gone.
   */
  async announceAgentsNote(
    tenant: TenantContext,
    chatId: string,
    event: SerialisedEvent | null,
  ): Promise<{ groupIds: number[]; agentIds: string[] } | null> {
    const chat = await withTenant(this.db, tenant, (tx) =>
      tx.chat.findUnique({
        where: { id: chatId },
        select: {
          customerId: true,
          access: { select: { groupId: true } },
          users: { select: { userId: true, userType: true } },
        },
      }),
    );
    if (!chat) return null;
    const audience = this.#audienceFor(chat);
    if (event) await this.#announceEvent(tenant, { event, recipients: 'agents', audience });
    return { groupIds: audience.groupIds, agentIds: audience.agentIds };
  }

  /**
   * The AI's first turn in a connection made it `ai` (`claimAiTurn`, inside
   * the turn's own commit, AI-11 · tm 293.5): `chat_ai_mode_changed` to the
   * chat's agents, after that commit. No line in the transcript — the AI's
   * answer is the news — and no reason: none is asked for.
   */
  async announceAiJoined(
    tenant: TenantContext,
    ref: { chatId: string; threadId: string },
    /** The AI's bot id — the `by` its other events carry. */
    by: string,
  ): Promise<void> {
    const chat = await withTenant(this.db, tenant, (tx) =>
      tx.chat.findUnique({
        where: { id: ref.chatId },
        select: {
          customerId: true,
          access: { select: { groupId: true } },
          users: { select: { userId: true, userType: true } },
        },
      }),
    );
    if (!chat) return;
    const audience = this.#audienceFor(chat);
    await this.publisher?.publish(
      tenant,
      'chat_ai_mode_changed',
      { groupIds: audience.groupIds, agentIds: audience.agentIds },
      {
        chat_id: ref.chatId,
        thread_id: ref.threadId,
        ai_mode: 'ai',
        previous_ai_mode: null,
        by,
        reason: null,
      } satisfies ChatAiModeChangedPush,
    );
  }

  /**
   * A change of AI mode, after commit (AI-11 · tm 293.5): its agents-only line,
   * and `chat_ai_mode_changed` to the same agents, which is what moves the
   * inbox's badge without a re-read. Never to the visitor — the audience drops
   * the customer, as the line's own does.
   */
  async #announceAiMode(tenant: TenantContext, note: AiModeNote): Promise<void> {
    await this.#announceEvent(tenant, note);
    await this.publisher?.publish(
      tenant,
      'chat_ai_mode_changed',
      { groupIds: note.audience.groupIds, agentIds: note.audience.agentIds },
      {
        chat_id: note.event.chat_id,
        thread_id: note.event.thread_id,
        ai_mode: note.change.to,
        previous_ai_mode: note.change.from,
        by: note.change.by,
        reason: note.change.reason,
      } satisfies ChatAiModeChangedPush,
    );
  }

  /**
   * Everything a committed event sets off: the push to whoever can see it, the
   * real-time board, a reply's way back out through its channel, and the
   * workspace's subscribers. Shared by `sendEvent` and a visitor's message that
   * continues an open connection, so the two cannot drift into announcing the
   * same message differently.
   */
  async #announceEvent(tenant: TenantContext, result: AnnouncedEvent): Promise<void> {
    await this.publisher?.publish(
      tenant,
      'incoming_event',
      // An internal note goes to agents only — the audience is where that is
      // decided, so the gateway cannot get it wrong.
      result.recipients === 'agents'
        ? { groupIds: result.audience.groupIds, agentIds: result.audience.agentIds }
        : result.audience,
      { chat_id: result.event.chat_id, thread_id: result.event.thread_id, event: result.event },
    );

    // Every event moves the board, and not only because `last_activity_at` is
    // the sort key: the funnel bucket is read off the newest event's author, so
    // a visitor's message turns `chatting` into `waiting` and any agent reply —
    // an internal note included, since the board reads the last event without
    // filtering on recipients — turns it back (FR-MOD-03.1.1).
    await publishTrafficChange(this.publisher, tenant, result.audience.customerId);

    // A conversation that arrived over a connected channel is answered there
    // (FR-MOD-08.5.4-.8). Out here for the same reason the publish is: this is a
    // call to someone else's server, and the agent's message is already written
    // — a provider having a bad minute must not roll the reply back.
    //
    // Only what the customer is meant to receive: an internal note is addressed
    // to `agents`, and a system event is not anybody's reply. Both are excluded
    // here rather than inside the dispatcher, so the rule is visible next to the
    // audience decision it mirrors.
    if (
      this.channels &&
      result.event.author_type === 'agent' &&
      result.recipients === 'all' &&
      result.event.text
    ) {
      await this.channels.dispatchAgentReply(tenant, result.event.chat_id, result.event.text);
    }

    // FR-MOD-09.4. Only what the customer side of the conversation can see: an
    // internal note is addressed to `agents`, and forwarding one to a zap would
    // put a private remark about a customer into a third-party system the same
    // customer's ticket may well be visible in. The same rule the channel
    // dispatch above applies, for a stronger reason.
    if (result.recipients === 'all') {
      await this.automations?.emit(tenant, 'event_created', {
        event_id: result.event.id,
        chat_id: result.event.chat_id,
        thread_id: result.event.thread_id,
        type: result.event.type,
        text: result.event.text,
        author_type: result.event.author_type,
        created_at: result.event.created_at,
      });
    }
  }

  /**
   * Correct a message the caller already sent (FR-MOD-02.3.7 · PRD §5.2).
   *
   * The text is rewritten **in place** rather than superseded by a correction
   * event, and that is the decision this method exists to carry. The
   * requirement is filed under security: the point is that the wrong sentence
   * stops being readable. An appended correction would leave the original in
   * `events.text`, which is the column reports, CSV export, the transcript
   * e-mail and the AI matcher all read — so the retracted wording would go on
   * being quoted by five surfaces that have no idea an edit happened.
   *
   * The invariant the event log actually depends on is untouched. Nothing is
   * deleted, no id is reused, `event_sequence` does not move, and `created_at`
   * keeps the row in its partition — so `after_event_id`, the transcript's
   * keyset paging and `apps/rtm/src/sync.ts`'s replay all still have exactly
   * one answer. The negative test pins that: the row count and the id are the
   * same before and after.
   *
   * Four refusals, all 403 with a machine-readable `details.reason`, because a
   * client that cannot tell them apart cannot explain any of them:
   *
   *   `not_author`           somebody else's words. Editing them would be
   *                          impersonation, and the two cases that look like
   *                          exceptions are already served elsewhere — a card
   *                          number is masked at write time (`cc-mask.ts`) and
   *                          an erasure request goes through retention.
   *   `edit_window_expired`  past `MESSAGE_EDIT_WINDOW_SECONDS`.
   *   `not_editable_type`    not a plain message.
   *   `channel_delivered`    the reply was handed to an external channel. A
   *                          provider cannot recall a delivered SMS or
   *                          Messenger message, so rewriting our copy would
   *                          leave the transcript disagreeing with what the
   *                          customer is actually holding — the same class of
   *                          defect as an agent seeing formatting the visitor
   *                          does not (tm 235), and the transcript of an
   *                          external conversation is a record of what was
   *                          *sent*.
   *
   * `audit` is required, not optional, on `deactivate`'s terms: this is a
   * moment at which the record of what was said changes, and an optional
   * context would mean a caller that forgot one edited a transcript silently.
   * The entry names actor, chat and event and never the old text — `audit_log`
   * is append-only and outlives the retention windows that govern message
   * content, so copying the retracted sentence there would defeat the erasure
   * this operation just performed.
   */
  async updateEventText(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    eventId: string,
    /** The corrected wording, already masked by the route, and what was masked in it. */
    edit: MaskedForWrite<string>,
    audit: AuditContext,
  ): Promise<SerialisedEvent> {
    const { text } = edit;
    const actorId = actorOf(principal);
    const editedAt = new Date();

    const result = await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      const thread = chat.threads.find((t) => t.active);
      // An archived conversation is read-only — the same rule `deactivate`'s
      // audit entry describes, applied from the other side.
      if (!chat.active || !thread) {
        throw ApiError.chatInactive('Chat is not active. An archived transcript is read-only.');
      }

      const rows = await tx.$queryRaw<RawEvent[]>`
        SELECT id, chat_id, thread_id, type, text, author_id, author_type,
               recipients, attachment_url, properties, created_at
        FROM events WHERE id = ${eventId} AND chat_id = ${chatId} LIMIT 1
      `;
      const existing = rows[0] ? serialiseRawEvent(rows[0]) : null;
      // Not in this chat, in another workspace, or in an older thread of this
      // one: all 404. A 403 for the last would confirm the id is real (NFR-S5).
      if (!existing || existing.thread_id !== thread.id)
        throw ApiError.notFound('Event not found.');

      if (existing.author_type !== 'agent' || existing.author_id !== actorId) {
        throw editRefusal('not_author', 'Only the agent who sent a message can correct it.');
      }
      if (!isEditableEventType(existing.type)) {
        throw editRefusal('not_editable_type', 'Only a plain message can be corrected.');
      }
      if (!isWithinEditWindow(existing.created_at, editedAt)) {
        throw editRefusal(
          'edit_window_expired',
          `A message can be corrected within ${MESSAGE_EDIT_WINDOW_SECONDS / 60} minutes of sending it.`,
        );
      }
      // Only what actually left the building. An internal note is addressed to
      // `agents` and is never dispatched, so it stays editable on a chat that
      // arrived over WhatsApp exactly like one that arrived through the widget.
      if (existing.recipients === 'all' && (await this.#hasChannelIdentity(tx, chat.customerId))) {
        throw editRefusal(
          'channel_delivered',
          'This reply was already delivered over a connected channel and cannot be recalled.',
        );
      }

      // The badge follows the wording: what the correction masked, not what
      // the original did.
      const { [SENSITIVE_TYPES_PROPERTY]: _before, ...kept } = existing.properties;
      const properties: Record<string, unknown> = {
        ...stripEditMarkers(kept),
        ...(edit.types.length > 0 ? { [SENSITIVE_TYPES_PROPERTY]: edit.types } : {}),
        [EDITED_AT_PROPERTY]: editedAt.toISOString(),
        [EDITED_BY_PROPERTY]: actorId,
      };

      // `created_at` is deliberately absent from the SET list: it keeps the row
      // in its monthly partition and is the sort key every transcript reader
      // pages on. A correction is not a new message and must not jump the
      // conversation's order.
      //
      // It is absent from the WHERE clause too, even though it is half the
      // primary key. The column is `timestamptz(6)` and a JavaScript `Date`
      // carries milliseconds, so round-tripping the value narrows it and the
      // predicate matches nothing — measured, not assumed. The id alone
      // identifies the row anyway (`<thread_id>_<sequence>`, and thread ids are
      // unique), which is what `#findEventById` already relies on, and it is
      // the leading column of the primary key so the planner still has an
      // index to work from across the partitions.
      const updated = await tx.$queryRaw<RawEvent[]>`
        UPDATE events
        SET text = ${text}, properties = ${JSON.stringify(properties)}::jsonb
        WHERE id = ${eventId}
        RETURNING id, chat_id, thread_id, type, text, author_id, author_type,
                  recipients, attachment_url, properties, created_at
      `;
      const event = updated[0] ? serialiseRawEvent(updated[0]) : null;
      if (!event) throw ApiError.notFound('Event not found.');

      await writeAuditEntry(tx, audit, {
        action: 'chat.message_edited',
        target: `chat:${chat.id}`,
        metadata: { thread_id: thread.id, event_id: event.id },
      });

      return { event, audience: this.#audienceFor(chat) };
    });

    // After the transaction, for the reason every other publish here is: a
    // subscriber told about a correction it could then fail to read would be
    // worse than one told a moment late.
    await this.publisher?.publish(
      tenant,
      'event_updated',
      result.event.recipients === 'agents'
        ? { groupIds: result.audience.groupIds, agentIds: result.audience.agentIds }
        : result.audience,
      {
        chat_id: result.event.chat_id,
        thread_id: result.event.thread_id,
        event: result.event,
      },
    );

    return result.event;
  }

  /**
   * Whether this customer is reachable on a connected channel — i.e. whether an
   * agent reply to them leaves this system. The same lookup
   * `ChannelService.dispatchAgentReply` makes before sending, asked here so the
   * two cannot disagree about which conversations are externally delivered.
   */
  async #hasChannelIdentity(tx: TenantClient, customerId: string): Promise<boolean> {
    const identity = await tx.channelIdentity.findFirst({
      where: { customerId },
      select: { channelType: true },
    });
    return identity !== null;
  }

  /**
   * Fan a visitor's live typing out to the agents on the chat (FR-MOD-02.9 /
   * 11.8). Ephemeral and unpersisted: a sneak-peek is what the visitor is
   * *about* to send, shown so an agent can begin composing before enter is
   * pressed.
   *
   * Addressed to agents only — never back to the visitor's own side — and the
   * preview is capped so a pasted wall of text does not travel keystroke by
   * keystroke. Best-effort: like every other push, delivery failing must not
   * fail anything the visitor is doing, so a missing publisher or an empty
   * audience is simply a no-op.
   */
  async publishCustomerTyping(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    input: { isTyping: boolean; text?: string },
  ): Promise<void> {
    if (!this.publisher) return;

    const target = await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'read');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);
      const audience = this.#audienceFor(chat);
      const thread = chat.threads.find((t) => t.active) ?? chat.threads[0];
      return {
        agents: { groupIds: audience.groupIds, agentIds: audience.agentIds },
        threadId: thread?.id ?? null,
      };
    });

    // Nobody is on the chat yet — an unrouted first draft has no audience. Skip
    // rather than emit an empty one the publisher would refuse anyway.
    if (target.agents.groupIds.length === 0 && target.agents.agentIds.length === 0) return;

    const authorId = actorOf(principal);
    const timestamp = Date.now();

    await this.publisher.publish(tenant, 'incoming_typing_indicator', target.agents, {
      chat_id: chatId,
      thread_id: target.threadId,
      typing_indicator: {
        author_id: authorId,
        author_type: 'customer',
        recipients: 'agents',
        timestamp,
        is_typing: input.isTyping,
      },
    });

    const preview = input.text?.trim();
    if (input.isTyping && preview) {
      await this.publisher.publish(tenant, 'incoming_sneak_peek', target.agents, {
        chat_id: chatId,
        thread_id: target.threadId,
        sneak_peek: {
          author_id: authorId,
          author_type: 'customer',
          recipients: 'agents',
          timestamp,
          text: preview.slice(0, SNEAK_PEEK_MAX_LENGTH),
        },
      });
    }
  }

  /**
   * Archive a conversation (FR-MOD-02.8).
   *
   * `audit` is required rather than optional, on the same terms as `takeover`'s:
   * this is the transition that makes a transcript read-only, the requirement
   * asks for it to be recorded, and an optional context would mean a caller that
   * forgot one closed a chat that left no trace. Every caller has one for free
   * from `request.auditContext()`.
   */
  async deactivate(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    audit: AuditContext,
  ): Promise<ChatDetail> {
    const result = await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      const thread = chat.threads.find((t) => t.active);
      if (!chat.active || !thread) throw ApiError.chatInactive('Chat is already closed.');

      return this.#closeConversation(tx, tenant, chat, thread, {
        authorId: actorOf(principal),
        text: 'Chat archived',
        properties: { system_event: 'chat_deactivated' },
        audit,
        // RP-04-S1: the player closing a chat that still waits gave up on it.
        queueOutcome: principal.kind === 'customer' ? 'abandoned' : 'closed_by_agent',
      });
    });

    await this.#publishDeactivation(tenant, chatId, result, actorOf(principal));
    await this.#emitDeactivation(tenant, chatId, result);
    await this.#recordConversions(tenant, result);
    await this.#recordAbandonment(tenant, result.threadId);
    await this.#emailTranscript(tenant, chatId, result.threadId);
    return result.detail;
  }

  /**
   * Close an idle chat on behalf of the system (FR-MOD-08.7.3).
   *
   * The same close as `deactivate`, but with no principal: it is driven by the
   * timeout sweep, so the archive event is authored by the system and the
   * queue-drain, AI-resolution accounting and realtime fan-out all go through
   * the one shared path — a timed-out AI conversation is billed and reported
   * exactly like one an agent archived by hand.
   *
   * `cutoff` is re-checked inside the transaction that closes the chat. A chat
   * that received a message between being listed by the sweep and being closed
   * here is left alone, so a reply landing mid-sweep can never be archived out
   * from under the customer. Returns null when there is nothing to close —
   * already archived, or activity resumed — which keeps the sweep idempotent.
   *
   * `audit` names the system rather than a person (see `chat.archived` in the
   * action catalogue): the sweeper builds it with a null actor, because nobody
   * is behind this close and attributing it to the last agent who touched the
   * chat would write a name into an append-only table that does not belong
   * there.
   */
  async deactivateByTimeout(
    tenant: TenantContext,
    chatId: string,
    cutoff: Date,
    audit: AuditContext,
  ): Promise<ChatDetail | null> {
    const result = await withTenant(this.db, tenant, async (tx) => {
      const chat = await tx.chat.findUnique({ where: { id: chatId }, include: chatInclude });
      const thread = chat?.threads.find((t) => t.active);
      if (!chat || !chat.active || !thread) return null;

      // Idle when listed; confirm it is still idle, in the same transaction that
      // closes it. Last activity is the newest event, or the thread's own start
      // when it has none yet.
      if ((await lastActivityAt(tx, thread.id, thread.createdAt)) >= cutoff) return null;

      return this.#closeConversation(tx, tenant, chat, thread, {
        authorId: null,
        text: 'Chat closed after inactivity',
        properties: { system_event: 'chat_deactivated', reason: 'timeout' },
        audit,
        // RP-04-S1: a wait that went quiet until the window closed it is a
        // player who left.
        queueOutcome: 'abandoned',
      });
    });

    if (!result) return null;
    await this.#publishDeactivation(tenant, chatId, result, null);
    // A chat the sweep archived is as closed as one an agent archived, so the
    // same subscribers hear about it — the alternative is an automation that
    // works during office hours and silently stops overnight.
    await this.#emitDeactivation(tenant, chatId, result);
    // A chat the sweep archived is as resolved as one an agent archived, so a
    // resolution goal fires either way — otherwise the funnel would report only
    // the conversations somebody happened to close by hand.
    await this.#recordConversions(tenant, result);
    await this.#recordAbandonment(tenant, result.threadId);
    await this.#emailTranscript(tenant, chatId, result.threadId);
    return result.detail;
  }

  /**
   * The player left the AI's question unanswered (tm 317.1 · AI-22): one
   * `player_abandoned` item for the unresolved-questions report, when the
   * closed connection is one (`recordAbandonment` decides). After the
   * close commits, never inside it — the report is a courtesy to the
   * workspace and must not be able to roll a close back — so a failure is
   * swallowed, like the transcript mail's.
   */
  async #recordAbandonment(tenant: TenantContext, threadId: string): Promise<void> {
    try {
      await withTenant(this.db, tenant, (tx) => recordAbandonment(tx, tenant.licenseId, threadId));
    } catch {
      // The conversation is closed and stays closed; the report misses one row.
    }
  }

  /**
   * Did archiving this conversation take the visitor to a goal (FR-MOD-13.3)?
   *
   * After the close commits, never inside it, because the fact the matcher
   * reads *is* the close: an evaluation run inside the transaction would look
   * at a chat that is still open and conclude nothing had happened. The
   * recorder swallows its own failures, so this cannot fail a close.
   */
  async #recordConversions(tenant: TenantContext, result: CloseResult): Promise<void> {
    await this.goals.record(tenant, result.audience.customerId);
  }

  /**
   * The close cascade shared by `deactivate` and `deactivateByTimeout`: archive
   * the thread, deactivate the chat, mark everyone absent, record the close as a
   * system event, write the audit entry FR-MOD-02.8 asks for, count an AI
   * resolution when no human ever replied (ADR-09), and drain the queue so the
   * slot this frees is filled now rather than on the next arrival — otherwise a
   * quiet period leaves customers queued behind an agent who is already free.
   *
   * The audit entry lives here rather than in the two callers so the hand-driven
   * close and the timeout sweep cannot drift into disagreeing about whether an
   * archive is worth recording — the same reason `#emitDeactivation` is shared.
   */
  async #closeConversation(
    tx: TenantClient,
    tenant: TenantContext,
    chat: ChatRow,
    thread: { id: string; createdAt: Date; firstResponseAt: Date | null },
    close: {
      authorId: string | null;
      text: string;
      properties: Record<string, unknown>;
      audit: AuditContext;
      /** How a wait this close ends goes on the queue record (RP-04-S1). */
      queueOutcome: QueueEntryOutcome;
    },
  ): Promise<CloseResult> {
    const closedAt = new Date();
    // Who it frees and which queue it leaves, read under the row the close
    // writes — the copy the caller loaded may predate a drain's assignment.
    const [before] = await tx.$queryRaw<
      Array<{
        assignee_id: string | null;
        queue_position: number | null;
        queue_group_id: bigint | null;
      }>
    >`SELECT assignee_id, queue_position, queue_group_id FROM threads WHERE id = ${thread.id} FOR UPDATE`;
    await tx.thread.update({
      where: { id: thread.id },
      data: { active: false, closedAt, queuePosition: null, queuedAt: null },
    });
    await leaveQueue(tx, thread.id, close.queueOutcome, closedAt);
    // How the connection ended for the AI, for the day's later connections
    // (tm 294 · AI-02): handed over, left mid-question, or answered.
    await settleDailyDigest(tx, thread.id, closedAt);

    // Both clocks stop here (FR-MOD-11.5 · 11.5-d). Resolution is obvious; the
    // first-response one is the case that would otherwise never be judged from a
    // request — a conversation archived without anyone ever replying is a missed
    // first response, and nothing else in the lifecycle notices it. Measured
    // against the close because that is when the waiting demonstrably ended.
    const clock = await readClock(tx, tenant, closedAt);
    if (clock) {
      if (!thread.firstResponseAt) {
        await evaluateSla(tx, tenant, clock, {
          subjectType: 'thread',
          subjectId: thread.id,
          target: 'first_response',
          startedAt: thread.createdAt,
          stoppedAt: closedAt,
        });
      }
      await evaluateSla(tx, tenant, clock, {
        subjectType: 'thread',
        subjectId: thread.id,
        target: 'resolution',
        startedAt: thread.createdAt,
        stoppedAt: closedAt,
      });
    }
    await tx.chat.update({ where: { id: chat.id }, data: { active: false } });
    await tx.chatUser.updateMany({ where: { chatId: chat.id }, data: { present: false } });

    await this.#appendEvent(tx, {
      licenseId: tenant.licenseId,
      chatId: chat.id,
      threadId: thread.id,
      authorId: close.authorId,
      authorType: 'system',
      input: {
        type: 'system_message',
        text: close.text,
        recipients: 'all',
        properties: close.properties,
      },
    });

    // The archive itself, in the trail (FR-MOD-02.8 · NFR-S12). Same transaction
    // as the close, so a rollback takes the entry with it and no row ever claims
    // an archive that did not happen; and past the guards above, so a chat that
    // was already closed leaves no second line. The reason is read back off the
    // system event's properties rather than passed twice, so the trail and the
    // transcript can never disagree about *why* a conversation ended.
    //
    // PII-minimal: the chat, the thread that closed, and at most a one-word
    // reason. Never a message, a transcript or the customer.
    const closeReason = close.properties['reason'];
    await writeAuditEntry(tx, close.audit, {
      action: 'chat.archived',
      target: `chat:${chat.id}`,
      metadata: {
        thread_id: thread.id,
        ...(typeof closeReason === 'string' ? { reason: closeReason } : {}),
      },
    });

    const reloaded = await tx.chat.findUniqueOrThrow({
      where: { id: chat.id },
      include: chatInclude,
    });
    // ADR-09 / ADR-09a: a thread that closes with no agent-authored event and
    // no automatic hand-off resolved without a human. Counted here, in the same
    // transaction that closes it, so the billing figure and the conversation can
    // never disagree — and the archive's `handled_by` (AR-01) is the same
    // answer, written by the one statement the counter reads.
    if ((await recordHandledBy(tx, thread.id, this.billing.adr09aEffectiveAt)) === 'ai') {
      await recordAiResolution(tx, tenant, this.billing.aiOverageCents, this.billing.aiIncluded);
    }

    // The agent's freed slot goes to their teams' queues; a close of a waiting
    // connection renumbers the queue it left (ADR-08a §2.2).
    const drained = await this.routing.drainQueue(tx, tenant.licenseId, {
      freed: before?.assignee_id ? [before.assignee_id] : [],
      left: before?.queue_position != null ? [before.queue_group_id] : [],
    });
    return {
      detail: serialiseChat(reloaded),
      threadId: thread.id,
      audience: this.#audienceFor(chat),
      drained,
    };
  }

  /** Fan out a close: assign anyone the freed slot lets in, then notify the room. */
  async #publishDeactivation(
    tenant: TenantContext,
    chatId: string,
    result: CloseResult,
    requesterId: string | null,
  ): Promise<void> {
    for (const assignment of result.drained) {
      await this.publisher?.publish(
        tenant,
        'incoming_chat',
        { agentIds: [assignment.assigneeId] },
        {
          requester_id: null,
          chat: { id: assignment.chatId, thread: { id: assignment.threadId } },
        },
      );
    }

    await this.publisher?.publish(tenant, 'chat_deactivated', result.audience, {
      chat_id: chatId,
      thread_id: result.detail.thread?.id ?? null,
      requester_id: requesterId,
    });

    // A closed conversation drops its visitor out of the board's first source
    // entirely — back to `browsing` if their visit is still inside the live
    // window, off the board if it is not (FR-MOD-03.1.1). Anyone the drain just
    // handed a queued chat to moved as well, so they are announced too rather
    // than left for the backup poll.
    await publishTrafficChange(this.publisher, tenant, result.audience.customerId);
    for (const assignment of result.drained) {
      await publishTrafficChange(this.publisher, tenant, assignment.customerId);
    }
  }

  /**
   * Tell the outside world a conversation ended (FR-MOD-09.4). Shared by the
   * agent-driven close and the timeout sweep so the two cannot drift into
   * disagreeing about whether a closed chat is worth announcing.
   *
   * The body matches the manifest's `chat_deactivated` sample
   * (`INTEGRATION_TRIGGERS`), which is what an integrator built their zap
   * against. `thread_id` is the connection that just closed (ID-02) — with
   * several connections under one chat a day, the chat id alone no longer
   * says which conversation ended.
   */
  async #emitDeactivation(
    tenant: TenantContext,
    chatId: string,
    result: CloseResult,
  ): Promise<void> {
    await this.automations?.emit(tenant, 'chat_deactivated', {
      chat_id: chatId,
      thread_id: result.threadId,
      active: false,
      created_at: result.detail.created_at,
    });
  }

  /**
   * Mail the closed conversation to the visitor and to the agent who handled it
   * (FR-MOD-08.7.4).
   *
   * Runs after the close transaction commits, never inside it: a mail is a
   * side effect that must not be able to roll a close back or hold its lock, and
   * it is a courtesy — the chat is already archived and delivered — so a failure
   * is swallowed rather than surfaced. Reads through `withTenant`, so RLS scopes
   * every lookup to this workspace exactly as the close was; a transcript can no
   * more cross a tenant boundary than the conversation it copies.
   *
   * The customer's copy honours the one invariant this service exists to keep —
   * an internal note never reaches a customer — because `renderTranscript` builds
   * it from the `all`-recipient events only.
   */
  async #emailTranscript(tenant: TenantContext, chatId: string, threadId: string): Promise<void> {
    const mailer = this.mailer;
    if (!mailer) return;

    try {
      const data = await withTenant(this.db, tenant, async (tx) => {
        const chat = await tx.chat.findUnique({
          where: { id: chatId },
          select: { customer: { select: { name: true, email: true, locale: true } } },
        });
        if (!chat) return null;

        const thread = await tx.thread.findUnique({
          where: { id: threadId },
          select: { assigneeId: true },
        });

        // Oldest-first so the transcript reads top to bottom like the chat did.
        const events = await tx.event.findMany({
          where: { threadId },
          orderBy: { createdAt: 'asc' },
          select: {
            authorType: true,
            authorId: true,
            text: true,
            type: true,
            recipients: true,
            createdAt: true,
          },
        });

        // Resolve agent authors to names in one query, so a transcript reads
        // "Ada:" rather than an opaque account id. Only agents need it — the
        // visitor and the AI are labelled from context.
        const agentIds = [
          ...new Set(
            events
              .filter((e) => e.authorType === 'agent' && e.authorId)
              .map((e) => e.authorId as string),
          ),
        ];
        const accounts = agentIds.length
          ? await tx.account.findMany({
              where: { id: { in: agentIds } },
              select: { id: true, name: true },
            })
          : [];
        const nameById = new Map(accounts.map((a) => [a.id, a.name]));

        // The assignee's address and their per-license e-mail opt-in, read
        // together the way `notifyAssignee` does so the decision has both.
        let assignee: { email: string | null; name: string | null; emailEnabled: boolean } | null =
          null;
        let assigneeLocale: MailLocale = 'en';
        if (thread?.assigneeId) {
          const [account, membership] = await Promise.all([
            tx.account.findUnique({
              where: { id: thread.assigneeId },
              select: { email: true, name: true },
            }),
            tx.agentMembership.findUnique({
              where: {
                licenseId_agentId: { licenseId: tenant.licenseId, agentId: thread.assigneeId },
              },
              select: { notifyEmail: true, locale: true },
            }),
          ]);
          assignee = {
            email: account?.email ?? null,
            name: account?.name ?? null,
            emailEnabled: membership?.notifyEmail ?? true,
          };
          assigneeLocale = isMailLocale(membership?.locale) ? membership.locale : 'en';
        }

        // The frame of both copies (tm 265): whose conversation it was, and the
        // time zone its times are read in.
        const organization = await tx.organization.findUnique({
          where: { id: tenant.organizationId },
          select: { name: true, timezone: true },
        });

        return {
          customer: chat.customer,
          // The visitor's copy is written in the language their widget showed
          // (WG-02). The mail templates have two languages; a visitor on any
          // other widget language reads English, as every visitor did before.
          customerLocale: (isMailLocale(chat.customer?.locale)
            ? chat.customer.locale
            : 'en') as MailLocale,
          assignee,
          assigneeLocale,
          events,
          nameById,
          workspaceName: organization?.name ?? 'SiyahTuş',
          timeZone: organization?.timezone ?? 'UTC',
        };
      });
      if (!data) return;

      const recipients = transcriptRecipients({
        customer: { email: data.customer?.email ?? null, name: data.customer?.name ?? null },
        assignee: data.assignee,
      });
      if (recipients.length === 0) return;

      const lines: TranscriptLine[] = data.events.map((e) => ({
        authorType: e.authorType,
        authorName:
          e.authorType === 'agent' && e.authorId ? (data.nameById.get(e.authorId) ?? null) : null,
        text: e.text,
        type: e.type,
        recipients: e.recipients,
        createdAt: e.createdAt,
      }));

      for (const recipient of recipients) {
        const content = renderTranscript({
          audience: recipient.party,
          chatId,
          customerName: data.customer?.name ?? null,
          lines,
          frame: {
            workspaceName: data.workspaceName,
            timeZone: data.timeZone,
            // The team's copy reads in the assignee's panel language, the
            // visitor's in the language their widget showed (WG-02).
            locale: recipient.party === 'team' ? data.assigneeLocale : data.customerLocale,
          },
        });
        // Nothing worth sending this party (e.g. a chat of only system events).
        if (!content) continue;
        // Each party on its own (tm 255.4): `deliver` does not throw, so the
        // visitor's copy failing no longer costs the agent theirs. The carrier
        // logs its own failure; this service holds no logger to add to it. The
        // agent-archive route hands in `backgroundMail.asMailer` (tm 256.4), so
        // there this returns as soon as the copy is handed over and the route's
        // callback logs the outcome.
        //
        // The visitor's copy is `chat_transcript` (tm 257.14): it leaves the
        // workspace, to an address a visitor typed, and counts against the
        // external daily cap. The team's copy goes to a teammate.
        await deliver(mailer, {
          to: recipient.to,
          licenseId: tenant.licenseId,
          kind: recipient.party === 'customer' ? 'chat_transcript' : 'notification',
          ...content,
        });
      }
    } catch {
      // Best-effort: the conversation is closed and already delivered, and this
      // service holds no logger. A transcript that fails to send must not turn a
      // successful close into an error the caller sees.
    }
  }

  /**
   * Reopen an archived conversation (FR-MOD-02.8), with a new connection
   * (`agent_reopen`) assigned to whoever reopened it.
   *
   * Where that connection goes is the conversation's day (ID-02 · tm 286.3,
   * 05 coding logic 3; ID-02-S6 — `reopensInPlace`):
   *
   *   - a chat filed under today, or under no day (opened before the daily
   *     model, so it keeps that model), is reopened in place — as every reopen
   *     was before ID-02;
   *   - a chat filed under an earlier day is not: a day that has ended gains no
   *     connection. The conversation continues under the member's chat for
   *     today — reopened with a further connection if the member has one,
   *     opened if not — its "Chat reopened" line naming the chat it came from
   *     (`continued_from_chat_id`), and the reopened chat's teams joining
   *     today's access (ID-02-S7). The answer is today's chat, a different id
   *     the caller moves to.
   *
   * Either way the member has one open conversation at most: a reopen while
   * another is open is refused, as it always was. Announced like any opening —
   * an arrival to the inboxes and the board, and outside as `thread_started`,
   * or `chat_started` when it opened the day.
   *
   * `audit` is required for the same reason `deactivate`'s is: this is the
   * transition that makes a read-only transcript writable again, and it is half
   * of the record the requirement asks for — an archive nobody can see being
   * undone is the more dangerous half to lose.
   */
  async resume(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    audit: AuditContext,
  ): Promise<ChatDetail> {
    const now = this.now();
    let outcome: ResumeOutcome;
    try {
      outcome = await this.#resumeInTransaction(tenant, principal, chatId, audit, now);
    } catch (error) {
      // Two agents reopening at once: the loser runs once more and is told the
      // conversation is already open — a 409 it can act on, not a 500.
      if (!isConnectionRace(error)) throw error;
      outcome = await this.#resumeInTransaction(tenant, principal, chatId, audit, now);
    }

    const detail = serialiseChat(outcome.chat);
    await this.#announceOpenedConnection(
      tenant,
      principal,
      outcome.chat,
      detail,
      outcome.createdChat ? null : { threadId: outcome.threadId, openedVia: 'agent_reopen' },
    );
    return detail;
  }

  async #resumeInTransaction(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    audit: AuditContext,
    now: Date,
  ): Promise<ResumeOutcome> {
    const actorId = actorOf(principal);

    return withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      if (chat.active) throw ApiError.chatInactive('Chat is already active.');

      // Reopening the *same* customer with a different chat would violate the
      // one-active-chat rule; the database would refuse it, so check first and
      // report something the caller can act on.
      const otherActive = await tx.chat.findFirst({
        where: { customerId: chat.customerId, active: true },
        select: { id: true },
      });
      if (otherActive) {
        throw ApiError.chatInactive(`Customer already has an active chat (${otherActive.id}).`);
      }

      // The new connection continues the conversation that was reopened, so it
      // goes to that conversation's team: its latest connection's, or its only
      // team when none was recorded.
      const groupId =
        chat.threads[0]?.groupId ?? connectionGroup(chat.access.map((a) => a.groupId));
      const reopenedLine: ConnectionMarker = {
        authorId: actorId,
        text: 'Chat reopened',
        recipients: 'all',
        properties: { system_event: 'chat_resumed' },
      };
      const day = await resolveLocalDay(tx, now);

      if (reopensInPlace({ chatDay: localDayOf(chat.localDay), today: day.key })) {
        // Conditional, so a second agent reopening at the same moment loses
        // here and is answered "already active" on the retry.
        const reopened = await tx.chat.updateMany({
          where: { id: chat.id, active: false },
          data: { active: true },
        });
        if (reopened.count === 0) throw new ConnectionRaceLost('the chat was reopened');

        const threadId = await this.#allocateThreadId(tx);
        await tx.thread.create({
          data: {
            id: threadId,
            chatId: chat.id,
            licenseId: tenant.licenseId,
            active: true,
            assigneeId: actorId,
            groupId,
            openedVia: 'agent_reopen',
          },
        });
        await tx.chatUser.updateMany({
          where: { chatId: chat.id, userType: 'customer' },
          data: { present: true },
        });
        await this.#appendMarker(tx, tenant, chat.id, threadId, reopenedLine);

        // The other half of the lifecycle record (FR-MOD-02.8 · NFR-S12), on
        // the same terms as the archive: inside the transaction that reopens,
        // past the guard that refuses an already-active chat, and carrying the
        // *new* thread — the one the transcript can be written to again — since
        // that is what separates this reopening from any earlier one of the
        // same chat.
        await writeAuditEntry(tx, audit, {
          action: 'chat.reopened',
          target: `chat:${chat.id}`,
          metadata: { thread_id: threadId },
        });

        const reloaded = await tx.chat.findUniqueOrThrow({
          where: { id: chat.id },
          include: chatInclude,
        });
        return { chat: reloaded, createdChat: false, threadId };
      }

      // An earlier day (ID-02-S6): continued under today's chat. The line that
      // opens the new connection says where it came from, and so does the
      // trail — the entry is today's chat's (that is the transcript that
      // became writable), naming the chat that was reopened.
      const route: ConnectionRoute = {
        groupIds: chat.access.map((a) => a.groupId),
        assigneeId: actorId,
        queuePosition: null,
        groupId,
      };
      const continued = { [CONTINUED_FROM_CHAT_PROPERTY]: chat.id };
      const marker: ConnectionMarker = {
        ...reopenedLine,
        properties: { ...reopenedLine.properties, ...continued },
      };
      const dayChat = await tx.chat.findFirst({
        where: { customerId: chat.customerId, localDay: day.date },
        include: chatInclude,
      });

      let todayId: string;
      let threadId: string;
      if (dayChat) {
        todayId = dayChat.id;
        // The reopened conversation brings its day's brand into today's chat.
        await this.#keepChatBrand(tx, dayChat, chat.brandId ?? undefined);
        ({ threadId } = await this.#openFurtherConnection(tx, tenant, dayChat, {
          openedVia: 'agent_reopen',
          route: async () => route,
          marker,
          audit: { context: audit, action: 'chat.reopened', metadata: continued },
        }));
      } else {
        const created = await this.#createChatWithThread(tx, {
          licenseId: tenant.licenseId,
          customerId: chat.customerId,
          ...route,
          day,
          openedVia: 'agent_reopen',
          // It continues the reopened conversation, so it is that day's brand.
          brandId: chat.brandId,
        });
        todayId = created.id;
        threadId = created.threads[0]!.id;
        await this.#appendMarker(tx, tenant, todayId, threadId, marker);
        await writeAuditEntry(tx, audit, {
          action: 'chat.reopened',
          target: `chat:${todayId}`,
          metadata: { thread_id: threadId, ...continued },
        });
      }

      const today = await tx.chat.findUniqueOrThrow({
        where: { id: todayId },
        include: chatInclude,
      });
      return { chat: today, createdChat: dayChat === null, threadId };
    });
  }

  /** Append a connection's opening line (`ConnectionMarker`) as a system event. */
  async #appendMarker(
    tx: TenantClient,
    tenant: TenantContext,
    chatId: string,
    threadId: string,
    marker: ConnectionMarker,
  ): Promise<void> {
    await this.#appendEvent(tx, {
      licenseId: tenant.licenseId,
      chatId,
      threadId,
      authorId: marker.authorId,
      authorType: 'system',
      input: {
        type: 'system_message',
        text: marker.text,
        recipients: marker.recipients,
        properties: marker.properties,
      },
    });
  }

  async transfer(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    target: {
      groupId?: bigint;
      agentId?: string;
      reason: TransferReason;
      note?: string;
      /**
       * The AI's hand-over route's expertise (AI-12 §2 · tm 307.2): whoever in
       * the team takes it must hold it, now or from the queue.
       */
      requiredExpertiseId?: bigint | null;
      /** The member tried first when they can take it (AI-12 §1.5, a same-day return). */
      preferAgentId?: string | null;
    },
    options: HandOverOptions = {},
  ): Promise<ChatTransferResult> {
    if ((target.groupId === undefined) === (target.agentId === undefined)) {
      throw ApiError.validation('Provide exactly one of group_id or agent_id.');
    }
    const actorId = actorOf(principal);
    const note = target.note?.trim() || null;

    const result = await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      const thread = chat.threads.find((t) => t.active);
      if (!chat.active || !thread) throw ApiError.chatInactive('Cannot transfer a closed chat.');

      let handOff: TeamHandOff = { outcome: 'assigned', assigneeId: target.agentId ?? '' };
      let unstaffed = false;
      if (target.groupId !== undefined) {
        const group = await tx.group.findUnique({
          where: { licenseId_id: { licenseId: tenant.licenseId, id: target.groupId } },
          select: { id: true, topicRole: true, _count: { select: { agents: true } } },
        });
        if (!group) throw new ApiError('group_not_found', 'Team not found.');
        // A team nobody belongs to would hold the conversation for nobody, ever
        // (IN-04: a team without members is not a choice).
        if (group._count.agents === 0) {
          throw new ApiError('group_unavailable', 'That team has no members.');
        }
        // The person picking it up must not have to ask the player again
        // (IN-04-S2). A person's hand-off only: the AI's carries its card.
        if (principal.kind === 'agent' && !note && transferNoteRequired(group.topicRole)) {
          throw ApiError.validation('A note is required when handing a conversation to this team.');
        }

        await tx.chatAccess.deleteMany({ where: { chatId: chat.id } });
        await tx.chatAccess.create({ data: { chatId: chat.id, groupId: group.id } });
        // Someone in the receiving team has it now, or it waits in that team's
        // queue (IN-04 · IN-04-S1) — never unassigned and unqueued, which no
        // drain would ever pick up. The open connection belongs to that team
        // (`threads.group_id`, ID-02 · tm 286.3); an agent hand-off below
        // leaves the team as it was. A person handing it off means "someone
        // else": neither them nor whoever held it. The AI's hand-off goes to
        // the team as routing would — the agent it was opened to included.
        const exclude =
          principal.kind === 'agent'
            ? [actorId, thread.assigneeId].filter((id): id is string => id !== null)
            : [];
        handOff = await this.routing.assignWithinGroup(tx, tenant.licenseId, group.id, thread.id, {
          exclude,
          requiredExpertiseId: target.requiredExpertiseId ?? null,
          prefer: target.preferAgentId ?? null,
        });
        // Nobody trained could take it (IN-04-S1 · AI-12-S3): the Responsible
        // Gambling team's queue, or a route's expertise nobody free holds.
        unstaffed =
          handOff.outcome === 'queued' &&
          (group.topicRole === RESPONSIBLE_GAMBLING_ROLE || target.requiredExpertiseId != null);
      } else {
        const membership = await tx.agentMembership.findUnique({
          where: {
            licenseId_agentId: { licenseId: tenant.licenseId, agentId: target.agentId! },
          },
          select: { routingStatus: true, suspended: true },
        });
        if (!membership || membership.suspended) throw ApiError.notFound('Agent not found.');
        if (membership.routingStatus === 'offline') {
          throw new ApiError('group_unavailable', 'That agent is offline.');
        }

        await tx.thread.update({
          where: { id: thread.id },
          data: { assigneeId: target.agentId! },
        });
        await leaveQueue(tx, thread.id, 'transferred');
        await tx.chatUser.upsert({
          where: { chatId_userId: { chatId: chat.id, userId: target.agentId! } },
          create: {
            chatId: chat.id,
            userId: target.agentId!,
            userType: 'agent',
            present: true,
          },
          update: { present: true },
        });
      }

      await this.#appendEvent(tx, {
        licenseId: tenant.licenseId,
        chatId: chat.id,
        threadId: thread.id,
        authorId: actorId,
        authorType: 'system',
        input: {
          type: 'system_message',
          text: 'Chat transferred',
          recipients: 'all',
          properties: {
            ...options.properties,
            system_event: 'chat_transferred',
            reason: target.reason,
            outcome: handOff.outcome,
            ...(target.groupId !== undefined
              ? { group_id: Number(target.groupId) }
              : { agent_id: target.agentId }),
          },
        },
      });
      // What the receiving side should know, for the agents only (IN-04): an
      // internal note in the transcript, as the composer writes one.
      const noteEvent = note
        ? await this.#appendEvent(tx, {
            licenseId: tenant.licenseId,
            chatId: chat.id,
            threadId: thread.id,
            authorId: actorId,
            authorType: principal.kind === 'agent' ? 'agent' : 'system',
            input: {
              type: principal.kind === 'agent' ? 'message' : 'system_message',
              text: note,
              recipients: 'agents',
              properties: { transfer_note: true },
            },
          })
        : null;

      // A transferred chat is a person's: the AI stays silent on it (AI-11),
      // the AI's own hand-over included.
      const mode = await this.#changeAiMode(
        tx,
        tenant,
        chat,
        thread.id,
        actorId,
        {
          to: 'human',
          reason:
            target.reason === 'ai_handoff' || target.reason === 'bot_handoff'
              ? target.reason
              : 'transfer',
        },
        options.properties ? { properties: options.properties } : {},
      );
      // After the routing above, so the only queue it can move up is the one
      // the transfer left it in.
      const priority =
        handOff.outcome === 'queued' && options.queuedPriority
          ? morePressing(options.priority ?? 'normal', options.queuedPriority)
          : options.priority;
      if (priority) {
        await this.routing.raisePriority(
          tx,
          tenant.licenseId,
          thread.id,
          priority,
          options.priorityReason ?? null,
        );
      }

      // In the transfer's transaction: a transfer refused rolls it back too.
      await options.alongside?.(tx);

      // The supervisors hear of a Responsible Gambling conversation nobody
      // could take (IN-04-S1), in the transfer's own push.
      const supervisors = unstaffed
        ? await tx.agentMembership.findMany({
            where: {
              licenseId: tenant.licenseId,
              suspended: false,
              role: { in: AGENT_ROLES.filter((role) => roleAtLeast(role, 'admin')) },
            },
            select: { agentId: true },
          })
        : [];

      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      const before = this.#audienceFor(chat);
      const after = this.#audienceFor(reloaded);
      const teamAssigned: DrainedAssignment | null =
        target.groupId !== undefined && handOff.outcome === 'assigned'
          ? {
              chatId: chat.id,
              threadId: thread.id,
              assigneeId: handOff.assigneeId,
              customerId: chat.customerId,
            }
          : null;
      const detail: ChatTransferResult = {
        ...serialiseChat(reloaded),
        outcome: handOff.outcome,
        visible_to_caller: canSeeChat(visibility, reloaded),
      };
      return {
        detail,
        // Union of before and after: the losing team needs to be told the chat
        // left as much as the winning team needs to be told it arrived.
        audience: {
          groupIds: [...before.groupIds, ...after.groupIds],
          agentIds: [...before.agentIds, ...after.agentIds, ...supervisors.map((s) => s.agentId)],
          customerId: chat.customerId,
        },
        threadId: thread.id,
        // Who was responsible before the hand-off and who is now — the conflict
        // warning below only fires when this actually changed to a new agent.
        oldAssigneeId: thread.assigneeId ?? null,
        newAssigneeId: target.agentId ?? teamAssigned?.assigneeId ?? null,
        modeNote: mode?.note ?? null,
        // Whoever the team hand-off gave it to is told as the AI's hand-over
        // tells one (`#announceHandover`): their inbox, and the board.
        handover: mode?.assigned ?? teamAssigned,
        noteEvent,
        noteAudience: after,
        unstaffed,
      };
    });

    const push: ChatTransferredPush = {
      chat_id: chatId,
      thread_id: result.threadId,
      requester_id: actorId,
      reason: target.reason,
      transferred_to: {
        group_ids: target.groupId !== undefined ? [Number(target.groupId)] : [],
        agent_ids: target.agentId !== undefined ? [target.agentId] : [],
      },
      outcome: result.detail.outcome,
      assignee_id: result.newAssigneeId,
      ...(result.unstaffed ? { unstaffed: true } : {}),
    };
    await this.publisher?.publish(tenant, 'chat_transferred', result.audience, push);
    if (result.noteEvent) {
      await this.#announceEvent(tenant, {
        event: result.noteEvent,
        recipients: 'agents',
        audience: result.noteAudience,
      });
    }
    // To both teams, as the transfer itself is: the losing team's open view
    // should hear the AI stopped as much as the winning team's.
    if (result.modeNote) {
      await this.#announceAiMode(tenant, { ...result.modeNote, audience: result.audience });
    }
    await this.#announceHandover(tenant, result.handover);

    // The board's headline column is **Chatting with** (FR-MOD-03.1.3), and a
    // hand-off is precisely what changes the name in it; a transfer to a team
    // with nobody free additionally puts the row back in `queued`.
    await publishTrafficChange(this.publisher, tenant, result.audience.customerId);

    await this.automations?.emit(tenant, 'chat_transferred', {
      chat_id: chatId,
      group_id: target.groupId !== undefined ? Number(target.groupId) : null,
      agent_id: target.agentId ?? null,
      reason: target.reason,
    });

    // FR-MOD-08.6.3 — a hand-off that lands a chat on a new agent while someone
    // else is still composing in it is a conflict; warn both sides. After the
    // commit and strictly best-effort, like every other push: a warning that
    // fails to go out must never undo a transfer that already happened.
    await this.#warnTransferConflict(tenant, chatId, result);

    return result.detail;
  }

  /**
   * Warn the incoming agent and everyone still composing when a transfer moves a
   * chat onto a new assignee mid-reply (FR-MOD-08.6.3, API surface).
   *
   * The composer registry `08.6.3-conflict-b` keeps in Redis is read here, never
   * written: this path only observes who is composing. Two safeguards keep it
   * from leaking or breaking anything:
   *
   *  - **Audience is fenced to the chat's own.** The recipients are the new
   *    assignee plus the composing agents, intersected with the agents the chat
   *    already entitles (its before-and-after audience). An agent the transfer
   *    just cut off — or one that was never entitled — cannot be told who is
   *    working which conversation (NFR-S4).
   *
   *  - **Every failure is swallowed.** The read sits on top of a committed
   *    transfer and an advisory, ephemeral warning; a Redis blink or a missing
   *    publisher is a no-op, never a failed transfer.
   */
  async #warnTransferConflict(
    tenant: TenantContext,
    chatId: string,
    result: {
      threadId: string;
      audience: { agentIds: string[] };
      oldAssigneeId: string | null;
      newAssigneeId: string | null;
    },
  ): Promise<void> {
    const newAssignee = result.newAssigneeId;
    // Only an agent hand-off that changed the responsible agent can strand a
    // second composer. A team transfer (no assignee) and a no-op re-assign to
    // the agent already on it cannot, so neither reads the registry.
    if (!newAssignee || newAssignee === result.oldAssigneeId) return;

    try {
      const composing = await this.#composingAgents(tenant, chatId);
      // The conflict is someone *other* than the just-assigned agent composing;
      // that agent typing in their own new chat is not a conflict.
      if (!composing.some((agent) => agent.agentId !== newAssignee)) return;

      // Target only the conflicting agents, and only those the chat's audience
      // already entitles — never widen delivery past who could see the chat.
      const entitled = new Set(result.audience.agentIds);
      const agentIds = [newAssignee, ...composing.map((agent) => agent.agentId)].filter(
        (id, index, all) => entitled.has(id) && all.indexOf(id) === index,
      );
      // The assignee alone is nobody to warn: if no composing agent survives the
      // entitlement fence, there is no live conflict left to surface.
      if (agentIds.length < 2) return;

      const now = Date.now();
      const payload: AgentConflictWarningPush = {
        chat_id: chatId,
        thread_id: result.threadId,
        agents: composing.map((agent) => ({
          agent_id: agent.agentId,
          since: new Date(agent.since).toISOString(),
        })),
        detected_at: new Date(now).toISOString(),
      };
      await this.publisher?.publish(tenant, 'agent_conflict_warning', { agentIds }, payload);
    } catch {
      // Best-effort: a committed transfer must not fail because the courtesy
      // warning on top of it did. The next keystroke re-detects on the RTM path.
    }
  }

  /**
   * The agents composing a reply in `chatId` right now, read from the licence-
   * scoped composer registry without mutating it. Members are the sorted set
   * `08.6.3-conflict-b` writes; the score is each agent's last-seen ms, so the
   * live window is exactly the members scored within `AGENT_COMPOSING_TTL`.
   */
  async #composingAgents(
    tenant: TenantContext,
    chatId: string,
  ): Promise<Array<{ agentId: string; since: number }>> {
    if (!this.redis.zrangebyscore) return [];
    // Keyed by our own tenant's licence, so the same chat id in another tenant
    // can never be read here — the cross-tenant fence is the key itself.
    const key = composerStateKey(tenant.licenseId, chatId);
    const floor = Date.now() - AGENT_COMPOSING_TTL_SECONDS * 1_000;
    const raw = await this.redis.zrangebyscore(key, floor, '+inf', 'WITHSCORES');
    const agents: Array<{ agentId: string; since: number }> = [];
    for (let i = 0; i + 1 < raw.length; i += 2) {
      agents.push({ agentId: String(raw[i]), since: Number(raw[i + 1]) });
    }
    return agents;
  }

  /**
   * A supervisor forcibly seizes a chat from whoever holds it (FR-MOD-08.6.3).
   *
   * This is deliberately *not* `transfer`: transfer is a consented, scope-gated
   * hand-off any chat-writer may perform; takeover is an authority action an
   * admin/owner takes over someone else's conversation, so the route gates it on
   * role and this method records it. Three properties are load-bearing, and are
   * why the read, the write and the audit entry all live in one transaction:
   *
   *  - **The race has exactly one winner.** Two supervisors seizing the same chat
   *    both read the current assignee, then re-assign *conditionally*
   *    (`updateMany where assigneeId = <the one they saw>`). Under READ COMMITTED
   *    the second update blocks on the first's row lock, re-checks its WHERE
   *    against the now-committed row, matches nothing and reports zero rows —
   *    which becomes `takeover_conflict` (409). No `SELECT … FOR UPDATE`, no lock
   *    ordering to get wrong.
   *  - **Authority and the write are one unit.** The role gate is at the route;
   *    the conditional re-assign and the audit entry commit together, so a
   *    seizure that happened is always recorded and one that lost records nothing.
   *  - **The previous holder is demoted, not evicted.** Their `chat_users` row
   *    stays (present=false) so the transcript and trail of who was there survive
   *    — the same shape a transfer that moves the assignee on leaves behind.
   */
  async takeover(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    reason: string | null,
    audit: AuditContext,
  ): Promise<ChatDetail> {
    const supervisorId = actorOf(principal);

    const result = await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      const thread = chat.threads.find((t) => t.active);
      if (!chat.active || !thread) throw ApiError.chatInactive('Cannot take over a closed chat.');

      const previousAssigneeId = thread.assigneeId;

      // Conditional re-assign: only if the assignee is still the one we just read.
      // A concurrent takeover that already moved it leaves zero rows here — the
      // loser of the race, answered with 409 rather than silently overwriting.
      const seized = await tx.thread.updateMany({
        where: { id: thread.id, assigneeId: previousAssigneeId },
        data: { assigneeId: supervisorId },
      });
      if (seized.count === 0) {
        throw new ApiError('takeover_conflict', 'Another supervisor took this chat over first.');
      }
      // Seizing a chat that still waited is how it got an agent (RP-04).
      await leaveQueue(tx, thread.id, 'assigned');

      // The supervisor is now present; the agent they took it from stays on the
      // chat as a non-present participant so the record of who was there survives.
      await tx.chatUser.upsert({
        where: { chatId_userId: { chatId: chat.id, userId: supervisorId } },
        create: { chatId: chat.id, userId: supervisorId, userType: 'agent', present: true },
        update: { present: true },
      });
      if (previousAssigneeId && previousAssigneeId !== supervisorId) {
        await tx.chatUser.updateMany({
          where: { chatId: chat.id, userId: previousAssigneeId, userType: 'agent' },
          data: { present: false },
        });
      }

      await this.#appendEvent(tx, {
        licenseId: tenant.licenseId,
        chatId: chat.id,
        threadId: thread.id,
        authorId: supervisorId,
        authorType: 'system',
        input: {
          type: 'system_message',
          text: 'Chat taken over',
          // Internal supervision, not a customer-facing routing change: kept to
          // agents so the visitor's transcript is not littered with it.
          recipients: 'agents',
          properties: {
            system_event: 'chat_taken_over',
            ...(previousAssigneeId ? { previous_assignee_id: previousAssigneeId } : {}),
            ...(reason ? { reason } : {}),
          },
        },
      });

      // Same transaction as the seize: a takeover that committed is always in the
      // trail, and a lost race writes nothing. PII-minimal — ids and an optional
      // supervisory note, never message content (NFR-S12).
      await writeAuditEntry(tx, audit, {
        action: 'chat.taken_over',
        target: `chat:${chat.id}`,
        metadata: {
          previous_assignee_id: previousAssigneeId,
          ...(reason ? { reason } : {}),
        },
      });

      // A person has the connection now: the AI stays silent on it (AI-11).
      const mode = await this.#changeAiMode(tx, tenant, chat, thread.id, supervisorId, {
        to: 'human',
        reason: 'takeover',
      });

      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      return {
        detail: serialiseChat(reloaded),
        // Union of before and after: the agent who lost the chat must be told it
        // left as much as the supervisor must be told it arrived.
        audience: {
          groupIds: [...this.#audienceFor(chat).groupIds, ...this.#audienceFor(reloaded).groupIds],
          agentIds: [...this.#audienceFor(chat).agentIds, ...this.#audienceFor(reloaded).agentIds],
          customerId: chat.customerId,
        },
        threadId: thread.id,
        previousAssigneeId,
        modeNote: mode?.note ?? null,
      };
    });

    await this.publisher?.publish(tenant, 'chat_taken_over', result.audience, {
      chat_id: chatId,
      thread_id: result.threadId,
      requester_id: supervisorId,
      previous_assignee_id: result.previousAssigneeId,
      new_assignee_id: supervisorId,
    } satisfies ChatTakenOverPush);
    // To the supervisor who just arrived as well as the agent who lost the chat.
    if (result.modeNote) {
      await this.#announceAiMode(tenant, { ...result.modeNote, audience: result.audience });
    }

    // Same reason as the hand-off above: **Chatting with** now names somebody
    // else (FR-MOD-03.1.1 · FR-MOD-03.1.3).
    await publishTrafficChange(this.publisher, tenant, result.audience.customerId);

    return result.detail;
  }

  /**
   * Give a chat's open connection back to the AI (tm 293.3 · AI-11 §6) —
   * `POST /chats/{chatId}/return-to-ai`. The AI answers the visitor's next
   * message; `note` reaches it with the conversation (the agents-only line,
   * which the AI's context loader reads), and `resume: 'fresh'` ends the
   * procedure it was in. Refused for a connection a risk flag keeps with a
   * person ({@link aiReturnBlockers}), whoever asks.
   *
   * In an AI-first workspace (tm 293.2) the connection leaves its assignee and
   * the queue as well — it is the AI's again, routed at the next hand-over
   * (`#routeHandover`) — and the caller becomes its supervisor, so it stays on
   * their Supervised list (05 AI-11 §6).
   */
  async returnToAi(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    request: { note: string | null; resume: AiReturnResume },
    audit: AuditContext,
  ): Promise<ChatAiModeResult> {
    return this.#handAiMode(tenant, principal, chatId, { to: 'ai', ...request }, audit);
  }

  /**
   * Hold the AI back on a chat's open connection (tm 293.3 · AI-11 §1) —
   * `POST /chats/{chatId}/pause-ai`. The AI stops answering; nobody is routed
   * and the assignment stays as it was. Only a connection the AI is answering
   * can be paused.
   */
  async pauseAi(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    request: { note: string | null },
    audit: AuditContext,
  ): Promise<ChatAiModeResult> {
    return this.#handAiMode(
      tenant,
      principal,
      chatId,
      { to: 'paused', note: request.note, resume: null },
      audit,
    );
  }

  /**
   * The two requests' one path. Who may (AI-11-S3, until RL-02's capability
   * `ai.conversation.return_to_ai`): the connection's assignee, or an admin or
   * owner — a team member cannot hand a colleague's chat to the AI. Checked
   * against the assignee read under the thread's row lock, the lock every mode
   * write takes (`ai-mode.ts`), so the person checked is the one whose
   * connection changes. In order: not found (404), closed (409), not theirs
   * (403), flagged (409), not an edge of the state machine (409).
   */
  async #handAiMode(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    request: { to: 'ai' | 'paused'; note: string | null; resume: AiReturnResume | null },
    audit: AuditContext,
  ): Promise<ChatAiModeResult> {
    if (principal.kind !== 'agent') {
      throw ApiError.authorization('Only a signed-in teammate can hand a chat to the AI.');
    }
    const actorId = principal.accountId;

    const result = await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);
      const thread = chat.threads.find((t) => t.active);
      if (!chat.active || !thread) throw ApiError.chatInactive('The chat is closed.');
      const ref = { chatId: chat.id, threadId: thread.id };

      const [locked] = await tx.$queryRaw<
        Array<{
          assignee_id: string | null;
          queue_position: number | null;
          queue_group_id: bigint | null;
          ai_mode: string | null;
        }>
      >`SELECT assignee_id, queue_position, queue_group_id, ai_mode FROM threads WHERE id = ${thread.id} FOR UPDATE`;
      if (!locked) throw ApiError.notFound('Chat not found.');

      if (!roleAtLeast(principal.role, 'admin') && locked.assignee_id !== actorId) {
        throw ApiError.authorization(
          request.to === 'ai'
            ? "Only the chat's assignee or an admin can give it back to the AI."
            : "Only the chat's assignee or an admin can pause the AI on it.",
        );
      }

      if (request.to === 'ai') {
        const flags = await aiReturnBlockers(tx, ref);
        if (flags.length > 0) {
          throw new ApiError('ai_return_blocked', 'A risk flag keeps this chat with a person.', {
            details: { risk_flags: flags },
          });
        }
      }

      const from = locked.ai_mode as AiConversationMode | null;
      const step = aiModeStep(from, request.to);
      if (step === 'refused') {
        throw new ApiError(
          'ai_mode_transition_refused',
          from === 'human'
            ? 'A person has this chat; the AI is not answering it.'
            : 'The AI has not answered in this chat.',
          { details: { ai_mode: from } },
        );
      }
      const unchanged: ChatAiModeResult = {
        chat_id: chat.id,
        thread_id: thread.id,
        ai_mode: request.to,
        previous_ai_mode: from,
        changed: false,
        assignee_id: locked.assignee_id,
      };
      if (step === 'same') return { body: unchanged, announce: null };

      const mode = await this.#changeAiMode(
        tx,
        tenant,
        chat,
        thread.id,
        actorId,
        { to: request.to, reason: request.to === 'ai' ? 'return_to_ai' : 'pause' },
        { note: request.note, properties: request.resume ? { resume: request.resume } : {} },
      );
      if (request.resume === 'fresh') await endAiProcedure(tx, ref);

      // AI-first: the connection is the AI's again, nobody's to answer and
      // nobody's to queue — the next hand-over routes it. Whoever held it
      // frees their slot, which the queue may fill as a close's does.
      let released: string | null = null;
      let drained: DrainedAssignment[] = [];
      if (request.to === 'ai' && (await opensAiFirst(tx))) {
        if (locked.assignee_id !== null || locked.queue_position !== null) {
          await tx.thread.update({
            where: { id: thread.id },
            data: { assigneeId: null, queuePosition: null, queuedAt: null },
          });
          await leaveQueue(tx, thread.id, 'transferred');
        }
        // A waiting connection leaves its team's queue (ADR-08a §2.1).
        const left = locked.queue_position !== null ? [locked.queue_group_id] : [];
        if (locked.assignee_id !== null) {
          released = locked.assignee_id;
          await tx.chatUser.updateMany({
            where: { chatId: chat.id, userId: released, userType: 'agent' },
            data: { present: false },
          });
          drained = await this.routing.drainQueue(tx, tenant.licenseId, {
            freed: [released],
            left,
          });
        } else if (locked.queue_position !== null && locked.queue_group_id !== null) {
          await this.routing.renumberQueue(tx, tenant.licenseId, locked.queue_group_id);
        }
        await this.#supervisions.register(tx, tenant.licenseId, principal, chat.id);
      }

      // An authority action on the conversation, as a takeover is: in the trail,
      // in its transaction. Ids and codes only — the note stays in the transcript.
      await writeAuditEntry(tx, audit, {
        action: request.to === 'ai' ? 'chat.ai_returned' : 'chat.ai_paused',
        target: `chat:${chat.id}`,
        metadata: {
          thread_id: thread.id,
          previous_ai_mode: from,
          ...(request.resume ? { resume: request.resume } : {}),
          ...(released ? { previous_assignee_id: released } : {}),
        },
      });

      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      return {
        body: {
          ...unchanged,
          changed: true,
          assignee_id: released ? null : locked.assignee_id,
        },
        announce: {
          // Before and after, as a takeover's: the agent the connection left
          // hears the AI has it as much as the supervisor who gave it back.
          audience: {
            groupIds: [
              ...this.#audienceFor(chat).groupIds,
              ...this.#audienceFor(reloaded).groupIds,
            ],
            agentIds: [
              ...this.#audienceFor(chat).agentIds,
              ...this.#audienceFor(reloaded).agentIds,
            ],
            customerId: chat.customerId,
          },
          note: mode?.note ?? null,
          released,
          drained,
        },
      };
    });

    const announce = result.announce;
    if (announce) {
      if (announce.note) {
        await this.#announceAiMode(tenant, { ...announce.note, audience: announce.audience });
      }
      for (const assignment of announce.drained) await this.#announceHandover(tenant, assignment);
      // **Chatting with** no longer names the agent who held it (FR-MOD-03.1.3).
      if (announce.released) {
        await publishTrafficChange(this.publisher, tenant, announce.audience.customerId);
      }
    }
    return result.body;
  }

  /**
   * Send a person to a connection the AI left unanswered (tm 293.6 · AI-11 §5)
   * — the `ai_stall` job's one write (`ai-stall.ts`). The connection moves to
   * `human` with reason `ai_failure` and is routed in the same transaction
   * (`#routeHandover`: the agent the member had earlier today if they can take
   * it, else the routing engine in its team, the queue included).
   *
   * Asked again under the thread's row lock, the lock the AI's own commit takes
   * (`claimAiTurn`): an answer that committed after the job listed the
   * connection, or a person who took it meanwhile, leaves it as it is — false.
   * An answer still being drafted loses: its commit finds the connection
   * `human` and rolls back unsent.
   *
   * No audit entry: nobody acted, and the line in the transcript plus the
   * conversation's `mode_reason` are the record, as for the AI's own hand-over.
   */
  async handOverStalledAi(
    tenant: TenantContext,
    ref: { chatId: string; threadId: string },
    cutoff: Date,
  ): Promise<boolean> {
    const result = await withTenant(this.db, tenant, async (tx) => {
      const chat = await tx.chat.findUnique({ where: { id: ref.chatId }, include: chatInclude });
      const thread = chat?.threads.find((t) => t.id === ref.threadId);
      if (!chat?.active || !thread?.active) return null;

      await tx.$queryRaw`SELECT 1 FROM threads WHERE id = ${thread.id} FOR UPDATE`;
      if (!(await aiStalled(tx, thread.id, cutoff))) return null;

      const mode = await this.#changeAiMode(tx, tenant, chat, thread.id, AI_MODE_SYSTEM_ACTOR, {
        to: 'human',
        reason: 'ai_failure',
      });
      if (!mode?.note) return mode;
      // Before and after the routing, as a takeover's: the agent it went to
      // hears the AI stopped as well as the team that watched it.
      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      const before = mode.note.audience;
      const after = this.#audienceFor(reloaded);
      return {
        ...mode,
        note: {
          ...mode.note,
          audience: {
            groupIds: [...new Set([...before.groupIds, ...after.groupIds])],
            agentIds: [...new Set([...before.agentIds, ...after.agentIds])],
            customerId: before.customerId,
          },
        },
      };
    });
    if (!result) return false;

    if (result.note) await this.#announceAiMode(tenant, result.note);
    await this.#announceHandover(tenant, result.assigned);
    return true;
  }

  /**
   * The AI hands a connection over without naming a team (tm 296.3 · AI-03):
   * a procedure's hand-over to a routing topic (#307 resolves topics to
   * teams), to no target, or to a team that cannot take it now. The connection
   * moves to `human` with `reason` — `ai_handoff`, or `ai_failure` when the
   * model could not answer — and is routed as the watchdog's is
   * (`#routeHandover`: nobody named a team), or into `options.groupId` when
   * the hand-over names the team it must wait in. Under the thread's row
   * lock, so a person who took it meanwhile keeps it: false.
   */
  async handOverFromAi(
    tenant: TenantContext,
    ref: { chatId: string; threadId: string },
    reason: 'ai_handoff' | 'ai_failure',
    options: HandOverOptions = {},
  ): Promise<boolean> {
    const result = await withTenant(this.db, tenant, async (tx) => {
      // What the hand-over must not happen without (the AI's risk flags, tm
      // 302.2) — written even when the chat closed meanwhile.
      await options.alongside?.(tx);
      const chat = await tx.chat.findUnique({ where: { id: ref.chatId }, include: chatInclude });
      const thread = chat?.threads.find((t) => t.id === ref.threadId);
      if (!chat?.active || !thread?.active) return null;

      await tx.$queryRaw`SELECT 1 FROM threads WHERE id = ${thread.id} FOR UPDATE`;
      const mode = await this.#changeAiMode(
        tx,
        tenant,
        chat,
        thread.id,
        AI_MODE_SYSTEM_ACTOR,
        { to: 'human', reason },
        options.properties ? { properties: options.properties } : {},
        options.groupId,
      );
      // After the routing above, as in `transfer`.
      if (options.priority) {
        await this.routing.raisePriority(
          tx,
          tenant.licenseId,
          thread.id,
          options.priority,
          options.priorityReason ?? null,
        );
      }
      if (!mode?.note) return mode;
      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      const before = mode.note.audience;
      const after = this.#audienceFor(reloaded);
      return {
        ...mode,
        note: {
          ...mode.note,
          audience: {
            groupIds: [...new Set([...before.groupIds, ...after.groupIds])],
            agentIds: [...new Set([...before.agentIds, ...after.agentIds])],
            customerId: before.customerId,
          },
        },
      };
    });
    if (!result) return false;

    if (result.note) await this.#announceAiMode(tenant, result.note);
    await this.#announceHandover(tenant, result.assigned);
    return true;
  }

  async tagThread(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    tagName: string,
  ): Promise<string[]> {
    return withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);
      const thread = chat.threads[0];
      if (!thread) throw ApiError.notFound('Thread not found.');

      const normalised = tagName.trim().toLowerCase();
      if (!normalised) throw ApiError.validation('Tag must not be empty.');

      // Tags are created on demand: forcing a separate "create tag" call before
      // tagging is friction with no safety benefit.
      const tag = await tx.tag.upsert({
        where: { licenseId_name: { licenseId: tenant.licenseId, name: normalised } },
        create: { licenseId: tenant.licenseId, name: normalised, authorId: actorOf(principal) },
        update: {},
        select: { id: true },
      });

      await tx.threadTag.upsert({
        where: { threadId_tagId: { threadId: thread.id, tagId: tag.id } },
        create: { threadId: thread.id, tagId: tag.id },
        update: {},
      });

      const tags = await tx.threadTag.findMany({
        where: { threadId: thread.id },
        include: { tag: { select: { name: true } } },
      });
      return tags.map((t) => t.tag.name).sort();
    });
  }

  async untagThread(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    tagName: string,
  ): Promise<void> {
    await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);
      const thread = chat.threads[0];
      if (!thread) throw ApiError.notFound('Thread not found.');

      const tag = await tx.tag.findUnique({
        where: {
          licenseId_name: { licenseId: tenant.licenseId, name: tagName.trim().toLowerCase() },
        },
        select: { id: true },
      });
      if (!tag) throw ApiError.notFound('Tag not found.');

      const removed = await tx.threadTag.deleteMany({
        where: { threadId: thread.id, tagId: tag.id },
      });
      if (removed.count === 0) throw ApiError.notFound('Tag is not applied to this thread.');
    });
  }

  async markSeen(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    seenUpTo: Date,
  ): Promise<void> {
    await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'read');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);
      const userId = actorOf(principal);
      const userType = principal.kind === 'customer' ? 'customer' : 'agent';

      await tx.chatUser.upsert({
        where: { chatId_userId: { chatId: chat.id, userId } },
        create: { chatId: chat.id, userId, userType, seenUpTo, present: true },
        // Never move the marker backwards: an out-of-order request would
        // resurrect unread badges the agent already cleared.
        update: { seenUpTo },
      });
    });
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  async #loadVisibleChat(tx: TenantClient, visibility: ChatVisibility, chatId: string) {
    const chat = await tx.chat.findUnique({ where: { id: chatId }, include: chatInclude });
    // RLS already excludes other tenants; this covers the in-tenant case where
    // the caller's teams do not include the chat. Both answer 404.
    if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');
    return chat;
  }

  /**
   * The customer's most recent visit for this license, shaped for the Details
   * panel. Scoped to the license (not only the tenant RLS context): a customer
   * who wrote to two workspaces of one company is one person, and the chat being
   * read must show only the visit that belongs to its workspace.
   */
  async #latestVisitor(
    tx: TenantClient,
    licenseId: bigint,
    customerId: string,
  ): Promise<ChatVisitor | null> {
    const visit = await tx.visit.findFirst({
      where: { customerId, licenseId },
      orderBy: { startedAt: 'desc' },
      select: {
        cameFrom: true,
        pages: true,
        os: true,
        browser: true,
        ip: true,
        countryCode: true,
        city: true,
        startedAt: true,
        endedAt: true,
      },
    });
    if (!visit) return null;

    return {
      visited_pages: visitedPagesOf(visit.pages),
      visit_info: {
        device: composeDevice(visit.browser, visit.os),
        referrer: visit.cameFrom,
        duration_seconds: visitDurationSeconds(visit.startedAt, visit.endedAt),
        ip: visit.ip,
        country_code: visit.countryCode,
        city: visit.city,
        ongoing: visit.endedAt === null,
      },
    };
  }

  async #findEventById(tenant: TenantContext, eventId: string): Promise<SerialisedEvent | null> {
    return withTenant(this.db, tenant, async (tx) => {
      const rows = await tx.$queryRaw<RawEvent[]>`
        SELECT id, chat_id, thread_id, type, text, author_id, author_type,
               recipients, attachment_url, properties, created_at
        FROM events WHERE id = ${eventId} LIMIT 1
      `;
      return rows[0] ? serialiseRawEvent(rows[0]) : null;
    });
  }

  /**
   * Append an event, allocating its sequence number atomically.
   *
   * `UPDATE ... RETURNING` makes the increment and the read one operation, so
   * two concurrent sends cannot both observe the same value and mint colliding
   * ids — which is what a read-then-write would allow.
   */
  /**
   * The warning a player's message earns when it carried a secret (tm 300.2 ·
   * AI-26 §4): a `system_message` addressed to `all`, in the player's language,
   * once per chat per type — a player who pastes their password twice is told
   * once, and told again only about a kind of secret not yet warned about.
   *
   * Inside the message's transaction, after its append: the append holds the
   * chat's row lock (`last_event_at`), so two messages racing on one chat
   * read each other's warning rather than both writing it. Null when nothing
   * new is owed — not a player's message, nothing warned about, or every type
   * warned about already.
   */
  async #warnSensitive(
    tx: TenantClient,
    tenant: TenantContext,
    input: {
      chatId: string;
      threadId: string;
      customerId: string;
      authorType: string;
      event: SerialisedEvent;
    },
  ): Promise<SerialisedEvent | null> {
    if (input.authorType !== 'customer' || input.event.recipients !== 'all') return null;
    const owed = sensitiveWarningTypes(readSensitiveTypes(input.event.properties));
    if (owed.length === 0) return null;

    const warned = await tx.$queryRaw<Array<{ type: string }>>`
      SELECT DISTINCT jsonb_array_elements_text(properties->${SENSITIVE_TYPES_PROPERTY}) AS type
      FROM events
      WHERE chat_id = ${input.chatId}
        AND type = 'system_message'
        AND properties->>'system_event' = ${SENSITIVE_WARNING_SYSTEM_EVENT}
    `;
    const already = new Set(warned.map((row) => row.type));
    const fresh = owed.filter((type) => !already.has(type));
    if (fresh.length === 0) return null;

    const customer = await tx.customer.findUnique({
      where: { id: input.customerId },
      select: { locale: true },
    });
    return this.#appendEvent(tx, {
      licenseId: tenant.licenseId,
      chatId: input.chatId,
      threadId: input.threadId,
      authorId: null,
      authorType: 'system',
      input: {
        type: 'system_message',
        text: sensitiveWarningText(customer?.locale),
        recipients: 'all',
        properties: { system_event: SENSITIVE_WARNING_SYSTEM_EVENT },
        sensitiveTypes: fresh,
      },
    });
  }

  /** After commit, like every event: the warning reaches the widget and the inbox. */
  async #announceWarning(
    tenant: TenantContext,
    chat: AudienceSource,
    warning: SerialisedEvent | null,
  ): Promise<void> {
    if (!warning) return;
    await this.#announceEvent(tenant, {
      event: warning,
      recipients: 'all',
      audience: this.#audienceFor(chat),
    });
  }

  async #appendEvent(
    tx: TenantClient,
    input: {
      licenseId: bigint;
      chatId: string;
      threadId: string;
      authorId: string | null;
      authorType: string;
      input: NewEventInput;
    },
  ): Promise<SerialisedEvent> {
    // The conversation just moved, so the inbox list's sort key moves with it
    // (FR-MOD-02.2.2 — "RTM'de yukarı taşınır"). Written here rather than at the
    // six call sites because this is the one place an event is ever appended:
    // a send, a close, a reopen, a transfer and a takeover all come through
    // here, so all five bump the row, and nothing can append without bumping it.
    //
    // `now()` is the transaction timestamp, which is exactly what the INSERT
    // below takes as `created_at`'s DEFAULT — so the invariant this column
    // carries ("the created_at of the newest event") holds to the microsecond
    // rather than approximately.
    //
    // `GREATEST`, not assignment: two transactions appending to the same chat
    // commit in whatever order they finish, and the later-starting one must not
    // be able to drag the key backwards behind an event that is already newer.
    //
    // Before the `threads` bump on purpose. Closing a chat updates `chats`
    // first and then lands here, so taking the `chats` row first keeps every
    // path that writes both in the same order and leaves no lock cycle between
    // a reply and a close.
    await tx.$executeRaw`
      UPDATE chats SET last_event_at = GREATEST(last_event_at, now()) WHERE id = ${input.chatId}
    `;

    const updated = await tx.$queryRaw<Array<{ event_sequence: number }>>`
      UPDATE threads SET event_sequence = event_sequence + 1
      WHERE id = ${input.threadId}
      RETURNING event_sequence
    `;
    const sequence = updated[0]?.event_sequence;
    if (sequence === undefined) {
      // The thread vanished between the visibility check and here — a deletion
      // racing this write. Better a clear conflict than a mangled event id.
      throw ApiError.notFound('Thread not found.');
    }

    const eventId = buildEventId(input.threadId, sequence);
    // `properties` is free-form and comes from the caller, so the two keys the
    // edit path owns are stripped here — the one place an event is appended.
    // Without this a client could stamp `edited_at` on a message it is sending
    // for the first time and have every transcript label it corrected. The
    // masking badge's key is the server's for the same reason.
    const { [SENSITIVE_TYPES_PROPERTY]: _claimed, ...supplied } = input.input.properties ?? {};
    const properties = stripEditMarkers(supplied);

    // The last line before the text comes to rest (tm 300.2 · AI-26 · K12):
    // whoever wrote it, masked under their author's policy. The write paths
    // mask on arrival already; this catches a path that did not — a bot's
    // reply, an automation, a future caller — because every event is appended
    // here. A system line is the server's own words and is left as written.
    const author = sensitiveAuthorOf(input.authorType);
    const masked = author ? maskForWrite(input.input.text, author) : null;
    const text = masked ? masked.text : input.input.text;
    const types = new Set([...(input.input.sensitiveTypes ?? []), ...(masked?.types ?? [])]);
    if (types.size > 0) {
      properties[SENSITIVE_TYPES_PROPERTY] = SENSITIVE_TYPES.filter((type) => types.has(type));
    }

    const rows = await tx.$queryRaw<RawEvent[]>`
      INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_id,
                          author_type, recipients, attachment_url, properties)
      VALUES (${eventId}, ${input.threadId}, ${input.chatId}, ${input.licenseId},
              ${input.input.type}, ${text ?? null}, ${input.authorId},
              ${input.authorType}, ${input.input.recipients},
              ${input.input.attachmentUrl ?? null}, ${JSON.stringify(properties)}::jsonb)
      RETURNING id, chat_id, thread_id, type, text, author_id, author_type,
                recipients, attachment_url, properties, created_at
    `;

    return serialiseRawEvent(rows[0]!);
  }

  /**
   * Keep a chat's brand true when another connection comes into it (tm 309.1
   * · AI-14). `chats.brand_id` is the one brand the member came in through —
   * the knowledge filter answers a chat from that brand's sources and the
   * every-brand ones (tm 309.2). A connection through another brand's site, or
   * one whose brand is not known, leaves the day's chat with no single brand,
   * so it is cleared for good: one brand's rules must never answer another
   * brand's member, and "unknown" falls back to the every-brand sources. A
   * chat with no brand keeps none — unknown is already the safe state. An
   * agent's own start is not a way in and changes nothing.
   */
  async #keepChatBrand(
    tx: TenantClient,
    chat: { id: string; brandId: string | null },
    brandId: string | undefined,
  ): Promise<void> {
    if (chat.brandId === null || chat.brandId === brandId) return;
    await tx.chat.updateMany({ where: { id: chat.id }, data: { brandId: null } });
  }

  /**
   * Open the member's chat for a day, with its first connection (ID-02).
   *
   * Every chat opens filed under a day since tm 286.3 — the visitor's message,
   * an agent's start and an agent's reopen of an earlier day all come here —
   * and `uq_chat_customer_day` refuses a second one for the same member and
   * day, which the callers' race retry turns into "join the winner's".
   */
  async #createChatWithThread(
    tx: TenantClient,
    input: ConnectionRoute & {
      licenseId: bigint;
      customerId: string;
      /** The conversation day to file the chat under, written once and never recomputed. */
      day: ConversationDay;
      /** How the chat's first connection opened (`threads.opened_via`). */
      openedVia: ConnectionOpenedVia;
      /** The brand the member came in through (`chats.brand_id`); null when unknown. */
      brandId?: string | null;
    },
  ) {
    const chatId = await this.#allocateChatId(tx);
    const threadId = await this.#allocateThreadId(tx);

    await tx.chat.create({
      data: {
        id: chatId,
        licenseId: input.licenseId,
        customerId: input.customerId,
        active: true,
        // The day and the zone it was counted in are one fact: both or neither
        // (`chats_local_day_tz_pair`).
        localDay: input.day.date,
        dayTz: input.day.timezone,
        brandId: input.brandId ?? null,
      },
    });

    if (input.groupIds.length > 0) {
      await tx.chatAccess.createMany({
        data: input.groupIds.map((groupId) => ({ chatId, groupId })),
        skipDuplicates: true,
      });
    }

    await tx.chatUser.create({
      data: { chatId, userId: input.customerId, userType: 'customer', present: true },
    });
    if (input.assigneeId) {
      await tx.chatUser.create({
        data: { chatId, userId: input.assigneeId, userType: 'agent', present: true },
      });
    }

    const queuedAt = new Date();
    await tx.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: input.licenseId,
        active: true,
        assigneeId: input.assigneeId,
        groupId: input.groupId,
        openedVia: input.openedVia,
        ...(input.queuePosition != null
          ? { queuePosition: input.queuePosition, queuedAt, queueGroupId: input.queueGroupId }
          : {}),
        ...(input.aiFirst ? { aiMode: 'ai' } : {}),
      },
    });
    if (input.queuePosition != null) {
      await enterQueue(tx, {
        licenseId: input.licenseId,
        threadId,
        groupId: queueGroup(input),
        enteredAt: queuedAt,
      });
    }

    return { id: chatId, threads: [{ id: threadId }] };
  }

  async #allocateChatId(tx: TenantClient): Promise<string> {
    return allocateId(tx, 'chats');
  }

  async #allocateThreadId(tx: TenantClient): Promise<string> {
    return allocateId(tx, 'threads');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * The team a queued connection waits for, on the queue record (RP-04): the
 * team whose queue it is in (`queue_group_id`, ADR-08a §2.1) — routing names
 * it outright — else the connection's own team, else the chat's first access
 * group.
 */
function queueGroup(route: {
  queueGroupId?: bigint | null;
  groupId: bigint | null;
  groupIds: readonly bigint[];
}): bigint | null {
  return route.queueGroupId ?? route.groupId ?? route.groupIds[0] ?? null;
}

/**
 * `ChatService.list`'s query, taking an already-open tenant transaction
 * directly rather than opening its own (via `withTenant`). `list()` itself is
 * a thin wrapper around this for its normal (request-scoped) callers; the MCP
 * `list_chats` tool (`services/mcp/tools/list-chats.ts`) calls this directly
 * with the transaction its caller (`routes/mcp.ts`) already has open, the same
 * way `TicketService.list` takes a `tx` — Prisma transactions do not nest, so
 * a second, independent `withTenant` inside an already-open one is not an
 * option.
 */
export async function listChatsInTenant(
  tx: TenantClient,
  principal: Principal,
  options: ChatListOptions,
): Promise<{ items: ChatSummary[]; total: number; nextPageId?: string }> {
  const visibility = await resolveVisibility(tx, principal, 'read');
  const cursor = decodeCursor(options.pageId);

  // Visibility is an OR. Folding it into the view's own filter would widen the
  // result rather than narrow it, so it goes into its own AND clause.
  const scope: Record<string, unknown>[] = [];

  const visibilityFilter = chatVisibilityFilter(visibility);
  if (Object.keys(visibilityFilter).length > 0) scope.push(visibilityFilter);

  // A team's queue tab. Its own AND clause too: the view's filter is also a
  // `threads: { some }`, and spread beside it one would overwrite the other.
  if (options.queueGroupId !== undefined) {
    scope.push({
      threads: {
        some: { active: true, queuePosition: { not: null }, queueGroupId: options.queueGroupId },
      },
    });
  }
  // How pressing (AI-12): its own AND clause, for the same reason.
  if (options.priority !== undefined) {
    scope.push({
      threads: { some: { active: true, priority: THREAD_PRIORITY_RANK[options.priority] } },
    });
  }

  // The channel view's own narrowing (FR-MOD-02.1.4), resolved to chat ids
  // before the page is read — see `chatIdsOnChannel` for why it is a separate
  // read and what that costs. It joins `where` rather than the cursor clause,
  // so `total` counts the channel too: a rail badge that ignored the filter
  // beside it is the "loaded window read as the real total" defect (tm 179.4)
  // wearing a different hat.
  const channelChatIds = options.channel
    ? await chatIdsOnChannel(tx, principal.licenseId, options.channel)
    : undefined;

  // Everything that describes *the view*, with the cursor deliberately left out
  // — this is what `total` counts. A total narrowed by the cursor would shrink
  // as the reader scrolled, which is the counter equivalent of the defect this
  // field exists to end (the console used to count the rows it had loaded).
  const where = {
    ...(options.customerId ? { customerId: options.customerId } : {}),
    ...(options.groupId !== undefined ? { access: { some: { groupId: options.groupId } } } : {}),
    // An empty set is a real answer, not a missing filter: `{ in: [] }` matches
    // nothing, which is exactly what "no conversation has arrived on this
    // channel yet" means. Spreading it away instead would silently widen the
    // channel view to every chat in the workspace.
    ...(channelChatIds !== undefined ? { id: { in: channelChatIds } } : {}),
    ...viewFilter(options.view, visibility.actorId),
    ...(scope.length > 0 ? { AND: scope } : {}),
  };

  // The keyset cursor is an OR too, and it nests *outside* the view rather than
  // joining `scope`: `{ AND: [where, cursor] }` is the spelling
  // `TicketService.list` and `CustomerService.list` already use, and it leaves
  // one object — `where` — as the single statement of what the view is. That
  // is what makes "the total counts the list" true by construction rather than
  // by two filters happening to agree.
  //
  // The key is `last_event_at`, which — unlike `created_at` — *moves*. That is
  // the whole point (FR-MOD-02.2.2), and it is also the one thing a keyset
  // cursor is normally chosen to avoid, so it is worth being precise about what
  // it costs. A page is "everything strictly older than this row", and the row
  // an event touches gets *newer*: it can only cross the boundary upwards, into
  // the pages already read. So the two failures a moving key threatens are not
  // symmetric here — a row can never be handed out twice by the same chain
  // (the next page excludes everything at or above the cursor), and the row
  // that moves up out of an unread page is missing from the chain until the
  // list re-reads its head, which is precisely what every push makes it do
  // (`useInbox.ts`, `refreshChatHeads`). Sorted oldest-first the direction
  // reverses and the client re-reads the whole loaded chain instead.
  const paged = cursor
    ? {
        AND: [
          where,
          {
            OR: [
              { lastEventAt: { [options.sort === 'newest' ? 'lt' : 'gt']: cursor.activityAt } },
              {
                lastEventAt: cursor.activityAt,
                id: { [options.sort === 'newest' ? 'lt' : 'gt']: cursor.id },
              },
            ],
          },
        ],
      }
    : where;

  const direction = options.sort === 'newest' ? 'desc' : 'asc';
  // Page and total together, the shape the two sibling lists already use. Not a
  // claim of parallelism — Prisma runs an interactive transaction on one
  // connection, so the count is a second round trip whose cost adds to the
  // page's (measured: ~1 ms of a 24 ms request over sixty rows, `chats.test.ts`
  // "NFR-P2 read budget"). What it buys is that both read this transaction's
  // snapshot, so the number beside the list can never describe another instant
  // than the rows in it.
  const [rows, total] = await Promise.all([
    tx.chat.findMany({
      where: paged,
      // Last activity, not creation time: a conversation the visitor just wrote
      // in belongs at the top of the list the agent is working down
      // (FR-MOD-02.2.2). `sort` (FR-MOD-02.2.1) picks the direction of the same
      // key, so "Oldest" reads as the least recently active first — the stale
      // end of the same axis, rather than a second meaning of order.
      //
      // Tie-break on id: `last_event_at` alone is not unique (two chats can be
      // touched inside one transaction timestamp), and a cursor built on a
      // non-unique column silently skips or repeats rows.
      orderBy: [{ lastEventAt: direction }, { id: direction }],
      take: options.limit + 1,
      include: CHAT_SUMMARY_INCLUDE,
    }),
    tx.chat.count({ where }),
  ]);

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const items = await summariseChats(tx, visibility, page);

  const last = page.at(-1);
  return {
    items,
    total,
    ...(hasMore && last
      ? { nextPageId: encodeCursor({ activityAt: last.lastEventAt, id: last.id }) }
      : {}),
  };
}

/**
 * `GET /chats?query=` (ID-07 · tm 333.3): the conversations whose messages
 * contain the query, newest match first, each summarised as the list
 * summarises it and carrying the match. The search decides membership, order,
 * `total` and the cursor (`event-search.ts`, `search_events` inside); the
 * summaries are read afterwards for exactly the conversations it returned,
 * under row level security as the list reads them, so a conversation that
 * vanished in between drops out rather than appearing empty.
 */
export async function searchChatsInTenant(
  tx: TenantClient,
  principal: Principal,
  options: MessageSearchInput,
): Promise<{ items: ChatSummary[]; total: number; nextPageId?: string }> {
  const result = await searchMessages(tx, principal, options);
  if (result.hits.length === 0) return { items: [], total: result.total };

  const visibility = await resolveVisibility(tx, principal, 'read');
  const rows = await tx.chat.findMany({
    where: { id: { in: result.hits.map((hit) => hit.chatId) } },
    include: CHAT_SUMMARY_INCLUDE,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = result.hits.flatMap((hit) => byId.get(hit.chatId) ?? []);
  const summaries = await summariseChats(tx, visibility, ordered);
  const matches = new Map(result.hits.map((hit) => [hit.chatId, hit.match]));
  return {
    items: summaries.map((summary) => {
      const match = matches.get(summary.id);
      return match ? { ...summary, match } : summary;
    }),
    total: result.total,
    ...(result.nextPageId ? { nextPageId: result.nextPageId } : {}),
  };
}

/** What a list row needs from `chats`, shared by the list and the text search. */
const CHAT_SUMMARY_INCLUDE = {
  customer: { select: { name: true, email: true } },
  access: { select: { groupId: true } },
  users: true,
  threads: {
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { tags: { include: { tag: { select: { name: true } } } } },
  },
} satisfies Prisma.ChatInclude;

type ChatSummaryRow = Prisma.ChatGetPayload<{ include: typeof CHAT_SUMMARY_INCLUDE }>;

/** List rows for `page`, in its order. */
async function summariseChats(
  tx: TenantClient,
  visibility: ChatVisibility,
  page: ChatSummaryRow[],
): Promise<ChatSummary[]> {
  const lastEvents = await lastEventPerChat(
    tx,
    page.map((c) => c.id),
  );
  // The row's "N connections" (ID-02). Only a chat filed under a day needs a
  // count; one filed under none shows at most its newest thread, which the
  // page already loaded.
  const threadCounts = await threadCountPerChat(
    tx,
    page.filter((c) => c.localDay !== null).map((c) => c.id),
  );

  return page.map((chat) => {
    const thread = chat.threads[0];
    const seenUpTo = chat.users.find(
      (u) => u.userId === visibility.actorId && u.userType === 'agent',
    )?.seenUpTo;

    return {
      id: chat.id,
      customer_id: chat.customerId,
      customer_name: chat.customer.name,
      active: chat.active,
      created_at: chat.createdAt.toISOString(),
      thread_id: thread?.id ?? null,
      assignee_id: thread?.assigneeId ?? null,
      queue_position: thread?.queuePosition ?? null,
      // Read only while the connection is queued (§D297-2): a row assigned or
      // closed since keeps the column, and is in no team's queue.
      queue_group_id:
        thread?.queuePosition != null && thread.queueGroupId !== null
          ? Number(thread.queueGroupId)
          : null,
      priority: threadPriorityFromRank(thread?.priority ?? 0),
      unread_count: countUnread(lastEvents.get(chat.id), seenUpTo),
      connection_count: connectionCount(
        chat.localDay,
        chat.localDay ? (threadCounts.get(chat.id) ?? 0) : chat.threads.length,
      ),
      last_event: lastEvents.get(chat.id) ?? null,
      tags: thread?.tags.map((t) => t.tag.name) ?? [],
    } satisfies ChatSummary;
  });
}

/**
 * The chats that arrived over one messaging channel (FR-MOD-02.1.4).
 *
 * WHAT "A CHAT'S CHANNEL" MEANS — and why this is a read rather than a column.
 * The definition already exists and is Reports': `breakdownByChannel`
 * (FR-MOD-07.5) calls a chat's channel the `channel_type` of its OLDEST INBOUND
 * `channel_messages` row, and folds everything else into the website bucket.
 * This asks that same question with the same `DISTINCT ON` ordering, so the
 * inbox rail and the channel split cannot disagree about which channel a
 * conversation belongs to. The obvious alternative — a `chats.channel` column
 * maintained on the write path, the way `last_event_at` is — was refused for
 * exactly that reason: it would be a *second* statement of a fact one query
 * already derives, and the two would agree only for as long as somebody kept
 * them agreeing. `last_event_at` earns its denormalisation by being the sort
 * key of every inbox read; a channel filter is asked for only when an agent
 * clicks a channel view.
 *
 * WHAT IT COSTS, stated rather than hidden: the answer is a list of ids, so a
 * workspace's whole adapter history crosses the wire between the two round
 * trips of one request. That is bounded by conversations that actually reached
 * an adapter (a widget-only workspace returns nothing at all and the filter
 * costs one indexed lookup), and it buys the property that matters most here —
 * the page and `total` are filtered by ONE `where`, so the badge beside the
 * list is counting the list. Splitting the channel out into a second predicate
 * applied to only one of them is the shape of the defect tm 179.4 closed.
 *
 * ISOLATION (NFR-S4), the argument `breakdownByChannel` spells out and this
 * inherits: `channel_messages.chat_id` is a *soft* reference — no FK — so the
 * read is locked on `license_id` explicitly as well as by RLS. Without it, a
 * weakened policy would let another tenant's row carrying the same chat id
 * decide which channel view a conversation shows up in.
 */
async function chatIdsOnChannel(
  tx: TenantClient,
  licenseId: bigint,
  channel: AdapterChannelType,
): Promise<string[]> {
  const rows = await tx.$queryRaw<Array<{ chat_id: string }>>`
    SELECT first_inbound.chat_id AS chat_id
    FROM (
      SELECT DISTINCT ON (cm.chat_id) cm.chat_id AS chat_id, cm.channel_type AS channel_type
      FROM channel_messages cm
      WHERE cm.license_id = ${licenseId}
        AND cm.chat_id IS NOT NULL
        AND cm.direction = 'inbound'
      ORDER BY cm.chat_id, cm.created_at, cm.id
    ) first_inbound
    WHERE first_inbound.channel_type = ${channel}
  `;
  return rows.map((row) => row.chat_id);
}

/**
 * How many threads each of the given chats holds, keyed by chat id — the list
 * row's "N connections" for a chat filed under a day (ID-02).
 *
 * One read bounded by the page, over `threads(chat_id, created_at)`, rather than
 * Prisma's include-level `_count`: that one is a LEFT JOIN onto `SELECT chat_id,
 * COUNT(*) FROM threads GROUP BY chat_id` with no filter but row level security
 * (seen in the client's query log), i.e. it aggregates the workspace's whole
 * history on every inbox page and grows with it.
 */
async function threadCountPerChat(
  tx: TenantClient,
  chatIds: string[],
): Promise<Map<string, number>> {
  if (chatIds.length === 0) return new Map();

  const rows = await tx.$queryRaw<Array<{ chat_id: string; count: number }>>`
    SELECT chat_id, count(*)::int AS count
    FROM threads
    WHERE chat_id = ANY(${chatIds}::text[])
    GROUP BY chat_id
  `;
  return new Map(rows.map((row) => [row.chat_id, row.count]));
}

/** The most recent event per chat, keyed by chat id — read once per page by `listChatsInTenant`. */
async function lastEventPerChat(
  tx: TenantClient,
  chatIds: string[],
): Promise<Map<string, SerialisedEvent>> {
  if (chatIds.length === 0) return new Map();

  // DISTINCT ON is the cheap way to get "latest per group" in Postgres; the
  // alternative (a correlated subquery per chat) turns one inbox page into N+1
  // queries.
  const rows = await tx.$queryRaw<RawEvent[]>`
    SELECT DISTINCT ON (chat_id)
           id, chat_id, thread_id, type, text, author_id, author_type,
           recipients, attachment_url, properties, created_at
    FROM events
    WHERE chat_id = ANY(${chatIds}::text[])
    ORDER BY chat_id, created_at DESC, id DESC
  `;

  return new Map(rows.map((row) => [row.chat_id, serialiseRawEvent(row)]));
}

const chatInclude = {
  customer: { select: { name: true, email: true } },
  access: { select: { groupId: true } },
  users: true,
  threads: {
    orderBy: { createdAt: 'desc' as const },
    include: { tags: { include: { tag: { select: { name: true } } } } },
  },
};

/**
 * Who the event is *from*.
 *
 * Shared by `start` and `sendEvent` because deriving it in two places is how it
 * went wrong: `start` handled agents and bots and silently fell through to
 * 'agent' for customers, so every conversation opened from the widget recorded
 * the visitor's first message as authored by an agent. That made it render as
 * an agent bubble, and — worse — gave every thread an agent-authored event from
 * its first line, so ADR-09 could never count a conversation as an AI
 * resolution. Reports showed 0% automated and the workspace was never billed
 * for the automation it used.
 */
/**
 * The four ways an edit is refused, as one 403 carrying a machine-readable
 * reason.
 *
 * `not_allowed` rather than a new error type: `ERROR_TYPES` is the closed
 * vocabulary clients switch on, and four near-synonyms for "no" would dilute it
 * without telling anyone more than `details.reason` already does. The message
 * is for the agent, the reason is for the client.
 */
function editRefusal(
  reason: 'not_author' | 'not_editable_type' | 'edit_window_expired' | 'channel_delivered',
  message: string,
): ApiError {
  return new ApiError('not_allowed', message, { details: { reason } });
}

function authorTypeOf(principal: Principal): 'agent' | 'bot' | 'customer' {
  switch (principal.kind) {
    case 'agent':
      return 'agent';
    case 'bot':
      return 'bot';
    case 'customer':
      return 'customer';
    // A SCIM provisioning token (NFR-S11) never reaches a chat write — the
    // route's `principals` list stops it — and it authors nothing if it somehow
    // did. Throwing keeps this switch exhaustive, which is the property that
    // caught the customer bug described above.
    case 'scim':
      throw ApiError.authorization('Provisioning credentials cannot author events.');
    // Likewise a two-factor enrollment ticket (S11-2FA-k): it is a step inside a
    // sign-in, not a participant in a conversation.
    case 'enrollment':
      throw ApiError.authorization('Enrollment credentials cannot author events.');
  }
}

/** A customer can never author an internal note, on any write path. */
function recipientsFor(principal: Principal, requested: EventRecipients): EventRecipients {
  return principal.kind === 'customer' ? 'all' : requested;
}

function actorOf(principal: Principal): string {
  switch (principal.kind) {
    case 'agent':
      return principal.accountId;
    case 'bot':
      return principal.botId;
    case 'customer':
      return principal.customerId;
    case 'scim':
      throw ApiError.authorization('Provisioning credentials cannot act on conversations.');
    case 'enrollment':
      throw ApiError.authorization('Enrollment credentials cannot act on conversations.');
  }
}

function viewFilter(view: ChatListOptions['view'], actorId: string): Record<string, unknown> {
  switch (view) {
    case 'my':
      return { active: true, threads: { some: { active: true, assigneeId: actorId } } };
    case 'queued':
      return { active: true, threads: { some: { active: true, queuePosition: { not: null } } } };
    case 'unassigned':
      // Nobody has it and it is not waiting for anyone — unless the AI is
      // holding it (tm 293.2): an AI-first connection is just as unassigned and
      // unqueued, and it is the AI view's, not a person's to pick up.
      return {
        active: true,
        threads: {
          some: {
            active: true,
            assigneeId: null,
            queuePosition: null,
            OR: [{ aiMode: null }, { aiMode: 'human' }],
          },
        },
      };
    // The Chats group's sixth bucket (PRD 02.1.1). `rapor-1-fonksiyonel.md:339`
    // defines it in one clause — «"Supervised" ajanin izledigi (supervise)
    // sohbetler» — so it is keyed by *who is watching*, exactly the way `my` is
    // keyed by who is assigned, and it reads the rows `SupervisionService`
    // already writes rather than inventing a second notion of watching.
    //
    // The word also names a state on the Traffic board, and the two are the
    // same meaning of a row (an agent is watching a conversation without owning
    // it) asked two different questions:
    //
    //   Traffic (03.1.1) asks "is *anybody* watching this visitor right now",
    //     a liveness question about somebody else's browser tab. That is why it
    //     bounds the read by `SUPERVISION_LIVE_WINDOW_SECONDS` — a stale row
    //     there means an abandoned tab, not a watcher.
    //   This view asks "which conversations am *I* watching", a worklist. It is
    //     bounded by agent, not by heartbeat, and deliberately so: nothing in
    //     the product sends the heartbeat that window presumes (the only caller
    //     of `POST /chats/{id}/supervise` is the Traffic board's one-shot row
    //     action), so borrowing the 90-second bound here would empty the rail
    //     item 90 seconds after the click that filled it. A counter that is
    //     always 0 is not a stricter view, it is a broken one.
    //
    // `active: true` is what drains the list instead, and it is the honest
    // bound: a supervision only means anything while the conversation is live,
    // and closing one is the event that ends the watching. Archived stays the
    // home of closed conversations for this agent as for every other view.
    //
    // No `licenseId` clause: the tenant boundary is RLS's, on `chats` and on
    // `chat_supervisions` alike (`chat_supervisions_tenant`). A duplicate
    // filter here would read as the thing keeping tenants apart and quietly
    // take the pressure off the policy that actually does (the M-CHOBS rule).
    case 'supervised':
      return { active: true, supervisions: { some: { agentId: actorId } } };
    case 'archived':
      return { active: false };
    // The AI Agents group (PRD 02.1.2): the two views that keep AI-handled
    // conversations out of the human queue and surface the AI's own workload.
    case 'ai':
      // The AI is handling it — the KK is "AI konuşmalarını insan kuyruğundan
      // ayırır". Since tm 293.2 the connection's mode says so (`threads.ai_mode`,
      // the `(license_id, active, ai_mode)` index): `ai`, or held back
      // (`paused`) with nobody having taken it — an AI-first connection is here
      // from the moment it opens, before the AI's first reply. A person taking
      // it (`human`) moves it out. A connection with no mode keeps the older
      // reading — a bot has spoken and no agent has — which is what still
      // describes one from before modes, or a bot writing over the API.
      return {
        active: true,
        threads: {
          some: {
            active: true,
            OR: [
              { aiMode: { in: ['ai', 'paused'] } },
              {
                aiMode: null,
                AND: [
                  { events: { some: { authorType: 'bot' } } },
                  { events: { none: { authorType: 'agent' } } },
                ],
              },
            ],
          },
        },
      };
    case 'ai_solved':
      // AI resolutions: chats with a thread the AI resolved — ADR-09a's
      // predicate, the one Reports "Automated" and the invoice read
      // (`ai-resolution.ts`). The Solved list and the billing counter must
      // never disagree, so the condition lives there and nowhere here: no extra
      // clause (e.g. "has a bot event") the counter lacks.
      return { active: false, threads: { some: aiResolvedThreadWhere() } };
    case 'all':
    default:
      return {};
  }
}

async function defaultGroupIds(tx: TenantClient, licenseId: bigint): Promise<bigint[]> {
  const fallback = await tx.routingRule.findFirst({
    where: { licenseId, kind: 'chat', isFallback: true, enabled: true },
    select: { targetGroupId: true },
  });
  if (fallback?.targetGroupId != null) return [fallback.targetGroupId];

  // No fallback configured — fall back to the first team so a chat is never
  // created with nobody able to see it.
  const first = await tx.group.findFirst({ where: { licenseId }, select: { id: true } });
  return first ? [first.id] : [];
}

/**
 * Where a completed send is remembered for replay, per chat. One spelling for
 * `sendEvent`, `start` and `openOrContinueConnection`, so a retry finds the
 * original whichever of them handles it.
 */
function idempotencyRedisKey(tenant: TenantContext, chatId: string, key: string): string {
  return `idem:${tenant.licenseId}:${chatId}:${key}`;
}

/** Newest event time for a thread, falling back to its start when it has none. */
async function lastActivityAt(tx: TenantClient, threadId: string, createdAt: Date): Promise<Date> {
  const rows = await tx.$queryRaw<Array<{ last: Date | null }>>`
    SELECT max(created_at) AS last FROM events WHERE thread_id = ${threadId}
  `;
  return rows[0]?.last ?? createdAt;
}

/**
 * Lock an open chat's row for the rest of the transaction, re-checking that it
 * is still open — false when another transaction closed it first. `FOR UPDATE`
 * rather than a read: what follows decides on the chat's activity and may close
 * it, and both must see the chat as it is once nobody else can write to it.
 */
async function lockActiveChat(tx: TenantClient, chatId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM chats WHERE id = ${chatId} AND active FOR UPDATE
  `;
  return rows.length > 0;
}

/**
 * Whether the member's open chat takes a message arriving `now`
 * (`continuesConnection`), reading the activity and the idle window only for a
 * chat filed under an earlier day — the only one the answer can be no for. The
 * window is the one the idle sweep would close this chat on
 * (`rolloverIdleSeconds`), so a conversation that arrived over a messaging
 * channel in a workspace with no timeout is never split at midnight (tm 286.3).
 */
async function openChatTakesMessage(
  tx: TenantClient,
  chat: { id: string; localDay: Date | null },
  thread: { id: string; createdAt: Date },
  now: Date,
  day?: ConversationDay,
): Promise<boolean> {
  const chatDay = localDayOf(chat.localDay);
  if (chatDay === null) return true;
  const today = (day ?? (await resolveLocalDay(tx, now))).key;
  if (chatDay >= today) return true;
  return continuesConnection({
    chatDay,
    today,
    lastActivityAt: await lastActivityAt(tx, thread.id, thread.createdAt),
    now,
    idleSeconds: await rolloverIdleSeconds(tx, chat.id),
  });
}

async function allocateId(tx: TenantClient, table: 'chats' | 'threads'): Promise<string> {
  for (let attempt = 0; attempt < ID_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateShortId();
    const existing =
      table === 'chats'
        ? await tx.chat.findUnique({ where: { id: candidate }, select: { id: true } })
        : await tx.thread.findUnique({ where: { id: candidate }, select: { id: true } });
    if (!existing) return candidate;
  }
  // 50 bits of entropy: reaching here means something is badly wrong with the
  // random source, and silently retrying forever would hide it.
  throw ApiError.internal('Could not allocate a unique id.');
}

function countUnread(
  lastEvent: SerialisedEvent | undefined,
  seenUpTo: Date | null | undefined,
): number {
  if (!lastEvent) return 0;
  if (!seenUpTo) return 1;
  return new Date(lastEvent.created_at) > seenUpTo ? 1 : 0;
}

/**
 * Where a page of the chat list stopped: the ordering key of its last row, plus
 * that row's id to break the tie.
 *
 * `activityAt` is `chats.last_event_at`, and unlike the `created_at` this used
 * to carry, it can move after the cursor is minted. That makes a cursor a
 * *bookmark* rather than an identity: it still names an exact point in the
 * order, but the row it was taken from may no longer be sitting on that point.
 * Nothing downstream needs it to — the comparison is against the point, not the
 * row — which is why a stale cursor reads as a slightly old position rather
 * than an error, the same way `audit-log-reader.ts` treats one.
 */
interface Cursor {
  activityAt: Date;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.activityAt.toISOString()}|${cursor.id}`).toString('base64url');
}

function decodeCursor(pageId: string | undefined): Cursor | null {
  if (!pageId) return null;
  try {
    const [iso, id] = Buffer.from(pageId, 'base64url').toString('utf8').split('|');
    if (!iso || !id) return null;
    const activityAt = new Date(iso);
    return Number.isNaN(activityAt.getTime()) ? null : { activityAt, id };
  } catch {
    // A malformed cursor is a client bug, not an attack surface — start over
    // rather than failing the whole request.
    return null;
  }
}

function parseSequence(
  eventId: string,
  expectedThreadId: string,
  parameter: 'after_event_id' | 'before_event_id' = 'after_event_id',
): number {
  const separator = eventId.lastIndexOf('_');
  const threadId = eventId.slice(0, separator);
  const sequence = Number(eventId.slice(separator + 1));
  if (separator < 0 || !Number.isInteger(sequence) || threadId !== expectedThreadId) {
    throw ApiError.validation(`${parameter} does not belong to this thread.`);
  }
  return sequence;
}

interface RawEvent {
  id: string;
  chat_id: string;
  thread_id: string;
  type: string;
  text: string | null;
  author_id: string | null;
  author_type: string;
  recipients: string;
  attachment_url: string | null;
  properties: Record<string, unknown>;
  created_at: Date;
}

export interface SerialisedEvent {
  id: string;
  chat_id: string;
  thread_id: string;
  type: string;
  text: string | null;
  author_id: string | null;
  author_type: string;
  recipients: string;
  attachment_url: string | null;
  properties: Record<string, unknown>;
  created_at: string;
}

function serialiseRawEvent(row: RawEvent): SerialisedEvent {
  return {
    id: row.id,
    chat_id: row.chat_id,
    thread_id: row.thread_id,
    type: row.type,
    text: row.text,
    author_id: row.author_id,
    author_type: row.author_type,
    recipients: row.recipients,
    attachment_url: row.attachment_url,
    properties: row.properties ?? {},
    created_at: row.created_at.toISOString(),
  };
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
  /** The team whose queue the newest connection waits in (AU-01); null when not queued. */
  queue_group_id: number | null;
  priority: ThreadPriority;
  unread_count: number;
  /** How many connections `ChatDetail.connections` lists for the chat (ID-02). */
  connection_count: number;
  last_event: SerialisedEvent | null;
  tags: string[];
  /** Only on a text search (`searchChatsInTenant`): the message the chat was found by. */
  match?: MessageSearchMatch;
}

/**
 * One connection of a chat's day (ID-02 · K1 = A): a thread, "Chat ID" in the
 * panel. A summary, not the transcript — read that with `listEvents` and the
 * connection's id.
 */
export interface ChatConnection {
  id: string;
  active: boolean;
  created_at: string;
  closed_at: string | null;
  assignee_id: string | null;
  opened_via: string | null;
  /** The team the connection went to (`threads.group_id`), or null. */
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
    /** Where the visit came from (tm 330) — resolved once, at its start. */
    country_code: string | null;
    city: string | null;
    /**
     * Whether the visit is still open, and therefore whether `duration_seconds`
     * is a running total or a final one. The console shows a live counter
     * (FR-MOD-02.4.1–.6, "süre/ziyaret canlı"), and it can only do that safely
     * if it knows which of the two it was handed: ticking a finished visit
     * forward would put a number on screen that nothing ever measured.
     */
    ongoing: boolean;
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
    opened_via: string | null;
    /** How pressing the connection is (`threads.priority`, AI-12). */
    priority: ThreadPriority;
    /** The hand-over reason that last raised it (`threads.priority_reason`). */
    priority_reason: string | null;
    /** Who answers the connection (`threads.ai_mode`, AI-11); null until anyone takes part. */
    ai_mode: AiConversationMode | null;
    /** Whether the AI answered in the connection — only on an agent's `get`. */
    ai_took_part?: boolean;
    tags: string[];
  } | null;
  /**
   * The conversation day the chat is filed under, `YYYY-MM-DD` (ID-02), or null
   * for a chat opened before the daily model.
   */
  local_day: string | null;
  /** The day's connections, oldest first — see `connectionsOf`. */
  connections: ChatConnection[];
  /**
   * Populated only on `get`, and only for agent/bot principals. Undefined on
   * other responses (start/resume/…) and on the customer's own view.
   */
  visitor?: ChatVisitor | null;
  /**
   * The newest AI hand-over card of the chat (tm 304.1 · AI-10) — only on an
   * agent's or bot's `get`; null when the AI handed nothing over.
   */
  latest_ai_handoff?: AiHandoffCardView | null;
}

/** The chat after a hand-off, and what became of it (`ChatTransferResult`, IN-04). */
export interface ChatTransferResult extends ChatDetail {
  outcome: ChatTransferOutcome;
  /** Whether the caller can still open it — a team hand-off narrows its access. */
  visible_to_caller: boolean;
}

interface ThreadRow {
  id: string;
  chatId: string;
  active: boolean;
  assigneeId: string | null;
  queuePosition: number | null;
  summary: string | null;
  createdAt: Date;
  closedAt: Date | null;
  openedVia: string | null;
  groupId: bigint | null;
  /** One of `AI_CONVERSATION_MODES` (the column's CHECK), or null. */
  aiMode: string | null;
  /** `THREAD_PRIORITY_RANK` (the column's CHECK). */
  priority: number;
  priorityReason: string | null;
  tags: Array<{ tag: { name: string } }>;
}

interface ChatRow {
  id: string;
  licenseId: bigint;
  customerId: string;
  active: boolean;
  createdAt: Date;
  /** `@db.Date`: Prisma hands it back as midnight UTC of that calendar day. */
  localDay: Date | null;
  access: Array<{ groupId: bigint }>;
  users: Array<{ userId: string; userType: string; present: boolean; seenUpTo: Date | null }>;
  /** Every thread of the chat, newest first (`chatInclude`). */
  threads: ThreadRow[];
}

function serialiseChat(chat: ChatRow): ChatDetail {
  const thread = chat.threads[0];
  return {
    id: chat.id,
    license_id: chat.licenseId.toString(),
    customer_id: chat.customerId,
    active: chat.active,
    created_at: chat.createdAt.toISOString(),
    access: { group_ids: chat.access.map((a) => Number(a.groupId)) },
    users: chat.users.map((u) => ({
      user_id: u.userId,
      user_type: u.userType,
      present: u.present,
      seen_up_to: u.seenUpTo?.toISOString() ?? null,
    })),
    thread: thread
      ? {
          id: thread.id,
          chat_id: thread.chatId,
          active: thread.active,
          assignee_id: thread.assigneeId,
          queue_position: thread.queuePosition,
          summary: thread.summary,
          created_at: thread.createdAt.toISOString(),
          closed_at: thread.closedAt?.toISOString() ?? null,
          opened_via: thread.openedVia,
          priority: threadPriorityFromRank(thread.priority),
          priority_reason: thread.priorityReason,
          ai_mode: thread.aiMode as AiConversationMode | null,
          tags: thread.tags.map((t) => t.tag.name).sort(),
        }
      : null,
    local_day: localDayOf(chat.localDay),
    connections: connectionsOf(chat),
  };
}

/** A `DATE` column as the contract's `YYYY-MM-DD`; Prisma reads it as UTC midnight. */
function localDayOf(day: Date | null): string | null {
  return day ? day.toISOString().slice(0, 10) : null;
}

/**
 * The connections a chat holds for its day (ID-02), oldest first.
 *
 * A chat filed under a day (`local_day`) is that day, so every one of its
 * threads is one of the day's connections. A chat opened before the daily model
 * is not a day: its threads are visits spread over its whole history, and
 * listing them as "today's connections" would draw weeks of transcripts as one
 * day — so it lists only its newest, which is what the inbox has always shown
 * for it. `connectionCount` is the same rule for the list row.
 */
function connectionsOf(chat: ChatRow): ChatConnection[] {
  const threads = chat.localDay ? [...chat.threads] : chat.threads.slice(0, 1);
  return threads
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    .map((t) => ({
      id: t.id,
      active: t.active,
      created_at: t.createdAt.toISOString(),
      closed_at: t.closedAt?.toISOString() ?? null,
      assignee_id: t.assigneeId,
      opened_via: t.openedVia,
      group_id: t.groupId === null ? null : Number(t.groupId),
    }));
}

/** `connectionsOf(chat).length`, from a thread count rather than the threads. */
function connectionCount(localDay: Date | null, threads: number): number {
  return localDay ? threads : Math.min(threads, 1);
}

/** "Chrome on macOS" when both are known; whichever is present otherwise. */
function composeDevice(browser: string | null, os: string | null): string | null {
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

function visitDurationSeconds(startedAt: Date, endedAt: Date | null): number | null {
  const end = endedAt ?? new Date();
  const seconds = Math.round((end.getTime() - startedAt.getTime()) / 1000);
  return seconds >= 0 ? seconds : null;
}
