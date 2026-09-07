/**
 * Chats *this agent* has told the server they are watching (FR-MOD-02.1.1,
 * tm 213) — what drives `rowActions.ts`'s Supervise/Stop supervising toggle.
 *
 * `localStorage`, not component state and not an in-memory module store:
 * `Supervise chat` navigates to the transcript in the same click, and the
 * agent's own next move from there is very often a *real* browser navigation
 * back to the board — a bookmark, a second tab, `page.goto` in a test —
 * rather than a client-side route change. Nothing held only in memory
 * survives that; `apps/e2e/tests/inbox-supervised.spec.ts`'s supervise ->
 * navigate away -> come back -> unsupervise walk is exactly this path, and it
 * caught both a `useState` and a first, in-memory version of this store
 * losing the watch on the second `goto`.
 *
 * Shape and account-scoping follow `nav-store.ts`: the key carries `accountId`
 * so a shared machine, or a second agent signing in in the same tab, does not
 * inherit someone else's claimed watches. No endpoint reports "who is
 * watching a chat" (`rowActions.ts`), so this is the only record the client
 * has of its own clicks — it does not expire with `SupervisionService`'s
 * 90-second liveness window, so clicking Stop long after the last heartbeat
 * is a harmless no-op release rather than a correctness bug
 * (`SupervisionService#release`: "stopping something already stopped
 * succeeds as well").
 */
import { useLayoutEffect } from 'react';
import { create } from 'zustand';

const STORAGE_PREFIX = 'nexa.traffic.supervising:';

function storageKey(accountId: string): string {
  return `${STORAGE_PREFIX}${accountId}`;
}

/** Wrapped: storage access throws outright in locked-down browsers. */
function readSupervising(accountId: string): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(accountId));
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch {
    return new Set();
  }
}

function writeSupervising(accountId: string, chatIds: ReadonlySet<string>): void {
  try {
    globalThis.localStorage?.setItem(storageKey(accountId), JSON.stringify([...chatIds]));
  } catch {
    // A watch that cannot be remembered simply resets next load — not fatal.
  }
}

interface SupervisingState {
  /** The account the current `chatIds` were hydrated for; null before the first hydrate. */
  accountId: string | null;
  chatIds: Set<string>;
  /** Load `accountId`'s remembered watches. A no-op once already hydrated for it. */
  hydrate: (accountId: string) => void;
  add: (accountId: string, chatId: string) => void;
  remove: (accountId: string, chatId: string) => void;
}

export const useSupervisingStore = create<SupervisingState>((set, get) => ({
  accountId: null,
  chatIds: new Set(),
  hydrate: (accountId) => {
    if (get().accountId === accountId) return;
    set({ accountId, chatIds: readSupervising(accountId) });
  },
  add: (accountId, chatId) =>
    set((state) => {
      const next = new Set(state.chatIds).add(chatId);
      writeSupervising(accountId, next);
      return { chatIds: next };
    }),
  remove: (accountId, chatId) =>
    set((state) => {
      const next = new Set(state.chatIds);
      next.delete(chatId);
      writeSupervising(accountId, next);
      return { chatIds: next };
    }),
}));

/**
 * `{ chatIds, add, remove }` scoped to `accountId` — hydrates before paint
 * (`useLayoutEffect`, `useNavPinned`'s precedent) so a returning agent never
 * flashes an empty set, and re-hydrates whenever `accountId` itself changes.
 * Until hydrated for the current `accountId` (including while it is still
 * `undefined`, i.e. the agent has not loaded yet), reports an empty set
 * rather than whatever a previous account left behind.
 */
export function useSupervising(accountId: string | undefined): {
  chatIds: Set<string>;
  add: (chatId: string) => void;
  remove: (chatId: string) => void;
} {
  const storeAccountId = useSupervisingStore((s) => s.accountId);
  const chatIds = useSupervisingStore((s) => s.chatIds);
  const hydrate = useSupervisingStore((s) => s.hydrate);
  const addAction = useSupervisingStore((s) => s.add);
  const removeAction = useSupervisingStore((s) => s.remove);

  useLayoutEffect(() => {
    if (accountId) hydrate(accountId);
  }, [accountId, hydrate]);

  if (!accountId || accountId !== storeAccountId) {
    return { chatIds: new Set(), add: () => {}, remove: () => {} };
  }
  return {
    chatIds,
    add: (chatId) => addAction(accountId, chatId),
    remove: (chatId) => removeAction(accountId, chatId),
  };
}
