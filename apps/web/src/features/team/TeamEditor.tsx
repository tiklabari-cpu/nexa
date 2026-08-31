/**
 * Create or edit a team — the "edit sayfası" FR-MOD-04.5's console acceptance
 * criterion names. Name and language mirror the two fields `POST`/`PATCH
 * /groups` accept (`routes/agents.ts`); `language_code` is optional, and left
 * blank means "use the server's default" rather than this screen restating
 * `en` a second time.
 *
 * Delete lives here rather than on the card: a team a routing rule still
 * targets, or one with an open conversation, comes back `409 group_in_use`
 * with the reason in `details`, and that refusal needs somewhere to land that
 * is not a console.error — shown inline, the same way `RoleMenu` shows an
 * authorization refusal rather than swallowing it.
 */
import { useState, type ReactElement } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '../../components/ui/index.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm, type Validator } from '../../lib/form.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import { useTranslate } from '../../lib/i18n.js';
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

  const invalidate = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['team', 'groups'] });

  const save = useMutation({
    mutationFn: (body: { name: string; language_code?: string }) =>
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
    },
    validators: {
      name: required(t('team.teams.editor.nameError')),
      language_code: languageCode(t('team.teams.editor.languageError')),
    },
    onSubmit: async (values, { setSubmitError }) => {
      try {
        const body: { name: string; language_code?: string } = { name: values.name.trim() };
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

  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('team.teams.editor.discardConfirm'),
    onClose,
  });

  const nameError = form.errorFor('name');
  const languageError = form.errorFor('language_code');

  return (
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

        {deleteError && (
          <p role="alert" className="text-sm text-danger">
            {deleteError}
          </p>
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          {group ? (
            <button
              type="button"
              onClick={() => {
                setDeleteError(null);
                remove.mutate();
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
              disabled={!form.canSubmit}
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
  );
}
