/**
 * Where a support session lands in the router (tm 389.15 · FR-ADMIN-21).
 *
 * An operator signed in as a member from the root panel sees the red band on
 * every page — the first-run wizard included, which sits outside the shell —
 * and a tab whose session is over says so instead of offering a sign-in form.
 * The `/auth/impersonate` address restores nothing first: the browser's own
 * session belongs to its other tabs.
 *
 * The shell's other parts and the pages are stand-ins: what is under test is
 * which page the router picks and that the band is there.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import type { DeploymentConfig } from '@siyahtus/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { App } from './App.js';
import { ImpersonationBanner } from './components/ImpersonationBanner.js';
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
// The real shell renders the band first; the stand-in keeps only that and the outlet.
vi.mock('./components/AppShell.js', () => ({
  AppShell: () => (
    <>
      <ImpersonationBanner />
      <Outlet />
    </>
  ),
}));
vi.mock('./features/inbox/InboxPage.js', () => ({ InboxPage: () => <p>Inbox module</p> }));
vi.mock('./features/auth/SignInPage.js', () => ({ SignInPage: () => <p>Sign-in form</p> }));
vi.mock('./features/onboarding/OnboardingWizard.js', () => ({
  OnboardingWizard: () => <p>Onboarding wizard</p>,
}));

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderWithLocale(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
    'en',
  );
}

const original = useAuth.getState();

const MEMBER = {
  account_id: 'a-1',
  email: 'dana@acme.localhost',
  name: 'Dana Okonkwo',
  role: 'agent' as const,
  organization_id: 'o-1',
  license_id: '1000003',
  scopes: [],
  routing_status: 'offline' as const,
  impersonation: {
    session_id: 's-1',
    mode: 'read_only' as const,
    ends_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  },
};

beforeEach(() => {
  resetLocale();
});

afterEach(() => {
  useAuth.setState({
    status: original.status,
    accessToken: original.accessToken,
    agent: original.agent,
    impersonationEnded: original.impersonationEnded,
    restore: original.restore,
  });
});

describe('a support session in the router (tm 389.15)', () => {
  it('lands from the handoff address in the inbox, under the red band', async () => {
    useAuth.setState({ status: 'signed-in', accessToken: 't', agent: MEMBER });
    renderAt('/auth/impersonate');

    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox');
    expect(screen.getByRole('region', { name: 'Support session' })).toHaveTextContent(
      'Signed in as dana@acme.localhost — read-only',
    );
  });

  it('keeps the band over the first-run wizard, which is outside the shell', async () => {
    useAuth.setState({
      status: 'signed-in',
      accessToken: 't',
      agent: { ...MEMBER, onboarding_completed: false },
    });
    renderAt('/app/inbox');

    expect(await screen.findByText('Onboarding wizard')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Support session' })).toBeInTheDocument();
  });

  it('shows no band over the wizard for the member’s own session', async () => {
    const { impersonation: _none, ...own } = MEMBER;
    useAuth.setState({
      status: 'signed-in',
      accessToken: 't',
      agent: { ...own, onboarding_completed: false },
    });
    renderAt('/app/onboarding');

    expect(await screen.findByText('Onboarding wizard')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Support session' })).toBeNull();
  });

  it('says a finished session is over rather than offering a sign-in form', async () => {
    useAuth.setState({
      status: 'signed-out',
      accessToken: null,
      agent: null,
      impersonationEnded: 'ended',
    });
    renderAt('/app/inbox');

    expect(await screen.findByTestId('impersonation-ended')).toHaveTextContent(
      'You ended the session.',
    );
    expect(screen.queryByText('Sign-in form')).toBeNull();
  });

  it('restores nothing on the handoff address — the browser’s session is its other tabs’', () => {
    const restore = vi.fn(async () => undefined);
    useAuth.setState({ status: 'unknown', accessToken: null, agent: null, restore });
    window.history.replaceState(null, '', '/auth/impersonate');
    renderAt('/auth/impersonate');

    expect(restore).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This link carries no session code.');
  });
});
