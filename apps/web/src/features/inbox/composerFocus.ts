/**
 * "Open that chat and let me write" (IN-08).
 *
 * Alt+↓ selects the next chat, but its composer does not exist yet — it is
 * keyed on the chat and mounts once the chat has loaded. So the request is
 * left here, naming the chat, and the composer that mounts for that chat takes
 * it. A request for a chat that never opens (the agent moved on, the load
 * failed) expires rather than stealing focus from the next chat they click.
 */
const EXPIRES_AFTER_MS = 4_000;

let pending: { chatId: string; at: number } | null = null;

/** The composer's field, when it is the one for `chatId`. */
function composerField(chatId: string): HTMLTextAreaElement | null {
  const field = document.querySelector<HTMLTextAreaElement>('textarea[data-composer-input]');
  return field && field.dataset.chatId === chatId ? field : null;
}

/** Focus the composer of `chatId` — now if it is on screen, else when it mounts. */
export function focusComposerOf(chatId: string): void {
  const field = composerField(chatId);
  if (field && !field.disabled) {
    field.focus();
    pending = null;
    return;
  }
  pending = { chatId, at: Date.now() };
}

/** Called by a composer as it mounts: take the focus someone asked for it. */
export function claimComposerFocus(chatId: string, field: HTMLTextAreaElement | null): void {
  if (!pending || pending.chatId !== chatId) return;
  const fresh = Date.now() - pending.at < EXPIRES_AFTER_MS;
  pending = null;
  if (fresh && field && !field.disabled) field.focus();
}
