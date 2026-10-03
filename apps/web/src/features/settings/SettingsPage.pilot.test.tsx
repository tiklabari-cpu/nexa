/**
 * `/app/settings/integrations` in the public pilot (tm 257.18 · ADR
 * docs/adr/pilot-public-readiness.md K-d): the section is one button to the
 * marketplace, which the pilot does not have — so the address, like the
 * navigation entry, leaves for the settings index. Paired with the same owner
 * on an ordinary deployment, where the page opens.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES, type DeploymentConfig } from '@siyahtus/types';
import { useAuth } from '../../lib/auth-store.js';

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

const { SettingsPage } = await import('./SettingsPage.js');

const config = (pilotMode: boolean): DeploymentConfig => ({
  pilot_mode: pilotMode,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
});

function LocationProbe(): React.ReactElement {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderAt(path: string): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/settings" element={<p>Settings index</p>} />
          <Route path="/app/settings/:section" element={<SettingsPage />} />
        </Routes>
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
      scopes: [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES],
      routing_status: 'accepting_chats',
    },
  });
});

describe('/app/settings/integrations (tm 257.18)', () => {
  it('leaves for the settings index in the public pilot', () => {
    deployment.current = config(true);
    renderAt('/app/settings/integrations');
    expect(screen.getByText('Settings index')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open marketplace' })).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/settings');
  });

  it('opens the section, with its door to the marketplace, on an ordinary deployment', () => {
    deployment.current = config(false);
    renderAt('/app/settings/integrations');
    expect(screen.getByRole('link', { name: 'Open marketplace' })).toHaveAttribute(
      'href',
      '/app/apps',
    );
    expect(screen.getByTestId('location')).toHaveTextContent('/app/settings/integrations');
  });

  it('keeps a real integrations section open in the pilot', () => {
    deployment.current = config(true);
    renderAt('/app/settings/mcp');
    expect(screen.queryByText('Settings index')).toBeNull();
    expect(screen.getByTestId('location')).toHaveTextContent('/app/settings/mcp');
  });
});
