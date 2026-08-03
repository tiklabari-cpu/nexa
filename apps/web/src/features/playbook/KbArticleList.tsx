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

const TAB_LABELS: Record<KbTab, string> = {
  all: 'All',
  published: 'Published',
  draft: 'Drafts',
};

/**
 * Tab-specific empty copy, shown when the whole list has articles but this
 * tab has none. `all` is only ever non-empty here (if there are articles at
 * all, the All tab holds them), so its copy is a never-reached fallback.
 */
const EMPTY_BY_TAB: Record<KbTab, string> = {
  all: 'No articles match.',
  published: 'Nothing published yet — an article goes here once it is published.',
  draft: 'No drafts — every article here is published.',
};

export function KbArticleList({ canEdit = false }: { canEdit?: boolean }): ReactElement {
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
    return <ErrorNotice message="Could not load the knowledge base articles. Check that the API is reachable." />;
  }

  return (
    <Section title="Public KB" description="The self-service articles a visitor can read once published.">
      {canEdit && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="rounded-md bg-brand-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-600"
          >
            New article
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
            title="No articles yet"
            description="An article filed here can be published to the public knowledge base."
          />
        </Card>
      ) : (
        <>
          <div role="tablist" aria-label="KB article status" className="flex gap-1 border-b border-border">
            {KB_TABS.map((t) => {
              const active = tab === t;
              return (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  id={`kb-tab-${t}`}
                  aria-selected={active}
                  aria-controls="kb-tabpanel"
                  onClick={() => setTab(t)}
                  className={`-mb-px flex items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'border-brand-500 text-content'
                      : 'border-transparent text-content-secondary hover:text-content'
                  }`}
                >
                  <span>{TAB_LABELS[t]}</span>
                  <span className="text-2xs text-content-tertiary">{tabCounts[t]}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-2 flex flex-col gap-2">
            <label className="flex items-center">
              <span className="sr-only">Search articles</span>
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search articles…"
                className="w-full rounded-md border border-border bg-inset px-3 py-1.5 text-sm outline-none placeholder:text-content-tertiary"
              />
            </label>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="inline-flex items-center gap-1.5 text-2xs text-content-tertiary">
                <label htmlFor="kb-filter-category">Category</label>
                <select
                  id="kb-filter-category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="rounded-md border border-border bg-inset px-2 py-1 text-xs text-content outline-none"
                >
                  <option value="all">All categories</option>
                  {categoryList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                  <option value="none">Uncategorized</option>
                </select>
              </span>
              {hasActiveKbFilters(controls) && (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-md border border-border px-2 py-1 text-2xs text-content-secondary transition-colors hover:bg-surface-2"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <Card>
            <div role="tabpanel" id="kb-tabpanel" aria-labelledby={`kb-tab-${tab}`}>
              {tabItems.length === 0 ? (
                <EmptyState title="Nothing here" description={EMPTY_BY_TAB[tab]} />
              ) : visibleItems.length === 0 ? (
                <EmptyState
                  title="No articles match"
                  description="Try a different search, or clear the filters to see them all."
                  action={
                    <button
                      type="button"
                      onClick={clearFilters}
                      className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-content-secondary transition-colors hover:bg-surface-2"
                    >
                      Clear filters
                    </button>
                  }
                />
              ) : (
                <ul role="list" aria-label="KB articles" className="divide-y divide-border">
                  {visibleItems.map((article) => {
                    const meta = (
                      <p className="truncate text-2xs text-content-tertiary">
                        {article.category_id ? (categoryNameById.get(article.category_id) ?? 'Unknown category') : 'Uncategorized'}
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
                          label={article.status === 'published' ? 'Published' : 'Draft'}
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
