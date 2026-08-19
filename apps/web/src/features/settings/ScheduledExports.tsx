/**
 * Settings → Scheduled exports (PRD §5.3-Reports, FR-MOD-07.7).
 *
 * Lives under Settings rather than Reports — like Ticket rules and Ticket
 * e-mail templates, this configures a standing workspace automation, not a
 * report itself, so it does not belong on `ReportsPage`'s tab strip.
 *
 * The management surface (list/create/cancel) is gated on `reports_manage`
 * server-side, including the read — a definition carries the mailboxes it
 * mails, so even listing it is management, not reading a report (mirrors the
 * contract's own reasoning). A caller without that scope gets a 403 on the
 * very query that lists this section, which renders as `ErrorNotice`; there
 * is no partial "read-only list" to show without it. Delivery history
 * (`GET .../runs`, per row) is the looser `reports_read`, since a run only
 * ever carries a recipient *count*, never an address.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot, type StatusTone } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { ScheduledExport, ScheduledExportFrequency, ScheduledExportRun } from '@nexa/types';

interface ReportGroupOption {
  id: string;
  label: string;
}

interface AgentOption {
  id: string;
  name: string;
  email: string;
}

const FREQUENCIES: readonly ScheduledExportFrequency[] = ['daily', 'weekly', 'monthly'];

function frequencyLabel(t: TFunction, frequency: ScheduledExportFrequency): string {
  return t(`settings.scheduledExports.frequency.${frequency}`);
}

export function ScheduledExports({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'scheduled-exports'],
    queryFn: () => api.get<{ items: ScheduledExport[] }>('/reports/scheduled-exports'),
  });

  // Not scope-gated server-side (a token without `reports_read` just sees an
  // empty catalogue) — fetched unconditionally so a row's group id resolves
  // to a readable label even for a viewer who cannot edit.
  const groups = useQuery({
    queryKey: ['reports', 'groups'],
    queryFn: () => api.get<{ groups: ReportGroupOption[] }>('/reports/groups'),
  });

  // Only the create form needs the roster, and only an editor sees that form.
  const agents = useQuery({
    queryKey: ['settings', 'scheduled-exports', 'agents'],
    queryFn: () => api.get<{ items: AgentOption[] }>('/agents'),
    enabled: canEdit,
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'scheduled-exports'] });

  const create = useMutation({
    mutationFn: (body: {
      group: string;
      frequency: ScheduledExportFrequency;
      recipients: string[];
    }) => api.post<ScheduledExport>('/reports/scheduled-exports', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/reports/scheduled-exports/${id}`),
    onSuccess: invalidate,
  });

  const groupOptions = groups.data?.groups ?? [];
  const agentOptions = agents.data?.items ?? [];

  // Recipients are a checkbox set, not free text (FR-MOD-07.7: a schedule may
  // only name mailboxes on the team roster) — stored as one comma-joined
  // string so it fits the form primitive's string-only field contract.
  const form = useForm({
    initial: { group: '', frequency: 'daily', recipients: '' },
    validators: {
      // Left empty whenever `/reports/groups` grants nothing selectable — the
      // permission-based visibility this form owes: no group to pick, no
      // schedule to submit.
      group: required(t('settings.scheduledExports.groupError')),
      recipients: (value) => (value.trim() ? null : t('settings.scheduledExports.recipientsError')),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          group: values.group,
          frequency: values.frequency as ScheduledExportFrequency,
          recipients: values.recipients.split(',').filter(Boolean),
        });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  const groupError = form.errorFor('group');
  const recipientsError = form.errorFor('recipients');
  const selectedRecipients = new Set(
    form.values.recipients.split(',').filter((email) => email.length > 0),
  );

  function toggleRecipient(email: string): void {
    const next = new Set(selectedRecipients);
    if (next.has(email)) next.delete(email);
    else next.add(email);
    form.setValue('recipients', Array.from(next).join(','));
  }

  return (
    <Section
      title={t('settings.scheduledExports.title')}
      description={t('settings.scheduledExports.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.scheduledExports.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="scheduled-export-group" className="flex min-w-48 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.scheduledExports.reportLabel')}
                  </span>
                  <select
                    id="scheduled-export-group"
                    value={form.values.group}
                    onChange={(event) => form.setValue('group', event.target.value)}
                    onBlur={() => form.blur('group')}
                    aria-invalid={groupError ? true : undefined}
                    aria-describedby={groupError ? 'scheduled-export-group-error' : undefined}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                  >
                    <option value="">{t('settings.scheduledExports.reportPlaceholder')}</option>
                    {groupOptions.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.label}
                      </option>
                    ))}
                  </select>
                  <FieldError id="scheduled-export-group-error" message={groupError} />
                </label>

                <label htmlFor="scheduled-export-frequency" className="flex w-32 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.scheduledExports.frequencyLabel')}
                  </span>
                  <select
                    id="scheduled-export-frequency"
                    value={form.values.frequency}
                    onChange={(event) => form.setValue('frequency', event.target.value)}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                  >
                    {FREQUENCIES.map((value) => (
                      <option key={value} value={value}>
                        {frequencyLabel(t, value)}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting
                    ? t('settings.scheduledExports.scheduling')
                    : t('settings.scheduledExports.scheduleButton')}
                </button>
              </div>

              <fieldset className="flex flex-col gap-1.5">
                <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.scheduledExports.recipientsLegend')}
                </legend>
                {agentOptions.length === 0 ? (
                  <p className="text-2xs text-content-tertiary">
                    {t('settings.scheduledExports.noActiveAgents')}
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {agentOptions.map((agent) => (
                      <label key={agent.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={selectedRecipients.has(agent.email)}
                          onChange={() => toggleRecipient(agent.email)}
                        />
                        {agent.name}
                      </label>
                    ))}
                  </div>
                )}
                <FieldError id="scheduled-export-recipients-error" message={recipientsError} />
              </fieldset>

              {form.submitError && (
                <p role="alert" className="text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.scheduledExports.empty.title')}
              description={t('settings.scheduledExports.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((scheduledExport) => (
                <ScheduledExportRow
                  key={scheduledExport.id}
                  scheduledExport={scheduledExport}
                  groupLabel={
                    groupOptions.find((group) => group.id === scheduledExport.group)?.label ??
                    scheduledExport.group
                  }
                  canEdit={canEdit}
                  onCancel={() => remove.mutate(scheduledExport.id)}
                  cancelling={remove.isPending}
                />
              ))}
            </ul>
          )}
        </Card>
      )}
    </Section>
  );
}

function describeLastRun(
  t: TFunction,
  run: ScheduledExportRun | undefined,
): { tone: StatusTone; label: string } {
  if (!run) return { tone: 'neutral', label: t('settings.scheduledExports.neverRun') };
  if (run.status === 'delivered')
    return { tone: 'success', label: t('settings.scheduledExports.delivered') };
  if (run.status === 'failed')
    return { tone: 'danger', label: t('settings.scheduledExports.failed') };
  return { tone: 'warning', label: t('settings.scheduledExports.running') };
}

function ScheduledExportRow({
  scheduledExport,
  groupLabel,
  canEdit,
  onCancel,
  cancelling,
}: {
  scheduledExport: ScheduledExport;
  groupLabel: string;
  canEdit: boolean;
  onCancel: () => void;
  cancelling: boolean;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [confirming, setConfirming] = useState(false);

  // One-row delivery history (FR-EK-B.1 style status): the most recent
  // attempt decides the badge. `last_run_at` on the definition only advances
  // on success, so it cannot distinguish "never run" from "just failed" —
  // the run itself is the only honest source for that.
  const lastRun = useQuery({
    queryKey: ['settings', 'scheduled-exports', scheduledExport.id, 'last-run'],
    queryFn: () =>
      api.get<{ items: ScheduledExportRun[] }>(
        `/reports/scheduled-exports/${scheduledExport.id}/runs?limit=1`,
      ),
  });

  const badge = lastRun.isPending
    ? { tone: 'neutral' as const, label: t('settings.scheduledExports.checking') }
    : describeLastRun(t, lastRun.data?.items[0]);

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{groupLabel}</p>
        <p className="truncate text-2xs text-content-tertiary">
          {t('settings.scheduledExports.summary', {
            frequency: frequencyLabel(t, scheduledExport.frequency),
            recipients: t('settings.scheduledExports.recipientCount', {
              count: scheduledExport.recipients.length,
            }),
          })}
        </p>
      </div>

      <StatusDot tone={badge.tone} label={badge.label} />

      {canEdit &&
        (confirming ? (
          <span className="flex items-center gap-2">
            <span className="text-2xs text-content-secondary">
              {t('settings.scheduledExports.cancelConfirm')}
            </span>
            <button
              type="button"
              disabled={cancelling}
              onClick={onCancel}
              className="rounded-md border border-border px-2 py-1 text-2xs text-danger transition-colors hover:bg-surface-2 disabled:opacity-40"
            >
              {t('settings.scheduledExports.confirmCancelButton')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
            >
              {t('settings.scheduledExports.keepButton')}
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={t('settings.scheduledExports.cancelAriaLabel', { group: groupLabel })}
            className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
          >
            {t('settings.cancel')}
          </button>
        ))}
    </li>
  );
}
