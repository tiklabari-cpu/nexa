/**
 * Settings → Custom fields (FR-MOD-08.7.6).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still carries sections I18N-j (tm 133.10) owns in English.
 *
 * Define custom fields on tickets and contacts. A field carries the two
 * properties the requirement turns on: a `type`, which decides how a value is
 * validated, and whether it is `required`. Once defined, a field shows up on
 * the ticket Details pane and in the CRM, where its values are set. The label
 * and a chosen type are required to add one (FR-EK-A.1), and a duplicate label
 * on the same entity is refused by the server.
 *
 * The `type` values themselves (`text`, `number`, …) are left untranslated —
 * they are a raw enum the screen has never mapped to a label (133.6's ticket
 * status/priority precedent), not UI-authored prose.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  CUSTOM_FIELD_ENTITIES,
  CUSTOM_FIELD_TYPES,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
} from '@nexa/types';

export function CustomFieldsSettings({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [isRequired, setIsRequired] = useState(false);

  const list = useQuery({
    queryKey: ['settings', 'custom-fields'],
    queryFn: () => api.get<{ items: CustomFieldDefinition[] }>('/settings/custom-fields'),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'custom-fields'] });

  const create = useMutation({
    mutationFn: (body: {
      entity: CustomFieldEntity;
      label: string;
      type: CustomFieldType;
      required: boolean;
    }) => api.post<CustomFieldDefinition>('/settings/custom-fields', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/custom-fields/${id}`),
    onSuccess: invalidate,
  });

  // Label, entity and type are all needed; the label is the one that can be
  // typed wrong, so it carries the field-under validation (FR-EK-A.1).
  const form = useForm({
    initial: { label: '', entity: 'ticket', type: 'text' },
    validators: { label: required(t('settings.customFields.labelError')) },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          entity: values.entity as CustomFieldEntity,
          label: values.label.trim(),
          type: values.type as CustomFieldType,
          required: isRequired,
        });
        reset();
        setIsRequired(false);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const labelError = form.errorFor('label');

  const entityLabel = (entity: string): string =>
    entity === 'ticket'
      ? t('settings.customFields.entity.ticket')
      : t('settings.customFields.entity.contact');

  return (
    <Section
      title={t('settings.customFields.title')}
      description={t('settings.customFields.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.customFields.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="cf-label" className="flex w-48 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.customFields.labelLabel')}
                </span>
                <input
                  id="cf-label"
                  value={form.values.label}
                  onChange={(event) => form.setValue('label', event.target.value)}
                  onBlur={() => form.blur('label')}
                  aria-invalid={labelError ? true : undefined}
                  aria-describedby={labelError ? 'cf-label-error' : undefined}
                  placeholder="Player ID"
                  maxLength={120}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="cf-label-error" message={labelError} />
              </label>

              <label htmlFor="cf-entity" className="flex w-32 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.customFields.onLabel')}
                </span>
                <select
                  id="cf-entity"
                  value={form.values.entity}
                  onChange={(event) => form.setValue('entity', event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                >
                  {CUSTOM_FIELD_ENTITIES.map((entity) => (
                    <option key={entity} value={entity}>
                      {entityLabel(entity)}
                    </option>
                  ))}
                </select>
              </label>

              <label htmlFor="cf-type" className="flex w-32 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.customFields.typeLabel')}
                </span>
                <select
                  id="cf-type"
                  value={form.values.type}
                  onChange={(event) => form.setValue('type', event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                >
                  {CUSTOM_FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 pb-1.5 text-sm text-content-secondary">
                <input
                  type="checkbox"
                  checked={isRequired}
                  onChange={(event) => setIsRequired(event.target.checked)}
                />
                {t('settings.requiredLabel')}
              </label>

              <button
                type="submit"
                disabled={!form.canSubmit}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? t('settings.adding') : t('settings.customFields.addButton')}
              </button>

              {form.submitError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.customFields.empty.title')}
              description={t('settings.customFields.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((field) => (
                <li key={field.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-sm font-medium">{field.label}</span>
                  <span className="text-2xs text-content-tertiary">
                    {entityLabel(field.entity)} · {field.type}
                    {field.required ? t('settings.requiredSuffix') : ''}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(field.id)}
                      aria-label={t('settings.customFields.deleteAriaLabel', {
                        label: field.label,
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
