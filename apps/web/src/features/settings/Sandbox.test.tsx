/**
 * Sandbox settings screen (FR-MOD-11.5 · 11.5-g): hides entirely below `admin`
 * (mirroring `GET /settings/sandbox`'s `minimumRole: 'admin'`), shows the
 * Enterprise upsell when the plan lacks the entitlement, lets an owner create
 * one, shows an existing sandbox's summary without offering to reset it from
 * production, and — inside a sandbox — asks for confirmation before resetting
 * and signs the caller out once the server confirms it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api, signOut } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn() },
  signOut: vi.fn(async () => undefined),
}));

let currentRole = 'owner';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (
      selector: (state: { agent: { role: string }; signOut: () => Promise<void> }) => unknown,
    ) => selector({ agent: { role: currentRole }, signOut }),
  };
});

const { Sandbox } = await import('./Sandbox.js');

const NOT_ENTITLED = { is_sandbox: false, entitled: false, sandbox: null };
const ENTITLED_NO_SANDBOX = { is_sandbox: false, entitled: true, sandbox: null };
const ENTITLED_WITH_SANDBOX = {
  is_sandbox: false,
  entitled: true,
  sandbox: {
    license_id: '2000001',
    region: 'eu',
    created_at: '2026-08-10T09:00:00.000Z',
    reset_at: null,
  },
};
const INSIDE_SANDBOX = { is_sandbox: true, entitled: false, sandbox: null };

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function mockGet(view: unknown): (path: string) => Promise<unknown> {
  return (path: string) => {
    if (path === '/settings/sandbox') return Promise.resolve(view);
    throw new Error(`unexpected GET ${path}`);
  };
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
  api.post.mockReset();
  signOut.mockClear();
  api.get.mockImplementation(mockGet(NOT_ENTITLED));
});

describe('Sandbox', () => {
  it('renders nothing below admin, and never fetches', () => {
    currentRole = 'agent';
    renderComponent(<Sandbox canEdit={false} />);

    expect(screen.queryByText('Sandbox')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('shows the Enterprise upsell when the plan has no sandbox entitlement', async () => {
    renderComponent(<Sandbox canEdit />);

    expect(await screen.findByText('Not available')).toBeInTheDocument();
    expect(screen.getByText(/Enterprise feature/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Create sandbox/ })).not.toBeInTheDocument();
  });

  it('lets an owner create a sandbox', async () => {
    api.get.mockImplementation(mockGet(ENTITLED_NO_SANDBOX));
    api.post.mockResolvedValue(ENTITLED_WITH_SANDBOX);
    renderComponent(<Sandbox canEdit />);

    const create = await screen.findByRole('button', { name: 'Create sandbox' });
    await userEvent.click(create);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/settings/sandbox'));
  });

  it('explains the missing button to an admin who is not the owner', async () => {
    currentRole = 'admin';
    api.get.mockImplementation(mockGet(ENTITLED_NO_SANDBOX));
    renderComponent(<Sandbox canEdit />);

    await screen.findByText('This workspace has no sandbox yet.');
    expect(screen.queryByRole('button', { name: 'Create sandbox' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the workspace owner can create a sandbox/)).toBeInTheDocument();
  });

  it('shows the entitlement upsell if creating 403s on the sandbox entitlement', async () => {
    api.get.mockImplementation(mockGet(ENTITLED_NO_SANDBOX));
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'not_allowed',
        status: 403,
        message: 'Sandbox is not included in the growth plan.',
        requestId: '-',
        details: { entitlement: 'sandbox', plan: 'growth' },
      }),
    );
    renderComponent(<Sandbox canEdit />);

    await userEvent.click(await screen.findByRole('button', { name: 'Create sandbox' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/Enterprise feature/);
  });

  it("shows an existing sandbox's summary without offering to reset it", async () => {
    api.get.mockImplementation(mockGet(ENTITLED_WITH_SANDBOX));
    renderComponent(<Sandbox canEdit />);

    expect(await screen.findByText('Sandbox created')).toBeInTheDocument();
    expect(screen.getByText(/signing in to the sandbox itself/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reset sandbox/ })).not.toBeInTheDocument();
  });

  it('marks the shell state "This is a sandbox" and offers reset from inside one', async () => {
    api.get.mockImplementation(mockGet(INSIDE_SANDBOX));
    renderComponent(<Sandbox canEdit />);

    expect(await screen.findByText('This is a sandbox')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset sandbox' })).toBeInTheDocument();
  });

  it('asks for confirmation before resetting, and does not call the server on cancel', async () => {
    api.get.mockImplementation(mockGet(INSIDE_SANDBOX));
    renderComponent(<Sandbox canEdit />);

    await userEvent.click(await screen.findByRole('button', { name: 'Reset sandbox' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(/cannot be undone/);

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('resets on confirm and signs the caller out', async () => {
    api.get.mockImplementation(mockGet(INSIDE_SANDBOX));
    api.post.mockResolvedValue({ reset_at: '2026-08-15T10:00:00.000Z', signed_out: true });
    renderComponent(<Sandbox canEdit />);

    await userEvent.click(await screen.findByRole('button', { name: 'Reset sandbox' }));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset sandbox' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/settings/sandbox/reset'));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it('hides the reset button from an admin who is not the owner, inside a sandbox', async () => {
    currentRole = 'admin';
    api.get.mockImplementation(mockGet(INSIDE_SANDBOX));
    renderComponent(<Sandbox canEdit />);

    await screen.findByText('This is a sandbox');
    expect(screen.queryByRole('button', { name: 'Reset sandbox' })).not.toBeInTheDocument();
    expect(screen.getByText(/Only the workspace owner can reset this sandbox/)).toBeInTheDocument();
  });
});
