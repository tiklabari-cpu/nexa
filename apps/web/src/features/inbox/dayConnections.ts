/**
 * The day's connections in one transcript (ID-02 · tm 286.4).
 *
 * A chat filed under a day (`Chat.local_day`) is the member's whole day: every
 * time they came back, the same chat gained a connection (`thread`), and
 * `Chat.connections` lists them oldest first. `GET /chats/{id}/events` reads
 * one connection at a time — the newest unless `thread_id` names another — so
 * the inbox reads the newest the way it always has (pushes land there) and
 * walks back through the earlier ones as the reader scrolls past its start.
 *
 * Kept free of React so the walk can be pinned without a renderer.
 */
import type { ChatConnection, ChatEvent } from './types.js';

/** What a transcript separator says about one connection: its number, 14:02, "Bonus". */
export interface ConnectionLabel {
  id: string;
  created_at: string;
  /** The team it went to, by name; null when it went to no single team. */
  team: string | null;
}

/** Where the walk through the earlier connections stands: one connection, one cursor. */
export interface ConnectionCursor {
  threadId: string;
  /** `before_event_id` inside that connection; undefined for its newest page. */
  before?: string;
}

/**
 * The connections that sit before what the live transcript already covers.
 *
 * `anchorThreadId` is the connection of the oldest event the live transcript
 * holds once it has reached that connection's start — usually the newest
 * connection, but a member who came back while the agent was reading puts the
 * new connection's messages *after* the old one in the same cache, and the old
 * one is then the anchor. A connection the list does not know (a chat without a
 * day, or a list fetched before the connection opened) anchors nothing.
 */
export function earlierConnections(
  connections: readonly ChatConnection[] | undefined,
  anchorThreadId: string | null,
): ChatConnection[] {
  if (!connections || anchorThreadId === null) return [];
  const at = connections.findIndex((connection) => connection.id === anchorThreadId);
  return at > 0 ? connections.slice(0, at) : [];
}

/**
 * What to read after a page of an earlier connection: the page above it in
 * the same connection while one exists, then the newest page of the
 * connection before it, then nothing.
 */
export function nextConnectionCursor(
  earlier: readonly ChatConnection[],
  current: ConnectionCursor,
  nextPageId: string | undefined,
): ConnectionCursor | undefined {
  if (nextPageId) return { threadId: current.threadId, before: nextPageId };
  const at = earlier.findIndex((connection) => connection.id === current.threadId);
  return at > 0 ? { threadId: earlier[at - 1]!.id } : undefined;
}

/** The newest earlier connection — where the walk starts. */
export function firstConnectionCursor(
  earlier: readonly ChatConnection[],
): ConnectionCursor | undefined {
  const last = earlier.at(-1);
  return last ? { threadId: last.id } : undefined;
}

/**
 * The earlier connections' events in front of the live ones, oldest first.
 *
 * An event both lists hold is the live one's: the cache the realtime layer
 * writes to is the fresher of the two (an edit lands there), and a connection
 * that was the newest when the transcript opened can be read by both once a
 * later one arrives.
 */
export function joinDayEvents(
  earlier: readonly ChatEvent[],
  live: readonly ChatEvent[],
): ChatEvent[] {
  if (earlier.length === 0) return live as ChatEvent[];
  const seen = new Set(live.map((event) => event.id));
  return [...earlier.filter((event) => !seen.has(event.id)), ...live];
}

/**
 * Which connection an event belongs to. An optimistic bubble has no
 * `thread_id` yet (`''`) and belongs to whatever came before it — the open
 * connection it is being sent into.
 */
export function connectionOf(event: ChatEvent, previous: string | null): string | null {
  return event.thread_id ? event.thread_id : previous;
}

/**
 * Where the transcript draws a connection separator: before the first event
 * of each connection after the first, and before the very first event too
 * when the day has more than one connection and the transcript has reached the
 * start of the day — so every connection on screen is introduced the same way.
 * Returns the connection id each separator introduces, keyed by event index.
 */
export function connectionBreaks(
  events: readonly ChatEvent[],
  options: { atStartOfDay: boolean; connectionCount: number },
): Map<number, string> {
  const breaks = new Map<number, string>();
  let previous: string | null = null;
  events.forEach((event, index) => {
    const current = connectionOf(event, previous);
    if (current !== null) {
      const opensDay = index === 0 && options.atStartOfDay && options.connectionCount > 1;
      if (opensDay || (previous !== null && current !== previous)) breaks.set(index, current);
    }
    previous = current;
  });
  return breaks;
}
