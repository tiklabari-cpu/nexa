/**
 * Editing a message after it was sent (PRD §5.2 "Güvenlik" · §10.2 · FR-MOD-02.3.7).
 *
 * The rules live here rather than in the API because three readers have to
 * agree on them: the console decides whether to offer the Edit control, the
 * widget and the console both decide whether to print the "edited" marker, and
 * the server decides whether to accept the write. A client that offers a button
 * the server will refuse is worse than no button at all.
 *
 * Two shapes were possible and the choice matters. A **correction event** — a
 * new event referring back to the original — keeps `events` textually immutable
 * and rides the existing missed-event replay for free, but it leaves the
 * original text in `events.text` forever, and every other reader of that column
 * (reports, CSV export, the transcript e-mail, the AI matcher, search) would go
 * on quoting the words the agent retracted. The requirement is filed under
 * *security*: the point is that the wrong sentence stops being readable. So the
 * text is corrected **in place**, and the append-only property this repo
 * actually depends on is untouched — no event is deleted, no id is reused, no
 * `event_sequence` moves, so "everything after event N" still has exactly one
 * answer (`apps/rtm/src/sync.ts`).
 *
 * What an edit costs is recorded where it cannot be scrubbed: `audit_log` gets
 * a `chat.message_edited` entry naming the actor, the chat and the event. Never
 * the old text — that table is append-only and outlives every retention window
 * that governs message content, so copying the retracted sentence into it would
 * defeat the erasure the edit just performed.
 */

/**
 * How long after sending a message may still be corrected.
 *
 * A product decision the PRD does not make, so it is made here and written
 * down. Fifteen minutes is long enough for "I pasted the wrong customer's
 * order number" and short enough that the reader has almost certainly not acted
 * on it yet.
 *
 * It also bounds the one gap this design has, and since tm 248 it *closes* it
 * rather than merely keeping it small. A client whose socket was down across
 * the edit reconnects with a cursor already past the edited event, and the
 * cursor is a sequence number the edit does not mint — so the replay is blind
 * to the change by construction. Calling that "small and rare" was an
 * assumption; measured, it left the visitor reading the sentence the agent had
 * retracted for **30.6 s**, until the widget's heartbeat poll refetched the
 * transcript. `apps/rtm/src/sync.ts` now answers a sync with the corrections
 * made inside this window as well as the events after the cursor, and this
 * constant is what bounds how far back it has to look.
 */
export const MESSAGE_EDIT_WINDOW_SECONDS = 15 * 60;

/** `properties` key holding when the text was last corrected, ISO-8601. */
export const EDITED_AT_PROPERTY = 'edited_at';
/** `properties` key holding the account id that corrected it. */
export const EDITED_BY_PROPERTY = 'edited_by';

/**
 * Only a plain message. A `system_message` is the product speaking, a `file`
 * event's meaning is its attachment, and a `filled_form` / `rich_message` is a
 * structured payload whose text is a rendering of it rather than the thing
 * itself — correcting any of those by rewriting `text` would leave the event
 * and its own contents disagreeing.
 */
export function isEditableEventType(type: string): boolean {
  return type === 'message';
}

/**
 * When a given event was last corrected, or null if it never was.
 *
 * Tolerant by design: `properties` is a free-form object that arrives from the
 * wire, so anything that is not a non-empty string reads as "not edited" rather
 * than throwing inside a transcript render.
 */
export function readEditedAt(properties: unknown): string | null {
  if (typeof properties !== 'object' || properties === null) return null;
  const value = (properties as Record<string, unknown>)[EDITED_AT_PROPERTY];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Whether `createdAt` is still inside the correction window at `now`. */
export function isWithinEditWindow(createdAt: string | Date, now: Date = new Date()): boolean {
  const sent = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const sentMs = sent.getTime();
  if (Number.isNaN(sentMs)) return false;
  // The question is only ever "was this sent more than fifteen minutes ago",
  // so there is no lower bound. `created_at` comes from the database's own
  // `now()` and this clock is the API process's, so an event that reads a few
  // milliseconds into the future is skew between two machines — refusing it
  // would seal a message that had just been sent, which is the one outcome
  // nobody could explain.
  return now.getTime() - sentMs <= MESSAGE_EDIT_WINDOW_SECONDS * 1000;
}

/**
 * Drop edit markers from caller-supplied `properties`.
 *
 * `POST /chats/{chatId}/events` accepts an arbitrary `properties` object, so
 * without this a client could stamp `edited_at` on a message it is sending for
 * the first time and have every transcript label it "edited". The marker is
 * only ever meaningful when the server wrote it, so the server is the only
 * writer: sends are stripped, and the edit path sets it itself.
 */
export function stripEditMarkers<T extends Record<string, unknown>>(
  properties: T,
): Record<string, unknown> {
  const { [EDITED_AT_PROPERTY]: _editedAt, [EDITED_BY_PROPERTY]: _editedBy, ...rest } = properties;
  return rest;
}
