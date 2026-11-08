/**
 * Who may answer the customer from this phone (tm 475.5 · §D453).
 *
 * The server's rule (tm 475.1): a customer-facing reply is written only by the
 * agent the conversation's open connection is assigned to; anyone else gets
 * 409 `reply_requires_assignment`. The phone asks the same question of what it
 * already holds — the `assignee_id` of the row in `GET /chats` (the newest
 * connection's assignee) against the signed-in account — and never a new
 * endpoint: the phone's call surface is pinned by the parity matrix, and the
 * console is where a conversation is taken (there is no "Take" button here).
 *
 * The decision stays the server's. A chat the phone knows nothing about is
 * `unknown` and the composer stays open; if the server refuses, the store
 * records the refusal and the composer closes then.
 */

/**
 * - `mine` — assigned to me: reply and note as usual.
 * - `not_mine` — someone else's, nobody's, or the AI's; or it left my list.
 * - `closed` — archived.
 * - `unknown` — not in the list and nothing heard about it; the server decides.
 */
export type ReplyAccess = 'mine' | 'not_mine' | 'closed' | 'unknown';

/** What the store remembers about a chat after the list or the server said it is not mine to answer. */
export type ReplyLock = 'not_mine' | 'closed';

/** Marks a reply the server refused because the chat is not mine. Kept on screen, never retried. */
export const REFUSED_PROPERTY = 'reply_refused';

export type CopyLocale = 'en' | 'tr';

interface ReplyGuardCopy {
  /** Under the transcript, above the disabled composer. */
  notMine: string;
  /** Under a reply the server refused — the words stay, the bubble says they did not go. */
  notSent: string;
}

const COPY: Readonly<Record<CopyLocale, ReplyGuardCopy>> = {
  en: {
    notMine: 'This chat is no longer yours; take it from the console to reply.',
    notSent: 'Not sent — this chat is no longer yours.',
  },
  tr: {
    notMine: 'Bu sohbet artık sizde değil; yanıtlamak için konsoldan üstüne alın.',
    notSent: 'Gönderilmedi — bu sohbet artık sizde değil.',
  },
};

/**
 * The phone has no i18n catalogue (see `lib/idLabels.ts`); these two sentences
 * follow the device language, Turkish or English.
 */
export function deviceLocale(): CopyLocale {
  try {
    const tag = Intl.DateTimeFormat().resolvedOptions().locale;
    return tag.toLowerCase().startsWith('tr') ? 'tr' : 'en';
  } catch {
    return 'en';
  }
}

export function replyGuardCopy(locale: CopyLocale = deviceLocale()): ReplyGuardCopy {
  return COPY[locale];
}
