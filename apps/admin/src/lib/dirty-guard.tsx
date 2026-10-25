/**
 * Discard-changes confirmation, in one place (FR-EK-A.2).
 *
 * Half-typed input is work. Closing a modal with a stray click, hitting Escape,
 * or clicking the backdrop should not silently throw that work away — but until
 * this, no modal in the app asked. Each screen that wanted the behaviour would
 * have written its own `window.confirm` with its own wording, and most simply
 * did not bother. This is the single guard they share: given whether a form is
 * dirty, it decides whether closing is safe and asks only when there is
 * something to lose.
 *
 * The confirmer is injectable so the decision is testable without a real dialog;
 * it defaults to the browser's `window.confirm`.
 */
import { useCallback, useEffect, useRef } from 'react';

export const DISCARD_MESSAGE = 'Discard your unsaved changes?';

/** Ask which browser dialog to raise — real `window.confirm` in the app, a stub in tests. */
export type Confirmer = (message: string) => boolean;

const browserConfirm: Confirmer = (message) =>
  // Guard for non-browser test envs where `window` may be undefined.
  typeof window === 'undefined' ? true : window.confirm(message);

/**
 * `true` when it is safe to proceed: either nothing is dirty, or the person
 * confirmed they want to discard. Pure and confirmer-injectable, so the rule
 * itself can be unit-tested without a DOM dialog.
 */
export function confirmDiscard(
  isDirty: boolean,
  message: string = DISCARD_MESSAGE,
  confirm: Confirmer = browserConfirm,
): boolean {
  return !isDirty || confirm(message);
}

/**
 * Wrap a close handler so it confirms first when the form is dirty. Returns a
 * `requestClose` to bind to every dismissal path — the Cancel button, Escape,
 * the backdrop — so one gate covers all of them instead of each remembering to
 * ask. When clean it closes straight through, so an untouched modal never
 * nags.
 */
export function useCloseGuard(options: {
  isDirty: boolean;
  onClose: () => void;
  message?: string;
  confirm?: Confirmer;
}): () => void {
  const { isDirty, onClose, message = DISCARD_MESSAGE, confirm = browserConfirm } = options;
  return useCallback(() => {
    if (confirmDiscard(isDirty, message, confirm)) onClose();
  }, [isDirty, onClose, message, confirm]);
}

/* -------------------------------------------------------------------------- *
 * Leaving the screen, rather than closing a modal (FR-MOD-06.2.1).
 *
 * A modal knows its own dismissal paths, so `useCloseGuard` can wrap them. A
 * screen does not: the click that throws the work away happens in the app
 * shell's nav rail, or in the browser chrome — neither of which can see the
 * half-typed form inside `<Outlet/>`. So the two are separate mechanisms, and
 * both have to be closed. Warning only on `beforeunload` would mean the tab
 * close is guarded while the far more common loss, clicking another module,
 * is silent.
 * -------------------------------------------------------------------------- */

/**
 * Screens that currently hold unsaved edits, each with the wording it wants
 * asked. A module-level registry rather than React context because the asker
 * (the nav rail) is an ancestor of the holder and renders before it — a
 * context would have to be threaded through the whole shell to carry one bit.
 */
const leaveGuards = new Map<object, string>();

/**
 * Warn when leaving? Dirty is the reason; mid-save is the exception — the work
 * is already on its way to the server, so asking "discard your changes?" while
 * the PATCH is in flight would be both alarming and wrong.
 *
 * Pure and exported on its own because `beforeunload` cannot be exercised
 * meaningfully in jsdom: the decision is tested here, and the listener's
 * registration separately.
 */
export function shouldWarnOnLeave(dirty: boolean, saving: boolean): boolean {
  return dirty && !saving;
}

/**
 * Register this screen as holding unsaved edits while `active`, and ask the
 * browser to confirm a reload/tab close for as long as it does.
 *
 * `message` is the screen's own translated wording, registered alongside the
 * guard so the shell can quote it without knowing which screen is dirty.
 */
export function useLeaveGuard(active: boolean, message: string = DISCARD_MESSAGE): void {
  // A per-mount identity, so two dirty screens (or a remount) never collide on
  // one registry key and delete each other's entry.
  const token = useRef({});

  useEffect(() => {
    if (!active) return undefined;

    const key = token.current;
    leaveGuards.set(key, message);

    const warn = (event: BeforeUnloadEvent): void => {
      // Browsers show their own wording, not ours; both calls are needed
      // because engines disagree on which one arms the dialog.
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);

    return () => {
      leaveGuards.delete(key);
      window.removeEventListener('beforeunload', warn);
    };
  }, [active, message]);
}

/**
 * `true` when in-app navigation may proceed: nothing is holding unsaved edits,
 * or the person confirmed they want to discard them. Bound to every in-app
 * destination that leaves the current screen.
 */
export function confirmLeave(confirm: Confirmer = browserConfirm): boolean {
  const message = leaveGuards.values().next().value ?? DISCARD_MESSAGE;
  return confirmDiscard(leaveGuards.size > 0, message, confirm);
}
