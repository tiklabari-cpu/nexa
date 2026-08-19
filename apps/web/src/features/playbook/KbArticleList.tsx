/**
 * Admin: the public KB article list — status tabs (All / Published / Drafts),
 * search and category filters, and a meaningful empty state for every tab
 * (FR-EK-B.1, NFR-A11Y1).
 *
 * Owns the surface `GET /kb-articles` feeds, and — for someone with write
 * access — the doorway into creating and editing one: "New article" and each
 * row open `KbArticleEditor` (PUBKB-h), which does the actual writing,
 * publishing and unpublishing. A bilgi bankası is "yönetilebilir" the moment
 * the team can both see at a glance which article is live and act on it,
 * which is exactly what the tabs plus this doorway answer together.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Card, ErrorNotice, Section } from '../../components/Page.js';
import { EmptyState } from '../../components/EmptyState.js';
import { ListSkeleton } from '../../components/Skeleton.js';
import { StatusDot } from '../../components/StatusDot.js';
import { useApiClient } from '../../lib/auth-store.js';
import { formatDate } from '../../lib/format.js';
import { useTranslate } from '../../lib/i18n.js';
import type { KbArticle, KbCategory } from './types.js';
import { KbArticleEditor } from './KbArticleEditor.js';
import {
  applyKbControls,
  countArticlesByTab,
  filterArticlesByTab,
  hasActiveKbFilters,
  KB_TABS,
  type KbListControls,
  type KbTab,
} from './kb-tabs.js';

const TAB_LABEL_KEYS: Record<KbTab, string> = {
  all: 'playbook.kb.tabAll',
  published: 'playbook.kb.tabPublished',
  draft: 'playbook.kb.tabDraft',
};

/**
 * Tab-specific empty copy, shown when the whole list has articles but this
 * tab has none. `all` is only ever non-empty here (if there are articles at
 * all, the All tab holds them), so its copy is a never-reached fallback.
 */
const EMPTY_BY_TAB_KEY: Record<KbTab, string> = {
  all: 'playbook.kb.emptyByTabAll',
  published: 'playbook.kb.emptyByTabPublished',
  draft: 'playbook.kb.emptyByTabDraft',
};

export function KbArticleList({ canEdit = false }: { canEdit?: boolean }): ReactElement {
  const t = useTranslate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<KbTab>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [editing, setEditing] = useState<KbArticle | 'new' | null>(null);

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['playbook', 'kb-articles'] });
    void queryClient.invalidateQueries({ queryKey: ['playbook', 'kb-categories'] });
  };

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 200);
    return () => clearTimeout(timer);
  }, [search]);

  const articles = useQuery({
    queryKey: ['playbook', 'kb-articles'],
    queryFn: () => api.get<{ items: KbArticle[]; total: number }>('/kb-articles'),
  });

  const categories = useQuery({
    queryKey: ['playbook', 'kb-categories'],
    queryFn: () => api.get<{ items: KbCategory[] }>('/kb-categories'),
  });

  const items = articles.data?.items ?? [];
  const categoryList = categories.data?.items ?? [];
  const categoryNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of categoryList) map.set(c.id, c.name);
    return map;
  }, [categoryList]);

  const tabCounts = countArticlesByTab(items);
  const controls: KbListControls = { query, category };
  const tabItems = filterArticlesByTab(items, tab);
  const visibleItems = applyKbControls(tabItems, controls);

  const clearFilters = () => {
    setSearch('');
    setQuery('');
    setCategory('all');
  };

  if (articles.error || categories.error) {
    return <ErrorNotice message={t('playbook.kb.loadError')} />;
  }

  return (
    <Section title={t('playbook.kb.title')} description={t('playbook.kb.description')}>
      {canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            {t('playbook.kb.newArticle')}
          </button>
        </div>
      )}

      {articles.isPending || categories.isPending ? (
        <Card>
          <ListSkeleton />
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            title={t('playbook.kb.emptyTitle')}
            description={t('playbook.kb.emptyDescription')}
          />
        </Card>
      ) : (
        <>
          <div
            role="tablist"
            aria-label={t('playbook.kb.statusLabel')}
            className="flex gap-1 border-b border-border"
          >
            {KB_TABS.map((kbTab) => {
              const active = tab === kbTab;
              return (
                <button
                  key={kbTab}
                  type="button"
                  role="tab"
                  id={`kb-tab-${kbTab}`}
                  aria-selected={active}
                  aria-controls="kb-tabpanel"
                  onClick={() => setTab(kbTab)}
                  className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-brand-500 text-content'
                      : 'border-transparent text-content-secondary hover:text-content'
                  }`}
                >
                  <span>{t(TAB_LABEL_KEYS[kbTab])}</span>
                  <span className="text-2xs text-content-tertiary">{tabCounts[kbTab]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-center">
              <span className="sr-only">{t('playbook.kb.searchLabel')}</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('playbook.kb.searchPlaceholder')}
                className="w-full rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
              />
            </label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center gap-1.5 text-2xs text-content-tertiary">
                <label htmlFor="kb-filter-category">{t('playbook.kb.category')}</label>
                <select
                  id="kb-filter-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1 text-xs text-content outline-none"
                >
                  <option value="all">{t('playbook.kb.allCategories')}</option>
                  {categoryList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="none">{t('playbook.kb.uncategorized')}</option>
                </select>
              </span>
              {hasActiveKbFilters(controls) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                >
                  {t('playbook.kb.clear')}
                </button>
              )}
            </div>
          </div>

          <Card>
            <div role="tabpanel" id="kb-tabpanel" aria-labelledby={`kb-tab-${tab}`}>
              {tabItems.length === 0 ? (
                <EmptyState
                  title={t('playbook.kb.nothingHereTitle')}
                  description={t(EMPTY_BY_TAB_KEY[tab])}
                />
              ) : visibleItems.length === 0 ? (
                <EmptyState
                  title={t('playbook.kb.noMatchTitle')}
                  description={t('playbook.kb.noMatchDescription')}
                  action={
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      {t('playbook.kb.clearFilters')}
                    </button>
                  }
                />
              ) : (
                <ul
                  role="list"
                  aria-label={t('playbook.kb.title')}
                  className="divide-y divide-border"
                >
                  {visibleItems.map((article) => {
                    const meta = (
                      <p className="truncate text-2xs text-content-tertiary">
                        {article.category_id
                          ? (categoryNameById.get(article.category_id) ??
                            t('playbook.kb.unknownCategory'))
                          : t('playbook.kb.uncategorized')}
                        {' · '}
                        {formatDate(article.updated_at)}
                      </p>
                    );
                    return (
                      <li key={article.id} className="flex items-center gap-3 px-4 py-2.5">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => setEditing(article)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="truncate text-sm font-medium">{article.title}</p>
                            {meta}
                          </button>
                        ) : (
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{article.title}</p>
                            {meta}
                          </div>
                        )}
                        <StatusDot
                          tone={article.status === 'published' ? 'success' : 'neutral'}
                          label={
                            article.status === 'published'
                              ? t('playbook.kb.statusPublished')
                              : t('playbook.kb.statusDraft')
                          }
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Card>
        </>
      )}

      {editing !== null && canEdit && (
        <KbArticleEditor
          key={editing === 'new' ? 'new' : editing.id}
          article={editing === 'new' ? null : editing}
          categories={categoryList}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSaved={invalidate}
        />
      )}
    </Section>
  );
}
