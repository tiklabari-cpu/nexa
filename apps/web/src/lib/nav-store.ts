/**
 * Nav pin preference (FR-MOD-01.1.1 · 01.5).
 *
 * Same shape as `theme.ts`/`i18n.ts`: a zustand store, a plain `localStorage`
 * round-trip, and a hook. Unlike those two the preference is not global — a
 * shared machine, or the same browser signed into two workspaces in the same
 * tab in sequence, must not carry one account's choice into another's — so
 * the storage key carries `accountId` and the hook re-reads it whenever the
 * id changes rather than once at module load, which is all `detectTheme`/
 * `detectLocale` ever need.
 *
 * Unpinned (the icon rail, unchanged from before this preference existed) is
 * the default: an agent who never opens the toggle sees exactly what shipped
 * before, and every rail test that predates this file keeps passing without
 * touching pin state at all.
 */
import { useLayoutEffect } from 'react';
import { create } from 'zustand';

const STORAGE_PREFIX = 'nexa.nav.pinned:';

/** What every account starts as, and what an unreadable value falls back to. */
export const DEFAULT_NAV_PINNED = false;

function storageKey(accountId: string): string {
  return `${STORAGE_PREFIX}${accountId}`;
}

/**
 * Read `accountId`'s remembered choice. Wrapped: storage access throws
 * outright in locked-down browsers.
 */
export function readNavPinned(accountId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(storageKey(accountId)) === 'true';
  } catch {
    return DEFAULT_NAV_PINNED;
  }
}

function writeNavPinned(accountId: string, pinned: boolean): void {
  try {
    globalThis.localStorage?.setItem(storageKey(accountId), String(pinned));
  } catch {
    // A choice that cannot be remembered simply resets next load — not fatal.
  }
}

interface NavState {
  /** The account the current `pinned` value was hydrated for; null before the first hydrate. */
  accountId: string | null;
  pinned: boolean;
  /** Load `accountId`'s remembered choice. A no-op once already hydrated for it. */
  hydrate: (accountId: string) => void;
  setPinned: (pinned: boolean) => void;
}

export const useNavStore = create<NavState>((set, get) => ({
  accountId: null,
  pinned: DEFAULT_NAV_PINNED,
  hydrate: (accountId) => {
    if (get().accountId === accountId) return;
    set({ accountId, pinned: readNavPinned(accountId) });
  },
  setPinned: (pinned) => {
    const { accountId } = get();
    if (!accountId) return;
    writeNavPinned(accountId, pinned);
    set({ pinned });
  },
}));

/**
 * `{ pinned, setPinned }` scoped to `accountId`.
 *
 * Hydrates that account's remembered choice before paint (`useLayoutEffect`,
 * so a returning agent never sees a one-frame flash of the wrong layout) and
 * again whenever `accountId` itself changes — signing out and a different
 * agent signing in in the same tab must land on the new account's own
 * preference, not whatever the previous one left behind. Until the hydrate
 * for the current `accountId` has run (including while it is still
 * `undefined`, i.e. the agent has not loaded yet), this reports the default
 * rather than a stale value left by a different account.
 */
export function useNavPinned(accountId: string | undefined): {
  pinned: boolean;
  setPinned: (pinned: boolean) => void;
} {
  const storeAccountId = useNavStore((s) => s.accountId);
  const pinned = useNavStore((s) => s.pinned);
  const hydrate = useNavStore((s) => s.hydrate);
  const setPinned = useNavStore((s) => s.setPinned);

  useLayoutEffect(() => {
    if (accountId) hydrate(accountId);
  }, [accountId, hydrate]);

  if (!accountId || accountId !== storeAccountId) {
    return { pinned: DEFAULT_NAV_PINNED, setPinned };
  }
  return { pinned, setPinned };
}
