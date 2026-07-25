/**
 * Pilot form under the shared primitive (FR-EK-A.1): an invalid domain shows a
 * field-under error and keeps "Add website" disabled; a valid one enables it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebsiteWidgets } from './WebsiteWidgets.js';
import { useAuth } from '../../lib/auth-store.js';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function renderWidgets() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WebsiteWidgets canEdit />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  // The list polls /websites; an empty list is enough to render the add form.
  vi.stubGlobal('fetch', vi.fn(async () => okJson({ items: [] })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WebsiteWidgets validation', () => {
  it('disables "Add website" until a domain is entered', () => {
    renderWidgets();
    expect(screen.getByRole('button', { name: 'Add website' })).toBeDisabled();
  });

  it('shows a field-under error for a bad domain and keeps Submit disabled', async () => {
    renderWidgets();
    const field = screen.getByLabelText('Website domain');
    await userEvent.type(field, 'nodots');
    expect(screen.getByRole('button', { name: 'Add website' })).toBeDisabled();

    await userEvent.tab(); // blur reveals the message
    expect(screen.getByRole('alert')).toHaveTextContent(/valid domain/);
  });

  it('enables "Add website" for a real domain', async () => {
    renderWidgets();
    await userEvent.type(screen.getByLabelText('Website domain'), 'shop.example');
    expect(screen.getByRole('button', { name: 'Add website' })).toBeEnabled();
    expect(screen.queryByText(/valid domain/)).not.toBeInTheDocument();
  });
});
