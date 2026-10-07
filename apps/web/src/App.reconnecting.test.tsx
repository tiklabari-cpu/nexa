/**
 * The screen a session shows while it cannot reach the server (tm 259.2).
 *
 * A page load whose refresh meets a 429, a 5xx or a dead network used to
 * forget the token and show the sign-in form. Now the token is kept and the
 * store says `reconnecting` — and `App` must neither treat that as signed out
 * nor leave a blank page: it says what is going on and offers the two ways
 * forward, "Try now" and "Sign out".
 *
 * Mid-session the shell stays mounted underneath (inert): a reply half typed in
 * the composer lives in component state, and unmounting the shell for a
 * two-minute outage would throw it away.
 *
 * The shell and the inbox are stand-ins — what is under test is what `App`
 * renders for each state, not what those pages do.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { App } from './App.js';
import { useAuth, type CurrentAgent } from './lib/auth-store.js';
import { resetLocale, setLocale } from './test/i18n.js';

vi.mock('./components/AppShell.js', () => ({ AppShell: () => <Outlet /> }));
vi.mock('./features/inbox/InboxPage.js', () => ({
  InboxPage: () => <textarea aria-label="Reply" defaultValue="Half a reply" />,
}));

const AGENT: CurrentAgent = {
  account_id: 'a-1',
  email: 'dana@acme.localhost',
  name: 'Dana Okonkwo',
  role: 'owner',
  organization_id: 'o-1',
  license_id: '1000003',
  scopes: [],
  routing_status: 'accepting_chats',
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const retryNow = vi.fn();
const signOut = vi.fn(() => Promise.resolve());
const original = useAuth.getState();

beforeEach(() => {
  retryNow.mockClear();
  signOut.mockClear();
  useAuth.setState({ retryNow, signOut });
});

afterEach(() => {
  // Unmounted first: the reset below must not re-render a screen mid-teardown.
  cleanup();
  useAuth.setState({
    status: original.status,
    reconnect: null,
    agent: null,
    accessToken: null,
    retryNow: original.retryNow,
    signOut: original.signOut,
  });
  resetLocale();
});

describe('App while a page load cannot reach the server (tm 259.2 · NFR-S2)', () => {
  it('says it is reconnecting, not signed out, and offers "Try now" and "Sign out"', async () => {
    useAuth.setState({ status: 'reconnecting', reconnect: 'waiting', agent: null });
    renderAt('/app/inbox');

    expect(screen.getByRole('heading', { name: 'Reconnecting…' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'The server cannot be reached right now. You are still signed in, and we keep trying.',
    );
    // Not the sign-in form, which is what a 429 used to lead to.
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Try now' }));
    expect(retryNow).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('says it has stopped trying once the attempts are used up', () => {
    useAuth.setState({ status: 'reconnecting', reconnect: 'paused', agent: null });
    renderAt('/app/inbox');

    expect(screen.getByRole('status')).toHaveTextContent(
      'The server still cannot be reached. You are still signed in — try again when your connection is back.',
    );
    expect(screen.getByRole('button', { name: 'Try now' })).toBeEnabled();
  });

  it('holds "Try now" while an attempt is under way', () => {
    useAuth.setState({ status: 'reconnecting', reconnect: 'trying', agent: null });
    renderAt('/app/inbox');

    expect(screen.getByRole('status')).toHaveTextContent('Trying to reconnect…');
    expect(screen.getByRole('button', { name: 'Try now' })).toBeDisabled();
  });

  it('says it in Turkish too', () => {
    setLocale('tr');
    useAuth.setState({ status: 'reconnecting', reconnect: 'waiting', agent: null });
    renderAt('/app/inbox');

    expect(
      screen.getByRole('heading', { name: 'Bağlantı yeniden kuruluyor…' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Sunucuya şu anda ulaşılamıyor. Oturumunuz açık; yeniden denemeye devam ediyoruz.',
    );
    expect(screen.getByRole('button', { name: 'Şimdi dene' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Çıkış yap' })).toBeInTheDocument();
  });
});

describe('App while a live session cannot reach the server (tm 259.2 · NFR-S2)', () => {
  it('covers the shell without unmounting it, so a half-typed reply survives', () => {
    useAuth.setState({ status: 'signed-in', reconnect: null, agent: AGENT, accessToken: 't' });
    renderAt('/app/inbox');
    const reply = screen.getByRole('textbox', { name: 'Reply' });
    expect(reply.closest('[inert]')).toBeNull();

    reply.focus();
    act(() => useAuth.setState({ status: 'reconnecting', reconnect: 'waiting' }));

    // Focus was in the shell, now inert: it starts again from the screen's heading.
    expect(screen.getByRole('heading', { name: 'Reconnecting…' })).toHaveFocus();
    // The same element, still in the document — and out of reach until the
    // session is back, so nothing can be typed into a panel that cannot send.
    expect(reply).toBeInTheDocument();
    expect(reply).toHaveValue('Half a reply');
    expect(reply.closest('[inert]')).not.toBeNull();

    act(() => useAuth.setState({ status: 'signed-in', reconnect: null }));

    expect(screen.queryByRole('heading', { name: 'Reconnecting…' })).toBeNull();
    expect(reply).toBeInTheDocument();
    expect(reply.closest('[inert]')).toBeNull();
  });
});
