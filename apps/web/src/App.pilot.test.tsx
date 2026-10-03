/**
 * `/app/billing` in the public pilot (tm 257.2 · ADR docs/adr/pilot-public-readiness.md
 * K-d): the address of a module the pilot does not offer lands in the inbox,
 * through `App.tsx`'s own route table — so a route added without its
 * `PilotHidden` wrapper, or the wrapper dropped from this one, fails here.
 *
 * The shell and both pages are stand-ins: what is under test is which page
 * the router picks, not what either page does.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { DeploymentConfig } from '@siyahtus/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { App } from './App.js';
import { useAuth } from './lib/auth-store.js';

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('./lib/deployment.js', () => ({ useDeployment: () => deployment.current }));
vi.mock('./components/AppShell.js', () => ({ AppShell: () => <Outlet /> }));
vi.mock('./features/inbox/InboxPage.js', () => ({ InboxPage: () => <p>Inbox module</p> }));
vi.mock('./features/billing/BillingPage.js', () => ({
  BillingPage: () => <p>Billing module</p>,
}));
vi.mock('./features/apps/AppsMarketplace.js', () => ({
  AppsMarketplacePage: () => <p>Apps module</p>,
}));

function LocationProbe(): React.ReactElement {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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

describe('/app/apps (tm 257.18)', () => {
  const config = (pilotMode: boolean): DeploymentConfig => ({
    pilot_mode: pilotMode,
    contact_email: null,
    signup_enabled: true,
    email_verification_required: false,
    privacy_policy_url: null,
    terms_url: null,
    terms_version: null,
  });

  it('lands in the inbox in the public pilot', async () => {
    deployment.current = config(true);
    renderAt('/app/apps');
    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
    expect(screen.queryByText('Apps module')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox');
  });

  it('opens the marketplace on an ordinary deployment', async () => {
    deployment.current = config(false);
    renderAt('/app/apps');
    expect(await screen.findByText('Apps module')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/apps');
  });
});

describe('/app/billing (tm 257.2)', () => {
  it('lands in the inbox in the public pilot', async () => {
    deployment.current = {
      pilot_mode: true,
      contact_email: null,
      signup_enabled: true,
      email_verification_required: false,
      privacy_policy_url: null,
      terms_url: null,
      terms_version: null,
    };
    renderAt('/app/billing');
    expect(await screen.findByText('Inbox module')).toBeInTheDocument();
    expect(screen.queryByText('Billing module')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox');
  });

  it('opens the Billing page on an ordinary deployment', async () => {
    deployment.current = {
      pilot_mode: false,
      contact_email: null,
      signup_enabled: true,
      email_verification_required: false,
      privacy_policy_url: null,
      terms_url: null,
      terms_version: null,
    };
    renderAt('/app/billing');
    expect(await screen.findByText('Billing module')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/billing');
  });
});
