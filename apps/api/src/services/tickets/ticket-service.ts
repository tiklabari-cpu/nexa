/**
 * Tickets — the asynchronous half of the inbox (PRD FR-MOD-02.1.3, 02.6).
 *
 * A chat is someone waiting; a ticket is work that outlives the conversation.
 * They share a customer, which is why Reports counts them together as "total
 * cases" (FR-MOD-07.3.2) and the customer directory shows both numbers.
 *
 * Visibility mirrors chats but reads simpler, because a ticket carries its own
 * assignee and team rather than a join table: an agent sees tickets assigned to
 * them or to a team they belong to. The scopes are separate from `chats--*` on
 * purpose — a token granted conversations should not silently also read the
 * follow-up work (ADR-04 keeps resources distinct).
 */
import { Prisma } from '@prisma/client';
import { generateShortId, hasAnyScope } from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';

export const TICKET_STATUSES = ['open', 'pending', 'solved', 'closed', 'spam'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/**
 * Statuses that still need someone. The partial unique index in the migration
 * uses the same set, so "one unresolved ticket per chat" means the same thing
 * in the database and here.
 */
const UNRESOLVED: TicketStatus[] = ['open', 'pending'];

export type TicketView = 'all' | 'unassigned' | 'my_open' | 'solved';

const SCOPES = {
  read: { all: 'tickets--all:ro', scoped: 'tickets--access:ro' },
  write: { all: 'tickets--all:rw', scoped: 'tickets--access:rw' },
} as const;

export interface ListOptions {
  view: TicketView;
  query?: string;
  limit: number;
  pageId?: string;
}

export interface TicketSummary {
  id: string;
  subject: string;
  status: TicketStatus;
  assignee_id: string | null;
  assignee_name: string | null;
  group_id: number | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  source_chat_id: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface TicketDetail extends TicketSummary {
  source_chat: { id: string; active: boolean; created_at: string } | null;
}

export interface CreateInput {
  subject: string;
  source_chat_id?: string;
  customer_id?: string;
  group_id?: number | null;
  assignee_id?: string | null;
  status?: TicketStatus;
}

export interface UpdateInput {
  subject?: string;
  status?: TicketStatus;
  assignee_id?: string | null;
  group_id?: number | null;
}

interface Visibility {
  unrestricted: boolean;
  groupIds: bigint[];
  actorId: string;
}

type Mode = 'read' | 'write';

const ID_GENERATION_ATTEMPTS = 5;

export class TicketService {
  async list(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    options: ListOptions,
  ): Promise<{ items: TicketSummary[]; total: number; nextPageId?: string }> {
    const visibility = await resolveVisibility(tx, principal, 'read');
    const where = {
      ...visibilityFilter(visibility),
      ...viewFilter(options.view, visibility.actorId),
      ...queryFilter(options.query),
    };

    const cursor = decodeCursor(options.pageId);
    const [rows, total] = await Promise.all([
      tx.ticket.findMany({
        where: cursor ? { AND: [where, cursorFilter(cursor)] } : where,
        // `nulls: 'last'` is stated rather than left to the database. Postgres
        // defaults DESC to NULLS FIRST, which would float an activity-less
        // ticket above everything worked this morning — and disagree with the
        // keyset predicate below, ending pagination early with no error.
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        take: options.limit + 1,
        include: TICKET_INCLUDE,
      }),
      tx.ticket.count({ where }),
    ]);

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    const names = await assigneeNames(tx, page);

    return {
      items: page.map((row) => serialise(row, names)),
      total,
      ...(hasMore && last
        ? { nextPageId: encodeCursor({ lastMessageAt: last.lastMessageAt, id: last.id }) }
        : {}),
    };
  }

  async get(tx: TenantClient, principal: Principal, ticketId: string): Promise<TicketDetail> {
    const visibility = await resolveVisibility(tx, principal, 'read');
    const ticket = await loadVisible(tx, visibility, ticketId);
    return serialiseDetail(ticket, await assigneeNames(tx, [ticket]));
  }

  async create(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    input: CreateInput,
  ): Promise<TicketDetail> {
    const visibility = await resolveVisibility(tx, principal, 'write');

    let customerId = input.customer_id ?? null;
    let groupId = input.group_id ?? null;

    // Creating from a chat carries the customer across, so the follow-up is
    // attached to the same person without the caller having to look it up — and
    // without letting them attach it to somebody else.
    if (input.source_chat_id) {
      const chat = await tx.chat.findUnique({
        where: { id: input.source_chat_id },
        select: {
          customerId: true,
          access: { select: { groupId: true } },
          users: { select: { userId: true, userType: true } },
        },
      });
      // Absent, not forbidden: a 403 would confirm the id is real (NFR-S5).
      if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');
      customerId ??= chat.customerId;
      groupId ??= chat.access[0]?.groupId != null ? Number(chat.access[0].groupId) : null;
    }

    await assertAssignable(tx, tenant, input.assignee_id ?? null, groupId);

    const data = {
      licenseId: tenant.licenseId,
      subject: input.subject.trim(),
      status: input.status ?? 'open',
      customerId,
      sourceChatId: input.source_chat_id ?? null,
      assigneeId: input.assignee_id ?? null,
      groupId: groupId != null ? BigInt(groupId) : null,
      // Set on creation so ordering is stable from the first moment. A ticket
      // with no activity timestamp sorts unpredictably in the one view (newest
      // first) the whole module is built around.
      lastMessageAt: new Date(),
    };

    // Everything that needs to read the database happens *before* the insert.
    //
    // This runs inside a transaction, and in Postgres a failed statement aborts
    // the whole transaction — so a `catch` around the insert cannot go on to
    // query for the conflicting row or retry with a fresh id. Both of those
    // have to be settled up front. The same reason `ChatService` allocates ids
    // this way rather than inserting and retrying.
    if (input.source_chat_id) {
      const existing = await tx.ticket.findFirst({
        where: { sourceChatId: input.source_chat_id, status: { in: UNRESOLVED } },
        select: { id: true },
      });
      if (existing) {
        throw new ApiError('ticket_exists', 'This chat already has an unresolved ticket.', {
          details: { existing_ticket_id: existing.id },
        });
      }
    }

    try {
      const created = await tx.ticket.create({
        data: { ...data, id: await allocateId(tx) },
        include: TICKET_INCLUDE,
      });
      return serialiseDetail(created, await assigneeNames(tx, [created]));
    } catch (error) {
      // The check above loses to a request that inserted between it and here.
      // The partial unique index is what actually holds the rule; this only
      // translates its complaint into the same answer the caller would have got
      // a millisecond earlier. No id to offer — reading one now is exactly the
      // query the aborted transaction will not run.
      if (isUniqueViolation(error) && input.source_chat_id) {
        throw new ApiError('ticket_exists', 'This chat already has an unresolved ticket.');
      }
      throw error;
    }
  }

  async update(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    ticketId: string,
    patch: UpdateInput,
  ): Promise<TicketDetail> {
    const visibility = await resolveVisibility(tx, principal, 'write');
    const existing = await loadVisible(tx, visibility, ticketId);

    const nextGroupId =
      patch.group_id !== undefined
        ? patch.group_id
        : existing.groupId != null
          ? Number(existing.groupId)
          : null;
    const nextAssignee = patch.assignee_id !== undefined ? patch.assignee_id : existing.assigneeId;

    await assertAssignable(tx, tenant, nextAssignee, nextGroupId);

    const updated = await tx.ticket.update({
      where: { id: ticketId },
      data: {
        ...(patch.subject !== undefined ? { subject: patch.subject.trim() } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.assignee_id !== undefined ? { assigneeId: patch.assignee_id } : {}),
        ...(patch.group_id !== undefined
          ? { groupId: patch.group_id != null ? BigInt(patch.group_id) : null }
          : {}),
        // Any change is activity; the list is ordered by it.
        lastMessageAt: new Date(),
      },
      include: TICKET_INCLUDE,
    });
    return serialiseDetail(updated, await assigneeNames(tx, [updated]));
  }
}

/**
 * Assignee display names, in one query for the whole page.
 *
 * `tickets.assignee_id` is a bare uuid — PRD §8.4 gives it no foreign key, so
 * Prisma cannot `include` the account and there is nothing to join on. Batched
 * rather than resolved per row, because the per-row version is the N+1 that
 * only shows up once a queue has a few hundred tickets in it.
 */
async function assigneeNames(
  tx: TenantClient,
  rows: Array<{ assigneeId: string | null }>,
): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.assigneeId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const accounts = await tx.account.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(accounts.map((a) => [a.id, a.name]));
}

const TICKET_INCLUDE = {
  customer: { select: { name: true, email: true } },
  sourceChat: { select: { id: true, active: true, createdAt: true } },
} as const;

type TicketRow = Prisma.TicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

/**
 * Reject an assignment that points at nobody.
 *
 * An agent from another licence, or a team that does not exist, would be stored
 * happily by the foreign keys' `SET NULL`/nullable columns and produce a ticket
 * sitting in a queue no one reads.
 */
async function assertAssignable(
  tx: TenantClient,
  context: TenantContext,
  assigneeId: string | null,
  groupId: number | null,
): Promise<void> {
  if (assigneeId) {
    const membership = await tx.agentMembership.findFirst({
      // Suspended agents are excluded: assigning work to someone who cannot
      // sign in is the same as assigning it to nobody, only harder to notice.
      where: { agentId: assigneeId, licenseId: context.licenseId, suspended: false },
      select: { agentId: true },
    });
    if (!membership) {
      throw ApiError.validation('Assignee is not an active agent on this licence.');
    }
  }

  if (groupId != null) {
    const group = await tx.group.findFirst({
      where: { id: BigInt(groupId), licenseId: context.licenseId },
      select: { id: true },
    });
    if (!group) throw ApiError.validation('Team does not exist on this licence.');
  }
}

async function resolveVisibility(
  tx: TenantClient,
  principal: Principal,
  mode: Mode,
): Promise<Visibility> {
  // Tickets are internal work. A customer token reaches the widget surface and
  // nothing else, so there is no customer branch here at all — an absent case
  // cannot be widened by accident later.
  if (principal.kind === 'customer') {
    throw ApiError.authorization('Tickets are not available to customers.');
  }

  const actorId = principal.kind === 'agent' ? principal.accountId : principal.botId;

  if (hasAnyScope(principal.scopes, [SCOPES[mode].all])) {
    return { unrestricted: true, groupIds: [], actorId };
  }
  if (!hasAnyScope(principal.scopes, [SCOPES[mode].scoped])) {
    throw ApiError.authorization('Insufficient permissions for this operation.');
  }

  // Read team membership live rather than trusting the token: removing someone
  // from a team has to take effect now, not when their token next rotates.
  const memberships = await tx.groupAgent.findMany({
    where: { agentId: actorId },
    select: { groupId: true },
  });
  return { unrestricted: false, groupIds: memberships.map((m) => m.groupId), actorId };
}

/**
 * Expressed as a `where` fragment rather than a post-fetch check so pagination
 * stays correct — filtering after the query returns short pages and makes the
 * cursor skip hidden rows.
 */
function visibilityFilter(visibility: Visibility): Record<string, unknown> {
  if (visibility.unrestricted) return {};
  return {
    OR: [
      { assigneeId: visibility.actorId },
      ...(visibility.groupIds.length > 0 ? [{ groupId: { in: visibility.groupIds } }] : []),
    ],
  };
}

function viewFilter(view: TicketView, actorId: string): Record<string, unknown> {
  switch (view) {
    case 'unassigned':
      return { assigneeId: null, status: { in: UNRESOLVED } };
    case 'my_open':
      return { assigneeId: actorId, status: { in: UNRESOLVED } };
    case 'solved':
      return { status: { in: ['solved', 'closed'] } };
    case 'all':
      return {};
  }
}

function queryFilter(query: string | undefined): Record<string, unknown> {
  const trimmed = query?.trim();
  if (!trimmed) return {};
  const contains = { contains: trimmed, mode: 'insensitive' as const };
  return {
    OR: [
      { subject: contains },
      { customer: { name: contains } },
      { customer: { email: contains } },
    ],
  };
}

async function loadVisible(
  tx: TenantClient,
  visibility: Visibility,
  ticketId: string,
): Promise<TicketRow> {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, include: TICKET_INCLUDE });
  if (!ticket) throw ApiError.notFound('Ticket not found.');
  if (visibility.unrestricted) return ticket;

  const mine = ticket.assigneeId === visibility.actorId;
  const viaTeam = ticket.groupId != null && visibility.groupIds.includes(ticket.groupId);
  if (!mine && !viaTeam) throw ApiError.notFound('Ticket not found.');
  return ticket;
}

function canSeeChat(
  visibility: Visibility,
  chat: {
    access: Array<{ groupId: bigint }>;
    users: Array<{ userId: string; userType: string }>;
  },
): boolean {
  if (visibility.unrestricted) return true;
  if (chat.access.some((a) => visibility.groupIds.includes(a.groupId))) return true;
  return chat.users.some((u) => u.userId === visibility.actorId && u.userType === 'agent');
}

function serialise(row: TicketRow, names: Map<string, string>): TicketSummary {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status as TicketStatus,
    assignee_id: row.assigneeId,
    assignee_name: row.assigneeId ? (names.get(row.assigneeId) ?? null) : null,
    group_id: row.groupId != null ? Number(row.groupId) : null,
    customer_id: row.customerId,
    customer_name: row.customer?.name ?? null,
    customer_email: row.customer?.email ?? null,
    source_chat_id: row.sourceChatId,
    last_message_at: row.lastMessageAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function serialiseDetail(row: TicketRow, names: Map<string, string>): TicketDetail {
  return {
    ...serialise(row, names),
    source_chat: row.sourceChat
      ? {
          id: row.sourceChat.id,
          active: row.sourceChat.active,
          created_at: row.sourceChat.createdAt.toISOString(),
        }
      : null,
  };
}

/**
 * A free short id, checked before use.
 *
 * Insert-and-retry is not available inside a transaction: the first failure
 * aborts it. 50 bits of entropy means a collision here is a sign the random
 * source is broken, not something to paper over by looping forever.
 */
async function allocateId(tx: TenantClient): Promise<string> {
  for (let attempt = 0; attempt < ID_GENERATION_ATTEMPTS; attempt++) {
    const candidate = generateShortId();
    const clash = await tx.ticket.findUnique({ where: { id: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  throw ApiError.internal('Could not allocate a unique id.');
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

interface Cursor {
  lastMessageAt: Date | null;
  id: string;
}

/**
 * Keyset pagination over `(last_message_at DESC, id DESC)`.
 *
 * The id tie-break is not optional: two tickets created in the same
 * millisecond would otherwise make the cursor ambiguous, and a page boundary
 * landing between them would drop or repeat one.
 */
function cursorFilter(cursor: Cursor): Record<string, unknown> {
  if (cursor.lastMessageAt === null) return { lastMessageAt: null, id: { lt: cursor.id } };
  return {
    OR: [
      { lastMessageAt: { lt: cursor.lastMessageAt } },
      { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
      { lastMessageAt: null },
    ],
  };
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.lastMessageAt?.toISOString() ?? null, i: cursor.id }),
  ).toString('base64url');
}

function decodeCursor(pageId: string | undefined): Cursor | null {
  if (!pageId) return null;
  try {
    const raw: unknown = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8'));
    if (typeof raw !== 'object' || raw === null) return null;
    const { t, i } = raw as { t?: unknown; i?: unknown };
    if (typeof i !== 'string') return null;
    if (t !== null && typeof t !== 'string') return null;
    const at = t === null || t === undefined ? null : new Date(t);
    if (at && Number.isNaN(at.getTime())) return null;
    return { lastMessageAt: at, id: i };
  } catch {
    // A malformed cursor is a client bug, not a server error: start from the
    // beginning rather than 500.
    return null;
  }
}
