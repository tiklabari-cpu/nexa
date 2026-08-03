/**
 * The conversation core: chat → thread → event.
 *
 * Invariants this service upholds, and where they are actually enforced:
 *
 *   one active chat per license+customer  → partial unique index (database)
 *   one active thread per chat            → partial unique index (database)
 *   no events on a closed conversation    → checked here, inside the same
 *                                           transaction that writes the event
 *   event sequence is gapless and unique  → `UPDATE ... RETURNING` on the thread
 *   internal notes never reach a customer → `recipients` filtered on read
 *
 * The database-level ones are deliberate: a rule checked only here is one
 * concurrent request away from being violated.
 */
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  AGENT_COMPOSING_TTL_SECONDS,
  buildEventId,
  composerStateKey,
  generateShortId,
  SNEAK_PEEK_MAX_LENGTH,
  type AgentConflictWarningPush,
  type ChatTakenOverPush,
  type EventRecipients,
  type EventType,
  type TransferReason,
} from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import type { RealtimePublisher } from '../realtime/publisher.js';
import { recordAiResolution, threadWasAiResolved } from '../billing/metering.js';
import type { Mailer } from '../mail/mailer.js';
import {
  renderTranscript,
  transcriptRecipients,
  type TranscriptLine,
} from '../notifications/chat-transcript.js';
import { RoutingService, type RoutingContext } from '../routing/routing-service.js';
import {
  canSeeChat,
  chatVisibilityFilter,
  resolveVisibility,
  type ChatVisibility,
} from './access.js';

/** How long a completed request stays replayable by idempotency key. */
const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;

/** Chat ids are random; a collision is vanishingly unlikely but not impossible. */
const ID_GENERATION_ATTEMPTS = 5;

export interface ChatListOptions {
  view: 'all' | 'my' | 'queued' | 'unassigned' | 'archived' | 'ai' | 'ai_solved';
  customerId?: string;
  groupId?: bigint;
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
  drained: Array<{ chatId: string; threadId: string; assigneeId: string }>;
}

export class ChatService {
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
    /** ADR-13 — overage price and monthly allowance, from env. */
    private readonly billing: { aiOverageCents: number; aiIncluded: number } = {
      aiOverageCents: 50,
      aiIncluded: 200,
    },
    /**
     * Sends the end-of-chat transcript (FR-MOD-08.7.4). Optional for the same
     * reason `publisher` is: a service built without one still closes chats,
     * it just skips the courtesy e-mail — never a precondition for the close.
     */
    private readonly mailer?: Mailer,
  ) {}

  /**
   * Everyone entitled to see activity on a chat: the teams it is routed to,
   * anyone personally in it, and the customer.
   *
   * Computed here, where team membership and tenant context are available, and
   * carried in the envelope — the gateway has neither and could only guess.
   */
  #audienceFor(chat: {
    customerId: string;
    access: Array<{ groupId: bigint }>;
    users: Array<{ userId: string; userType: string }>;
  }) {
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
  ): Promise<{ items: ChatSummary[]; nextPageId?: string }> {
    return withTenant(this.db, tenant, (tx) => listChatsInTenant(tx, principal, options));
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
      }
      return detail;
    });
  }

  async listEvents(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    options: { threadId?: string; afterEventId?: string; limit: number },
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

      const after = options.afterEventId ? parseSequence(options.afterEventId, threadId) : 0;

      // Sequence lives inside the id, so "everything after N" is answerable
      // without comparing timestamps — which matters because several events can
      // share a millisecond.
      //
      // Internal notes are filtered in SQL rather than after fetching: dropping
      // them afterwards would return short pages and let a customer infer, from
      // the gap, that a note exists.
      const rows = await tx.$queryRaw<RawEvent[]>(Prisma.sql`
        SELECT id, chat_id, thread_id, type, text, author_id, author_type,
               recipients, attachment_url, properties, created_at
        FROM events
        WHERE thread_id = ${threadId}
          AND (split_part(id, '_', 2))::bigint > ${after}
          ${principal.kind === 'customer' ? Prisma.sql`AND recipients = 'all'` : Prisma.empty}
        ORDER BY (split_part(id, '_', 2))::bigint ASC
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

  async start(
    tenant: TenantContext,
    principal: Principal,
    input: {
      customerId: string;
      groupIds?: bigint[];
      assignToMe: boolean;
      initialEvent?: NewEventInput;
      routing?: RoutingContext;
    },
  ): Promise<{ chat: ChatDetail; created: boolean }> {
    const result = await this.#startInTransaction(tenant, principal, input);

    if (result.created && result.raw) {
      await this.publisher?.publish(tenant, 'incoming_chat', this.#audienceFor(result.raw), {
        requester_id: actorOf(principal),
        chat: result.chat,
      });
    }

    return { chat: result.chat, created: result.created };
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
    },
  ): Promise<{ chat: ChatDetail; created: boolean; raw?: ChatRow }> {
    const actorId = actorOf(principal);
    // A holder rather than a plain `let`: the assignment happens inside the
    // transaction callback, and TypeScript cannot see that the callback ran.
    const registration: { value?: { key: string; eventId: string } } = {};

    const result = await withTenant(this.db, tenant, async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: input.customerId },
        select: { id: true, bannedAt: true },
      });
      if (!customer) throw ApiError.notFound('Customer not found.');
      if (customer.bannedAt) throw new ApiError('customer_banned', 'This customer is banned.');

      // Reusing an existing active chat is not just convenience: the database
      // refuses a second one, so the alternative is an error the caller can do
      // nothing useful with.
      const existing = await tx.chat.findFirst({
        where: { customerId: input.customerId, active: true },
        include: chatInclude,
      });
      if (existing) return { chat: serialiseChat(existing), created: false };

      // Explicit teams win; otherwise the routing engine decides, so a chat
      // opened from the widget lands with whoever should actually take it.
      const decision = input.groupIds?.length
        ? null
        : await this.routing.route(tx, tenant.licenseId, input.routing ?? {});

      const groupIds = input.groupIds?.length
        ? input.groupIds
        : (decision?.groupIds ?? (await defaultGroupIds(tx, tenant.licenseId)));

      const assigneeId = input.assignToMe ? actorId : (decision?.assigneeId ?? null);

      const chat = await this.#createChatWithThread(tx, {
        licenseId: tenant.licenseId,
        customerId: input.customerId,
        groupIds,
        assigneeId,
        queuePosition: input.assignToMe ? null : (decision?.queuePosition ?? null),
      });

      if (input.initialEvent) {
        const initial = await this.#appendEvent(tx, {
          licenseId: tenant.licenseId,
          chatId: chat.id,
          threadId: chat.threads[0]!.id,
          authorId: actorId,
          authorType: authorTypeOf(principal),
          input: {
            ...input.initialEvent,
            recipients: recipientsFor(principal, input.initialEvent.recipients ?? 'all'),
          },
        });

        // Registered under the same key `sendEvent` checks.
        //
        // A widget retrying a timed-out first message finds the chat already
        // created and takes the `sendEvent` path instead of this one. Without
        // this the key would be unknown there, and the visitor's opening line
        // would be posted twice.
        if (input.initialEvent.idempotencyKey) {
          registration.value = {
            key: `idem:${tenant.licenseId}:${chat.id}:${input.initialEvent.idempotencyKey}`,
            eventId: initial.id,
          };
        }
      }

      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      return { chat: serialiseChat(reloaded), created: true, raw: reloaded };
    });

    // After commit: a key pointing at an event that was rolled back would make
    // the retry replay something that does not exist.
    if (registration.value) {
      await this.redis.set(
        registration.value.key,
        registration.value.eventId,
        'EX',
        IDEMPOTENCY_TTL_SECONDS,
        'NX',
      );
    }

    return result;
  }

  async sendEvent(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    input: NewEventInput,
  ): Promise<{ event: SerialisedEvent; replayed: boolean }> {
    // Idempotency is checked before the transaction so a retry costs one Redis
    // read rather than a write transaction that then has to be rolled back.
    const idempotencyKey = input.idempotencyKey
      ? `idem:${tenant.licenseId}:${chatId}:${input.idempotencyKey}`
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

      // First agent reply drives the first-response-time report; recorded here
      // so it cannot drift from the events it summarises.
      if (authorType === 'agent' && recipients === 'all' && !thread.firstResponseAt) {
        await tx.thread.update({
          where: { id: thread.id },
          data: { firstResponseAt: event.created_at },
        });
      }

      return { event, recipients, audience: this.#audienceFor(chat), id: event.id };
    });

    if (idempotencyKey) {
      // NX so a concurrent duplicate cannot overwrite the winner's id.
      await this.redis.set(idempotencyKey, result.id, 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    }

    // After the transaction, never inside it: announcing an event a subscriber
    // could then fail to read would be worse than announcing it a moment late.
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

    return { event: result.event, replayed: false };
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

  async deactivate(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
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
      });
    });

    await this.#publishDeactivation(tenant, chatId, result, actorOf(principal));
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
   */
  async deactivateByTimeout(
    tenant: TenantContext,
    chatId: string,
    cutoff: Date,
  ): Promise<ChatDetail | null> {
    const result = await withTenant(this.db, tenant, async (tx) => {
      const chat = await tx.chat.findUnique({ where: { id: chatId }, include: chatInclude });
      const thread = chat?.threads.find((t) => t.active);
      if (!chat || !chat.active || !thread) return null;

      // Idle when listed; confirm it is still idle, in the same transaction that
      // closes it. Last activity is the newest event, or the thread's own start
      // when it has none yet.
      if ((await this.#lastActivityAt(tx, thread.id, thread.createdAt)) >= cutoff) return null;

      return this.#closeConversation(tx, tenant, chat, thread, {
        authorId: null,
        text: 'Chat closed after inactivity',
        properties: { system_event: 'chat_deactivated', reason: 'timeout' },
      });
    });

    if (!result) return null;
    await this.#publishDeactivation(tenant, chatId, result, null);
    await this.#emailTranscript(tenant, chatId, result.threadId);
    return result.detail;
  }

  /**
   * The close cascade shared by `deactivate` and `deactivateByTimeout`: archive
   * the thread, deactivate the chat, mark everyone absent, record the close as a
   * system event, count an AI resolution when no human ever replied (ADR-09),
   * and drain the queue so the slot this frees is filled now rather than on the
   * next arrival — otherwise a quiet period leaves customers queued behind an
   * agent who is already free.
   */
  async #closeConversation(
    tx: TenantClient,
    tenant: TenantContext,
    chat: ChatRow,
    thread: { id: string },
    close: { authorId: string | null; text: string; properties: Record<string, unknown> },
  ): Promise<CloseResult> {
    const closedAt = new Date();
    await tx.thread.update({
      where: { id: thread.id },
      data: { active: false, closedAt, queuePosition: null, queuedAt: null },
    });
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

    const reloaded = await tx.chat.findUniqueOrThrow({
      where: { id: chat.id },
      include: chatInclude,
    });
    // ADR-09: a thread that closes with no agent-authored event resolved without
    // a human. Counted here, in the same transaction that closes it, so the
    // billing figure and the conversation can never disagree.
    if (await threadWasAiResolved(tx, thread.id)) {
      await recordAiResolution(tx, tenant, this.billing.aiOverageCents, this.billing.aiIncluded);
    }

    const drained = await this.routing.drainQueue(tx, tenant.licenseId);
    return {
      detail: serialiseChat(reloaded),
      threadId: thread.id,
      audience: this.#audienceFor(chat),
      drained,
    };
  }

  /** Newest event time for a thread, falling back to its start when it has none. */
  async #lastActivityAt(tx: TenantClient, threadId: string, createdAt: Date): Promise<Date> {
    const rows = await tx.$queryRaw<Array<{ last: Date | null }>>`
      SELECT max(created_at) AS last FROM events WHERE thread_id = ${threadId}
    `;
    return rows[0]?.last ?? createdAt;
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
          select: { customer: { select: { name: true, email: true } } },
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
        if (thread?.assigneeId) {
          const [account, membership] = await Promise.all([
            tx.account.findUnique({
              where: { id: thread.assigneeId },
              select: { email: true, name: true },
            }),
            tx.agentMembership.findUnique({
              where: { licenseId_agentId: { licenseId: tenant.licenseId, agentId: thread.assigneeId } },
              select: { notifyEmail: true },
            }),
          ]);
          assignee = {
            email: account?.email ?? null,
            name: account?.name ?? null,
            emailEnabled: membership?.notifyEmail ?? true,
          };
        }

        return { customer: chat.customer, assignee, events, nameById };
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
        });
        // Nothing worth sending this party (e.g. a chat of only system events).
        if (!content) continue;
        await mailer.send({
          to: recipient.to,
          kind: 'notification',
          subject: content.subject,
          body: content.body,
        });
      }
    } catch {
      // Best-effort: the conversation is closed and already delivered, and this
      // service holds no logger. A transcript that fails to send must not turn a
      // successful close into an error the caller sees.
    }
  }

  async resume(tenant: TenantContext, principal: Principal, chatId: string): Promise<ChatDetail> {
    const result = await withTenant(this.db, tenant, async (tx) => {
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

      const threadId = await this.#allocateThreadId(tx);
      await tx.chat.update({ where: { id: chat.id }, data: { active: true } });
      await tx.thread.create({
        data: {
          id: threadId,
          chatId: chat.id,
          licenseId: tenant.licenseId,
          active: true,
          assigneeId: actorOf(principal),
        },
      });
      await tx.chatUser.updateMany({
        where: { chatId: chat.id, userType: 'customer' },
        data: { present: true },
      });

      await this.#appendEvent(tx, {
        licenseId: tenant.licenseId,
        chatId: chat.id,
        threadId,
        authorId: actorOf(principal),
        authorType: 'system',
        input: {
          type: 'system_message',
          text: 'Chat reopened',
          recipients: 'all',
          properties: { system_event: 'chat_resumed' },
        },
      });

      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      return { detail: serialiseChat(reloaded), audience: this.#audienceFor(reloaded) };
    });

    // Reopening looks like a new arrival to every inbox watching it.
    await this.publisher?.publish(tenant, 'incoming_chat', result.audience, {
      requester_id: actorOf(principal),
      chat: result.detail,
    });
    return result.detail;
  }

  async transfer(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
    target: { groupId?: bigint; agentId?: string; reason: TransferReason },
  ): Promise<ChatDetail> {
    if ((target.groupId === undefined) === (target.agentId === undefined)) {
      throw ApiError.validation('Provide exactly one of group_id or agent_id.');
    }

    const result = await withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      const thread = chat.threads.find((t) => t.active);
      if (!chat.active || !thread) throw ApiError.chatInactive('Cannot transfer a closed chat.');

      if (target.groupId !== undefined) {
        const group = await tx.group.findUnique({
          where: { licenseId_id: { licenseId: tenant.licenseId, id: target.groupId } },
          select: { id: true, name: true },
        });
        if (!group) throw new ApiError('group_not_found', 'Team not found.');

        // Handing a chat to a team with nobody accepting strands the customer.
        const available = await tx.groupAgent.count({
          where: {
            groupId: group.id,
            agent: {
              memberships: {
                some: {
                  licenseId: tenant.licenseId,
                  routingStatus: 'accepting_chats',
                  suspended: false,
                },
              },
            },
          },
        });
        if (available === 0) {
          throw new ApiError('group_offline', 'No agent in that team is accepting chats.');
        }

        await tx.chatAccess.deleteMany({ where: { chatId: chat.id } });
        await tx.chatAccess.create({ data: { chatId: chat.id, groupId: group.id } });
        // Unassign: the receiving team routes it (slice 8).
        await tx.thread.update({ where: { id: thread.id }, data: { assigneeId: null } });
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
        authorId: actorOf(principal),
        authorType: 'system',
        input: {
          type: 'system_message',
          text: 'Chat transferred',
          recipients: 'all',
          properties: {
            system_event: 'chat_transferred',
            reason: target.reason,
            ...(target.groupId !== undefined
              ? { group_id: Number(target.groupId) }
              : { agent_id: target.agentId }),
          },
        },
      });

      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      return {
        detail: serialiseChat(reloaded),
        // Union of before and after: the losing team needs to be told the chat
        // left as much as the winning team needs to be told it arrived.
        audience: {
          groupIds: [...this.#audienceFor(chat).groupIds, ...this.#audienceFor(reloaded).groupIds],
          agentIds: [...this.#audienceFor(chat).agentIds, ...this.#audienceFor(reloaded).agentIds],
          customerId: chat.customerId,
        },
        threadId: thread.id,
        // Who was responsible before the hand-off and who is now — the conflict
        // warning below only fires when this actually changed to a new agent.
        oldAssigneeId: thread.assigneeId ?? null,
        newAssigneeId: target.agentId ?? null,
      };
    });

    await this.publisher?.publish(tenant, 'chat_transferred', result.audience, {
      chat_id: chatId,
      thread_id: result.threadId,
      requester_id: actorOf(principal),
      reason: target.reason,
      transferred_to: {
        group_ids: target.groupId !== undefined ? [Number(target.groupId)] : [],
        agent_ids: target.agentId !== undefined ? [target.agentId] : [],
      },
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
      };
    });

    await this.publisher?.publish(tenant, 'chat_taken_over', result.audience, {
      chat_id: chatId,
      thread_id: result.threadId,
      requester_id: supervisorId,
      previous_assignee_id: result.previousAssigneeId,
      new_assignee_id: supervisorId,
    } satisfies ChatTakenOverPush);

    return result.detail;
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
    const properties = input.input.properties ?? {};

    const rows = await tx.$queryRaw<RawEvent[]>`
      INSERT INTO events (id, thread_id, chat_id, license_id, type, text, author_id,
                          author_type, recipients, attachment_url, properties)
      VALUES (${eventId}, ${input.threadId}, ${input.chatId}, ${input.licenseId},
              ${input.input.type}, ${input.input.text ?? null}, ${input.authorId},
              ${input.authorType}, ${input.input.recipients},
              ${input.input.attachmentUrl ?? null}, ${JSON.stringify(properties)}::jsonb)
      RETURNING id, chat_id, thread_id, type, text, author_id, author_type,
                recipients, attachment_url, properties, created_at
    `;

    return serialiseRawEvent(rows[0]!);
  }

  async #createChatWithThread(
    tx: TenantClient,
    input: {
      licenseId: bigint;
      customerId: string;
      groupIds: bigint[];
      assigneeId: string | null;
      queuePosition?: number | null;
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

    await tx.thread.create({
      data: {
        id: threadId,
        chatId,
        licenseId: input.licenseId,
        active: true,
        assigneeId: input.assigneeId,
        ...(input.queuePosition != null
          ? { queuePosition: input.queuePosition, queuedAt: new Date() }
          : {}),
      },
    });

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
): Promise<{ items: ChatSummary[]; nextPageId?: string }> {
  const visibility = await resolveVisibility(tx, principal, 'read');
  const cursor = decodeCursor(options.pageId);

  // Visibility is an OR, and so is the keyset cursor. Merging them into one
  // OR would widen the result rather than narrow it, so each goes into its
  // own AND clause.
  const conditions: Record<string, unknown>[] = [];

  const visibilityFilter = chatVisibilityFilter(visibility);
  if (Object.keys(visibilityFilter).length > 0) conditions.push(visibilityFilter);

  if (cursor) {
    const [before, after] =
      options.sort === 'newest' ? (['lt', 'lt'] as const) : (['gt', 'gt'] as const);
    conditions.push({
      OR: [
        { createdAt: { [before]: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { [after]: cursor.id } },
      ],
    });
  }

  const direction = options.sort === 'newest' ? 'desc' : 'asc';
  const rows = await tx.chat.findMany({
    where: {
      ...(options.customerId ? { customerId: options.customerId } : {}),
      ...(options.groupId !== undefined ? { access: { some: { groupId: options.groupId } } } : {}),
      ...viewFilter(options.view, visibility.actorId),
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    },
    // Tie-break on id: `created_at` alone is not unique, and a cursor built
    // on a non-unique column silently skips or repeats rows.
    orderBy: [{ createdAt: direction }, { id: direction }],
    take: options.limit + 1,
    include: {
      customer: { select: { name: true, email: true } },
      access: { select: { groupId: true } },
      users: true,
      threads: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { tags: { include: { tag: { select: { name: true } } } } },
      },
    },
  });

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  const lastEvents = await lastEventPerChat(
    tx,
    page.map((c) => c.id),
  );

  const items = page.map((chat) => {
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
      unread_count: countUnread(lastEvents.get(chat.id), seenUpTo),
      last_event: lastEvents.get(chat.id) ?? null,
      tags: thread?.tags.map((t) => t.tag.name) ?? [],
    } satisfies ChatSummary;
  });

  const last = page.at(-1);
  return {
    items,
    ...(hasMore && last
      ? { nextPageId: encodeCursor({ createdAt: last.createdAt, id: last.id }) }
      : {}),
  };
}

/** The most recent event per chat, keyed by chat id — `listChatsInTenant`'s only per-row read. */
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
function authorTypeOf(principal: Principal): 'agent' | 'bot' | 'customer' {
  switch (principal.kind) {
    case 'agent':
      return 'agent';
    case 'bot':
      return 'bot';
    case 'customer':
      return 'customer';
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
  }
}

function viewFilter(view: ChatListOptions['view'], actorId: string): Record<string, unknown> {
  switch (view) {
    case 'my':
      return { active: true, threads: { some: { active: true, assigneeId: actorId } } };
    case 'queued':
      return { active: true, threads: { some: { active: true, queuePosition: { not: null } } } };
    case 'unassigned':
      return {
        active: true,
        threads: { some: { active: true, assigneeId: null, queuePosition: null } },
      };
    case 'archived':
      return { active: false };
    // The AI Agents group (PRD 02.1.2): the two views that keep AI-handled
    // conversations out of the human queue and surface the AI's own workload.
    case 'ai':
      // The AI is actively handling it: the bot has spoken and no human agent
      // has. Requiring a bot event is what separates this from a chat merely
      // waiting in the human queue (queued/unassigned), which also has no agent
      // event yet — the KK is "AI konuşmalarını insan kuyruğundan ayırır".
      return {
        active: true,
        threads: {
          some: {
            active: true,
            AND: [
              { events: { some: { authorType: 'bot' } } },
              { events: { none: { authorType: 'agent' } } },
            ],
          },
        },
      };
    case 'ai_solved':
      // AI resolutions: closed with no agent-authored event. This is ADR-09's
      // exact predicate — the same line Reports "Automated" and the invoice
      // read (reports.ts `automated = NOT active AND NOT agent-event`). The
      // Solved list and the billing counter must never disagree, so this must
      // not gain an extra condition (e.g. "has a bot event") the counter lacks.
      return {
        active: false,
        threads: { some: { events: { none: { authorType: 'agent' } } } },
      };
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

interface Cursor {
  createdAt: Date;
  id: string;
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(`${cursor.createdAt.toISOString()}|${cursor.id}`).toString('base64url');
}

function decodeCursor(pageId: string | undefined): Cursor | null {
  if (!pageId) return null;
  try {
    const [iso, id] = Buffer.from(pageId, 'base64url').toString('utf8').split('|');
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
  } catch {
    // A malformed cursor is a client bug, not an attack surface — start over
    // rather than failing the whole request.
    return null;
  }
}

function parseSequence(eventId: string, expectedThreadId: string): number {
  const separator = eventId.lastIndexOf('_');
  const threadId = eventId.slice(0, separator);
  const sequence = Number(eventId.slice(separator + 1));
  if (separator < 0 || !Number.isInteger(sequence) || threadId !== expectedThreadId) {
    throw ApiError.validation('after_event_id does not belong to this thread.');
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
  unread_count: number;
  last_event: SerialisedEvent | null;
  tags: string[];
}

/** The customer's most recent visit, projected onto the chat (FR-MOD-02.4). */
export interface ChatVisitor {
  visited_pages: Array<{ url: string; at?: string }>;
  visit_info: {
    device: string | null;
    referrer: string | null;
    duration_seconds: number | null;
    ip: string | null;
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
    tags: string[];
  } | null;
  /**
   * Populated only on `get`, and only for agent/bot principals. Undefined on
   * other responses (start/resume/…) and on the customer's own view.
   */
  visitor?: ChatVisitor | null;
}

interface ChatRow {
  id: string;
  licenseId: bigint;
  customerId: string;
  active: boolean;
  createdAt: Date;
  access: Array<{ groupId: bigint }>;
  users: Array<{ userId: string; userType: string; present: boolean; seenUpTo: Date | null }>;
  threads: Array<{
    id: string;
    chatId: string;
    active: boolean;
    assigneeId: string | null;
    queuePosition: number | null;
    summary: string | null;
    createdAt: Date;
    closedAt: Date | null;
    tags: Array<{ tag: { name: string } }>;
  }>;
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
          tags: thread.tags.map((t) => t.tag.name).sort(),
        }
      : null,
  };
}

/**
 * `pages` is a free-form JSON column. Read it defensively: a malformed entry is
 * dropped rather than allowed to break the Details panel it feeds.
 */
function visitedPagesOf(pages: unknown): Array<{ url: string; at?: string }> {
  if (!Array.isArray(pages)) return [];
  const result: Array<{ url: string; at?: string }> = [];
  for (const entry of pages) {
    if (entry && typeof entry === 'object' && typeof (entry as { url?: unknown }).url === 'string') {
      const { url, at } = entry as { url: string; at?: unknown };
      result.push(typeof at === 'string' ? { url, at } : { url });
    }
  }
  return result;
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
