/**
 * WhatsApp's 24-hour window in the composer (tm 380 · KN-01): past it the band
 * says why a reply cannot go and Send stays off for a reply — an internal note
 * still goes, since it never leaves the workspace. Where WhatsApp does not run
 * live the window is never asked about at all.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeploymentConfig } from '@siyahtus/types';

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

const { Composer } = await import('./Composer.js');

const BASE: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
};

let window24: { live: boolean; open: boolean; closes_at: string | null };
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  window24 = { live: true, open: false, closes_at: '2026-10-30T10:00:00.000Z' };
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes('/reply-window')
      ? { chat_id: 'CHAT1', channel: 'whatsapp', ...window24 }
      : url.includes('/uploads-policy')
        ? { file_sharing_enabled: true }
        : { items: [] };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderComposer(config: DeploymentConfig): void {
  deployment.current = config;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Composer chatId="CHAT1" disabled={false} />
    </QueryClientProvider>,
  );
}

/** The composer's own textarea (the emoji search is a textbox too). */
const box = (): HTMLTextAreaElement =>
  document.getElementById('composer-input') as HTMLTextAreaElement;

const asked = () => fetchMock.mock.calls.some(([url]) => String(url).includes('/reply-window'));

describe('Composer — WhatsApp 24-hour window (tm 380 · FR-MOD-08.5.6)', () => {
  it('locks a reply past the window and says why, but lets an internal note through', async () => {
    renderComposer({ ...BASE, live_apps: ['whatsapp'] });
    const user = userEvent.setup();
    expect(await screen.findByText('24-hour window closed')).toBeInTheDocument();
    expect(
      screen.getByText(
        "WhatsApp only lets you reply within 24 hours of the customer's last message. You can write again when they do; internal notes still work.",
      ),
    ).toBeInTheDocument();

    await user.type(box(), 'Geç kalmış yanıt');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Internal note' }));
    expect(screen.queryByText('24-hour window closed')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('shows no band and keeps Send on while the window is open', async () => {
    window24 = { live: true, open: true, closes_at: '2099-01-01T00:00:00.000Z' };
    renderComposer({ ...BASE, live_apps: ['whatsapp'] });
    const user = userEvent.setup();
    await waitFor(() => expect(asked()).toBe(true));
    await user.type(box(), 'Kontrol ediyorum');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(screen.queryByTestId('reply-window-closed')).not.toBeInTheDocument();
  });

  it('never asks where WhatsApp does not run live', async () => {
    renderComposer(BASE);
    const user = userEvent.setup();
    await user.type(box(), 'merhaba');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    expect(asked()).toBe(false);
  });
});
