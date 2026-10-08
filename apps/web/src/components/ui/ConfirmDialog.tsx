/**
 * ConfirmDialog — the one "are you sure?" before an action that cannot be undone
 * (tm 259.7).
 *
 * Settings deleted on a single click: removing a website stopped the widget on
 * that site and nothing asked first. This is a `Modal` with the shape every one
 * of those deletions needs:
 *
 * - a title that names the thing ("Delete tag “vip”?") and a sentence that says
 *   what will happen — both the caller's words, because only the caller knows;
 * - a danger button that does it and "Cancel" that doesn't. Focus lands on
 *   Cancel, so Enter on a freshly opened dialog never deletes; Escape and a
 *   backdrop click are Cancel too (Modal's one dismissal contract);
 * - while the confirmed action runs the danger button is disabled and says so,
 *   and every dismissal is ignored — a second click cannot send a second
 *   request, and the dialog does not vanish before the answer is in.
 *
 * Callers use `useConfirm()` rather than the component: one hook call, one
 * `{dialog}` in the JSX, and `confirm({...})` where the click handler used to
 * mutate. Eleven settings screens share that single pattern.
 */
import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslate } from '../../lib/i18n.js';
import { Modal } from './Modal.js';

interface ConfirmDialogProps {
  title: ReactNode;
  /** What will happen, in a sentence — the consequence, not a restatement of the title. */
  description: ReactNode;
  /** The danger button's label; defaults to "Delete". */
  confirmLabel?: string;
  /** The confirmed action is running: the danger button is disabled and says so. */
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): ReactElement {
  const t = useTranslate();
  return (
    <Modal
      // Escape and the backdrop route here; both are ignored mid-request.
      onClose={pending ? noop : onCancel}
      title={title}
      description={description}
    >
      <div className="flex justify-end gap-2">
        <button
          type="button"
          // Default focus is the safe choice (Modal keeps focus the content claimed).
          autoFocus
          disabled={pending}
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {t('ui.confirm.cancel')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {pending ? t('ui.confirm.pending') : (confirmLabel ?? t('ui.confirm.delete'))}
        </button>
      </div>
    </Modal>
  );
}

function noop(): void {
  // Intentionally empty: a dismissal while the confirmed action runs does nothing.
}

export interface ConfirmRequest {
  title: ReactNode;
  description: ReactNode;
  confirmLabel?: string;
  /**
   * What to do on "Delete". Return the promise (`mutateAsync`) and the dialog
   * stays open, pending, until it settles; a plain `mutate()` closes it at once.
   * A rejection is swallowed here — the mutation carries its own error state.
   */
  onConfirm: () => unknown;
}

/**
 * `confirm(request)` opens the dialog; render `dialog` once in the screen's JSX.
 * Only one confirmation is open at a time per hook.
 */
export function useConfirm(): {
  confirm: (request: ConfirmRequest) => void;
  dialog: ReactElement | null;
} {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [pending, setPending] = useState(false);
  // State lags a render behind a click; the ref is what makes "once" true for a
  // double-click inside that gap.
  const running = useRef(false);

  function close(): void {
    running.current = false;
    setPending(false);
    setRequest(null);
  }

  async function run(current: ConfirmRequest): Promise<void> {
    if (running.current) return;
    running.current = true;
    setPending(true);
    try {
      await current.onConfirm();
    } catch {
      // The caller's mutation holds the error; the dialog's job is over either way.
    } finally {
      close();
    }
  }

  const dialog = request ? (
    <ConfirmDialog
      title={request.title}
      description={request.description}
      confirmLabel={request.confirmLabel}
      pending={pending}
      onConfirm={() => void run(request)}
      onCancel={close}
    />
  ) : null;

  return { confirm: setRequest, dialog };
}
