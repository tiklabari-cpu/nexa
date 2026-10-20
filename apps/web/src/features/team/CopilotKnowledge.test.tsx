/**
 * Copilot knowledge management (FR-MOD-04.2 · FR-MOD-12.2 · AI-14): the page is
 * a filtered view of the single knowledge store — everything Copilot reads —
 * listed from `/knowledge-sources?audience=copilot`; an admin with write scope
 * may add and remove an agents-only source (the part curated here), a source the
 * AI agent also uses is managed in the Playbook, a read-only caller sees the
 * list without controls, and a caller with no bot scope is told plainly and
 * nothing is fetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api, auth } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
  auth: { scopes: [] as string[] },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: auth.scopes } }),
  };
});

const { CopilotKnowledge } = await import('./CopilotKnowledge.js');

const SOURCES = {
  items: [
    {
      id: 's1',
      name: 'Refund policy',
      type: 'article',
      status: 'ready',
      source_url: null,
      chunk_count: 4,
      updated_at: '2026-07-20T00:00:00.000Z',
      audiences: ['copilot'],
    },
  ],
};

function renderKnowledge(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  auth.scopes = [];
  // The page also reads brands and members for its row labels; they are empty here.
  api.get.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith('/knowledge-sources') ? SOURCES : { items: [] }),
  );
  api.post.mockResolvedValue(SOURCES.items[0]);
  api.delete.mockResolvedValue(undefined);
  resetLocale();
});

describe('CopilotKnowledge', () => {
  it('lists the sources and offers add + delete to a writer', async () => {
    auth.scopes = ['agents-bot--all:rw'];
    renderKnowledge(<CopilotKnowledge />);

    expect(await screen.findByText('Refund policy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add a source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete Refund policy' })).toBeInTheDocument();
  });

  it('keeps Add disabled until a name and content are given, then posts them', async () => {
    auth.scopes = ['agents-bot--all:rw'];
    renderKnowledge(<CopilotKnowledge />);
    await screen.findByText('Refund policy');

    const add = screen.getByRole('button', { name: 'Add source' });
    expect(add).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Shipping' } });
    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'Ships in 2 days.' } });
    expect(add).toBeEnabled();

    fireEvent.click(add);
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/copilot/knowledge', {
        name: 'Shipping',
        type: 'article',
        content: 'Ships in 2 days.',
      }),
    );
  });

  it('removes a source through the API', async () => {
    auth.scopes = ['agents-bot--all:rw'];
    renderKnowledge(<CopilotKnowledge />);
    await screen.findByText('Refund policy');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Refund policy' }));
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete “Refund policy”?' })).getByRole('button', {
        name: 'Delete',
      }),
    );
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/copilot/knowledge/s1'));
  });

  it('shows the list without controls to a read-only caller', async () => {
    auth.scopes = ['agents-bot--all:ro'];
    renderKnowledge(<CopilotKnowledge />);

    expect(await screen.findByText('Refund policy')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it('tells a caller with no bot scope, and fetches nothing', () => {
    auth.scopes = [];
    renderKnowledge(<CopilotKnowledge />);

    expect(screen.getByText('No access to Copilot knowledge')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('names a source’s type and status in words, not in the server’s codes (D14)', async () => {
    auth.scopes = ['agents-bot--all:ro'];
    api.get.mockResolvedValue({
      items: [
        { ...SOURCES.items[0], id: 's1', name: 'Refunds', type: 'article', status: 'ready' },
        { ...SOURCES.items[0], id: 's2', name: 'Site', type: 'website', status: 'indexing' },
        { ...SOURCES.items[0], id: 's3', name: 'Blank', type: 'faq', status: 'empty' },
        { ...SOURCES.items[0], id: 's4', name: 'Odd', type: 'file', status: 'archived' },
      ],
    });
    renderKnowledge(<CopilotKnowledge />);
    await screen.findByText('Refunds');

    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Indexing')).toBeInTheDocument();
    expect(screen.getByText('No content')).toBeInTheDocument();
    expect(screen.getByText('Article')).toBeInTheDocument();
    expect(screen.getByText('Website')).toBeInTheDocument();
    expect(screen.getByText('FAQ')).toBeInTheDocument();
    // A status this panel has no word for is shown as written, never blank.
    expect(screen.getByText('archived')).toBeInTheDocument();
    expect(screen.queryByText('ready')).not.toBeInTheDocument();
    expect(screen.queryByText('article')).not.toBeInTheDocument();
  });

  it('says the same in Turkish', async () => {
    auth.scopes = ['agents-bot--all:ro'];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <CopilotKnowledge />
      </QueryClientProvider>,
      'tr',
    );

    await screen.findByText('Refund policy');
    expect(screen.getByText('Hazır')).toBeInTheDocument();
    expect(screen.getByText('Makale')).toBeInTheDocument();
  });

  it('paints the section in Turkish when that is the active locale', async () => {
    auth.scopes = ['agents-bot--all:rw'];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <CopilotKnowledge />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByText('Refund policy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Copilot bilgisi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Kaynak ekle' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refund policy kaynağını sil' })).toBeInTheDocument();
    expect(screen.getByLabelText('İçerik')).toBeInTheDocument();
  });

  describe('as a filtered view of the single store (tm 309.3 · AI-14)', () => {
    const SHARED = {
      ...SOURCES.items[0],
      id: 's2',
      name: 'Shipping times',
      audiences: ['ai_agent', 'copilot'],
      brand_ids: ['b1'],
      owner_name: 'Dana Okonkwo',
      reviewed_at: '2026-01-01T00:00:00.000Z',
      review_interval_days: 30,
      review_due_at: '2026-01-31T00:00:00.000Z',
    };

    beforeEach(() => {
      api.get.mockImplementation((path: string) =>
        Promise.resolve(
          path.startsWith('/knowledge-sources')
            ? { items: [...SOURCES.items, SHARED] }
            : path === '/brands'
              ? { items: [{ id: 'b1', name: 'Acme Casino' }] }
              : { items: [] },
        ),
      );
    });

    it('lists everything Copilot reads, the AI agent’s sources included', async () => {
      auth.scopes = ['agents-bot--all:rw'];
      renderKnowledge(<CopilotKnowledge />);

      expect(await screen.findByText('Shipping times')).toBeInTheDocument();
      expect(screen.getByText('Refund policy')).toBeInTheDocument();
      expect(api.get).toHaveBeenCalledWith('/knowledge-sources?audience=copilot');
      // Who uses each, its brand, and that its review is late.
      const table = within(screen.getByRole('table'));
      expect(table.getByText('AI agent + Copilot')).toBeInTheDocument();
      expect(table.getByText('Agents only')).toBeInTheDocument();
      expect(await screen.findByText('Acme Casino')).toBeInTheDocument();
      expect(screen.getByText('Review needed')).toBeInTheDocument();
    });

    it('curates only the agents-only source here; the shared one is the Playbook’s', async () => {
      auth.scopes = ['agents-bot--all:rw'];
      renderKnowledge(<CopilotKnowledge />);
      await screen.findByText('Shipping times');

      expect(screen.getByRole('button', { name: 'Delete Refund policy' })).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Delete Shipping times' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('Managed in Scenarios › Knowledge')).toBeInTheDocument();
    });

    it('narrows to the agents-only sources on request', async () => {
      auth.scopes = ['agents-bot--all:ro'];
      renderKnowledge(<CopilotKnowledge />);
      await screen.findByText('Shipping times');

      fireEvent.change(screen.getByLabelText('Show'), { target: { value: 'agents_only' } });
      expect(screen.getByText('Refund policy')).toBeInTheDocument();
      expect(screen.queryByText('Shipping times')).not.toBeInTheDocument();
    });

    it('never offers to delete a Knowledge Base article’s source from here', async () => {
      auth.scopes = ['agents-bot--all:rw'];
      api.get.mockImplementation((path: string) =>
        Promise.resolve(
          path.startsWith('/knowledge-sources')
            ? {
                items: [
                  { ...SOURCES.items[0], id: 's3', name: 'Help article', kb_article_id: 'kb-1' },
                ],
              }
            : { items: [] },
        ),
      );
      renderKnowledge(<CopilotKnowledge />);

      expect(await screen.findByText('Help article')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Delete Help article' })).not.toBeInTheDocument();
    });
  });
});
