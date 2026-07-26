/**
 * Live typing preview state (FR-MOD-02.9 / 11.8).
 *
 * Kept out of the React Query cache on purpose. A typing indicator is not a fact
 * about the conversation the way a message is — it is transient, it is never
 * refetched, and folding it into the transcript cache would make it look like
 * one more event to reconcile. This tiny store holds only what is currently
 * animating: which visitor is typing, and the sneak-peek of what they are about
 * to send.
 *
 * Two pushes feed it. `incoming_typing_indicator` carries the on/off state but
 * no text; `incoming_sneak_peek` carries the preview. They arrive as a pair, so
 * a bare typing push preserves any preview already on screen rather than
 * blanking it between keystrokes.
 */
import { create } from 'zustand';

export interface CustomerTyping {
  isTyping: boolean;
  /** The visitor's in-progress text, when a sneak-peek carried one. */
  text: string | null;
}

/** A visitor indicator lapses if no keystroke refreshes it — covers a dropped "stop". */
export const TYPING_IDLE_MS = 6_000;

interface TypingState {
  /** Per chat id — only chats with a live indicator are present. */
  byChat: Record<string, CustomerTyping>;
  /** Send the agent's own typing upstream; wired by the realtime layer. */
  emit: (chatId: string, isTyping: boolean) => void;
  setEmitter: (emit: (chatId: string, isTyping: boolean) => void) => void;
  /**
   * Fold a visitor typing/sneak-peek push in. `text` is the preview when this
   * came from a sneak-peek, or null for a bare typing push, which keeps whatever
   * preview is already showing.
   */
  noteCustomer: (chatId: string, isTyping: boolean, text: string | null) => void;
  clear: (chatId: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useTypingStore = create<TypingState>((set, get) => ({
  byChat: {},
  emit: () => {},
  setEmitter: (emit) => set({ emit }),

  noteCustomer: (chatId, isTyping, text) => {
    const running = timers.get(chatId);
    if (running) clearTimeout(running);
    timers.delete(chatId);

    if (!isTyping) {
      get().clear(chatId);
      return;
    }

    set((state) => {
      const previous = state.byChat[chatId];
      return {
        byChat: {
          ...state.byChat,
          [chatId]: { isTyping: true, text: text ?? previous?.text ?? null },
        },
      };
    });
    timers.set(
      chatId,
      setTimeout(() => get().clear(chatId), TYPING_IDLE_MS),
    );
  },

  clear: (chatId) => {
    const running = timers.get(chatId);
    if (running) clearTimeout(running);
    timers.delete(chatId);
    set((state) => {
      if (!(chatId in state.byChat)) return state;
      const next = { ...state.byChat };
      delete next[chatId];
      return { byChat: next };
    });
  },
}));
