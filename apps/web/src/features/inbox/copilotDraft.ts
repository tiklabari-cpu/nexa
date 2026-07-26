/**
 * The hand-off from Copilot to the composer (FR-MOD-12.3).
 *
 * Copilot proposes text — a drafted reply, or a rewrite of the agent's own —
 * and the agent decides whether to send it. The composer owns the reply text,
 * so rather than lift that state up into the whole inbox, Copilot drops the
 * suggestion here and the composer picks it up for its chat. Kept out of the
 * React Query cache for the same reason the typing store is: this is a transient
 * nudge between two panes, not a fact about the conversation.
 */
import { create } from 'zustand';

interface CopilotDraftState {
  /** Pending suggestion per chat id — only chats with one waiting are present. */
  byChat: Record<string, string | undefined>;
  /** Copilot offers a draft for a chat. */
  push: (chatId: string, text: string) => void;
  /** The composer takes it, so the same draft is not re-applied on every render. */
  clear: (chatId: string) => void;
}

export const useCopilotDraftStore = create<CopilotDraftState>((set) => ({
  byChat: {},
  push: (chatId, text) =>
    set((state) => ({ byChat: { ...state.byChat, [chatId]: text } })),
  clear: (chatId) =>
    set((state) => {
      if (!(chatId in state.byChat)) return state;
      const next = { ...state.byChat };
      delete next[chatId];
      return { byChat: next };
    }),
}));

/** Push a draft into the composer for a chat — the one entry point Copilot uses. */
export function offerDraft(chatId: string, text: string): void {
  useCopilotDraftStore.getState().push(chatId, text);
}
