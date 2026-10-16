/**
 * The queue record vocabulary (tm 291 · SiyahTuş analysis RP-04, owner
 * decision K21) — how one stay in the routing queue ended, shared by the
 * `queue_entries` CHECK constraint (`20261016180000_queue_entries`), the API's
 * writer (`services/routing/queue-entries.ts`) and the queue reports that will
 * read it (#371).
 *
 * `threads.queued_at` is cleared when a connection leaves the queue — the
 * position numbering depends on it — so a wait that has ended cannot be read
 * back from the thread. A `queue_entries` row keeps it: one row per stay, opened
 * where the connection enters the queue and closed, in the same transaction,
 * where it leaves.
 */

/**
 * How a stay in the queue ended.
 *
 *   - `assigned`        — an agent got the connection: the queue drained to
 *                         them, or a supervisor took it over.
 *   - `abandoned`       — the player left while waiting: they closed the chat
 *                         (`/customer/chat/close`), or it closed for inactivity
 *                         (RP-04-S1). Closing the widget window is not an event.
 *   - `closed_by_agent` — an agent (or a bot) archived it while it waited.
 *   - `transferred`     — it was handed to a named agent, or to another team
 *                         (a further stay opens under that team when it is
 *                         still waiting there).
 *   - `timeout`         — the system ended the wait with nobody choosing to:
 *                         the day rolled over under it, or the sweep's safety
 *                         net found the stay open on a closed connection.
 */
export const QUEUE_ENTRY_OUTCOMES = [
  'assigned',
  'abandoned',
  'closed_by_agent',
  'transferred',
  'timeout',
] as const;
export type QueueEntryOutcome = (typeof QUEUE_ENTRY_OUTCOMES)[number];
