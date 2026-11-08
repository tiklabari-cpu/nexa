/**
 * Size bounds on the collections a socket frame carries, checked before the
 * collection is walked (tm 419) — the RTM half of `apps/api/src/lib/input-bounds.ts`.
 *
 * The gateway does not parse frames with zod (`protocol.ts` decodes by hand),
 * so zod's GHSA-mrhx-c7xc-m3w5 — `.max()` checked only after every element is
 * parsed, one issue per bad element — does not reach it. What does is the same
 * shape of input: a frame is at most `maxPayload` (256 KiB, `server.ts`), and
 * 256 KiB of `[1,1,…]` is ~130k elements in one `login` or `sync`. The bound
 * goes first so that such a frame is one refusal, not a walk.
 *
 * The customer socket (`/v1/customer/rtm/ws`) is anyone's for a minted visitor
 * token, and its `login` arrives before even that is checked: its push list is
 * bounded here. `sync`'s chat count was already bounded (`MAX_SYNC_CHATS`) —
 * it is now counted without materialising the entries first, on every socket.
 *
 * And the length of each cursor (tm 428). A chat the caller names but cannot see
 * comes back in `removed_chat_ids`, so a cursor key was an echo: 200 keys of a
 * kilobyte each made every `sync` answer a quarter of a megabyte the caller
 * chose, ten times a second. A key is now at most a chat id long, a value at
 * most an event id long — the database's own column widths, so no key or value
 * refused here could have named a chat or an event.
 */

/**
 * The most push actions a customer socket's `login` may name. The catalogue
 * holds 41 (`RTM_PUSH_ACTIONS`) and the widget asks for 6; a longer list is not
 * a subscription.
 */
export const MAX_LOGIN_PUSHES = 64;

/** The most protocol versions a version-keyed push list (`{ "3.6": [...] }`) may name. */
export const MAX_PUSH_VERSIONS = 4;

/** `chats.id` is `varchar(12)` (PRD §8.4 · `ids.ts`): a longer cursor key names no chat. */
export const MAX_SYNC_CHAT_ID_LENGTH = 12;

/** `events.id` is `varchar(40)`: a longer cursor value names no event. */
export const MAX_SYNC_EVENT_ID_LENGTH = 40;

/** Whether `value` has more than `max` own enumerable keys — stops counting at `max + 1`. */
export function hasMoreKeysThan(value: object, max: number): boolean {
  let count = 0;
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key) && ++count > max) return true;
  }
  return false;
}

/**
 * Whether a `login`'s `pushes` is within {@link MAX_LOGIN_PUSHES}, in either
 * form the gateway reads (`extractPushes`): a list, or lists keyed by
 * protocol version — at most {@link MAX_PUSH_VERSIONS} of them, all lists
 * together within the same bound. Any other value names no push and is
 * within bounds.
 */
export function pushesWithinBounds(value: unknown): boolean {
  if (Array.isArray(value)) return value.length <= MAX_LOGIN_PUSHES;
  if (typeof value !== 'object' || value === null) return true;
  if (hasMoreKeysThan(value, MAX_PUSH_VERSIONS)) return false;
  let total = 0;
  for (const list of Object.values(value as Record<string, unknown>)) {
    if (Array.isArray(list)) total += list.length;
    if (total > MAX_LOGIN_PUSHES) return false;
  }
  return true;
}

/**
 * Whether every cursor of a `sync` is shaped like an id (tm 428): each key at
 * most {@link MAX_SYNC_CHAT_ID_LENGTH} characters, each string value at most
 * {@link MAX_SYNC_EVENT_ID_LENGTH}. A value that is not a string means "no
 * cursor" (`dispatcher.ts`) and is within bounds. Call after the count check
 * (`hasMoreKeysThan(cursors, MAX_SYNC_CHATS)`), which keeps this walk short.
 */
export function cursorsWithinBounds(cursors: object): boolean {
  for (const key in cursors) {
    if (!Object.prototype.hasOwnProperty.call(cursors, key)) continue;
    if (key.length > MAX_SYNC_CHAT_ID_LENGTH) return false;
    const value = (cursors as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > MAX_SYNC_EVENT_ID_LENGTH) return false;
  }
  return true;
}
