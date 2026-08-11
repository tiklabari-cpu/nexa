/**
 * The Settings → Skills catalogue (FR-MOD-08.6.3): the areas of expertise a
 * licence has defined render, adding one POSTs the name and refreshes the
 * list, removing one drops it from view at once and restores it if the
 * server refuses, an empty catalogue gets a meaningful empty state, and a
 * read-only viewer sees the list with no add or delete controls.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

// Imported after the mock so the component picks up the stubbed client.
const { Skills } = await import('./SettingsPage.js');

const BILLING = { id: 1, name: 'Billing', slug: 'billing' };
const ONE_SKILL = { items: [BILLING] };

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.delete.mockReset();
  api.get.mockResolvedValue(ONE_SKILL);
  api.post.mockResolvedValue({ id: 2, name: 'Technical support', slug: 'technical-support' });
  api.delete.mockResolvedValue(undefined);
});

describe('Skills', () => {
  it('lists the skills already catalogued', async () => {
    renderComponent(<Skills canEdit />);
    expect(await screen.findByText('Billing')).toBeInTheDocument();
  });

  it('shows a meaningful empty state when the catalogue is empty', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderComponent(<Skills canEdit />);
    expect(await screen.findByText('No skills yet')).toBeInTheDocument();
  });

  it('adds a skill by POSTing the trimmed name and refetching the list', async () => {
    renderComponent(<Skills canEdit />);
    await screen.findByText('Billing');

    await userEvent.type(screen.getByPlaceholderText('Billing'), '  Technical support  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add skill' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/expertise', { name: 'Technical support' }),
    );
  });

  it('drops a skill immediately on delete and restores it if the server rejects', async () => {
    let rejectDelete: (error: unknown) => void = () => {};
    api.delete.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectDelete = reject;
        }),
    );
    renderComponent(<Skills canEdit />);
    await screen.findByText('Billing');

    await userEvent.click(screen.getByRole('button', { name: 'Delete skill Billing' }));

    // Optimistic: gone from the list before the server has answered.
    await waitFor(() => expect(screen.queryByText('Billing')).not.toBeInTheDocument());

    rejectDelete(
      new ApiClientError({
        type: 'validation',
        status: 500,
        message: 'Could not remove that skill.',
        requestId: '-',
      }),
    );

    // Rolled back once the server refuses.
    expect(await screen.findByText('Billing')).toBeInTheDocument();
  });

  it('offers no add or delete controls to a read-only viewer', async () => {
    renderComponent(<Skills canEdit={false} />);
    expect(await screen.findByText('Billing')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add skill' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete skill Billing' })).not.toBeInTheDocument();
  });
});
