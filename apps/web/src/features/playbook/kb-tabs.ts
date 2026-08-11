/**
 * Which status tab a KB article belongs to, and how the list narrows within a
 * tab — by category, and by a (separately debounced) search query.
 *
 * The status split is a clean partition, the sibling of `knowledge-tabs.ts`:
 * every article lands under exactly one status, so `All = Published ∪ Drafts`
 * with nothing hidden and nothing double-counted. That is the property a team
 * needs to trust the tabs on — a bilgi bankası is only "yönetilebilir" if the
 * team can see, at a glance, which article is live and which is still a draft
 * (PUBKB-g KK).
 *
 * Category and search are a second, finer cut layered on top of the tab (the
 * `skill-filter.ts` role) — kept in the same module rather than a sibling file
 * because there is only one control surface here, not skill's independent
 * type/status/owner/sort axes.
 */
import type { KbArticle } from './types.js';

export type KbTab = 'all' | 'published' | 'draft';

/** The statuses the schema stores, in the order the tabs read left to right. */
export const KB_TABS: readonly KbTab[] = ['all', 'published', 'draft'];

type ArticleStatusFacet = Pick<KbArticle, 'status'>;

/** The subset shown under a tab. `all` passes everything through unchanged. */
export function filterArticlesByTab<T extends ArticleStatusFacet>(
  articles: readonly T[],
  tab: KbTab,
): T[] {
  if (tab === 'all') return [...articles];
  return articles.filter((article) => article.status === tab);
}

/** How many articles sit under each tab, for the counts on the tab labels. */
export function countArticlesByTab(articles: readonly ArticleStatusFacet[]): Record<KbTab, number> {
  const counts: Record<KbTab, number> = { all: articles.length, published: 0, draft: 0 };
  for (const article of articles) counts[article.status] += 1;
  return counts;
}

/** `all` = every category, `none` = uncategorized (`category_id === null`), otherwise a category id. */
export type KbCategoryFilter = string;

export interface KbListControls {
  /** Free text, matched case-insensitively as a substring of the title. Debounced by the caller. */
  query: string;
  category: KbCategoryFilter;
}

export const DEFAULT_KB_CONTROLS: KbListControls = { query: '', category: 'all' };

type ArticleControlFacet = Pick<KbArticle, 'title' | 'category_id'>;

/** Whether one article passes the search + category controls (the tab is applied separately). */
export function articleMatchesControls(
  article: ArticleControlFacet,
  controls: KbListControls,
): boolean {
  const query = controls.query.trim().toLowerCase();
  if (query && !article.title.toLowerCase().includes(query)) return false;

  if (controls.category !== 'all') {
    if (
      controls.category === 'none'
        ? article.category_id !== null
        : article.category_id !== controls.category
    )
      return false;
  }

  return true;
}

/** Category + search, applied on top of whatever the tab already narrowed to. */
export function applyKbControls<T extends ArticleControlFacet>(
  articles: readonly T[],
  controls: KbListControls,
): T[] {
  return articles.filter((article) => articleMatchesControls(article, controls));
}

/** True when any narrowing control is set. */
export function hasActiveKbFilters(controls: KbListControls): boolean {
  return controls.query.trim() !== '' || controls.category !== 'all';
}
