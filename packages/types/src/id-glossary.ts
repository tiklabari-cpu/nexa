/**
 * Identifier glossary — ID-01 (K1 = A), docs/adr/conversation-day-ids.md.
 *
 * The code and the owner's vocabulary use "chat" and "thread" for opposite
 * things. In the code a `Chat` is the long-lived container for one member's
 * day and a `Thread` is one uninterrupted connection inside it; the owner's
 * "Thread ID" is the day container and the owner's "Chat ID" is the connection.
 * Decision K1 = A keeps the code names and translates only what a person reads:
 *
 *   panel name              code field   table       example
 *   Thread ID (daily)       chat_id      chats.id    TJ1H8CFKRV
 *   Chat ID (connection)    thread_id    threads.id  K3M9Q2XW7B
 *
 * Nothing here renames a column, an API field, a webhook payload key or a log
 * key — those stay `chat_id` / `thread_id`. This catalogue is the one place a
 * presentation layer (panel, exports, the log viewer, the AI) asks "what do I
 * call this number, and what does it look like?", so every surface answers the
 * same way. The label and hint *text* lives in the web catalogue under `ids.*`
 * (`labelKey` / `shortDescriptionKey` name those keys); `screenName` is the
 * English term itself, which stays English in every locale (ID-01-S1) and is
 * what an export header is built from.
 *
 * The number format is never changed — no prefix, no dash, no lower case
 * (ID-01-S2) — so Ctrl+F finds the same string on a screen, in a log and in an
 * export; the label says which number it is, the number does not.
 */

import { EVENT_ID_RE, SHORT_ID_RE, UUID_RE } from './ids.js';

export const ID_KINDS = [
  'day_thread',
  'connection',
  'event',
  'customer',
  'request',
  'ticket',
  'ai_decision',
] as const;

export type IdKind = (typeof ID_KINDS)[number];

export interface IdKindInfo {
  readonly kind: IdKind;
  /** What the panel, exports and docs call it. English in every locale. */
  readonly screenName: string;
  /** Web catalogue key of the label — same text as `screenName` in `en`. */
  readonly labelKey: string;
  /** Web catalogue key of the one-line "what is this number" hint. */
  readonly shortDescriptionKey: string;
  /** The field the code, the API, webhooks and logs use. Never translated. */
  readonly codeField: string;
  /** Every well-formed value of this kind matches; see `classifyIdentifier`. */
  readonly pattern: RegExp;
}

export const ID_GLOSSARY: Readonly<Record<IdKind, IdKindInfo>> = {
  day_thread: {
    kind: 'day_thread',
    screenName: 'Thread ID',
    labelKey: 'ids.thread.label',
    shortDescriptionKey: 'ids.thread.hint',
    codeField: 'chat_id',
    pattern: SHORT_ID_RE,
  },
  connection: {
    kind: 'connection',
    screenName: 'Chat ID',
    labelKey: 'ids.chat.label',
    shortDescriptionKey: 'ids.chat.hint',
    codeField: 'thread_id',
    pattern: SHORT_ID_RE,
  },
  event: {
    kind: 'event',
    screenName: 'Message ID',
    labelKey: 'ids.event.label',
    shortDescriptionKey: 'ids.event.hint',
    codeField: 'event_id',
    pattern: EVENT_ID_RE,
  },
  customer: {
    kind: 'customer',
    screenName: 'Member ID',
    labelKey: 'ids.customer.label',
    shortDescriptionKey: 'ids.customer.hint',
    codeField: 'customer_id',
    pattern: UUID_RE,
  },
  request: {
    kind: 'request',
    screenName: 'Request ID',
    labelKey: 'ids.request.label',
    shortDescriptionKey: 'ids.request.hint',
    codeField: 'request_id',
    pattern: UUID_RE,
  },
  ticket: {
    kind: 'ticket',
    screenName: 'Ticket ID',
    labelKey: 'ids.ticket.label',
    shortDescriptionKey: 'ids.ticket.hint',
    codeField: 'ticket_id',
    pattern: SHORT_ID_RE,
  },
  ai_decision: {
    kind: 'ai_decision',
    screenName: 'AI decision ID',
    labelKey: 'ids.aiDecision.label',
    shortDescriptionKey: 'ids.aiDecision.hint',
    codeField: 'decision_id',
    pattern: UUID_RE,
  },
};

export function idKindInfo(kind: IdKind): IdKindInfo {
  return ID_GLOSSARY[kind];
}

/**
 * The header an export column carries: both names, so the owner and a
 * developer can read the same file — `Thread ID (chat_id)`.
 */
export function idExportHeader(kind: IdKind): string {
  const info = ID_GLOSSARY[kind];
  return `${info.screenName} (${info.codeField})`;
}

/**
 * What a pasted value could be (ID-06).
 *
 * A *shape* cannot always decide: a day thread, a connection and a ticket are
 * the same ten-character token, and a member, a request and an AI decision are
 * all UUIDs. So this returns every kind the value fits, most useful first, and
 * lets the search resolve the tie with a scoped lookup. An empty list means the
 * value is none of them — the caller falls through to a name or e-mail search.
 *
 * Surrounding whitespace is ignored (a pasted ID often drags a newline along);
 * case is not folded for the short tokens — they are upper-case base32, and folding
 * would make a mistyped value look valid.
 */
export function classifyIdentifier(value: string): IdKind[] {
  const trimmed = value.trim();
  if (trimmed === '') return [];
  return ID_KINDS.filter((kind) => ID_GLOSSARY[kind].pattern.test(trimmed));
}
