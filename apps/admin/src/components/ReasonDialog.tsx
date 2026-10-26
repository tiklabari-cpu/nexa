/**
 * ReasonDialog — the one "say why" every platform mutation goes through (tm 389.6 ·
 * FR-ADMIN-02/20).
 *
 * Every operator mutation carries a `{reason}` (3–500 characters) that lands in the platform
 * audit chain, and the destructive ones also want a code from the authenticator no older than
 * five minutes (`x-platform-recent-totp`). The pages built after this one (workspace
 * suspension, deletion, forced ownership transfer, …) all open this dialog instead of each
 * inventing a textarea:
 *
 * - the caller supplies the words (`title`, `description`) and the request (`onConfirm`
 *   receives the trimmed reason);
 * - `requireTotp` asks for the code up front, and the dialog renews the session's "recent code"
 *   (`POST /auth/totp/reverify`) before `onConfirm` runs. Without it the field stays out of the
 *   way until the server asks — a 403 `platform_recent_totp_required` from `onConfirm` reveals
 *   the field and the operator confirms again, so an expired window costs one code, not a
 *   re-typed reason;
 * - a refusal stays inside the dialog (`role="alert"`, the error's own catalogue sentence) with
 *   the reason still in the box; Escape, the backdrop and Cancel are ignored while a request
 *   runs, and ask before throwing away a typed reason;
 * - an action that needs more than a reason (a number of days, a typed name, a checklist —
 *   tm 389.10) renders its fields as `children`, above the reason, and holds the confirm
 *   button with `confirmDisabled` until they are complete; `describeError` words a refusal
 *   more precisely than its type's catalogue sentence (a `details.reason`).
 */
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Modal } from './ui/Modal.js';
import { ApiClientError, errorMessageKey } from '../lib/api-client.js';
import { useAuth } from '../lib/auth-store.js';
import { useCloseGuard } from '../lib/dirty-guard.js';
import { FieldError, compose, maxLength, minLength, required, useForm } from '../lib/form.js';
import { useTranslate } from '../lib/i18n.js';

export const REASON_MIN_LENGTH = 3;
export const REASON_MAX_LENGTH = 500;

export interface ReasonDialogProps {
  title: ReactNode;
  /** What will happen, in a sentence — the consequence, not a restatement of the title. */
  description?: ReactNode;
  /** The confirm button's label; defaults to "Confirm". */
  confirmLabel?: string;
  /** Ask for a fresh authenticator code up front. */
  requireTotp?: boolean;
  /** Run the mutation. A rejection stays in the dialog; a resolution closes it via `onDone`. */
  onConfirm: (input: { reason: string }) => Promise<unknown>;
  /** The mutation succeeded. */
  onDone: () => void;
  onCancel: () => void;
  /** Fields the action needs besides the reason, shown above it. */
  children?: ReactNode;
  /** Hold the confirm button — the fields above are not complete yet. */
  confirmDisabled?: boolean;
  /** Whether the dialog's own fields changed (counts towards "discard?"). */
  extraDirty?: boolean;
  /** A sentence for a refusal more precise than its type's; null falls back to the type's. */
  describeError?: (error: unknown) => string | null;
}

export function ReasonDialog({
  title,
  description,
  confirmLabel,
  requireTotp = false,
  onConfirm,
  onDone,
  onCancel,
  children,
  confirmDisabled = false,
  extraDirty = false,
  describeError,
}: ReasonDialogProps): ReactElement {
  const t = useTranslate();
  const reverify = useAuth((s) => s.reverify);
  const [needsTotp, setNeedsTotp] = useState(requireTotp);
  const [failure, setFailure] = useState<string | null>(null);
  // Outside the form on purpose: the field can appear after a submit (see below), and a form
  // that has already been submitted would show "required" on it the moment it is revealed.
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const codeRef = useRef<HTMLInputElement>(null);

  const form = useForm({
    initial: { reason: '' },
    validators: {
      reason: compose(required(), minLength(REASON_MIN_LENGTH), maxLength(REASON_MAX_LENGTH)),
    },
    async onSubmit(values, { setSubmitError }) {
      setFailure(null);
      setSubmitError(null);
      setCodeError(null);
      if (needsTotp) {
        if (code.replace(/[\s-]/g, '').length < 6) {
          setCodeError(t('ui.form.minLength', { count: 6 }));
          codeRef.current?.focus();
          return;
        }
        try {
          await reverify(code);
        } catch (error) {
          if (error instanceof ApiClientError && error.status === 401) {
            setCodeError(t('shell.reason.totpInvalid'));
          } else {
            setFailure(t(errorMessageKey(error)));
          }
          return;
        }
      }
      try {
        await onConfirm({ reason: values.reason.trim() });
      } catch (error) {
        if (error instanceof ApiClientError && error.type === 'platform_recent_totp_required') {
          // The window closed between opening the dialog and confirming: ask for a code now.
          setNeedsTotp(true);
        }
        setFailure(describeError?.(error) ?? t(errorMessageKey(error)));
        return;
      }
      onDone();
    },
  });

  useEffect(() => {
    if (needsTotp && !requireTotp) codeRef.current?.focus();
  }, [needsTotp, requireTotp]);

  const requestClose = useCloseGuard({
    isDirty: form.isDirty || code !== '' || extraDirty,
    onClose: onCancel,
  });

  return (
    <Modal
      onClose={form.isSubmitting ? noop : requestClose}
      title={title}
      description={description}
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-4">
        {children}
        <div>
          <label htmlFor="reason-dialog-reason" className="text-sm font-medium">
            {t('shell.reason.label')}
          </label>
          <textarea
            id="reason-dialog-reason"
            autoFocus
            rows={3}
            maxLength={REASON_MAX_LENGTH}
            value={form.values.reason}
            onChange={(event) => form.setValue('reason', event.target.value)}
            onBlur={() => form.blur('reason')}
            aria-invalid={form.errorFor('reason') ? 'true' : undefined}
            aria-describedby="reason-dialog-reason-hint reason-dialog-reason-error"
            className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
          <p id="reason-dialog-reason-hint" className="mt-1 text-xs text-content-secondary">
            {t('shell.reason.hint')}
          </p>
          <FieldError id="reason-dialog-reason-error" message={form.errorFor('reason')} />
        </div>

        {needsTotp && (
          <div>
            <label htmlFor="reason-dialog-code" className="text-sm font-medium">
              {t('shell.reason.totpLabel')}
            </label>
            <input
              id="reason-dialog-code"
              ref={codeRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setCodeError(null);
              }}
              aria-invalid={codeError ? 'true' : undefined}
              aria-describedby="reason-dialog-code-hint reason-dialog-code-error"
              className="tabular mt-1 w-40 rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
            />
            <p id="reason-dialog-code-hint" className="mt-1 text-xs text-content-secondary">
              {t('shell.reason.totpHint')}
            </p>
            <FieldError id="reason-dialog-code-error" message={codeError} />
          </div>
        )}

        {(failure ?? form.submitError) && (
          <p role="alert" className="text-sm text-danger">
            {failure ?? form.submitError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={form.isSubmitting}
            onClick={requestClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {t('ui.confirm.cancel')}
          </button>
          <button
            type="submit"
            disabled={form.isSubmitting || confirmDisabled}
            className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
          >
            {form.isSubmitting
              ? t('ui.confirm.pending')
              : (confirmLabel ?? t('shell.reason.confirm'))}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function noop(): void {
  // Intentionally empty: a dismissal while the request runs does nothing.
}
