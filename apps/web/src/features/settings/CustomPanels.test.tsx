/**
 * Settings › Integrations › Custom panels (KN-05 · tm 379): the list, the add
 * form with the server's own address rule, the secret shown once, a row's
 * switch / re-key / remove, and a read-only viewer.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type * as AuthStore from '../../lib/auth-store.js';
import { ApiClientError } from '../../lib/api-client.js';

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { CustomPanels } = await import('./CustomPanels.js');

const PANEL = {
  id: 'panel-1',
  name: 'Player card',
  url: 'https://bo.example/card',
  origin: 'https://bo.example',
  visible_group_ids: [2],
  enabled: true,
  created_at: '2026-11-03T08:00:00.000Z',
  updated_at: '2026-11-03T08:00:00.000Z',
};
const TEAMS = {
  items: [
    { id: 1, name: 'Finance' },
    { id: 2, name: 'Support' },
  ],
};

function renderComponent(ui: ReactElement): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('Settings › Custom panels', () => {
  beforeEach(() => {
    api.get.mockImplementation((path: string) => {
      if (path === '/settings/custom-panels') return Promise.resolve({ items: [PANEL] });
      if (path === '/groups') return Promise.resolve(TEAMS);
      throw new Error(`unexpected GET ${path}`);
    });
  });

  afterEach(() => vi.clearAllMocks());

  it('lists a panel with its address, its teams and whether it is on', async () => {
    renderComponent(<CustomPanels canEdit />);
    const row = await screen.findByTestId('custom-panel-row-panel-1');
    expect(within(row).getByText('Player card')).toBeInTheDocument();
    expect(within(row).getByText('https://bo.example/card')).toBeInTheDocument();
    expect(within(row).getByText('On')).toBeInTheDocument();
    await waitFor(() => expect(within(row).getByText('Shown to: Support')).toBeInTheDocument());
  });

  it('adds a panel for the picked teams and shows its secret once', async () => {
    api.post.mockResolvedValue({ ...PANEL, id: 'panel-2', signing_secret: 'stp_secret-value' });
    renderComponent(<CustomPanels canEdit />);
    const form = await screen.findByRole('form', { name: 'Add a custom panel' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Bonus card');
    await userEvent.type(within(form).getByLabelText('Page address'), 'https://bo.example/bonus');
    await userEvent.click(await within(form).findByLabelText('Finance'));
    await userEvent.click(within(form).getByRole('button', { name: 'Add panel' }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/custom-panels', {
        name: 'Bonus card',
        url: 'https://bo.example/bonus',
        visible_group_ids: [1],
      }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByTestId('custom-panel-secret')).toHaveTextContent('stp_secret-value');
    expect(within(dialog).getByText(/only time the secret is shown/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('custom-panel-secret')).toBeNull();
  });

  it('refuses an http address before sending, with the server’s own rule', async () => {
    renderComponent(<CustomPanels canEdit />);
    const form = await screen.findByRole('form', { name: 'Add a custom panel' });
    await userEvent.type(within(form).getByLabelText('Name'), 'Card');
    const url = within(form).getByLabelText('Page address');
    await userEvent.type(url, 'http://bo.example/');
    await userEvent.tab();
    expect(
      await within(form).findByText('The page must be served over https://.'),
    ).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Add panel' })).toBeDisabled();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('names the server’s refusal: the twenty-first panel', async () => {
    api.post.mockRejectedValue(
      new ApiClientError({
        type: 'validation',
        status: 400,
        message: 'limit',
        requestId: 'r',
        details: { reason: 'limit_reached' },
      }),
    );
    renderComponent(<CustomPanels canEdit />);
    const form = await screen.findByRole('form', { name: 'Add a custom panel' });
    await userEvent.type(within(form).getByLabelText('Name'), 'One more');
    await userEvent.type(within(form).getByLabelText('Page address'), 'https://bo.example/x');
    await userEvent.click(within(form).getByRole('button', { name: 'Add panel' }));
    expect(
      await within(form).findByText('A workspace can have at most 20 custom panels.'),
    ).toBeInTheDocument();
  });

  it('turns a panel off, and replaces its secret only after asking', async () => {
    api.patch.mockResolvedValue({ ...PANEL, enabled: false });
    api.post.mockResolvedValue({ ...PANEL, signing_secret: 'stp_new' });
    renderComponent(<CustomPanels canEdit />);
    await screen.findByTestId('custom-panel-row-panel-1');

    await userEvent.click(screen.getByRole('button', { name: 'Turn off Player card' }));
    expect(api.patch).toHaveBeenCalledWith('/settings/custom-panels/panel-1', { enabled: false });

    await userEvent.click(screen.getByRole('button', { name: 'New secret for Player card' }));
    expect(api.post).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'New secret' }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/settings/custom-panels/panel-1/rotate-secret'),
    );
    expect(await screen.findByTestId('custom-panel-secret')).toHaveTextContent('stp_new');
  });

  it('edits a panel’s teams in place', async () => {
    api.patch.mockResolvedValue({ ...PANEL, visible_group_ids: [] });
    renderComponent(<CustomPanels canEdit />);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Player card' }));
    const editor = screen.getByRole('form', { name: 'Edit Player card' });
    await userEvent.click(within(editor).getByLabelText('Support'));
    await userEvent.click(within(editor).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/settings/custom-panels/panel-1', {
        name: 'Player card',
        url: 'https://bo.example/card',
        visible_group_ids: [],
      }),
    );
  });

  it('gives a read-only viewer the list and no controls', async () => {
    renderComponent(<CustomPanels canEdit={false} />);
    await screen.findByTestId('custom-panel-row-panel-1');
    expect(screen.queryByRole('form', { name: 'Add a custom panel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit Player card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove Player card' })).toBeNull();
  });
});
