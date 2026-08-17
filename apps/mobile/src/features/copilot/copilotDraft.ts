/**
 * The hand-off from Copilot to the composer (FR-MOD-12.3) — the mobile
 * counterpart of `apps/web/src/features/inbox/copilotDraft.ts`. A drafted
 * reply never sends itself: this drops the suggestion for a chat id and the
 * composer picks it up next time it renders for that chat.
 *
 * The web version reaches for zustand; mobile keeps this a plain
 * `useSyncExternalStore` subscription instead, the same technique
 * `features/inbox/useInbox.ts` already uses for the (larger) inbox store —
 * there is no store dependency in this app to reach for, so this stays the
 * smallest thing that does the job rather than adding one for a single
 * chat-id-keyed value.
 */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

class CopilotDraftStore {
  #byChat: Record<string, string | undefined> = {};
  #listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  getDraft = (chatId: string): string | undefined => this.#byChat[chatId];

  push(chatId: string, text: string): void {
    this.#byChat = { ...this.#byChat, [chatId]: text };
    this.#notify();
  }

  clear(chatId: string): void {
    if (!(chatId in this.#byChat)) return;
    const next = { ...this.#byChat };
    delete next[chatId];
    this.#byChat = next;
    this.#notify();
  }

  #notify(): void {
    for (const listener of this.#listeners) listener();
  }
}

export const copilotDraftStore = new CopilotDraftStore();

/** Copilot offers a draft for a chat — the one entry point `CopilotScreen` uses. */
export function offerDraft(chatId: string, text: string): void {
  copilotDraftStore.push(chatId, text);
}

/** The composer's view of a pending draft for one chat. */
export function useCopilotDraft(chatId: string): string | undefined {
  return useSyncExternalStore(copilotDraftStore.subscribe, () =>
    copilotDraftStore.getDraft(chatId),
  );
}

/** The composer takes it, so the same draft is not re-applied on every render. */
export function clearCopilotDraft(chatId: string): void {
  copilotDraftStore.clear(chatId);
}
