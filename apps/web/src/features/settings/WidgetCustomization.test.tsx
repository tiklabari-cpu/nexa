/**
 * Widget customization (FR-MOD-11.7): the live preview reflects the draft, the
 * hex field is validated before it can be saved, and a save only fires on a real
 * change. These pin the "tema uygular" behaviour on the panel side.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetCustomization } from './WidgetCustomization.js';
import { useAuth } from '../../lib/auth-store.js';

const DEFAULTS = {
  primary_color: '#2f6bff',
  position: 'bottom-right',
  theme: 'auto',
  mobile_fullscreen: true,
  powered_by: true,
  updated_at: null,
};

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

let putBodies: Array<Record<string, unknown>>;

function stubFetch(): void {
  putBodies = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (String(url).endsWith('/settings/widget') && method === 'PUT') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        putBodies.push(body);
        return okJson({ ...DEFAULTS, ...body, updated_at: new Date().toISOString() });
      }
      return okJson(DEFAULTS);
    }),
  );
}

function renderWidget() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WidgetCustomization canEdit />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('WidgetCustomization', () => {
  it('renders a live preview with the "Powered by" footer shown by default', async () => {
    renderWidget();
    const preview = await screen.findByTestId('widget-preview');
    expect(preview).toHaveTextContent('Powered by Nexa');
  });

  it('keeps Save disabled until something is changed', async () => {
    renderWidget();
    const save = await screen.findByRole('button', { name: 'Save appearance' });
    expect(save).toBeDisabled();
  });

  it('flags an invalid hex colour and blocks saving', async () => {
    renderWidget();
    const hex = await screen.findByLabelText('Brand colour hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, 'notacolour');

    expect(screen.getByRole('alert')).toHaveTextContent(/hex colour/);
    expect(screen.getByRole('button', { name: 'Save appearance' })).toBeDisabled();
  });

  it('saves a valid change through PUT /settings/widget', async () => {
    renderWidget();
    const hex = await screen.findByLabelText('Brand colour hex');
    await userEvent.clear(hex);
    await userEvent.type(hex, '#123456');

    const save = screen.getByRole('button', { name: 'Save appearance' });
    expect(save).toBeEnabled();
    await userEvent.click(save);

    await waitFor(() => expect(putBodies).toHaveLength(1));
    expect(putBodies[0]).toEqual({ primary_color: '#123456' });
  });

  it('reflects a toggled setting in the preview', async () => {
    renderWidget();
    const toggle = await screen.findByRole('checkbox', { name: /Powered by Nexa/ });
    await userEvent.click(toggle);

    const preview = within(screen.getByTestId('widget-preview'));
    // Turning the footer off removes it from the miniature.
    expect(preview.queryByText('Powered by Nexa')).toBeNull();
  });
});
