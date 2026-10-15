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
 * The clock is the caller's (`ChatService`'s injectable `now`), so a test can
 * move the day without waiting for one.
 */
import { Prisma } from '@prisma/client';
import { localDayKey, type ConnectionOpenedVia } from '@siyahtus/types';
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
 * Whether a visitor message arriving `now` continues the member's open
 * connection (05 ID-02, coding logic 2a).
 *
 *   - a chat filed under no day (opened before ID-02) or under today: yes —
 *     today's behaviour, the message is appended;
 *   - a chat filed under an earlier day, last active within the idle window:
 *     yes — a conversation that crosses midnight is not split (K3; scenario 5);
 *   - a chat filed under an earlier day and silent for longer: no — the
 *     connection is closed as a `day_rollover` and the message opens today's
 *     (scenario 6).
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
  idleSeconds: number;
}): boolean {
  if (input.chatDay === null || input.chatDay >= input.today) return true;
  return input.now.getTime() - input.lastActivityAt.getTime() <= input.idleSeconds * 1000;
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
