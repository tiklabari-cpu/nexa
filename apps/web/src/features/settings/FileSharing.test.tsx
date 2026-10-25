/**
 * Settings › Security › File sharing — the switch tm 357 added (HD-02): treat
 * every file a player e-mails as sensitive.
 *
 * The rest of the form is covered by `settings.spec.ts`; this pins the new
 * switch: it reads the saved value, Save writes it only when it moved, and a
 * viewer who may not edit cannot flip it.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AuthStore from '../../lib/auth-store.js';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), patch: vi.fn() } }));

vi.mock('../../lib/auth-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof AuthStore>();
  return { ...actual, useApiClient: () => api };
});

const { FileSharing } = await import('./FileSharing.js');

const SECURITY = {
  banned_customer_ips: [],
  file_sharing_enabled: true,
  allowed_file_types: ['image/png', 'application/pdf'],
  max_file_size_bytes: 10_485_760,
  spam_filter_enabled: true,
  require_two_factor: false,
  ip_allowlist_enforced: false,
  session_idle_timeout_seconds: null,
  max_concurrent_sessions: null,
  inbound_attachments_sensitive: false,
  updated_at: null,
};

const LABEL = /Treat every file a player e-mails as sensitive/;

function renderForm(canEdit = true): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FileSharing canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.get.mockReset();
  api.patch.mockReset();
  api.get.mockResolvedValue(SECURITY);
  api.patch.mockImplementation((_path: string, body: Record<string, unknown>) =>
    Promise.resolve({ ...SECURITY, ...body }),
  );
});

describe('FileSharing — e-mailed files as sensitive (tm 357)', () => {
  it('reads the saved value and writes the switch only once it moved', async () => {
    renderForm();
    const box = await screen.findByRole('checkbox', { name: LABEL });
    expect((box as HTMLInputElement).checked).toBe(false);

    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0]![0]).toBe('/settings/security');
    expect(api.patch.mock.calls[0]![1]).toMatchObject({ inbound_attachments_sensitive: true });
  });

  it('leaves the switch out of a save that did not touch it', async () => {
    renderForm();
    await screen.findByRole('checkbox', { name: LABEL });
    const size = screen.getByLabelText(/Max size/);
    await userEvent.clear(size);
    await userEvent.type(size, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch.mock.calls[0]![1]).not.toHaveProperty('inbound_attachments_sensitive');
  });

  it('cannot be flipped by a viewer who may not edit', async () => {
    renderForm(false);
    const box = await screen.findByRole('checkbox', { name: LABEL });
    expect((box as HTMLInputElement).disabled).toBe(true);
  });
});
