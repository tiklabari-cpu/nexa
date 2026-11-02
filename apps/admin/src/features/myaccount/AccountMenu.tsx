/**
 * "My account" (tm 391 · FR-ADMIN-02): the operator's own security — a new recovery sheet and
 * their live sessions. Open to every signed-in role (the server's `self` permission); it sits in
 * the strip beside the language and theme switchers, not in the side menu, because it is about
 * the person and not about the platform.
 */
import { useState, type ReactElement } from 'react';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { useTranslate } from '../../lib/i18n.js';
import { RegenerateRecoveryDialog } from './RegenerateRecoveryDialog.js';
import { SessionsDialog } from './SessionsDialog.js';

type Open = 'recovery' | 'sessions' | null;

export function AccountMenu(): ReactElement {
  const t = useTranslate();
  const [open, setOpen] = useState<Open>(null);

  return (
    <>
      <Dropdown
        label={t('shell.account.menu')}
        trigger={t('shell.account.menu')}
        triggerClassName="rounded border border-strip-text/50 px-2 py-0.5 text-xs font-medium text-strip-text hover:bg-strip-text/10"
        panelClassName="right-0 mt-1 w-56 p-1 text-content"
        className="relative"
      >
        {({ close }) => (
          <>
            {(['recovery', 'sessions'] as const).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  close();
                  setOpen(key);
                }}
                className="block w-full rounded px-3 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                {t(`shell.account.${key}.label`)}
              </button>
            ))}
          </>
        )}
      </Dropdown>
      {open === 'recovery' && <RegenerateRecoveryDialog onClose={() => setOpen(null)} />}
      {open === 'sessions' && <SessionsDialog onClose={() => setOpen(null)} />}
    </>
  );
}
