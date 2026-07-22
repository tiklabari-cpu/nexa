/**
 * Missed-event recovery (NFR-R2).
 *
 * This is the reason the RTM slice is hard. A WebSocket that drops for four
 * seconds during a handover must not cost the agent a customer's message, and
 * the client cannot detect the gap on its own: from its side, "no messages
 * arrived" and "the connection was dead" look identical.
 *
 * The protocol is deliberately cursor-based rather than time-based:
 *
 *   client → { cursors: { chatId: lastSeenEventId } }
 *   server → every event after that id, per chat
 *
 * Timestamps cannot be used for this. Several events can share a millisecond,
 * clocks differ between processes, and a client that reconnects mid-second
 * would either miss an event or receive one twice. The sequence embedded in the
 * event id is authoritative and monotonic within a thread, so "everything after
 * TJ1H8CFKRV_7" has exactly one answer.
 *
 * Chats the client does not name are reported as needing a full refetch rather
 * than silently skipped: a client that was offline long enough to be given a
 * new conversation must be told about it.
 */
import type { PrismaClient } from '@prisma/client';
import type { SocketPrincipal } from './auth.js';

/**
 * Cap on events replayed per chat in one sync.
 *
 * A client that was away for an hour should refetch the transcript rather than
 * receive ten thousand frames — and an unbounded replay is a trivial way to
 * make the gateway allocate without limit.
 */
export const MAX_REPLAY_PER_CHAT = 200;

/** Refuse absurd cursor maps outright rather than doing the work first. */
export const MAX_SYNC_CHATS = 200;

export interface SyncCursor {
  chatId: string;
  lastEventId: string | null;
}

export interface SyncedChat {
  chat_id: string;
  thread_id: string | null;
  events: unknown[];
  /** True when the gap exceeded the replay cap; the client must refetch. */
  truncated: boolean;
}

export interface SyncResult {
  chats: SyncedChat[];
  /** Chats the client still lists but can no longer see. */
  removed_chat_ids: string[];
  /** Chats it gained while disconnected — it has no cursor for these. */
  new_chat_ids: string[];
}

interface EventRow {
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

export class SyncService {
  constructor(private readonly db: PrismaClient) {}

  async sync(principal: SocketPrincipal, cursors: SyncCursor[]): Promise<SyncResult> {
    const requested = cursors.slice(0, MAX_SYNC_CHATS);

    return this.#scoped(principal, async (tx) => {
      const visible = await this.#visibleChats(tx, principal);
      const visibleIds = new Set(visible.map((c) => c.chat_id));

      const removed = requested
        .filter((cursor) => !visibleIds.has(cursor.chatId))
        .map((cursor) => cursor.chatId);

      const requestedIds = new Set(requested.map((c) => c.chatId));
      const gained = visible.filter((c) => !requestedIds.has(c.chat_id)).map((c) => c.chat_id);

      const chats: SyncedChat[] = [];
      for (const chat of visible) {
        const cursor = requested.find((c) => c.chatId === chat.chat_id);
        // A chat the client never knew about is announced through
        // `new_chat_ids`; replaying its whole history here could be enormous.
        if (!cursor) continue;

        const after = cursor.lastEventId ? sequenceOf(cursor.lastEventId, chat.thread_id) : 0;
        if (after === null) {
          // The cursor names a different thread — the conversation moved on
          // while the client was away, so its position is meaningless.
          chats.push({
            chat_id: chat.chat_id,
            thread_id: chat.thread_id,
            events: [],
            truncated: true,
          });
          continue;
        }

        const rows = await tx.$queryRaw<EventRow[]>`
          SELECT id, chat_id, thread_id, type, text, author_id, author_type,
                 recipients, attachment_url, properties, created_at
          FROM events
          WHERE thread_id = ${chat.thread_id}
            AND (split_part(id, '_', 2))::bigint > ${after}
          ORDER BY (split_part(id, '_', 2))::bigint ASC
          LIMIT ${MAX_REPLAY_PER_CHAT + 1}
        `;

        const truncated = rows.length > MAX_REPLAY_PER_CHAT;
        const page = truncated ? rows.slice(0, MAX_REPLAY_PER_CHAT) : rows;

        chats.push({
          chat_id: chat.chat_id,
          thread_id: chat.thread_id,
          // Internal notes are filtered for customers here too — a reconnect
          // must not become the one path that leaks them.
          events: page
            .filter((row) => principal.kind !== 'customer' || row.recipients === 'all')
            .map(serialiseEvent),
          truncated,
        });
      }

      return { chats, removed_chat_ids: removed, new_chat_ids: gained };
    });
  }

  /** Chats the principal may currently see, with their newest thread. */
  async #visibleChats(
    tx: PrismaClient,
    principal: SocketPrincipal,
  ): Promise<Array<{ chat_id: string; thread_id: string }>> {
    if (principal.kind === 'customer') {
      return tx.$queryRaw`
        SELECT DISTINCT ON (c.id) c.id AS chat_id, t.id AS thread_id
        FROM chats c JOIN threads t ON t.chat_id = c.id
        WHERE c.customer_id = ${principal.actorId}::uuid AND c.active
        ORDER BY c.id, t.created_at DESC
      `;
    }

    if (principal.unrestricted) {
      return tx.$queryRaw`
        SELECT DISTINCT ON (c.id) c.id AS chat_id, t.id AS thread_id
        FROM chats c JOIN threads t ON t.chat_id = c.id
        WHERE c.active
        ORDER BY c.id, t.created_at DESC
      `;
    }

    const groupIds = principal.groupIds.map((g) => BigInt(g));
    return tx.$queryRaw`
      SELECT DISTINCT ON (c.id) c.id AS chat_id, t.id AS thread_id
      FROM chats c
      JOIN threads t ON t.chat_id = c.id
      WHERE c.active
        AND (
          EXISTS (SELECT 1 FROM chat_access a
                  WHERE a.chat_id = c.id AND a.group_id = ANY(${groupIds}::bigint[]))
          OR EXISTS (SELECT 1 FROM chat_users u
                     WHERE u.chat_id = c.id AND u.user_id = ${principal.actorId}
                       AND u.user_type = 'agent')
        )
      ORDER BY c.id, t.created_at DESC
    `;
  }

  async #scoped<T>(principal: SocketPrincipal, fn: (tx: PrismaClient) => Promise<T>): Promise<T> {
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_license', ${principal.licenseId}, true)`;
      await tx.$executeRaw`SELECT set_config('app.current_organization', ${principal.organizationId}, true)`;
      return fn(tx as unknown as PrismaClient);
    });
  }
}

/**
 * Sequence number from an event id, or null when the id belongs to a different
 * thread. Returning null rather than 0 matters: 0 would silently replay the
 * entire thread, which for a long conversation floods the client.
 */
function sequenceOf(eventId: string, expectedThreadId: string): number | null {
  const separator = eventId.lastIndexOf('_');
  if (separator < 1) return null;
  if (eventId.slice(0, separator) !== expectedThreadId) return null;

  const sequence = Number(eventId.slice(separator + 1));
  return Number.isInteger(sequence) && sequence >= 0 ? sequence : null;
}

function serialiseEvent(row: EventRow): Record<string, unknown> {
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
