/**
 * Settings → Chat forms (FR-MOD-08.7.7, "Forms builder (pre/post-chat)").
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still carries sections I18N-j (tm 133.10) owns in English.
 *
 * A field asked in the widget — before the conversation starts (`pre_chat`) or
 * once it ends (`post_chat`). Each is a contact custom field carrying that
 * placement, so an answer is validated by its `type` (KK "tip validasyon") and
 * lands on the contact like any other field (KK "widget'ta gösterim →
 * contact'a yazma") — visible in the CRM, no parallel store. "At least one
 * field": the widget shows a form only once one exists here for that placement.
 *
 * One builder with a placement selector rather than two sections, because the
 * two forms differ in exactly one property and nothing else: same fields, same
 * types, same destination. Two sections would be the same list rendered twice
 * with a filter, and moving a question from one form to the other would mean
 * deleting it and losing the answers already stored under its id.
 *
 * The `type` values themselves (`text`, `number`, …) are left untranslated —
 * the same raw-enum precedent as `CustomFieldsSettings.tsx`. The placements are
 * not: they are product concepts a workspace admin chooses between, not a
 * server enum leaking through.
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
  CUSTOM_FIELD_TYPES,
  FORM_PLACEMENTS,
  type CustomFieldDefinition,
  type CustomFieldType,
  type FormPlacement,
} from '@nexa/types';

export function ChatFormsSettings({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [isRequired, setIsRequired] = useState(false);

  const list = useQuery({
    queryKey: ['settings', 'custom-fields', 'chat-forms'],
    queryFn: () =>
      api.get<{ items: CustomFieldDefinition[] }>('/settings/custom-fields?entity=contact'),
  });

  // Prefix-invalidate so the CRM custom-fields list refreshes too: a form field
  // is a contact custom field, and it appears in both places.
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'custom-fields'] });

  const create = useMutation({
    mutationFn: (body: {
      label: string;
      type: CustomFieldType;
      required: boolean;
      form_placement: FormPlacement;
    }) =>
      api.post<CustomFieldDefinition>('/settings/custom-fields', {
        entity: 'contact',
        ...body,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/custom-fields/${id}`),
    onSuccess: invalidate,
  });

  const form = useForm({
    initial: { label: '', type: 'text', placement: 'pre_chat' },
    validators: { label: required(t('settings.chatForms.labelError')) },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          label: values.label.trim(),
          type: values.type as CustomFieldType,
          required: isRequired,
          form_placement: values.placement as FormPlacement,
        });
        reset();
        setIsRequired(false);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const labelError = form.errorFor('label');

  // Only the fields asked in the widget: the query returns every contact field,
  // but this builder is about the ones with a placement.
  const fields = (list.data?.items ?? []).filter((field) => field.form_placement !== null);

  return (
    <Section
      title={t('settings.chatForms.title')}
      description={t('settings.chatForms.description')}
    >
      {list.error ? (
        <ErrorNotice message={t('settings.chatForms.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-end gap-3 border-b border-border p-4"
            >
              <label htmlFor="pcf-label" className="flex w-48 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.chatForms.labelLabel')}
                </span>
                <input
                  id="pcf-label"
                  value={form.values.label}
                  onChange={(event) => form.setValue('label', event.target.value)}
                  onBlur={() => form.blur('label')}
                  aria-invalid={labelError ? true : undefined}
                  aria-describedby={labelError ? 'pcf-label-error' : undefined}
                  placeholder="Order number"
                  maxLength={120}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
                <FieldError id="pcf-label-error" message={labelError} />
              </label>

              <label htmlFor="pcf-type" className="flex w-32 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.chatForms.typeLabel')}
                </span>
                <select
                  id="pcf-type"
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

              {/* Which form the question belongs to — the one thing that makes a
                  contact field a pre- or a post-chat question. */}
              <label htmlFor="pcf-placement" className="flex w-40 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.chatForms.placementLabel')}
                </span>
                <select
                  id="pcf-placement"
                  value={form.values.placement}
                  onChange={(event) => form.setValue('placement', event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                >
                  {FORM_PLACEMENTS.map((placement) => (
                    <option key={placement} value={placement}>
                      {t(placementKey(placement))}
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
                {form.isSubmitting ? t('settings.adding') : t('settings.chatForms.addButton')}
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
          ) : fields.length === 0 ? (
            <EmptyState
              title={t('settings.chatForms.empty.title')}
              description={t('settings.chatForms.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {fields.map((field) => (
                <li key={field.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex-1 text-sm font-medium">{field.label}</span>
                  {/* Which form it shows on — otherwise one flat list gives no
                      way to tell a pre-chat question from a post-chat one. */}
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 text-2xs text-content-secondary">
                    {t(placementKey(field.form_placement ?? 'pre_chat'))}
                  </span>
                  <span className="text-2xs text-content-tertiary">
                    {field.type}
                    {field.required ? t('settings.requiredSuffix') : ''}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => remove.mutate(field.id)}
                      aria-label={t('settings.chatForms.deleteAriaLabel', { label: field.label })}
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

/** `pre_chat` → the catalogue key naming it. One mapping, two call sites. */
function placementKey(placement: FormPlacement): string {
  return placement === 'post_chat'
    ? 'settings.chatForms.placement.postChat'
    : 'settings.chatForms.placement.preChat';
}
