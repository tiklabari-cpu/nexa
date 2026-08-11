/**
 * The Settings → Brands screen (Multibrand, PRD §5.3): the license's brands
 * render, a name is required to add one, adding POSTs and refreshes the
 * list, the default brand has no Remove button while others do, an empty
 * catalogue gets a meaningful empty state, a read-only viewer's controls are
 * all inactive, renaming PATCHes on blur, and a server rejection — of a
 * rename or a remove — surfaces as an ErrorNotice next to the row it is about.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { Brands } = await import('./Brands.js');

const DEFAULT_BRAND = {
  id: 'brand-default',
  name: 'Default',
  slug: 'default',
  logo_url: null,
  is_default: true,
  created_at: '2026-01-01T00:00:00.000Z',
};

const SECOND_BRAND = {
  id: 'brand-2',
  name: 'Acme EU',
  slug: 'acme-eu',
  logo_url: null,
  is_default: false,
  created_at: '2026-01-02T00:00:00.000Z',
};

const ONE_BRAND = { items: [DEFAULT_BRAND] };
const TWO_BRANDS = { items: [DEFAULT_BRAND, SECOND_BRAND] };

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  api.patch.mockReset();
  api.delete.mockReset();
  api.get.mockResolvedValue(TWO_BRANDS);
  api.post.mockResolvedValue(SECOND_BRAND);
  api.patch.mockResolvedValue(SECOND_BRAND);
  api.delete.mockResolvedValue(undefined);
});

describe('Brands', () => {
  it('lists the license’s brands', async () => {
    renderComponent(<Brands canEdit />);
    expect(await screen.findByDisplayValue('Default')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Acme EU')).toBeInTheDocument();
  });

  it('shows a field-under error for an empty name and keeps Submit disabled', async () => {
    renderComponent(<Brands canEdit />);
    await screen.findByDisplayValue('Default');

    const field = screen.getByLabelText('Brand name');
    expect(screen.getByRole('button', { name: 'Add brand' })).toBeDisabled();

    await userEvent.click(field);
    await userEvent.tab(); // blur an empty field reveals the message

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a brand name.');
    expect(screen.getByRole('button', { name: 'Add brand' })).toBeDisabled();
  });

  it('adds a brand by POSTing the trimmed name, then reflects it in the list', async () => {
    api.get.mockResolvedValueOnce(ONE_BRAND).mockResolvedValueOnce(TWO_BRANDS);
    renderComponent(<Brands canEdit />);
    await screen.findByDisplayValue('Default');

    await userEvent.type(screen.getByLabelText('Brand name'), '  Acme EU  ');
    await userEvent.click(screen.getByRole('button', { name: 'Add brand' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/brands', { name: 'Acme EU' }));
    expect(await screen.findByDisplayValue('Acme EU')).toBeInTheDocument();
  });

  it('has no Remove button on the default brand, but does on others', async () => {
    renderComponent(<Brands canEdit />);
    await screen.findByDisplayValue('Default');

    const defaultRow = screen.getByDisplayValue('Default').closest('li')!;
    expect(within(defaultRow).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();

    const otherRow = screen.getByDisplayValue('Acme EU').closest('li')!;
    expect(within(otherRow).getByRole('button', { name: 'Remove Acme EU' })).toBeInTheDocument();
  });

  it('shows a meaningful empty state when there are no brands', async () => {
    api.get.mockResolvedValue({ items: [] });
    renderComponent(<Brands canEdit />);
    expect(await screen.findByText('No brands yet')).toBeInTheDocument();
    expect(screen.getByText(/second storefront or support line/)).toBeInTheDocument();
  });

  it('makes every control inactive for a read-only viewer', async () => {
    renderComponent(<Brands canEdit={false} />);
    await screen.findByDisplayValue('Default');

    expect(screen.queryByRole('button', { name: 'Add brand' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Default')).toBeDisabled();
    expect(screen.getByDisplayValue('Acme EU')).toBeDisabled();
  });

  it('renames a brand by PATCHing on blur', async () => {
    renderComponent(<Brands canEdit />);
    const field = await screen.findByDisplayValue('Acme EU');

    await userEvent.clear(field);
    await userEvent.type(field, 'Acme Europe');
    await userEvent.tab();

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/brands/brand-2', { name: 'Acme Europe' }),
    );
  });

  it('does not PATCH when a rename is blurred back to the same name', async () => {
    renderComponent(<Brands canEdit />);
    const field = await screen.findByDisplayValue('Acme EU');

    await userEvent.click(field);
    await userEvent.tab();

    expect(api.patch).not.toHaveBeenCalled();
  });

  it('shows a rename conflict as an ErrorNotice, and reverts the draft', async () => {
    api.patch.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 409,
        message: 'Another brand already uses this slug.',
        requestId: '-',
      }),
    );
    renderComponent(<Brands canEdit />);
    const field = await screen.findByDisplayValue('Acme EU');

    await userEvent.clear(field);
    await userEvent.type(field, 'Default');
    await userEvent.tab();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Another brand already uses this slug.',
    );
    expect(await screen.findByDisplayValue('Acme EU')).toBeInTheDocument();
  });

  it('shows a delete rejection as an ErrorNotice on that row', async () => {
    api.delete.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 403,
        message: 'This brand still has websites or channels attached.',
        requestId: '-',
      }),
    );
    renderComponent(<Brands canEdit />);
    await screen.findByDisplayValue('Default');

    await userEvent.click(screen.getByRole('button', { name: 'Remove Acme EU' }));

    const otherRow = screen.getByDisplayValue('Acme EU').closest('li')!;
    expect(await within(otherRow).findByRole('alert')).toHaveTextContent(
      'This brand still has websites or channels attached.',
    );
  });
});
