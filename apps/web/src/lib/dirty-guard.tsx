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
import { useCallback } from 'react';

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
