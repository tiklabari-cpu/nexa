/**
 * What one conversation is called, in the one place both screens read it from.
 *
 * The list has always computed this for the row it draws and for the header it
 * pushes with. `13.7-q` gave the conversation a second way in — `nexa://chats/
 * <id>`, and after it a tapped notification (13.7-s) — and a URL carries no
 * name, so the detail screen has to be able to work it out for itself. One
 * function rather than the same line in two files: a header that said "Visitor"
 * where the row said something else would look like two different chats.
 */
import type { ChatSummary } from './types';

export function chatTitle(chat: ChatSummary): string {
  // An anonymous visitor is the common case, not an error state.
  return chat.customer_name ?? 'Visitor';
}

/** The generic header a deep link starts with, before the list has answered. */
export const UNKNOWN_CHAT_TITLE = 'Conversation';

/**
 * What the conversation's header should say right now.
 *
 * `given` is what the route was pushed with — present whenever the person came
 * through the list, and the answer as-is: the list already worked it out, and
 * recomputing it would only introduce a way for the two to disagree.
 *
 * Absent means a deep link or a tapped notification, so the name has to come
 * from the inbox instead — which may not have loaded yet, or may not contain
 * this chat at all (archived, assigned elsewhere, or simply on another page).
 * That last case is why the generic title is a real answer rather than a
 * placeholder to be replaced eventually.
 */
export function headerTitleFor(
  chats: readonly ChatSummary[],
  chatId: string,
  given: string | undefined,
): string {
  if (given !== undefined) return given;
  const chat = chats.find((candidate) => candidate.id === chatId);
  return chat === undefined ? UNKNOWN_CHAT_TITLE : chatTitle(chat);
}
