/**
 * The shell on a narrow window (tm 259.25 · O6, per screen since GV-04 · tm 385).
 *
 * Below 1024 px a screen that is not laid out for a narrow window shows a
 * "designed for desktop" band above itself; a screen marked `responsive`
 * (the inbox, its timeline) shows none. "Continue anyway" dismisses the band
 * for the tab's session. jsdom has no layout and no `matchMedia`, so the width
 * is stubbed here; whether the page then scrolls sideways is a layout fact and
 * lives in `narrow-screen.spec.ts` / `narrow-inbox.spec.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { defaultScopesForRole } from '@siyahtus/types';
import { AppShell } from './AppShell.js';
import { NARROW_SCREEN_KEY } from './NarrowScreenNotice.js';
import { isResponsiveRoute } from './navigation.js';
import { useAuth } from '../lib/auth-store.js';
import { readViewportLayout } from '../lib/viewport.js';
import { installFakeWebSocket } from '../test/fake-socket.js';
import { resetLocale, setLocale } from '../test/i18n.js';

const BAND = 'The console is designed for desktop';

let width = 1280;

/** A `matchMedia` that answers `(min-width: Npx)` from {@link width}, as a browser would. */
function stubWidth(next: number): void {
  width = next;
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

function resize(next: number): void {
  act(() => {
    stubWidth(next);
    window.dispatchEvent(new Event('resize'));
  });
}

function renderShell(path = '/app/team') {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="inbox" element={<p>Inbox module</p>} />
            <Route path="inbox/timeline" element={<p>Timeline module</p>} />
            <Route path="customers" element={<p>Customers module</p>} />
            <Route path="team" element={<p>Team module</p>} />
            <Route path="settings/:section" element={<p>Settings section</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  installFakeWebSocket();
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
      scopes: defaultScopesForRole('owner'),
      routing_status: 'accepting_chats',
    },
  });
});

afterEach(() => {
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetLocale();
});

describe('width classes', () => {
  it('splits at 1280, 1024 and 768 px', () => {
    const at = (px: number) => {
      stubWidth(px);
      return readViewportLayout();
    };
    expect([at(1440), at(1280), at(1279), at(1024), at(1023), at(768), at(767), at(375)]).toEqual([
      'wide',
      'wide',
      'desktop',
      'desktop',
      'tablet',
      'tablet',
      'phone',
      'phone',
    ]);
  });

  it('is the desktop layout where nothing can be measured (no matchMedia)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(readViewportLayout()).toBe('wide');
  });

  it('knows which screens are laid out for a narrow window', () => {
    expect(isResponsiveRoute('/app/inbox')).toBe(true);
    expect(isResponsiveRoute('/app/inbox/')).toBe(true);
    expect(isResponsiveRoute('/app/inbox/timeline')).toBe(true);
    // Settings and Customers since tm 472.1: the menu, every section one level
    // under it, and the contacts list — but not Customers' other pages.
    expect(isResponsiveRoute('/app/settings')).toBe(true);
    expect(isResponsiveRoute('/app/settings/widget')).toBe(true);
    expect(isResponsiveRoute('/app/settings/audit-log/')).toBe(true);
    expect(isResponsiveRoute('/app/settings/widget/extra')).toBe(false);
    expect(isResponsiveRoute('/app/settingsx')).toBe(false);
    expect(isResponsiveRoute('/app/customers')).toBe(true);
    expect(isResponsiveRoute('/app/customers/goals')).toBe(false);
    expect(isResponsiveRoute('/app/archive')).toBe(true);
    expect(isResponsiveRoute('/app/reports')).toBe(true);
    expect(isResponsiveRoute('/app/reports/ai-quality')).toBe(false);
    expect(isResponsiveRoute('/app/team')).toBe(false);
  });
});

describe('narrow screen band', () => {
  it('is not shown at a desktop width (1024 px and up)', () => {
    stubWidth(1024);
    renderShell();
    expect(screen.getByText('Team module')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
  });

  it('sits above an unadapted screen below 1024 px, the console still there beside it', () => {
    stubWidth(1023);
    renderShell();
    const band = screen.getByRole('region', { name: BAND });
    expect(band).toHaveTextContent(/mobile app/);
    expect(screen.getByRole('button', { name: 'Continue anyway' })).toBeInTheDocument();
    // A band, not a stand-in: the module and the rail are on screen with it.
    expect(screen.getByText('Team module')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('is not shown over the inbox or its timeline at a phone width (GV-04)', () => {
    stubWidth(375);
    renderShell('/app/inbox');
    expect(screen.getByText('Inbox module')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
  });

  it('is not shown over Settings or Customers at a phone width (tm 472.1)', () => {
    stubWidth(375);
    renderShell('/app/settings/widget');
    expect(screen.getByText('Settings section')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
  });

  it('is not shown over the contacts list at a tablet width (tm 472.1)', () => {
    stubWidth(768);
    renderShell('/app/customers');
    expect(screen.getByText('Customers module')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
  });

  it('follows the route: leaving the inbox for an unadapted screen brings it', async () => {
    stubWidth(768);
    const user = userEvent.setup();
    renderShell('/app/inbox');
    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Team' }));
    expect(await screen.findByText('Team module')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: BAND })).toBeInTheDocument();
  });

  it('Continue anyway dismisses it and remembers the choice for the tab', async () => {
    stubWidth(390);
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));

    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
    expect(window.sessionStorage.getItem(NARROW_SCREEN_KEY)).toBe('1');
  });

  it('does not show again in a tab that already continued', () => {
    stubWidth(390);
    window.sessionStorage.setItem(NARROW_SCREEN_KEY, '1');
    renderShell();
    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
  });

  it('still dismisses when storage is unavailable', async () => {
    stubWidth(390);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
  });

  it('decides again on resize, the module staying the same mounted tree', () => {
    stubWidth(1280);
    renderShell();
    const module = screen.getByText('Team module');

    resize(800);
    expect(screen.getByRole('region', { name: BAND })).toBeInTheDocument();
    expect(screen.getByText('Team module')).toBe(module);

    resize(1280);
    expect(screen.queryByRole('region', { name: BAND })).not.toBeInTheDocument();
    expect(screen.getByText('Team module')).toBe(module);
  });

  it('keeps the rail to its icon column below 1024 px, whatever was pinned', () => {
    stubWidth(800);
    renderShell();
    expect(screen.getByRole('navigation', { name: 'Modules' })).toHaveClass('w-rail');
    expect(screen.queryByRole('button', { name: /pin|expand navigation/i })).toBeNull();
  });

  it('speaks Turkish in the Turkish console', () => {
    setLocale('tr');
    stubWidth(390);
    renderShell();
    expect(
      screen.getByRole('region', { name: 'Panel masaüstü için tasarlandı' }),
    ).toHaveTextContent(/mobil uygulaması/);
    expect(screen.getByRole('button', { name: 'Yine de devam et' })).toBeInTheDocument();
  });
});
