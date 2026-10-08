/**
 * The Settings page header names the section it is showing (tm 259.15 · UX
 * audit O9). It used to carry one sentence — "Widget installation, saved
 * replies and routing." — over all 31 sections, wrong over SSO or the IP
 * allowlist. Now the title is the section's own navigation label and the
 * subtitle says where it lives: "Settings · Security".
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES } from '@siyahtus/types';
import { useAuth } from '../../lib/auth-store.js';
import { settings as en } from '../../locales/en/settings.js';
import { settings as tr } from '../../locales/tr/settings.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { SettingsPage } from './SettingsPage.js';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS } from './settings-sections.js';

const SCOPES = [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES];
// The two entries with a page of their own (`to`) have no element here.
const RENDERED = SETTINGS_SECTIONS.filter((s) => !s.to);

function renderAt(slug: string, locale: 'en' | 'tr'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithLocale(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/app/settings/${slug}`]}>
        <Routes>
          <Route path="/app/settings/:section" element={<SettingsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
    locale,
  );
}

beforeEach(() => {
  // Section bodies fetch; the header does not wait for them.
  vi.stubGlobal('fetch', () => new Promise(() => undefined));
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: SCOPES,
      routing_status: 'accepting_chats',
    },
  });
});

afterEach(() => {
  cleanup();
  resetLocale();
  vi.unstubAllGlobals();
});

describe('Settings page header (tm 259.15)', () => {
  it('names the section and its group — SSO is not "saved replies and routing"', () => {
    renderAt('sso', 'en');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Single sign-on');
    expect(screen.getByText('Settings · Security')).toBeInTheDocument();
    expect(screen.queryByText(/saved replies and routing/)).toBeNull();
  });

  it('differs between two sections', () => {
    renderAt('tags', 'en');
    const tags = screen.getByRole('heading', { level: 1 }).textContent;
    cleanup();
    renderAt('ip-allowlist', 'en');
    expect(screen.getByRole('heading', { level: 1 }).textContent).not.toBe(tags);
  });

  it('reads in Turkish in tr', () => {
    renderAt('sso', 'tr');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tek oturum açma');
    expect(screen.getByText('Ayarlar · Güvenlik')).toBeInTheDocument();
  });

  it.each(RENDERED.map((s) => [s.slug, s] as const))(
    '%s: the title is the navigation label, the subtitle its group',
    (_slug, entry) => {
      renderAt(entry.slug, 'en');
      const group = SETTINGS_GROUPS.find((g) => g.key === entry.group);
      expect(group).toBeDefined();
      const title = en[entry.labelKey as keyof typeof en] ?? '';
      const groupName = en[group!.labelKey as keyof typeof en];
      expect(title).toBeTruthy();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
      expect(screen.getByText(`Settings · ${groupName}`)).toBeInTheDocument();
    },
  );

  it('has a Turkish title and group for every section', () => {
    for (const entry of RENDERED) {
      const group = SETTINGS_GROUPS.find((g) => g.key === entry.group)!;
      expect(tr[entry.labelKey as keyof typeof tr]).toBeTruthy();
      expect(tr[group.labelKey as keyof typeof tr]).toBeTruthy();
    }
  });
});
