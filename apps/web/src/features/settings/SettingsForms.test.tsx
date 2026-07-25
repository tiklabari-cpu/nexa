/**
 * Saved replies and Tags under the shared primitive (FR-EK-A.1): Submit stays
 * disabled until the required fields are filled, and a touched empty field
 * shows its own error line. The list query is stubbed empty so the add form —
 * which lives inside the not-errored branch — renders in isolation.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

// Imported after the mock so the components pick up the stubbed client.
const { CannedResponses, Tags } = await import('./SettingsPage.js');

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ items: [] });
});

describe('CannedResponses validation', () => {
  it('keeps Save reply disabled until both fields are filled', async () => {
    renderComponent(<CannedResponses canEdit />);
    const submit = await screen.findByRole('button', { name: 'Save reply' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('shipping'), 'promo');
    expect(submit).toBeDisabled(); // the reply is still empty

    await userEvent.type(screen.getByPlaceholderText(/Standard delivery/), 'Free shipping this week.');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error when a required field is left empty', async () => {
    renderComponent(<CannedResponses canEdit />);
    const shortcut = await screen.findByPlaceholderText('shipping');
    await userEvent.click(shortcut);
    await userEvent.tab(); // blur the empty field
    expect(screen.getByText('Enter a shortcut.')).toBeInTheDocument();
  });
});

describe('Tags validation', () => {
  it('keeps Add tag disabled until a name is entered', async () => {
    renderComponent(<Tags canEdit />);
    const submit = await screen.findByRole('button', { name: 'Add tag' });
    expect(submit).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText('vip'), 'billing');
    expect(submit).toBeEnabled();
  });
});
