/**
 * Pilot form under the shared primitive (FR-EK-A.1): an invalid domain shows a
 * field-under error and keeps "Add website" disabled; a valid one enables it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebsiteWidgets } from './WebsiteWidgets.js';
import { useAuth, useBrandStore } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

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
  // Every test starts license-wide unless it opts into a brand — the
  // regression guard for "no behaviour change when no brand is selected".
  useBrandStore.setState({ brandId: null });
  // The list polls /websites; an empty list is enough to render the add form.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => okJson({ items: [] })),
  );
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

  it('titles the section plainly when no brand is selected', async () => {
    renderWidgets();
    expect(await screen.findByRole('heading', { name: 'Website widgets' })).toBeInTheDocument();
  });
});

/**
 * The `nexa('trackSale', …)` tracking call (FR-MOD-13.5, 13.5-g) is
 * documentation only here — the panel just needs to show a developer the
 * exact line to paste into their own checkout confirmation script.
 */
describe('WebsiteWidgets trackSale documentation', () => {
  const site = {
    id: 'site-1',
    domain: 'shop.example',
    setup: 'manual' as const,
    status: 'connected' as const,
    connected_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    snippet: '<script>window.__nexa = { organizationId: "org-1" };</script>',
  };

  beforeEach(() => {
    useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
    useBrandStore.setState({ brandId: null });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => okJson({ items: [site] })),
    );
  });

  it('shows the trackSale example once the snippet panel is opened', async () => {
    renderWidgets();
    await userEvent.click(await screen.findByRole('button', { name: 'Get code' }));

    expect(screen.getByTestId('website-snippet-track-sale')).toHaveTextContent("nexa('trackSale',");
  });

  it('hides the example until the snippet panel is opened', async () => {
    renderWidgets();
    await screen.findByText('shop.example');
    expect(screen.queryByTestId('website-snippet-track-sale')).not.toBeInTheDocument();
  });
});

/**
 * Brand scoping (MULTIBRAND-g, PRD §5.3-Marka): the site list and the section
 * heading both follow the selected brand, so switching brands shows that
 * brand's sites rather than the ones left over from before.
 */
describe('WebsiteWidgets brand scoping', () => {
  const BRAND_A = { id: 'brand-a', name: 'Acme Support', is_default: true };
  const BRAND_B = { id: 'brand-b', name: 'Beta Line', is_default: false };
  const site = (domain: string) => ({
    id: `site-${domain}`,
    domain,
    setup: 'manual' as const,
    status: 'connected' as const,
    connected_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    snippet: '<script></script>',
  });
  const SITES_BY_BRAND: Record<string, Array<ReturnType<typeof site>>> = {
    [BRAND_A.id]: [site('a.example')],
    [BRAND_B.id]: [site('b.example')],
  };

  function stubBrandAwareFetch(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const brand = new Headers(init?.headers).get('X-Nexa-Brand');
        if (String(url).endsWith('/brands')) return okJson({ items: [BRAND_A, BRAND_B] });
        if (String(url).includes('/websites')) {
          return okJson({ items: (brand && SITES_BY_BRAND[brand]) || [] });
        }
        return okJson({ items: [] });
      }),
    );
  }

  beforeEach(() => {
    useAuth.setState({ status: 'signed-in', accessToken: 'test-token', agent: null });
    useBrandStore.setState({ brandId: BRAND_A.id });
    stubBrandAwareFetch();
  });

  it("lists the selected brand's sites and names it in the heading", async () => {
    renderWidgets();
    expect(await screen.findByText('a.example')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Website widgets/ })).toHaveTextContent(
      'Acme Support',
    );
  });

  it("switching brands refetches the list and drops the other brand's domain", async () => {
    renderWidgets();
    await screen.findByText('a.example');

    act(() => useBrandStore.getState().setBrandId(BRAND_B.id));

    expect(await screen.findByText('b.example')).toBeInTheDocument();
    expect(screen.queryByText('a.example')).toBeNull();
    expect(screen.getByRole('heading', { name: /Website widgets/ })).toHaveTextContent('Beta Line');
  });
});

describe('WebsiteWidgets localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints the section title and Add button in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <WebsiteWidgets canEdit />
      </QueryClientProvider>,
      'tr',
    );

    expect(
      await screen.findByRole('heading', { name: "Web sitesi widget'ları" }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Web sitesi ekle' })).toBeInTheDocument();
  });
});
