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
import {
  DEFAULT_TICKET_SORT_KEY,
  generateShortId,
  hasAnyScope,
  type CustomFieldValue,
  type SortOrder,
  type TicketBulkSkipReason,
  type TicketSortKey,
} from '@nexa/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import { writeAuditEntry, type AuditContext } from '../audit/audit-log.js';
import type { Principal } from '../auth/principal.js';
import { readCustomFieldValues } from '../custom-fields/custom-field-service.js';
import { evaluate, evaluateSubject, readClock } from '../sla/sla-service.js';
import { applyTicketRules } from './apply-ticket-rules.js';

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
  /** Column the whole collection is ordered by; defaults to newest activity. */
  sort?: TicketSortKey;
  order?: SortOrder;
}

export interface TicketSummary {
  id: string;
  subject: string;
  status: TicketStatus;
  priority: number;
  assignee_id: string | null;
  assignee_name: string | null;
  group_id: number | null;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  source_chat_id: string | null;
  /** The primary this ticket is folded into, or null when it stands alone. */
  merged_into_id: string | null;
  last_message_at: string | null;
  created_at: string;
}

export interface TicketFollowerSummary {
  account_id: string;
  name: string | null;
}

export interface TicketDetail extends TicketSummary {
  source_chat: { id: string; active: boolean; created_at: string } | null;
  followers: TicketFollowerSummary[];
  /** Ids of the tickets merged *into* this one (empty unless it is a primary). */
  merged_ticket_ids: string[];
  /** Tag names on the ticket — what a ticket rule's "add tag" writes (08.6.2). */
  tags: string[];
  /** Custom fields defined for tickets, with this ticket's values (08.7.6). */
  custom_fields: CustomFieldValue[];
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
  priority?: number;
  assignee_id?: string | null;
  group_id?: number | null;
}

/** One selected ticket's verdict in a bulk action (FR-MOD-02.7.1). */
export interface BulkUpdateRowResult {
  ticket_id: string;
  status: 'updated' | 'skipped';
  reason: TicketBulkSkipReason | null;
}

export interface BulkUpdateResult {
  updated: number;
  failed: number;
  /** One entry per requested id, in request order. */
  results: BulkUpdateRowResult[];
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
      // A merged ticket is folded under its primary and never appears in a list
      // on its own — the whole point of a merge is that it stops being separate
      // work. It is still reachable directly via `get` and shown under the
      // primary's `merged_ticket_ids`.
      mergedIntoId: null,
      ...visibilityFilter(visibility),
      ...viewFilter(options.view, visibility.actorId),
      ...queryFilter(options.query),
    };

    // The sort is the server's, over every row the view matches — not the
    // browser's, over the page it happens to hold. Re-ordering a loaded window
    // answers a different question than the header claims to: past the first
    // page the row that should be first was never fetched.
    const sort = options.sort ?? DEFAULT_TICKET_SORT_KEY;
    const order = options.order ?? 'desc';
    const column = SORT_COLUMNS[sort];

    const cursor = decodeCursor(options.pageId, sort, order);
    const [rows, total] = await Promise.all([
      tx.ticket.findMany({
        where: cursor ? { AND: [where, cursorFilter(column, order, cursor)] } : where,
        // Two things this array has to keep true. `nulls: 'last'` is stated
        // rather than left to the database — Postgres defaults DESC to NULLS
        // FIRST, which would float an activity-less ticket above everything
        // worked this morning, and would disagree with the keyset predicate,
        // ending pagination early with no error. And the id tie-break stays
        // `desc` under every sort, because the cursor's own tie-break is
        // `id < …`: a secondary order that flipped with `order` would make the
        // two disagree on rows that compare equal.
        orderBy: [column.orderBy(order), { id: 'desc' }],
        take: options.limit + 1,
        include: TICKET_INCLUDE,
      }),
      tx.ticket.count({ where }),
    ]);

    const hasMore = rows.length > options.limit;
    const page = hasMore ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    const names = await accountNames(
      tx,
      page.map((row) => row.assigneeId),
    );

    return {
      items: page.map((row) => serialise(row, names)),
      total,
      ...(hasMore && last ? { nextPageId: encodeCursor(sort, order, column, last) } : {}),
    };
  }

  async get(tx: TenantClient, principal: Principal, ticketId: string): Promise<TicketDetail> {
    const visibility = await resolveVisibility(tx, principal, 'read');
    const ticket = await loadVisible(tx, visibility, ticketId);
    return toDetail(tx, ticket);
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
      // Ticket rules (FR-MOD-08.6.2): auto-assign / prioritise / tag the fresh
      // ticket before it is ever returned, so it is never briefly visible
      // untriaged. `manual` is a ticket opened straight through the API — a
      // `source` condition targets `chat` or `email`, never it.
      await applyTicketRules(tx, tenant.licenseId, created.id, {
        subject: created.subject,
        source: input.source_chat_id ? 'chat' : 'manual',
      });
      const fresh = await tx.ticket.findUnique({
        where: { id: created.id },
        include: TICKET_INCLUDE,
      });
      return toDetail(tx, fresh ?? created);
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

  /**
   * Create a ticket from an inbound channel (email, FR-MOD-08.5.3).
   *
   * A forwarded email has no agent behind it, so there is no principal and no
   * visibility to resolve — the licence is the one the recipient address
   * resolved to, and RLS on the surrounding `withTenant` confines the write to
   * it. Kept apart from `create()` on purpose: the scope-guarded path stays
   * unreachable without a principal, and this one cannot be called by accident
   * from a request that has an agent token.
   */
  async createFromEmail(
    tx: TenantClient,
    tenant: TenantContext,
    input: { subject: string; customerId: string; inboundAddressId?: string | null },
  ): Promise<{ id: string }> {
    const subject = input.subject.trim() || '(no subject)';
    const created = await tx.ticket.create({
      data: {
        id: await allocateId(tx),
        licenseId: tenant.licenseId,
        subject,
        status: 'open',
        customerId: input.customerId,
        // Which forwarding address this arrived at (FR-MOD-08.5.3). Null when
        // the caller did not name one — a ticket that did not come by e-mail
        // has no mailbox to point at.
        inboundAddressId: input.inboundAddressId ?? null,
        // Set on creation so the ticket sorts from its first moment, matching
        // create(): a null activity timestamp sorts unpredictably in the queue.
        lastMessageAt: new Date(),
      },
      select: { id: true },
    });
    // Ticket rules (FR-MOD-08.6.2): a forwarded email arrives with no agent
    // behind it, so auto-triage matters most here — `source: 'email'` lets a
    // rule target exactly this origin.
    await applyTicketRules(tx, tenant.licenseId, created.id, { subject, source: 'email' });
    return created;
  }

  /**
   * Create a ticket from the widget's offline form (FR-MOD-08.7.7).
   *
   * A sibling of {@link createFromEmail} and kept apart from `create()` for the
   * same reason: the party behind it is a *visitor*, not an agent, so there is
   * no principal and no visibility to resolve, and the scope-guarded path stays
   * unreachable without one. Everything that decides whose ticket this is comes
   * from the customer token — the licence from the surrounding `withTenant`, the
   * contact from the token's own customer id — so no field in the request body
   * can point it anywhere else.
   *
   * `assignee_id`, `group_id`, `priority` and `status` are deliberately absent:
   * a visitor may say what they need, never who should work on it or how
   * urgently. Triage is the ticket rules' job, exactly as it is for a forwarded
   * e-mail — which is why `applyTicketRules` runs here too.
   */
  async createFromWidget(
    tx: TenantClient,
    tenant: TenantContext,
    input: { subject: string; customerId: string },
  ): Promise<{ id: string }> {
    const subject = input.subject.trim() || '(no subject)';
    const created = await tx.ticket.create({
      data: {
        id: await allocateId(tx),
        licenseId: tenant.licenseId,
        subject,
        status: 'open',
        customerId: input.customerId,
        // Set on creation so the ticket sorts from its first moment, matching
        // both other creation paths.
        lastMessageAt: new Date(),
      },
      select: { id: true },
    });
    // Ticket rules (FR-MOD-08.6.2). `widget` is an origin no `source` condition
    // can name (see `TicketRuleContext`), so a subject rule still triages this
    // ticket while a rule scoped to chats or forwarded mail correctly does not.
    await applyTicketRules(tx, tenant.licenseId, created.id, { subject, source: 'widget' });
    return created;
  }

  async update(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    audit: AuditContext,
    ticketId: string,
    patch: UpdateInput,
  ): Promise<TicketDetail> {
    const visibility = await resolveVisibility(tx, principal, 'write');
    const existing = await loadVisible(tx, visibility, ticketId);

    // A merged ticket is folded under its primary; editing it in place would
    // desync the two halves of the merge. Unmerge it first.
    if (existing.mergedIntoId) {
      throw ApiError.validation('Ticket is merged; unmerge it before editing.');
    }

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
        ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
        ...(patch.assignee_id !== undefined ? { assigneeId: patch.assignee_id } : {}),
        ...(patch.group_id !== undefined
          ? { groupId: patch.group_id != null ? BigInt(patch.group_id) : null }
          : {}),
        // Any change is activity; the list is ordered by it.
        lastMessageAt: new Date(),
      },
      include: TICKET_INCLUDE,
    });

    // Lifecycle, priority and ownership are auditable HelpDesk events
    // (FR-MOD-13.6). Written through the shared helper so the single and the
    // bulk endpoint record the same thing: a trail that says different things
    // about the same product action depending on which control was used is not
    // a trail anybody can reason from.
    await writeTicketChangeAudit(tx, audit, ticketId, existing, patch);

    // The resolution clock stops when the ticket leaves the unresolved set
    // (FR-MOD-11.5 · 11.5-d). Only that transition — a solved ticket edited
    // again is not resolved a second time, and the unique key on the breach
    // would ignore it anyway.
    //
    // A ticket has *no first-response clock*, and that is a deliberate refusal
    // rather than an omission: nothing in this repo records an agent replying to
    // a ticket (there is no reply endpoint, and `last_message_at` moves on any
    // edit), so the only candidates would be an assignment or a status change.
    // Reporting either as a "first response" would be a wrong number that looks
    // right. Where a ticket came from a chat, the first reply happened in that
    // conversation and is measured there.
    if (
      patch.status !== undefined &&
      patch.status !== existing.status &&
      UNRESOLVED.includes(existing.status as TicketStatus) &&
      !UNRESOLVED.includes(patch.status)
    ) {
      await evaluateSubject(tx, tenant, {
        subjectType: 'ticket',
        subjectId: ticketId,
        target: 'resolution',
        startedAt: existing.createdAt,
        stoppedAt: new Date(),
      });
    }

    return toDetail(tx, updated);
  }

  /**
   * Apply one change to a selection of tickets (PRD §5.2 "Ticketing
   * (gelişmiş)" · FR-13-EK.3 · FR-MOD-02.7.1).
   *
   * **Partial success, reported per row.** A queue moves while it is being
   * worked: one of the six tickets an agent just selected may have been merged
   * a second ago. Refusing the whole request over it would throw away five
   * correct decisions, so every id gets its own verdict and the writes that
   * succeeded stand. The two verdicts — `not_found` and `merged` — are the two
   * things `PATCH /tickets/{id}` refuses, answered per row instead of as a
   * status code.
   *
   * **What is batched and what is not, deliberately.** The row work is constant
   * in the size of the selection: one read for the whole set, one validation of
   * the assignment target (it names the *request*, not a row — every row would
   * fail it identically, so a bad target is a 400 with nothing written), one
   * `updateMany`, and one read of the SLA calendar for the whole batch rather
   * than per ticket (the shape `sla-service` already offers its sweep). What
   * stays per row is the `audit_log` entry, and that is not an oversight: the
   * chain hashes each entry onto the one before it, so it cannot be batched,
   * and collapsing a fifty-ticket sweep into one summary line would leave
   * forty-nine tickets with nothing in the trail. That per-row cost is what
   * `TICKET_BULK_MAX` bounds.
   *
   * Cross-tenant needs no branch here and that is the point: `tx` is the
   * tenant-scoped client, so row level security means another workspace's id
   * simply does not come back from the read and is reported as `not_found` —
   * the same answer an id that never existed gets (NFR-S5).
   */
  async bulkUpdate(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    audit: AuditContext,
    ticketIds: string[],
    patch: UpdateInput,
  ): Promise<BulkUpdateResult> {
    const visibility = await resolveVisibility(tx, principal, 'write');

    const rows = await tx.ticket.findMany({
      where: { id: { in: ticketIds } },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeId: true,
        groupId: true,
        mergedIntoId: true,
        createdAt: true,
      },
    });
    const found = new Map(rows.map((row) => [row.id, row]));

    // Validated once, before anything is written. An assignee outside the
    // licence or a team that does not exist is a property of the request, so it
    // refuses the request rather than producing fifty identical row failures.
    if (patch.assignee_id !== undefined || patch.group_id !== undefined) {
      await assertAssignable(
        tx,
        tenant,
        patch.assignee_id !== undefined ? patch.assignee_id : null,
        patch.group_id !== undefined ? patch.group_id : null,
      );
    }

    const results: BulkUpdateRowResult[] = [];
    const eligible: typeof rows = [];

    // Request order, so the console can line the report up against the rows the
    // agent ticked without sorting anything.
    for (const id of ticketIds) {
      const row = found.get(id);
      if (!row || !isVisibleTo(visibility, row)) {
        results.push({ ticket_id: id, status: 'skipped', reason: 'not_found' });
        continue;
      }
      // A merged ticket is folded under its primary; editing it in place would
      // desync the two halves of the merge. `update` refuses the same thing.
      if (row.mergedIntoId) {
        results.push({ ticket_id: id, status: 'skipped', reason: 'merged' });
        continue;
      }
      eligible.push(row);
      results.push({ ticket_id: id, status: 'updated', reason: null });
    }

    if (eligible.length > 0) {
      // One stamp for the whole batch: fifty tickets touched by one gesture
      // happened at one moment, and giving them fifty timestamps a millisecond
      // apart would invent an order the agent never expressed.
      const now = new Date();

      await tx.ticket.updateMany({
        where: { id: { in: eligible.map((row) => row.id) } },
        data: {
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.assignee_id !== undefined ? { assigneeId: patch.assignee_id } : {}),
          ...(patch.group_id !== undefined
            ? { groupId: patch.group_id != null ? BigInt(patch.group_id) : null }
            : {}),
          // Any change is activity, exactly as on the single endpoint — the two
          // must not order the queue differently depending on how many rows the
          // agent happened to tick.
          lastMessageAt: now,
        },
      });

      for (const row of eligible) {
        await writeTicketChangeAudit(tx, audit, row.id, row, patch);
      }

      // The resolution clock stops when a ticket leaves the unresolved set
      // (FR-MOD-11.5 · 11.5-d). The calendar is read once for the batch and
      // handed to `evaluate`, which is why `evaluateSubject` is not called in
      // this loop: it rebuilds the business week per subject, and doing that
      // fifty times for one gesture is the N-query shape this endpoint exists
      // to avoid.
      const nextStatus = patch.status;
      const stopping =
        nextStatus !== undefined && !UNRESOLVED.includes(nextStatus)
          ? eligible.filter(
              (row) => row.status !== nextStatus && UNRESOLVED.includes(row.status as TicketStatus),
            )
          : [];
      if (stopping.length > 0) {
        const clock = await readClock(tx, tenant, now);
        if (clock) {
          for (const row of stopping) {
            await evaluate(tx, tenant, clock, {
              subjectType: 'ticket',
              subjectId: row.id,
              target: 'resolution',
              startedAt: row.createdAt,
              stoppedAt: now,
            });
          }
        }
      }
    }

    const updated = results.filter((row) => row.status === 'updated').length;
    return { updated, failed: results.length - updated, results };
  }

  /**
   * Merge one ticket into another (FR-MOD-13.6).
   *
   * The merge is *non-destructive*: it only sets the secondary's `mergedIntoId`,
   * so nothing about either ticket is rewritten and `unmerge` is an exact inverse
   * rather than a reconstruction. The invariants keep the merge graph a
   * one-level star — a secondary points at a primary and nothing deeper:
   *
   *   - a ticket cannot merge into itself (also a DB CHECK);
   *   - the source must not already be merged (unmerge it first);
   *   - the target must be a primary, not itself a secondary (no chains);
   *   - the source must have no tickets merged into it (it is not a primary).
   *
   * Cross-tenant is handled for free: `loadVisible` 404s on a ticket in another
   * workspace, so neither id can name one the caller cannot see.
   */
  async merge(
    tx: TenantClient,
    _tenant: TenantContext,
    principal: Principal,
    audit: AuditContext,
    ticketId: string,
    intoId: string,
  ): Promise<TicketDetail> {
    if (ticketId === intoId) {
      throw ApiError.validation('A ticket cannot be merged into itself.');
    }

    const visibility = await resolveVisibility(tx, principal, 'write');
    const source = await loadVisible(tx, visibility, ticketId);
    const target = await loadVisible(tx, visibility, intoId);

    if (source.mergedIntoId) {
      throw ApiError.validation('Ticket is already merged; unmerge it before merging again.');
    }
    if (target.mergedIntoId) {
      throw ApiError.validation('Cannot merge into a ticket that is itself merged.');
    }
    const childCount = await tx.ticket.count({ where: { mergedIntoId: ticketId } });
    if (childCount > 0) {
      throw ApiError.validation('Cannot merge a ticket that has other tickets merged into it.');
    }

    const merged = await tx.ticket.update({
      where: { id: ticketId },
      data: { mergedIntoId: intoId, lastMessageAt: new Date() },
      include: TICKET_INCLUDE,
    });

    await writeAuditEntry(tx, audit, {
      action: 'ticket.merged',
      target: `ticket:${ticketId}`,
      metadata: { into: intoId },
    });

    return toDetail(tx, merged);
  }

  /** Undo a merge (FR-MOD-13.6). Clears the pointer — the exact inverse of merge. */
  async unmerge(
    tx: TenantClient,
    _tenant: TenantContext,
    principal: Principal,
    audit: AuditContext,
    ticketId: string,
  ): Promise<TicketDetail> {
    const visibility = await resolveVisibility(tx, principal, 'write');
    const ticket = await loadVisible(tx, visibility, ticketId);

    if (!ticket.mergedIntoId) {
      throw ApiError.validation('Ticket is not merged.');
    }

    const restored = await tx.ticket.update({
      where: { id: ticketId },
      data: { mergedIntoId: null, lastMessageAt: new Date() },
      include: TICKET_INCLUDE,
    });

    await writeAuditEntry(tx, audit, {
      action: 'ticket.unmerged',
      target: `ticket:${ticketId}`,
      metadata: { from: ticket.mergedIntoId },
    });

    return toDetail(tx, restored);
  }

  /**
   * Add a follower to a ticket (FR-MOD-13.6). Idempotent: following a ticket the
   * agent already follows is a no-op and writes no second audit row.
   */
  async addFollower(
    tx: TenantClient,
    tenant: TenantContext,
    principal: Principal,
    audit: AuditContext,
    ticketId: string,
    accountId: string,
  ): Promise<TicketDetail> {
    const visibility = await resolveVisibility(tx, principal, 'write');
    await loadVisible(tx, visibility, ticketId);
    await assertFollower(tx, tenant, accountId);

    const already = await tx.ticketFollower.findUnique({
      where: { ticketId_accountId: { ticketId, accountId } },
      select: { ticketId: true },
    });
    if (!already) {
      await tx.ticketFollower.create({ data: { ticketId, accountId } });
      await writeAuditEntry(tx, audit, {
        action: 'ticket.follower_added',
        target: `ticket:${ticketId}`,
        metadata: { account_id: accountId },
      });
    }

    return toDetail(tx, await loadVisible(tx, visibility, ticketId));
  }

  /** Remove a follower (FR-MOD-13.6). Idempotent, mirroring `addFollower`. */
  async removeFollower(
    tx: TenantClient,
    _tenant: TenantContext,
    principal: Principal,
    audit: AuditContext,
    ticketId: string,
    accountId: string,
  ): Promise<TicketDetail> {
    const visibility = await resolveVisibility(tx, principal, 'write');
    await loadVisible(tx, visibility, ticketId);

    const existing = await tx.ticketFollower.findUnique({
      where: { ticketId_accountId: { ticketId, accountId } },
      select: { ticketId: true },
    });
    if (existing) {
      await tx.ticketFollower.delete({ where: { ticketId_accountId: { ticketId, accountId } } });
      await writeAuditEntry(tx, audit, {
        action: 'ticket.follower_removed',
        target: `ticket:${ticketId}`,
        metadata: { account_id: accountId },
      });
    }

    return toDetail(tx, await loadVisible(tx, visibility, ticketId));
  }
}

/**
 * Account display names, in one query for a whole set of ids.
 *
 * `tickets.assignee_id` and `ticket_followers.account_id` are bare uuids — PRD
 * §8.4 gives the assignee no foreign key, and the follower join carries only the
 * id. Prisma cannot `include` an account off the assignee, so names are resolved
 * in a single batched lookup: the per-row alternative is the N+1 that only shows
 * up once a queue has a few hundred tickets in it.
 */
async function accountNames(
  tx: TenantClient,
  ids: Array<string | null | undefined>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === 'string'))];
  if (unique.length === 0) return new Map();
  const accounts = await tx.account.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(accounts.map((a) => [a.id, a.name]));
}

/**
 * Assemble a ticket's full detail: its followers and the ids of any tickets
 * merged into it, resolved fresh from the database rather than from the passed
 * row, so a caller that has just changed followers or a merge sees the result.
 */
async function toDetail(tx: TenantClient, row: TicketRow): Promise<TicketDetail> {
  const [followers, children, tags, customFields] = await Promise.all([
    tx.ticketFollower.findMany({
      where: { ticketId: row.id },
      select: { accountId: true },
      orderBy: { createdAt: 'asc' },
    }),
    tx.ticket.findMany({
      where: { mergedIntoId: row.id },
      select: { id: true },
      orderBy: { id: 'asc' },
    }),
    tx.ticketTag.findMany({
      where: { ticketId: row.id },
      select: { tag: { select: { name: true } } },
      orderBy: { taggedAt: 'asc' },
    }),
    readCustomFieldValues(tx, row.licenseId, 'ticket', row.id),
  ]);
  const followerIds = followers.map((f) => f.accountId);
  const names = await accountNames(tx, [row.assigneeId, ...followerIds]);
  return serialiseDetail(
    row,
    names,
    followerIds,
    children.map((c) => c.id),
    tags.map((t) => t.tag.name),
    customFields,
  );
}

/**
 * Reject a follower who is not a member of the licence.
 *
 * Suspended members are allowed: following is passive watching, not work, so
 * there is no "assigning to someone who cannot sign in" problem that
 * `assertAssignable` guards against. What matters is that the account belongs to
 * the workspace at all — a uuid from another tenant is refused.
 */
async function assertFollower(
  tx: TenantClient,
  context: TenantContext,
  accountId: string,
): Promise<void> {
  const membership = await tx.agentMembership.findFirst({
    where: { agentId: accountId, licenseId: context.licenseId },
    select: { agentId: true },
  });
  if (!membership) {
    throw ApiError.validation('Follower is not a member of this licence.');
  }
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
  // Same shape, same reason, for a SCIM provisioning token (NFR-S11): it reaches
  // `/scim/v2` and nothing else, so an absent case here would be a directory
  // credential silently taking the bot branch.
  if (principal.kind === 'scim') {
    throw ApiError.authorization('Provisioning credentials cannot access tickets.');
  }
  // And a two-factor enrollment ticket (S11-2FA-k), which reaches the two
  // enrollment endpoints and nothing else.
  if (principal.kind === 'enrollment') {
    throw ApiError.authorization('Enrollment credentials cannot access tickets.');
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

/** The fields an audit comparison needs — narrow on purpose, so the bulk path's
 * lean `select` and the single path's full row both satisfy it. */
interface AuditableTicketState {
  status: string;
  priority: number;
  assigneeId: string | null;
  groupId: bigint | null;
}

/**
 * Record what actually changed about one ticket.
 *
 * The single writer for ticket-change entries, so `PATCH /tickets/{id}` and
 * `POST /tickets/bulk` cannot drift. Only a *real* transition writes a row — a
 * request that sets a field to what it already was should not litter the
 * append-only log, and the bulk path makes that matter: "solve these fifty"
 * over a queue where forty were already solved must add ten entries, not fifty.
 */
async function writeTicketChangeAudit(
  tx: TenantClient,
  audit: AuditContext,
  ticketId: string,
  before: AuditableTicketState,
  patch: UpdateInput,
): Promise<void> {
  const target = `ticket:${ticketId}`;

  if (patch.status !== undefined && patch.status !== before.status) {
    await writeAuditEntry(tx, audit, {
      action: 'ticket.status_changed',
      target,
      metadata: { from: before.status, to: patch.status },
    });
  }

  if (patch.priority !== undefined && patch.priority !== before.priority) {
    await writeAuditEntry(tx, audit, {
      action: 'ticket.priority_changed',
      target,
      metadata: { from: before.priority, to: patch.priority },
    });
  }

  // Assignee and team are one entry, not two: "who works this now" is a single
  // decision even when a move between teams carries the person with it, and
  // splitting it would make a reassignment read as two unrelated events.
  const groupBefore = before.groupId != null ? Number(before.groupId) : null;
  const assigneeMoved = patch.assignee_id !== undefined && patch.assignee_id !== before.assigneeId;
  const groupMoved = patch.group_id !== undefined && patch.group_id !== groupBefore;
  if (assigneeMoved || groupMoved) {
    await writeAuditEntry(tx, audit, {
      action: 'ticket.assigned',
      target,
      metadata: {
        ...(assigneeMoved
          ? { from_assignee: before.assigneeId, to_assignee: patch.assignee_id }
          : {}),
        ...(groupMoved ? { from_group: groupBefore, to_group: patch.group_id } : {}),
      },
    });
  }
}

/**
 * Can this caller see this ticket? The in-memory half of `visibilityFilter`,
 * shared by the single load and the bulk selection so one ticket cannot be
 * visible through one endpoint and invisible through the other.
 */
function isVisibleTo(
  visibility: Visibility,
  row: { assigneeId: string | null; groupId: bigint | null },
): boolean {
  if (visibility.unrestricted) return true;
  if (row.assigneeId === visibility.actorId) return true;
  return row.groupId != null && visibility.groupIds.includes(row.groupId);
}

async function loadVisible(
  tx: TenantClient,
  visibility: Visibility,
  ticketId: string,
): Promise<TicketRow> {
  const ticket = await tx.ticket.findUnique({ where: { id: ticketId }, include: TICKET_INCLUDE });
  if (!ticket) throw ApiError.notFound('Ticket not found.');
  if (!isVisibleTo(visibility, ticket)) throw ApiError.notFound('Ticket not found.');
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
    priority: row.priority,
    assignee_id: row.assigneeId,
    assignee_name: row.assigneeId ? (names.get(row.assigneeId) ?? null) : null,
    group_id: row.groupId != null ? Number(row.groupId) : null,
    customer_id: row.customerId,
    customer_name: row.customer?.name ?? null,
    customer_email: row.customer?.email ?? null,
    source_chat_id: row.sourceChatId,
    merged_into_id: row.mergedIntoId,
    last_message_at: row.lastMessageAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function serialiseDetail(
  row: TicketRow,
  names: Map<string, string>,
  followerIds: string[],
  mergedTicketIds: string[],
  tags: string[],
  customFields: CustomFieldValue[],
): TicketDetail {
  return {
    ...serialise(row, names),
    source_chat: row.sourceChat
      ? {
          id: row.sourceChat.id,
          active: row.sourceChat.active,
          created_at: row.sourceChat.createdAt.toISOString(),
        }
      : null,
    followers: followerIds.map((id) => ({ account_id: id, name: names.get(id) ?? null })),
    merged_ticket_ids: mergedTicketIds,
    tags,
    custom_fields: customFields,
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

/** The cursor's comparable half - whatever the sorted column holds. */
type SortValue = string | number | null;

/**
 * One sortable column, expressed four ways: how to order by it, how to read the
 * cursor value off a row, and the two `where` fragments the keyset predicate
 * needs (past this value, exactly this value). Kept together so a column cannot
 * be half-added - an `orderBy` without a matching predicate pages silently
 * wrong rather than failing.
 */
interface SortColumn {
  /**
   * Whether the column can be empty. Empty cells sort *last* in both directions
   * - a ticket with no customer or no activity should never outrank a real one
   * just because the order flipped - so the keyset predicate has to treat them
   * as a trailing block rather than as a comparable value.
   */
  nullable: boolean;
  orderBy: (order: SortOrder) => Record<string, unknown>;
  valueOf: (row: TicketRow) => SortValue;
  /** Rows past `value` in the reading direction. */
  beyond: (op: 'gt' | 'lt', value: string | number) => Record<string, unknown>;
  equals: (value: string | number) => Record<string, unknown>;
  /** Rows whose cell is empty; only meaningful when `nullable`. */
  empty: () => Record<string, unknown>;
}

const SORT_COLUMNS: Record<TicketSortKey, SortColumn> = {
  last_message: {
    nullable: true,
    orderBy: (order) => ({ lastMessageAt: { sort: order, nulls: 'last' } }),
    valueOf: (row) => row.lastMessageAt?.toISOString() ?? null,
    beyond: (op, value) => ({ lastMessageAt: { [op]: new Date(value) } }),
    equals: (value) => ({ lastMessageAt: new Date(value) }),
    empty: () => ({ lastMessageAt: null }),
  },
  subject: {
    nullable: false,
    orderBy: (order) => ({ subject: order }),
    valueOf: (row) => row.subject,
    beyond: (op, value) => ({ subject: { [op]: value } }),
    equals: (value) => ({ subject: value }),
    empty: () => ({}),
  },
  priority: {
    nullable: false,
    orderBy: (order) => ({ priority: order }),
    valueOf: (row) => row.priority,
    beyond: (op, value) => ({ priority: { [op]: value } }),
    equals: (value) => ({ priority: value }),
    empty: () => ({}),
  },
  customer: {
    nullable: true,
    // Through the relation rather than a copy of the name on the ticket: the
    // grid shows the customer's current name, and a denormalised one would sort
    // by whatever they were called when the ticket was opened.
    orderBy: (order) => ({ customer: { name: { sort: order, nulls: 'last' } } }),
    valueOf: (row) => row.customer?.name ?? null,
    beyond: (op, value) => ({ customer: { is: { name: { [op]: value } } } }),
    equals: (value) => ({ customer: { is: { name: value } } }),
    // Two ways to have no name to sort on, and the grid renders both as the
    // same empty cell: no customer at all (a standalone ticket), or a visitor
    // who never gave one.
    empty: () => ({ OR: [{ customerId: null }, { customer: { is: { name: null } } }] }),
  },
};

interface Cursor {
  value: SortValue;
  id: string;
}

/**
 * Keyset pagination over `(<sorted column> <order>, id DESC)`.
 *
 * The id tie-break is not optional: two tickets with the same subject - or the
 * same priority, which is the default for most of them - would otherwise make
 * the cursor ambiguous, and a page boundary landing between them would drop or
 * repeat one.
 */
function cursorFilter(
  column: SortColumn,
  order: SortOrder,
  cursor: Cursor,
): Record<string, unknown> {
  // The previous page ended inside the trailing block of empty cells, so there
  // is nothing left to compare against - only the tie-break moves forward.
  if (cursor.value === null) return { AND: [column.empty(), { id: { lt: cursor.id } }] };

  return {
    OR: [
      column.beyond(order === 'asc' ? 'gt' : 'lt', cursor.value),
      { AND: [column.equals(cursor.value), { id: { lt: cursor.id } }] },
      // Empty cells trail the whole collection, so they are still ahead of any
      // row that has a value - in *both* directions, which is why this arm is
      // not conditioned on `order`.
      ...(column.nullable ? [column.empty()] : []),
    ],
  };
}

/**
 * The cursor records the ordering it was issued under, not only the position.
 *
 * A keyset cursor is a position *in an ordering*: "everything after this
 * subject" says nothing once the caller asks for priority order. Carrying the
 * sort is what makes that detectable instead of silently answering with a page
 * one that looks like a page two.
 */
function encodeCursor(
  sort: TicketSortKey,
  order: SortOrder,
  column: SortColumn,
  row: TicketRow,
): string {
  return Buffer.from(
    JSON.stringify({ k: sort, o: order, v: column.valueOf(row), i: row.id }),
  ).toString('base64url');
}

function decodeCursor(
  pageId: string | undefined,
  sort: TicketSortKey,
  order: SortOrder,
): Cursor | null {
  if (!pageId) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8'));
  } catch {
    // A malformed cursor is a client bug, not a server error: start from the
    // beginning rather than 500.
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;

  const { k, o, v, i } = raw as { k?: unknown; o?: unknown; v?: unknown; i?: unknown };
  if (typeof i !== 'string' || typeof k !== 'string' || typeof o !== 'string') return null;
  if (v !== null && typeof v !== 'string' && typeof v !== 'number') return null;

  // Refused rather than restarted. Restarting would hand back rows the caller
  // already has, labelled as the next page - the exact failure a cursor exists
  // to prevent, and one nothing downstream could notice.
  if (k !== sort || o !== order) {
    throw ApiError.validation('page_id was issued for a different sort; start the list again.');
  }

  if (typeof v === 'string' && sort === 'last_message' && Number.isNaN(Date.parse(v))) return null;
  return { value: v, id: i };
}
