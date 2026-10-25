/**
 * FormSaveBar — the SaveBar for a Settings form built on `useForm` (tm 323.2 · GV-06).
 *
 * `SettingsForm` owns its draft; most Settings sections already had one, in
 * `useForm`, with per-field validators and server-reported field errors that a
 * rewrite onto `SettingsForm` would only re-derive. This bar is the same
 * `SaveBar` bound to that draft instead, so the section looks and behaves like
 * every other "write on Save" section — the sticky bar, "Unsaved changes",
 * Save off while clean, invalid or mid-save, Discard back to the saved values —
 * and guards leaving the section (and closing the tab) while it is dirty.
 *
 * Render it inside the `<form onSubmit={form.handleSubmit}>`: Save is the
 * form's submit button. "Clean" is `useForm`'s own `isDirty`, a comparison with
 * the `initial` the section passes on this render — so a section whose
 * `initial` follows the saved values goes quiet after a save by itself.
 */
import type { ReactElement } from 'react';
import { shouldWarnOnLeave, useLeaveGuard } from '../../lib/dirty-guard.js';
import type { UseFormResult } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { SaveBar } from './SaveBar.js';

type FormState = Pick<
  UseFormResult<Record<string, string>>,
  'isDirty' | 'isSubmitting' | 'isValid' | 'submitError' | 'reset'
>;

export interface FormSaveBarProps {
  form: FormState;
  /**
   * Dirty state the form's string fields cannot see (a list held beside the
   * form). Ored with `form.isDirty`.
   */
  dirty?: boolean;
  /** Extra validity the form's validators cannot see. Anded with `form.isValid`. */
  valid?: boolean;
  /** The rejection to show; defaults to `form.submitError`. */
  error?: unknown;
  /** Discard — defaults to `form.reset`; pass one that also resets `dirty`'s state. */
  onDiscard?: () => void;
}

/**
 * Ask before leaving the section while `dirty`, and before closing the tab —
 * except mid-save, when the work is already on its way. The one guard a
 * Settings draft registers, whether it lives in a `SettingsForm`, a
 * `FormSaveBar` form, or a list section's own "add" / "edit" form.
 */
export function useSettingsLeaveGuard(dirty: boolean, saving = false): void {
  const t = useTranslate();
  useLeaveGuard(shouldWarnOnLeave(dirty, saving), t('ui.save.leaveMessage'));
}

export function FormSaveBar({
  form,
  dirty = false,
  valid = true,
  error,
  onDiscard,
}: FormSaveBarProps): ReactElement {
  const isDirty = form.isDirty || dirty;
  useSettingsLeaveGuard(isDirty, form.isSubmitting);
  return (
    <SaveBar
      submit
      dirty={isDirty}
      saving={form.isSubmitting}
      valid={form.isValid && valid}
      error={error === undefined ? form.submitError : error}
      onDiscard={onDiscard ?? form.reset}
    />
  );
}
