/**
 * Admin: rename and remove the KB's categories (tm 215 · FR-EK-B.1).
 *
 * The gap this closes was invisible from the console and visible from the
 * contract. `routes/kb.ts` registers four operations on categories — list,
 * create, `PATCH /kb-categories/{categoryId}`, `DELETE /kb-categories/{categoryId}`
 * — and until now the console called the first two only: `KbArticleEditor`
 * creates one on the way to saving an article, `KbArticleList` lists them in the
 * filter. So a category could be brought into existence by a typo and never
 * corrected or removed; the taxonomy of the public knowledge base was
 * append-only, and the endpoints that fix that had been shipped and tested for
 * months with nobody calling them. `audit:endpoint-ui` did not report it because
 * it counted paths rather than (path, method) — the same blindness that hid
 * `DELETE /chats/{chatId}/supervise` until tm 213 read the code.
 *
 * Deliberately a rename and a delete, and no create: creating a category
 * already has a place — in the editor, at the moment an article needs one —
 * and a second entry point would let someone build a taxonomy nothing files
 * under. Shape follows `settings/Brands.tsx`, which is the same problem one
 * screen over (an inline-editable name saved on blur, a Remove beside it, and
 * the server's refusal shown next to the row it is about rather than at the top
 * of the screen).
 *
 * Removing a category does NOT remove its articles: the FK is
 * `ON DELETE SET NULL`, so they survive and become uncategorized. That is worth
 * saying out loud on the button's confirmation, because the opposite assumption
 * is the one that stops an admin from tidying up.
 */
import { useMutation } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { ErrorNotice } from '../../components/Page.js';
import { useApiClient } from '../../lib/auth-store.js';
import { errorMessageKey } from '../../lib/api-client.js';
import { useTranslate } from '../../lib/i18n.js';
import type { KbCategory } from './types.js';

export function KbCategoryManager({
  categories,
  onChanged,
}: {
  categories: readonly KbCategory[];
  onChanged: () => void;
}): ReactElement | null {
  const t = useTranslate();
  const [open, setOpen] = useState(false);

  // Nothing to manage before the first category exists, and an empty disclosure
  // is a control that teaches the reader nothing.
  if (categories.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setOpen((previous) => !previous)}
          aria-expanded={open}
          aria-controls="kb-category-manager"
          className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
        >
          {open ? t('playbook.kbCategories.hide') : t('playbook.kbCategories.manage')}
        </button>
      </div>

      {open && (
        <div id="kb-category-manager" className="rounded-md border border-border bg-surface-2 p-3">
          <p className="text-2xs text-content-tertiary">{t('playbook.kbCategories.description')}</p>
          <ul role="list" className="mt-2 divide-y divide-border">
            {categories.map((category) => (
              <KbCategoryRow key={category.id} category={category} onChanged={onChanged} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function KbCategoryRow({
  category,
  onChanged,
}: {
  category: KbCategory;
  onChanged: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const [name, setName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);

  const rename = useMutation({
    mutationFn: (nextName: string) =>
      api.patch<KbCategory>(`/kb-categories/${category.id}`, { name: nextName }),
    onSuccess: onChanged,
    // The row goes back to the name the server still holds, so the input never
    // shows a value that was refused.
    onError: () => setName(category.name),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/kb-categories/${category.id}`),
    onSuccess: () => {
      setConfirming(false);
      onChanged();
    },
  });

  function save(): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === category.name) {
      setName(category.name);
      return;
    }
    rename.mutate(trimmed);
  }

  const error = rename.error ?? remove.error;

  return (
    <li className="flex flex-col gap-1.5 py-2">
      <div className="flex items-center gap-2">
        <label htmlFor={`kb-category-name-${category.id}`} className="sr-only">
          {t('playbook.kbCategories.nameLabel', { name: category.name })}
        </label>
        <input
          id={`kb-category-name-${category.id}`}
          value={name}
          disabled={rename.isPending || remove.isPending}
          onChange={(event) => setName(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
            if (event.key === 'Escape') setName(category.name);
          }}
          className="flex-1 rounded-md border border-border bg-inset px-2 py-1 text-sm outline-none disabled:opacity-70"
        />

        {confirming ? (
          <>
            <button
              type="button"
              onClick={() => remove.mutate()}
              disabled={remove.isPending}
              className="rounded-md border border-danger px-2 py-1 text-2xs text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              {t('playbook.kbCategories.confirmRemove')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface"
            >
              {t('playbook.kbCategories.cancel')}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={t('playbook.kbCategories.removeLabel', { name: category.name })}
            className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface"
          >
            {t('playbook.kbCategories.remove')}
          </button>
        )}
      </div>

      {confirming && (
        <p className="text-2xs text-content-tertiary">
          {t('playbook.kbCategories.removeExplainer')}
        </p>
      )}

      {error && <ErrorNotice message={t(errorMessageKey(error))} />}
    </li>
  );
}
