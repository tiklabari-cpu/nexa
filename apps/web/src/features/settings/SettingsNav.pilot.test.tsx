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
  visibleSections,
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
    // Billing (257.2), Integrations (257.18) and the two certification-flavoured
    // screens, Compliance and SIEM export (466), are the pilot-hidden entries.
    expect(within(nav).getAllByRole('link')).toHaveLength(
      SETTINGS_SECTIONS.filter((s) => !s.pilotHidden).length,
    );
    expect(SETTINGS_SECTIONS.filter((s) => s.pilotHidden).map((s) => s.slug)).toStrictEqual([
      'integrations',
      'compliance',
      'siem',
      'billing',
    ]);
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

  it('drops the Integrations door to the marketplace, and the words that found it (tm 257.18)', () => {
    for (const query of ['marketplace', 'zapier']) {
      expect(searchSections(OWNER, query, englishLabel, true).map((s) => s.slug)).not.toContain(
        'integrations',
      );
      expect(searchSections(OWNER, query, englishLabel).map((s) => s.slug)).toContain(
        'integrations',
      );
    }
    // The group stays: MCP and personal access tokens are real.
    expect(visibleGroups(OWNER, true).map((g) => g.key)).toContain('integrations');
    expect(
      visibleGroups(OWNER, true)
        .find((g) => g.key === 'integrations')
        ?.sections.map((s) => s.slug),
    ).not.toContain('integrations');
  });

  it('leaves the Billing group out of the grouped navigation in the pilot', () => {
    expect(visibleGroups(OWNER, true).map((g) => g.key)).not.toContain('billing');
    expect(visibleGroups(OWNER).map((g) => g.key)).toContain('billing');
  });
});

describe('Compliance and SIEM export in the public pilot (tm 466)', () => {
  const PILOT: DeploymentConfig = {
    pilot_mode: true,
    contact_email: null,
    signup_enabled: true,
    email_verification_required: false,
    privacy_policy_url: null,
    terms_url: null,
    terms_version: null,
  };

  it('leaves both out of the navigation, but not the data-retention neighbour', () => {
    const nav = renderNav(PILOT);
    expect(within(nav).queryByRole('link', { name: /HIPAA/i })).toBeNull();
    expect(within(nav).queryByRole('link', { name: /SIEM/i })).toBeNull();
    expect(within(nav).getByRole('link', { name: /Data retention/i })).toBeInTheDocument();
  });

  it('finds neither by search, and finds both on an ordinary deployment', () => {
    for (const [query, slug] of [
      ['hipaa', 'compliance'],
      ['baa', 'compliance'],
      ['splunk', 'siem'],
      ['soc 2', 'siem'],
    ] as const) {
      expect(searchSections(OWNER, query, englishLabel, true).map((s) => s.slug)).not.toContain(
        slug,
      );
      expect(searchSections(OWNER, query, englishLabel).map((s) => s.slug)).toContain(slug);
    }
    // Live Apps cards bring back the Integrations door only.
    expect(visibleSections(OWNER, true, true).map((s) => s.slug)).not.toContain('compliance');
    expect(visibleSections(OWNER, true, true).map((s) => s.slug)).not.toContain('siem');
  });

  it('keeps the SIEM description free of a certification claim', () => {
    expect(EN_SETTINGS['settings.siemExport.description']).not.toMatch(/SOC ?2|ISO ?27001/);
  });
});

describe('the Integrations door with live Apps cards (tm 263)', () => {
  it('stays in the pilot when a card is live, and goes without one', () => {
    const slugs = (live: boolean): string[] =>
      visibleSections(OWNER, true, live).map((section) => section.slug);
    expect(slugs(false)).not.toContain('integrations');
    expect(slugs(true)).toContain('integrations');
    // Billing has no live exception: the pilot still sells nothing.
    expect(slugs(true)).not.toContain('billing');
    expect(
      searchSections(OWNER, 'marketplace', englishLabel, true, true).map((s) => s.slug),
    ).toContain('integrations');
  });
});
