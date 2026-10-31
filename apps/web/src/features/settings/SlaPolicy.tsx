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
 *
 * Chats and tickets are two sections (HD-05 · tm 360, GV-06): a ticket's first
 * response has its own target, blank by default — a ticket does not borrow the
 * chat's, which would have marked every open queue as late the day it shipped.
 * A priority level may carry its own ticket targets over the ticket-wide ones;
 * a blank there inherits. The business-hours switch covers both.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import {
  SLA_MAX_TARGET_MINUTES,
  SLA_PRIORITY_KEYS,
  type SlaPriorityKey,
  type SlaTicketTargetsByPriority,
} from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { FormSaveBar } from '../../components/settings/FormSaveBar.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, useForm, type Validator } from '../../lib/form.js';
import { useEntitlementNote } from '../../lib/entitlement-note.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';

interface SlaPolicyView {
  first_response_minutes: number | null;
  resolution_minutes: number | null;
  /** Optional: a server older than HD-05 does not send them. */
  ticket_first_response_minutes?: number | null;
  ticket_resolution_minutes?: number | null;
  ticket_targets_by_priority?: SlaTicketTargetsByPriority | null;
  business_hours_only: boolean;
  /** Entitled *and* configured — see the module doc for why this is one flag. */
  active: boolean;
  updated_at: string | null;
}

type PriorityField = `${SlaPriorityKey}_first_response` | `${SlaPriorityKey}_resolution`;

type FormValues = Record<
  | 'first_response_minutes'
  | 'resolution_minutes'
  | 'ticket_first_response_minutes'
  | 'ticket_resolution_minutes'
  | 'business_hours_only'
  | PriorityField,
  string
>;

type SaveBody = {
  first_response_minutes: number | null;
  resolution_minutes: number | null;
  ticket_first_response_minutes: number | null;
  ticket_resolution_minutes: number | null;
  ticket_targets_by_priority: SlaTicketTargetsByPriority | null;
  business_hours_only: boolean;
};

const PRIORITY_LABEL_KEY: Record<SlaPriorityKey, string> = {
  urgent: 'inbox.priority.urgent',
  high: 'inbox.priority.high',
  normal: 'inbox.priority.normal',
  low: 'inbox.priority.low',
};

const asField = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);
const asMinutes = (value: string): number | null => (value.trim() === '' ? null : Number(value));

/** The form's starting values, from what the server holds. */
function initialValues(policy: SlaPolicyView): FormValues {
  const values = {
    first_response_minutes: asField(policy.first_response_minutes),
    resolution_minutes: asField(policy.resolution_minutes),
    ticket_first_response_minutes: asField(policy.ticket_first_response_minutes),
    ticket_resolution_minutes: asField(policy.ticket_resolution_minutes),
    business_hours_only: String(policy.business_hours_only),
  } as FormValues;
  for (const key of SLA_PRIORITY_KEYS) {
    const own = policy.ticket_targets_by_priority?.[key];
    values[`${key}_first_response`] = asField(own?.first_response_minutes);
    values[`${key}_resolution`] = asField(own?.resolution_minutes);
  }
  return values;
}

/** The PUT body; a priority with both fields blank is left out, none left is null. */
function saveBody(values: FormValues): SaveBody {
  const byPriority: SlaTicketTargetsByPriority = {};
  for (const key of SLA_PRIORITY_KEYS) {
    const first = asMinutes(values[`${key}_first_response`]);
    const resolution = asMinutes(values[`${key}_resolution`]);
    if (first !== null || resolution !== null) {
      byPriority[key] = { first_response_minutes: first, resolution_minutes: resolution };
    }
  }
  return {
    first_response_minutes: asMinutes(values.first_response_minutes),
    resolution_minutes: asMinutes(values.resolution_minutes),
    ticket_first_response_minutes: asMinutes(values.ticket_first_response_minutes),
    ticket_resolution_minutes: asMinutes(values.ticket_resolution_minutes),
    ticket_targets_by_priority: Object.keys(byPriority).length > 0 ? byPriority : null,
    business_hours_only: values.business_hours_only === 'true',
  };
}

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
  const entitlementNote = useEntitlementNote();
  const api = useApiClient();

  const save = useMutation({
    mutationFn: (body: SaveBody) => api.put<SlaPolicyView>('/settings/sla', body),
    onSuccess: onSaved,
  });

  const minutes = slaMinutes(t);
  const validators: Partial<Record<keyof FormValues, Validator>> = {
    first_response_minutes: minutes,
    resolution_minutes: minutes,
    ticket_first_response_minutes: minutes,
    ticket_resolution_minutes: minutes,
  };
  for (const key of SLA_PRIORITY_KEYS) {
    validators[`${key}_first_response`] = minutes;
    validators[`${key}_resolution`] = minutes;
  }

  const form = useForm<FormValues>({
    initial: initialValues(policy),
    validators,
    onSubmit: async (values, { setSubmitError }) => {
      try {
        await save.mutateAsync(saveBody(values));
      } catch (error) {
        setSubmitError(
          error instanceof ApiClientError && error.details?.['entitlement'] === 'sla'
            ? entitlementNote('settings.sla.entitlementError')
            : t(errorMessageKey(error)),
        );
      }
    },
  });

  const firstResponseError = form.errorFor('first_response_minutes');
  const resolutionError = form.errorFor('resolution_minutes');

  /** One minutes field; `label` is its visible label, or its accessible name when `hidden`. */
  const minutesInput = (
    field: keyof FormValues,
    id: string,
    label: string,
    placeholder: string,
    hidden = false,
  ): ReactElement => {
    const error = form.errorFor(field);
    return (
      <div className={`flex flex-col gap-1 ${hidden ? 'w-36' : 'w-56'}`}>
        {!hidden && (
          <label
            htmlFor={id}
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {label}
          </label>
        )}
        <input
          id={id}
          type="number"
          min={1}
          max={SLA_MAX_TARGET_MINUTES}
          placeholder={placeholder}
          aria-label={hidden ? label : undefined}
          value={form.values[field]}
          onChange={(event) => form.setValue(field, event.target.value)}
          onBlur={() => form.blur(field)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-50"
        />
        <FieldError id={`${id}-error`} message={error} />
      </div>
    );
  };
  // Only while the current values are exactly what the last successful save
  // wrote — editing again (isDirty) or a fresh mutation both clear it, so the
  // note never lingers over an unrelated later change.
  const justSaved = save.isSuccess && !form.isDirty;
  const configured =
    policy.first_response_minutes !== null ||
    policy.resolution_minutes !== null ||
    (policy.ticket_first_response_minutes ?? null) !== null ||
    (policy.ticket_resolution_minutes ?? null) !== null ||
    Object.keys(policy.ticket_targets_by_priority ?? {}).length > 0;

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
        <h3 className="text-sm font-semibold">{t('settings.sla.chatsHeading')}</h3>
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

        <h3 className="text-sm font-semibold">{t('settings.sla.ticketsHeading')}</h3>
        <p className="-mt-3 text-2xs text-content-tertiary">{t('settings.sla.ticketsHint')}</p>
        <div className="flex flex-wrap gap-4">
          {minutesInput(
            'ticket_first_response_minutes',
            'sla-ticket-first-response',
            t('settings.sla.ticketFirstResponseLabel'),
            t('settings.sla.notMeasuredPlaceholder'),
          )}
          {minutesInput(
            'ticket_resolution_minutes',
            'sla-ticket-resolution',
            t('settings.sla.ticketResolutionLabel'),
            t('settings.sla.sameAsChatsPlaceholder'),
          )}
        </div>
        <table className="w-fit text-sm">
          <caption className="pb-2 text-left text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('settings.sla.byPriorityCaption')}
          </caption>
          <thead>
            <tr className="text-left text-2xs text-content-tertiary">
              <th scope="col" className="pr-4 font-medium">
                {t('settings.sla.byPriority.priority')}
              </th>
              <th scope="col" className="pr-4 font-medium">
                {t('settings.sla.byPriority.firstResponse')}
              </th>
              <th scope="col" className="font-medium">
                {t('settings.sla.byPriority.resolution')}
              </th>
            </tr>
          </thead>
          <tbody>
            {SLA_PRIORITY_KEYS.map((key) => {
              const level = t(PRIORITY_LABEL_KEY[key]);
              return (
                <tr key={key}>
                  <th scope="row" className="pr-4 text-left font-normal">
                    {level}
                  </th>
                  <td className="py-1 pr-4">
                    {minutesInput(
                      `${key}_first_response`,
                      `sla-${key}-first-response`,
                      t('settings.sla.byPriority.firstResponseFor', { priority: level }),
                      t('settings.sla.ticketDefaultPlaceholder'),
                      true,
                    )}
                  </td>
                  <td className="py-1">
                    {minutesInput(
                      `${key}_resolution`,
                      `sla-${key}-resolution`,
                      t('settings.sla.byPriority.resolutionFor', { priority: level }),
                      t('settings.sla.ticketDefaultPlaceholder'),
                      true,
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

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
      {canEdit && <FormSaveBar form={form} />}
    </form>
  );
}
