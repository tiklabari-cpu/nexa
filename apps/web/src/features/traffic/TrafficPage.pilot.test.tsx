/**
 * The traffic board's empty state in the public pilot (tm 257.3 · ADR
 * docs/adr/pilot-public-readiness.md K-d): "Add more channels" leads to a grid
 * of Website and Chat page only, neither of which is *more*, so the call to
 * action is gone for an owner who would otherwise see it. The ordinary twin is
 * `TrafficPage.test.tsx`'s own CTA test, unchanged.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentConfig } from '@siyahtus/types';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { scopes: string[]; account_id: string } }) => unknown) =>
      selector({
        agent: { scopes: ['chats--all:rw', 'customers:rw', 'channels--all:rw'], account_id: 'me' },
      }),
  };
});

const { TrafficPage } = await import('./TrafficPage.js');

const PILOT: DeploymentConfig = {
  pilot_mode: true,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};
const ORDINARY: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};

function renderPage(config: DeploymentConfig): void {
  deployment.current = config;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/']}>
      <QueryClientProvider client={queryClient}>
        <TrafficPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ items: [], total: 0 });
  window.localStorage.clear();
});

describe('Traffic empty state in the public pilot (tm 257.3)', () => {
  it('has no "Add more channels" CTA for an owner who can manage channels', async () => {
    renderPage(PILOT);

    await screen.findByText('No live visitors right now');
    expect(screen.queryByRole('link', { name: 'Add more channels' })).not.toBeInTheDocument();
  });

  it('offers it on an ordinary deployment', async () => {
    renderPage(ORDINARY);

    expect(await screen.findByRole('link', { name: 'Add more channels' })).toHaveAttribute(
      'href',
      '/app/settings/channels',
    );
  });
});
