/**
 * The recovery sheet an activation just issued (tm 389.6 · FR-ADMIN-02).
 *
 * Ten single-use codes, shown this once. The shell is held back behind this page until the
 * operator says they have saved them — a sheet shown on a screen that could be navigated away
 * from is a sheet nobody got. "Continue" stays off until the box is ticked, and it drops the
 * codes from memory.
 */
import { useState, type ReactElement } from 'react';
import { useAuth } from '../../lib/auth-store.js';
import { useTranslate } from '../../lib/i18n.js';
import { downloadRecoveryCodes } from '../../lib/recovery-codes.js';
import { AuthLayout, PRIMARY_BUTTON_CLASS } from './AuthLayout.js';

export function RecoveryCodesPage(): ReactElement | null {
  const t = useTranslate();
  const codes = useAuth((s) => s.recoveryCodes);
  const acknowledge = useAuth((s) => s.acknowledgeRecoveryCodes);
  const [saved, setSaved] = useState(false);

  if (codes === null) return null;

  return (
    <AuthLayout title={t('auth.recovery.title')} description={t('auth.recovery.description')}>
      <div className="flex flex-col gap-4">
        <ul
          aria-label={t('auth.recovery.list')}
          className="tabular grid grid-cols-2 gap-x-4 gap-y-1 rounded-md bg-surface-2 px-4 py-3 font-mono text-sm"
        >
          {codes.map((code) => (
            <li key={code} className="select-all">
              {code}
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => downloadRecoveryCodes(codes)}
          className="self-start rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
        >
          {t('auth.recovery.download')}
        </button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
          />
          {t('auth.recovery.saved')}
        </label>
        <button
          type="button"
          disabled={!saved}
          onClick={acknowledge}
          className={PRIMARY_BUTTON_CLASS}
        >
          {t('auth.recovery.continue')}
        </button>
      </div>
    </AuthLayout>
  );
}
