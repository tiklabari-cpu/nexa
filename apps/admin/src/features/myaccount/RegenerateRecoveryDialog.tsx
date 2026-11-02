/**
 * "Renew recovery codes" (tm 391 · FR-ADMIN-02): ten new single-use codes, and every earlier one
 * stops working. The server wants a code from the authenticator no older than five minutes, so
 * the dialog asks for one first. The new sheet is not shown here: it goes to the same one-time
 * page that follows enrolment (`RecoveryCodesPage`), which holds the panel back until the
 * operator says the codes are saved — a sheet on a dialog that can be dismissed is a sheet nobody
 * got.
 */
import { useState, type FormEvent, type ReactElement } from 'react';
import { Modal } from '../../components/ui/Modal.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { FIELD_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';

export function RegenerateRecoveryDialog({ onClose }: { onClose: () => void }): ReactElement {
  const t = useTranslate();
  const regenerate = useAuth((s) => s.regenerateRecoveryCodes);
  const remaining = useAuth((s) => s.me?.recovery_codes_remaining ?? null);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (code.replace(/[\s-]/g, '').length < 6) {
      setFailure(t('ui.form.minLength', { count: 6 }));
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      await regenerate(code);
      // The sheet page takes over the screen; this dialog goes with the shell.
    } catch (error) {
      setFailure(
        error instanceof ApiClientError && error.status === 401
          ? t('shell.reason.totpInvalid')
          : t(errorMessageKey(error)),
      );
      setPending(false);
    }
  };

  return (
    <Modal
      onClose={pending ? noop : onClose}
      // The strip's text colour is inherited otherwise (see `SessionsDialog`).
      className="text-content"
      title={t('shell.account.recovery.title')}
      description={t('shell.account.recovery.body')}
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        {remaining !== null && (
          <p className="text-sm text-content-secondary">
            {t('shell.account.recovery.remaining', { count: remaining })}
          </p>
        )}
        <div>
          <label htmlFor="recovery-code" className="text-sm font-medium">
            {t('shell.reason.totpLabel')}
          </label>
          <input
            id="recovery-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              setFailure(null);
            }}
            aria-invalid={failure ? 'true' : undefined}
            aria-describedby="recovery-code-hint"
            className={`${FIELD_CLASS} tabular w-40`}
          />
          <p id="recovery-code-hint" className="mt-1 text-xs text-content-secondary">
            {t('shell.reason.totpHint')}
          </p>
        </div>
        {failure && (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className={SECONDARY_BUTTON_CLASS}
          >
            {t('ui.confirm.cancel')}
          </button>
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON_CLASS}>
            {pending ? t('ui.confirm.pending') : t('shell.account.recovery.confirm')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function noop(): void {
  // Intentionally empty: a dismissal while the request runs does nothing.
}
