/**
 * Maintenance mode (tm 389.13 · FR-ADMIN-15). Turning it on, changing it and turning it off
 * each go through `ReasonDialog` with a fresh authenticator code: `full` takes every workspace
 * offline at once, and the realtime gateway closes its sockets.
 */
import { MAINTENANCE_MODES, type MaintenanceMode } from '@siyahtus/types';
import { useState, type ReactElement } from 'react';
import { Card } from '../../components/Page.js';
import { ReasonDialog } from '../../components/ReasonDialog.js';
import { Banner } from '../../components/ui/index.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformDeploymentSettings } from '../../lib/platform-types.js';
import { FIELD_CLASS, PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from '../workspaces/ui.js';
import { useSetMaintenance } from './queries.js';

type Dialog = 'on' | 'off' | null;

export function MaintenanceSection({
  settings,
  canManage,
}: {
  settings: PlatformDeploymentSettings;
  canManage: boolean;
}): ReactElement {
  const t = useTranslate();
  const setMaintenance = useSetMaintenance();
  const current = settings.maintenance;
  const on = current?.enabled === true;
  const [dialog, setDialog] = useState<Dialog>(null);
  const [mode, setMode] = useState<MaintenanceMode>(current?.mode ?? 'read_only');
  const [en, setEn] = useState(current?.message?.en ?? '');
  const [tr, setTr] = useState(current?.message?.tr ?? '');

  // A message is both languages or neither.
  const messageComplete = (en.trim() === '') === (tr.trim() === '');

  function open(next: Dialog): void {
    setMode(current?.mode ?? 'read_only');
    setEn(current?.message?.en ?? '');
    setTr(current?.message?.tr ?? '');
    setDialog(next);
  }

  return (
    <Card>
      <section aria-labelledby="settings-maintenance-title" className="flex flex-col gap-3 p-4">
        <h2 id="settings-maintenance-title" className="text-sm font-semibold">
          {t('settings.maintenance.title')}
        </h2>
        {on ? (
          <Banner tone={current.mode === 'full' ? 'danger' : 'warning'}>
            {t(`settings.maintenance.state.${current.mode}`)}
          </Banner>
        ) : (
          <p className="text-sm text-content-secondary">{t('settings.maintenance.state.off')}</p>
        )}
        <p className="text-xs text-content-secondary">{t('settings.maintenance.hint')}</p>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={() => open('on')}>
              {on ? t('settings.maintenance.change') : t('settings.maintenance.turnOn')}
            </button>
            {on && (
              <button type="button" className={SECONDARY_BUTTON_CLASS} onClick={() => open('off')}>
                {t('settings.maintenance.turnOff')}
              </button>
            )}
          </div>
        )}
      </section>

      {dialog === 'on' && (
        <ReasonDialog
          title={on ? t('settings.maintenance.change') : t('settings.maintenance.turnOn')}
          description={t(`settings.maintenance.consequence.${mode}`)}
          requireTotp
          confirmDisabled={!messageComplete}
          extraDirty={en !== '' || tr !== ''}
          onConfirm={({ reason }) =>
            setMaintenance.mutateAsync({
              reason,
              enabled: true,
              mode,
              message: en.trim() === '' ? null : { en: en.trim(), tr: tr.trim() },
            })
          }
          onDone={() => setDialog(null)}
          onCancel={() => setDialog(null)}
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">{t('settings.maintenance.mode')}</legend>
            {MAINTENANCE_MODES.map((value) => (
              <label key={value} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="settings-maintenance-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  className="mt-1"
                />
                {t(`settings.maintenance.mode.${value}`)}
              </label>
            ))}
          </fieldset>
          <p className="text-xs text-content-secondary">{t('settings.maintenance.message.hint')}</p>
          {(
            [
              ['en', en, setEn],
              ['tr', tr, setTr],
            ] as const
          ).map(([locale, value, set]) => (
            <div key={locale}>
              <label htmlFor={`settings-maintenance-${locale}`} className="text-sm font-medium">
                {t(`settings.maintenance.message.${locale}`)}
              </label>
              <textarea
                id={`settings-maintenance-${locale}`}
                rows={2}
                maxLength={500}
                value={value}
                onChange={(event) => set(event.target.value)}
                className={FIELD_CLASS}
              />
            </div>
          ))}
          {!messageComplete && (
            <p role="alert" className="text-xs text-danger">
              {t('settings.maintenance.message.bothLanguages')}
            </p>
          )}
        </ReasonDialog>
      )}

      {dialog === 'off' && current && (
        <ReasonDialog
          title={t('settings.maintenance.turnOff')}
          description={t('settings.maintenance.consequence.off')}
          requireTotp
          onConfirm={({ reason }) =>
            setMaintenance.mutateAsync({
              reason,
              enabled: false,
              mode: current.mode,
              message: current.message,
            })
          }
          onDone={() => setDialog(null)}
          onCancel={() => setDialog(null)}
        />
      )}
    </Card>
  );
}
