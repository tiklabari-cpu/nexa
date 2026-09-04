/**
 * The inbox right-panel tab preference (FR-MOD-01.3).
 *
 * Details and Copilot (FR-MOD-12.1) are the two faces of the same right-hand
 * slot; which one is showing rides in `localStorage`, the same convention
 * `rightPanel.ts` uses for the panel's Expand/collapse choice — a second key
 * in the same family, not a second persistence mechanism that could silently
 * drift from it.
 */
import { useState } from 'react';

export type PanelTab = 'details' | 'copilot';

const STORAGE_KEY = 'nexa.inbox.right-panel-tab';
const DEFAULT_TAB: PanelTab = 'details';

/** `localStorage` can throw on access (private mode, sandboxed frames). */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Read the remembered tab, defaulting to Details. */
export function loadPanelTab(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): PanelTab {
  try {
    // Anything other than the one non-default token — a stale value, a typo —
    // falls back to Details rather than a panel showing nothing.
    return storage?.getItem(STORAGE_KEY) === 'copilot' ? 'copilot' : 'details';
  } catch {
    return DEFAULT_TAB;
  }
}

/** Remember the tab; a write that fails simply resets on the next load. */
export function savePanelTab(
  tab: PanelTab,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, tab);
  } catch {
    // A preference that cannot be remembered is not worth failing a click over.
  }
}

/**
 * The right panel's active tab, persisted across reloads and across switching
 * between open chats — the PRD's "Details/Copilot geçişi persist". The caller
 * (`InboxPage`) still decides when the absence of an open chat should force
 * this back to Details; Copilot with nothing to assist is not a state this
 * store defends against on its own.
 */
export function usePanelTab(): {
  tab: PanelTab;
  showDetails: () => void;
  showCopilot: () => void;
} {
  // Lazy initialiser: read the remembered choice once, on mount — which is
  // exactly what a page reload replays.
  const [tab, setTab] = useState<PanelTab>(loadPanelTab);

  const apply = (next: PanelTab): void => {
    setTab(next);
    savePanelTab(next);
  };

  return {
    tab,
    showDetails: () => apply('details'),
    showCopilot: () => apply('copilot'),
  };
}
