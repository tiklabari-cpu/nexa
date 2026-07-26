/**
 * Copilot knowledge management (FR-MOD-04.2 · FR-MOD-12.2): the base is listed
 * from `/copilot/knowledge`, an admin with write scope may add and remove a
 * source, a read-only caller sees the list without controls, and a caller with
 * no bot scope is told plainly and nothing is fetched.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

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
  api.get.mockResolvedValue(SOURCES);
  api.post.mockResolvedValue(SOURCES.items[0]);
  api.delete.mockResolvedValue(undefined);
});

describe('CopilotKnowledge', () => {
  it('lists the sources and offers add + delete to a writer', async () => {
    auth.scopes = ['agents-bot--all:rw'];
    renderKnowledge(<CopilotKnowledge />);

    expect(await screen.findByText('Refund policy')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add a source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/copilot/knowledge/s1'));
  });

  it('shows the list without controls to a read-only caller', async () => {
    auth.scopes = ['agents-bot--all:ro'];
    renderKnowledge(<CopilotKnowledge />);

    expect(await screen.findByText('Refund policy')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add a source' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it('tells a caller with no bot scope, and fetches nothing', () => {
    auth.scopes = [];
    renderKnowledge(<CopilotKnowledge />);

    expect(screen.getByText('No access to Copilot knowledge')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});
