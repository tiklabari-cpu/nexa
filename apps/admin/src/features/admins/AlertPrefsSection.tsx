/**
 * Alert preferences (tm 389.20 · FR-ADMIN-24): which operator alert mails the signed-in operator
 * gets — a trial ending, a payment request waiting, a workspace at its AI allowance, a red health
 * snapshot, a broken audit chain, a deletion tomorrow — and in which language they are written.
 *
 * It is the operator's own setting, so any role may change it and Save asks for no reason; the
 * server writes one reasonless entry to the platform chain. Until the first save a superadmin is
 * mailed every kind and the other roles none, which the page says.
 */
import { useMemo, type ReactElement } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card } from '../../components/Page.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { cn } from '../../components/ui/index.js';
import { LOCALES, LOCALE_NAMES, useTranslate, type Locale } from '../../lib/i18n.js';
import type { PlatformAlertKind, PlatformAlertPrefs } from '../../lib/platform-types.js';
import { FIELD_CLASS, Loading } from '../workspaces/ui.js';
import { useAlertPrefs, useSaveAlertPrefs } from './queries.js';

interface AlertValues {
  kinds: PlatformAlertKind[];
  locale: Locale;
}

export function AlertPrefsSection(): ReactElement {
  const t = useTranslate();
  const query = useAlertPrefs();

  return (
    <Card>
      {query.isError ? (
        <LoadError
          title={t('admins.alerts.loadError')}
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      ) : query.isPending ? (
        <Loading label={t('admins.alerts.loading')} />
      ) : (
        <AlertPrefsForm prefs={query.data} />
      )}
    </Card>
  );
}

function AlertPrefsForm({ prefs }: { prefs: PlatformAlertPrefs }): ReactElement {
  const t = useTranslate();
  const save = useSaveAlertPrefs();
  // Stable between renders: the draft treats a new `saved` as news from the server, and a stale
  // one arriving after the save has moved its baseline would undo the edit.
  const saved = useMemo<AlertValues>(
    () => ({ kinds: prefs.kinds, locale: prefs.locale }),
    [prefs.kinds, prefs.locale],
  );

  return (
    <SettingsForm<AlertValues>
      saved={saved}
      label={t('admins.alerts.title')}
      onSave={(values) => save.mutateAsync({ kinds: values.kinds, locale: values.locale })}
      className="flex flex-col gap-4 p-4"
    >
      {({ values, setValue }) => (
        <>
          <fieldset className="flex flex-col gap-3">
            <legend className="text-sm font-semibold">{t('admins.alerts.title')}</legend>
            <p className="text-xs text-content-secondary">
              {prefs.customized ? t('admins.alerts.hint') : t('admins.alerts.hint.default')}
            </p>
            {prefs.available.map((kind) => (
              <div key={kind} className="flex items-start gap-2">
                <input
                  id={`alert-kind-${kind}`}
                  type="checkbox"
                  checked={values.kinds.includes(kind)}
                  onChange={(event) =>
                    setValue(
                      'kinds',
                      prefs.available.filter((candidate) =>
                        candidate === kind
                          ? event.target.checked
                          : values.kinds.includes(candidate),
                      ),
                    )
                  }
                  aria-describedby={`alert-kind-${kind}-hint`}
                  className="mt-1"
                />
                <div>
                  <label htmlFor={`alert-kind-${kind}`} className="text-sm font-medium">
                    {t(`admins.alerts.kind.${kind}`)}
                  </label>
                  <p id={`alert-kind-${kind}-hint`} className="text-xs text-content-secondary">
                    {t(`admins.alerts.kind.${kind}.hint`)}
                  </p>
                </div>
              </div>
            ))}
          </fieldset>
          <div>
            <label htmlFor="alert-locale" className="text-sm font-medium">
              {t('admins.alerts.locale')}
            </label>
            <select
              id="alert-locale"
              value={values.locale}
              onChange={(event) => setValue('locale', event.target.value as Locale)}
              className={cn(FIELD_CLASS, 'max-w-xs')}
            >
              {LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {LOCALE_NAMES[locale]}
                </option>
              ))}
            </select>
          </div>
        </>
      )}
    </SettingsForm>
  );
}
