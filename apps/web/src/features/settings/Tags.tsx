/**
 * Settings → Tag library (FR-MOD-08.7.1).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still carries sections I18N-j (tm 133.10) owns in English.
 *
 * The workspace's curated tags. Chat-level tagging already worked — an agent
 * could type any word — but nothing agreed the vocabulary, so a team ended up
 * with `vip`, `VIP` and `v.i.p.` for one idea. This library is that agreement:
 * the inbox reads the same list to suggest tags, and `usage_count` shows which
 * labels are actually earning their place.
 *
 * A tag can also be scoped to one or more teams (`group_ids`) rather than the
 * whole workspace — the server (`routes/settings.ts`) has accepted and
 * validated this on both create and update from the start, but nothing here
 * let anyone set it: the list only ever printed how many teams a tag was
 * scoped to, never which ones, and there was no way to change it after
 * creation. The checkboxes below are that missing write path, not a new
 * endpoint.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';

interface Tag {
  id: string;
  name: string;
  group_ids: number[];
  author_id: string | null;
  usage_count: number;
  created_at: string;
}

/** Local copy of `Teams.tsx`'s `Group` shape — just enough to render a checkbox list. */
interface Team {
  id: number;
  name: string;
}

export function Tags({ canEdit }: { canEdit: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'tags'],
    queryFn: () => api.get<{ items: Tag[] }>('/settings/tags'),
  });

  // Same `['team', 'groups']` cache key `Teams.tsx`/`TeamMembers.tsx` list
  // under — mounting this section never doubles that request. Every agent
  // holds at least `groups--my:ro` (`DEFAULT_AGENT_SCOPES`), so the list is
  // always readable here regardless of `canEdit`.
  const teamsQuery = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Team[] }>('/groups'),
  });
  const teams = teamsQuery.data?.items ?? [];

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'tags'] });
    // The inbox suggests tags from this same list; leaving its cache alone would
    // keep a new tag hidden from the composer until the agent reloads.
    void queryClient.invalidateQueries({ queryKey: ['tag-library'] });
  };

  const [newTagTeamIds, setNewTagTeamIds] = useState<number[]>([]);

  const create = useMutation({
    mutationFn: (body: { name: string; group_ids: number[] }) =>
      api.post<Tag>('/settings/tags', body),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/tags/${id}`),
    onSuccess: invalidate,
  });

  const updateTeams = useMutation({
    mutationFn: ({ id, group_ids }: { id: string; group_ids: number[] }) =>
      api.patch<Tag>(`/settings/tags/${id}`, { group_ids }),
    onSuccess: invalidate,
  });

  // `null` closed, otherwise the id of the tag whose team scope is being edited.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTeamIds, setEditTeamIds] = useState<number[]>([]);
  const [editError, setEditError] = useState<string | null>(null);

  function startEditingTeams(tag: Tag): void {
    setEditingId(tag.id);
    setEditTeamIds(tag.group_ids);
    setEditError(null);
  }

  function cancelEditingTeams(): void {
    setEditingId(null);
    setEditError(null);
  }

  async function saveTeams(): Promise<void> {
    if (!editingId) return;
    try {
      await updateTeams.mutateAsync({ id: editingId, group_ids: editTeamIds });
      setEditingId(null);
      setEditError(null);
    } catch (error) {
      setEditError(t(errorMessageKey(error)));
    }
  }

  // The one validation primitive: a name is required, Submit disabled until it
  // is present, the field cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { name: '' },
    validators: { name: required(t('settings.tags.nameError')) },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({ name: values.name.trim(), group_ids: newTagTeamIds });
        reset();
        setNewTagTeamIds([]);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  const nameError = form.errorFor('name');

  return (
    <Section title={t('settings.tags.title')} description={t('settings.tags.description')}>
      {list.error ? (
        <ErrorNotice message={t('settings.tags.loadError')} />
      ) : (
        <Card>
          {canEdit && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-end gap-3">
                <label htmlFor="new-tag-name" className="flex min-w-56 flex-1 flex-col gap-1">
                  <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.tags.tagLabel')}
                  </span>
                  <input
                    id="new-tag-name"
                    value={form.values.name}
                    onChange={(event) => form.setValue('name', event.target.value)}
                    onBlur={() => form.blur('name')}
                    aria-invalid={nameError ? true : undefined}
                    aria-describedby={nameError ? 'new-tag-name-error' : undefined}
                    placeholder="vip"
                    maxLength={64}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="new-tag-name-error" message={nameError} />
                </label>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting ? t('settings.adding') : t('settings.tags.addButton')}
                </button>
              </div>

              {teams.length > 0 && (
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                    {t('settings.tags.teamsLabel')}
                  </legend>
                  <p className="text-2xs text-content-tertiary">{t('settings.tags.teamsHint')}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {teams.map((team) => (
                      <label key={team.id} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={newTagTeamIds.includes(team.id)}
                          onChange={() =>
                            setNewTagTeamIds((current) =>
                              current.includes(team.id)
                                ? current.filter((id) => id !== team.id)
                                : [...current, team.id],
                            )
                          }
                        />
                        {team.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
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
              title={t('settings.tags.empty.title')}
              description={t('settings.tags.empty.description')}
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((tag) => (
                <li key={tag.id} className="flex flex-col gap-2 px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center rounded-sm bg-inset px-2 py-0.5 font-mono text-2xs">
                      {tag.name}
                    </span>
                    <span className="flex-1 text-2xs text-content-tertiary">
                      {tag.group_ids.length === 0
                        ? t('settings.tags.allTeams')
                        : t('settings.tags.teamCount', { count: tag.group_ids.length })}
                      {' · '}
                      {t('settings.tags.inUse', { count: tag.usage_count })}
                    </span>
                    {canEdit && teams.length > 0 && editingId !== tag.id && (
                      <button
                        type="button"
                        onClick={() => startEditingTeams(tag)}
                        aria-label={t('settings.tags.editTeamsAriaLabel', { name: tag.name })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('settings.tags.editTeamsButton')}
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(tag.id)}
                        aria-label={t('settings.tags.deleteAriaLabel', { name: tag.name })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('settings.delete')}
                      </button>
                    )}
                  </div>

                  {editingId === tag.id && (
                    <fieldset className="flex flex-col gap-2 rounded-md border border-border bg-inset p-3">
                      <legend className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                        {t('settings.tags.editTeamsAriaLabel', { name: tag.name })}
                      </legend>
                      {editError && (
                        <p role="alert" className="text-2xs text-danger">
                          {editError}
                        </p>
                      )}
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                        {teams.map((team) => (
                          <label key={team.id} className="flex items-center gap-1.5 text-sm">
                            <input
                              type="checkbox"
                              checked={editTeamIds.includes(team.id)}
                              onChange={() =>
                                setEditTeamIds((current) =>
                                  current.includes(team.id)
                                    ? current.filter((id) => id !== team.id)
                                    : [...current, team.id],
                                )
                              }
                            />
                            {team.name}
                          </label>
                        ))}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEditingTeams}
                          className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                        >
                          {t('settings.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveTeams()}
                          disabled={updateTeams.isPending}
                          className="rounded-md bg-brand-500 px-2 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                        >
                          {updateTeams.isPending ? t('settings.saving') : t('settings.save')}
                        </button>
                      </div>
                    </fieldset>
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
