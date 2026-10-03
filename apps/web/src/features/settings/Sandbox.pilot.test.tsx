/**
 * The Sandbox screen's Enterprise note, as the public pilot words it (tm 257.15
 * · ADR docs/adr/pilot-public-readiness.md K-d §3.1). Both places the screen
 * says "upgrade the plan" — the not-entitled card and a refused create — say
 * "not available in the pilot — contact {email}" there, and the ordinary
 * sentence on any other deployment, which `Sandbox.test.tsx` pins unchanged.
 *
 * The other five screens share the one hook; `entitlement-note.test.tsx`
 * covers all six keys at that seam.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { DeploymentConfig } from '@siyahtus/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn() } }));

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (
      selector: (state: { agent: { role: string }; signOut: () => Promise<void> }) => unknown,
    ) => selector({ agent: { role: 'owner' }, signOut: async () => undefined }),
  };
});

const { Sandbox } = await import('./Sandbox.js');

const BASE: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};
const PILOT: DeploymentConfig = {
  ...BASE,
  pilot_mode: true,
  contact_email: 'pilot-contact@example.test',
};
const PILOT_NOTE =
  'This feature is not available in the pilot — contact pilot-contact@example.test.';

function renderSandbox(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Sandbox canEdit />
    </QueryClientProvider>,
  );
}

function view(entitled: boolean): void {
  api.get.mockImplementation((path: string) => {
    if (path === '/settings/sandbox') {
      return Promise.resolve({ is_sandbox: false, entitled, sandbox: null });
    }
    throw new Error(`unexpected GET ${path}`);
  });
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  deployment.current = BASE;
});

describe('Sandbox in the public pilot (tm 257.15)', () => {
  it('words the not-entitled card as "not available in the pilot", with the address', async () => {
    deployment.current = PILOT;
    view(false);
    renderSandbox();

    expect(await screen.findByText('Not available')).toBeInTheDocument();
    expect(screen.getByText(PILOT_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/Upgrade the plan/)).not.toBeInTheDocument();
  });

  it('words a refused create the same way', async () => {
    deployment.current = PILOT;
    view(true);
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'not_allowed',
        status: 403,
        message: 'Sandbox is not included in the growth plan.',
        requestId: '-',
        details: { entitlement: 'sandbox', plan: 'growth' },
      }),
    );
    renderSandbox();

    await userEvent.click(await screen.findByRole('button', { name: 'Create sandbox' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(PILOT_NOTE);
  });

  it('keeps the ordinary sentence on any other deployment', async () => {
    view(false);
    renderSandbox();

    expect(await screen.findByText(/Upgrade the plan to create one/)).toBeInTheDocument();
    expect(screen.queryByText(/not available in the pilot/)).not.toBeInTheDocument();
  });
});
