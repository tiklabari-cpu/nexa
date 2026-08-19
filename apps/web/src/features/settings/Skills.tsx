/**
 * The catalogue skill-based routing draws on (FR-MOD-08.6.3): create a skill
 * here, then require it in a routing rule's conditions or assign it to an
 * agent in Team. Deleting one also drops it from any routing rule or agent
 * that referenced it — the server cascades that, this screen just reflects it
 * on the next load.
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-j, tm
 * 133.10) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated. Existing tests still
 * import it through `./SettingsPage.js`'s re-export, untouched.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { EXPERTISE_NAME_MAX_LENGTH } from '@nexa/types';
import { optimisticCacheUpdate } from '../../lib/optimistic.js';

/**
 * An area of expertise (FR-MOD-08.6.3). Called "expertise" at the API layer
 * because "skill" already names the Playbook automation concept (ADR-14); this
 * product surface still labels it Skills.
 */
interface Expertise {
  id: number;
  name: string;
  slug: string;
}

export function Skills({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'expertise'],
    queryFn: () => api.get<{ items: Expertise[] }>('/settings/expertise'),
  });

  const create = useMutation({
    mutationFn: (body: { name: string }) => api.post<Expertise>('/settings/expertise', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings', 'expertise'] });
    },
  });

  // Delete moves the row out at once, rolling back if the server refuses —
  // the same optimistic behaviour the routing rules use (FR-EK-A.2).
  const remove = useMutation({
    mutationFn: (id: number) => api.delete(`/settings/expertise/${id}`),
    ...optimisticCacheUpdate<{ items: Expertise[] }, number>({
      queryClient,
      queryKey: ['settings', 'expertise'],
      update: (current, id) => ({
        items: (current?.items ?? []).filter((skill) => skill.id !== id),
      }),
    }),
  });

  // The one validation primitive: a name is required, Submit disabled until it
  // is present, the field cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { name: '' },
    validators: { name: required(t('settings.skills.nameError')) },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({ name: values.name.trim() });
        reset();
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const nameError = form.errorFor('name');

  return (
    <Section title={t('settings.skills.title')} description={t('settings.skills.description')}>
      {list.error ? (
        <ErrorNotice message={t('settings.skills.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="new-skill-name" className="flex min-w-56 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.skills.nameLabel')}
                  </span>
                  <input
                    id="new-skill-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'new-skill-name-error' : undefined}
                    placeholder="Billing"
                    maxLength={EXPERTISE_NAME_MAX_LENGTH}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="new-skill-name-error" message={nameError} />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? t('settings.adding') : t('settings.skills.addButton')}
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
              title={t('settings.skills.empty.title')}
              description={t('settings.skills.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((skill) => (
                <li key={skill.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-sm">{skill.name}</span>
                  {canEdit && (
                    <button
                      type="button"
                      disabled={remove.isPending}
                      onClick={() => remove.mutate(skill.id)}
                      aria-label={t('settings.skills.deleteAriaLabel', { name: skill.name })}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
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
