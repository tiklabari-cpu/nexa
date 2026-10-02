/**
 * The Settings navigation in the public pilot (tm 257.2 · ADR
 * docs/adr/pilot-public-readiness.md K-d): the Billing group's one entry is the
 * door to a module the pilot does not offer, so the entry, its group heading
 * and its search hits all go. Paired with the same owner on an ordinary
 * deployment; the flag-off behaviour `SettingsNav.test.tsx` pins is left to it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES, type DeploymentConfig } from '@siyahtus/types';
import type * as AuthStore from '../../lib/auth-store.js';
import { settings as EN_SETTINGS } from '../../locales/en/settings.js';
import {
  SETTINGS_SECTIONS,
  searchSections,
  visibleGroups,
  type SettingsSectionEntry,
} from './settings-sections.js';

const OWNER = [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES];

const englishLabel = (section: SettingsSectionEntry): string =>
  EN_SETTINGS[section.labelKey] ?? section.labelKey;

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => ({ get: vi.fn(async () => ({})), put: vi.fn() }),
    useAuth: (selector: (state: { agent: { scopes: string[] } }) => unknown) =>
      selector({ agent: { scopes: OWNER } }),
  };
});

const { SettingsNav } = await import('./SettingsNav.js');

function renderNav(config: DeploymentConfig): HTMLElement {
  deployment.current = config;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SettingsNav />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return screen.getByRole('navigation', { name: 'Settings navigation' });
}

describe('Settings navigation in the public pilot (tm 257.2)', () => {
  it('drops the Billing entry and its emptied group heading, and nothing else', () => {
    const nav = renderNav({
      pilot_mode: true,
      contact_email: null,
      signup_enabled: true,
      email_verification_required: false,
      privacy_policy_url: null,
      terms_url: null,
      terms_version: null,
    });
    expect(within(nav).queryByText('Billing')).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Subscription and invoices' })).toBeNull();
    expect(within(nav).getAllByRole('link')).toHaveLength(SETTINGS_SECTIONS.length - 1);
    expect(within(nav).getByText('Security')).toBeInTheDocument();
  });

  it('keeps it on an ordinary deployment', () => {
    const nav = renderNav({
      pilot_mode: false,
      contact_email: null,
      signup_enabled: true,
      email_verification_required: false,
      privacy_policy_url: null,
      terms_url: null,
      terms_version: null,
    });
    expect(within(nav).getByText('Billing')).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Subscription and invoices' })).toHaveAttribute(
      'href',
      '/app/billing',
    );
  });

  it('finds no Billing by search in the pilot, and finds it otherwise', () => {
    for (const query of ['invoice', 'subscription', 'payment']) {
      expect(searchSections(OWNER, query, englishLabel, true).map((s) => s.slug)).not.toContain(
        'billing',
      );
      expect(searchSections(OWNER, query, englishLabel).map((s) => s.slug)).toContain('billing');
    }
  });

  it('leaves the Billing group out of the grouped navigation in the pilot', () => {
    expect(visibleGroups(OWNER, true).map((g) => g.key)).not.toContain('billing');
    expect(visibleGroups(OWNER).map((g) => g.key)).toContain('billing');
  });
});
