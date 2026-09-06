/**
 * The `…` menu on a knowledge source row (FR-MOD-06.3.3).
 *
 * Two things move here that the bare Delete button could not do.
 *
 * **Deleting asks first.** A source deletes its chunks with it, so a stray
 * click was an unrecoverable loss of everything the AI had indexed from that
 * text — reachable by one mis-aimed tap, with no undo behind it. The
 * confirmation is a `Modal`, not `window.confirm`: the native dialog cannot be
 * driven by a test (so "cancel really does cancel" would be an untested
 * promise), cannot be styled, and cannot say *what* is about to be lost.
 *
 * **The row is more than one action**, which is what the menu is for. Edit and
 * Reindex are not variations of Delete; folding three verbs into three
 * side-by-side buttons would have put a destructive action a pixel away from a
 * routine one on every row in the list.
 *
 * Reindex reports in place rather than in a dialog: it is a request about a row
 * whose result *is* the row (a new chunk count, a new date), so the row is
 * where its progress and its failure belong.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Modal } from '../../components/ui/index.js';
import { ErrorNotice } from '../../components/Page.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate } from '../../lib/i18n.js';
import { Dropdown } from '../../components/ui/Dropdown.js';
import type { KnowledgeSource } from './types.js';

/**
 * Which field of a source is editable, decided by where its text came from —
 * the same split the endpoint enforces, not a looser guess at it. A `website`
 * is edited through its URL (its text is the crawl); an `article` or a `faq`
 * through its content; a `file` has neither, because its text is the bytes that
 * were uploaded and a pasted replacement would make "File" a label again.
 */
type EditableBody = 'content' | 'source_url' | 'none';

export function editableBodyFor(type: string): EditableBody {
  if (type === 'website') return 'source_url';
  if (type === 'article' || type === 'faq') return 'content';
  return 'none';
}

const MENU_ITEM =
  'block w-full px-3 py-1.5 text-left text-sm text-content transition-colors hover:bg-surface-2';

export function KnowledgeSourceActions({
  source,
  onChanged,
}: {
  source: KnowledgeSource;
  onChanged: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [dialog, setDialog] = useState<'edit' | 'delete' | null>(null);

  const reindex = useMutation({
    mutationFn: () => api.post<KnowledgeSource>(`/knowledge-sources/${source.id}/reindex`, {}),
    onSuccess: onChanged,
  });

  return (
    <>
      <Dropdown
        label={t('playbook.knowledge.actionsLabel', { name: source.name })}
        trigger={<span aria-hidden="true">···</span>}
        triggerClassName="rounded-md border border-border px-2 py-1 text-2xs leading-4 text-content-secondary transition-colors hover:bg-surface-2"
        panelClassName="right-0 top-full mt-1 w-40 py-1"
      >
        {({ close }) => (
          <>
            <button
              type="button"
              className={MENU_ITEM}
              onClick={() => {
                // Focus goes back to the trigger *before* the dialog mounts, so
                // the Modal captures a live element to hand focus back to — the
                // menu item it was opened from is about to be hidden.
                close(true);
                setDialog('edit');
              }}
            >
              {t('playbook.knowledge.edit')}
            </button>
            <button
              type="button"
              className={MENU_ITEM}
              disabled={reindex.isPending}
              onClick={() => {
                close(true);
                reindex.mutate();
              }}
            >
              {t('playbook.knowledge.reindex')}
            </button>
            <button
              type="button"
              className={`${MENU_ITEM} text-danger`}
              onClick={() => {
                close(true);
                setDialog('delete');
              }}
            >
              {t('playbook.knowledge.delete')}
            </button>
          </>
        )}
      </Dropdown>

      {reindex.isPending && (
        <span role="status" className="text-2xs text-content-tertiary">
          {t('playbook.knowledge.reindexing')}
        </span>
      )}
      {reindex.isError && (
        <span role="alert" className="text-2xs text-danger">
          {t(errorMessageKey(reindex.error))}
        </span>
      )}

      {dialog === 'edit' && (
        <EditSourceModal
          source={source}
          onClose={() => setDialog(null)}
          onSaved={() => {
            onChanged();
            setDialog(null);
          }}
        />
      )}
      {dialog === 'delete' && (
        <DeleteSourceModal
          source={source}
          onClose={() => setDialog(null)}
          onDeleted={() => {
            onChanged();
            setDialog(null);
          }}
        />
      )}
    </>
  );
}

function EditSourceModal({
  source,
  onClose,
  onSaved,
}: {
  source: KnowledgeSource;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const body = editableBodyFor(source.type);

  const save = useMutation({
    mutationFn: (patch: Record<string, string>) =>
      api.patch<KnowledgeSource>(`/knowledge-sources/${source.id}`, patch),
    onSuccess: onSaved,
  });

  const form = useForm({
    initial: {
      name: source.name,
      sourceUrl: source.source_url ?? '',
      // The stored text is not in the list response — the table shows a chunk
      // count, not the article. So content edits start from an empty box and
      // are a deliberate replacement, which is what the field says.
      content: '',
    },
    validators: {
      name: required(t('playbook.knowledge.formTitleRequiredError')),
      sourceUrl:
        body === 'source_url' ? required(t('playbook.knowledge.formUrlRequiredError')) : undefined,
    },
    onSubmit: async (values, { setSubmitError }) => {
      // Only what actually changed. An unchanged `content` would still be a
      // re-index — a model call spent to rebuild identical vectors — and an
      // empty patch is a 400, so a Save that changed nothing closes quietly
      // rather than reporting an error the admin cannot act on.
      const patch: Record<string, string> = {};
      const name = values.name.trim();
      if (name !== source.name) patch['name'] = name;
      if (body === 'source_url') {
        const url = values.sourceUrl.trim();
        if (url !== (source.source_url ?? '')) patch['source_url'] = url;
      }
      if (body === 'content') {
        const content = values.content.trim();
        if (content !== '') patch['content'] = content;
      }
      if (Object.keys(patch).length === 0) {
        onClose();
        return;
      }
      try {
        await save.mutateAsync(patch);
      } catch (error) {
        setSubmitError(t(errorMessageKey(error)));
      }
    },
  });

  const nameError = form.errorFor('name');
  const urlError = form.errorFor('sourceUrl');

  return (
    <Modal
      onClose={onClose}
      title={t('playbook.knowledge.editTitle', { name: source.name })}
      description={t('playbook.knowledge.editDescription')}
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        <label htmlFor="edit-source-name" className="flex flex-col gap-1">
          <span className="text-2xs font-medium uppercase tracking-wide text-content-tertiary">
            {t('playbook.knowledge.formTitle')}
          </span>
          <input
            id="edit-source-name"
            autoFocus
            value={form.values.name}
            onChange={(event) => form.setValue('name', event.target.value)}
            onBlur={() => form.blur('name')}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? 'edit-source-name-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
          />
          <FieldError id="edit-source-name-error" message={nameError} />
        </label>

        {/* Sibling labels below, not wrappers: the help line under each field
            sits inside the label element when it wraps, and folds into the
            control's accessible name — the field then stops being findable by
            the words on it. */}
        {body === 'source_url' && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="edit-source-url"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('playbook.knowledge.formUrl')}
            </label>
            <input
              id="edit-source-url"
              value={form.values.sourceUrl}
              onChange={(event) => form.setValue('sourceUrl', event.target.value)}
              onBlur={() => form.blur('sourceUrl')}
              aria-invalid={urlError ? true : undefined}
              aria-describedby={urlError ? 'edit-source-url-error' : 'edit-source-url-help'}
              className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none"
            />
            <span id="edit-source-url-help" className="text-2xs text-content-tertiary">
              {t('playbook.knowledge.editUrlHelp')}
            </span>
            <FieldError id="edit-source-url-error" message={urlError} />
          </div>
        )}

        {body === 'content' && (
          <div className="flex flex-col gap-1">
            <label
              htmlFor="edit-source-content"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('playbook.knowledge.formContent')}
            </label>
            <textarea
              id="edit-source-content"
              rows={5}
              value={form.values.content}
              onChange={(event) => form.setValue('content', event.target.value)}
              aria-describedby="edit-source-content-help"
              placeholder={t('playbook.knowledge.formContentPlaceholder')}
              className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
            />
            <span id="edit-source-content-help" className="text-2xs text-content-tertiary">
              {t('playbook.knowledge.editContentHelp')}
            </span>
          </div>
        )}

        {body === 'none' && (
          <p className="text-2xs text-content-tertiary">{t('playbook.knowledge.editFileNote')}</p>
        )}

        {form.submitError && (
          <span role="alert" className="text-2xs text-danger">
            {form.submitError}
          </span>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {t('apps.common.cancel')}
          </button>
          <button
            type="submit"
            disabled={!form.canSubmit}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            {form.isSubmitting
              ? t('playbook.knowledge.saving')
              : t('playbook.knowledge.saveChanges')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteSourceModal({
  source,
  onClose,
  onDeleted,
}: {
  source: KnowledgeSource;
  onClose: () => void;
  onDeleted: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: () => api.delete(`/knowledge-sources/${source.id}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['playbook'] });
      onDeleted();
    },
  });

  return (
    <Modal
      onClose={onClose}
      title={t('playbook.knowledge.deleteTitle', { name: source.name })}
      // Names the consequence, not the action: what is lost is the index, and
      // the AI going quiet on that topic is the part an admin cannot see coming
      // from the word "delete" alone.
      description={t('playbook.knowledge.deleteDescription')}
    >
      {remove.isError && <ErrorNotice message={t(errorMessageKey(remove.error))} />}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-border px-3 py-1.5 text-sm"
        >
          {t('apps.common.cancel')}
        </button>
        <button
          type="button"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="rounded-md border border-danger px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
        >
          {remove.isPending ? t('apps.common.deleting') : t('playbook.knowledge.deleteConfirm')}
        </button>
      </div>
    </Modal>
  );
}
