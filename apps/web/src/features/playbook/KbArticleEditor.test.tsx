/**
 * The editor's contract (PUBKB-h / FR-EK-A.1): a required title/body gate
 * submit, the slug derives from the title until hand-edited, SEO fields round
 * -trip, publish/unpublish flips the badge and the public link, a disabled KB
 * shows its warning, a backend slug collision lands under the Slug field (not
 * a toast), and a dirty form asks before it is discarded.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import type { KbArticle, KbCategory } from './types.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { KbArticleEditor } = await import('./KbArticleEditor.js');
const { ApiClientError } = await import('../../lib/api-client.js');

const SETTINGS_ENABLED = { enabled: true, public_slug: 'acme', site_title: null, updated_at: null };

function article(over: Partial<KbArticle> & { id?: string } = {}): KbArticle {
  return {
    id: 'a1',
    category_id: null,
    slug: 'delivery-times',
    title: 'Delivery times',
    body: 'How long delivery takes.',
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

const CATEGORIES: KbCategory[] = [];

function renderEditor(props: {
  article: KbArticle | null;
  canEdit?: boolean;
  onClose?: () => void;
  onSaved?: () => void;
}): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <KbArticleEditor
        article={props.article}
        categories={CATEGORIES}
        canEdit={props.canEdit ?? true}
        onClose={props.onClose ?? vi.fn()}
        onSaved={props.onSaved ?? vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === '/kb-settings') return Promise.resolve(SETTINGS_ENABLED);
    return Promise.reject(new Error(`unexpected GET ${path}`));
  });
});

describe('KbArticleEditor', () => {
  it('disables submit and shows a field-under error while Title is empty', async () => {
    const user = userEvent.setup();
    renderEditor({ article: null });

    expect(screen.getByRole('button', { name: 'Create article' })).toBeDisabled();

    await user.click(screen.getByLabelText('Title'));
    await user.tab();

    expect(screen.getByText(/Give the article a title/)).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveAttribute('aria-describedby', 'kb-title-error');
  });

  it('derives the slug from the title until the slug is edited by hand', async () => {
    const user = userEvent.setup();
    renderEditor({ article: null });

    const title = screen.getByLabelText('Title');
    const slug = screen.getByLabelText('Slug');

    await user.type(title, 'Shipping and Returns');
    expect(slug).toHaveValue('shipping-and-returns');

    await user.clear(slug);
    await user.type(slug, 'custom-address');
    await user.type(title, ' FAQ');

    // A manual edit locks the slug — further title changes no longer touch it.
    expect(slug).toHaveValue('custom-address');
  });

  it('does not re-derive the slug for an existing article, even as the title changes', async () => {
    const user = userEvent.setup();
    renderEditor({ article: article({ slug: 'delivery-times', title: 'Delivery times' }) });

    const title = screen.getByLabelText('Title');
    await user.type(title, ' (updated)');

    expect(screen.getByLabelText('Slug')).toHaveValue('delivery-times');
  });

  it('reads back and edits the SEO title/description fields', async () => {
    const user = userEvent.setup();
    const existing = article({
      seo_title: 'Old SEO title',
      seo_description: 'Old SEO description',
    });
    api.patch.mockResolvedValue({
      ...existing,
      seo_title: 'New SEO title',
      seo_description: 'New SEO description',
    });
    renderEditor({ article: existing });

    expect(screen.getByLabelText('SEO title')).toHaveValue('Old SEO title');
    expect(screen.getByLabelText('SEO description')).toHaveValue('Old SEO description');

    await user.clear(screen.getByLabelText('SEO title'));
    await user.type(screen.getByLabelText('SEO title'), 'New SEO title');
    await user.clear(screen.getByLabelText('SEO description'));
    await user.type(screen.getByLabelText('SEO description'), 'New SEO description');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(
        `/kb-articles/${existing.id}`,
        expect.objectContaining({
          seo_title: 'New SEO title',
          seo_description: 'New SEO description',
        }),
      ),
    );
  });

  it('publish shows the Published badge and the public link; unpublish reverses both', async () => {
    const user = userEvent.setup();
    const existing = article({ status: 'draft' });
    api.patch.mockImplementation((_path: string, body: Record<string, unknown>) =>
      Promise.resolve({ ...existing, ...body }),
    );
    renderEditor({ article: existing });

    expect(screen.getByText('Draft')).toBeInTheDocument();
    expect(screen.queryByText(/public\/kb\/acme\/delivery-times/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Publish' }));

    await screen.findByText('Published');
    expect(screen.getByText(/public\/kb\/acme\/delivery-times/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith(`/kb-articles/${existing.id}`, { status: 'published' });

    await user.click(screen.getByRole('button', { name: 'Unpublish' }));

    await screen.findByText('Draft');
    expect(screen.queryByText(/public\/kb\/acme\/delivery-times/)).not.toBeInTheDocument();
    expect(api.patch).toHaveBeenLastCalledWith(`/kb-articles/${existing.id}`, { status: 'draft' });
  });

  it('shows a warning banner when the KB is disabled', async () => {
    api.get.mockImplementation((path: string) => {
      if (path === '/kb-settings') {
        return Promise.resolve({
          enabled: false,
          public_slug: null,
          site_title: null,
          updated_at: null,
        });
      }
      return Promise.reject(new Error(`unexpected GET ${path}`));
    });
    renderEditor({ article: article({}) });

    expect(await screen.findByText(/KB is off/)).toBeInTheDocument();
  });

  it('shows a backend slug collision under the Slug field, not a generic toast', async () => {
    const user = userEvent.setup();
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'slug: an article with the slug "delivery-times" already exists.',
        requestId: 'req-1',
      }),
    );
    renderEditor({ article: null });

    await user.type(screen.getByLabelText('Title'), 'Delivery times');
    await user.type(screen.getByLabelText('Body'), 'Body text');
    await user.click(screen.getByRole('button', { name: 'Create article' }));

    const error = await screen.findByText(/an article with the slug/);
    expect(error).toHaveAttribute('id', 'kb-slug-error');
    expect(screen.getByLabelText('Slug')).toHaveAttribute('aria-describedby', 'kb-slug-error');
  });

  it('confirms before discarding a dirty form on close', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClose = vi.fn();
    renderEditor({ article: null, onClose });

    await user.type(screen.getByLabelText('Title'), 'Draft title');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);

    confirmSpy.mockRestore();
  });

  it('closes without asking when nothing changed', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm');
    const onClose = vi.fn();
    renderEditor({ article: null, onClose });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('is read-only without edit permission: fields disabled, no Save/Publish controls', () => {
    renderEditor({ article: article({}), canEdit: false });

    expect(screen.getByLabelText('Title')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('links every field to its label', () => {
    renderEditor({ article: null });

    for (const label of [
      'Title',
      'Slug',
      'Category',
      'Body',
      'Excerpt',
      'SEO title',
      'SEO description',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});

describe('KbArticleEditor localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the editor in Turkish when that is the active locale', () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <KbArticleEditor
          article={null}
          categories={CATEGORIES}
          canEdit
          onClose={() => {}}
          onSaved={() => {}}
        />
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByRole('button', { name: 'Makale oluştur' })).toBeInTheDocument();
  });
});
