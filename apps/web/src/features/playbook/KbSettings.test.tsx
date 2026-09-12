/**
 * Public knowledge base settings (PUBKB-b · PRD §5.3, tm 246) — the console
 * surface for `PUT /kb-settings`, which existed and was tested for months
 * with nothing calling it. `KbArticleEditor` only ever *read* this setting,
 * to grey out authoring while it is off; these tests pin the other half, the
 * screen that can turn it back on.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn() } }));

let currentRole = 'owner';

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return {
    ...actual,
    useApiClient: () => api,
    useAuth: (selector: (state: { agent: { role: string } }) => unknown) =>
      selector({ agent: { role: currentRole } }),
  };
});

const { KbSettings } = await import('./KbSettings.js');

const DISABLED = { enabled: false, public_slug: null, site_title: null, updated_at: null };
const ENABLED = {
  enabled: true,
  public_slug: 'acme',
  site_title: 'Acme Help',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function renderSettings(canEdit: boolean): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <KbSettings canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  currentRole = 'owner';
  api.get.mockReset();
  api.put.mockReset();
  api.get.mockResolvedValue(DISABLED);
});

describe('KbSettings', () => {
  it('shows the off status with no editing controls for a viewer with no write scope', async () => {
    renderSettings(false);

    expect(await screen.findByText('Public KB is off')).toBeInTheDocument();
    expect(screen.queryByLabelText('Enabled')).not.toBeInTheDocument();
    expect(screen.queryByText(/Only an admin/)).not.toBeInTheDocument();
  });

  it('shows a restricted note for an editor below admin rank', async () => {
    currentRole = 'agent';
    renderSettings(true);

    expect(await screen.findByText('Public KB is off')).toBeInTheDocument();
    expect(screen.getByText(/Only an admin, vice owner or owner/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Enabled')).not.toBeInTheDocument();
  });

  it('blocks Save while turning the KB on with no public address', async () => {
    const user = userEvent.setup();
    renderSettings(true);

    await user.click(await screen.findByLabelText('Enabled'));

    expect(screen.getByText(/Give the KB a public address/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('turns the KB on with a public address and a site title', async () => {
    api.put.mockResolvedValue(ENABLED);
    const user = userEvent.setup();
    renderSettings(true);

    await user.click(await screen.findByLabelText('Enabled'));
    await user.type(screen.getByLabelText('Public address'), 'acme');
    await user.type(screen.getByLabelText('Site title'), 'Acme Help');

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    await user.click(save);

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/kb-settings', {
        enabled: true,
        public_slug: 'acme',
        site_title: 'Acme Help',
      }),
    );
    expect(await screen.findByText('Public KB is on')).toBeInTheDocument();
  });

  it('turns it back off without needing a public address', async () => {
    api.get.mockResolvedValue(ENABLED);
    api.put.mockResolvedValue(DISABLED);
    const user = userEvent.setup();
    renderSettings(true);

    const toggle = await screen.findByLabelText('Enabled');
    expect(toggle).toBeChecked();
    await user.click(toggle);
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/kb-settings', {
        enabled: false,
        public_slug: 'acme',
        site_title: 'Acme Help',
      }),
    );
  });

  it('reports a failed save without losing what was typed', async () => {
    api.put.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderSettings(true);

    await user.click(await screen.findByLabelText('Enabled'));
    await user.type(screen.getByLabelText('Public address'), 'acme');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Public address')).toHaveValue('acme');
  });
});
