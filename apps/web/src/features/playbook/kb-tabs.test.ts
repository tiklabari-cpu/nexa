import { describe, expect, it } from 'vitest';
import type { KbArticle } from './types.js';
import {
  applyKbControls,
  articleMatchesControls,
  countArticlesByTab,
  DEFAULT_KB_CONTROLS,
  filterArticlesByTab,
  hasActiveKbFilters,
  KB_TABS,
  type KbListControls,
} from './kb-tabs.js';

function article(over: Partial<KbArticle> & { id: string }): KbArticle {
  return {
    category_id: null,
    slug: over.id,
    title: `${over.id} title`,
    body: 'body',
    excerpt: null,
    seo_title: null,
    seo_description: null,
    status: 'draft',
    published_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const ARTICLES: KbArticle[] = [
  article({ id: 'p1', status: 'published', category_id: 'cat-a', title: 'Delivery times' }),
  article({ id: 'p2', status: 'published', category_id: 'cat-b', title: 'Returns policy' }),
  article({ id: 'd1', status: 'draft', category_id: 'cat-a', title: 'Upcoming feature' }),
  article({ id: 'd2', status: 'draft', category_id: null, title: 'Draft with no category' }),
];

describe('KB status tabs', () => {
  it('Published returns only published articles, Drafts only drafts', () => {
    expect(filterArticlesByTab(ARTICLES, 'published').map((a) => a.id)).toEqual(['p1', 'p2']);
    expect(filterArticlesByTab(ARTICLES, 'draft').map((a) => a.id)).toEqual(['d1', 'd2']);
  });

  it('All shows every article and never loses one', () => {
    expect(filterArticlesByTab(ARTICLES, 'all')).toHaveLength(ARTICLES.length);
  });

  it('the status tabs partition All exactly — no overlap, nothing dropped', () => {
    const counts = countArticlesByTab(ARTICLES);
    expect(counts.all).toBe(ARTICLES.length);
    expect(counts.published + counts.draft).toBe(counts.all);
    expect(counts).toMatchObject({ published: 2, draft: 2 });
  });

  it('lists the tabs in the order the UI reads them', () => {
    expect(KB_TABS).toEqual(['all', 'published', 'draft']);
  });
});

describe('KB search + category controls', () => {
  it('the default controls match every article', () => {
    for (const a of ARTICLES) expect(articleMatchesControls(a, DEFAULT_KB_CONTROLS)).toBe(true);
  });

  it('search narrows by a case-insensitive substring of the title', () => {
    const controls: KbListControls = { query: 'RETURNS', category: 'all' };
    expect(applyKbControls(ARTICLES, controls).map((a) => a.id)).toEqual(['p2']);
  });

  it('category narrows to articles filed under that category', () => {
    const controls: KbListControls = { query: '', category: 'cat-a' };
    expect(applyKbControls(ARTICLES, controls).map((a) => a.id)).toEqual(['p1', 'd1']);
  });

  it('"none" narrows to uncategorized articles', () => {
    const controls: KbListControls = { query: '', category: 'none' };
    expect(applyKbControls(ARTICLES, controls).map((a) => a.id)).toEqual(['d2']);
  });

  it('search and category narrow together, not just either alone', () => {
    const controls: KbListControls = { query: 'draft', category: 'none' };
    expect(applyKbControls(ARTICLES, controls).map((a) => a.id)).toEqual(['d2']);

    const noMatch: KbListControls = { query: 'draft', category: 'cat-a' };
    expect(applyKbControls(ARTICLES, noMatch)).toHaveLength(0);
  });

  it('controls apply on top of whatever the tab already narrowed to', () => {
    const published = filterArticlesByTab(ARTICLES, 'published');
    const controls: KbListControls = { query: '', category: 'cat-a' };
    expect(applyKbControls(published, controls).map((a) => a.id)).toEqual(['p1']);
  });

  it('reports whether any filter is active', () => {
    expect(hasActiveKbFilters(DEFAULT_KB_CONTROLS)).toBe(false);
    expect(hasActiveKbFilters({ query: 'x', category: 'all' })).toBe(true);
    expect(hasActiveKbFilters({ query: '', category: 'cat-a' })).toBe(true);
    expect(hasActiveKbFilters({ query: '   ', category: 'all' })).toBe(false);
  });
});
