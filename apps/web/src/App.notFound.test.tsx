/**
 * An address nobody built (tm 259.24 · UX audit D11).
 *
 * Signed in, `/app/anything` used to be redirected to the inbox in silence; it
 * now says "Page not found" inside the shell. Outside `/app` the redirect stays
 * (the OAuth callback path, the bare origin). Signed out, an `/app/…` address
 * shows the sign-in form without rewriting the URL, so signing in lands on the
 * page that was asked for — including the "not found" for one that is not.
 *
 * The shell and the inbox are stand-ins: what is under test is which page the
 * router picks.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, screen } from '@testing-library/react';
import type { DeploymentConfig } from '@siyahtus/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { App } from './App.js';
import { useAuth } from './lib/auth-store.js';
import { renderWithLocale, resetLocale } from './test/i18n.js';

const deployment = vi.hoisted(() => ({
  current: {
    pilot_mode: false,
    contact_email: null,
    signup_enabled: true,
    email_verification_required: false,
    privacy_policy_url: null,
    terms_url: null,
    terms_version: null,
  } as DeploymentConfig,
}));
vi.mock('./lib/deployment.js', () => ({ useDeployment: () => deployment.current }));
vi.mock('./components/AppShell.js', () => ({ AppShell: () => <Outlet /> }));
vi.mock('./features/inbox/InboxPage.js', () => ({ InboxPage: () => <p>Inbox module</p> }));
vi.mock('./features/auth/SignInPage.js', () => ({ SignInPage: () => <p>Sign-in form</p> }));
vi.mock('./features/onboarding/OnboardingWizard.js', () => ({
  OnboardingWizard: () => <p>Onboarding wizard</p>,
}));

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderAt(path: string, locale: 'en' | 'tr' = 'en') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithLocale(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
    locale,
  );
}

const SIGNED_IN = {
  status: 'signed-in' as const,
  accessToken: 'test-token',
  agent: {
    account_id: 'a-1',
    email: 'dana@acme.localhost',
    name: 'Dana Okonkwo',
    role: 'owner' as const,
    organization_id: 'o-1',
    license_id: '1000003',
    scopes: [],
    routing_status: 'accepting_chats' as const,
  },
};

beforeEach(() => {
  resetLocale();
  useAuth.setState(SIGNED_IN);
});

describe('an unknown address under /app', () => {
  it('says the page was not found instead of opening the inbox', async () => {
    renderAt('/app/no-such-page');

    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    expect(screen.queryByText('Inbox module')).toBeNull();
    // The address is left as typed, so a mistyped link can be read and fixed.
    expect(screen.getByTestId('location')).toHaveTextContent('/app/no-such-page');
    expect(screen.getByRole('link', { name: 'Go to the inbox' })).toHaveAttribute(
      'href',
      '/app/inbox',
    );
  });

  it('says it in Turkish', async () => {
    renderAt('/app/yok', 'tr');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sayfa bulunamadı' }),
    ).toBeVisible();
  });

  it('leaves the real pages and the index redirect alone', async () => {
    renderAt('/app');
    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox');
  });
});

describe('the wizard address once setup is done (tm 259.26)', () => {
  it('leads to the inbox, not to "Page not found"', async () => {
    renderAt('/app/onboarding');
    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox');
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });

  it('finishing the wizard swaps to the shell without a "Page not found" in between', async () => {
    useAuth.setState({ ...SIGNED_IN, agent: { ...SIGNED_IN.agent, onboarding_completed: false } });
    renderAt('/app/onboarding');
    expect(await screen.findByText('Onboarding wizard')).toBeInTheDocument();

    // What the wizard's `finish` does first: the local gate flips while the
    // address is still the wizard's.
    act(() =>
      useAuth.setState({ ...SIGNED_IN, agent: { ...SIGNED_IN.agent, onboarding_completed: true } }),
    );
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox');
  });
});

describe('an address outside /app', () => {
  it('still lands in the inbox', async () => {
    renderAt('/somewhere-else');
    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox');
  });
});

describe('signed out', () => {
  beforeEach(() => {
    useAuth.setState({ status: 'signed-out', accessToken: null, agent: null });
  });

  it('shows the sign-in form on an /app address and keeps the address for after sign-in', async () => {
    renderAt('/app/customers?segment=leads');
    expect(await screen.findByText('Sign-in form')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/customers?segment=leads');

    // Signing in swaps the tree in place: the requested page is where the
    // session ends up, not the inbox.
    act(() => useAuth.setState(SIGNED_IN));
    expect(await screen.findByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();
  });
});
