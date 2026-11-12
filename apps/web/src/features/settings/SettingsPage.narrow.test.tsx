/**
 * Settings below 1024 px (GV-04 · tm 472.1): the navigation is a list → detail
 * pair rather than a menu squeezed beside the section. `/app/settings` is the
 * list; a section fills the screen under a link back to it. At a desktop width
 * nothing changed: the index lands on the first section, the menu beside it.
 *
 * jsdom has no layout and no `matchMedia`, so the width is stubbed; whether a
 * section then fits 375 px without sideways scroll is a layout fact and lives
 * in `narrow-settings-customers.spec.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES } from '@siyahtus/types';
import { useAuth } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';
import { SettingsIndex, SettingsLayout, SettingsPage } from './SettingsPage.js';

const SCOPES = [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES];

/** A `matchMedia` that answers `(min-width: Npx)` from `width`, as a browser would. */
function stubWidth(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      matches: width >= min,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
  });
}

function Where(): JSX.Element {
  const { pathname } = useLocation();
  return <output data-testid="where">{pathname}</output>;
}

function renderAt(path: string, locale: 'en' | 'tr' = 'en'): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderWithLocale(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/app/settings"
            element={
              <SettingsLayout>
                <SettingsIndex />
              </SettingsLayout>
            }
          />
          <Route
            path="/app/settings/:section"
            element={
              <SettingsLayout>
                <SettingsPage />
              </SettingsLayout>
            }
          />
        </Routes>
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
    locale,
  );
}

beforeEach(() => {
  // Section bodies fetch; the layout does not wait for them.
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

describe('Settings on a phone (tm 472.1)', () => {
  it('/app/settings is the list itself, not a jump to the first section', () => {
    stubWidth(375);
    renderAt('/app/settings');
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/settings$/);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    const nav = screen.getByRole('navigation', { name: 'Settings navigation' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByTestId('settings-nav')).toHaveAttribute('data-variant', 'page');
    // No side to pin it to, and no way back from the list to itself.
    expect(screen.queryByRole('button', { name: /side navigation/ })).toBeNull();
    expect(screen.queryByRole('link', { name: 'All settings' })).toBeNull();
  });

  it('every section link is a finger-sized row (≥ 44 px) that wraps rather than clips', () => {
    stubWidth(375);
    renderAt('/app/settings');
    const tags = screen.getByRole('link', { name: 'Tags' });
    expect(tags).toHaveClass('min-h-11');
    expect(tags).not.toHaveClass('truncate');
    expect(screen.getByRole('combobox', { name: 'Search settings' })).toHaveClass('min-h-11');
  });

  it('a section opens in place of the list, with a way back to it', async () => {
    stubWidth(375);
    const user = userEvent.setup();
    renderAt('/app/settings');
    await user.click(screen.getByRole('link', { name: 'Tags' }));

    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/tags');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Tags');
    // The section has the screen: the menu is not beside it.
    expect(screen.queryByTestId('settings-nav')).toBeNull();
    const back = screen.getByRole('link', { name: 'All settings' });
    expect(back).toHaveClass('min-h-11');

    await user.click(back);
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/app\/settings$/);
    expect(screen.getByRole('link', { name: 'Tags' })).toBeInTheDocument();
  });

  it('a tablet held upright (768 px) gets the same list → detail pair', () => {
    stubWidth(768);
    renderAt('/app/settings/sso');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Single sign-on');
    expect(screen.queryByTestId('settings-nav')).toBeNull();
    expect(screen.getByRole('link', { name: 'All settings' })).toBeInTheDocument();
  });

  it('an old single-page anchor still lands on its section', () => {
    stubWidth(375);
    renderAt('/app/settings#section-channels');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/channels');
  });

  it('says the way back in Turkish in tr', () => {
    stubWidth(375);
    renderAt('/app/settings/tags', 'tr');
    expect(screen.getByRole('link', { name: 'Tüm ayarlar' })).toBeInTheDocument();
  });

  it('turning to a desktop width puts the menu back beside the section', () => {
    stubWidth(375);
    renderAt('/app/settings/tags');
    expect(screen.queryByTestId('settings-nav')).toBeNull();
    act(() => {
      stubWidth(1280);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('settings-nav')).not.toHaveAttribute('data-variant');
    expect(screen.queryByRole('link', { name: 'All settings' })).toBeNull();
  });
});

describe('Settings at a desktop width (unchanged)', () => {
  it('/app/settings lands on the first section, the menu beside it', () => {
    stubWidth(1280);
    renderAt('/app/settings');
    expect(screen.getByTestId('where')).toHaveTextContent('/app/settings/notifications');
    expect(screen.getByTestId('settings-nav')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tags' })).toHaveClass('truncate');
    expect(screen.queryByRole('link', { name: 'All settings' })).toBeNull();
  });
});
