/**
 * Settings (tm 389.13 · FR-ADMIN-15/16): what the root panel decides for the whole deployment —
 * the sign-up switch and the trial length, the announcement every panel user sees, maintenance
 * mode — and, below, the tenant API's configuration as it actually runs.
 *
 * Every save is a reasoned one (`SettingsForm` with `highRisk`: before/after and a reason, which
 * lands in the platform audit chain); maintenance mode also wants a fresh authenticator code
 * (`ReasonDialog`). A role without `settings.manage` sees the same screen with every field
 * disabled — the server refuses its writes either way.
 */
import { ANNOUNCEMENT_LEVELS, type AnnouncementLevel } from '@siyahtus/types';
import type { ReactElement } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { Card, Page } from '../../components/Page.js';
import { SettingsForm } from '../../components/settings/SettingsForm.js';
import { cn } from '../../components/ui/index.js';
import { hasPermission, useAuth } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { PlatformDeploymentSettings } from '../../lib/platform-types.js';
import { FIELD_CLASS, Loading } from '../workspaces/ui.js';
import { EffectiveConfigSection } from './EffectiveConfigSection.js';
import { MaintenanceSection } from './MaintenanceSection.js';
import { useDeploymentSettings, usePatchSettings } from './queries.js';

export const TRIAL_DAYS_MAX = 365;

export function SettingsPage(): ReactElement {
  const t = useTranslate();
  const me = useAuth((s) => s.me);
  const canManage = hasPermission(me, 'settings.manage');
  const query = useDeploymentSettings();

  return (
    <Page title={t('nav.settings')} description={t('shell.pages.settings.description')}>
      {query.isError ? (
        <Card>
          <LoadError
            title={t('settings.loadError')}
            error={query.error}
            onRetry={() => void query.refetch()}
          />
        </Card>
      ) : query.isPending ? (
        <Card>
          <Loading label={t('settings.loading')} />
        </Card>
      ) : (
        <>
          {query.data.updated_at && (
            <p className="-mb-3 text-xs text-content-secondary">
              {t('settings.updatedAt', { date: formatDate(query.data.updated_at) ?? '—' })}
            </p>
          )}
          <GeneralSection settings={query.data} canManage={canManage} />
          <AnnouncementSection settings={query.data} canManage={canManage} />
          <MaintenanceSection settings={query.data} canManage={canManage} />
        </>
      )}
      <EffectiveConfigSection />
    </Page>
  );
}

// --- Sign-up and trial ---------------------------------------------------------------------

type SignupChoice = 'env' | 'open' | 'closed';

interface GeneralValues {
  signup: SignupChoice;
  /** Empty: the environment's `TRIAL_DAYS`. */
  trialDays: string;
}

function signupChoice(value: boolean | null): SignupChoice {
  return value === null ? 'env' : value ? 'open' : 'closed';
}

function trialDaysValid(value: string): boolean {
  if (value.trim() === '') return true;
  const days = Number(value);
  return Number.isInteger(days) && days >= 1 && days <= TRIAL_DAYS_MAX;
}

function GeneralSection({
  settings,
  canManage,
}: {
  settings: PlatformDeploymentSettings;
  canManage: boolean;
}): ReactElement {
  const t = useTranslate();
  const patch = usePatchSettings();
  const saved: GeneralValues = {
    signup: signupChoice(settings.signup_enabled),
    trialDays: settings.trial_days === null ? '' : String(settings.trial_days),
  };
  const signupLabel = (choice: SignupChoice) => t(`settings.general.signup.${choice}`);

  return (
    <Card>
      <SettingsForm<GeneralValues>
        saved={saved}
        label={t('settings.general.title')}
        isValid={(values) => trialDaysValid(values.trialDays)}
        highRisk={{
          labels: {
            signup: t('settings.general.signup'),
            trialDays: t('settings.general.trialDays'),
          },
          format: (key, value) =>
            key === 'signup'
              ? signupLabel(value as SignupChoice)
              : value === ''
                ? t('settings.general.trialDays.env')
                : String(value),
        }}
        onSave={(values, extra) =>
          patch.mutateAsync({
            reason: extra.reason ?? '',
            signup_enabled: values.signup === 'env' ? null : values.signup === 'open',
            trial_days: values.trialDays.trim() === '' ? null : Number(values.trialDays),
          })
        }
        className="flex flex-col gap-4 p-4"
      >
        {({ values, setValue }) => (
          <fieldset disabled={!canManage} className="flex flex-col gap-4">
            <legend className="text-sm font-semibold">{t('settings.general.title')}</legend>
            <div>
              <label htmlFor="settings-signup" className="text-sm font-medium">
                {t('settings.general.signup')}
              </label>
              <select
                id="settings-signup"
                value={values.signup}
                onChange={(event) => setValue('signup', event.target.value as SignupChoice)}
                aria-describedby="settings-signup-hint"
                className={cn(FIELD_CLASS, 'max-w-sm')}
              >
                {(['env', 'open', 'closed'] as const).map((choice) => (
                  <option key={choice} value={choice}>
                    {signupLabel(choice)}
                  </option>
                ))}
              </select>
              <p id="settings-signup-hint" className="mt-1 text-xs text-content-secondary">
                {t('settings.general.signup.hint')}
              </p>
            </div>
            <div>
              <label htmlFor="settings-trial" className="text-sm font-medium">
                {t('settings.general.trialDays')}
              </label>
              <input
                id="settings-trial"
                type="number"
                inputMode="numeric"
                min={1}
                max={TRIAL_DAYS_MAX}
                value={values.trialDays}
                onChange={(event) => setValue('trialDays', event.target.value)}
                aria-invalid={trialDaysValid(values.trialDays) ? undefined : 'true'}
                aria-describedby="settings-trial-hint"
                className={cn(FIELD_CLASS, 'max-w-[10rem]')}
              />
              <p id="settings-trial-hint" className="mt-1 text-xs text-content-secondary">
                {t('settings.general.trialDays.hint', { max: TRIAL_DAYS_MAX })}
              </p>
            </div>
          </fieldset>
        )}
      </SettingsForm>
    </Card>
  );
}

// --- Announcement --------------------------------------------------------------------------

interface AnnouncementValues {
  enabled: boolean;
  level: AnnouncementLevel;
  en: string;
  tr: string;
  /** `datetime-local`, the operator's own clock; empty: no end. */
  until: string;
}

/** An ISO instant as the operator's local `datetime-local` value. */
export function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value as an ISO instant, or null when empty or unreadable. */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

const LEVEL_CLASS: Record<AnnouncementLevel, string> = {
  info: 'border-info/30 bg-info/10',
  warning: 'border-warning/30 bg-warning/10',
  critical: 'border-danger/30 bg-danger/10',
};

function announcementValid(values: AnnouncementValues): boolean {
  if (!values.enabled) return true;
  if (values.en.trim() === '' || values.tr.trim() === '') return false;
  return values.until.trim() === '' || fromLocalInput(values.until) !== null;
}

function AnnouncementSection({
  settings,
  canManage,
}: {
  settings: PlatformDeploymentSettings;
  canManage: boolean;
}): ReactElement {
  const t = useTranslate();
  const patch = usePatchSettings();
  const current = settings.announcement;
  const saved: AnnouncementValues = {
    enabled: current !== null,
    level: current?.level ?? 'info',
    en: current?.en ?? '',
    tr: current?.tr ?? '',
    until: toLocalInput(current?.until ?? null),
  };
  const expired =
    current?.until !== null &&
    current?.until !== undefined &&
    Date.parse(current.until) <= Date.now();

  return (
    <Card>
      <SettingsForm<AnnouncementValues>
        saved={saved}
        label={t('settings.announcement.title')}
        isValid={announcementValid}
        highRisk={{
          labels: {
            enabled: t('settings.announcement.enabled'),
            level: t('settings.announcement.level'),
            en: t('settings.announcement.en'),
            tr: t('settings.announcement.tr'),
            until: t('settings.announcement.until'),
          },
          format: (key, value) =>
            key === 'enabled'
              ? t(value ? 'settings.on' : 'settings.off')
              : key === 'level'
                ? t(`settings.announcement.level.${String(value)}`)
                : String(value ?? ''),
        }}
        onSave={(values, extra) =>
          patch.mutateAsync({
            reason: extra.reason ?? '',
            announcement: values.enabled
              ? {
                  level: values.level,
                  en: values.en.trim(),
                  tr: values.tr.trim(),
                  until: fromLocalInput(values.until),
                }
              : null,
          })
        }
        className="flex flex-col gap-4 p-4"
      >
        {({ values, setValue }) => (
          <fieldset disabled={!canManage} className="flex flex-col gap-4">
            <legend className="text-sm font-semibold">{t('settings.announcement.title')}</legend>
            <p className="text-xs text-content-secondary">{t('settings.announcement.hint')}</p>
            {expired && (
              <p role="status" className="text-xs text-warning">
                {t('settings.announcement.expired')}
              </p>
            )}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={values.enabled}
                onChange={(event) => setValue('enabled', event.target.checked)}
              />
              {t('settings.announcement.enabled')}
            </label>
            {values.enabled && (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="settings-ann-level" className="text-sm font-medium">
                      {t('settings.announcement.level')}
                    </label>
                    <select
                      id="settings-ann-level"
                      value={values.level}
                      onChange={(event) =>
                        setValue('level', event.target.value as AnnouncementLevel)
                      }
                      className={FIELD_CLASS}
                    >
                      {ANNOUNCEMENT_LEVELS.map((level) => (
                        <option key={level} value={level}>
                          {t(`settings.announcement.level.${level}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="settings-ann-until" className="text-sm font-medium">
                      {t('settings.announcement.until')}
                    </label>
                    <input
                      id="settings-ann-until"
                      type="datetime-local"
                      value={values.until}
                      onChange={(event) => setValue('until', event.target.value)}
                      aria-describedby="settings-ann-until-hint"
                      className={FIELD_CLASS}
                    />
                    <p id="settings-ann-until-hint" className="mt-1 text-xs text-content-secondary">
                      {t('settings.announcement.until.hint')}
                    </p>
                  </div>
                </div>
                {(['en', 'tr'] as const).map((locale) => (
                  <div key={locale}>
                    <label htmlFor={`settings-ann-${locale}`} className="text-sm font-medium">
                      {t(`settings.announcement.${locale}`)}
                    </label>
                    <textarea
                      id={`settings-ann-${locale}`}
                      rows={2}
                      maxLength={500}
                      value={values[locale]}
                      onChange={(event) => setValue(locale, event.target.value)}
                      aria-invalid={values[locale].trim() === '' ? 'true' : undefined}
                      className={FIELD_CLASS}
                    />
                  </div>
                ))}
                <section aria-labelledby="settings-ann-preview">
                  <p
                    id="settings-ann-preview"
                    className="text-xs font-medium text-content-secondary"
                  >
                    {t('settings.announcement.preview')}
                  </p>
                  <div className="mt-1 flex flex-col gap-1">
                    {(['en', 'tr'] as const).map((locale) => (
                      <p
                        key={locale}
                        data-testid={`announcement-preview-${locale}`}
                        className={cn(
                          'rounded-md border px-3 py-1.5 text-center text-xs',
                          LEVEL_CLASS[values.level],
                        )}
                      >
                        <span className="mr-2 font-semibold uppercase">{locale}</span>
                        {values[locale].trim() || t('settings.announcement.preview.empty')}
                      </p>
                    ))}
                  </div>
                </section>
              </>
            )}
          </fieldset>
        )}
      </SettingsForm>
    </Card>
  );
}
