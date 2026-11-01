/**
 * Settings → Routing rules (FR-MOD-08.6.2/08.6.3): checked in order, the
 * first rule whose conditions all match decides which team a conversation
 * goes to. Shares the expertise catalogue `Skills.tsx` manages — a condition
 * may name one or more skills, resolved to their names for display here.
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-j, tm
 * 133.10) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated. Existing tests still
 * import it through `./SettingsPage.js`'s re-export, untouched.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
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
import { ChipInput, CountryPicker } from '../../components/settings/RoutingConditionFields.js';

interface RoutingRule {
  id: string;
  name: string | null;
  kind: string;
  conditions: Record<string, unknown>;
  target_group_id: number | null;
  target_group_name: string | null;
  priority: number;
  is_fallback: boolean;
  enabled: boolean;
}

/** Local copy of `Skills.tsx`'s expertise shape — just enough to resolve a name. */
interface Expertise {
  id: number;
  name: string;
  slug: string;
}

/** Just enough of a team to fill the target dropdown. */
interface Team {
  id: number;
  name: string;
}

/** What a rule's condition lists look like in the form (AU-02 · tm 373). */
interface ConditionLists {
  url_contains: string[];
  url_equals: string[];
  country_codes: string[];
}

const NO_CONDITIONS: ConditionLists = { url_contains: [], url_equals: [], country_codes: [] };

/**
 * A stored condition value as a list. The API stores arrays, but a rule written
 * by an older client (or by hand) may hold a bare string — it reads and edits
 * exactly like a one-value list.
 */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value];
  return [];
}

function listsOf(conditions: Record<string, unknown>): ConditionLists {
  return {
    url_contains: asList(conditions.url_contains),
    url_equals: asList(conditions.url_equals),
    country_codes: asList(conditions.country_codes).map((code) => code.toUpperCase()),
  };
}

/** Adds the text still in a chip box, unless it is already a chip. */
function withDraft(values: readonly string[], draft: string): string[] {
  const value = draft.trim();
  return value && !values.includes(value) ? [...values, value] : [...values];
}

export function RoutingRules({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const { confirm, dialog } = useConfirm();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'routing-rules'],
    queryFn: () => api.get<{ items: RoutingRule[] }>('/settings/routing-rules'),
  });

  // Routing rules reference skills by id (`conditions.expertise_ids`); this
  // resolves them to names for display. Same cache key the Skills section
  // above uses, so mounting both costs one fetch, not two.
  const skills = useQuery({
    queryKey: ['settings', 'expertise'],
    queryFn: () => api.get<{ items: Expertise[] }>('/settings/expertise'),
  });
  const skillNameById = new Map((skills.data?.items ?? []).map((skill) => [skill.id, skill.name]));

  // Same `['team', 'groups']` cache key `Teams.tsx`/`Tags.tsx` list under, so
  // mounting this section never doubles that request.
  const teamsQuery = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Team[] }>('/groups'),
  });
  const teams = teamsQuery.data?.items ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'routing-rules'] });
  };

  const create = useMutation({
    mutationFn: (body: {
      name: string;
      conditions?: Partial<ConditionLists>;
      target_group_id: number;
      priority: number;
      is_fallback: boolean;
    }) => api.post<RoutingRule>('/settings/routing-rules', body),
    onSuccess: invalidate,
  });

  // An edit sends the conditions whole — the server replaces the stored object —
  // so `expertise_ids` (managed under Skills, not on this form) rides along.
  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: {
        conditions?: Record<string, unknown>;
        target_group_id: number;
        priority: number;
      };
    }) => api.patch<RoutingRule>(`/settings/routing-rules/${id}`, body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/routing-rules/${id}`),
    onSuccess: invalidate,
  });

  // Flip the switch under the pointer at once: a toggle that waits for the round
  // trip feels broken. The shared optimistic helper writes the new state now and
  // rolls it back if the server refuses, so the UI never keeps a change that did
  // not take (FR-EK-A.2).
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.patch<RoutingRule>(`/settings/routing-rules/${id}`, { enabled }),
    ...optimisticCacheUpdate<{ items: RoutingRule[] }, { id: string; enabled: boolean }>({
      queryClient,
      queryKey: ['settings', 'routing-rules'],
      update: (current, { id, enabled }) => ({
        items: (current?.items ?? []).map((rule) => (rule.id === id ? { ...rule, enabled } : rule)),
      }),
    }),
  });

  // A workspace holds at most one fallback per kind, so the option to create
  // one is offered only while it has none. A dropdown entry whose only possible
  // outcome is a 409 would be a trap; the server's refusal stays as the backstop
  // for two admins filling the form at the same time, and surfaces below.
  const hasFallback = (list.data?.items ?? []).some((rule) => rule.is_fallback);

  // Which shape is being created. Kept outside `useForm` because the URL field's
  // validator depends on it — the fallback matches everything and carries no
  // conditions at all, which is the whole of what makes it the fallback.
  const [asFallback, setAsFallback] = useState(false);

  // The values already added as chips (AU-02 · tm 373). The text still typed in
  // a box lives in the form (`url_contains`, `equalsDraft`) and is added on submit.
  const [lists, setLists] = useState<ConditionLists>(NO_CONDITIONS);
  const [equalsDraft, setEqualsDraft] = useState('');
  // The rule being edited, or null while the form adds a new one. Name and kind
  // are fixed once created; team, priority and conditions can change.
  const [editing, setEditing] = useState<RoutingRule | null>(null);

  const form = useForm({
    initial: { name: '', url_contains: '', target_group_id: '', priority: '0' },
    validators: {
      // A rule keeps the name it was created with; the fallback may have none.
      ...(editing ? {} : { name: required(t('settings.routing.form.nameError')) }),
      target_group_id: required(t('settings.routing.form.teamError')),
      // A conditional rule needs at least one condition, in any of the three
      // kinds — a rule with none would catch everything, which only the
      // fallback is meant to do.
      ...(asFallback
        ? {}
        : {
            url_contains: (value: string) =>
              value.trim() ||
              equalsDraft.trim() ||
              lists.url_contains.length > 0 ||
              lists.url_equals.length > 0 ||
              lists.country_codes.length > 0
                ? null
                : t('settings.routing.form.urlError'),
          }),
    },
    onSubmit: async (values, { setSubmitError, setFieldError, reset }) => {
      const priority = Number(values.priority);
      if (!Number.isInteger(priority) || priority < 0 || priority > 1000) {
        setFieldError('priority', t('settings.routing.form.priorityError'));
        return;
      }
      const conditions: ConditionLists = {
        url_contains: withDraft(lists.url_contains, values.url_contains),
        url_equals: withDraft(lists.url_equals, equalsDraft),
        country_codes: lists.country_codes,
      };
      // Only the kinds that have values: an empty list stored would read as a
      // condition on the rule that is not there.
      const sent: Partial<ConditionLists> = {};
      if (conditions.url_contains.length > 0) sent.url_contains = conditions.url_contains;
      if (conditions.url_equals.length > 0) sent.url_equals = conditions.url_equals;
      if (conditions.country_codes.length > 0) sent.country_codes = conditions.country_codes;
      try {
        if (editing) {
          await update.mutateAsync({
            id: editing.id,
            body: {
              // The fallback's conditions stay empty; sending none leaves them so.
              ...(editing.is_fallback
                ? {}
                : {
                    conditions: {
                      ...sent,
                      ...(editing.conditions.expertise_ids !== undefined
                        ? { expertise_ids: editing.conditions.expertise_ids }
                        : {}),
                    },
                  }),
              target_group_id: Number(values.target_group_id),
              priority,
            },
          });
        } else {
          await create.mutateAsync({
            name: values.name.trim(),
            // The fallback's conditions stay empty — that is what makes it catch
            // everything, so sending one would quietly stop it being the fallback.
            ...(asFallback ? {} : { conditions: sent }),
            target_group_id: Number(values.target_group_id),
            priority,
            is_fallback: asFallback,
          });
        }
        reset();
        setLists(NO_CONDITIONS);
        setEqualsDraft('');
        setAsFallback(false);
        setEditing(null);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const formDirty =
    form.isDirty ||
    equalsDraft !== '' ||
    lists.url_contains.length > 0 ||
    lists.url_equals.length > 0 ||
    lists.country_codes.length > 0;
  useSettingsLeaveGuard(formDirty, form.isSubmitting);
  const nameError = form.errorFor('name');
  const urlError = form.errorFor('url_contains');
  const teamError = form.errorFor('target_group_id');
  const priorityError = form.errorFor('priority');

  const startEdit = (rule: RoutingRule): void => {
    setEditing(rule);
    setAsFallback(rule.is_fallback);
    setLists(listsOf(rule.conditions));
    form.setValue('name', rule.name ?? '');
    form.setValue('url_contains', '');
    setEqualsDraft('');
    form.setValue(
      'target_group_id',
      rule.target_group_id === null ? '' : String(rule.target_group_id),
    );
    form.setValue('priority', String(rule.priority));
  };
  const cancelEdit = (): void => {
    form.reset();
    setLists(NO_CONDITIONS);
    setEqualsDraft('');
    setAsFallback(false);
    setEditing(null);
  };

  return (
    <Section title={t('settings.routing.title')} description={t('settings.routing.description')}>
      {list.error ? (
        <ErrorNotice message={t('settings.routing.loadError')} />
      ) : (
        <Card>
          {canEdit &&
            // Nothing to route to yet: a rule needs a team, and an empty
            // dropdown is a form that cannot be completed. Say so instead.
            (teams.length === 0 ? (
              <p className="border-b border-border p-4 text-sm text-content-secondary">
                {t('settings.routing.form.noTeams')}
              </p>
            ) : (
              <form
                onSubmit={form.handleSubmit}
                noValidate
                className="flex flex-col gap-3 border-b border-border p-4"
              >
                <div className="flex flex-wrap items-start gap-3">
                  <label htmlFor="routing-name" className="flex w-40 flex-col gap-1">
                    <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                      {t('settings.routing.form.nameLabel')}
                    </span>
                    <input
                      id="routing-name"
                      value={form.values.name}
                      onChange={(event) => form.setValue('name', event.target.value)}
                      onBlur={() => form.blur('name')}
                      aria-invalid={nameError ? true : undefined}
                      aria-describedby={nameError ? 'routing-name-error' : undefined}
                      maxLength={120}
                      readOnly={editing !== null}
                      className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary read-only:opacity-60"
                    />
                    <FieldError id="routing-name-error" message={nameError} />
                  </label>

                  <ChipInput
                    id="routing-url"
                    label={t('settings.routing.form.urlLabel')}
                    values={lists.url_contains}
                    draft={form.values.url_contains}
                    placeholder={asFallback ? t('settings.routing.anything') : '/pricing'}
                    disabled={asFallback}
                    error={urlError}
                    onValues={(next) => setLists((current) => ({ ...current, url_contains: next }))}
                    onDraft={(next) => form.setValue('url_contains', next)}
                    onBlur={() => form.blur('url_contains')}
                  />

                  <ChipInput
                    id="routing-url-equals"
                    label={t('settings.routing.form.urlEqualsLabel')}
                    values={lists.url_equals}
                    draft={equalsDraft}
                    placeholder="https://site.com/tr/para-yatir"
                    disabled={asFallback}
                    onValues={(next) => setLists((current) => ({ ...current, url_equals: next }))}
                    onDraft={setEqualsDraft}
                  />

                  <CountryPicker
                    id="routing-country"
                    label={t('settings.routing.form.countryLabel')}
                    values={lists.country_codes}
                    disabled={asFallback}
                    onValues={(next) =>
                      setLists((current) => ({ ...current, country_codes: next }))
                    }
                  />

                  <label htmlFor="routing-team" className="flex w-40 flex-col gap-1">
                    <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                      {t('settings.routing.form.teamLabel')}
                    </span>
                    <select
                      id="routing-team"
                      value={form.values.target_group_id}
                      onChange={(event) => form.setValue('target_group_id', event.target.value)}
                      onBlur={() => form.blur('target_group_id')}
                      aria-invalid={teamError ? true : undefined}
                      aria-describedby={teamError ? 'routing-team-error' : undefined}
                      className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                    >
                      <option value="">{t('settings.routing.form.teamPlaceholder')}</option>
                      {teams.map((team) => (
                        <option key={team.id} value={String(team.id)}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                    <FieldError id="routing-team-error" message={teamError} />
                  </label>

                  <label htmlFor="routing-priority" className="flex w-24 flex-col gap-1">
                    <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                      {t('settings.routing.form.priorityLabel')}
                    </span>
                    <input
                      id="routing-priority"
                      type="number"
                      min={0}
                      max={1000}
                      value={form.values.priority}
                      onChange={(event) => form.setValue('priority', event.target.value)}
                      onBlur={() => form.blur('priority')}
                      aria-invalid={priorityError ? true : undefined}
                      aria-describedby={priorityError ? 'routing-priority-error' : undefined}
                      className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                    />
                    <FieldError id="routing-priority-error" message={priorityError} />
                  </label>

                  <button
                    type="submit"
                    disabled={!form.canSubmit}
                    className="mt-5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                  >
                    {form.isSubmitting
                      ? t('settings.saving')
                      : editing
                        ? t('settings.routing.form.saveButton')
                        : t('settings.routing.form.addButton')}
                  </button>
                  {editing && (
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="mt-5 rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      {t('settings.routing.form.cancelEdit')}
                    </button>
                  )}
                </div>

                {!asFallback && (
                  <p className="text-2xs text-content-tertiary">
                    {t('settings.routing.form.semantics')}{' '}
                    {t('settings.routing.form.unknownCountry')}
                  </p>
                )}

                {!hasFallback && !editing && (
                  <label className="flex items-center gap-2 text-2xs text-content-secondary">
                    <input
                      type="checkbox"
                      checked={asFallback}
                      onChange={(event) => setAsFallback(event.target.checked)}
                      className="size-3.5 rounded border-border"
                    />
                    {t('settings.routing.form.asFallbackLabel')}
                  </label>
                )}

                {form.submitError && (
                  <p role="alert" className="text-2xs text-danger">
                    {form.submitError}
                  </p>
                )}
              </form>
            ))}

          {list.isPending ? (
            <p className="p-4 text-sm text-content-secondary">{t('settings.loading')}</p>
          ) : list.data.items.length === 0 ? (
            <EmptyState
              title={t('settings.routing.empty.title')}
              description={t('settings.routing.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((rule) => (
                <li key={rule.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {ruleLabel(t, rule)}
                      {rule.is_fallback && (
                        <span className="rounded-sm bg-inset px-1.5 py-0.5 text-2xs font-normal text-content-secondary">
                          {t('settings.routing.fallbackBadge')}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-2xs text-content-tertiary">
                      {describeConditions(t, rule.conditions, skillNameById)} →{' '}
                      {rule.target_group_name ?? t('settings.routing.noTeam')}
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
                        aria-label={t('settings.routing.editAriaLabel', {
                          name: ruleLabel(t, rule),
                        })}
                        onClick={() => startEdit(rule)}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('settings.routing.edit')}
                      </button>
                      <button
                        type="button"
                        // The fallback cannot be turned off — conversations that
                        // match nothing would have nowhere to go, and the
                        // configuration would still look healthy.
                        disabled={rule.is_fallback || toggle.isPending}
                        title={
                          rule.is_fallback ? t('settings.routing.fallbackDisabledTitle') : undefined
                        }
                        onClick={() => toggle.mutate({ id: rule.id, enabled: !rule.enabled })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {rule.enabled ? t('settings.disable') : t('settings.enable')}
                      </button>
                      <button
                        type="button"
                        // Deleting the fallback is refused for the reason
                        // disabling it is, and would be the way around that
                        // refusal. Shown disabled rather than hidden so the
                        // constraint is visible where it applies.
                        disabled={rule.is_fallback || remove.isPending}
                        title={
                          rule.is_fallback ? t('settings.routing.fallbackDeleteTitle') : undefined
                        }
                        aria-label={t('settings.routing.deleteAriaLabel', {
                          name: ruleLabel(t, rule),
                        })}
                        onClick={() =>
                          confirm({
                            title: t('settings.routing.deleteConfirmTitle', {
                              name: ruleLabel(t, rule),
                            }),
                            description: t('settings.routing.deleteConfirmDescription'),
                            confirmLabel: t('settings.delete'),
                            failureTitle: t('ui.writeError.delete', { name: ruleLabel(t, rule) }),
                            onConfirm: () => remove.mutateAsync(rule.id),
                          })
                        }
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
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
 * What to call a rule. `name` is nullable — the API may create one without —
 * so the fallback stands in for it, and it has to be the same string in the
 * list and in the delete button's accessible name.
 */
function ruleLabel(t: TFunction, rule: Pick<RoutingRule, 'name' | 'is_fallback'>): string {
  return (
    rule.name ??
    (rule.is_fallback ? t('settings.routing.everythingElse') : t('settings.routing.ruleLabel'))
  );
}

/**
 * Renders the condition JSON as something an admin can read at a glance.
 * Several kinds on one rule all have to hold; several values of one kind are
 * alternatives, so they are joined with "or" and the kinds with "and" — the way
 * the engine reads them (AU-02 · tm 373).
 * `expertise_ids` (FR-MOD-08.6.3) is resolved to skill names via `skillNameById`
 * rather than shown as raw ids; an id with no matching skill (deleted since the
 * rule was written) falls back to `#<id>` instead of disappearing silently.
 * Arbitrary condition keys (`target_group_id`, …) stay as formatted field
 * names rather than a translated phrase — there is no bounded dictionary of
 * condition shapes to translate them against, the same "kapsam dışı" call
 * ticket status/priority raw enums made elsewhere (I18N-f/g).
 */
function describeConditions(
  t: TFunction,
  conditions: Record<string, unknown>,
  skillNameById: Map<number, string> = new Map(),
): string {
  const entries = Object.entries(conditions ?? {}).filter(
    ([, value]) => !Array.isArray(value) || value.length > 0,
  );
  if (entries.length === 0) return t('settings.routing.anything');
  const orJoiner = t('settings.routing.orJoiner');
  return entries
    .map(([key, value]) => {
      if (key === 'expertise_ids' && Array.isArray(value)) {
        const names = value.map((id: unknown) => skillNameById.get(Number(id)) ?? `#${String(id)}`);
        return t('settings.routing.conditionSkill', { names: names.join(', ') });
      }
      if (key === 'url_contains') {
        return t('settings.routing.conditionUrlContains', { values: asList(value).join(orJoiner) });
      }
      if (key === 'url_equals') {
        return t('settings.routing.conditionUrlEquals', { values: asList(value).join(orJoiner) });
      }
      if (key === 'country_codes') {
        return t('settings.routing.conditionCountry', {
          values: asList(value)
            .map((code) => code.toUpperCase())
            .join(orJoiner),
        });
      }
      return `${key.replace(/_/g, ' ')} ${String(value)}`;
    })
    .join(t('settings.andJoiner'));
}
