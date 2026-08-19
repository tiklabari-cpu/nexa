/**
 * The Settings → Routing rules list's condition summary. Skill-based routing
 * (FR-MOD-08.6.3) adds `conditions.expertise_ids` to a rule; this resolves
 * those ids to skill names via the Skills catalogue rather than showing raw
 * numbers, while a rule's existing condition kinds (e.g. `url_contains`)
 * still read exactly as before it existed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), patch: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

// Imported after the mock so the component picks up the stubbed client.
const { RoutingRules } = await import('./SettingsPage.js');

const SKILLS = {
  items: [
    { id: 1, name: 'Billing', slug: 'billing' },
    { id: 2, name: 'Technical support', slug: 'technical-support' },
  ],
};

const RULES = {
  items: [
    {
      id: 'rule-1',
      name: 'Billing questions',
      kind: 'chat',
      conditions: { expertise_ids: [1, 2] },
      target_group_id: 10,
      target_group_name: 'Billing team',
      priority: 1,
      is_fallback: false,
      enabled: true,
    },
    {
      id: 'rule-2',
      name: 'Checkout page',
      kind: 'chat',
      conditions: { url_contains: '/checkout' },
      target_group_id: 11,
      target_group_name: 'Sales',
      priority: 2,
      is_fallback: false,
      enabled: true,
    },
    {
      id: 'rule-3',
      name: null,
      kind: 'chat',
      conditions: {},
      target_group_id: 12,
      target_group_name: 'General',
      priority: 3,
      is_fallback: true,
      enabled: true,
    },
  ],
};

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockImplementation((path: string) => {
    if (path === '/settings/routing-rules') return Promise.resolve(RULES);
    if (path === '/settings/expertise') return Promise.resolve(SKILLS);
    return Promise.reject(new Error(`unexpected ${path}`));
  });
});

describe('RoutingRules condition summary', () => {
  it("shows a rule's required skills by name rather than raw expertise ids", async () => {
    renderComponent(<RoutingRules canEdit={false} />);
    expect(
      await screen.findByText('skill Billing, Technical support → Billing team'),
    ).toBeInTheDocument();
  });

  it('still describes a non-skill condition as before (regression)', async () => {
    renderComponent(<RoutingRules canEdit={false} />);
    expect(await screen.findByText('url contains /checkout → Sales')).toBeInTheDocument();
  });

  it('describes the fallback rule with no conditions as "Anything"', async () => {
    renderComponent(<RoutingRules canEdit={false} />);
    expect(await screen.findByText('Anything → General')).toBeInTheDocument();
  });
});

/** One sentinel for this file's DoD claim of being translated (I18N-j, tm 133.10). */
describe('RoutingRules localisation (NFR-I18N2)', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints Routing in Turkish when that is the active locale', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <RoutingRules canEdit={false} />
      </QueryClientProvider>,
      'tr',
    );

    expect(await screen.findByRole('region', { name: 'Yönlendirme' })).toBeInTheDocument();
  });
});
