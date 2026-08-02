/**
 * Multi-agent conflict warning state (FR-MOD-08.6.3).
 *
 * Two or more agents composing a reply in the same chat at once is a race, not
 * a fact worth persisting — so, like `typing.ts`, this stays out of the React
 * Query cache and holds only what is currently live: who is composing, and
 * since when.
 *
 * `agent_conflict_warning` re-publishes on every keystroke that keeps the
 * conflict alive (mirroring the server's composer registry), so a lapsed
 * warning means the other agent stopped, not that a message was dropped.
 * `CONFLICT_IDLE_MS` is derived from `AGENT_COMPOSING_TTL_SECONDS` — the same
 * window the server uses to drop a composer registry entry — rather than a
 * second hand-picked constant that could drift out of sync with it.
 */
import { create } from 'zustand';
import { AGENT_COMPOSING_TTL_SECONDS } from '@nexa/types';

export interface ConflictAgent {
  agentId: string;
  since: string;
}

export interface ChatConflict {
  agents: ConflictAgent[];
  detectedAt: string;
}

/** A conflict lapses if no fresh warning refreshes it — covers a dropped keystroke. */
export const CONFLICT_IDLE_MS = AGENT_COMPOSING_TTL_SECONDS * 1_000;

interface ConflictState {
  /** Per chat id — only chats with a live conflict are present. */
  byChat: Record<string, ChatConflict>;
  /** Fold an `agent_conflict_warning` push in; restarts the idle lapse timer. */
  note: (chatId: string, agents: ConflictAgent[], detectedAt: string) => void;
  clear: (chatId: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useConflictStore = create<ConflictState>((set, get) => ({
  byChat: {},

  note: (chatId, agents, detectedAt) => {
    const running = timers.get(chatId);
    if (running) clearTimeout(running);
    timers.delete(chatId);

    if (agents.length < 2) {
      get().clear(chatId);
      return;
    }

    set((state) => ({
      byChat: { ...state.byChat, [chatId]: { agents, detectedAt } },
    }));
    timers.set(
      chatId,
      setTimeout(() => get().clear(chatId), CONFLICT_IDLE_MS),
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
