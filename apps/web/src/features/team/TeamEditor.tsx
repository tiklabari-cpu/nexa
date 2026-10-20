/**
 * Create or edit a team — the "edit sayfası" FR-MOD-04.5's console acceptance
 * criterion names. Name and language mirror the two fields `POST`/`PATCH
 * /groups` accept (`routes/agents.ts`); `language_code` is optional, and left
 * blank means "use the server's default" rather than this screen restating
 * `en` a second time.
 *
 * The queue settings (AU-01 · K14 · tm 305.4) are the other three: the topic
 * the team's queue serves, what it does out of hours, and the skills an agent
 * needs to join it and be given its conversations (`teamQueue.ts`). Only what
 * changed is sent. The Responsible Gambling team keeps its topic and always
 * requires a skill — its training — so its picker is locked and an empty
 * requirement is stopped here rather than sent for a `409 group_protected`.
 *
 * Delete lives here rather than on the card: a team a routing rule still
 * targets, or one with an open conversation, comes back `409 group_in_use`
 * with the reason in `details`, and that refusal needs somewhere to land that
 * is not a console.error — shown inline, the same way `RoleMenu` shows an
 * authorization refusal rather than swallowing it. The Responsible Gambling
 * team is never deleted (K14), so it offers no delete at all.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AFTER_HOURS_MODES, QUEUE_TOPIC_ROLES, RESPONSIBLE_GAMBLING_ROLE } from '@siyahtus/types';
import { Modal, useConfirm } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm, type Validator } from '../../lib/form.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import { useTranslate } from '../../lib/i18n.js';
import {
  formatIdList,
  isResponsibleGambling,
  parseIdList,
  queueSettingsBody,
  queueSettingsValues,
  topicHolders,
  type ExpertiseArea,
  type QueueSettingsBody,
} from './teamQueue.js';
import type { Group } from './Teams.js';

// Mirrors `groups_language_code_check` / `groupLanguageCode` (`routes/agents.ts`):
// ISO 639-1, optionally with a region. Blank is valid here — it means "omit
// the field", not "fails validation" — a plain length bound would let e.g.
// `en_GB` (underscore) reach the server and come back a 400 this screen never
// tried to catch.
const LANGUAGE_CODE_PATTERN = /^[a-z]{2}(-[A-Z]{2})?$/;

function languageCode(message: string): Validator {
  return (value) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return LANGUAGE_CODE_PATTERN.test(trimmed) ? null : message;
  };
}

type GroupBody = { name: string; language_code?: string } & QueueSettingsBody;

export function TeamEditor({
  group,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** The team to edit, or null to create a new one. */
  group: Group | null;
  onClose: () => void;
  onSaved: (group: Group) => void;
  onDeleted: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  // The roster `Teams` already holds (same key): which topics other teams serve.
  const teams = useQuery({
    queryKey: ['team', 'groups'],
    queryFn: () => api.get<{ items: Group[] }>('/groups'),
  });
  const skills = useQuery({
    queryKey: ['settings', 'expertise'],
    queryFn: () => api.get<{ items: ExpertiseArea[] }>('/settings/expertise'),
  });
  const holders = topicHolders(teams.data?.items ?? [], group?.id ?? null);
  // The topic is fixed once a team is Responsible Gambling (K14).
  const topicLocked = isResponsibleGambling(group);

  const invalidate = (): Promise<unknown> =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['team', 'groups'] }),
      queryClient.invalidateQueries({ queryKey: ['routing', 'queues'] }),
    ]);

  const save = useMutation({
    mutationFn: (body: GroupBody) =>
      group ? api.patch<Group>(`/groups/${group.id}`, body) : api.post<Group>('/groups', body),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/groups/${group!.id}`),
    onSuccess: async () => {
      await invalidate();
      onDeleted();
    },
    onError: (failure: unknown) => setDeleteError(t(errorMessageKey(failure))),
  });

  const form = useForm({
    initial: {
      name: group?.name ?? '',
      language_code: group?.language_code ?? '',
      ...queueSettingsValues(group),
    },
    validators: {
      name: required(t('team.teams.editor.nameError')),
      language_code: languageCode(t('team.teams.editor.languageError')),
    },
    onSubmit: async (values, { setSubmitError }) => {
      if (trainingMissing) return;
      try {
        const body: GroupBody = {
          name: values.name.trim(),
          ...queueSettingsBody(group, values),
        };
        const language = values.language_code.trim();
        if (language) body.language_code = language;
        const saved = await save.mutateAsync(body);
        await invalidate();
        onSaved(saved);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  // Responsible Gambling with no required skill is refused (`group_protected`):
  // the requirement is its training, and without one every agent would count
  // as trained.
  const trainingMissing =
    form.values.topic_role === RESPONSIBLE_GAMBLING_ROLE && form.values.required_expertise === '';

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('team.teams.editor.discardConfirm'),
    onClose,
  });

  const nameError = form.errorFor('name');
  const languageError = form.errorFor('language_code');
  const requiredSkills = new Set(parseIdList(form.values.required_expertise));
  const catalogue = skills.data?.items ?? [];

  function toggleSkill(id: number): void {
    const next = new Set(requiredSkills);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    form.setValue('required_expertise', formatIdList([...next]));
  }

  return (
    <>
      <Modal
        onClose={close}
        title={
          group
            ? t('team.teams.editor.editTitle', { name: group.name })
            : t('team.teams.editor.createTitle')
        }
        description={t('team.teams.editor.description')}
      >
        <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
          {form.submitError && (
            <p role="alert" className="text-sm text-danger">
              {form.submitError}
            </p>
          )}

          <div>
            <label htmlFor="team-name" className="mb-1 block text-sm font-medium">
              {t('team.teams.editor.nameLabel')}
            </label>
            <input
              id="team-name"
              autoFocus
              value={form.values.name}
              onChange={(event) => form.setValue('name', event.target.value)}
              onBlur={() => form.blur('name')}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? 'team-name-error' : undefined}
              maxLength={120}
              className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
            />
            <FieldError id="team-name-error" message={nameError} />
          </div>

          <div>
            <label htmlFor="team-language" className="mb-1 block text-sm font-medium">
              {t('team.teams.editor.languageLabel')}
            </label>
            <input
              id="team-language"
              value={form.values.language_code}
              onChange={(event) => form.setValue('language_code', event.target.value)}
              onBlur={() => form.blur('language_code')}
              aria-invalid={languageError ? true : undefined}
              aria-describedby={languageError ? 'team-language-error' : undefined}
              placeholder="en"
              maxLength={10}
              className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
            />
            {!languageError && (
              <p className="mt-1 text-2xs text-content-tertiary">
                {t('team.teams.editor.languageHint')}
              </p>
            )}
            <FieldError id="team-language-error" message={languageError} />
          </div>

          <fieldset className="flex flex-col gap-3 rounded-md border border-border px-3 pb-3 pt-1">
            <legend className="px-1 text-sm font-medium">
              {t('team.teams.editor.queue.legend')}
            </legend>
            <p className="text-2xs text-content-tertiary">
              {t('team.teams.editor.queue.description')}
            </p>

            <div>
              <label htmlFor="team-topic" className="mb-1 block text-sm font-medium">
                {t('team.teams.editor.queue.topicLabel')}
              </label>
              <select
                id="team-topic"
                value={form.values.topic_role}
                disabled={topicLocked}
                aria-describedby="team-topic-hint"
                onChange={(event) => form.setValue('topic_role', event.target.value)}
                className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value="">{t('team.teams.editor.queue.topicNone')}</option>
                {QUEUE_TOPIC_ROLES.map((role) => {
                  const holder = holders.get(role);
                  return (
                    <option key={role} value={role} disabled={holder !== undefined}>
                      {holder === undefined
                        ? t(`team.queue.role.${role}`)
                        : t('team.teams.editor.queue.topicHeld', {
                            topic: t(`team.queue.role.${role}`),
                            team: holder,
                          })}
                    </option>
                  );
                })}
              </select>
              <p id="team-topic-hint" className="mt-1 text-2xs text-content-tertiary">
                {topicLocked
                  ? t('team.teams.editor.queue.topicLocked')
                  : t('team.teams.editor.queue.topicHint')}
              </p>
            </div>

            <div>
              <label htmlFor="team-after-hours" className="mb-1 block text-sm font-medium">
                {t('team.teams.editor.queue.afterHoursLabel')}
              </label>
              <select
                id="team-after-hours"
                value={form.values.after_hours_mode}
                onChange={(event) => form.setValue('after_hours_mode', event.target.value)}
                className="w-full rounded-md border border-border bg-inset px-3 py-2 text-sm"
              >
                {AFTER_HOURS_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {t(`team.queue.afterHours.${mode}`)}
                  </option>
                ))}
              </select>
            </div>

            <fieldset aria-describedby="team-skills-hint">
              <legend className="mb-1 text-sm font-medium">
                {t('team.teams.editor.queue.skillsLabel')}
              </legend>
              <p id="team-skills-hint" className="mb-1.5 text-2xs text-content-tertiary">
                {t('team.teams.editor.queue.skillsHint')}
              </p>
              {skills.isPending ? (
                <p className="text-xs text-content-tertiary">
                  {t('team.teams.editor.queue.skillsLoading')}
                </p>
              ) : skills.isError ? (
                <p role="alert" className="text-xs text-danger">
                  {t('team.teams.editor.queue.skillsError')}
                </p>
              ) : catalogue.length === 0 ? (
                <p className="text-xs text-content-tertiary">
                  {t('team.teams.editor.queue.skillsEmpty')}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {catalogue.map((skill) => (
                    <li key={skill.id}>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={requiredSkills.has(skill.id)}
                          onChange={() => toggleSkill(skill.id)}
                        />
                        {skill.name}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {trainingMissing && (
                <p role="alert" className="mt-1 text-xs text-danger">
                  {t('team.teams.editor.queue.trainingRequired')}
                </p>
              )}
            </fieldset>
          </fieldset>

          {deleteError && (
            <p role="alert" className="text-sm text-danger">
              {deleteError}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between gap-2">
            {group && topicLocked ? (
              <p className="text-2xs text-content-tertiary">
                {t('team.teams.editor.queue.protectedNote')}
              </p>
            ) : group ? (
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null);
                  confirm({
                    title: t('team.teams.editor.deleteConfirm.title', { name: group.name }),
                    description: t('team.teams.editor.deleteConfirm.description'),
                    // The refusal (a team still in use) lands in `deleteError` via onError.
                    onConfirm: () => remove.mutateAsync(),
                  });
                }}
                disabled={remove.isPending}
                className="text-xs text-danger underline disabled:opacity-40"
              >
                {remove.isPending
                  ? t('team.teams.editor.deleting')
                  : t('team.teams.editor.deleteButton')}
              </button>
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={close}
                className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary hover:bg-surface-2"
              >
                {t('team.teams.editor.cancel')}
              </button>
              <button
                type="submit"
                disabled={!form.canSubmit || trainingMissing}
                className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {form.isSubmitting
                  ? t('team.teams.editor.saving')
                  : group
                    ? t('team.teams.editor.saveChanges')
                    : t('team.teams.editor.create')}
              </button>
            </div>
          </div>
        </form>
      </Modal>
      {dialog}
    </>
  );
}
