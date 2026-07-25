/**
 * Locale-switch smoke test (I18N1).
 *
 * Renders the real shell and flips the locale through the store the language
 * switcher drives, then asserts the navigation chrome actually changes language.
 * This is the "locale değişince metin değişir" gate: the plumbing — catalogue,
 * `t()`, store subscription, re-render — is proven end to end without a browser.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { useAuth } from './lib/auth-store.js';
import { useLocaleStore } from './lib/i18n.js';

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
  act(() => useLocaleStore.getState().setLocale('en'));
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
  act(() => useLocaleStore.getState().setLocale('en'));
});

it('renders the rail in English by default and switches it to Turkish live', () => {
  renderShell();

  expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();

  act(() => useLocaleStore.getState().setLocale('tr'));

  // The same rail, now in Turkish — and the English names are gone, so this is a
  // real relabel rather than a duplicate.
  expect(screen.getByRole('link', { name: 'Gelen Kutusu' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Raporlar' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Inbox' })).toBeNull();
});
