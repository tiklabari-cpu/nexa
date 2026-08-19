/**
 * Settings → Ticket e-mail templates (FR-MOD-08.7.5).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still carries sections I18N-j (tm 133.10) owns in English.
 *
 * Author branded, variabled e-mails a ticket can send. The one property that
 * matters is that Submit stays disabled — and a field-under error shows —
 * while the subject or body names a variable the product cannot fill or
 * carries a broken placeholder, judged live against the shared catalogue
 * (`@nexa/types`). That validator message is left in English on purpose: it
 * comes straight from `findTemplateProblems`, a shared, non-UI catalogue this
 * screen does not own, and `SettingsForms.test.tsx` already pins its English
 * wording (`/Unknown variable/`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { StatusDot } from '../../components/StatusDot.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { compose, FieldError, required, useForm, type Validator } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { TEMPLATE_VARIABLES, findTemplateProblems, type TemplateField } from '@nexa/types';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';

interface TicketEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * A validator for one half of a template. It answers exactly the question the
 * server will, from the same catalogue: an unknown variable or a malformed
 * `{{…}}` becomes a field-under error the moment it is typed, so the author
 * never round-trips to the server to learn a placeholder is wrong (KK
 * "Geçersiz değişken/format engeli").
 */
function templateText(field: TemplateField): Validator {
  return (value) => findTemplateProblems(field, value)[0]?.message ?? null;
}

export function TicketEmailTemplates({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'ticket-email-templates'],
    queryFn: () => api.get<{ items: TicketEmailTemplate[] }>('/settings/ticket-email-templates'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'ticket-email-templates'] });
  };

  const create = useMutation({
    mutationFn: (body: { name: string; subject: string; body: string }) =>
      api.post<TicketEmailTemplate>('/settings/ticket-email-templates', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/ticket-email-templates/${id}`),
    onSuccess: invalidate,
  });

  // Flip the switch under the pointer at once, rolling back if the server
  // refuses — the same optimistic behaviour ticket rules use (FR-EK-A.2).
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<TicketEmailTemplate>(`/settings/ticket-email-templates/${id}`, { enabled }),
    ...optimisticCacheUpdate<{ items: TicketEmailTemplate[] }, { id: string; enabled: boolean }>({
      queryClient,
      queryKey: ['settings', 'ticket-email-templates'],
      update: (current, { id, enabled }) => ({
        items: (current?.items ?? []).map((item) => (item.id === id ? { ...item, enabled } : item)),
      }),
    }),
  });

  // Name, subject and body are all required, and the subject and body must carry
  // only valid placeholders — Submit disabled until they do (FR-EK-A.1).
  const form = useForm({
    initial: { name: '', subject: '', body: '' },
    validators: {
      name: required(t('settings.ticketEmailTemplates.nameError')),
      subject: compose(
        required(t('settings.ticketEmailTemplates.subjectError')),
        templateText('subject'),
      ),
      body: compose(required(t('settings.ticketEmailTemplates.bodyError')), templateText('body')),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          name: values.name.trim(),
          subject: values.subject,
          body: values.body,
        });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const nameError = form.errorFor('name');
  const subjectError = form.errorFor('subject');
  const bodyError = form.errorFor('body');

  return (
    <Section
      title={t('settings.ticketEmailTemplates.title')}
      description={t('settings.ticketEmailTemplates.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.ticketEmailTemplates.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <label htmlFor="template-name" className="flex w-56 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.ticketEmailTemplates.nameLabel')}
                </span>
                <input
                  id="template-name"
                  value={form.values.name}
                  onChange={(event) => form.setValue('name', event.target.value)}
                  onBlur={() => form.blur('name')}
                  aria-invalid={nameError ? true : undefined}
                  aria-describedby={nameError ? 'template-name-error' : undefined}
                  placeholder="Ticket received"
                  maxLength={120}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="template-name-error" message={nameError} />
              </label>

              <label htmlFor="template-subject" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.ticketEmailTemplates.subjectLabel')}
                </span>
                <input
                  id="template-subject"
                  value={form.values.subject}
                  onChange={(event) => form.setValue('subject', event.target.value)}
                  onBlur={() => form.blur('subject')}
                  aria-invalid={subjectError ? true : undefined}
                  aria-describedby={subjectError ? 'template-subject-error' : undefined}
                  placeholder="We received your ticket {{ticket.id}}"
                  maxLength={200}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="template-subject-error" message={subjectError} />
              </label>

              <label htmlFor="template-body" className="flex flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.ticketEmailTemplates.messageLabel')}
                </span>
                <textarea
                  id="template-body"
                  value={form.values.body}
                  onChange={(event) => form.setValue('body', event.target.value)}
                  onBlur={() => form.blur('body')}
                  aria-invalid={bodyError ? true : undefined}
                  aria-describedby={bodyError ? 'template-body-error' : undefined}
                  placeholder="Hi {{customer.name}}, thanks for reaching out."
                  maxLength={10000}
                  rows={4}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="template-body-error" message={bodyError} />
              </label>

              <p className="text-2xs text-content-tertiary">
                {t('settings.ticketEmailTemplates.variablesLabel', {
                  list: TEMPLATE_VARIABLES.map((v) => `{{${v}}}`).join(', '),
                })}
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting
                    ? t('settings.saving')
                    : t('settings.ticketEmailTemplates.addButton')}
                </button>
                {form.submitError && (
                  <p role="alert" className="text-2xs text-danger">
                    {form.submitError}
                  </p>
                )}
              </div>
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.ticketEmailTemplates.empty.title')}
              description={t('settings.ticketEmailTemplates.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((template) => (
                <li key={template.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{template.name}</p>
                    <p className="truncate text-2xs text-content-tertiary">{template.subject}</p>
                  </div>

                  <StatusDot
                    tone={template.enabled ? 'success' : 'neutral'}
                    label={
                      template.enabled
                        ? t('settings.ticketEmailTemplates.statusOn')
                        : t('settings.ticketEmailTemplates.statusOff')
                    }
                  />

                  {canEdit && (
                    <>
                      <button
                        type="button"
                        disabled={toggle.isPending}
                        onClick={() =>
                          toggle.mutate({ id: template.id, enabled: !template.enabled })
                        }
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-40"
                      >
                        {template.enabled
                          ? t('settings.ticketEmailTemplates.disable')
                          : t('settings.ticketEmailTemplates.enable')}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove.mutate(template.id)}
                        aria-label={t('settings.ticketEmailTemplates.deleteAriaLabel', {
                          name: template.name,
                        })}
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
    </Section>
  );
}
