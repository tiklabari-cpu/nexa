/**
 * The Inbox Views group in the public pilot (tm 257.3 · ADR
 * docs/adr/pilot-public-readiness.md K-d): no channel to filter by and nothing
 * to promote, so `GET /channels` is never asked and the whole channel block —
 * promo and rows alike — is absent, for an owner who holds `channels--all`.
 * The promo is the part that needs an explicit condition: a failed query is not
 * "pending", so on an error it would show. Paired with the same owner on an
 * ordinary deployment; `InboxPage.channels.test.tsx` pins that side unchanged.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentConfig } from '@siyahtus/types';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() },
}));
const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: Record<string, unknown>) => unknown) =>
      selector({
        agent: {
          scopes: ['chats--all:rw', 'channels--all:ro'],
          account_id: 'me',
          routing_status: 'offline',
        },
        setRoutingStatus: vi.fn(),
      }),
  };
});

const { InboxPage } = await import('./InboxPage.js');

const PILOT: DeploymentConfig = { pilot_mode: true, contact_email: null, signup_enabled: true };
const ORDINARY: DeploymentConfig = { pilot_mode: false, contact_email: null, signup_enabled: true };

/** `GET /channels` as the API answers it. */
let channels: Array<{ type: string; connected: boolean }> = [];

function serve(): void {
  api.get.mockImplementation((url: string) => {
    if (url === '/channels') return Promise.resolve({ items: channels });
    return Promise.resolve({ items: [], total: 0 });
  });
}

function renderInbox(config: DeploymentConfig): void {
  deployment.current = config;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <MemoryRouter initialEntries={['/app/inbox']}>
      <QueryClientProvider client={queryClient}>
        <InboxPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const rail = (): HTMLElement => screen.getByRole('navigation', { name: 'Inbox views' });
const channelCalls = (): unknown[] => api.get.mock.calls.filter(([url]) => url === '/channels');

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  localStorage.clear();
  channels = [];
  serve();
});

describe('Inbox channel views in the public pilot (tm 257.3)', () => {
  it('shows no channel promo and never asks for the channel list', async () => {
    renderInbox(PILOT);

    await within(rail()).findByRole('heading', { name: 'Views' });
    await waitFor(() => expect(api.get.mock.calls.length).toBeGreaterThan(0));
    expect(channelCalls()).toHaveLength(0);
    expect(screen.queryByTestId('channel-promo')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Connect a channel →' })).not.toBeInTheDocument();
  });

  it('shows no channel rows even for a channel that was connected before the flag', async () => {
    channels = [{ type: 'whatsapp', connected: true }];
    renderInbox(PILOT);

    await within(rail()).findByRole('heading', { name: 'Views' });
    expect(within(rail()).queryByRole('button', { name: /WhatsApp/ })).not.toBeInTheDocument();
    expect(channelCalls()).toHaveLength(0);
  });

  it('still offers the promo on an ordinary deployment with nothing connected', async () => {
    renderInbox(ORDINARY);

    expect(await screen.findByTestId('channel-promo')).toBeInTheDocument();
    expect(channelCalls()).toHaveLength(1);
  });
});
