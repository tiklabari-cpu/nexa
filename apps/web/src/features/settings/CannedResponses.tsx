/**
 * Settings → Saved replies (FR-MOD-08.7.2-ish canned responses).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still carries sections I18N-j (tm 133.10) owns in English.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

interface CannedResponse {
  id: string;
  shortcut: string;
  text: string;
  scope: 'chat' | 'ticket';
}

export function CannedResponses({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'canned-responses'],
    queryFn: () => api.get<{ items: CannedResponse[] }>('/settings/canned-responses?scope=chat'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'canned-responses'] });
    // The composer reads the same replies; leaving its cache alone would mean a
    // new shortcut does not appear until the agent reloads.
    void queryClient.invalidateQueries({ queryKey: ['canned-responses'] });
  };

  const create = useMutation({
    mutationFn: (body: { shortcut: string; text: string }) =>
      api.post<CannedResponse>('/settings/canned-responses', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/canned-responses/${id}`),
    onSuccess: invalidate,
  });

  // The one validation primitive: both fields required, Submit disabled until
  // they are, the fields cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { shortcut: '', text: '' },
    validators: {
      shortcut: required(t('settings.cannedResponses.shortcutError')),
      text: required(t('settings.cannedResponses.replyError')),
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({ shortcut: values.shortcut.trim(), text: values.text.trim() });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const shortcutError = form.errorFor('shortcut');
  const textError = form.errorFor('text');

  return (
    <Section
      title={t('settings.cannedResponses.title')}
      description={t('settings.cannedResponses.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.cannedResponses.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="new-shortcut" className="flex w-48 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.cannedResponses.shortcutLabel')}
                  </span>
                  <div className="flex items-center gap-1">
                    <span aria-hidden="true" className="text-content-tertiary">
                      #
                    </span>
                    <input
                      id="new-shortcut"
                      value={form.values.shortcut}
                      onChange={(event) => form.setValue('shortcut', event.target.value)}
                      onBlur={() => form.blur('shortcut')}
                      aria-invalid={shortcutError ? true : undefined}
                      aria-describedby={shortcutError ? 'new-shortcut-error' : undefined}
                      placeholder="shipping"
                      className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                    />
                  </div>
                  <FieldError id="new-shortcut-error" message={shortcutError} />
                </label>

                <label htmlFor="new-reply" className="flex min-w-56 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.cannedResponses.replyLabel')}
                  </span>
                  <input
                    id="new-reply"
                    value={form.values.text}
                    onChange={(event) => form.setValue('text', event.target.value)}
                    onBlur={() => form.blur('text')}
                    aria-invalid={textError ? true : undefined}
                    aria-describedby={textError ? 'new-reply-error' : undefined}
                    placeholder="Standard delivery takes 3-5 working days."
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="new-reply-error" message={textError} />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting
                    ? t('settings.saving')
                    : t('settings.cannedResponses.saveButton')}
                </button>
              </div>

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
              title={t('settings.cannedResponses.empty.title')}
              description={t('settings.cannedResponses.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((item) => (
                <li key={item.id} className="flex items-start gap-3 px-4 py-2.5">
                  <code className="mt-0.5 shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-2xs">
                    #{item.shortcut}
                  </code>
                  <span className="flex-1 text-sm text-content-secondary">{item.text}</span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(item.id)}
                      aria-label={t('settings.cannedResponses.deleteAriaLabel', {
                        shortcut: item.shortcut,
                      })}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      {t('settings.delete')}
                    </button>
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
