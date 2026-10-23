/**
 * The player card beside a chat (IN-02 · tm 331.1): who the player is, what
 * they answered before the chat started, the day's other connections and the
 * days before it — `GET /chats/{chatId}/customer-context`, one call.
 *
 * The customer detail read (`CustomerService.get`) lists a player's chats with
 * no regard to who is asking; this one must not carry that into the inbox. So
 * every conversation it names is judged by the caller's visibility — the same
 * rule as the transcript (`resolveVisibility` + `canSeeChat`):
 *
 *   - the chat itself must be visible, or the read is a 404 like every chat
 *     read (NFR-S5). Its other connections are then visible too — visibility
 *     is the chat's, and the transcript serves them all;
 *   - each earlier day is visible or not on its own. One the caller may not
 *     open is a restricted row (IN-02-S2): when it started and the queue
 *     topics of the teams it went to, nothing else. No id either — an id the caller
 *     cannot open is one a 404 would have kept from them (NFR-S5), which is
 *     also why the history cursor holds no id.
 *
 * The player's email and username follow the permission matrix
 * (`customers.contact.view`, RL-02-S2): masked to null here, on the server,
 * and blanked out of the prose around them — a summary, a hand-over card, a
 * pre-chat answer can quote either.
 *
 * Read-only, on the caller's tenant transaction: row level security decides
 * the workspace, and another workspace's chat id reads as absent.
 */
import type { AiHandoff, Prisma } from '@prisma/client';
import {
  AI_CONVERSATION_OUTCOMES,
  CUSTOMER_CONTEXT_HISTORY_DAYS,
  CUSTOMER_CONTEXT_PAGE_SIZE,
  RATING_VALUES,
  isQueueTopicRole,
  type AiConversationOutcome,
  type AiHandoffCardView,
  type ConversationRef,
  type CustomerContext,
  type PreChatAnswer,
  type QueueTopicRole,
  type RatingValue,
} from '@siyahtus/types';
import { ApiError } from '../../lib/api-error.js';
import type { TenantClient, TenantContext } from '../../lib/tenant.js';
import type { Principal } from '../auth/principal.js';
import { canSeeChat, chatVisibilityFilter, resolveVisibility } from '../chat/access.js';
import { serialiseAiHandoff } from '../chat/ai-handoff-view.js';
import { listDayConnections } from '../chat/conversation-day.js';
import { readCustomFieldValues } from '../custom-fields/custom-field-service.js';
import { maskPlayerContact, redactPlayerContact, seesPlayerContact } from './player-contact.js';

const DAY_MS = 86_400_000;

/**
 * Connections read per earlier day (`connections_count` stays exact), and the
 * most "today" lists — a visitor reconnecting all day must not grow the read.
 */
const MAX_DAY_CONNECTIONS = 20;

/** The latest moment a `Date` holds (ECMAScript's ±8.64e15 ms). */
const MAX_DATE_MS = 8_640_000_000_000_000;

/** Answers read off one `filled_form` event, at most. */
const MAX_FORM_ANSWERS = 50;

export interface CustomerContextOptions {
  /** The history cursor a previous page returned. */
  pageId?: string;
  /** The clock the 90-day window is counted from. */
  now?: Date;
}

/** What a row is built from before it is judged and named. */
interface RowSource {
  chatId: string;
  /** The connections it stands for, newest first. */
  connections: ConnectionSource[];
  connectionsCount: number;
  startedAt: Date;
  endedAt: Date | null;
  /** The chat's own team list — where its connections recorded none. */
  accessGroupIds: bigint[];
}

interface ConnectionSource {
  id: string;
  closedAt: Date | null;
  assigneeId: string | null;
  groupId: bigint | null;
  summary: string | null;
  tags: string[];
}

/**
 * The player card for `chatId`, as `principal` may see it. Throws a 404 when
 * the chat is not theirs to see, and a 400 for a cursor this read did not write.
 */
export async function readCustomerContext(
  tx: TenantClient,
  tenant: TenantContext,
  principal: Principal,
  chatId: string,
  options: CustomerContextOptions = {},
): Promise<CustomerContext> {
  const cursor = options.pageId === undefined ? null : decodeHistoryCursor(options.pageId);
  const now = options.now ?? new Date();

  const visibility = await resolveVisibility(tx, principal, 'read');
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    select: {
      id: true,
      customerId: true,
      access: { select: { groupId: true } },
      users: { select: { userId: true, userType: true } },
      threads: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: { id: true },
      },
    },
  });
  // RLS already hides another workspace's chat; this is the in-workspace case
  // where none of the caller's teams reaches it. Both read as absent.
  if (!chat || !canSeeChat(visibility, chat)) throw ApiError.notFound('Chat not found.');

  const customer = await tx.customer.findUnique({
    where: { id: chat.customerId },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      countryCode: true,
      country: true,
      bannedAt: true,
    },
  });
  if (!customer) throw ApiError.notFound('Chat not found.');

  const contactVisible = seesPlayerContact(principal);
  const contact = [customer.email, customer.username];
  const redact = (text: string) => redactPlayerContact(text, contact, contactVisible);
  const card = (row: AiHandoff) => serialiseAiHandoff(row, contactVisible, contact);

  const visit = await tx.visit.findFirst({
    where: { customerId: customer.id, licenseId: tenant.licenseId },
    orderBy: { startedAt: 'desc' },
    select: { countryCode: true, city: true },
  });
  const countryCode = customer.countryCode ?? visit?.countryCode ?? null;

  // The open (or newest) connection is the chat itself — what the transcript
  // beside the card shows; "today" is the rest of its day, the newest 20.
  const current = chat.threads[0]?.id ?? null;
  const day = current ? await listDayConnections(tx, chat.id, { excludeThreadId: current }) : [];
  const today: RowSource[] = day
    .reverse()
    .slice(0, MAX_DAY_CONNECTIONS)
    .map((connection) => ({
      chatId: chat.id,
      connections: [connection],
      connectionsCount: 1,
      startedAt: connection.createdAt,
      endedAt: connection.closedAt,
      accessGroupIds: chat.access.map((a) => a.groupId),
    }));

  const window: Prisma.ChatWhereInput = {
    customerId: customer.id,
    licenseId: tenant.licenseId,
    id: { not: chat.id },
    createdAt: { gte: new Date(now.getTime() - CUSTOMER_CONTEXT_HISTORY_DAYS * DAY_MS) },
  };
  const page = await tx.chat.findMany({
    where: cursor ? { AND: [window, { createdAt: { lt: new Date(cursor.at + 1) } }] } : window,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: cursor?.seen ?? 0,
    take: CUSTOMER_CONTEXT_PAGE_SIZE + 1,
    select: {
      id: true,
      customerId: true,
      active: true,
      createdAt: true,
      access: { select: { groupId: true } },
      users: { select: { userId: true, userType: true } },
      threads: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_DAY_CONNECTIONS,
        select: {
          id: true,
          closedAt: true,
          assigneeId: true,
          groupId: true,
          summary: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
      },
      _count: { select: { threads: true } },
    },
  });
  const hasMore = page.length > CUSTOMER_CONTEXT_PAGE_SIZE;
  const days = hasMore ? page.slice(0, CUSTOMER_CONTEXT_PAGE_SIZE) : page;
  const history = days.map((row) => ({
    accessible: canSeeChat(visibility, row),
    source: {
      chatId: row.id,
      connections: row.threads.map((thread) => ({
        id: thread.id,
        closedAt: thread.closedAt,
        assigneeId: thread.assigneeId,
        groupId: thread.groupId,
        summary: thread.summary,
        tags: thread.tags.map((t) => t.tag.name).sort(),
      })),
      connectionsCount: row._count.threads,
      startedAt: row.createdAt,
      endedAt: row.active ? null : (row.threads[0]?.closedAt ?? null),
      accessGroupIds: row.access.map((a) => a.groupId),
    } satisfies RowSource,
  }));

  // Two counts, not one: a chat written between them must not read as -1.
  const restrictedCount = visibility.unrestricted
    ? 0
    : Math.max(
        0,
        (await tx.chat.count({ where: window })) -
          (await tx.chat.count({ where: { AND: [window, chatVisibilityFilter(visibility)] } })),
      );

  const names = await loadNames(tx, tenant, [
    ...today,
    ...history.filter((row) => row.accessible).map((row) => row.source),
  ]);
  const groupsOf = await loadGroups(tx, tenant, [...today, ...history.map((row) => row.source)]);

  const last = days.at(-1);
  return {
    chat_id: chat.id,
    customer: maskPlayerContact(
      {
        id: customer.id,
        name: customer.name,
        username: customer.username,
        email: customer.email,
        country_code: countryCode,
        country: customer.country,
        // The newest visit's city, when it is in the country shown.
        city: visit && visit.countryCode === countryCode ? visit.city : null,
        banned: customer.bannedAt !== null,
      },
      contactVisible,
    ),
    contact_visible: contactVisible,
    pre_chat: (await preChatAnswers(tx, tenant, customer.id, current)).map((answer) => ({
      label: answer.label,
      value: redact(answer.value),
    })),
    today: today.map((source) => openRow(source, names, groupsOf, redact, card)),
    history: {
      items: history.map((row) =>
        row.accessible
          ? openRow(row.source, names, groupsOf, redact, card)
          : restrictedRow(row.source, groupsOf),
      ),
      ...(hasMore && last
        ? {
            next_page_id: encodeHistoryCursor(
              nextCursor(
                cursor,
                days.map((d) => d.createdAt),
              ),
            ),
          }
        : {}),
    },
    restricted_count: restrictedCount,
  };
}

// --- Rows -------------------------------------------------------------------

/** Everything a visible conversation's row says, read in a few batched queries. */
interface Names {
  accounts: Map<string, string>;
  ratings: Map<string, RatingValue>;
  outcomes: Map<string, AiConversationOutcome>;
  cards: Map<string, AiHandoff>;
}

/**
 * The names, ratings, outcomes and hand-over cards of the visible rows'
 * connections. Keyed by connection: a row reads its newest connection that has
 * one. Restricted rows are never asked about.
 */
async function loadNames(
  tx: TenantClient,
  tenant: TenantContext,
  rows: RowSource[],
): Promise<Names> {
  const threadIds = rows.flatMap((row) => row.connections.map((c) => c.id));
  const assigneeIds = [
    ...new Set(rows.flatMap((row) => row.connections.map((c) => c.assigneeId))),
  ].filter((id): id is string => id !== null);
  if (threadIds.length === 0) {
    return { accounts: new Map(), ratings: new Map(), outcomes: new Map(), cards: new Map() };
  }

  const accounts = assigneeIds.length
    ? await tx.account.findMany({
        where: { id: { in: assigneeIds } },
        select: { id: true, name: true },
      })
    : [];
  // Newest first, so the first one seen per connection is the one kept.
  const ratings = await tx.rating.findMany({
    where: { licenseId: tenant.licenseId, threadId: { in: threadIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { threadId: true, value: true },
  });
  const conversations = await tx.aiConversation.findMany({
    where: { licenseId: tenant.licenseId, threadId: { in: threadIds } },
    select: { threadId: true, outcome: true },
  });
  const cards = await tx.aiHandoff.findMany({
    where: { licenseId: tenant.licenseId, threadId: { in: threadIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  return {
    accounts: new Map(accounts.map((a) => [a.id, a.name])),
    ratings: firstBy(
      ratings.filter((r): r is { threadId: string; value: RatingValue } =>
        (RATING_VALUES as readonly string[]).includes(r.value),
      ),
      (r) => r.threadId,
      (r) => r.value,
    ),
    outcomes: firstBy(
      conversations.filter((c): c is { threadId: string; outcome: AiConversationOutcome } =>
        (AI_CONVERSATION_OUTCOMES as readonly (string | null)[]).includes(c.outcome),
      ),
      (c) => c.threadId,
      (c) => c.outcome,
    ),
    cards: firstBy(
      cards,
      (c) => c.threadId,
      (c) => c,
    ),
  };
}

/** `items` keyed by `key`, the first item per key kept. */
function firstBy<T, V>(
  items: readonly T[],
  key: (item: T) => string | null,
  value: (item: T) => V,
): Map<string, V> {
  const out = new Map<string, V>();
  for (const item of items) {
    const k = key(item);
    if (k !== null && !out.has(k)) out.set(k, value(item));
  }
  return out;
}

interface TeamRow {
  id: number;
  name: string;
  topic: QueueTopicRole | null;
}

/**
 * Each row's teams: the ones its connections went to (`threads.group_id`),
 * else — connections opened before that was recorded — the chat's team list.
 */
async function loadGroups(
  tx: TenantClient,
  tenant: TenantContext,
  rows: RowSource[],
): Promise<(row: RowSource) => TeamRow[]> {
  const idsOf = (row: RowSource): bigint[] => {
    const recorded = row.connections
      .map((c) => c.groupId)
      .filter((id): id is bigint => id !== null);
    return [...new Set(recorded.length > 0 ? recorded : row.accessGroupIds)];
  };
  const all = [...new Set(rows.flatMap(idsOf))];
  const groups = all.length
    ? await tx.group.findMany({
        where: { licenseId: tenant.licenseId, id: { in: all } },
        select: { id: true, name: true, topicRole: true },
      })
    : [];
  const byId = new Map(
    groups.map((g) => [
      g.id,
      { id: Number(g.id), name: g.name, topic: isQueueTopicRole(g.topicRole) ? g.topicRole : null },
    ]),
  );
  return (row) =>
    idsOf(row)
      .map((id) => byId.get(id))
      .filter((team): team is TeamRow => team !== undefined)
      .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
}

function topicsOf(teams: TeamRow[]): QueueTopicRole[] {
  return [...new Set(teams.map((t) => t.topic).filter((t): t is QueueTopicRole => t !== null))];
}

function openRow(
  source: RowSource,
  names: Names,
  groupsOf: (row: RowSource) => TeamRow[],
  redact: (text: string) => string,
  serialiseCard: (row: AiHandoff) => AiHandoffCardView,
): ConversationRef {
  const newest = source.connections[0];
  const teams = groupsOf(source);
  const newestWith = <V>(map: Map<string, V>): V | null => {
    for (const c of source.connections) {
      const value = map.get(c.id);
      if (value !== undefined) return value;
    }
    return null;
  };
  const summary = source.connections.find((c) => c.summary)?.summary ?? null;
  const newestCard = newestWith(names.cards);
  const assigneeId = newest?.assigneeId ?? null;
  const assigneeName = assigneeId ? names.accounts.get(assigneeId) : undefined;
  return {
    accessible: true,
    chat_id: source.chatId,
    thread_id: newest?.id ?? null,
    started_at: source.startedAt.toISOString(),
    ended_at: source.endedAt?.toISOString() ?? null,
    connections_count: source.connectionsCount,
    assignee:
      assigneeId && assigneeName !== undefined ? { id: assigneeId, name: assigneeName } : null,
    teams: teams.map(({ id, name }) => ({ id, name })),
    topics: topicsOf(teams),
    tags: [...new Set(source.connections.flatMap((c) => c.tags))].sort(),
    summary: summary === null ? null : redact(summary),
    outcome: newestWith(names.outcomes),
    rating: newestWith(names.ratings),
    ai_handoff: newestCard ? serialiseCard(newestCard) : null,
  };
}

/**
 * Another team's day (IN-02-S2): when it started, and the topic of the teams it
 * went to — not how long it lasted.
 */
function restrictedRow(
  source: RowSource,
  groupsOf: (row: RowSource) => TeamRow[],
): ConversationRef {
  return {
    accessible: false,
    chat_id: null,
    thread_id: null,
    started_at: source.startedAt.toISOString(),
    ended_at: null,
    connections_count: null,
    assignee: null,
    teams: [],
    topics: topicsOf(groupsOf(source)),
    tags: [],
    summary: null,
    outcome: null,
    rating: null,
    ai_handoff: null,
  };
}

// --- Pre-chat ---------------------------------------------------------------

/**
 * What the player answered before the chat started: the connection's own
 * `filled_form` event when it has one with answers, else the contact fields
 * of the pre-chat form that hold a value — the Traffic panel's rule
 * (`VisitorPanel`): a plain CRM field or an unanswered question is not an
 * answer.
 */
async function preChatAnswers(
  tx: TenantClient,
  tenant: TenantContext,
  customerId: string,
  threadId: string | null,
): Promise<PreChatAnswer[]> {
  if (threadId) {
    const form = await tx.event.findFirst({
      // The player's answers (or a bot's form on their behalf), shown to them —
      // not an agent's event of that type, nor an internal note.
      where: {
        threadId,
        type: 'filled_form',
        recipients: 'all',
        authorType: { in: ['customer', 'bot'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { properties: true },
    });
    const answers = formAnswers(form?.properties);
    if (answers.length > 0) return answers;
  }
  const fields = await readCustomFieldValues(tx, tenant.licenseId, 'contact', customerId);
  return fields
    .filter((field) => field.form_placement === 'pre_chat' && field.value !== null)
    .map((field) => ({ label: field.label, value: field.value! }));
}

/**
 * A `filled_form` event's answers: `properties.fields`, each `{ label, value }`
 * (or LiveChat's `answer`). Read defensively — the column is free-form JSON —
 * an entry that is not a labelled, non-blank string is left out.
 */
export function formAnswers(properties: unknown): PreChatAnswer[] {
  if (typeof properties !== 'object' || properties === null) return [];
  const fields = (properties as Record<string, unknown>)['fields'];
  if (!Array.isArray(fields)) return [];
  const answers: PreChatAnswer[] = [];
  for (const field of fields.slice(0, MAX_FORM_ANSWERS)) {
    if (typeof field !== 'object' || field === null) continue;
    const entry = field as Record<string, unknown>;
    const label = entry['label'];
    const value = typeof entry['value'] === 'string' ? entry['value'] : entry['answer'];
    if (typeof label !== 'string' || typeof value !== 'string') continue;
    if (!label.trim() || !value.trim()) continue;
    answers.push({ label: label.trim(), value: value.trim() });
  }
  return answers;
}

// --- History cursor ---------------------------------------------------------

/**
 * Where the next history page starts, without naming a chat: the last row's
 * `created_at` (ms) and how many rows already returned share that millisecond.
 * The next page asks for rows before the end of that millisecond, in the same
 * order, and skips those — a keyset on (`created_at`, `id`) whose tie-break is
 * a count rather than an id, because a restricted row's id must not ride out
 * in a cursor any more than in the row.
 */
export interface HistoryCursor {
  at: number;
  seen: number;
}

export function nextCursor(previous: HistoryCursor | null, createdAts: Date[]): HistoryCursor {
  const at = createdAts.at(-1)!.getTime();
  const onPage = createdAts.filter((date) => date.getTime() === at).length;
  return { at, seen: onPage + (previous?.at === at ? previous.seen : 0) };
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** A cursor this read did not write is a 400, not a fresh start. */
export function decodeHistoryCursor(pageId: string): HistoryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(pageId, 'base64url').toString('utf8')) as unknown;
    if (typeof parsed === 'object' && parsed !== null) {
      const { at, seen } = parsed as Record<string, unknown>;
      if (
        Number.isSafeInteger(at) &&
        (at as number) >= 0 &&
        // `at + 1` must still be a date, or the query fails as a 500.
        (at as number) < MAX_DATE_MS &&
        Number.isSafeInteger(seen) &&
        (seen as number) >= 1 &&
        (seen as number) <= 10_000
      ) {
        return { at: at as number, seen: seen as number };
      }
    }
  } catch {
    // fall through
  }
  throw ApiError.validation('page_id: not a cursor from a previous page.');
}
