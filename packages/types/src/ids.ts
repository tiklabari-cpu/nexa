/**
 * ID strategy — PRD §8.4.
 *
 *   chat / thread : short base32 token, varchar(12)   e.g. "TJ1H8CFKRV"
 *   event         : "<thread_id>_<seq>", varchar(40)  e.g. "TJ1H8CFKRV_7"
 *   account / org / customer / ai : UUID
 *   group         : integer (per-license)
 *   license       : bigint
 *
 * Crockford Base32 is used for the short tokens: it excludes I, L, O and U, so a
 * chat ID read aloud or pasted from a screenshot cannot be mistyped into a
 * different valid ID. 10 characters = 50 bits of entropy.
 *
 * Short IDs are NOT an access control mechanism (NFR-S5). Every lookup is
 * additionally scoped by license/organization, and misses return 404 rather than
 * 403 so IDs cannot be enumerated.
 */

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SHORT_ID_LENGTH = 10;

const SHORT_ID_RE = new RegExp(`^[${CROCKFORD_ALPHABET}]{${SHORT_ID_LENGTH}}$`);
const EVENT_ID_RE = new RegExp(`^[${CROCKFORD_ALPHABET}]{${SHORT_ID_LENGTH}}_\\d{1,12}$`);

/** Injectable so tests can supply deterministic bytes. */
export type RandomBytes = (size: number) => Uint8Array;

const defaultRandomBytes: RandomBytes = (size) => {
  const buf = new Uint8Array(size);
  globalThis.crypto.getRandomValues(buf);
  return buf;
};

/**
 * Generate a chat or thread ID.
 *
 * Rejection sampling keeps the distribution uniform: a plain `byte % 32` would
 * bias the first 8 symbols, halving effective entropy for those positions.
 */
export function generateShortId(randomBytes: RandomBytes = defaultRandomBytes): string {
  let out = '';
  while (out.length < SHORT_ID_LENGTH) {
    const chunk = randomBytes(SHORT_ID_LENGTH);
    for (const byte of chunk) {
      if (byte >= 0xf8) continue; // 248..255 would bias low symbols — discard
      out += CROCKFORD_ALPHABET[byte % 32];
      if (out.length === SHORT_ID_LENGTH) break;
    }
  }
  return out;
}

/**
 * Event IDs embed the thread and a per-thread sequence number, so ordering
 * within a thread is decidable from the ID alone. Missed-event sync (slice 5)
 * relies on this: "everything after TJ1H8CFKRV_7" needs no timestamp compare.
 */
export function buildEventId(threadId: string, sequence: number): string {
  if (!isShortId(threadId)) throw new TypeError(`invalid thread id: ${threadId}`);
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new TypeError(`event sequence must be a positive integer, got ${sequence}`);
  }
  return `${threadId}_${sequence}`;
}

export function parseEventId(eventId: string): { threadId: string; sequence: number } | null {
  if (!EVENT_ID_RE.test(eventId)) return null;
  const separator = eventId.indexOf('_');
  return {
    threadId: eventId.slice(0, separator),
    sequence: Number(eventId.slice(separator + 1)),
  };
}

export function isShortId(value: unknown): value is string {
  return typeof value === 'string' && SHORT_ID_RE.test(value);
}

export function isEventId(value: unknown): value is string {
  return typeof value === 'string' && EVENT_ID_RE.test(value);
}

/**
 * Compare two event IDs from the same thread. Returns <0, 0 or >0.
 * Throws when the IDs belong to different threads — comparing them would be
 * meaningless and silently returning 0 would corrupt sync cursors.
 */
export function compareEventIds(a: string, b: string): number {
  const pa = parseEventId(a);
  const pb = parseEventId(b);
  if (!pa || !pb) throw new TypeError(`not an event id: ${!pa ? a : b}`);
  if (pa.threadId !== pb.threadId) {
    throw new TypeError(`event ids belong to different threads: ${a} vs ${b}`);
  }
  return pa.sequence - pb.sequence;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
