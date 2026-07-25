/**
 * The inbox right-panel preference (FR-MOD-01.3).
 *
 * The Details panel can sit beside the transcript or be collapsed so the
 * transcript takes the full width ("Expand"). Which the agent chose rides in
 * `localStorage`, not the account: screen width is what drives the choice and
 * that is a property of the machine, not the person — the same convention the
 * locale and notification preferences already follow. Copilot is a third mode
 * reserved for v1 (PLAN §D22), so today the switch is a plain two-state toggle.
 */
import { useState } from 'react';

export type RightPanelMode = 'details' | 'expanded';

const STORAGE_KEY = 'nexa.inbox.right-panel';
const DEFAULT_MODE: RightPanelMode = 'details';

/** `localStorage` can throw on access (private mode, sandboxed frames). */
function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** Read the remembered mode, defaulting to a visible Details panel. */
export function loadRightPanel(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): RightPanelMode {
  try {
    // Anything other than the one non-default token — a stale value, a future
    // "copilot" — falls back to Details rather than a broken layout.
    return storage?.getItem(STORAGE_KEY) === 'expanded' ? 'expanded' : 'details';
  } catch {
    return DEFAULT_MODE;
  }
}

/** Remember the mode; a write that fails simply resets on the next load. */
export function saveRightPanel(
  mode: RightPanelMode,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // A preference that cannot be remembered is not worth failing a click over.
  }
}

/**
 * The right panel's state, persisted across reloads. Returns whether the
 * transcript is expanded (Details hidden) and the two ways to change it: a
 * `toggle` for the header control and a direct `setExpanded` for the panel's
 * own close button.
 */
export function useRightPanel(): {
  expanded: boolean;
  toggle: () => void;
  setExpanded: (value: boolean) => void;
} {
  // Lazy initialiser: read the remembered choice once, on mount — which is
  // exactly what a page reload replays.
  const [mode, setMode] = useState<RightPanelMode>(loadRightPanel);

  const apply = (next: RightPanelMode): void => {
    setMode(next);
    saveRightPanel(next);
  };

  return {
    expanded: mode === 'expanded',
    toggle: () => apply(mode === 'expanded' ? 'details' : 'expanded'),
    setExpanded: (value: boolean) => apply(value ? 'expanded' : 'details'),
  };
}
