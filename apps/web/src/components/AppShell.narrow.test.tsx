/**
 * The shell on a narrow window (tm 259.25 · O6).
 *
 * Below 1024 px the console stands a "designed for desktop" notice in front of
 * itself; "Continue anyway" opens it for the tab's session. jsdom has no layout,
 * so what is pinned here is the decision and its memory — which width asks,
 * what a click stores, what a resize decides, and that a console hidden by a
 * turned tablet is the same mounted tree when it comes back. Whether the body
 * then scrolls sideways is a layout fact and lives in `narrow-screen.spec.ts`.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { defaultScopesForRole } from '@siyahtus/types';
import { AppShell } from './AppShell.js';
import { NARROW_SCREEN_KEY } from './NarrowScreenNotice.js';
import { useAuth } from '../lib/auth-store.js';
import { installFakeWebSocket } from '../test/fake-socket.js';
import { resetLocale, setLocale } from '../test/i18n.js';

const NOTICE = 'The console is designed for desktop';
/** jsdom's own window width — the desktop every other shell test renders at. */
const JSDOM_WIDTH = window.innerWidth;

function setWidth(width: number): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
}

function renderShell() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={['/app/inbox']}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="inbox" element={<p>Inbox module</p>} />
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
  setWidth(JSDOM_WIDTH);
  window.sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetLocale();
});

describe('narrow screen notice', () => {
  it('is not shown at a desktop width (1024 px and up)', () => {
    setWidth(1024);
    renderShell();
    expect(screen.getByText('Inbox module')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: NOTICE })).not.toBeInTheDocument();
  });

  it('stands in for the console below 1024 px, focused, with the mobile app and a way on', () => {
    setWidth(1023);
    renderShell();
    const heading = screen.getByRole('heading', { name: NOTICE, level: 1 });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/mobile app/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue anyway' })).toBeInTheDocument();
    // The console is not even mounted: no module, no rail, one <main>.
    expect(screen.queryByText('Inbox module')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Inbox' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('Continue anyway opens the console, focuses its <main> and remembers the choice', async () => {
    setWidth(390);
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));

    expect(screen.getByText('Inbox module')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: NOTICE })).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveFocus();
    expect(window.sessionStorage.getItem(NARROW_SCREEN_KEY)).toBe('1');
  });

  it('does not ask again in a tab that already continued', () => {
    setWidth(390);
    window.sessionStorage.setItem(NARROW_SCREEN_KEY, '1');
    renderShell();
    expect(screen.getByText('Inbox module')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: NOTICE })).not.toBeInTheDocument();
  });

  it('still lets the agent through when storage is unavailable', async () => {
    setWidth(390);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError');
    });
    const user = userEvent.setup();
    renderShell();
    await user.click(screen.getByRole('button', { name: 'Continue anyway' }));
    expect(screen.getByText('Inbox module')).toBeInTheDocument();
  });

  it('decides again on resize, hiding the same mounted console rather than unmounting it', () => {
    setWidth(1280);
    renderShell();
    const module = screen.getByText('Inbox module');

    act(() => {
      setWidth(800);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByRole('heading', { name: NOTICE })).toBeInTheDocument();
    // jsdom loads no stylesheet: the class is the mechanism the browser obeys.
    expect(module.closest('main')!.parentElement!.parentElement).toHaveClass('hidden');
    expect(module).toBeInTheDocument();

    act(() => {
      setWidth(1280);
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.queryByRole('heading', { name: NOTICE })).not.toBeInTheDocument();
    expect(screen.getByText('Inbox module')).toBe(module);
    expect(module.closest('main')!.parentElement!.parentElement).not.toHaveClass('hidden');
  });

  it('speaks Turkish in the Turkish console', () => {
    setLocale('tr');
    setWidth(390);
    renderShell();
    expect(
      screen.getByRole('heading', { name: 'Panel masaüstü için tasarlandı', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yine de devam et' })).toBeInTheDocument();
    expect(screen.getByText(/mobil uygulaması/)).toBeInTheDocument();
  });
});
