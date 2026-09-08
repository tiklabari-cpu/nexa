/**
 * Category rename/remove — the surface tm 215 built for the two operations
 * `routes/kb.ts` had shipped with no caller (FR-EK-B.1, NFR-A11Y1).
 *
 * The assertions worth having here are the two the audit could not make: that
 * the right VERB reaches the right path (a rename is a `PATCH`, a removal is a
 * `DELETE` — the whole finding was a path whose verbs were not distinguished),
 * and that a removal cannot happen on one click, because the thing being
 * removed is shared by every article filed under it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';
import type { KbCategory } from './types.js';

const { api } = vi.hoisted(() => ({ api: { patch: vi.fn(), delete: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { KbCategoryManager } = await import('./KbCategoryManager.js');

function category(over: Partial<KbCategory> & { id: string; name: string }): KbCategory {
  return {
    slug: over.name.toLowerCase(),
    position: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

const BILLING = category({ id: 'cat-a', name: 'Billling' });

function renderManager(categories: KbCategory[], onChanged = vi.fn()): { onChanged: () => void } {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <KbCategoryManager categories={categories} onChanged={onChanged} />
    </QueryClientProvider>,
  );
  return { onChanged };
}

async function open(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: 'Manage categories' }));
}

beforeEach(() => {
  api.patch.mockReset();
  api.delete.mockReset();
});

describe('KbCategoryManager — the KB taxonomy is editable (FR-EK-B.1)', () => {
  it('renders nothing at all when there is no category to manage', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <KbCategoryManager categories={[]} onChanged={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('is a disclosure: the list appears only once it is opened (NFR-A11Y1)', async () => {
    renderManager([BILLING]);

    const toggle = screen.getByRole('button', { name: 'Manage categories' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Billling name')).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Hide categories' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByLabelText('Billling name')).toHaveValue('Billling');
  });

  it('renames with PATCH /kb-categories/{id} on blur, and refreshes the caller', async () => {
    api.patch.mockResolvedValue({ ...BILLING, name: 'Billing' });
    const { onChanged } = renderManager([BILLING]);
    await open();

    const field = screen.getByLabelText('Billling name');
    await userEvent.clear(field);
    await userEvent.type(field, 'Billing');
    await userEvent.tab();

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/kb-categories/cat-a', { name: 'Billing' }),
    );
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('sends nothing when the name comes back unchanged, or empty', async () => {
    renderManager([BILLING]);
    await open();

    const field = screen.getByLabelText('Billling name');
    await userEvent.click(field);
    await userEvent.tab();
    await userEvent.clear(field);
    await userEvent.tab();

    expect(api.patch).not.toHaveBeenCalled();
    // The field snaps back to what the server still holds rather than sitting
    // empty next to a category that still has a name.
    expect(screen.getByLabelText('Billling name')).toHaveValue('Billling');
  });

  it('restores the old name when the server refuses the rename, and says why', async () => {
    api.patch.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'slug: a category with that slug already exists.',
        requestId: 'req-1',
      }),
    );
    renderManager([BILLING]);
    await open();

    const field = screen.getByLabelText('Billling name');
    await userEvent.clear(field);
    await userEvent.type(field, 'Payments');
    await userEvent.tab();

    await waitFor(() => expect(screen.getByLabelText('Billling name')).toHaveValue('Billling'));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('asks before removing, says the articles survive, and then sends DELETE', async () => {
    api.delete.mockResolvedValue(undefined);
    const { onChanged } = renderManager([BILLING]);
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Billling' }));
    // One click is not a removal: the category is shared by every article filed
    // under it, and what happens to those is the thing an admin has to be told.
    expect(api.delete).not.toHaveBeenCalled();
    expect(
      screen.getByText('The articles filed under it are kept — they become uncategorized.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove for good' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/kb-categories/cat-a'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('lets the confirmation be backed out of', async () => {
    renderManager([BILLING]);
    await open();

    await userEvent.click(screen.getByRole('button', { name: 'Remove Billling' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Remove Billling' })).toBeInTheDocument();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('gives every row its own controls', async () => {
    renderManager([BILLING, category({ id: 'cat-b', name: 'Onboarding' })]);
    await open();

    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getByLabelText('Onboarding name')).toHaveValue('Onboarding');
  });
});
