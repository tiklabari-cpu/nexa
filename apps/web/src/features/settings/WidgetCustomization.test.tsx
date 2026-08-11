/**
 * Widget customization (FR-MOD-11.7): the live preview reflects the draft, the
 * hex field is validated before it can be saved, and a save only fires on a real
 * change. These pin the "tema uygular" behaviour on the panel side.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetCustomization } from './WidgetCustomization.js';
import { useAuth, useBrandStore } from '../../lib/auth-store.js';

const DEFAULTS = {
  primary_color: '#2d67fa',
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
  // Every test starts license-wide unless it opts into a brand — the
  // regression guard for "no behaviour change when no brand is selected".
  useBrandStore.setState({ brandId: null });
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

  it('titles the section plainly when no brand is selected', async () => {
    renderWidget();
    expect(await screen.findByRole('heading', { name: 'Widget appearance' })).toBeInTheDocument();
  });
});

/**
 * Brand scoping (MULTIBRAND-g, PRD §5.3-Marka): the cache key and the section
 * heading both follow the selected brand, so switching brands shows that
 * brand's appearance rather than the one left over from before.
 */
describe('WidgetCustomization brand scoping', () => {
  const BRAND_A = { id: 'brand-a', name: 'Acme Support', is_default: true };
  const BRAND_B = { id: 'brand-b', name: 'Beta Line', is_default: false };
  const WIDGET_BY_BRAND: Record<string, typeof DEFAULTS> = {
    [BRAND_A.id]: { ...DEFAULTS, primary_color: '#111111' },
    [BRAND_B.id]: { ...DEFAULTS, primary_color: '#222222' },
  };

  function stubBrandAwareFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const brand = new Headers(init?.headers).get('X-Nexa-Brand');
        if (String(url).endsWith('/brands')) return okJson({ items: [BRAND_A, BRAND_B] });
        if (String(url).endsWith('/settings/widget')) {
          const current = (brand && WIDGET_BY_BRAND[brand]) || DEFAULTS;
          if (method === 'PUT') {
            const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
            return okJson({ ...current, ...body, updated_at: new Date().toISOString() });
          }
          return okJson(current);
        }
        return okJson(DEFAULTS);
      }),
    );
  }

  beforeEach(() => {
    useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
    useBrandStore.setState({ brandId: BRAND_A.id });
    stubBrandAwareFetch();
  });

  it("renders the selected brand's appearance and names it in the heading", async () => {
    renderWidget();
    expect(await screen.findByLabelText('Brand colour hex')).toHaveValue('#111111');
    expect(screen.getByRole('heading', { name: /Widget appearance/ })).toHaveTextContent(
      'Acme Support',
    );
  });

  it("switching brands fetches the new brand's appearance and drops the previous one", async () => {
    renderWidget();
    await waitFor(() => expect(screen.getByLabelText('Brand colour hex')).toHaveValue('#111111'));

    act(() => useBrandStore.getState().setBrandId(BRAND_B.id));

    await waitFor(() => expect(screen.getByLabelText('Brand colour hex')).toHaveValue('#222222'));
    expect(screen.queryByDisplayValue('#111111')).toBeNull();
    expect(screen.getByRole('heading', { name: /Widget appearance/ })).toHaveTextContent(
      'Beta Line',
    );
  });
});
