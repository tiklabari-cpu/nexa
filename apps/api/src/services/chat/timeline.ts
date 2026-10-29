/**
 * The conversation timeline (ID-09 · tm 334.1): everything that happened in
 * one day or one connection, in one list — `GET /chats/{chatId}/timeline` and
 * its export, `POST /chats/{chatId}/timeline/export`.
 *
 * Nine sources, each read through its own index and only ever a page at a
 * time (ID-09 "her kaynak kendi indeksiyle sınırlı"):
 *
 *   events            (chat_id, created_at)        message · note · system ·
 *                                                   transfer · assignment
 *   ai_decision_logs  (chat_id, created_at)        ai_decision
 *   skill_runs        (thread_id)                  ai_decision (procedure runs)
 *   queue + threads   (thread_id), the chat's rows  assignment
 *   thread_tags       (thread_id, tag_id)          tag
 *   ratings           (license_id, thread_id, …)   rating
 *   sla_breaches      (license_id, subject_type, subject_id, …) sla_breach
 *   tickets           (source_chat_id)             ticket
 *   audit_log         (license_id, target, created_at) audit
 *
 * **Order and paging.** Rows are ordered by `(at, kind, source, id)` — `kind`
 * in `TIMELINE_KINDS` order, so in one millisecond the message comes before
 * the AI's decision about it. Each source is read in its own order, `(at,
 * id)`, `limit + 1` rows past the cursor, and the pages are merged. A source
 * that had more rows than that sets a horizon: its unread rows may still sort
 * before rows of other sources at its last millisecond, so the page stops
 * there — that millisecond is first read whole (`SAME_MS_CAP`), so the
 * horizon always moves forward. Keys are milliseconds: `Date` holds no more,
 * and the reads bound their ranges on the same milliseconds.
 *
 * **Who reads it.** `timeline.view` (RL-02 matrix, ID-09-S1) inside the chat's
 * visibility (`resolveVisibility` + `canSeeChat`): `own` — a chat the person
 * is assigned to or has joined; `team` — one routed to a team of theirs;
 * `all` — any chat they may see. Outside that reach the chat is a 404, as
 * every chat read is (NFR-S5). The audit rows are for a caller who may read
 * the audit log; the player's email and username follow
 * `customers.contact.view`, blanked out of every text and detail.
 *
 * Read-only, on the caller's tenant transaction: row level security decides
 * the workspace.
 */
import type { Prisma } from '@prisma/client';
import {
  TIMELINE_EXPORT_COLUMNS,
  TIMELINE_KINDS,
  TIMELINE_PAGE_SIZE,
  capabilityAtLeast,
  hasAnyScope,
  type CapabilityValue,
  type TimelineActor,
  type TimelineActorType,
  type TimelineExportFormat,
  type TimelineItem,
  type TimelineKind,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import { maskPii } from '../../lib/log-redact.js';
import type { TenantClient } from '../../lib/tenant.js';
import { csvRows } from '../../routes/reports-export.js';
import { requireCapability } from '../auth/capability.js';
import type { Principal } from '../auth/principal.js';
import { REDACTED, redactPlayerContact, seesPlayerContact } from '../customers/player-contact.js';
import { canSeeChat, resolveVisibility } from './access.js';

/**
 * The most rows of one source read for one millisecond. A source writing more
 * than this in a single millisecond of one chat would lose the rest from the
 * timeline; nothing writes that densely.
 */
const SAME_MS_CAP = 1000;

/** The most queue stays read for one chat — a connection queues a handful of times. */
const QUEUE_ENTRIES_CAP = 1000;

const KIND_RANK: Readonly<Record<TimelineKind, number>> = Object.fromEntries(
  TIMELINE_KINDS.map((kind, rank) => [kind, rank]),
) as Record<TimelineKind, number>;

/** Past every rank: a cursor at "the end of this millisecond". */
const END_RANK = 99;

/** What the read needs of the chat, loaded once when it is opened. */
export interface TimelineScope {
  licenseId: bigint;
  chatId: string;
  /** The connection asked for, or null for the whole day. */
  threadId: string | null;
  /** The connections read: the one asked for, or all of the day's. */
  threadIds: string[];
  threads: Array<{
    id: string;
    createdAt: Date;
    assigneeId: string | null;
    assignedAt: Date | null;
  }>;
  chatCreatedAt: Date;
  customer: {
    id: string;
    name: string | null;
    email: string | null;
    username: string | null;
  };
  /** Whether the audit rows are part of the read. */
  auditIncluded: boolean;
  /** Whether the caller may see the player's email and username. */
  contactVisible: boolean;
}

interface Row {
  at: Date;
  kind: TimelineKind;
  source: number;
  id: string;
  actor: { type: TimelineActorType; id: string | null };
  threadId: string | null;
  eventId?: string;
  text?: string;
  details: Record<string, unknown>;
}

interface Cursor {
  at: number;
  kind: number;
  source: number;
  id: string;
}

interface Range {
  gte?: Date;
  lt?: Date;
}

interface Source {
  rank: number;
  kinds: readonly TimelineKind[];
  /** Rows in `range`, in `(at, id)` order, the first `take`. */
  read(tx: TenantClient, scope: TimelineScope, range: Range, take: number): Promise<Row[]>;
}

/**
 * Open the timeline of `chatId` for `principal`: the reach check, the chat's
 * connections and player. A 403 for a role at `timeline.view` `none`, a 404
 * for a chat outside the reach and for a thread of another chat.
 */
export async function openTimeline(
  tx: TenantClient,
  principal: Principal,
  chatId: string,
  threadId: string | undefined,
): Promise<TimelineScope> {
  // A bot has no role: its scopes are its whole answer, bounded below by the
  // chat's visibility like every chat read.
  const level: CapabilityValue | undefined =
    principal.kind === 'agent' ? principal.capabilities['timeline.view'] : 'all';
  if (principal.kind === 'agent') requireCapability(principal, 'timeline.view');

  const visibility = await resolveVisibility(tx, principal, 'read');
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      licenseId: true,
      customerId: true,
      createdAt: true,
      access: { select: { groupId: true } },
      users: { select: { userId: true, userType: true } },
      threads: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, createdAt: true, assigneeId: true, assignedAt: true },
      },
      customer: { select: { id: true, name: true, email: true, username: true } },
    },
  });
  if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');

  if (principal.kind === 'agent' && !capabilityAtLeast('timeline.view', level, 'all')) {
    const me = visibility.actorId;
    const own =
      chat.users.some((u) => u.userId === me && u.userType === 'agent') ||
      chat.threads.some((t) => t.assigneeId === me);
    let reached = own;
    if (!reached && capabilityAtLeast('timeline.view', level, 'team')) {
      // The person's teams, read now: `chats.view` `all` leaves them out of
      // the visibility, and leaving a team must narrow at once.
      const memberships = await tx.groupAgent.findMany({
        where: { agentId: me },
        select: { groupId: true },
      });
      const teams = new Set(memberships.map((m) => m.groupId));
      reached = chat.access.some((a) => teams.has(a.groupId));
    }
    if (!reached) throw ApiError.notFound('Chat not found.');
  }

  if (threadId !== undefined && !chat.threads.some((t) => t.id === threadId)) {
    throw ApiError.notFound('Thread not found.');
  }
  const threads =
    threadId === undefined ? chat.threads : chat.threads.filter((t) => t.id === threadId);

  return {
    licenseId: chat.licenseId,
    chatId: chat.id,
    threadId: threadId ?? null,
    threadIds: threads.map((t) => t.id),
    threads,
    chatCreatedAt: chat.createdAt,
    customer: chat.customer,
    auditIncluded: readsAuditLog(principal),
    contactVisible: seesPlayerContact(principal),
  };
}

/** Whether the caller may read the audit log — its scope, and for a person the matrix row. */
function readsAuditLog(principal: Principal): boolean {
  if (principal.kind !== 'agent' && principal.kind !== 'bot') return false;
  if (!hasAnyScope(principal.scopes, ['audit_log--all:ro'])) return false;
  return (
    principal.kind !== 'agent' ||
    capabilityAtLeast('logs.audit.view', principal.capabilities['logs.audit.view'])
  );
}

export interface TimelineRowsOptions {
  pageId?: string;
  limit?: number;
  kinds?: readonly TimelineKind[];
}

/** One page of rows, serialised, and the cursor of the next. */
export async function readTimelineRows(
  tx: TenantClient,
  scope: TimelineScope,
  options: TimelineRowsOptions = {},
): Promise<{ items: TimelineItem[]; nextPageId: string | null }> {
  const cursor = options.pageId === undefined ? null : decodeCursor(options.pageId);
  if (options.pageId !== undefined && cursor === null) {
    throw ApiError.validation('page_id: not a cursor this timeline wrote.');
  }
  const limit = options.limit ?? TIMELINE_PAGE_SIZE;
  const wanted = new Set<TimelineKind>(options.kinds ?? TIMELINE_KINDS);
  const sources = SOURCES.filter(
    (source) =>
      source.kinds.some((kind) => wanted.has(kind)) &&
      (source !== AUDIT_SOURCE || scope.auditIncluded),
  );

  const merged: Row[] = [];
  let horizon: number | null = null;
  for (const source of sources) {
    const got: Row[] = [];
    let from: Date | undefined;
    if (cursor) {
      const same = await source.read(tx, scope, msRange(cursor.at), SAME_MS_CAP);
      got.push(...same.filter((row) => compareToCursor(row, cursor) > 0));
      from = new Date(cursor.at + 1);
    }
    const after = await source.read(tx, scope, from ? { gte: from } : {}, limit + 1);
    if (after.length > limit) {
      // More rows than one page: read the last millisecond whole, and stop the
      // page there — the unread rows all come after it.
      const last = after[after.length - 1]!.at.getTime();
      const whole = await source.read(tx, scope, msRange(last), SAME_MS_CAP);
      got.push(...after.filter((row) => row.at.getTime() < last), ...whole);
      horizon = horizon === null ? last : Math.min(horizon, last);
    } else {
      got.push(...after);
    }
    for (const row of got) if (wanted.has(row.kind)) merged.push(row);
  }

  merged.sort(compareRows);
  const safe = horizon === null ? merged : merged.filter((row) => row.at.getTime() <= horizon);
  let page = safe;
  let next: Cursor | null = null;
  if (safe.length > limit) {
    page = safe.slice(0, limit);
    const last = page[page.length - 1]!;
    next = { at: last.at.getTime(), kind: KIND_RANK[last.kind], source: last.source, id: last.id };
  } else if (horizon !== null) {
    next = { at: horizon, kind: END_RANK, source: END_RANK, id: '' };
  }

  return {
    items: await serialise(tx, scope, page),
    nextPageId: next === null ? null : encodeCursor(next),
  };
}

// --- sources ------------------------------------------------------------------

function msRange(at: number): Range {
  return { gte: new Date(at), lt: new Date(at + 1) };
}

function dateFilter(range: Range): Prisma.DateTimeFilter | undefined {
  if (range.gte === undefined && range.lt === undefined) return undefined;
  return {
    ...(range.gte !== undefined ? { gte: range.gte } : {}),
    ...(range.lt !== undefined ? { lt: range.lt } : {}),
  };
}

function inRange(at: Date, range: Range): boolean {
  const ms = at.getTime();
  return (
    (range.gte === undefined || ms >= range.gte.getTime()) &&
    (range.lt === undefined || ms < range.lt.getTime())
  );
}

function bySourceOrder(a: Row, b: Row): number {
  return a.at.getTime() - b.at.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function actorType(type: string): TimelineActorType {
  return type === 'agent' || type === 'customer' || type === 'bot' ? type : 'system';
}

const EVENT_SOURCE: Source = {
  rank: 0,
  kinds: ['message', 'note', 'system', 'transfer', 'assignment'],
  async read(tx, scope, range, take) {
    const rows = await tx.event.findMany({
      where: {
        chatId: scope.chatId,
        ...(scope.threadId !== null ? { threadId: scope.threadId } : {}),
        ...(dateFilter(range) ? { createdAt: dateFilter(range) } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
        threadId: true,
        type: true,
        text: true,
        authorId: true,
        authorType: true,
        recipients: true,
        attachmentUrl: true,
        properties: true,
        createdAt: true,
      },
    });
    return rows.map((event): Row => {
      const properties = record(event.properties);
      const systemEvent =
        typeof properties.system_event === 'string' ? properties.system_event : null;
      const kind: TimelineKind =
        event.type === 'system_message'
          ? systemEvent === 'chat_transferred'
            ? 'transfer'
            : systemEvent === 'chat_taken_over'
              ? 'assignment'
              : 'system'
          : event.recipients === 'agents'
            ? 'note'
            : 'message';
      return {
        at: event.createdAt,
        kind,
        source: 0,
        id: event.id,
        actor: { type: actorType(event.authorType), id: event.authorId },
        threadId: event.threadId,
        eventId: event.id,
        ...(event.text !== null ? { text: event.text } : {}),
        details: {
          type: event.type,
          recipients: event.recipients,
          ...(systemEvent !== null ? { system_event: systemEvent } : {}),
          ...(event.attachmentUrl !== null ? { attachment_url: event.attachmentUrl } : {}),
          properties,
        },
      };
    });
  },
};

const AI_DECISION_SOURCE: Source = {
  rank: 1,
  kinds: ['ai_decision'],
  async read(tx, scope, range, take) {
    const rows = await tx.aiDecisionLog.findMany({
      where: {
        chatId: scope.chatId,
        ...(scope.threadId !== null ? { threadId: scope.threadId } : {}),
        ...(dateFilter(range) ? { createdAt: dateFilter(range) } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
    });
    const procedures = await procedureNames(
      tx,
      rows.map((row) => row.procedureId),
    );
    return rows.map((row): Row => {
      const procedure = row.procedureId ? (procedures.get(row.procedureId) ?? null) : null;
      const answered = row.replyEventId ?? row.triggerEventId;
      const text = [
        row.decision,
        procedure ? `procedure: ${procedure}${row.step ? ` · step ${row.step}` : ''}` : null,
        row.handoffReason ? `handoff reason: ${row.handoffReason}` : null,
        row.knowledgeSourceIds.length > 0 ? `sources: ${row.knowledgeSourceIds.length}` : null,
      ]
        .filter((part): part is string => part !== null)
        .join(' · ');
      return {
        at: row.createdAt,
        kind: 'ai_decision',
        source: 1,
        id: row.id,
        actor: { type: 'ai', id: null },
        threadId: row.threadId,
        ...(answered !== null ? { eventId: answered } : {}),
        text,
        details: {
          source: 'ai_decision_log',
          decision: row.decision,
          procedure_id: row.procedureId,
          procedure_name: procedure,
          procedure_version: row.procedureVersion,
          step: row.step,
          knowledge_source_ids: row.knowledgeSourceIds,
          chunk_ids: row.chunkIds,
          retrieval_scores: row.retrievalScores,
          guardrail_hits: row.guardrailHits,
          handoff_reason: row.handoffReason,
          risk_flags: row.riskFlags,
          model: row.model,
          latency_ms: row.latencyMs,
          error_type: row.errorType,
          trigger_event_id: row.triggerEventId,
          reply_event_id: row.replyEventId,
          request_id: row.requestId,
          job_id: row.jobId,
          config_version_id: row.configVersionId,
          extra: row.details,
        },
      };
    });
  },
};

const SKILL_RUN_SOURCE: Source = {
  rank: 2,
  kinds: ['ai_decision'],
  async read(tx, scope, range, take) {
    if (scope.threadIds.length === 0) return [];
    const rows = await tx.skillRun.findMany({
      where: {
        threadId: { in: scope.threadIds },
        ...(dateFilter(range) ? { ranAt: dateFilter(range) } : {}),
      },
      orderBy: [{ ranAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
        skillId: true,
        threadId: true,
        status: true,
        log: true,
        ranAt: true,
        skill: { select: { name: true } },
      },
    });
    return rows.map((row): Row => ({
      at: row.ranAt,
      kind: 'ai_decision',
      source: 2,
      id: row.id,
      actor: { type: 'ai', id: null },
      threadId: row.threadId,
      text: `procedure run: ${row.skill.name} · ${row.status}`,
      details: {
        source: 'skill_run',
        skill_id: row.skillId,
        skill_name: row.skill.name,
        status: row.status,
        steps: Array.isArray(row.log) ? row.log.length : 0,
      },
    }));
  },
};

/**
 * Assignment: each stay in the routing queue (entered, and how it ended) and
 * each connection's current holder since `assigned_at`. A connection holds a
 * handful of stays, so they are read whole and cut to the range here.
 */
const ROUTING_SOURCE: Source = {
  rank: 3,
  kinds: ['assignment'],
  async read(tx, scope, range, take) {
    const rows: Row[] = [];
    for (const thread of scope.threads) {
      if (thread.assigneeId !== null && thread.assignedAt !== null) {
        rows.push({
          at: thread.assignedAt,
          kind: 'assignment',
          source: 3,
          id: `${thread.id}:assigned`,
          actor: { type: 'system', id: null },
          threadId: thread.id,
          text: 'assigned',
          details: { action: 'assigned', agent_id: thread.assigneeId },
        });
      }
    }
    if (scope.threadIds.length > 0) {
      const entries = await tx.queueEntry.findMany({
        where: { threadId: { in: scope.threadIds } },
        orderBy: [{ enteredAt: 'asc' }, { id: 'asc' }],
        take: QUEUE_ENTRIES_CAP,
        select: {
          id: true,
          threadId: true,
          groupId: true,
          enteredAt: true,
          leftAt: true,
          outcome: true,
        },
      });
      for (const entry of entries) {
        const group = entry.groupId === null ? null : Number(entry.groupId);
        rows.push({
          at: entry.enteredAt,
          kind: 'assignment',
          source: 3,
          id: `${entry.id}:entered`,
          actor: { type: 'system', id: null },
          threadId: entry.threadId,
          text: 'queued',
          details: { action: 'queued', group_id: group },
        });
        if (entry.leftAt !== null) {
          rows.push({
            at: entry.leftAt,
            kind: 'assignment',
            source: 3,
            id: `${entry.id}:left`,
            actor: { type: 'system', id: null },
            threadId: entry.threadId,
            text: `left the queue: ${entry.outcome ?? 'unknown'}`,
            details: { action: 'left_queue', outcome: entry.outcome, group_id: group },
          });
        }
      }
    }
    return rows
      .filter((row) => inRange(row.at, range))
      .sort(bySourceOrder)
      .slice(0, take);
  },
};

const TAG_SOURCE: Source = {
  rank: 4,
  kinds: ['tag'],
  async read(tx, scope, range, take) {
    if (scope.threadIds.length === 0) return [];
    const rows = await tx.threadTag.findMany({
      where: {
        threadId: { in: scope.threadIds },
        ...(dateFilter(range) ? { taggedAt: dateFilter(range) } : {}),
      },
      orderBy: [{ taggedAt: 'asc' }, { tagId: 'asc' }],
      take,
      select: { threadId: true, tagId: true, taggedAt: true, tag: { select: { name: true } } },
    });
    return rows
      .map((row): Row => ({
        at: row.taggedAt,
        kind: 'tag',
        source: 4,
        id: `${row.threadId}:${row.tagId}`,
        actor: { type: 'system', id: null },
        threadId: row.threadId,
        text: row.tag.name,
        details: { tag_id: row.tagId, tag: row.tag.name },
      }))
      .sort(bySourceOrder);
  },
};

const RATING_SOURCE: Source = {
  rank: 5,
  kinds: ['rating'],
  async read(tx, scope, range, take) {
    if (scope.threadIds.length === 0) return [];
    const rows = await tx.rating.findMany({
      where: {
        licenseId: scope.licenseId,
        threadId: { in: scope.threadIds },
        ...(dateFilter(range) ? { createdAt: dateFilter(range) } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
    });
    return rows.map((row): Row => ({
      at: row.createdAt,
      kind: 'rating',
      source: 5,
      id: row.id,
      actor: { type: 'customer', id: scope.customer.id },
      threadId: row.threadId,
      text: row.comment ? `${row.value} · ${row.comment}` : row.value,
      details: { value: row.value, comment: row.comment, subject: row.subject },
    }));
  },
};

const SLA_SOURCE: Source = {
  rank: 6,
  kinds: ['sla_breach'],
  async read(tx, scope, range, take) {
    if (scope.threadIds.length === 0) return [];
    const rows = await tx.slaBreach.findMany({
      where: {
        licenseId: scope.licenseId,
        subjectType: 'thread',
        subjectId: { in: scope.threadIds },
        ...(dateFilter(range) ? { detectedAt: dateFilter(range) } : {}),
      },
      orderBy: [{ detectedAt: 'asc' }, { id: 'asc' }],
      take,
    });
    return rows.map((row): Row => ({
      at: row.detectedAt,
      kind: 'sla_breach',
      source: 6,
      id: row.id,
      actor: { type: 'system', id: null },
      threadId: row.subjectId,
      text: `${row.target} target missed: ${row.elapsedMinutes} of ${row.targetMinutes} min`,
      details: {
        target: row.target,
        target_minutes: row.targetMinutes,
        elapsed_minutes: row.elapsedMinutes,
        business_hours_only: row.businessHoursOnly,
      },
    }));
  },
};

const TICKET_SOURCE: Source = {
  rank: 7,
  kinds: ['ticket'],
  async read(tx, scope, range, take) {
    const rows = await tx.ticket.findMany({
      where: {
        sourceChatId: scope.chatId,
        ...(scope.threadId !== null ? { sourceThreadId: scope.threadId } : {}),
        ...(dateFilter(range) ? { createdAt: dateFilter(range) } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
        sourceThreadId: true,
        subject: true,
        status: true,
        priority: true,
        assigneeId: true,
        groupId: true,
        createdAt: true,
      },
    });
    return rows.map((row): Row => ({
      at: row.createdAt,
      kind: 'ticket',
      source: 7,
      id: row.id,
      actor: { type: 'system', id: null },
      threadId: row.sourceThreadId,
      text: row.subject,
      details: {
        ticket_id: row.id,
        status: row.status,
        priority: row.priority,
        assignee_id: row.assigneeId,
        group_id: row.groupId === null ? null : Number(row.groupId),
      },
    }));
  },
};

const AUDIT_SOURCE: Source = {
  rank: 8,
  kinds: ['audit'],
  async read(tx, scope, range, take) {
    const rows = await tx.auditLogEntry.findMany({
      where: {
        licenseId: scope.licenseId,
        target: `chat:${scope.chatId}`,
        ...(dateFilter(range) ? { createdAt: dateFilter(range) } : {}),
        ...(scope.threadId !== null
          ? { metadata: { path: ['thread_id'], equals: scope.threadId } }
          : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      select: {
        id: true,
        actorId: true,
        actorType: true,
        onBehalfOf: true,
        action: true,
        metadata: true,
        createdAt: true,
      },
    });
    return rows.map((row): Row => {
      const metadata = record(row.metadata);
      return {
        at: row.createdAt,
        kind: 'audit',
        source: 8,
        id: row.id,
        actor: {
          type: row.actorType === 'agent' ? 'agent' : row.actorType === 'bot' ? 'bot' : 'system',
          id: row.actorId,
        },
        threadId: typeof metadata.thread_id === 'string' ? metadata.thread_id : null,
        text: row.action,
        details: {
          action: row.action,
          actor_type: row.actorType,
          ...(row.onBehalfOf !== null ? { on_behalf_of: row.onBehalfOf } : {}),
          metadata,
        },
      };
    });
  },
};

const SOURCES: readonly Source[] = [
  EVENT_SOURCE,
  AI_DECISION_SOURCE,
  SKILL_RUN_SOURCE,
  ROUTING_SOURCE,
  TAG_SOURCE,
  RATING_SOURCE,
  SLA_SOURCE,
  TICKET_SOURCE,
  AUDIT_SOURCE,
];

async function procedureNames(
  tx: TenantClient,
  ids: ReadonlyArray<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  const rows = await tx.skill.findMany({
    where: { id: { in: unique } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

// --- order and cursor ---------------------------------------------------------

function compareRows(a: Row, b: Row): number {
  return (
    a.at.getTime() - b.at.getTime() ||
    KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
    a.source - b.source ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

function compareToCursor(row: Row, cursor: Cursor): number {
  return (
    row.at.getTime() - cursor.at ||
    KIND_RANK[row.kind] - cursor.kind ||
    row.source - cursor.source ||
    (row.id < cursor.id ? -1 : row.id > cursor.id ? 1 : 0)
  );
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.at, cursor.kind, cursor.source, cursor.id])).toString(
    'base64url',
  );
}

function decodeCursor(pageId: string): Cursor | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8'));
    if (!Array.isArray(value) || value.length !== 4) return null;
    const [at, kind, source, id] = value as unknown[];
    if (
      typeof at !== 'number' ||
      !Number.isSafeInteger(at) ||
      typeof kind !== 'number' ||
      typeof source !== 'number' ||
      typeof id !== 'string' ||
      id.length > 128
    ) {
      return null;
    }
    return { at, kind, source, id };
  } catch {
    return null;
  }
}

// --- serialising ----------------------------------------------------------------

/** Every string inside `value` passed through `fn`, the shape kept. */
function mapStrings(value: unknown, fn: (text: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        mapStrings(item, fn),
      ]),
    );
  }
  return value;
}

async function serialise(
  tx: TenantClient,
  scope: TimelineScope,
  rows: readonly Row[],
): Promise<TimelineItem[]> {
  const accountIds = [
    ...new Set(
      rows
        .filter((row) => row.actor.type === 'agent' && row.actor.id !== null)
        .map((row) => row.actor.id!),
    ),
  ];
  const names =
    accountIds.length === 0
      ? new Map<string, string>()
      : new Map(
          (
            await tx.account.findMany({
              where: { id: { in: accountIds.filter(isUuid) } },
              select: { id: true, name: true },
            })
          ).map((account) => [account.id, account.name]),
        );
  const contact = [scope.customer.email, scope.customer.username];
  const redact = (text: string) => redactPlayerContact(text, contact, scope.contactVisible);

  return rows.map((row) => {
    const actor: TimelineActor = {
      type: row.actor.type,
      id: row.actor.id,
      name:
        row.actor.type === 'customer'
          ? scope.customer.name
          : row.actor.type === 'agent' && row.actor.id !== null
            ? (names.get(row.actor.id) ?? null)
            : null,
    };
    return {
      id: row.id,
      at: row.at.toISOString(),
      kind: row.kind,
      actor,
      chat_id: scope.chatId,
      thread_id: row.threadId,
      ...(row.eventId !== undefined ? { event_id: row.eventId } : {}),
      ...(row.text !== undefined ? { text: redact(row.text) } : {}),
      details: mapStrings(row.details, redact) as Record<string, unknown>,
    };
  });
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(id: string): boolean {
  return UUID_PATTERN.test(id);
}

// --- export ---------------------------------------------------------------------

/**
 * `item` as an export writes it when masked (ID-09 §5): the player's email,
 * username and name blanked wherever they appear, every PII pattern in the
 * text blanked (`maskPii`), and the player's name as actor withheld.
 */
export function maskTimelineItem(item: TimelineItem, scope: TimelineScope): TimelineItem {
  const values = [scope.customer.email, scope.customer.username, scope.customer.name];
  const mask = (text: string) => maskPii(redactPlayerContact(text, values, false));
  return {
    ...item,
    actor: item.actor.type === 'customer' ? { ...item.actor, name: REDACTED } : item.actor,
    ...(item.text !== undefined ? { text: mask(item.text) } : {}),
    details: mapStrings(item.details, mask) as Record<string, unknown>,
  };
}

/** The file's opening, before any row. */
export function timelineExportHead(format: TimelineExportFormat, scope: TimelineScope): string {
  if (format === 'csv') return csvRows([TIMELINE_EXPORT_COLUMNS]);
  if (format === 'txt') {
    return `Thread ID (chat_id): ${scope.chatId}${
      scope.threadId !== null ? ` · Chat ID (thread_id): ${scope.threadId}` : ''
    }\n`;
  }
  return '';
}

/**
 * Rows in the export's format. `previousThread` is the connection of the row
 * written before this chunk: the text file draws a separator where the
 * connection changes (ID-09 §6), and the caller carries it across chunks.
 */
export function timelineExportChunk(
  format: TimelineExportFormat,
  items: readonly TimelineItem[],
  previousThread: { value: string | null | undefined },
): string {
  if (format === 'ndjson') return items.map((item) => `${JSON.stringify(item)}\n`).join('');
  if (format === 'csv') {
    return csvRows(
      items.map((item) => [
        item.at,
        item.kind,
        item.actor.type,
        item.actor.name ?? item.actor.id ?? '',
        item.chat_id,
        item.thread_id ?? '',
        item.event_id ?? '',
        item.text ?? '',
        JSON.stringify(item.details),
      ]),
    );
  }
  let out = '';
  for (const item of items) {
    if (item.thread_id !== null && item.thread_id !== previousThread.value) {
      out += `---- Chat ID (thread_id): ${item.thread_id} ----\n`;
      previousThread.value = item.thread_id;
    }
    const who = item.actor.name ?? item.actor.id ?? item.actor.type;
    const text = (item.text ?? '').replace(/\r?\n/g, ' ');
    out += `[${item.at}] ${item.kind} · ${who}: ${text}\n`;
  }
  return out;
}

export const TIMELINE_EXPORT_CONTENT_TYPES: Readonly<Record<TimelineExportFormat, string>> = {
  csv: 'text/csv; charset=utf-8',
  ndjson: 'application/x-ndjson; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
};

/** Parse `kinds=` — comma-separated, each one of `TIMELINE_KINDS`; a 400 otherwise. */
export function parseTimelineKinds(value: string | undefined): TimelineKind[] | undefined {
  if (value === undefined || value.trim() === '') return undefined;
  const kinds = value.split(',').map((kind) => kind.trim());
  const unknown = kinds.filter((kind) => !(TIMELINE_KINDS as readonly string[]).includes(kind));
  if (unknown.length > 0) {
    throw ApiError.validation(`kinds: unknown kind ${unknown.join(', ')}.`);
  }
  return kinds as TimelineKind[];
}
