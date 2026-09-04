/**
 * Theme-switch smoke test (NFR-I18N2).
 *
 * The sibling of `i18n.smoke.test.tsx`, and for the same reason: `theme.test.ts`
 * proves the store and the attribute, but the requirement is that an *agent* can
 * reach them. This renders the real shell, opens the real account menu and
 * drives the real `<select>`, so a switcher that is never mounted — the state
 * this task found the product in — fails here rather than passing a store test
 * nobody's UI calls.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { useAuth } from './lib/auth-store.js';
import { useLocaleStore } from './lib/i18n.js';
import { DEFAULT_THEME, THEME_STORAGE_KEY, useThemeStore } from './lib/theme.js';
import { installFakeWebSocket } from './test/fake-socket.js';

function renderShell() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
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
  // The real shell opens the app's realtime connection; a stand-in keeps this
  // theme test from dialling the gateway (`test/fake-socket.ts`).
  installFakeWebSocket();
  act(() => useLocaleStore.getState().setLocale('en'));
  act(() => useThemeStore.getState().setTheme(DEFAULT_THEME));
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
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => useLocaleStore.getState().setLocale('en'));
  act(() => useThemeStore.getState().setTheme(DEFAULT_THEME));
  globalThis.localStorage.removeItem(THEME_STORAGE_KEY);
});

it('switches the panel to the light theme from the account menu, and remembers it', async () => {
  const user = userEvent.setup();
  renderShell();

  expect(document.documentElement.dataset.theme).toBe('dark');

  await user.click(screen.getByRole('button', { name: 'Account' }));
  const switcher = screen.getByLabelText('Theme');
  expect(switcher).toHaveValue('dark');

  await user.selectOptions(switcher, 'light');

  expect(document.documentElement.dataset.theme).toBe('light');
  expect(switcher).toHaveValue('light');
  // What survives the reload the E2E half of this task performs.
  expect(globalThis.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');

  await user.selectOptions(switcher, 'dark');
  expect(document.documentElement.dataset.theme).toBe('dark');
});

it('labels the switcher in the language the agent picked', async () => {
  const user = userEvent.setup();
  renderShell();

  await user.click(screen.getByRole('button', { name: 'Account' }));
  expect(screen.getByRole('option', { name: 'Dark' })).toBeInTheDocument();

  act(() => useLocaleStore.getState().setLocale('tr'));

  // "tema+i18n provider" is one requirement: the theme names are UI copy and
  // follow the locale, so an English "Dark" left inside a Turkish menu is a bug.
  expect(screen.getByLabelText('Tema')).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Koyu' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: 'Açık' })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: 'Dark' })).toBeNull();
});
