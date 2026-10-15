/**
 * The member's conversation day (ID-02 · tm 286.2; owner decisions K1 = A, K2,
 * K3).
 *
 * K1 = A: a chat ("Thread ID" in the panel) is one member's conversation for one
 * day, and a thread ("Chat ID") is one connection inside it. This module holds
 * the three facts the visitor's write path decides with; the writes themselves
 * stay in `ChatService.openOrContinueConnection`, next to the invariants they
 * have to keep (one active chat per member, one active thread per chat, one
 * chat per member per day — all three partial unique indexes):
 *
 *   - **which day it is** (`resolveLocalDay`): `localDayKey` in the workspace's
 *     boundary (ID-04, tm 285) and nothing else — the key and the zone it was
 *     counted in are what `chats.local_day` / `chats.day_tz` carry;
 *   - **how long silence lasts before a connection is over**
 *     (`connectionIdleSeconds`): the workspace's own chat timeout, or K2's
 *     30 minutes when it never set one;
 *   - **whether a message continues the open connection or rolls it over**
 *     (`continuesConnection`): only a connection filed under an earlier day,
 *     and silent for longer than that window, is closed at the turn of the day
 *     (`day_rollover`). A live conversation that crosses midnight is never
 *     split — it stays under the day it started on (K3).
 *
 * The agent paths (tm 286.3) decide with the same facts: `POST /chats` opens a
 * connection in the member's day exactly as a visitor's message would, and
 * `reopensInPlace` says whether an agent's "Reopen" continues the chat itself
 * or — for a chat filed under an earlier day — today's (ID-02-S6). Which team a
 * connection went to is `connectionGroup`; `listDayConnections` is the read the
 * day's later readers (AI-02's "earlier today") are built on.
 *
 * The clock is the caller's (`ChatService`'s injectable `now`), so a test can
 * move the day without waiting for one.
 */
import { Prisma } from '@prisma/client';
import { isConnectionOpenedVia, localDayKey, type ConnectionOpenedVia } from '@siyahtus/types';
import type { TenantClient } from '../../lib/tenant.js';
import { readDayBoundary } from './day-boundary.js';

/**
 * K2: a conversation in a workspace that never set a chat timeout is over after
 * 30 minutes of silence. The sweep (`chat-timeout.ts`) closes widget
 * conversations on it, and the visitor's write path uses the same window as the
 * gap a connection from an earlier day must exceed before it is rolled over.
 */
export const DEFAULT_CONNECTION_IDLE_SECONDS = 30 * 60;

/** The day a connection opening now is filed under, in both shapes it is stored in. */
export interface ConversationDay {
  /** `YYYY-MM-DD` — `localDayKey`'s answer. */
  key: string;
  /** The IANA zone the key was counted in — `chats.day_tz`. */
  timezone: string;
  /** The key as the `DATE` column takes it (UTC midnight) — `chats.local_day`. */
  date: Date;
}

/** The workspace's conversation day at `now`. */
export async function resolveLocalDay(tx: TenantClient, now: Date): Promise<ConversationDay> {
  const { timezone, hour } = await readDayBoundary(tx);
  const key = localDayKey(now, timezone, hour);
  return { key, timezone, date: dayDate(key) };
}

/**
 * A day key as a `DATE` value. Prisma maps `@db.Date` to a `Date` at UTC
 * midnight both ways, so this and `dayKeyOf` are exact inverses.
 */
export function dayDate(key: string): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

/** `chats.local_day` back as its key. */
export function dayKeyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The window a workspace's conversations go quiet in: its configured chat
 * timeout, else K2's default. A stored non-positive value can only arrive by
 * bypassing the settings endpoint; it reads as unset, never as "no window".
 */
export function idleSecondsFrom(configured: number | null | undefined): number {
  return typeof configured === 'number' && configured > 0
    ? configured
    : DEFAULT_CONNECTION_IDLE_SECONDS;
}

/**
 * The chat timeout the current workspace saved, or null when it never set one.
 * Read the way the day boundary is (`readDayBoundary`) — most recently saved
 * settings row wins — so the visitor's write path and the idle sweep cannot
 * read the two settings on that row from two different brands' rows.
 */
export async function readChatTimeoutSeconds(tx: TenantClient): Promise<number | null> {
  const row = await tx.inboxSettings.findFirst({
    select: { chatTimeoutSeconds: true },
    orderBy: { updatedAt: 'desc' },
  });
  return row?.chatTimeoutSeconds ?? null;
}

/** The current workspace's idle window, K2's default when it set none. */
export async function connectionIdleSeconds(tx: TenantClient): Promise<number> {
  return idleSecondsFrom(await readChatTimeoutSeconds(tx));
}

/**
 * Whether a conversation arrived over a messaging channel (WhatsApp, Telegram,
 * …): it has an inbound `channel_messages` row — the fact the idle sweep, the
 * inbox's channel views and Reports' channel split all read.
 */
export async function arrivedOverChannel(tx: TenantClient, chatId: string): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ on_channel: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM channel_messages WHERE chat_id = ${chatId} AND direction = 'inbound'
    ) AS on_channel`;
  return rows[0]?.on_channel === true;
}

/**
 * How long an open connection filed under an earlier day may stay silent and
 * still take the next message (tm 286.3): exactly the window the idle sweep
 * would have closed it on (`chat-timeout.ts`) — the workspace's own timeout,
 * else K2's 30 minutes for a widget conversation — so "rolled over at the turn
 * of the day" and "closed by the sweep" can never disagree about whether a
 * connection is over. Null when nothing ends it by silence: a conversation that
 * arrived over a messaging channel, in a workspace that set no timeout, stays
 * open (K2 is a widget rule), and the turn of the day does not split it either.
 */
export async function rolloverIdleSeconds(
  tx: TenantClient,
  chatId: string,
): Promise<number | null> {
  const configured = await readChatTimeoutSeconds(tx);
  if (typeof configured === 'number' && configured > 0) return configured;
  return (await arrivedOverChannel(tx, chatId)) ? null : DEFAULT_CONNECTION_IDLE_SECONDS;
}

/**
 * Whether a visitor message arriving `now` continues the member's open
 * connection (05 ID-02, coding logic 2a).
 *
 *   - a chat filed under no day (opened before ID-02) or under today: yes —
 *     today's behaviour, the message is appended;
 *   - a chat filed under an earlier day, last active within the idle window:
 *     yes — a conversation that crosses midnight is not split (K3; scenario 5);
 *   - a chat filed under an earlier day and silent for longer: no — the
 *     connection is closed as a `day_rollover` and the message opens today's
 *     (scenario 6);
 *   - no window at all (`idleSeconds` null — `rolloverIdleSeconds`): yes,
 *     however long the silence.
 *
 * Keys compare as strings: `YYYY-MM-DD` sorts as dates do. A chat filed under a
 * *later* key than today's (the boundary moved east since it opened) counts as
 * today's — it is certainly not yesterday's.
 */
export function continuesConnection(input: {
  /** The open chat's `local_day` key, or null for a chat filed under no day. */
  chatDay: string | null;
  today: string;
  lastActivityAt: Date;
  now: Date;
  idleSeconds: number | null;
}): boolean {
  if (input.chatDay === null || input.chatDay >= input.today) return true;
  if (input.idleSeconds === null) return true;
  return input.now.getTime() - input.lastActivityAt.getTime() <= input.idleSeconds * 1000;
}

/**
 * Whether an agent's "Reopen" continues the conversation in the chat itself
 * (05 ID-02 coding logic 3; ID-02-S6 · tm 286.3). Yes for a chat filed under
 * today (or a later key — the boundary moved east), and for a chat filed under
 * no day: opened before the daily model, it keeps the model it was opened in,
 * the same rule its open half follows (`continuesConnection`). No for a chat
 * filed under an earlier day — a day that has ended gains no connection; the
 * conversation continues under the member's chat for today.
 */
export function reopensInPlace(input: { chatDay: string | null; today: string }): boolean {
  return input.chatDay === null || input.chatDay >= input.today;
}

/**
 * The team a connection went to (`threads.group_id`, tm 286.3): the one team
 * it was routed or opened to, or null when there was none — or several named
 * at once, where picking one would invent a fact the chat's `access` already
 * records as a set.
 */
export function connectionGroup(groupIds: readonly bigint[]): bigint | null {
  return groupIds.length === 1 ? groupIds[0]! : null;
}

/** One earlier connection of a member's day, as `listDayConnections` returns it. */
export interface DayConnection {
  /** The connection — "Chat ID" in the panel (`threads.id`). */
  id: string;
  createdAt: Date;
  closedAt: Date | null;
  openedVia: ConnectionOpenedVia | null;
  assigneeId: string | null;
  groupId: bigint | null;
  /** The connection's summary, when one was written (`threads.summary`). */
  summary: string | null;
  /** Tag names, sorted. */
  tags: string[];
}

/**
 * The member's other connections of the day (05 ID-02 api; the AI-02 hook —
 * "you wrote earlier today about …"): every connection of `chatId`'s day except
 * `excludeThreadId` (the one being answered), oldest first, with what an
 * assistant may recall about each — when it was, its summary, its tags — and
 * never its transcript (read that with `ChatService.listEvents` and the id).
 *
 * A chat filed under no day is not a day: its older threads are earlier visits
 * spread over its whole history, so — the rule `Chat.connections` follows — it
 * offers only its newest connection, and nothing once that one is excluded.
 * Runs on the caller's tenant transaction, so RLS decides what exists: another
 * workspace's chat id reads as an empty day, never as an error that confirms it.
 */
export async function listDayConnections(
  tx: TenantClient,
  chatId: string,
  options: { excludeThreadId?: string } = {},
): Promise<DayConnection[]> {
  const chat = await tx.chat.findUnique({
    where: { id: chatId },
    select: {
      localDay: true,
      threads: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          createdAt: true,
          closedAt: true,
          openedVia: true,
          assigneeId: true,
          groupId: true,
          summary: true,
          tags: { select: { tag: { select: { name: true } } } },
        },
      },
    },
  });
  if (!chat) return [];
  const threads = chat.localDay ? chat.threads : chat.threads.slice(-1);
  return threads
    .filter((thread) => thread.id !== options.excludeThreadId)
    .map((thread) => ({
      id: thread.id,
      createdAt: thread.createdAt,
      closedAt: thread.closedAt,
      openedVia: isConnectionOpenedVia(thread.openedVia) ? thread.openedVia : null,
      assigneeId: thread.assigneeId,
      groupId: thread.groupId,
      summary: thread.summary,
      tags: thread.tags.map((t) => t.tag.name).sort(),
    }));
}

/**
 * How the connection a visitor's message opens came to exist
 * (`threads.opened_via`). The rollover wins over the chat it lands in: what made
 * this connection open is that yesterday's was closed under the member, whether
 * today's chat already existed or not.
 */
export function visitorOpenedVia(input: {
  rolledOver: boolean;
  dayChatExists: boolean;
}): ConnectionOpenedVia {
  if (input.rolledOver) return 'day_rollover';
  return input.dayChatExists ? 'same_day_return' : 'first_of_day';
}

/**
 * Thrown inside the connection transaction when another request changed the
 * member's chat between this one's read and its write — the day's chat was
 * reopened, or the open chat closed, under it. The transaction rolls back and
 * the caller re-reads, exactly as for a unique violation.
 */
export class ConnectionRaceLost extends Error {
  constructor(what: string) {
    super(`Lost a connection race: ${what}`);
    this.name = 'ConnectionRaceLost';
  }
}

/**
 * SQLSTATEs a re-read resolves: a unique violation (23505), a deadlock the
 * database broke by aborting this transaction (40P01), a serialization failure
 * (40001). In every case the transaction has already been rolled back whole.
 */
const RACE_SQLSTATES = new Set(['23505', '40P01', '40001']);

/**
 * True when a failed attempt lost a race the next attempt can resolve by
 * reading again (05 ID-02, coding logic 2c): one of the three partial unique
 * indexes refused a second active chat / active thread / day chat (Prisma
 * `P2002` from a model call, `P2010` carrying 23505 from a raw one), the
 * database aborted the transaction as a deadlock or write conflict (`P2034`,
 * or a raw call's 40P01 / 40001) — a rollover locking yesterday's chat while an
 * agent archives it is one — or the attempt noticed the change itself
 * (`ConnectionRaceLost`). Anything else is a real failure and is not retried.
 */
export function isConnectionRace(error: unknown): boolean {
  if (error instanceof ConnectionRaceLost) return true;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2002' || error.code === 'P2034') return true;
  const sqlState = (error.meta as { code?: unknown } | undefined)?.code;
  return error.code === 'P2010' && typeof sqlState === 'string' && RACE_SQLSTATES.has(sqlState);
}
