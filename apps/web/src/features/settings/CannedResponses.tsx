/**
 * Settings → Saved replies (FR-MOD-08.7.2 canned responses).
 *
 * Its own file rather than a section inside `SettingsPage.tsx` (I18N-i, tm
 * 133.9) — `NotificationSettings.tsx`'s precedent (I18N-e, tm 133.5): the i18n
 * coverage sentinel claims a whole *file* as translated, and `SettingsPage.tsx`
 * still carries sections I18N-j (tm 133.10) owns in English.
 *
 * A reply can be scoped to one team rather than the whole workspace. Unlike the
 * tag library's `group_ids` (which the server had accepted since tm 17, so
 * `Tags.tsx` was only missing the control), `canned_responses.group_id` and
 * `.visibility` were columns nothing read *or* wrote — the audit's "dead
 * column" finding. So the control below arrived together with the endpoint that
 * honours it, and the honouring happens on the server: the list is already
 * narrowed by the time it reaches this screen, which is why an ordinary agent's
 * `#` picker is correct without the composer knowing anything about teams.
 *
 * One team, not many. `group_id` is a scalar column and the shortcut it answers
 * to is unique across the workspace, so "which team may use `#refund`" has one
 * answer; a checkbox list would suggest otherwise.
 *
 * IN-06 (tm 363) adds three things. A reply can be personal ("Only me"): every
 * member may save those (`canned_responses--my:rw`), only the curators shared
 * ones, and nobody else is sent a personal reply — the server's rule, so this
 * screen only offers what the caller may save. A reply's text may carry
 * `{{variables}}`, inserted from the {x} menu and checked here by the same
 * validator the server applies. And the list can be searched with the
 * composer's Turkish-folding match.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { CANNED_VARIABLES, findCannedResponseProblems, type CannedVariable } from '@siyahtus/types';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { useSettingsLeaveGuard } from '../../components/settings/FormSaveBar.js';
import { useConfirm } from '../../components/ui/index.js';
import { EmptyState } from '../../components/EmptyState.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useInlineEditorFocus } from '../../lib/inline-editor-focus.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import { foldForSearch } from '../inbox/cannedSearch.js';

interface CannedResponse {
  id: string;
  shortcut: string;
  text: string;
  scope: 'chat' | 'ticket';
  group_id: number | null;
  visibility: 'all' | 'group' | 'private';
}

/** The picker's value for a personal reply; `''` is everyone, a number a team. */
const PRIVATE = 'private';

/**
 * Each variable's label. `chat.id` / `thread.id` read the ids catalogue (K1 = A)
 * so the menu names them the way every other screen does.
 */
const VARIABLE_LABEL_KEYS: Record<CannedVariable, string> = {
  'customer.name': 'settings.cannedResponses.variable.customerName',
  'customer.first_name': 'settings.cannedResponses.variable.customerFirstName',
  'customer.username': 'settings.cannedResponses.variable.customerUsername',
  'customer.email': 'settings.cannedResponses.variable.customerEmail',
  'agent.name': 'settings.cannedResponses.variable.agentName',
  'agent.first_name': 'settings.cannedResponses.variable.agentFirstName',
  'chat.id': 'ids.thread.label',
  'thread.id': 'ids.chat.label',
  'company.name': 'settings.cannedResponses.variable.companyName',
};

/** Local copy of `Teams.tsx`'s `Group` shape — just enough to render a picker. */
interface Team {
  id: number;
  name: string;
}

/**
 * The scope as the endpoint wants it. `''` is the picker's "All teams" option,
 * and the pair has to be sent whole: `visibility` and `group_id` are checked
 * together, so half of the decision is a 400.
 */
function scopeBody(teamId: string): {
  visibility: 'all' | 'group' | 'private';
  group_id: number | null;
} {
  if (teamId === PRIVATE) return { visibility: 'private', group_id: null };
  return teamId === ''
    ? { visibility: 'all', group_id: null }
    : { visibility: 'group', group_id: Number(teamId) };
}

export function CannedResponses({
  canEdit,
  canWritePersonal = canEdit,
}: {
  /** Manages the shared library (`canned_responses--all:rw`). */
  canEdit: boolean;
  /** Saves their own personal replies (`canned_responses--my:rw`); every member by default. */
  canWritePersonal?: boolean;
}): ReactElement {
  const t = useTranslate();
  const { confirm, dialog } = useConfirm();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const list = useQuery({
    queryKey: ['settings', 'canned-responses'],
    queryFn: () =>
      api.get<{ items: CannedResponse[]; fallback_text?: string | null }>(
        '/settings/canned-responses?scope=chat',
      ),
  });

  // Same `['team', 'groups']` cache key `Teams.tsx`/`Tags.tsx` list under —
  // mounting this section never doubles that request. Every agent holds at
  // least `groups--my:ro` (`DEFAULT_AGENT_SCOPES`), so the list is readable
  // here regardless of `canEdit`.
  const teamsQuery = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Team[] }>('/groups'),
  });
  const teams = teamsQuery.data?.items ?? [];
  const teamName = (id: number): string => teams.find((team) => team.id === id)?.name ?? String(id);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['settings', 'canned-responses'] });
    // The composer reads the same replies; leaving its cache alone would mean a
    // new shortcut does not appear until the agent reloads.
    void queryClient.invalidateQueries({ queryKey: ['canned-responses'] });
  };

  const create = useMutation({
    mutationFn: (body: {
      shortcut: string;
      text: string;
      visibility: 'all' | 'group' | 'private';
      group_id: number | null;
    }) => api.post<CannedResponse>('/settings/canned-responses', body),
    onSuccess: invalidate,
  });

  const saveFallback = useMutation({
    mutationFn: (fallback: string | null) =>
      api.put<{ fallback_text: string | null }>('/settings/canned-response-fallback', {
        fallback_text: fallback,
      }),
    onSuccess: invalidate,
  });
  // `null` untouched: the field shows what the server has until it is edited.
  const [fallbackDraft, setFallbackDraft] = useState<string | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const storedFallback = list.data?.fallback_text ?? '';
  const fallbackValue = fallbackDraft ?? storedFallback;

  async function submitFallback(): Promise<void> {
    try {
      await saveFallback.mutateAsync(fallbackValue.trim() === '' ? null : fallbackValue.trim());
      setFallbackDraft(null);
      setFallbackError(null);
    } catch (error) {
      setFallbackError(t(errorMessageKey(error)));
    }
  }

  const [search, setSearch] = useState('');
  const visibleItems = useMemo(() => {
    const items = list.data?.items ?? [];
    const needle = foldForSearch(search.trim());
    if (!needle) return items;
    return items.filter(
      (item) =>
        foldForSearch(item.shortcut).includes(needle) || foldForSearch(item.text).includes(needle),
    );
  }, [list.data, search]);

  const replyRef = useRef<HTMLTextAreaElement>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/settings/canned-responses/${id}`),
    onSuccess: invalidate,
  });

  const updateTeam = useMutation({
    mutationFn: ({ id, teamId }: { id: string; teamId: string }) =>
      api.patch<CannedResponse>(`/settings/canned-responses/${id}`, scopeBody(teamId)),
    onSuccess: invalidate,
  });

  /** `''` — the new reply is for everyone; `private` for its author alone. */
  const defaultScope = canEdit ? '' : PRIVATE;
  const [newTeamId, setNewTeamId] = useState(defaultScope);

  // `null` closed, otherwise the id of the reply whose team is being changed.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTeamId, setEditTeamId] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const focus = useInlineEditorFocus(editingId);

  function startEditingTeam(item: CannedResponse): void {
    setEditingId(item.id);
    setEditTeamId(item.group_id === null ? '' : String(item.group_id));
    setEditError(null);
  }

  async function saveTeam(): Promise<void> {
    if (!editingId) return;
    try {
      await updateTeam.mutateAsync({ id: editingId, teamId: editTeamId });
      setEditingId(null);
      setEditError(null);
    } catch (error) {
      setEditError(t(errorMessageKey(error)));
    }
  }

  // The one validation primitive: both fields required, Submit disabled until
  // they are, the fields cleared on success (FR-EK-A.1).
  const form = useForm({
    initial: { shortcut: '', text: '' },
    validators: {
      shortcut: required(t('settings.cannedResponses.shortcutError')),
      text: (value) => {
        if (!value.trim()) return t('settings.cannedResponses.replyError');
        const problem = findCannedResponseProblems(value)[0];
        if (!problem) return null;
        return problem.reason === 'unknown_variable'
          ? t('settings.cannedResponses.variableUnknown', { token: problem.token })
          : t('settings.cannedResponses.variableMalformed', { token: problem.token });
      },
    },
    onSubmit: async (values, { setSubmitError, reset }) => {
      try {
        await create.mutateAsync({
          shortcut: values.shortcut.trim(),
          text: values.text.trim(),
          ...scopeBody(newTeamId),
        });
        reset();
        setNewTeamId(defaultScope);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });
  useSettingsLeaveGuard(form.isDirty, form.isSubmitting);

  /** Puts `{{name}}` at the reply field's caret (or its end) and keeps typing there. */
  function insertVariable(name: CannedVariable): void {
    const input = replyRef.current;
    const value = form.values.text;
    const at = input ? input.selectionStart : value.length;
    const token = `{{${name}}}`;
    form.setValue('text', value.slice(0, at) + token + value.slice(at));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(at + token.length, at + token.length);
    });
  }
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
          {canWritePersonal && (
            <form
              onSubmit={form.handleSubmit}
              noValidate
              className="flex flex-col gap-3 border-b border-border p-4"
            >
              <div className="flex flex-wrap items-start gap-3">
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
                      placeholder={t('settings.cannedResponses.shortcutPlaceholder')}
                      className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                    />
                  </div>
                  <FieldError id="new-shortcut-error" message={shortcutError} />
                </label>

                <div className="flex min-w-56 flex-1 flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="new-reply"
                      className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                    >
                      {t('settings.cannedResponses.replyLabel')}
                    </label>
                    <Dropdown
                      label={t('settings.cannedResponses.variableMenu')}
                      trigger={<span className="font-mono text-2xs">{'{x}'}</span>}
                      triggerClassName="rounded-md border border-border px-1.5 py-0.5 text-content-secondary transition-colors hover:bg-surface-2"
                      panelClassName="right-0 top-7 w-56 p-1"
                    >
                      {({ close }) => (
                        <div role="menu" className="flex flex-col">
                          {CANNED_VARIABLES.map((name) => (
                            <button
                              key={name}
                              type="button"
                              role="menuitem"
                              onClick={() => {
                                close(false);
                                insertVariable(name);
                              }}
                              className="flex items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-surface-2"
                            >
                              <span>{t(VARIABLE_LABEL_KEYS[name])}</span>
                              <code className="font-mono text-2xs text-content-tertiary">
                                {name}
                              </code>
                            </button>
                          ))}
                        </div>
                      )}
                    </Dropdown>
                  </div>
                  <textarea
                    id="new-reply"
                    ref={replyRef}
                    rows={2}
                    value={form.values.text}
                    onChange={(event) => form.setValue('text', event.target.value)}
                    onBlur={() => form.blur('text')}
                    aria-invalid={textError ? true : undefined}
                    aria-describedby={textError ? 'new-reply-error' : undefined}
                    placeholder={t('settings.cannedResponses.messagePlaceholder')}
                    className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                  />
                  <FieldError id="new-reply-error" message={textError} />
                </div>

                <button
                  type="submit"
                  disabled={!form.canSubmit}
                  className="mt-5 rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                >
                  {form.isSubmitting
                    ? t('settings.saving')
                    : t('settings.cannedResponses.saveButton')}
                </button>
              </div>

              {/* "Only me / Everyone / a team" (IN-06) in one control — the
                  three are one decision, so two controls could disagree. A
                  member who may save only personal replies has nothing to
                  choose: the sentence says where the reply goes instead. */}
              {canEdit ? (
                <div className="flex w-56 flex-col gap-1">
                  {/* The hint is a sibling of the label, not a child of it —
                      inside, it would join the select's accessible name and a
                      screen reader would announce the whole sentence as the
                      field's label. */}
                  <label
                    htmlFor="new-reply-team"
                    className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
                  >
                    {t('settings.cannedResponses.visibilityLabel')}
                  </label>
                  <select
                    id="new-reply-team"
                    value={newTeamId}
                    onChange={(event) => setNewTeamId(event.target.value)}
                    className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
                  >
                    <option value={PRIVATE}>{t('settings.cannedResponses.onlyMe')}</option>
                    <option value="">{t('settings.cannedResponses.everyone')}</option>
                    {teams.map((team) => (
                      <option key={team.id} value={String(team.id)}>
                        {t('settings.cannedResponses.teamOption', { name: team.name })}
                      </option>
                    ))}
                  </select>
                  <span className="text-2xs text-content-tertiary">
                    {t('settings.cannedResponses.teamHint')}
                  </span>
                </div>
              ) : (
                <p className="text-2xs text-content-tertiary">
                  {t('settings.cannedResponses.personalOnlyHint')}
                </p>
              )}

              {form.submitError && (
                <p role="alert" className="text-2xs text-danger">
                  {form.submitError}
                </p>
              )}
            </form>
          )}

          {canEdit && (
            <div className="flex flex-wrap items-end gap-2 border-b border-border p-4">
              <label htmlFor="canned-fallback" className="flex w-72 flex-col gap-1">
                <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                  {t('settings.cannedResponses.fallbackLabel')}
                </span>
                <input
                  id="canned-fallback"
                  value={fallbackValue}
                  maxLength={100}
                  onChange={(event) => setFallbackDraft(event.target.value)}
                  placeholder={t('inbox.composer.picker.fallbackDefault')}
                  className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
                />
              </label>
              <button
                type="button"
                onClick={() => void submitFallback()}
                disabled={fallbackDraft === null || saveFallback.isPending}
                className="rounded-md border border-border px-3 py-1.5 text-sm text-content-secondary transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {saveFallback.isPending
                  ? t('settings.saving')
                  : t('settings.cannedResponses.fallbackSave')}
              </button>
              <span className="w-full text-2xs text-content-tertiary">
                {t('settings.cannedResponses.fallbackHint')}
              </span>
              {fallbackError && (
                <p role="alert" className="w-full text-2xs text-danger">
                  {fallbackError}
                </p>
              )}
            </div>
          )}

          {(list.data?.items.length ?? 0) > 0 && (
            <div className="border-b border-border px-4 py-2">
              <label htmlFor="canned-search" className="sr-only">
                {t('settings.cannedResponses.searchLabel')}
              </label>
              <input
                id="canned-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('settings.cannedResponses.searchPlaceholder')}
                className="w-full rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
              />
            </div>
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
              {visibleItems.length === 0 && (
                <li className="px-4 py-3 text-sm text-content-secondary">
                  {t('settings.cannedResponses.searchEmpty')}
                </li>
              )}
              {visibleItems.map((item) => (
                <li key={item.id} className="flex flex-col gap-2 px-4 py-2.5">
                  <div className="flex items-start gap-3">
                    <code className="mt-0.5 shrink-0 rounded-sm bg-inset px-1.5 py-0.5 font-mono text-2xs">
                      #{item.shortcut}
                    </code>
                    <span className="flex-1 text-sm text-content-secondary">{item.text}</span>
                    <span className="mt-0.5 shrink-0 text-2xs text-content-tertiary">
                      {item.visibility === 'private'
                        ? t('settings.cannedResponses.personal')
                        : item.group_id === null
                          ? t('settings.cannedResponses.allTeams')
                          : t('settings.cannedResponses.teamOnly', {
                              name: teamName(item.group_id),
                            })}
                    </span>
                    {canEdit &&
                      teams.length > 0 &&
                      item.visibility !== 'private' &&
                      editingId !== item.id && (
                        <button
                          type="button"
                          ref={focus.opener(item.id)}
                          onClick={() => startEditingTeam(item)}
                          aria-label={t('settings.cannedResponses.editTeamAriaLabel', {
                            shortcut: item.shortcut,
                          })}
                          className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                        >
                          {t('settings.cannedResponses.editTeamButton')}
                        </button>
                      )}
                    {(item.visibility === 'private' ? canWritePersonal : canEdit) && (
                      <button
                        type="button"
                        onClick={() =>
                          confirm({
                            title: t('settings.cannedResponses.deleteConfirmTitle', {
                              shortcut: item.shortcut,
                            }),
                            description: t('settings.cannedResponses.deleteConfirmDescription'),
                            confirmLabel: t('settings.delete'),
                            failureTitle: t('ui.writeError.delete', { name: item.shortcut }),
                            onConfirm: () => remove.mutateAsync(item.id),
                          })
                        }
                        aria-label={t('settings.cannedResponses.deleteAriaLabel', {
                          shortcut: item.shortcut,
                        })}
                        className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('settings.delete')}
                      </button>
                    )}
                  </div>

                  {editingId === item.id && (
                    <div
                      ref={focus.editor}
                      className="flex flex-wrap items-start gap-2 rounded-md border border-border bg-inset p-3"
                    >
                      {/* Not the button's wording: a field whose label is
                          identical to a button's accessible name leaves neither
                          addressable by name, and the two are on screen at
                          once here. */}
                      <label htmlFor={`edit-team-${item.id}`} className="flex flex-col gap-1">
                        <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
                          {t('settings.cannedResponses.teamForLabel', {
                            shortcut: item.shortcut,
                          })}
                        </span>
                        <select
                          id={`edit-team-${item.id}`}
                          value={editTeamId}
                          onChange={(event) => setEditTeamId(event.target.value)}
                          className="rounded-md border border-border bg-surface-1 px-2 py-1.5 text-sm outline-none"
                        >
                          <option value="">{t('settings.cannedResponses.allTeams')}</option>
                          {teams.map((team) => (
                            <option key={team.id} value={String(team.id)}>
                              {team.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="mt-5 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                      >
                        {t('settings.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveTeam()}
                        disabled={updateTeam.isPending}
                        className="mt-5 rounded-md bg-brand-500 px-2 py-1 text-2xs font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
                      >
                        {updateTeam.isPending ? t('settings.saving') : t('settings.save')}
                      </button>
                      {editError && (
                        <p role="alert" className="w-full text-2xs text-danger">
                          {editError}
                        </p>
                      )}
                    </div>
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
