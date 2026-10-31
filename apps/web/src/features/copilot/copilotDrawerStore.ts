/**
 * The Copilot drawer's session (IN-09): whether it is open, which conversation
 * it is beside, and what has been asked in it.
 *
 * In memory only, on purpose. The drawer is mounted by the shell, which
 * outlives every route change, so moving from Reports to Settings keeps the
 * conversation; a reload (or signing out, which unmounts the shell) starts
 * clean — the server keeps no copy of a question either (`POST /copilot/ask`
 * writes a count, never words), so nothing here is a record to come back to.
 */
import { create } from 'zustand';

/** What the drawer remembers per session; the oldest entry is dropped past this. */
export const MAX_ENTRIES = 30;

export type DrawerEntryKind = 'ask' | 'summary' | 'draft';

export interface DrawerSource {
  id: string;
  title: string;
  reviewed_at: string;
}

export type DrawerAnswerKind = 'kb' | 'bi' | 'unknown';
export type DrawerReason = 'not_permitted' | 'not_understood' | 'no_data' | 'no_answer';

export interface DrawerEntry {
  id: string;
  kind: DrawerEntryKind;
  /** The agent's words; empty for the two chat actions, which have no question. */
  question: string;
  status: 'pending' | 'done' | 'error';
  /** The conversation the entry was asked about, if any. */
  chatId: string | null;
  answer?: string;
  answerKind?: DrawerAnswerKind;
  reason?: DrawerReason;
  sources?: DrawerSource[];
  /** A summary of an archived chat is shown but not written as a note. */
  noteSaved?: boolean;
  /** `ai_daily_cap` is told apart: retrying before midnight UTC cannot help. */
  error?: 'ai_daily_cap' | 'failed';
}

export interface DrawerChat {
  id: string;
  /** False on an archived chat: there is no composer to hand a draft to. */
  canDraft: boolean;
}

interface DrawerState {
  open: boolean;
  chat: DrawerChat | null;
  entries: DrawerEntry[];
  setOpen: (open: boolean) => void;
  toggle: () => void;
  setChat: (chat: DrawerChat | null) => void;
  add: (entry: Omit<DrawerEntry, 'id'>) => string;
  patch: (id: string, change: Partial<Omit<DrawerEntry, 'id'>>) => void;
  clear: () => void;
}

let sequence = 0;

export const useCopilotDrawerStore = create<DrawerState>((set) => ({
  open: false,
  chat: null,
  entries: [],
  setOpen: (open) => set({ open }),
  toggle: () => set((state) => ({ open: !state.open })),
  setChat: (chat) =>
    set((state) => {
      const same = state.chat?.id === chat?.id && state.chat?.canDraft === chat?.canDraft;
      return same ? state : { chat };
    }),
  add: (entry) => {
    sequence += 1;
    const id = `copilot-entry-${sequence}`;
    set((state) => ({ entries: [...state.entries, { ...entry, id }].slice(-MAX_ENTRIES) }));
    return id;
  },
  patch: (id, change) =>
    set((state) => ({
      entries: state.entries.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    })),
  clear: () => set({ entries: [] }),
}));

/** Empty the session — a test, or the shell going away. */
export function resetCopilotDrawer(): void {
  useCopilotDrawerStore.setState({ open: false, chat: null, entries: [] });
}
