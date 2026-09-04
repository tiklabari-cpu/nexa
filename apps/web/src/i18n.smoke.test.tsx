/**
 * Locale-switch smoke test (I18N1).
 *
 * Renders the real shell and flips the locale through the store the language
 * switcher drives, then asserts the navigation chrome actually changes language.
 * This is the "locale değişince metin değişir" gate: the plumbing — catalogue,
 * `t()`, store subscription, re-render — is proven end to end without a browser.
 *
 * Both directions are covered on purpose. A live switch proves the subscription;
 * a first paint in Turkish proves the *initial* read, which is the case an agent
 * who set their language last week actually gets and which a switch-only test
 * would never exercise.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { ReactElement } from 'react';
import { AppShell } from './components/AppShell.js';
import { useAuth } from './lib/auth-store.js';
import type { Locale } from './lib/i18n.js';
import { installFakeWebSocket } from './test/fake-socket.js';
import { renderWithLocale, resetLocale, setLocale } from './test/i18n.js';

function shell(): ReactElement {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/inbox']}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="inbox" element={<p>Inbox module</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function renderShell(locale: Locale = 'en') {
  return renderWithLocale(shell(), locale);
}

beforeEach(() => {
  // The real shell opens the app's realtime connection; a stand-in keeps this
  // language test from dialling the gateway (`test/fake-socket.ts`).
  installFakeWebSocket();
  resetLocale();
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
  resetLocale();
});

it('renders the rail in English by default and switches it to Turkish live', () => {
  renderShell();

  expect(screen.getByRole('link', { name: 'Inbox' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Reports' })).toBeInTheDocument();

  setLocale('tr');

  // The same rail, now in Turkish — and the English names are gone, so this is a
  // real relabel rather than a duplicate.
  expect(screen.getByRole('link', { name: 'Gelen Kutusu' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Raporlar' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Inbox' })).toBeNull();
});

it('paints Turkish on the first render when that is the remembered language', () => {
  renderShell('tr');

  expect(screen.getByRole('link', { name: 'Gelen Kutusu' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Inbox' })).toBeNull();
  // `<html lang>` follows too, so assistive tech reads the page in the language
  // it is actually written in rather than announcing Turkish with English rules.
  expect(document.documentElement.lang).toBe('tr');
});
