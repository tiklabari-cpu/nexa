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
  buildEventId,
  generateShortId,
  type EventRecipients,
  type EventType,
  type TransferReason,
} from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import { withTenant, type TenantClient, type TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
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
  view: 'all' | 'my' | 'queued' | 'unassigned' | 'archived';
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
}

export class ChatService {
  constructor(
    private readonly db: PrismaClient,
    private readonly redis: RedisLike,
  ) {}

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async list(
    tenant: TenantContext,
    principal: Principal,
    options: ChatListOptions,
  ): Promise<{ items: ChatSummary[]; nextPageId?: string }> {
    return withTenant(this.db, tenant, async (tx) => {
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
          ...(options.groupId !== undefined
            ? { access: { some: { groupId: options.groupId } } }
            : {}),
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
      const lastEvents = await this.#lastEventPerChat(
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
    });
  }

  async get(tenant: TenantContext, principal: Principal, chatId: string): Promise<ChatDetail> {
    return withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'read');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);
      return serialiseChat(chat);
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
    },
  ): Promise<{ chat: ChatDetail; created: boolean }> {
    const actorId = actorOf(principal);

    return withTenant(this.db, tenant, async (tx) => {
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

      const groupIds = input.groupIds?.length
        ? input.groupIds
        : await defaultGroupIds(tx, tenant.licenseId);

      const chat = await this.#createChatWithThread(tx, {
        licenseId: tenant.licenseId,
        customerId: input.customerId,
        groupIds,
        assigneeId: input.assignToMe ? actorId : null,
      });

      if (input.initialEvent) {
        await this.#appendEvent(tx, {
          licenseId: tenant.licenseId,
          chatId: chat.id,
          threadId: chat.threads[0]!.id,
          authorId: actorId,
          authorType: principal.kind === 'bot' ? 'bot' : 'agent',
          input: input.initialEvent,
        });
      }

      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      return { chat: serialiseChat(reloaded), created: true };
    });
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

      const authorType =
        principal.kind === 'customer' ? 'customer' : principal.kind === 'bot' ? 'bot' : 'agent';

      // A customer can never author an internal note.
      const recipients: EventRecipients = principal.kind === 'customer' ? 'all' : input.recipients;

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

      return event;
    });

    if (idempotencyKey) {
      // NX so a concurrent duplicate cannot overwrite the winner's id.
      await this.redis.set(idempotencyKey, result.id, 'EX', IDEMPOTENCY_TTL_SECONDS, 'NX');
    }

    return { event: result, replayed: false };
  }

  async deactivate(
    tenant: TenantContext,
    principal: Principal,
    chatId: string,
  ): Promise<ChatDetail> {
    return withTenant(this.db, tenant, async (tx) => {
      const visibility = await resolveVisibility(tx, principal, 'write');
      const chat = await this.#loadVisibleChat(tx, visibility, chatId);

      const thread = chat.threads.find((t) => t.active);
      if (!chat.active || !thread) throw ApiError.chatInactive('Chat is already closed.');

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
        authorId: actorOf(principal),
        authorType: 'system',
        input: {
          type: 'system_message',
          text: 'Chat archived',
          recipients: 'all',
          properties: { system_event: 'chat_deactivated' },
        },
      });

      const reloaded = await tx.chat.findUniqueOrThrow({
        where: { id: chat.id },
        include: chatInclude,
      });
      return serialiseChat(reloaded);
    });
  }

  async resume(tenant: TenantContext, principal: Principal, chatId: string): Promise<ChatDetail> {
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
      return serialiseChat(reloaded);
    });
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

    return withTenant(this.db, tenant, async (tx) => {
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
      return serialiseChat(reloaded);
    });
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

  async #lastEventPerChat(
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const chatInclude = {
  customer: { select: { name: true, email: true } },
  access: { select: { groupId: true } },
  users: true,
  threads: {
    orderBy: { createdAt: 'desc' as const },
    include: { tags: { include: { tag: { select: { name: true } } } } },
  },
};

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
