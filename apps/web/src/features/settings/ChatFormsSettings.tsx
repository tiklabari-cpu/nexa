/**
 * Settings → Chat forms (FR-MOD-08.7.7, "Forms builder
 * (pre-chat/post-chat/ticket/prospect)").
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still carries sections I18N-j (tm 133.10) owns in English.
 *
 * A field asked in the widget — before the conversation starts (`pre_chat`),
 * once it ends (`post_chat`), or, when nobody is available and the visitor
 * leaves a message instead, about that request (`ticket`) or about the person
 * leaving it (`prospect`). Each is a custom field carrying that placement, so an
 * answer is validated by its `type` (KK "tip validasyon") and lands on a real
 * record like any other field (KK "widget'ta gösterim → contact/ticket'a
 * yazma") — visible in the CRM or on the ticket, no parallel store. "At least
 * one field": the widget shows a form only once one exists here for it.
 *
 * One builder with a placement selector rather than four sections, because the
 * forms differ in exactly one property: same fields, same types, same authoring.
 * Four sections would be the same list rendered four times with a filter, and
 * moving a question between forms would mean deleting it and losing the answers
 * already stored under its id.
 *
 * The `entity` is not offered as a choice: a placement already decides it
 * (`formPlacementEntity`), and letting an admin pick both would let them build a
 * combination the endpoint and the migration's CHECK would then refuse.
 *
 * The `type` values themselves (`text`, `number`, …) are left untranslated —
 * the same raw-enum precedent as `CustomFieldsSettings.tsx`. The placements are
 * not: they are product concepts a workspace admin chooses between, not a
 * server enum leaking through.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useConfirm } from '../../components/ui/index.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useBrand } from '../../lib/auth-store.js';
import { useLeaveGuard } from '../../lib/dirty-guard.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { enumLabel } from '../../lib/enum-label.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  CUSTOM_FIELD_TYPES,
  DEFAULT_PRECHAT_CONFIG,
  FORM_PLACEMENTS,
  PRECHAT_FIELD_KEYS,
  formPlacementEntity,
  prechatAsksAnything,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldType,
  type FormPlacement,
  type PrechatConfig,
  type PrechatFieldKey,
} from '@siyahtus/types';

export function ChatFormsSettings({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const { confirm, dialog } = useConfirm();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [isRequired, setIsRequired] = useState(false);

  // Every custom field, not one entity's: a form question is now either a
  // contact field or — for the `ticket` placement — a ticket one, and asking
  // for a single entity would hide half the builder's own list.
  const list = useQuery({
    queryKey: ['settings', 'custom-fields', 'chat-forms'],
    queryFn: () => api.get<{ items: CustomFieldDefinition[] }>('/settings/custom-fields'),
  });

  // Prefix-invalidate so the CRM custom-fields list refreshes too: a form field
  // is a contact custom field, and it appears in both places.
  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['settings', 'custom-fields'] });

  const create = useMutation({
    mutationFn: (body: {
      entity: CustomFieldEntity;
      label: string;
      type: CustomFieldType;
      required: boolean;
      form_placement: FormPlacement;
    }) => api.post<CustomFieldDefinition>('/settings/custom-fields', body),
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
      const placement = values.placement as FormPlacement;
      try {
        await create.mutateAsync({
          // Derived, never chosen: the placement decides where its answers land,
          // and one shared mapping keeps this form, the endpoint and the CHECK
          // constraint from disagreeing about which entity that is.
          entity: formPlacementEntity(placement),
          label: values.label.trim(),
          type: values.type as CustomFieldType,
          required: isRequired,
          form_placement: placement,
        });
        reset();
        setIsRequired(false);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const labelError = form.errorFor('label');

  // Only the fields asked in the widget: the query returns every custom field,
  // on both entities, but this builder is about the ones with a placement.
  const fields = (list.data?.items ?? []).filter((field) => field.form_placement !== null);
  const customPreChatCount = fields.filter((field) => field.form_placement === 'pre_chat').length;

  return (
    <Section
      title={t('settings.chatForms.title')}
      description={t('settings.chatForms.description')}
    >
      <BuiltInPrechatFields canEdit={canEdit} customPreChatCount={customPreChatCount} />
      {list.error ? (
        <ErrorNotice message={t('settings.chatForms.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-wrap items-start gap-3 border-b border-border p-4"
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
                  placeholder={t('settings.chatForms.labelPlaceholder')}
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
                      {enumLabel(t, 'settings.fieldType', type)}
                    </option>
                  ))}
                </select>
              </label>

              {/* Which form the question belongs to — the one property that
                  separates the four, and the one that decides whether the
                  answer is about the person or about the request. */}
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

              <label className="mt-5 flex items-center gap-2 py-1.5 text-sm text-content-secondary">
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
                className="mt-5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
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
                    {enumLabel(t, 'settings.fieldType', field.type)}
                    {field.required ? t('settings.requiredSuffix') : ''}
                  </span>
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() =>
                        confirm({
                          title: t('settings.chatForms.deleteConfirmTitle', { label: field.label }),
                          description: t('settings.chatForms.deleteConfirmDescription'),
                          confirmLabel: t('settings.delete'),
                          failureTitle: t('ui.writeError.delete', { name: field.label }),
                          onConfirm: () => remove.mutateAsync(field.id),
                        })
                      }
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
      {dialog}
    </Section>
  );
}

/**
 * `pre_chat` → the catalogue key naming it. One mapping, two call sites.
 *
 * A lookup rather than a chain of ternaries now that there are four: a chain
 * silently falls through to whichever branch is last when a placement is added,
 * printing the wrong name instead of failing.
 */
const PLACEMENT_KEYS: Record<FormPlacement, string> = {
  pre_chat: 'settings.chatForms.placement.preChat',
  post_chat: 'settings.chatForms.placement.postChat',
  ticket: 'settings.chatForms.placement.ticket',
  prospect: 'settings.chatForms.placement.prospect',
};

function placementKey(placement: FormPlacement): string {
  return PLACEMENT_KEYS[placement];
}

// --- Built-in fields (WG-01) -------------------------------------------------

interface PrechatSettings extends PrechatConfig {
  brand_id: string;
  /** False until this brand saves the form; only a saved form is enforced server-side. */
  configured: boolean;
}

const BUILT_IN_LABEL_KEYS: Record<PrechatFieldKey, string> = {
  name: 'settings.chatForms.builtIn.field.name',
  username: 'settings.chatForms.builtIn.field.username',
  email: 'settings.chatForms.builtIn.field.email',
  message: 'settings.chatForms.builtIn.field.message',
};

/**
 * The widget's own pre-chat form (WG-01): whether it opens before a first
 * conversation, and which of its four fixed fields it shows and requires.
 *
 * Brand-scoped like the widget appearance — the active brand's row, and a
 * brand switch drops an unsaved draft rather than carrying it over. The whole
 * form is one draft saved at once (the endpoint replaces it whole), with a
 * leave guard while it holds unsaved changes and a preview of what a visitor
 * will be asked. `required ⇒ visible` is kept by the controls themselves:
 * hiding a field clears its requirement, and a hidden field's requirement
 * cannot be ticked.
 */
function BuiltInPrechatFields({
  canEdit,
  customPreChatCount,
}: {
  canEdit: boolean;
  customPreChatCount: number;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const { brandId } = useBrand();
  const [draft, setDraft] = useState<PrechatConfig | null>(null);

  useEffect(() => setDraft(null), [brandId]);

  const settings = useQuery({
    queryKey: ['settings', 'prechat', brandId],
    queryFn: () => api.get<PrechatSettings>('/settings/prechat'),
  });

  const save = useMutation({
    mutationFn: (body: PrechatConfig) => api.put<PrechatSettings>('/settings/prechat', body),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings', 'prechat', brandId], data);
      setDraft(null);
    },
  });

  const dirty = draft !== null;
  useLeaveGuard(dirty && !save.isPending, t('settings.chatForms.builtIn.leaveMessage'));

  if (settings.error) {
    return <ErrorNotice message={t('settings.chatForms.builtIn.loadError')} />;
  }

  const saved = settings.data;
  const value: PrechatConfig = draft ?? {
    enabled: saved?.enabled ?? DEFAULT_PRECHAT_CONFIG.enabled,
    fields: saved?.fields ?? DEFAULT_PRECHAT_CONFIG.fields,
  };
  const update = (next: PrechatConfig): void => setDraft(next);
  const setRule = (key: PrechatFieldKey, visible: boolean, isRequired: boolean): void =>
    update({
      ...value,
      // Hidden is never required — the endpoint and the database refuse it.
      fields: { ...value.fields, [key]: { visible, required: visible && isRequired } },
    });

  return (
    <Card>
      <div className="flex flex-col gap-1 border-b border-border p-4">
        <h3 className="text-sm font-semibold">{t('settings.chatForms.builtIn.title')}</h3>
        <p className="text-2xs text-content-secondary">
          {t('settings.chatForms.builtIn.description')}
        </p>
      </div>
      {settings.isPending ? (
        <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
      ) : (
        <div className="grid gap-6 p-4 md:grid-cols-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canEdit && draft) save.mutate(draft);
            }}
            className="flex flex-col gap-4"
          >
            <fieldset disabled={!canEdit} className="flex flex-col gap-4 border-0 p-0">
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={value.enabled}
                  onChange={(event) => update({ ...value, enabled: event.target.checked })}
                />
                <span>{t('settings.chatForms.builtIn.enabledLabel')}</span>
              </label>
              <p className="-mt-2 text-2xs text-content-tertiary">
                {t('settings.chatForms.builtIn.enabledHint')}
              </p>
              {!value.enabled && customPreChatCount > 0 && (
                <p role="status" className="text-2xs text-warning">
                  {t('settings.chatForms.builtIn.customHidden')}
                </p>
              )}

              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-2xs uppercase tracking-wide text-content-tertiary">
                    <th scope="col" className="py-1 font-medium">
                      {t('settings.chatForms.builtIn.fieldColumn')}
                    </th>
                    <th scope="col" className="py-1 text-center font-medium">
                      {t('settings.chatForms.builtIn.showColumn')}
                    </th>
                    <th scope="col" className="py-1 text-center font-medium">
                      {t('settings.chatForms.builtIn.requiredColumn')}
                    </th>
                  </tr>
                </thead>
                <tbody className={value.enabled ? undefined : 'opacity-60'}>
                  {PRECHAT_FIELD_KEYS.map((key) => {
                    const rule = value.fields[key];
                    const label = t(BUILT_IN_LABEL_KEYS[key]);
                    return (
                      <tr key={key} className="border-t border-border">
                        <th scope="row" className="py-2 text-left font-normal">
                          {label}
                        </th>
                        <td className="py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={t('settings.chatForms.builtIn.showAria', { field: label })}
                            checked={rule.visible}
                            disabled={!value.enabled}
                            onChange={(event) => setRule(key, event.target.checked, rule.required)}
                          />
                        </td>
                        <td className="py-2 text-center">
                          <input
                            type="checkbox"
                            aria-label={t('settings.chatForms.builtIn.requireAria', {
                              field: label,
                            })}
                            checked={rule.required}
                            disabled={!value.enabled || !rule.visible}
                            onChange={(event) => setRule(key, rule.visible, event.target.checked)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {value.enabled && !value.fields.username.visible && (
                <p role="status" className="text-2xs text-warning">
                  {t('settings.chatForms.builtIn.usernameWarning')}
                </p>
              )}
              {value.enabled && !value.fields.message.visible && (
                <p className="text-2xs text-content-tertiary">
                  {t('settings.chatForms.builtIn.messageHint')}
                </p>
              )}
            </fieldset>

            {saved && !saved.configured && !dirty && (
              <p className="text-2xs text-content-tertiary">
                {t('settings.chatForms.builtIn.notSaved')}
              </p>
            )}

            {canEdit && (
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!dirty || save.isPending}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {save.isPending ? t('settings.saving') : t('settings.chatForms.builtIn.save')}
                </button>
                {dirty && (
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="rounded-md border border-border px-3 py-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                  >
                    {t('settings.chatForms.builtIn.reset')}
                  </button>
                )}
                {save.isError && (
                  <p role="alert" className="text-2xs text-danger">
                    {t(errorMessageKey(save.error))}
                  </p>
                )}
              </div>
            )}
          </form>

          <PrechatPreview config={value} customPreChatCount={customPreChatCount} />
        </div>
      )}
    </Card>
  );
}

/**
 * What a visitor will be asked, drawn from the draft as it is edited — the
 * fields in the widget's order, a star on each required one. Decorative:
 * hidden from assistive tech, since the controls beside it already say it all.
 */
function PrechatPreview({
  config,
  customPreChatCount,
}: {
  config: PrechatConfig;
  customPreChatCount: number;
}): ReactElement {
  const t = useTranslate();
  const asks = prechatAsksAnything(config, customPreChatCount);
  return (
    <div className="flex flex-col gap-2">
      <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('settings.chatForms.builtIn.preview')}
      </span>
      <div
        aria-hidden="true"
        data-testid="prechat-preview"
        className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3"
      >
        {asks ? (
          <>
            {PRECHAT_FIELD_KEYS.filter((key) => config.fields[key].visible).map((key) => (
              <div key={key} className="flex flex-col gap-1">
                <span className="text-2xs text-content-secondary">
                  {t(BUILT_IN_LABEL_KEYS[key])}
                  {config.fields[key].required && <span className="text-danger"> *</span>}
                </span>
                <span
                  className={`rounded-md border border-border bg-surface ${
                    key === 'message' ? 'h-12' : 'h-7'
                  }`}
                />
              </div>
            ))}
            <span className="mt-1 self-start rounded-md bg-brand-500 px-3 py-1 text-2xs font-medium text-white">
              {t('settings.chatForms.builtIn.previewSubmit')}
            </span>
          </>
        ) : (
          <p className="text-2xs text-content-secondary">
            {t('settings.chatForms.builtIn.previewOff')}
          </p>
        )}
      </div>
    </div>
  );
}
