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
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';
import { SaveBar } from '../../components/settings/SaveBar.js';
import { useConfirm } from '../../components/ui/index.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient, useBrand } from '../../lib/auth-store.js';
import { useLeaveGuard } from '../../lib/dirty-guard.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { enumLabel } from '../../lib/enum-label.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  CUSTOM_FIELD_OPTIONS_MAX,
  CUSTOM_FIELD_OPTION_LABEL_MAX,
  CUSTOM_FIELD_TYPES,
  DEFAULT_PRECHAT_CONFIG,
  FORM_PLACEMENTS,
  PRECHAT_FIELD_KEYS,
  formPlacementEntity,
  isChoiceFieldType,
  prechatAsksAnything,
  type CustomFieldDefinition,
  type CustomFieldEntity,
  type CustomFieldOption,
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
  const [options, setOptions] = useState<DraftOption[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const teams = useTeams();

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
      options?: CustomFieldOption[];
    }) => api.post<CustomFieldDefinition>('/settings/custom-fields', body),
    onSuccess: invalidate,
  });

  const update = useMutation({
    mutationFn: ({ id, body }: { id: string; body: FieldPatch }) =>
      api.patch<CustomFieldDefinition>(`/settings/custom-fields/${id}`, body),
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
      const type = values.type as CustomFieldType;
      try {
        await create.mutateAsync({
          // Derived, never chosen: the placement decides where its answers land,
          // and one shared mapping keeps this form, the endpoint and the CHECK
          // constraint from disagreeing about which entity that is.
          entity: formPlacementEntity(placement),
          label: values.label.trim(),
          type,
          required: isRequired,
          form_placement: placement,
          ...(isChoiceFieldType(type) ? { options: toOptions(options, type) } : {}),
        });
        reset();
        setIsRequired(false);
        setOptions([]);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  useSettingsLeaveGuard(form.isDirty, form.isSubmitting);
  const labelError = form.errorFor('label');
  const newType = form.values.type as CustomFieldType;
  const newOptionsError = isChoiceFieldType(newType) ? optionsErrorKey(options) : null;

  // Only the fields asked in the widget: the query returns every custom field,
  // on both entities, but this builder is about the ones with a placement.
  // Grouped by form and in each form's order (WG-04), so the list reads the
  // way the widget asks.
  const fields = (list.data?.items ?? [])
    .filter((field) => field.form_placement !== null)
    .sort(
      (a, b) =>
        FORM_PLACEMENTS.indexOf(a.form_placement!) - FORM_PLACEMENTS.indexOf(b.form_placement!) ||
        a.position - b.position,
    );
  const customPreChatCount = fields.filter((field) => field.form_placement === 'pre_chat').length;
  // One topic per workspace, asked before the chat: the type is offered only
  // where it can be saved.
  const hasTopic = fields.some((field) => field.type === 'topic');
  const offeredTypes = CUSTOM_FIELD_TYPES.filter(
    (type) => type !== 'topic' || (form.values.placement === 'pre_chat' && !hasTopic),
  );

  /** The fields of `field`'s own form, in order — what ↑ / ↓ move it among. */
  const siblings = (field: CustomFieldDefinition) =>
    fields.filter((other) => other.form_placement === field.form_placement);

  const move = (field: CustomFieldDefinition, by: -1 | 1) => {
    const index = siblings(field).indexOf(field);
    update.mutate({ id: field.id, body: { position: index + by } });
  };

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
                  {offeredTypes.map((type) => (
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
                  onChange={(event) => {
                    form.setValue('placement', event.target.value);
                    // A topic is a pre-chat question only.
                    if (event.target.value !== 'pre_chat' && form.values.type === 'topic') {
                      form.setValue('type', 'select');
                    }
                  }}
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
                disabled={!form.canSubmit || newOptionsError !== null}
                className="mt-5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
              >
                {form.isSubmitting ? t('settings.adding') : t('settings.chatForms.addButton')}
              </button>

              {isChoiceFieldType(newType) && (
                <OptionsEditor
                  idPrefix="pcf-new"
                  options={options}
                  onChange={setOptions}
                  topic={newType === 'topic'}
                  teams={teams}
                  errorKey={newOptionsError}
                />
              )}

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
                <li key={field.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                  {canEdit && (
                    <span className="flex flex-col gap-1">
                      <button
                        type="button"
                        aria-label={t('settings.chatForms.moveUp', { label: field.label })}
                        disabled={siblings(field)[0] === field || update.isPending}
                        onClick={() => move(field, -1)}
                        className="rounded border border-border px-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={t('settings.chatForms.moveDown', { label: field.label })}
                        disabled={siblings(field).at(-1) === field || update.isPending}
                        onClick={() => move(field, 1)}
                        className="rounded border border-border px-1.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </span>
                  )}
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
                      aria-expanded={editing === field.id}
                      aria-label={t('settings.chatForms.editAriaLabel', { label: field.label })}
                      onClick={() => setEditing(editing === field.id ? null : field.id)}
                      className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      {t('settings.chatForms.editButton')}
                    </button>
                  )}
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
                  {canEdit && editing === field.id && (
                    <FieldEditor
                      field={field}
                      teams={teams}
                      onCancel={() => setEditing(null)}
                      onSave={async (body) => {
                        await update.mutateAsync({ id: field.id, body });
                        setEditing(null);
                      }}
                    />
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

// --- List questions (WG-04) --------------------------------------------------

/**
 * One option as the admin edits it. `value` is set once the option has been
 * saved and never changes after: rewording the label keeps every stored
 * answer pointing at the same choice. A new option takes its label as value.
 */
interface DraftOption {
  value?: string;
  label: string;
  target_group_id: number | null;
}

interface FieldPatch {
  label?: string;
  required?: boolean;
  options?: CustomFieldOption[];
  position?: number;
}

interface Team {
  id: number;
  name: string;
}

/** The workspace's teams, for a topic option's routing. */
function useTeams(): Team[] {
  const api = useApiClient();
  const teams = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Team[] }>('/groups'),
    staleTime: 60_000,
  });
  return teams.data?.items ?? [];
}

function toOptions(drafts: DraftOption[], type: CustomFieldType): CustomFieldOption[] {
  return drafts.map((draft) => ({
    value: draft.value ?? draft.label.trim(),
    label: draft.label.trim(),
    // Only a topic routes; a team left on a draft of another type is dropped.
    ...(type === 'topic' && draft.target_group_id !== null
      ? { target_group_id: draft.target_group_id }
      : {}),
  }));
}

function draftsOf(field: CustomFieldDefinition): DraftOption[] {
  return (field.options ?? []).map((option) => ({
    value: option.value,
    label: option.label,
    target_group_id: option.target_group_id ?? null,
  }));
}

/**
 * What stops these options being saved, as a catalogue key — the same rules
 * the server holds (`customFieldOptionsProblem`), said in the admin's language.
 * The length cap is the inputs' own `maxLength`, and the count cap disables
 * "Add option", so neither needs a sentence.
 */
function optionsErrorKey(drafts: DraftOption[]): string | null {
  if (drafts.length === 0) return 'settings.chatForms.options.errorEmpty';
  if (drafts.some((draft) => !draft.label.trim())) return 'settings.chatForms.options.errorLabel';
  const values = drafts.map((draft) => draft.value ?? draft.label.trim());
  if (new Set(values).size !== values.length) return 'settings.chatForms.options.errorDuplicate';
  return null;
}

/**
 * The options of a list question: a label per row, and — for a topic — the
 * team that choice routes to (none: the routing rules decide). The visitor
 * sees only the label, so a queue's name never leaks into the widget.
 */
function OptionsEditor({
  idPrefix,
  options,
  onChange,
  topic,
  teams,
  errorKey,
}: {
  idPrefix: string;
  options: DraftOption[];
  onChange: (next: DraftOption[]) => void;
  topic: boolean;
  teams: Team[];
  errorKey: string | null;
}): ReactElement {
  const t = useTranslate();
  const set = (index: number, change: Partial<DraftOption>) =>
    onChange(options.map((option, i) => (i === index ? { ...option, ...change } : option)));

  return (
    <fieldset className="flex w-full flex-col gap-2">
      <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
        {t('settings.chatForms.options.legend')}
      </legend>
      {topic && (
        <p className="text-2xs text-content-secondary">
          {t('settings.chatForms.options.topicHint')}
        </p>
      )}
      {options.map((option, index) => (
        <div key={index} className="flex flex-wrap items-center gap-2">
          <input
            id={`${idPrefix}-option-${index}`}
            value={option.label}
            onChange={(event) => set(index, { label: event.target.value })}
            aria-label={t('settings.chatForms.options.labelAria', { index: index + 1 })}
            maxLength={CUSTOM_FIELD_OPTION_LABEL_MAX}
            className="w-56 rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
          {topic && (
            <select
              value={option.target_group_id ?? ''}
              onChange={(event) =>
                set(index, {
                  target_group_id: event.target.value ? Number(event.target.value) : null,
                })
              }
              aria-label={t('settings.chatForms.options.teamAria', { index: index + 1 })}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
            >
              <option value="">{t('settings.chatForms.options.noTeam')}</option>
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={() => onChange(options.filter((_, i) => i !== index))}
            aria-label={t('settings.chatForms.options.removeAria', { index: index + 1 })}
            className="rounded border border-border px-1.5 py-0.5 text-2xs text-content-secondary transition-colors hover:bg-surface-2 hover:text-danger"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={options.length >= CUSTOM_FIELD_OPTIONS_MAX}
        onClick={() => onChange([...options, { label: '', target_group_id: null }])}
        className="self-start rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        {t('settings.chatForms.options.add')}
      </button>
      {errorKey && <p className="text-2xs text-content-secondary">{t(errorKey)}</p>}
    </fieldset>
  );
}

/**
 * Edit a form question in place (WG-04): its label, whether it is required
 * and, for a list, its options. The type and the form it is on stay — a
 * re-typed field is a new field, and its answers were given to this one.
 */
function FieldEditor({
  field,
  teams,
  onSave,
  onCancel,
}: {
  field: CustomFieldDefinition;
  teams: Team[];
  onSave: (body: FieldPatch) => Promise<void>;
  onCancel: () => void;
}): ReactElement {
  const t = useTranslate();
  const [label, setLabel] = useState(field.label);
  const [isRequired, setIsRequired] = useState(field.required);
  const [options, setOptions] = useState(() => draftsOf(field));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const choice = isChoiceFieldType(field.type);
  const optionsError = choice ? optionsErrorKey(options) : null;
  const id = `pcf-edit-${field.id}`;

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!label.trim() || optionsError || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({
        label: label.trim(),
        required: isRequired,
        ...(choice ? { options: toOptions(options, field.type) } : {}),
      });
    } catch (cause) {
      setError(t(errorMessageKey(cause)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      noValidate
      className="flex w-full flex-wrap items-start gap-3 rounded-md bg-surface-2 p-3"
    >
      <label htmlFor={`${id}-label`} className="flex w-56 flex-col gap-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
          {t('settings.chatForms.labelLabel')}
        </span>
        <input
          id={`${id}-label`}
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={120}
          className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
        />
      </label>
      <label className="mt-5 flex items-center gap-2 py-1.5 text-sm text-content-secondary">
        <input
          type="checkbox"
          checked={isRequired}
          onChange={(event) => setIsRequired(event.target.checked)}
        />
        {t('settings.requiredLabel')}
      </label>
      {choice && (
        <OptionsEditor
          idPrefix={id}
          options={options}
          onChange={setOptions}
          topic={field.type === 'topic'}
          teams={teams}
          errorKey={optionsError}
        />
      )}
      <div className="flex w-full gap-2">
        <button
          type="submit"
          disabled={!label.trim() || optionsError !== null || saving}
          className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
        >
          {saving ? t('settings.saving') : t('settings.save')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2"
        >
          {t('settings.cancel')}
        </button>
      </div>
      {error && (
        <p role="alert" className="w-full text-2xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
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
              if (canEdit && draft && !save.isPending) save.mutate(draft);
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
              <SaveBar
                submit
                dirty={dirty}
                saving={save.isPending}
                error={save.error}
                onDiscard={() => {
                  save.reset();
                  setDraft(null);
                }}
              />
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
