/**
 * The list renders status tabs with correct counts, narrows by tab/search/
 * category, shows a meaningful (non-empty-rectangle) empty state per tab, and
 * is keyboard-operable (NFR-A11Y1, FR-EK-B.1).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import type { KbArticle, KbCategory } from './types.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { KbArticleList } = await import('./KbArticleList.js');

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
    updated_at: '2026-01-15T00:00:00.000Z',
    ...over,
  };
}

const CATEGORIES: KbCategory[] = [
  { id: 'cat-a', slug: 'billing', name: 'Billing', position: 0, created_at: '2026-01-01T00:00:00.000Z' },
];

function mockKb(articles: KbArticle[], categories: KbCategory[] = CATEGORIES): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/kb-articles') return Promise.resolve({ items: articles, total: articles.length });
    if (path === '/kb-categories') return Promise.resolve({ items: categories });
    if (path === '/kb-settings') {
      return Promise.resolve({ enabled: true, public_slug: 'acme', site_title: null, updated_at: null });
    }
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

function renderList(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
});

describe('KbArticleList', () => {
  it('shows a meaningful empty state, not an empty rectangle, when there are no articles at all', async () => {
    mockKb([]);
    renderList(<KbArticleList />);

    expect(await screen.findByText('No articles yet')).toBeInTheDocument();
    expect(
      screen.getByText('An article filed here can be published to the public knowledge base.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('renders status tabs with correct counts and role=tablist / aria-selected', async () => {
    mockKb([
      article({ id: 'p1', status: 'published' }),
      article({ id: 'p2', status: 'published' }),
      article({ id: 'd1', status: 'draft' }),
    ]);
    renderList(<KbArticleList />);

    const tablist = await screen.findByRole('tablist', { name: 'KB article status' });
    const all = within(tablist).getByRole('tab', { name: /All/ });
    const published = within(tablist).getByRole('tab', { name: /Published/ });
    const drafts = within(tablist).getByRole('tab', { name: /Drafts/ });

    expect(within(all).getByText('3')).toBeInTheDocument();
    expect(within(published).getByText('2')).toBeInTheDocument();
    expect(within(drafts).getByText('1')).toBeInTheDocument();
    expect(all).toHaveAttribute('aria-selected', 'true');
    expect(published).toHaveAttribute('aria-selected', 'false');
  });

  it('switching tabs narrows the list, each with the article title, category, status and updated date', async () => {
    const user = userEvent.setup();
    mockKb([
      article({ id: 'p1', status: 'published', category_id: 'cat-a', title: 'Delivery times' }),
      article({ id: 'd1', status: 'draft', title: 'Draft article' }),
    ]);
    renderList(<KbArticleList />);

    await screen.findByRole('tablist');
    const panel = screen.getByRole('tabpanel');
    expect(within(panel).getByText('Delivery times')).toBeInTheDocument();
    expect(within(panel).getByText('Draft article')).toBeInTheDocument();
    expect(within(panel).getByText(/Billing/)).toBeInTheDocument();
    expect(within(panel).getByText('Published')).toBeInTheDocument();
    expect(within(panel).getByText('Draft')).toBeInTheDocument();

    // Keyboard-operable: Tab to the Published tab, activate with Enter.
    await user.tab();
    await user.tab();
    const publishedTab = screen.getByRole('tab', { name: /Published/ });
    expect(publishedTab).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(publishedTab).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Delivery times')).toBeInTheDocument();
    expect(screen.queryByText('Draft article')).not.toBeInTheDocument();
  });

  it('shows a tab-specific empty state when the whole list has articles but a tab has none', async () => {
    mockKb([article({ id: 'p1', status: 'published' })]);
    renderList(<KbArticleList />);

    const draftsTab = await screen.findByRole('tab', { name: /Drafts/ });
    await userEvent.setup().click(draftsTab);

    expect(await screen.findByText('Nothing here')).toBeInTheDocument();
    expect(screen.getByText('No drafts — every article here is published.')).toBeInTheDocument();
  });

  it('search and category filters narrow within a tab, with a clear-filters way back', async () => {
    const user = userEvent.setup();
    mockKb([
      article({ id: 'p1', status: 'published', category_id: 'cat-a', title: 'Delivery times' }),
      article({ id: 'p2', status: 'published', title: 'Returns policy' }),
    ]);
    renderList(<KbArticleList />);

    const search = await screen.findByPlaceholderText('Search articles…');
    await user.type(search, 'delivery');

    await waitFor(() => {
      expect(screen.getByText('Delivery times')).toBeInTheDocument();
      expect(screen.queryByText('Returns policy')).not.toBeInTheDocument();
    });

    await user.clear(search);
    await waitFor(() => expect(screen.getByText('Returns policy')).toBeInTheDocument());

    await user.selectOptions(screen.getByLabelText('Category'), 'Billing');
    await waitFor(() => expect(screen.queryByText('Returns policy')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByText('Returns policy')).toBeInTheDocument());
  });

  it('shows a loading skeleton while the first fetch is in flight', async () => {
    let resolve!: (v: { items: KbArticle[]; total: number }) => void;
    api.get.mockImplementation((path: string) => {
      if (path === '/kb-articles') return new Promise((r) => (resolve = r));
      if (path === '/kb-categories') return Promise.resolve({ items: [] });
      return Promise.reject(new Error(`unexpected ${path}`));
    });
    renderList(<KbArticleList />);
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
    resolve({ items: [], total: 0 });
    await screen.findByText('No articles yet');
  });

  it('shows an error notice when the API is unreachable', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/kb-articles') return Promise.reject(new Error('network down'));
      return Promise.resolve({ items: [] });
    });
    renderList(<KbArticleList />);

    expect(await screen.findByText(/Could not load the knowledge base articles/)).toBeInTheDocument();
  });

  it('hides "New article" and does not open an editor without edit permission', async () => {
    mockKb([article({ id: 'p1', status: 'published', title: 'Delivery times' })]);
    renderList(<KbArticleList />);

    await screen.findByText('Delivery times');
    expect(screen.queryByRole('button', { name: 'New article' })).not.toBeInTheDocument();
    // The row is plain text, not a button, when the viewer cannot edit.
    expect(screen.getByText('Delivery times').closest('button')).toBeNull();
  });

  it('"New article" opens the editor in create mode', async () => {
    const user = userEvent.setup();
    mockKb([]);
    renderList(<KbArticleList canEdit />);

    await user.click(await screen.findByRole('button', { name: 'New article' }));

    expect(await screen.findByRole('dialog', { name: 'New article' })).toBeInTheDocument();
  });

  it('clicking an article row opens the editor for that article', async () => {
    const user = userEvent.setup();
    mockKb([article({ id: 'p1', status: 'draft', title: 'Delivery times' })]);
    renderList(<KbArticleList canEdit />);

    await user.click(await screen.findByText('Delivery times'));

    const dialog = await screen.findByRole('dialog', { name: 'Edit article' });
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Delivery times');
  });
});
