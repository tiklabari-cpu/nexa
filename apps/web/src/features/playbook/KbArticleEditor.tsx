/**
 * Admin: the public KB article editor — content, SEO fields, and the
 * publish/unpublish control (PUBKB-h · PRD §5.3-Knowledge · FR-EK-A.1).
 *
 * "SEO'lu" means an author edits the field a search engine will show
 * (SEO title/description) and the article's permanent address (slug), not
 * just its body; "public" means going live is one explicit, reversible
 * action — Publish/Unpublish PATCHes only `status`, never a side effect of
 * saving content. The slug auto-derives from the title for a brand-new
 * article (nothing to protect yet) and locks the moment there is a real
 * article to link to — from then on only a deliberate edit changes it, so a
 * content edit can never silently move a published article's URL.
 *
 * Content and publish state are independent mutations on purpose: an author
 * can keep editing a draft after publishing it, or unpublish without losing
 * unsaved content, because the backend already treats `status` as just one
 * more optional PATCH field.
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactElement } from 'react';
import { Banner, Modal } from '../../components/ui/index.js';
import { StatusDot } from '../../components/StatusDot.js';
import { ApiClientError, errorMessageKey } from '../../lib/api-client.js';
import { useApiClient } from '../../lib/auth-store.js';
import { useCloseGuard } from '../../lib/dirty-guard.js';
import { FieldError, required, useForm } from '../../lib/form.js';
import { useTranslate, type TFunction } from '../../lib/i18n.js';
import type { KbArticle, KbCategory } from './types.js';
import { deriveKbSlug, kbSlugError } from './kb-slug.js';

type FieldName =
  'title' | 'slug' | 'body' | 'category' | 'excerpt' | 'seo_title' | 'seo_description';
type FormValues = Record<FieldName, string>;

/** Selecting this in the Category picker reveals the "new category" input. */
const NEW_CATEGORY_VALUE = '__new__';

const KNOWN_FIELDS = new Set<FieldName>([
  'title',
  'slug',
  'body',
  'category',
  'excerpt',
  'seo_title',
  'seo_description',
]);

/** The backend's own field name for what this form calls `category`. */
const FIELD_ALIASES: Record<string, FieldName> = { category_id: 'category' };

/**
 * The server's validation messages are `"<field>: <message>"` (`kb.ts`
 * `parse()` and the hand-thrown slug/category errors). Recovering the field
 * name is what lets a slug collision land under the Slug field instead of a
 * generic toast (KK).
 */
function fieldFromMessage(message: string): FieldName | null {
  const separator = message.indexOf(':');
  if (separator <= 0) return null;
  const raw = message.slice(0, separator).trim();
  const field = (FIELD_ALIASES[raw] ?? raw) as FieldName;
  return KNOWN_FIELDS.has(field) ? field : null;
}

const PUBLIC_KB_BASE =
  (import.meta.env['VITE_KB_PUBLIC_BASE'] as string | undefined) ?? 'http://localhost:4000/api/v1';

/** Matches the address `public-kb-html.ts` actually serves an article at. */
function buildPublicKbUrl(workspaceSlug: string, articleSlug: string): string {
  return `${PUBLIC_KB_BASE}/public/kb/${workspaceSlug}/${articleSlug}`;
}

/**
 * `kb-slug.ts`'s `kbSlugError` stays untouched (its own unit test pins the
 * three exact English messages) — this translates by matching which of its
 * three fixed branches fired, rather than threading a translate function
 * into a tested, non-React module.
 */
function kbSlugErrorText(slug: string, t: TFunction): string | null {
  const message = kbSlugError(slug);
  if (message === null) return null;
  if (message.includes('permanent address')) return t('playbook.kbEditor.slugRequired');
  if (message.includes('lower-case letters')) return t('playbook.kbEditor.slugPattern');
  return t('playbook.kbEditor.slugReserved', { slug: slug.trim() });
}

interface KbSettings {
  enabled: boolean;
  public_slug: string | null;
  site_title: string | null;
  updated_at: string | null;
}

export function KbArticleEditor({
  article,
  categories,
  canEdit,
  onClose,
  onSaved,
}: {
  /** `null` starts a new article; the backend always creates it as a draft. */
  article: KbArticle | null;
  categories: KbCategory[];
  canEdit: boolean;
  onClose: () => void;
  /** Called after a content save, a category creation, or a publish toggle. */
  onSaved: () => void;
}): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const isNew = article === null;

  // The article as last persisted — starts as the prop, and becomes the
  // server's response the moment a create or publish toggle succeeds, which
  // is what turns "New article" into an editable, publishable one in place.
  const [current, setCurrent] = useState<KbArticle | null>(article);
  // An existing article already has a real, linked-to slug: only a deliberate
  // edit may move it. A brand-new one has nothing to protect yet, so the
  // title is free to keep deriving it until the author types into Slug
  // themselves.
  const [slugEdited, setSlugEdited] = useState(!isNew);
  const [newCategoryName, setNewCategoryName] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const settings = useQuery({
    queryKey: ['playbook', 'kb-settings'],
    queryFn: () => api.get<KbSettings>('/kb-settings'),
  });

  const form = useForm<FormValues>({
    initial: {
      title: article?.title ?? '',
      slug: article?.slug ?? '',
      body: article?.body ?? '',
      excerpt: article?.excerpt ?? '',
      seo_title: article?.seo_title ?? '',
      seo_description: article?.seo_description ?? '',
      category: article?.category_id ?? '',
    },
    validators: {
      title: required(t('playbook.kbEditor.titleRequired')),
      slug: (value) => kbSlugErrorText(value, t),
      body: required(t('playbook.kbEditor.bodyRequired')),
    },
    onSubmit: async (values, { setFieldError, setSubmitError }) => {
      if (!isNew && !current) {
        setSubmitError(t('playbook.kbEditor.reopenError'));
        return;
      }

      let categoryId: string | null;
      if (values.category === NEW_CATEGORY_VALUE) {
        const name = (newCategoryName ?? '').trim();
        if (!name) {
          setSubmitError(t('playbook.kbEditor.nameCategoryError'));
          return;
        }
        try {
          const created = await api.post<KbCategory>('/kb-categories', { name });
          categoryId = created.id;
        } catch (failure) {
          setSubmitError(t(errorMessageKey(failure)));
          return;
        }
      } else {
        categoryId = values.category || null;
      }

      const payload = {
        title: values.title.trim(),
        slug: values.slug.trim(),
        body: values.body,
        category_id: categoryId,
        excerpt: values.excerpt.trim() || null,
        seo_title: values.seo_title.trim() || null,
        seo_description: values.seo_description.trim() || null,
      };

      try {
        const saved = isNew
          ? // i18n-ignore: TS generic call signature, not prose (mirrors PublicPages.tsx's trustDomain() waiver).
            await api.post<KbArticle>('/kb-articles', payload)
          : await api.patch<KbArticle>(`/kb-articles/${current!.id}`, payload);
        setCurrent(saved);
        setSlugEdited(true);
        setNewCategoryName(null);
        onSaved();
      } catch (failure) {
        if (failure instanceof ApiClientError && failure.type === 'validation') {
          // i18n-ignore: read only to route the error to its field, not shown.
          const field = fieldFromMessage(failure.message);
          if (field) {
            // Server names the exact colliding value (e.g. the slug already
            // in use); KbArticleEditor.test.tsx's "backend slug collision"
            // case pins this text, and errorMessageKey()'s generic bucket
            // would lose which value collided.
            // i18n-ignore: see the note above.
            setFieldError(field, failure.message);
            return;
          }
        }
        setSubmitError(t(errorMessageKey(failure)));
      }
    },
  });

  const publish = useMutation({
    mutationFn: (status: 'draft' | 'published') => {
      if (!current) throw new Error('Save the article before publishing it.');
      return api.patch<KbArticle>(`/kb-articles/${current.id}`, { status });
    },
    onSuccess: (updated) => {
      setCurrent(updated);
      onSaved();
    },
  });

  // Half-written content is work; a stray Escape or backdrop click should not
  // silently throw it away (FR-EK-A.2 / T5-a).
  const close = useCloseGuard({
    isDirty: form.isDirty,
    message: t('playbook.kbEditor.discardConfirm'),
    onClose,
  });

  const titleError = form.errorFor('title');
  const slugError = form.errorFor('slug');
  const bodyError = form.errorFor('body');

  const kbDisabled = settings.data ? !settings.data.enabled : false;
  const publicUrl =
    current?.status === 'published' && settings.data?.public_slug
      ? buildPublicKbUrl(settings.data.public_slug, current.slug)
      : null;

  function copyLink(): void {
    if (!publicUrl) return;
    void navigator.clipboard?.writeText(publicUrl).then(
      () => {
        setLinkCopied(true);
        window.setTimeout(() => setLinkCopied(false), 1_500);
      },
      () => setLinkCopied(false),
    );
  }

  return (
    <Modal
      onClose={close}
      title={isNew ? t('playbook.kbEditor.newTitle') : t('playbook.kbEditor.editTitle')}
      align="top"
      className="max-w-2xl"
    >
      <form onSubmit={form.handleSubmit} noValidate className="flex flex-col gap-3">
        {kbDisabled && (
          <Banner tone="warning" title={t('playbook.kbEditor.disabledBannerTitle')}>
            {t('playbook.kbEditor.disabledBannerBody')}
          </Banner>
        )}

        {form.submitError && (
          <p role="alert" className="text-sm text-danger">
            {form.submitError}
          </p>
        )}

        {/* Sibling labels throughout, not wrapping: an error message or help
            text as a label's child folds into its accessible name — which
            would make `aria-describedby` redundant and break "find by label"
            the moment an error actually renders. */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="kb-title"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('playbook.kbEditor.title')}
          </label>
          <input
            id="kb-title"
            value={form.values.title}
            disabled={!canEdit}
            autoFocus
            onChange={(event) => {
              const value = event.target.value;
              form.setValue('title', value);
              if (!slugEdited) form.setValue('slug', deriveKbSlug(value));
            }}
            onBlur={() => form.blur('title')}
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? 'kb-title-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
          />
          <FieldError id="kb-title-error" message={titleError} />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="kb-slug"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('playbook.kbEditor.slug')}
          </label>
          <input
            id="kb-slug"
            value={form.values.slug}
            disabled={!canEdit}
            onChange={(event) => {
              setSlugEdited(true);
              form.setValue('slug', event.target.value);
            }}
            onBlur={() => form.blur('slug')}
            aria-invalid={slugError ? true : undefined}
            aria-describedby={slugError ? 'kb-slug-error' : undefined}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
          />
          <FieldError id="kb-slug-error" message={slugError} />
        </div>

        <div className="flex flex-col gap-1">
          {/* Sibling label: a <select>'s option text would otherwise fold into
              the accessible name (see Page.tsx's Section for the same note). */}
          <label
            htmlFor="kb-category"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('playbook.kbEditor.category')}
          </label>
          <select
            id="kb-category"
            value={form.values.category}
            disabled={!canEdit}
            onChange={(event) => form.setValue('category', event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm text-content outline-none disabled:opacity-60"
          >
            <option value="">{t('playbook.kbEditor.noCategory')}</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
            <option value={NEW_CATEGORY_VALUE}>{t('playbook.kbEditor.newCategoryOption')}</option>
          </select>

          {form.values.category === NEW_CATEGORY_VALUE && (
            <label htmlFor="kb-new-category" className="mt-1 flex flex-col gap-1">
              <span className="text-2xs text-content-tertiary">
                {t('playbook.kbEditor.newCategoryLabel')}
              </span>
              <input
                id="kb-new-category"
                value={newCategoryName ?? ''}
                disabled={!canEdit}
                onChange={(event) => setNewCategoryName(event.target.value)}
                className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
              />
            </label>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="kb-body"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('playbook.kbEditor.body')}
          </label>
          <textarea
            id="kb-body"
            rows={8}
            value={form.values.body}
            disabled={!canEdit}
            onChange={(event) => form.setValue('body', event.target.value)}
            onBlur={() => form.blur('body')}
            aria-invalid={bodyError ? true : undefined}
            aria-describedby={bodyError ? 'kb-body-error kb-body-help' : 'kb-body-help'}
            className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
          />
          <p id="kb-body-help" className="text-2xs text-content-tertiary">
            {t('playbook.kbEditor.bodyHelp')}
          </p>
          <FieldError id="kb-body-error" message={bodyError} />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="kb-excerpt"
            className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
          >
            {t('playbook.kbEditor.excerpt')}
          </label>
          <textarea
            id="kb-excerpt"
            rows={2}
            value={form.values.excerpt}
            disabled={!canEdit}
            onChange={(event) => form.setValue('excerpt', event.target.value)}
            className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1">
          {/* Sibling label, not wrapping: the counter is a second text node
              that would otherwise fold into the input's accessible name. */}
          <div className="flex items-center justify-between">
            <label
              htmlFor="kb-seo-title"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('playbook.kbEditor.seoTitle')}
            </label>
            <span className="text-2xs text-content-tertiary">
              {t('playbook.kbEditor.seoTitleHint', { count: form.values.seo_title.length })}
            </span>
          </div>
          <input
            id="kb-seo-title"
            value={form.values.seo_title}
            disabled={!canEdit}
            onChange={(event) => form.setValue('seo_title', event.target.value)}
            className="rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
          />
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <label
              htmlFor="kb-seo-description"
              className="text-2xs font-medium uppercase tracking-wide text-content-tertiary"
            >
              {t('playbook.kbEditor.seoDescription')}
            </label>
            <span className="text-2xs text-content-tertiary">
              {t('playbook.kbEditor.seoDescriptionHint', {
                count: form.values.seo_description.length,
              })}
            </span>
          </div>
          <textarea
            id="kb-seo-description"
            rows={2}
            value={form.values.seo_description}
            disabled={!canEdit}
            onChange={(event) => form.setValue('seo_description', event.target.value)}
            className="resize-y rounded-md border border-border bg-inset px-2 py-1.5 text-sm outline-none disabled:opacity-60"
          />
        </div>

        {current && (
          <div className="flex items-center gap-3 border-t border-border pt-3">
            <StatusDot
              tone={current.status === 'published' ? 'success' : 'neutral'}
              label={
                current.status === 'published'
                  ? t('playbook.kbEditor.statusPublished')
                  : t('playbook.kbEditor.statusDraft')
              }
            />
            {canEdit && (
              <button
                type="button"
                disabled={publish.isPending}
                onClick={() =>
                  publish.mutate(current.status === 'published' ? 'draft' : 'published')
                }
                className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-surface-2 disabled:opacity-50"
              >
                {publish.isPending
                  ? t('playbook.kbEditor.saving')
                  : current.status === 'published'
                    ? t('playbook.kbEditor.unpublish')
                    : t('playbook.kbEditor.publish')}
              </button>
            )}
          </div>
        )}

        {publish.isError && (
          <p role="alert" className="text-2xs text-danger">
            {t('playbook.kbEditor.publishError')}
          </p>
        )}

        {publicUrl && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-inset px-3 py-2">
            <a
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 flex-1 truncate text-2xs text-content-brand hover:underline"
            >
              {publicUrl}
            </a>
            <button
              type="button"
              onClick={copyLink}
              className="shrink-0 rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
            >
              {linkCopied ? t('playbook.kbEditor.copied') : t('playbook.kbEditor.copy')}
            </button>
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={close}
            className="rounded-md border border-border px-3 py-1.5 text-sm"
          >
            {canEdit ? t('playbook.kbEditor.cancel') : t('playbook.kbEditor.close')}
          </button>
          {canEdit && (
            <button
              type="submit"
              disabled={!form.canSubmit}
              className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
            >
              {form.isSubmitting
                ? t('playbook.kbEditor.saving')
                : isNew
                  ? t('playbook.kbEditor.createArticle')
                  : t('playbook.kbEditor.saveChanges')}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
