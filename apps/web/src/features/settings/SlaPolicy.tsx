/**
 * Settings → SLA: first-response and resolution targets (FR-MOD-11.5 · 11.5-e).
 *
 * A pure consumer of `GET|PUT /settings/sla` (`11.5-d`) — this screen opens no
 * new server surface. The read is open on every plan so a workspace can see
 * what it would be buying; the write is Enterprise-only (`sla` entitlement),
 * so a save can 403 on a workspace that has never upgraded. That 403 carries
 * `details.entitlement`/`details.plan` (the same shape every entitlement gate
 * uses), read here to show the upsell rather than a raw server message.
 *
 * `active` (not a second "entitled" flag) is what tells "not bought" apart
 * from "not set" — §C-A26: a downgrade keeps the saved numbers on the row but
 * stops honouring them, so a workspace can see its old targets and still know
 * they are not being measured right now. Misses against this screen's targets
 * show up as the "SLA breaches" card on Reports → Overview (11.5-e); nothing
 * here re-routes or re-prioritises a conversation (§C-A27).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { SLA_MAX_TARGET_MINUTES } from '@nexa/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, useForm, type Validator } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface SlaPolicyView {
  first_response_minutes: number | null;
  resolution_minutes: number | null;
  business_hours_only: boolean;
  /** Entitled *and* configured — see the module doc for why this is one flag. */
  active: boolean;
  updated_at: string | null;
}

type FormValues = Record<
  'first_response_minutes' | 'resolution_minutes' | 'business_hours_only',
  string
>;

/**
 * A target in minutes, or blank for "do not measure this clock" — both are
 * valid policies, so an empty field is not `required()`'s job to reject.
 */
function slaMinutes(t: TFunction): Validator {
  return (value) => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const minutes = Number(trimmed);
    return Number.isInteger(minutes) && minutes > 0 && minutes <= SLA_MAX_TARGET_MINUTES
      ? null
      : t('settings.sla.minutesError', { max: SLA_MAX_TARGET_MINUTES });
  };
}

export function SlaPolicy({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const settings = useQuery({
    queryKey: ['settings', 'sla'],
    queryFn: () => api.get<SlaPolicyView>('/settings/sla'),
  });

  if (settings.error) return <ErrorNotice message={t('settings.sla.loadError')} />;

  return (
    <Section
      id="section-sla"
      title={t('settings.sla.title')}
      description={t('settings.sla.description')}
    >
      <Card>
        {settings.isPending ? (
          <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
        ) : (
          <SlaPolicyForm
            policy={settings.data}
            canEdit={canEdit}
            onSaved={(data) => queryClient.setQueryData(['settings', 'sla'], data)}
          />
        )}
      </Card>
    </Section>
  );
}

/**
 * Mounted only once the server's configuration has loaded, so `useForm`'s
 * `initial` is the real saved values on the very first render (the same
 * `SalesTrackerForm` reasoning: `useForm` seeds its state once, at mount, and
 * does not resync when a prop changes later).
 */
function SlaPolicyForm({
  policy,
  canEdit,
  onSaved,
}: {
  policy: SlaPolicyView;
  canEdit: boolean;
  onSaved: (data: SlaPolicyView) => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();

  const save = useMutation({
    mutationFn: (body: {
      first_response_minutes: number | null;
      resolution_minutes: number | null;
      business_hours_only: boolean;
    }) => api.put<SlaPolicyView>('/settings/sla', body),
    onSuccess: onSaved,
  });

  const form = useForm<FormValues>({
    initial: {
      first_response_minutes:
        policy.first_response_minutes === null ? '' : String(policy.first_response_minutes),
      resolution_minutes:
        policy.resolution_minutes === null ? '' : String(policy.resolution_minutes),
      business_hours_only: String(policy.business_hours_only),
    },
    validators: {
      first_response_minutes: slaMinutes(t),
      resolution_minutes: slaMinutes(t),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await save.mutateAsync({
          first_response_minutes:
            values.first_response_minutes.trim() === ''
              ? null
              : Number(values.first_response_minutes),
          resolution_minutes:
            values.resolution_minutes.trim() === '' ? null : Number(values.resolution_minutes),
          business_hours_only: values.business_hours_only === 'true',
        });
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError && error.details?.['entitlement'] === 'sla'
            ? t('settings.sla.entitlementError')
            : t(errorMessageKey(error)),
        );
      }
    },
  });

  const firstResponseError = form.errorFor('first_response_minutes');
  const resolutionError = form.errorFor('resolution_minutes');
  // Only while the current values are exactly what the last successful save
  // wrote — editing again (isDirty) or a fresh mutation both clear it, so the
  // note never lingers over an unrelated later change.
  const justSaved = save.isSuccess && !form.isDirty;
  const configured = policy.first_response_minutes !== null || policy.resolution_minutes !== null;

  return (
    <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        {t('settings.sla.statusLabel')}
        <StatusDot
          tone={policy.active ? 'success' : 'neutral'}
          label={policy.active ? t('settings.sla.active') : t('settings.sla.notActive')}
        />
      </div>
      {!policy.active && configured && (
        <p className="text-2xs text-content-tertiary">{t('settings.sla.downgradeNote')}</p>
      )}

      <fieldset disabled={!canEdit} className="flex flex-col gap-5 border-0 p-0">
        <div className="flex flex-wrap gap-4">
          <div className="flex w-56 flex-col gap-1">
            <label
              htmlFor="sla-first-response"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.sla.firstResponseLabel')}
            </label>
            <input
              id="sla-first-response"
              type="number"
              min={1}
              max={SLA_MAX_TARGET_MINUTES}
              placeholder={t('settings.sla.noTargetPlaceholder')}
              value={form.values.first_response_minutes}
              onChange={(event) => form.setValue('first_response_minutes', event.target.value)}
              onBlur={() => form.blur('first_response_minutes')}
              aria-invalid={firstResponseError ? true : undefined}
              aria-describedby={firstResponseError ? 'sla-first-response-error' : undefined}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            />
            <FieldError id="sla-first-response-error" message={firstResponseError} />
          </div>

          <div className="flex w-56 flex-col gap-1">
            <label
              htmlFor="sla-resolution"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('settings.sla.resolutionLabel')}
            </label>
            <input
              id="sla-resolution"
              type="number"
              min={1}
              max={SLA_MAX_TARGET_MINUTES}
              placeholder={t('settings.sla.noTargetPlaceholder')}
              value={form.values.resolution_minutes}
              onChange={(event) => form.setValue('resolution_minutes', event.target.value)}
              onBlur={() => form.blur('resolution_minutes')}
              aria-invalid={resolutionError ? true : undefined}
              aria-describedby={resolutionError ? 'sla-resolution-error' : undefined}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            />
            <FieldError id="sla-resolution-error" message={resolutionError} />
          </div>
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={form.values.business_hours_only === 'true'}
            onChange={(event) => form.setValue('business_hours_only', String(event.target.checked))}
          />
          <span className="text-sm">
            {t('settings.sla.businessHoursLabel')}
            <span className="block text-2xs text-content-tertiary">
              {t('settings.sla.businessHoursHint')}
            </span>
          </span>
        </label>
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
              {t('settings.sla.savedNotePrefix')}{' '}
              <Link to="/app/reports" className="text-content-brand hover:underline">
                {t('settings.sla.savedNoteLink')}
              </Link>
              {t('settings.sla.savedNoteSuffix')}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
