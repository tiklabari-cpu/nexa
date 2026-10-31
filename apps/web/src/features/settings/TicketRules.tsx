/**
 * Ticket rules (FR-MOD-08.6.2): a condition plus an action, applied when a
 * ticket is opened. The editor covers the self-contained actions — set
 * priority, add a tag, and since tm 359 (HD-04) e-mail the player a ticket
 * template as an acknowledgement — while assignment rules are configured
 * through the API; all share the same condition. A condition and an action are
 * always required, which the form enforces before the server ever does (the
 * "koşul+eylem zorunlu" KK): the action value is required, and so is the subject
 * fragment unless the rule is scoped by business hours instead.
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-j, tm
 * 133.10) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated. `SettingsForms.test.tsx`
 * still imports it through `./SettingsPage.js`'s re-export, untouched.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { renderTemplate, type TemplateContext } from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';
import { useConfirm } from '../../components/ui/index.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';

interface TicketRule {
  id: string;
  name: string;
  conditions: {
    subject_contains?: string;
    source?: 'chat' | 'email';
    outside_business_hours?: boolean;
  };
  actions: {
    assign_agent_id?: string;
    assign_group_id?: number;
    priority?: number;
    add_tag?: string;
    send_template_id?: string;
  };
  enabled: boolean;
  position: number;
}

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
}

/** Which business-hours condition the form adds: none, out of hours, or in hours. */
type HoursChoice = 'any' | 'out' | 'in';

/**
 * What the preview fills a template with. `ticket.expected_response` is empty
 * on purpose: that is what the server sends until a first-response target
 * exists, and a preview that promised a time would show mail nobody gets.
 */
const SAMPLE_CONTEXT: TemplateContext = {
  'ticket.id': 'TCK00000001',
  'ticket.subject': 'Withdrawal is stuck',
  'ticket.status': 'open',
  'ticket.priority': 'Normal',
  'ticket.expected_response': '',
  'customer.name': 'Alex Example',
  'customer.email': 'alex@example.com',
  'agent.name': '',
  'company.name': 'Acme',
};

export function TicketRules({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const { confirm, dialog } = useConfirm();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'ticket-rules'],
    queryFn: () => api.get<{ items: TicketRule[] }>('/settings/ticket-rules'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'ticket-rules'] });
  };

  // The business-hours condition lives beside the form rather than in it: it
  // decides whether the subject fragment is still required.
  const [hours, setHours] = useState<HoursChoice>('any');

  const create = useMutation({
    mutationFn: (body: {
      name: string;
      conditions: TicketRule['conditions'];
      actions: TicketRule['actions'];
    }) => api.post<TicketRule>('/settings/ticket-rules', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/ticket-rules/${id}`),
    onSuccess: invalidate,
  });

  // Flip the switch under the pointer at once, rolling back if the server
  // refuses — the same optimistic behaviour the routing rules use (FR-EK-A.2).
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<TicketRule>(`/settings/ticket-rules/${id}`, { enabled }),
    ...optimisticCacheUpdate<{ items: TicketRule[] }, { id: string; enabled: boolean }>({
      queryClient,
      queryKey: ['settings', 'ticket-rules'],
      update: (current, { id, enabled }) => ({
        items: (current?.items ?? []).map((rule) => (rule.id === id ? { ...rule, enabled } : rule)),
      }),
    }),
  });

  // Name, a subject condition and an action value are all required, Submit
  // disabled until they are, the fields cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { name: '', subject_contains: '', action_type: 'priority', value: '' },
    validators: {
      name: required(t('settings.ticketRules.ruleNameError')),
      // A rule scoped by business hours needs no subject text as well.
      subject_contains:
        hours === 'any' ? required(t('settings.ticketRules.subjectError')) : () => null,
      value: required(t('settings.ticketRules.valueError')),
    },
    onSubmit: async (values, { setSubmitError, setFieldError, reset }) => {
      const subject = values.subject_contains.trim();
      const conditions: TicketRule['conditions'] = {
        ...(subject ? { subject_contains: subject } : {}),
        ...(hours === 'any' ? {} : { outside_business_hours: hours === 'out' }),
      };
      let actions: TicketRule['actions'];
      if (values.action_type === 'send_template') {
        actions = { send_template_id: values.value };
      } else if (values.action_type === 'priority') {
        const priority = Number(values.value);
        if (!Number.isInteger(priority) || priority < 0) {
          setFieldError('value', t('settings.ticketRules.priorityWholeNumberError'));
          return;
        }
        actions = { priority };
      } else {
        actions = { add_tag: values.value.trim() };
      }
      try {
        await create.mutateAsync({ name: values.name.trim(), conditions, actions });
        setHours('any');
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  useSettingsLeaveGuard(form.isDirty, form.isSubmitting);
  const nameError = form.errorFor('name');
  const subjectError = form.errorFor('subject_contains');
  const valueError = form.errorFor('value');
  const isPriority = form.values.action_type === 'priority';
  const isTemplate = form.values.action_type === 'send_template';

  // The workspace's e-mail templates: needed to pick one, and to name the one a
  // rule already sends.
  const hasTemplateRule = list.data?.items.some((rule) => rule.actions.send_template_id) ?? false;
  const templates = useQuery({
    queryKey: ['settings', 'ticket-email-templates'],
    queryFn: () => api.get<{ items: EmailTemplate[] }>('/settings/ticket-email-templates'),
    enabled: (canEdit && isTemplate) || hasTemplateRule,
  });
  const templateItems = templates.data?.items ?? [];
  const chosenTemplate = isTemplate
    ? templateItems.find((template) => template.id === form.values.value)
    : undefined;

  return (
    <Section
      title={t('settings.ticketRules.title')}
      description={t('settings.ticketRules.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.ticketRules.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
                <label htmlFor="rule-name" className="flex w-40 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.ticketRules.ruleNameLabel')}
                  </span>
                  <input
                    id="rule-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'rule-name-error' : undefined}
                    placeholder={t('settings.ticketRules.namePlaceholder')}
                    maxLength={120}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="rule-name-error" message={nameError} />
                </label>

                <label htmlFor="rule-subject" className="flex min-w-48 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.ticketRules.subjectLabel')}
                  </span>
                  <input
                    id="rule-subject"
                    value={form.values.subject_contains}
                    onChange={(event) => form.setValue('subject_contains', event.target.value)}
                    onBlur={() => form.blur('subject_contains')}
                    aria-invalid={subjectError ? true : undefined}
                    aria-describedby={subjectError ? 'rule-subject-error' : undefined}
                    placeholder={t('settings.ticketRules.subjectPlaceholder')}
                    maxLength={2048}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="rule-subject-error" message={subjectError} />
                </label>

                <label htmlFor="rule-hours" className="flex w-44 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.ticketRules.hoursLabel')}
                  </span>
                  <select
                    id="rule-hours"
                    value={hours}
                    onChange={(event) => setHours(event.target.value as HoursChoice)}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                  >
                    <option value="any">{t('settings.ticketRules.hoursAny')}</option>
                    <option value="out">{t('settings.ticketRules.hoursOut')}</option>
                    <option value="in">{t('settings.ticketRules.hoursIn')}</option>
                  </select>
                </label>

                <label htmlFor="rule-action" className="flex w-44 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.ticketRules.thenLabel')}
                  </span>
                  <select
                    id="rule-action"
                    value={form.values.action_type}
                    onChange={(event) => {
                      // Switching action kind changes what the value means, so
                      // clear it rather than carry a priority into a tag field.
                      form.setValue('action_type', event.target.value);
                      form.setValue('value', '');
                    }}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                  >
                    <option value="priority">{t('settings.ticketRules.setPriorityOption')}</option>
                    <option value="tag">{t('settings.ticketRules.addTagOption')}</option>
                    <option value="send_template">
                      {t('settings.ticketRules.sendTemplateOption')}
                    </option>
                  </select>
                </label>

                <label
                  htmlFor="rule-value"
                  className={isTemplate ? 'flex w-48 flex-col gap-1' : 'flex w-32 flex-col gap-1'}
                >
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {isTemplate
                      ? t('settings.ticketRules.templateLabel')
                      : isPriority
                        ? t('settings.ticketRules.priorityLabel')
                        : t('settings.ticketRules.tagLabel')}
                  </span>
                  {isTemplate ? (
                    <select
                      id="rule-value"
                      value={form.values.value}
                      onChange={(event) => form.setValue('value', event.target.value)}
                      onBlur={() => form.blur('value')}
                      aria-invalid={valueError ? true : undefined}
                      aria-describedby={valueError ? 'rule-value-error' : undefined}
                      className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                    >
                      <option value="">{t('settings.ticketRules.templateNone')}</option>
                      {templateItems.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="rule-value"
                      type={isPriority ? 'number' : 'text'}
                      min={isPriority ? 0 : undefined}
                      value={form.values.value}
                      onChange={(event) => form.setValue('value', event.target.value)}
                      onBlur={() => form.blur('value')}
                      aria-invalid={valueError ? true : undefined}
                      aria-describedby={valueError ? 'rule-value-error' : undefined}
                      placeholder={isPriority ? '50' : 'vip'}
                      maxLength={isPriority ? undefined : 64}
                      className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                    />
                  )}
                  <FieldError id="rule-value-error" message={valueError} />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="mt-5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? t('settings.saving') : t('settings.ticketRules.addButton')}
                </button>
              </div>

              {isTemplate && templates.data && templateItems.length === 0 && (
                <p className="text-2xs text-content-tertiary">
                  {t('settings.ticketRules.noTemplates')}
                </p>
              )}

              {chosenTemplate && (
                <div
                  aria-label={t('settings.ticketRules.previewTitle')}
                  className="rounded-md border border-border bg-inset p-3 text-sm"
                >
                  <p className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.ticketRules.previewTitle')}
                  </p>
                  <p className="mt-1 font-medium">
                    {renderTemplate(chosenTemplate.subject, SAMPLE_CONTEXT)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-content-secondary">
                    {renderTemplate(chosenTemplate.body, SAMPLE_CONTEXT)}
                  </p>
                </div>
              )}

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
              title={t('settings.ticketRules.empty.title')}
              description={t('settings.ticketRules.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{rule.name}</p>
                    <p className="truncate text-2xs text-content-tertiary">
                      {describeTicketRule(t, rule, templateItems)}
                    </p>
                  </div>

                  <StatusDot
                    tone={rule.enabled ? 'success' : 'neutral'}
                    label={rule.enabled ? t('settings.on') : t('settings.off')}
                  />

                  {canEdit && (
                    <>
                      <button
                        type="button"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ id: rule.id, enabled: !rule.enabled })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
                      >
                        {rule.enabled ? t('settings.disable') : t('settings.enable')}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          confirm({
                            title: t('settings.ticketRules.deleteConfirmTitle', {
                              name: rule.name,
                            }),
                            description: t('settings.ticketRules.deleteConfirmDescription'),
                            confirmLabel: t('settings.delete'),
                            failureTitle: t('ui.writeError.delete', { name: rule.name }),
                            onConfirm: () => remove.mutateAsync(rule.id),
                          })
                        }
                        aria-label={t('settings.ticketRules.deleteAriaLabel', { name: rule.name })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('settings.delete')}
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      {dialog}
    </Section>
  );
}

/**
 * Renders a ticket rule as one readable "when … → then …" line. Assignment
 * fragments (`assign_agent_id`/`assign_group_id`) are display-only here —
 * this editor only writes priority/tag actions — kept for a rule the API
 * created directly.
 */
function describeTicketRule(
  t: TFunction,
  rule: TicketRule,
  templates: readonly EmailTemplate[],
): string {
  const when: string[] = [];
  if (rule.conditions.subject_contains)
    when.push(
      t('settings.ticketRules.subjectContains', { text: rule.conditions.subject_contains }),
    );
  if (rule.conditions.source)
    when.push(t('settings.ticketRules.fromSource', { source: rule.conditions.source }));
  if (rule.conditions.outside_business_hours != null)
    when.push(
      t(
        rule.conditions.outside_business_hours
          ? 'settings.ticketRules.outsideHoursCondition'
          : 'settings.ticketRules.insideHoursCondition',
      ),
    );

  const then: string[] = [];
  if (rule.actions.assign_agent_id) then.push(t('settings.ticketRules.assignAgent'));
  if (rule.actions.assign_group_id != null) then.push(t('settings.ticketRules.assignTeam'));
  if (rule.actions.priority != null)
    then.push(t('settings.ticketRules.setPriorityAction', { priority: rule.actions.priority }));
  if (rule.actions.add_tag)
    then.push(t('settings.ticketRules.addTagAction', { tag: rule.actions.add_tag }));
  if (rule.actions.send_template_id) {
    const name = templates.find((template) => template.id === rule.actions.send_template_id)?.name;
    then.push(
      name
        ? t('settings.ticketRules.sendTemplateAction', { template: name })
        : t('settings.ticketRules.sendTemplateActionUnknown'),
    );
  }

  return `${when.length ? when.join(t('settings.andJoiner')) : t('settings.ticketRules.anyTicket')} → ${then.length ? then.join(', ') : t('settings.ticketRules.doNothing')}`;
}
