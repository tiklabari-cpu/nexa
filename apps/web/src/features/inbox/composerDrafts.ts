/**
 * Per-chat composer drafts (IN-01, tm 277.2).
 *
 * The composer is keyed on the open chat (tm 277.1), so switching away unmounts
 * it and the words in the box would be gone. This keeps them — in this browser
 * only, never sent to the server (IN-01-S1) — and hands them back when the same
 * chat is opened again.
 *
 * What is kept, and what is deliberately not:
 *   - text and mode (reply / internal note) — yes. A note restored as a reply
 *     would be the expensive mistake the amber mode exists to prevent.
 *   - the attachment — **no**. A file picked for one player riding back in
 *     later, one Enter from being sent, is the leak 277.1 closed; coming back
 *     to a chat finds the text but not the file (a deliberate safety choice).
 *   - suggestion chips, the shortcut picker — transient, never stored.
 *
 * One localStorage key per (licence, account): `siyahtus.drafts.<licenseId>.<accountId>`,
 * holding a record per chat. Every record dies after {@link DRAFT_TTL_MS}, the
 * whole key is removed on sign-out, and a record is dropped when its chat is
 * sent, closed or handed to someone else. The module never reads the auth store
 * (the store imports *this*, to wipe on sign-out) — callers pass the scope in.
 */
import { create } from 'zustand';

export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

/** How long a keystroke waits before it is written; the unmount flushes sooner. */
export const DRAFT_WRITE_DELAY_MS = 300;

export type DraftMode = 'all' | 'agents';

export interface DraftScope {
  licenseId: string;
  accountId: string;
}

export interface ComposerDraft {
  text: string;
  mode: DraftMode;
  /** Epoch ms of the last edit — the TTL counts from here. */
  updatedAt: number;
}

type DraftRecord = Record<string, ComposerDraft>;

export function draftStorageKey(scope: DraftScope): string {
  return `siyahtus.drafts.${scope.licenseId}.${scope.accountId}`;
}

function isDraft(value: unknown): value is ComposerDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft['text'] === 'string' &&
    (draft['mode'] === 'all' || draft['mode'] === 'agents') &&
    typeof draft['updatedAt'] === 'number'
  );
}

/** The stored record minus anything expired or malformed. Never throws. */
function readRecord(scope: DraftScope, now: number): DraftRecord {
  try {
    const raw = localStorage.getItem(draftStorageKey(scope));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const live: DraftRecord = {};
    for (const [chatId, value] of Object.entries(parsed)) {
      if (isDraft(value) && now - value.updatedAt < DRAFT_TTL_MS && value.text.trim() !== '') {
        live[chatId] = value;
      }
    }
    return live;
  } catch {
    return {};
  }
}

function writeRecord(scope: DraftScope, record: DraftRecord): void {
  try {
    const key = draftStorageKey(scope);
    if (Object.keys(record).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Storage full or blocked: a draft is a convenience, never worth an error.
  }
}

/** The saved draft for a chat, or null when there is none or it has expired. */
export function loadDraft(
  scope: DraftScope,
  chatId: string,
  now = Date.now(),
): ComposerDraft | null {
  return readRecord(scope, now)[chatId] ?? null;
}

/** Save a chat's draft; an empty one removes the record instead. */
export function saveDraft(
  scope: DraftScope,
  chatId: string,
  draft: { text: string; mode: DraftMode },
  now = Date.now(),
): void {
  const record = readRecord(scope, now);
  if (draft.text.trim() === '') delete record[chatId];
  else record[chatId] = { text: draft.text, mode: draft.mode, updatedAt: now };
  writeRecord(scope, record);
}

/** Drop one chat's draft (sent, closed, handed over). */
export function discardDraft(scope: DraftScope, chatId: string): void {
  const record = readRecord(scope, Date.now());
  if (!(chatId in record)) return;
  delete record[chatId];
  writeRecord(scope, record);
}

/** Sign-out: every draft this account kept in this workspace goes. */
export function clearAllDrafts(scope: DraftScope): void {
  try {
    localStorage.removeItem(draftStorageKey(scope));
  } catch {
    // Nothing to do — an unreadable store holds nothing to leak either.
  }
}

interface RetiredState {
  /**
   * Bumped per chat when the server took the conversation away from this agent
   * (closed, transferred, taken over). A composer still mounted for that chat
   * clears its box and stops re-saving it.
   */
  byChat: Record<string, number | undefined>;
}

export const useRetiredDraftStore = create<RetiredState>(() => ({ byChat: {} }));

/**
 * The conversation is no longer this agent's to answer: delete its draft, and
 * tell a composer that may still be open on it.
 */
export function retireDraft(scope: DraftScope | null, chatId: string): void {
  if (scope) discardDraft(scope, chatId);
  useRetiredDraftStore.setState((state) => ({
    byChat: { ...state.byChat, [chatId]: (state.byChat[chatId] ?? 0) + 1 },
  }));
}
