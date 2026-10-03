/**
 * The Details panel in the public pilot (tm 257.18 · ADR
 * docs/adr/pilot-public-readiness.md K-d): the Apps section shows data from
 * marketplace cards, and the pilot has none — an empty "No connected apps."
 * box would only point at a Settings door that is not there, so the section is
 * not drawn and the read is not made. Paired with the same panel on an
 * ordinary deployment; the flag-off panel `DetailsPanel.test.tsx` pins is left
 * to it, unchanged.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentConfig } from '@siyahtus/types';
import { DetailsPanel } from './DetailsPanel.js';
import type { ChatDetail } from './types.js';

const { api, authState } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
  authState: { agent: null as { role: string } | null },
}));
const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));

vi.mock('../../lib/auth-store.js', () => ({
  useApiClient: () => api,
  useAuth: (selector: (state: typeof authState) => unknown) => selector(authState),
}));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

const config = (pilotMode: boolean): DeploymentConfig => ({
  pilot_mode: pilotMode,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
});

const CHAT: ChatDetail = {
  id: 'TJ1H8CFKRV',
  license_id: '1000003',
  customer_id: 'cust-1',
  active: true,
  created_at: '2026-07-20T10:00:00.000Z',
  access: { group_ids: [] },
  users: [],
  thread: {
    id: 'TH1',
    chat_id: 'TJ1H8CFKRV',
    active: true,
    assignee_id: null,
    queue_position: null,
    summary: null,
    created_at: '2026-07-20T10:00:00.000Z',
    closed_at: null,
    tags: [],
  },
};

function renderPanel(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <DetailsPanel chat={CHAT} chatId={CHAT.id} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.get.mockResolvedValue({ items: [] });
  authState.agent = { role: 'owner' };
});

describe('DetailsPanel Apps section (tm 257.18)', () => {
  it('is not drawn in the public pilot, and /chats/:id/apps is not read', async () => {
    deployment.current = config(true);
    renderPanel();

    // The tag library read proves the panel finished mounting its queries.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/settings/tags'));
    expect(screen.queryByText('No connected apps.')).toBeNull();
    expect(screen.queryByText('Apps')).toBeNull();
    expect(api.get).not.toHaveBeenCalledWith(`/chats/${CHAT.id}/apps`);
    // The rest of the panel is there.
    expect(screen.getByText('Visited pages')).toBeInTheDocument();
  });

  it('is drawn on an ordinary deployment, with its empty state', async () => {
    deployment.current = config(false);
    renderPanel();

    expect(await screen.findByText('No connected apps.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(`/chats/${CHAT.id}/apps`);
  });
});
