/**
 * Direct lookup by number, e-mail or username — `GET /search` (ID-06 · tm 332).
 *
 * An agent told "look at this number" pastes it into ⌘K and expects the
 * conversation, whenever it happened. The server looks the value up rather than
 * the browser matching it against the page it holds, so what decides the answer
 * is the value's *shape*: `classifyIdentifier` (the ID-01 glossary) says which
 * kinds of record it could name, and `searchShape` turns that into the one plan
 * the lookup follows.
 *
 * Names follow the glossary (K1 = A): `chat` is the member's day (panel
 * "Thread ID", `chat_id`), `connection` one connection inside it (panel
 * "Chat ID", `thread_id`), `event` one message.
 *
 * `message` is the text search (ID-07 · tm 333.3): conversations whose messages
 * contain every word of the query, one result per conversation (its newest
 * matching message). It has its own rules — at least three letters or digits
 * in a row, at most eight words, a cap on how many messages it may match — and
 * answers a query that breaks one with a 400, so it runs only when `types`
 * names it: `SEARCH_DEFAULT_KINDS` leaves it out.
 */
import { classifyIdentifier } from './id-glossary.js';

export const SEARCH_KINDS = [
  'chat',
  'connection',
  'event',
  'customer',
  'ticket',
  'message',
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** The kinds looked for when `types` is absent — every one but the text search. */
export const SEARCH_DEFAULT_KINDS: readonly SearchKind[] = [
  'chat',
  'connection',
  'event',
  'customer',
  'ticket',
];

export const SEARCH_MATCHED_ON = [
  'chat_id',
  'thread_id',
  'event_id',
  'customer_id',
  'ticket_id',
  'email',
  'username',
  'name',
  'phone',
  'subject',
  'text',
] as const;
export type SearchMatchedOn = (typeof SEARCH_MATCHED_ON)[number];

/** Longest value the endpoint accepts — an e-mail address fits with room to spare. */
export const SEARCH_QUERY_MAX_LENGTH = 200;
export const SEARCH_DEFAULT_LIMIT = 10;
export const SEARCH_MAX_LIMIT = 20;

/** One match. Which ids are present depends on `kind` (see the contract). */
export interface SearchResult {
  kind: SearchKind;
  chat_id?: string;
  thread_id?: string;
  event_id?: string;
  customer_id?: string;
  ticket_id?: string;
  /** The member's name or the ticket's subject; null when the member left no name. */
  title: string | null;
  /**
   * A member's e-mail (else phone), a ticket's member name, a message's
   * snippet; null when hidden or absent.
   */
  subtitle: string | null;
  /** `message` only: where the query's words sit in `subtitle` (`[start, end)`). */
  highlights?: Array<{ start: number; end: number }>;
  /** When the day, connection or message started, or the member was last active. */
  at: string | null;
  matched_on: SearchMatchedOn;
}

/**
 * What a query is, for the lookup:
 *
 *   event    — a message number, `TJ1H8CFKRV_7`
 *   short_id — a ten-character number: a day, a connection or a ticket
 *   uuid     — a member (a request or AI decision id names nothing searchable)
 *   email    — an address, matched whole
 *   text     — anything else: a name, a username, part of an address
 *
 * A `short_id` is also searched as text: "MEHMET1985" is a valid number and a
 * plausible username, and the shape alone cannot tell which was meant.
 */
export type SearchShape = 'event' | 'short_id' | 'uuid' | 'email' | 'text';

/** One `@`, something either side, no whitespace — the address is then matched exactly. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+$/;

export function searchShape(query: string): SearchShape {
  const trimmed = query.trim();
  const kinds = classifyIdentifier(trimmed);
  if (kinds.includes('event')) return 'event';
  if (kinds.includes('day_thread')) return 'short_id';
  if (kinds.includes('customer')) return 'uuid';
  if (EMAIL_SHAPE.test(trimmed)) return 'email';
  return 'text';
}
