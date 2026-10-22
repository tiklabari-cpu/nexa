/**
 * SettingsForm — the one shape of a Settings section that writes on Save
 * (tm 323.1 · GV-06).
 *
 * It owns the three things every such section used to re-derive (or skip):
 *
 * - the **draft**, compared with the saved values, so "dirty" is a fact
 *   (`useSettingsDraft`);
 * - the **SaveBar**, so Save / Discard / "Unsaved changes" look and behave the
 *   same on every screen, and Save is off when the draft is clean, invalid, or
 *   already on its way;
 * - the **leave guard**, so walking to another section (the settings nav asks
 *   `confirmLeave`), another module, or closing the tab with a dirty draft asks
 *   first. Mid-save it stays quiet: the work is already with the server.
 *
 * A high-risk section passes `highRisk`: Save then opens `ConfirmHighRisk` with
 * the before/after of each changed field and a required reason, and `onSave`
 * receives that reason as `extra.reason` to put in the request body.
 *
 * The screen renders its fields from the render-prop state and never touches
 * Save itself:
 *
 *   <SettingsForm saved={saved} onSave={(values) => api.put(url, values)}>
 *     {({ values, setValue }) => <input value={values.name} onChange={…} />}
 *   </SettingsForm>
 */
import { useState, type ReactElement, type ReactNode } from 'react';
import { shouldWarnOnLeave, useLeaveGuard } from '../../lib/dirty-guard.js';
import { useTranslate } from '../../lib/i18n.js';
import { useSettingsDraft, type SettingsDraft } from '../../lib/settings-draft.js';
import { ConfirmHighRisk, type HighRiskChange } from './ConfirmHighRisk.js';
import { SaveBar } from './SaveBar.js';

export interface SaveExtra {
  /** The reason typed into `ConfirmHighRisk`; absent for an ordinary section. */
  reason?: string;
}

export interface HighRiskOptions<V extends object> {
  /** A translated name per field; a changed field without one is not listed. */
  labels: Partial<Record<keyof V, string>>;
  /** How a value reads in the before/after list; defaults to a plain rendering. */
  format?: (key: keyof V, value: unknown) => string;
}

export interface SettingsFormProps<V extends object> {
  /** The values the server holds right now. */
  saved: V;
  /** Write the values. Reject to refuse — the draft is kept and the bar says so. */
  onSave: (values: V, extra: SaveExtra) => unknown;
  /** The draft may be saved. Defaults to always; Save stays off while it is false. */
  isValid?: (values: V) => boolean;
  highRisk?: HighRiskOptions<V>;
  /** Accessible name of the `<form>`. */
  label?: string;
  className?: string;
  children: (form: SettingsDraft<V, SaveExtra>) => ReactNode;
}

function plain(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function SettingsForm<V extends object>({
  saved,
  onSave,
  isValid,
  highRisk,
  label,
  className,
  children,
}: SettingsFormProps<V>): ReactElement {
  const t = useTranslate();
  const draft = useSettingsDraft<V, SaveExtra>({ saved, onSave });
  const [confirming, setConfirming] = useState(false);

  useLeaveGuard(shouldWarnOnLeave(draft.dirty, draft.saving), t('ui.save.leaveMessage'));

  const valid = isValid ? isValid(draft.values) : true;

  function requestSave(): void {
    if (!draft.dirty || !valid || draft.saving) return;
    if (highRisk) setConfirming(true);
    else void draft.save({});
  }

  const changes: HighRiskChange[] = highRisk
    ? draft.changed.flatMap((key) => {
        const name = highRisk.labels[key];
        if (name === undefined) return [];
        const format = highRisk.format ?? ((_: keyof V, value: unknown) => plain(value));
        return [
          {
            key: String(key),
            label: name,
            from: format(key, draft.baseline[key]),
            to: format(key, draft.values[key]),
          },
        ];
      })
    : [];

  return (
    <form
      aria-label={label}
      noValidate
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        requestSave();
      }}
    >
      {children(draft)}
      <SaveBar
        submit
        dirty={draft.dirty}
        saving={draft.saving}
        valid={valid}
        // The dialog shows a refusal itself while it is open.
        error={confirming ? null : draft.error}
        onDiscard={draft.discard}
      />
      {confirming && highRisk && (
        <ConfirmHighRisk
          changes={changes}
          onClose={() => setConfirming(false)}
          onConfirm={async (reason) => {
            // `save` reports a refusal rather than throwing; the dialog needs it
            // thrown to stay open and show the failure.
            const result = await draft.save({ reason });
            if (!result.ok) throw result.error;
          }}
        />
      )}
    </form>
  );
}
