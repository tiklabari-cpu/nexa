/**
 * SaveBar — the sticky Save / Discard strip of a Settings form (tm 323.1 · GV-06).
 *
 * One bar for every "write on Save" section, so the answer to "did my change
 * stick?" is always in the same place and says the same thing. It is rendered
 * even when nothing is dirty (it then reads "All changes saved" with both
 * buttons off) — the pattern test looks for it, and a bar that appears only
 * after the first keystroke would move the layout under the person's cursor.
 *
 * Save is off when there is nothing to save, when the draft does not validate,
 * and while a save is in flight; Discard is off when there is nothing to
 * discard or the save is mid-flight (the values are already on their way).
 */
import type { ReactElement } from 'react';
import { errorMessageKey } from '../../lib/api-client.js';
import { useTranslate } from '../../lib/i18n.js';

export interface SaveBarProps {
  dirty: boolean;
  saving: boolean;
  /** The draft passes validation; Save stays off while it does not. */
  valid?: boolean;
  /**
   * The last save's rejection. The draft is kept; the bar says so. A string is a
   * message the screen already translated (`useForm`'s `submitError`).
   */
  error?: unknown;
  /** Inside a `<form>`: Save is the form's submit button, so Enter submits too. */
  submit?: boolean;
  onSave?: () => void;
  onDiscard: () => void;
}

export function SaveBar({
  dirty,
  saving,
  valid = true,
  error = null,
  submit = false,
  onSave,
  onDiscard,
}: SaveBarProps): ReactElement {
  const t = useTranslate();
  const failed = error !== null && error !== undefined;

  return (
    <div
      data-save-pattern="form"
      data-dirty={dirty ? 'true' : 'false'}
      className="sticky bottom-0 z-10 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-surface px-4 py-3"
    >
      <div className="min-w-0 flex-1 text-sm">
        {failed ? (
          <p role="alert" className="text-danger">
            {t('ui.save.failed')} {typeof error === 'string' ? error : t(errorMessageKey(error))}
          </p>
        ) : (
          <p role="status" className={dirty ? 'font-medium text-content' : 'text-content-tertiary'}>
            {dirty ? t('ui.save.unsaved') : t('ui.save.clean')}
          </p>
        )}
      </div>
      <button
        type="button"
        disabled={!dirty || saving}
        onClick={onDiscard}
        className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {t('ui.save.discard')}
      </button>
      <button
        type={submit ? 'submit' : 'button'}
        disabled={!dirty || !valid || saving}
        onClick={submit ? undefined : onSave}
        className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? t('ui.save.saving') : t('ui.save.save')}
      </button>
    </div>
  );
}
