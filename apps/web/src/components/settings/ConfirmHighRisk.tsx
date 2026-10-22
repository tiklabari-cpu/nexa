/**
 * ConfirmHighRisk — the reasoned confirm in front of a high-risk setting
 * (tm 323.1 · GV-06-S1).
 *
 * Some settings change who may do what in the whole workspace — the permission
 * matrix, the AI compliance rules, how long data is kept. Saving one of those
 * is a two-step act: first the change is shown as a before/after list, then the
 * person must say *why*. The reason is the caller's to send (it travels in the
 * request body as `reason` and the API writes it to the audit entry); this
 * component only refuses to confirm without one.
 *
 * A refused save stays here: the dialog keeps the reason typed so far and shows
 * the failure above the buttons, rather than closing on an unexplained error.
 */
import { useId, useState, type ReactElement, type ReactNode } from 'react';
import { Modal } from '../ui/Modal.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { FieldError, maxLength } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

/** The audit entry's reason column is bounded; the box is held to the same. */
export const HIGH_RISK_REASON_MAX = 500;

export interface HighRiskChange {
  key: string;
  /** The setting's name, already translated. */
  label: string;
  /** Before / after, already formatted for a person. */
  from: string;
  to: string;
}

export interface ConfirmHighRiskProps {
  changes: readonly HighRiskChange[];
  title?: ReactNode;
  description?: ReactNode;
  /** Send the save with `reason`. Reject to keep the dialog open with the failure. */
  onConfirm: (reason: string) => unknown;
  /** Cancel, Escape, the backdrop — and the dialog's own close after a success. */
  onClose: () => void;
}

const tooLong = maxLength(HIGH_RISK_REASON_MAX);

export function ConfirmHighRisk({
  changes,
  title,
  description,
  onConfirm,
  onClose,
}: ConfirmHighRiskProps): ReactElement {
  const t = useTranslate();
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);

  const problem = reason.trim() === '' ? t('ui.highRisk.reasonRequired') : tooLong(reason);
  const shown = touched ? problem : null;

  async function confirm(): Promise<void> {
    setTouched(true);
    if (problem !== null || pending) return;
    setPending(true);
    setFailure(null);
    try {
      await onConfirm(reason.trim());
    } catch (error) {
      setFailure(error);
      setPending(false);
      return;
    }
    onClose();
  }

  return (
    <Modal
      onClose={pending ? noop : onClose}
      title={title ?? t('ui.highRisk.title')}
      description={description ?? t('ui.highRisk.description')}
      className="w-full max-w-lg rounded-lg border border-border bg-surface p-5 shadow-md outline-none"
    >
      <div data-testid="high-risk-diff" className="mb-4">
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-content-tertiary">
          {t('ui.highRisk.changes')}
        </h3>
        <ul className="flex flex-col gap-2">
          {changes.map((change) => (
            <li key={change.key} className="rounded-md border border-border p-2 text-sm">
              <p className="font-medium">{change.label}</p>
              <p className="text-xs text-content-secondary">
                <span className="text-content-tertiary">{t('ui.highRisk.before')}: </span>
                <span data-testid={`high-risk-from-${change.key}`}>
                  {change.from || t('ui.highRisk.empty')}
                </span>
              </p>
              <p className="text-xs">
                <span className="text-content-tertiary">{t('ui.highRisk.after')}: </span>
                <span data-testid={`high-risk-to-${change.key}`}>
                  {change.to || t('ui.highRisk.empty')}
                </span>
              </p>
            </li>
          ))}
        </ul>
      </div>

      <label htmlFor={reasonId} className="mb-1 block text-sm font-medium">
        {t('ui.highRisk.reason')}
      </label>
      <textarea
        id={reasonId}
        autoFocus
        rows={3}
        required
        aria-invalid={shown ? true : undefined}
        aria-describedby={`${reasonId}-hint`}
        value={reason}
        disabled={pending}
        onChange={(event) => setReason(event.target.value)}
        onBlur={() => setTouched(true)}
        className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
      />
      <p id={`${reasonId}-hint`} className="mt-1 text-xs text-content-tertiary">
        {t('ui.highRisk.reasonHint')}
      </p>
      <FieldError message={shown} />

      {failure !== null && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {t('ui.save.failed')} {t(errorMessageKey(failure))}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
        >
          {t('ui.confirm.cancel')}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void confirm()}
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {pending ? t('ui.save.saving') : t('ui.highRisk.confirm')}
        </button>
      </div>
    </Modal>
  );
}

function noop(): void {
  // Intentionally empty: a dismissal while the save is in flight does nothing.
}
