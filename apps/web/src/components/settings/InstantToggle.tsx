/**
 * InstantToggle — a switch that writes the moment it is flipped (tm 323.1 · GV-06).
 *
 * The only kind of Settings control allowed to skip Save, and only for a
 * person's *own* preference (their pinned navigation, their sound) — never for
 * anything that decides what someone else may see or do. That rule is what the
 * save pattern is for: a checkbox that silently grants access is a security
 * hole once roles carry permissions (RL-02).
 *
 * Because there is no Save button to hold the change back, the control makes up
 * for it three ways: it is drawn differently from a form field (a dashed pill
 * with "Saves instantly" beside it), it says "Saved" with an Undo once the
 * write lands, and a refused write puts the switch back and says so.
 */
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { useTranslate } from '../../lib/i18n.js';

/** How long "Saved · Undo" stays up before the control goes quiet. */
const SAVED_VISIBLE_MS = 8000;

export interface InstantToggleProps {
  label: ReactNode;
  checked: boolean;
  /** Write the new value. Reject to refuse it — the switch goes back. */
  onChange: (next: boolean) => unknown;
  description?: ReactNode;
  disabled?: boolean;
}

type Status = 'idle' | 'saving' | 'saved' | 'failed';

export function InstantToggle({
  label,
  checked,
  onChange,
  description,
  disabled = false,
}: InstantToggleProps): ReactElement {
  const t = useTranslate();
  const labelId = useId();
  const [value, setValue] = useState(checked);
  const [status, setStatus] = useState<Status>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const busy = useRef(false);

  // The server's answer wins whenever the prop moves (a refetch, another tab).
  useEffect(() => {
    setValue(checked);
  }, [checked]);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function write(next: boolean, undo: boolean): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    clearTimeout(timer.current);
    const before = value;
    setValue(next);
    setStatus('saving');
    try {
      await onChange(next);
    } catch {
      setValue(before);
      setStatus('failed');
      return;
    } finally {
      busy.current = false;
    }
    if (undo) {
      setStatus('idle');
      return;
    }
    setStatus('saved');
    timer.current = setTimeout(() => setStatus('idle'), SAVED_VISIBLE_MS);
  }

  return (
    <div
      data-save-pattern="instant"
      className="flex flex-wrap items-center gap-3 rounded-full border border-dashed border-border px-3 py-2"
    >
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-labelledby={labelId}
        disabled={disabled || status === 'saving'}
        onClick={() => void write(!value, false)}
        className={`relative h-5 w-9 shrink-0 rounded-full border transition-colors disabled:opacity-60 ${
          value ? 'border-brand-500 bg-brand-500' : 'border-border bg-inset'
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow transition-all ${
            value ? 'left-4' : 'left-0.5'
          }`}
        />
      </button>
      <span className="min-w-0 text-sm">
        <span id={labelId} className="font-medium">
          {label}
        </span>
        {description && <span className="block text-xs text-content-tertiary">{description}</span>}
      </span>
      <span className="text-2xs italic text-content-tertiary">{t('ui.instant.hint')}</span>
      <span role="status" aria-live="polite" className="flex items-center gap-2 text-xs">
        {status === 'saved' && (
          <>
            <span className="text-content-secondary">{t('ui.instant.saved')}</span>
            <button
              type="button"
              onClick={() => void write(!value, true)}
              className="text-content-brand underline-offset-2 hover:underline"
            >
              {t('ui.instant.undo')}
            </button>
          </>
        )}
      </span>
      {status === 'failed' && (
        <span role="alert" className="text-xs text-danger">
          {t('ui.instant.failed')}
        </span>
      )}
    </div>
  );
}
