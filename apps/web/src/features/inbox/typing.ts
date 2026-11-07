/**
 * Live typing preview state (FR-MOD-02.9 / 11.8).
 *
 * Kept out of the React Query cache on purpose. A typing indicator is not a fact
 * about the conversation the way a message is — it is transient, it is never
 * refetched, and folding it into the transcript cache would make it look like
 * one more event to reconcile. This tiny store holds what the strip above the
 * composer draws: whether the visitor is typing right now, and the draft they
 * have not sent yet.
 *
 * Two pushes feed it (tm 417.2). `incoming_sneak_peek` carries the draft; a
 * clear (`incoming_typing_indicator` with `is_typing:false`) ends it. Both carry
 * the widget's `seq`, which only ever rises within one widget load, so a frame
 * that overtook a newer one — a late draft behind a clear above all — is dropped
 * rather than drawn as a ghost.
 *
 * Three clocks, each with its own meaning:
 * - `TYPING_IDLE_MS`: no keystroke for 6 s → the dots go out, the draft stays
 *   ("has not sent this yet").
 * - `DRAFT_STALE_MS`: no accepted frame for 30 s → the draft goes. The widget
 *   sends nothing while the text does not change (no heartbeat), and a lost
 *   clear must not leave a draft up for good.
 * - `SEQ_TOMBSTONE_MS`: the record — by then only `maxSeq` — is forgotten 10 min
 *   after its last accepted frame. That is the ordering guard's memory, not how
 *   long anything is shown.
 */
import { create } from 'zustand';

export interface CustomerTyping {
  /** A keystroke arrived in the last `TYPING_IDLE_MS`: draw the dots. */
  isTyping: boolean;
  /** The visitor's unsent draft, when a sneak-peek carried one. */
  text: string | null;
  /** When the last accepted frame arrived (ms since epoch). */
  updatedAt: number;
  /** The highest `seq` accepted — a frame at or below it is stale. Null for seq-less pushes. */
  maxSeq: number | null;
}

/** No keystroke for this long and the dots go out; the draft stays. */
export const TYPING_IDLE_MS = 6_000;
/** No accepted frame for this long and the draft goes (owner 2026-11-06 S1). */
export const DRAFT_STALE_MS = 30_000;
/** How long the ordering guard remembers a chat's `maxSeq`. */
export const SEQ_TOMBSTONE_MS = 600_000;

/** Whether the strip has something to draw for this record. */
export function hasVisibleDraft(typing: CustomerTyping | undefined): typing is CustomerTyping {
  return typing !== undefined && (typing.isTyping || typing.text !== null);
}

interface TypingState {
  /** Per chat id — a chat with a draft on screen, or only its ordering tombstone. */
  byChat: Record<string, CustomerTyping>;
  /** Send the agent's own typing upstream; wired by the realtime layer. */
  emit: (chatId: string, isTyping: boolean) => void;
  setEmitter: (emit: (chatId: string, isTyping: boolean) => void) => void;
  /**
   * Fold a visitor typing/sneak-peek push in. `text` is the draft when this
   * came from a sneak-peek, or null for a bare typing push, which keeps whatever
   * draft is already showing but does not make it any fresher. `seq` is the
   * widget's frame counter, when the push carried one.
   */
  noteCustomer: (chatId: string, isTyping: boolean, text: string | null, seq?: number) => void;
  /** The visitor sent their message: the draft goes, the ordering guard stays. */
  endDraft: (chatId: string) => void;
  /** Forget the chat entirely — closed, handed away, or no longer known to be current. */
  clear: (chatId: string) => void;
  /** Forget every chat (the socket came back after a drop). */
  clearAll: () => void;
}

type Timers = Map<string, ReturnType<typeof setTimeout>>;
const idleTimers: Timers = new Map();
const staleTimers: Timers = new Map();
const tombstoneTimers: Timers = new Map();

function stop(timers: Timers, chatId: string): void {
  const running = timers.get(chatId);
  if (running) clearTimeout(running);
  timers.delete(chatId);
}

function start(timers: Timers, chatId: string, ms: number, fire: () => void): void {
  stop(timers, chatId);
  timers.set(
    chatId,
    setTimeout(() => {
      timers.delete(chatId);
      fire();
    }, ms),
  );
}

/**
 * The first frame of a widget load. The widget's counter starts again on every
 * load (a reload, a second tab), so a chat's guard has to start again with it —
 * otherwise a visitor who reloaded after 40 frames would be invisible until
 * their 41st.
 */
const FIRST_SEQ = 1;

export const useTypingStore = create<TypingState>((set, get) => {
  const write = (chatId: string, next: CustomerTyping): void =>
    set((state) => ({ byChat: { ...state.byChat, [chatId]: next } }));

  /** Draft gone, guard kept — or the record dropped when it has no guard to keep. */
  const retire = (chatId: string): void => {
    stop(idleTimers, chatId);
    stop(staleTimers, chatId);
    const previous = get().byChat[chatId];
    if (!previous) return;
    if (previous.maxSeq === null) {
      get().clear(chatId);
      return;
    }
    write(chatId, { ...previous, isTyping: false, text: null });
  };

  return {
    byChat: {},
    emit: () => {},
    setEmitter: (emit) => set({ emit }),

    noteCustomer: (chatId, isTyping, text, seq) => {
      const previous = get().byChat[chatId];
      const guard = seq === FIRST_SEQ ? null : (previous?.maxSeq ?? null);
      if (seq !== undefined && guard !== null && seq <= guard) return;
      const maxSeq = seq ?? previous?.maxSeq ?? null;
      const now = Date.now();

      if (seq !== undefined) {
        start(tombstoneTimers, chatId, SEQ_TOMBSTONE_MS, () => get().clear(chatId));
      }

      if (!isTyping) {
        if (maxSeq === null) {
          get().clear(chatId);
          return;
        }
        stop(idleTimers, chatId);
        stop(staleTimers, chatId);
        write(chatId, { isTyping: false, text: null, updatedAt: now, maxSeq });
        return;
      }

      start(idleTimers, chatId, TYPING_IDLE_MS, () => {
        const current = get().byChat[chatId];
        if (!current) return;
        if (current.text === null && current.maxSeq === null) get().clear(chatId);
        else write(chatId, { ...current, isTyping: false });
      });

      if (text === null) {
        // A bare typing push: the dots, and whatever draft is up — but not a
        // fresh lease on it. Only a frame that carried the text says the text
        // is still current.
        write(chatId, {
          isTyping: true,
          text: previous?.text ?? null,
          updatedAt: previous?.updatedAt ?? now,
          maxSeq,
        });
        return;
      }

      write(chatId, { isTyping: true, text, updatedAt: now, maxSeq });
      start(staleTimers, chatId, DRAFT_STALE_MS, () => retire(chatId));
    },

    endDraft: (chatId) => retire(chatId),

    clear: (chatId) => {
      stop(idleTimers, chatId);
      stop(staleTimers, chatId);
      stop(tombstoneTimers, chatId);
      set((state) => {
        if (!(chatId in state.byChat)) return state;
        const next = { ...state.byChat };
        delete next[chatId];
        return { byChat: next };
      });
    },

    clearAll: () => {
      for (const chatId of Object.keys(get().byChat)) get().clear(chatId);
    },
  };
});
