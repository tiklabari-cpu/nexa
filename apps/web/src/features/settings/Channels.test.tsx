/**
 * Instagram connect/disconnect render behaviour (FR-MOD-08.5.7-e). The status
 * derivation itself (not_connected/connected/address) is covered as a pure
 * function in channels.test.ts — this file covers what only a render can show:
 * the connect form's field-under validation and the connected card's actions.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelsGrid } from './Channels.js';
import { useAuth, useBrandStore } from '../../lib/auth-store.js';

function okJson(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

function renderChannels() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ChannelsGrid />
    </QueryClientProvider>,
  );
}

/** Routes each stub GET by path so /websites and /channels can differ per test. */
function stubFetch(byPath: { websites?: unknown; channels?: unknown }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/channels')) return okJson(byPath.channels ?? { items: [] });
      if (String(url).includes('/websites')) return okJson(byPath.websites ?? { items: [] });
      return okJson({ items: [] });
    }),
  );
}

beforeEach(() => {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'agent-1',
      email: 'owner@example.com',
      name: 'Owner',
      role: 'owner',
      organization_id: 'org-1',
      license_id: 'license-1',
      scopes: ['channels--all:rw'],
      routing_status: 'accepting_chats',
    },
  });
  useBrandStore.setState({ brandId: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Instagram card — not connected', () => {
  beforeEach(() => stubFetch({}));

  // The Website card also reads "Connect" when no site is installed yet, so
  // every lookup here is scoped to the Instagram card's own testid.
  async function openConnectForm() {
    const card = await screen.findByTestId('channel-instagram');
    await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
    return screen.getByRole('dialog', { name: 'Connect Instagram' });
  }

  it('opens a connect form that keeps Submit disabled until both fields are filled', async () => {
    renderChannels();

    const dialog = await openConnectForm();
    const submit = within(dialog).getByRole('button', { name: 'Connect' });
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Authorization code'), 'auth-code-1');
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Instagram user id'), 'ig_42');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error for a missing Instagram user id and keeps Submit disabled', async () => {
    renderChannels();

    const dialog = await openConnectForm();

    await userEvent.type(within(dialog).getByLabelText('Authorization code'), 'auth-code-1');
    await userEvent.click(within(dialog).getByLabelText('Instagram user id'));
    await userEvent.tab(); // blur without typing reveals the message

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the Instagram user id.');
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('Instagram card — connected', () => {
  beforeEach(() =>
    stubFetch({
      channels: {
        items: [
          {
            type: 'instagram',
            status: 'connected',
            address: 'ig_789',
            connected: true,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }),
  );

  it('shows the connected address and a Disconnect action', async () => {
    renderChannels();

    const card = await screen.findByTestId('channel-instagram');
    // The card renders Not-connected/Connect first, synchronously — the
    // switch to Connected only happens once /channels resolves.
    expect(await within(card).findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(within(card).getByText('ig_789')).toBeInTheDocument();
  });

  it('does not disconnect without confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderChannels();

    const card = await screen.findByTestId('channel-instagram');
    const disconnectButton = await within(card).findByRole('button', { name: 'Disconnect' });
    await userEvent.click(disconnectButton);

    expect(window.confirm).toHaveBeenCalled();
    // Still showing Disconnect (not "Disconnecting…") — nothing was sent.
    expect(within(card).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });
});
