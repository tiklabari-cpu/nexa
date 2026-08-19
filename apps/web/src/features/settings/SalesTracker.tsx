/**
 * Sales tracker settings (FR-MOD-13.5) — enabled / currency / attribution
 * window. What is configured here decides two other surfaces: the widget's
 * `nexa('trackSale', …)` snippet (13.5-g) refuses to record anything while
 * `enabled` is false (13.5-c), and the Reports → Reviews Ecommerce block
 * (13.5-d) sums tracked sales under this `currency`. A save here is the
 * on-ramp for both, so a saved change points at where its effect shows up.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  SALES_TRACKER_ATTRIBUTION_WINDOW_MAX_DAYS,
  SALES_TRACKER_ATTRIBUTION_WINDOW_MIN_DAYS,
  SALES_TRACKER_CURRENCIES,
  type SalesTrackerConfig,
  type SalesTrackerCurrency,
} from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, useForm, type Validator } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface SalesTrackerSettings extends SalesTrackerConfig {
  updated_at: string | null;
}

type FormValues = Record<'enabled' | 'currency' | 'attribution_window_days', string>;

/**
 * A whole number of days in the server's accepted range. Not `required()`: an
 * emptied field already fails the range check, so a second, redundant message
 * would never show — one validator, one message.
 */
function attributionWindow(t: TFunction): Validator {
  return (value) => {
    const days = Number(value);
    return Number.isInteger(days) &&
      days >= SALES_TRACKER_ATTRIBUTION_WINDOW_MIN_DAYS &&
      days <= SALES_TRACKER_ATTRIBUTION_WINDOW_MAX_DAYS
      ? null
      : t('settings.salesTracker.attributionWindowError', {
          min: SALES_TRACKER_ATTRIBUTION_WINDOW_MIN_DAYS,
          max: SALES_TRACKER_ATTRIBUTION_WINDOW_MAX_DAYS,
        });
  };
}

export function SalesTracker({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', 'sales-tracker'],
    queryFn: () => api.get<SalesTrackerSettings>('/settings/sales-tracker'),
  });

  if (settings.error) return <ErrorNotice message={t('settings.salesTracker.loadError')} />;

  return (
    <Section
      id="section-sales-tracker"
      title={t('settings.salesTracker.title')}
      description={t('settings.salesTracker.description')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <SalesTrackerForm
            config={settings.data}
            canEdit={canEdit}
            onSaved={(data) => queryClient.setQueryData(['settings', 'sales-tracker'], data)}
          />
        )}
      </Card>
    </Section>
  );
}

/**
 * Mounted only once the server's configuration has loaded, so `useForm`'s
 * `initial` is the real saved values on the very first render rather than the
 * shipped defaults racing an in-flight fetch (T4-a's `useForm` seeds its
 * state once, at mount, and does not resync when a prop changes later).
 */
function SalesTrackerForm({
  config,
  canEdit,
  onSaved,
}: {
  config: SalesTrackerConfig;
  canEdit: boolean;
  onSaved: (data: SalesTrackerSettings) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const save = useMutation({
    mutationFn: (body: SalesTrackerConfig) =>
      api.put<SalesTrackerSettings>('/settings/sales-tracker', body),
    onSuccess: onSaved,
  });

  const form = useForm<FormValues>({
    initial: {
      enabled: String(config.enabled),
      currency: config.currency,
      attribution_window_days: String(config.attribution_window_days),
    },
    validators: {
      attribution_window_days: attributionWindow(t),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await save.mutateAsync({
          enabled: values.enabled === 'true',
          currency: values.currency as SalesTrackerCurrency,
          attribution_window_days: Number(values.attribution_window_days),
        });
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  const windowError = form.errorFor('attribution_window_days');
  // Only while the current values are exactly what the last successful save
  // wrote — editing again (isDirty) or a fresh mutation both clear it, so the
  // note never lingers over an unrelated later change.
  const justSaved = save.isSuccess && !form.isDirty;

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5 p-4">
      <fieldset disabled={!canEdit} className="flex flex-col gap-5 border-0 p-0">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.values.enabled === 'true'}
            onChange={(event) => form.setValue('enabled', String(event.target.checked))}
          />
          <span className="text-sm">
            {t('settings.salesTracker.trackLabel')}
            <span className="block text-2xs text-content-tertiary">
              {t('settings.salesTracker.trackHint')}
            </span>
          </span>
        </label>

        <div className="flex w-40 flex-col gap-1">
          <label
            htmlFor="sales-tracker-currency"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.salesTracker.currencyLabel')}
          </label>
          <select
            id="sales-tracker-currency"
            value={form.values.currency}
            onChange={(event) => form.setValue('currency', event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          >
            {SALES_TRACKER_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <span className="text-2xs text-content-tertiary">
            {t('settings.salesTracker.currencyHint')}
          </span>
        </div>

        <div className="flex w-48 flex-col gap-1">
          <label
            htmlFor="sales-tracker-window"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('settings.salesTracker.windowLabel')}
          </label>
          <input
            id="sales-tracker-window"
            type="number"
            min={SALES_TRACKER_ATTRIBUTION_WINDOW_MIN_DAYS}
            max={SALES_TRACKER_ATTRIBUTION_WINDOW_MAX_DAYS}
            value={form.values.attribution_window_days}
            onChange={(event) => form.setValue('attribution_window_days', event.target.value)}
            onBlur={() => form.blur('attribution_window_days')}
            aria-invalid={windowError ? true : undefined}
            aria-describedby={windowError ? 'sales-tracker-window-error' : undefined}
            className="w-24 rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
          <FieldError id="sales-tracker-window-error" message={windowError} />
          <span className="text-2xs text-content-tertiary">
            {t('settings.salesTracker.windowHint')}
          </span>
        </div>
      </fieldset>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!form.canSubmit || !form.isDirty}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {form.isSubmitting ? t('settings.saving') : t('settings.save')}
          </button>

          {form.submitError && (
            <p role="alert" className="text-2xs text-danger">
              {form.submitError}
            </p>
          )}

          {justSaved && (
            <p className="text-2xs text-content-tertiary">
              {t('settings.salesTracker.savedNotePrefix')}{' '}
              <Link to="/app/reports" className="text-content-brand hover:underline">
                {t('settings.salesTracker.savedNoteLink')}
              </Link>
              {t('settings.salesTracker.savedNoteSuffix')}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
