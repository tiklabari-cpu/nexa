/**
 * Render behaviour that a pure-function test cannot show. channels.test.ts
 * covers the status derivation (not_connected/connected/address) as data; this
 * file covers each live card's connect form and connected-card actions —
 * Messenger (FR-MOD-08.5.4), SMS (08.5.5), WhatsApp (08.5.6), Instagram
 * (08.5.7-e) and Telegram (08.5.8-d).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChannelsGrid } from './Channels.js';
import { useAuth, useBrandStore } from '../../lib/auth-store.js';
import { renderWithLocale, resetLocale } from '../../test/i18n.js';

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
  localStorage.clear();
});

describe('Messenger card — not connected', () => {
  beforeEach(() => stubFetch({}));

  // Scoped to the Messenger card's own testid, same reason as Instagram's.
  async function openConnectForm() {
    const card = await screen.findByTestId('channel-messenger');
    await userEvent.click(
      within(card).getByRole('button', { name: 'Connect with Facebook (mock)' }),
    );
    return screen.getByRole('dialog', { name: 'Connect Facebook Messenger' });
  }

  it('opens a connect form that enables Submit once the Page id is filled — the page name stays optional', async () => {
    renderChannels();

    const dialog = await openConnectForm();
    const submit = within(dialog).getByRole('button', { name: 'Connect' });
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Facebook Page id'), 'page_42');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error for a missing Page id and keeps Submit disabled', async () => {
    renderChannels();

    const dialog = await openConnectForm();

    await userEvent.click(within(dialog).getByLabelText('Facebook Page id'));
    await userEvent.tab(); // blur without typing reveals the message

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the Facebook Page id.');
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('Messenger card — connected', () => {
  beforeEach(() =>
    stubFetch({
      channels: {
        items: [
          {
            type: 'messenger',
            status: 'connected',
            address: 'page_789',
            connected: true,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }),
  );

  it('shows the connected page id and a Disconnect action', async () => {
    renderChannels();

    const card = await screen.findByTestId('channel-messenger');
    // The card renders Not-connected/mock-connect first, synchronously — the
    // switch to Connected only happens once /channels resolves.
    expect(await within(card).findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(within(card).getByText('page_789')).toBeInTheDocument();
  });
});

describe('WhatsApp card — not connected', () => {
  beforeEach(() => stubFetch({}));

  // Scoped to the WhatsApp card's own testid, same reason as Instagram's.
  async function openConnectForm() {
    const card = await screen.findByTestId('channel-whatsapp');
    await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
    return screen.getByRole('dialog', { name: 'Connect WhatsApp' });
  }

  it('opens a connect form that keeps Submit disabled until both fields are filled', async () => {
    renderChannels();

    const dialog = await openConnectForm();
    const submit = within(dialog).getByRole('button', { name: 'Connect' });
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('WhatsApp Business Account id'), 'waba_42');
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Phone number'), '+15551234567');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error for a missing WABA id and keeps Submit disabled', async () => {
    renderChannels();

    const dialog = await openConnectForm();

    await userEvent.click(within(dialog).getByLabelText('WhatsApp Business Account id'));
    await userEvent.tab(); // blur without typing reveals the message

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Enter the WhatsApp Business Account id.',
    );
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('rejects a malformed phone number and keeps Submit disabled', async () => {
    renderChannels();

    const dialog = await openConnectForm();

    await userEvent.type(within(dialog).getByLabelText('WhatsApp Business Account id'), 'waba_42');
    await userEvent.type(within(dialog).getByLabelText('Phone number'), 'not-a-number');
    await userEvent.tab();

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Enter a valid phone number, e.g. +15551234567.',
    );
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('WhatsApp card — connected', () => {
  beforeEach(() =>
    stubFetch({
      channels: {
        items: [
          {
            type: 'whatsapp',
            status: 'connected',
            address: '+15551234567',
            connected: true,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }),
  );

  it('shows the connected phone number and a Disconnect action', async () => {
    renderChannels();

    const card = await screen.findByTestId('channel-whatsapp');
    // The card renders Not-connected/Connect first, synchronously — the
    // switch to Connected only happens once /channels resolves.
    expect(await within(card).findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(within(card).getByText('+15551234567')).toBeInTheDocument();
  });

  it('does not disconnect without confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderChannels();

    const card = await screen.findByTestId('channel-whatsapp');
    const disconnectButton = await within(card).findByRole('button', { name: 'Disconnect' });
    await userEvent.click(disconnectButton);

    expect(window.confirm).toHaveBeenCalled();
    // Still showing Disconnect (not "Disconnecting…") — nothing was sent.
    expect(within(card).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });
});

describe('SMS card — not connected', () => {
  beforeEach(() => stubFetch({}));

  // Scoped to the SMS card's own testid, same reason as Instagram's.
  async function openConnectForm() {
    const card = await screen.findByTestId('channel-sms');
    await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
    return screen.getByRole('dialog', { name: 'Connect SMS (Twilio)' });
  }

  it('opens a connect form that keeps Submit disabled until all three fields are filled', async () => {
    renderChannels();

    const dialog = await openConnectForm();
    const submit = within(dialog).getByRole('button', { name: 'Connect' });
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Twilio Account SID'), 'AC123');
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Twilio Auth token'), 'secret-token');
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Phone number'), '+15551234567');
    expect(submit).toBeEnabled();
  });

  it('masks the auth token field as a password and never autocompletes it', async () => {
    renderChannels();

    const dialog = await openConnectForm();
    const tokenField = within(dialog).getByLabelText('Twilio Auth token');
    expect(tokenField).toHaveAttribute('type', 'password');
    expect(tokenField).toHaveAttribute('autocomplete', 'off');
  });

  it('shows a field-under error for a missing Account SID and keeps Submit disabled', async () => {
    renderChannels();

    const dialog = await openConnectForm();

    await userEvent.click(within(dialog).getByLabelText('Twilio Account SID'));
    await userEvent.tab(); // blur without typing reveals the message

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the Twilio Account SID.');
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('rejects a malformed phone number and keeps Submit disabled', async () => {
    renderChannels();

    const dialog = await openConnectForm();

    await userEvent.type(within(dialog).getByLabelText('Twilio Account SID'), 'AC123');
    await userEvent.type(within(dialog).getByLabelText('Twilio Auth token'), 'secret-token');
    await userEvent.type(within(dialog).getByLabelText('Phone number'), 'not-a-number');
    await userEvent.tab();

    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Enter a valid phone number, e.g. +15551234567.',
    );
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('SMS card — connected', () => {
  beforeEach(() =>
    stubFetch({
      channels: {
        items: [
          {
            type: 'twilio',
            status: 'connected',
            address: '+15551234567',
            connected: true,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }),
  );

  it('shows the connected phone number and a Disconnect action', async () => {
    renderChannels();

    const card = await screen.findByTestId('channel-sms');
    // The card renders Not-connected/Connect first, synchronously — the
    // switch to Connected only happens once /channels resolves.
    expect(await within(card).findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(within(card).getByText('+15551234567')).toBeInTheDocument();
  });

  it('does not disconnect without confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderChannels();

    const card = await screen.findByTestId('channel-sms');
    const disconnectButton = await within(card).findByRole('button', { name: 'Disconnect' });
    await userEvent.click(disconnectButton);

    expect(window.confirm).toHaveBeenCalled();
    // Still showing Disconnect (not "Disconnecting…") — nothing was sent.
    expect(within(card).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });
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

describe('Telegram card — not connected', () => {
  beforeEach(() => stubFetch({}));

  // Scoped to the Telegram card's own testid, same reason as Instagram's.
  async function openConnectForm() {
    const card = await screen.findByTestId('channel-telegram');
    await userEvent.click(within(card).getByRole('button', { name: 'Connect' }));
    return screen.getByRole('dialog', { name: 'Connect Telegram' });
  }

  it('opens a connect form that keeps Submit disabled until both fields are filled', async () => {
    renderChannels();

    const dialog = await openConnectForm();
    const submit = within(dialog).getByRole('button', { name: 'Connect' });
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Bot token'), 'bot-token-1');
    expect(submit).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText('Bot username'), 'nexa_support_bot');
    expect(submit).toBeEnabled();
  });

  it('shows a field-under error for a missing bot username and keeps Submit disabled', async () => {
    renderChannels();

    const dialog = await openConnectForm();

    await userEvent.type(within(dialog).getByLabelText('Bot token'), 'bot-token-1');
    await userEvent.click(within(dialog).getByLabelText('Bot username'));
    await userEvent.tab(); // blur without typing reveals the message

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Enter the bot username.');
    expect(within(dialog).getByRole('button', { name: 'Connect' })).toBeDisabled();
  });
});

describe('Telegram card — connected', () => {
  beforeEach(() =>
    stubFetch({
      channels: {
        items: [
          {
            type: 'telegram',
            status: 'connected',
            address: 'nexa_support_bot',
            connected: true,
            created_at: '2026-01-01T00:00:00.000Z',
          },
        ],
      },
    }),
  );

  it('shows the connected address and a Disconnect action', async () => {
    renderChannels();

    const card = await screen.findByTestId('channel-telegram');
    // The card renders Not-connected/Connect first, synchronously — the
    // switch to Connected only happens once /channels resolves.
    expect(await within(card).findByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
    expect(within(card).getByText('nexa_support_bot')).toBeInTheDocument();
  });

  it('does not disconnect without confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderChannels();

    const card = await screen.findByTestId('channel-telegram');
    const disconnectButton = await within(card).findByRole('button', { name: 'Disconnect' });
    await userEvent.click(disconnectButton);

    expect(window.confirm).toHaveBeenCalled();
    // Still showing Disconnect (not "Disconnecting…") — nothing was sent.
    expect(within(card).getByRole('button', { name: 'Disconnect' })).toBeInTheDocument();
  });
});

// The notify-me persistence suite that used to sit here is gone with the code
// it covered: whatsapp (08.5.6-b) was the last card off the unbuilt-channel
// list, and 08.5-c removed the status, the localStorage helpers and the button
// they rendered (K08.5.1). What replaces it as a guard is channels.test.ts's
// empty-set claim — no card in the grid is unbuilt, and none is in a fourth
// status — which fails the moment an unbuilt card is added back without the
// UI to render it.

describe('Email forwarding addresses (FR-MOD-08.5.3)', () => {
  const ADDRESSES = {
    domain: 'inbound.nexa.localhost',
    items: [
      {
        id: 'addr-default',
        label: null,
        address: 'org-1@inbound.nexa.localhost',
        is_default: true,
        ticket_count: 4,
        last_received_at: '2026-09-05T10:00:00.000Z',
      },
      {
        id: 'addr-support',
        label: 'support',
        address: 'org-1+support@inbound.nexa.localhost',
        is_default: false,
        ticket_count: 0,
        last_received_at: null,
      },
    ],
  };

  /**
   * Routes the addresses read separately from `/channels`, which the shared
   * `stubFetch` answers with an empty channel list. Returns the spy so a test
   * can assert what the console actually asked the server for.
   */
  function stubAddresses(overrides: { post?: unknown } = {}) {
    const fetchSpy = vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url);
      if (path.includes('/channels/email/addresses')) {
        if (init?.method === 'POST') return okJson(overrides.post ?? {});
        if (init?.method === 'DELETE') return okJson({});
        return okJson(ADDRESSES);
      }
      if (path.includes('/channels')) return okJson({ items: [] });
      return okJson({ items: [] });
    });
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  }

  async function openDialog() {
    renderChannels();
    const card = await screen.findByTestId('channel-email');
    await userEvent.click(within(card).getByRole('button', { name: 'Manage addresses' }));
    return screen.getByRole('dialog', { name: 'Email forwarding addresses' });
  }

  it('lists every address the workspace holds, not just the default one', async () => {
    stubAddresses();

    const dialog = await openDialog();
    expect(await within(dialog).findByText('org-1@inbound.nexa.localhost')).toBeInTheDocument();
    expect(within(dialog).getByText('org-1+support@inbound.nexa.localhost')).toBeInTheDocument();
  });

  it("shows each address's own activity — the proof that forwarding to it works", async () => {
    stubAddresses();

    const dialog = await openDialog();
    // The default has received mail; the address just defined has not, and says
    // so rather than showing a zero that reads like an error.
    expect(await within(dialog).findByText(/4 received/)).toBeInTheDocument();
    expect(within(dialog).getByText('Nothing received yet.')).toBeInTheDocument();
  });

  it('offers Remove for a defined address but never for the default', async () => {
    stubAddresses();

    const dialog = await openDialog();
    const rows = within(dialog).getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Remove' }),
    ).toBeInTheDocument();
  });

  it('refuses a label the endpoint would refuse, before sending it', async () => {
    stubAddresses();

    const dialog = await openDialog();
    const submit = within(dialog).getByRole('button', { name: 'Add address' });
    expect(submit).toBeDisabled();

    const field = within(dialog).getByLabelText('Address name (for example support)');
    // Uppercase is exactly what the server, the contract pattern and the CHECK
    // all reject; the form must not be the one place that accepts it.
    await userEvent.type(field, 'Support');
    expect(submit).toBeDisabled();

    await userEvent.clear(field);
    await userEvent.type(field, 'support');
    expect(submit).toBeEnabled();
  });

  it('sends a test message to the address the button belongs to and reports the result', async () => {
    const fetchSpy = stubAddresses({
      post: { ticket_id: 'TCK-1', address: 'org-1+support@inbound.nexa.localhost' },
    });

    const dialog = await openDialog();
    const rows = await within(dialog).findAllByRole('listitem');
    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole('button', { name: 'Send test message' }),
    );

    expect(
      await within(dialog).findByText(/Test message delivered to org-1\+support@/),
    ).toBeInTheDocument();
    const called = fetchSpy.mock.calls.map((call) => String(call[0]));
    expect(called.some((url) => url.includes('/channels/email/addresses/addr-support/test'))).toBe(
      true,
    );
  });

  it('keeps the manage action away from an agent without the channels scope', async () => {
    stubAddresses();
    useAuth.setState({
      agent: {
        account_id: 'agent-1',
        email: 'agent@example.com',
        name: 'Agent',
        role: 'agent',
        organization_id: 'org-1',
        license_id: 'license-1',
        scopes: ['chats--all:ro'],
        routing_status: 'accepting_chats',
      },
    });
    renderChannels();

    const card = await screen.findByTestId('channel-email');
    expect(within(card).queryByRole('button', { name: 'Manage addresses' })).toBeNull();
    // The address itself is still shown — it is not a secret, and copying it is
    // what the card has always been for.
    expect(within(card).getByTestId('email-forwarding-address')).toBeInTheDocument();
  });
});

describe('Channels localisation (NFR-I18N2)', () => {
  beforeEach(() => stubFetch({}));

  afterEach(() => {
    resetLocale();
  });

  function renderLocalized() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderWithLocale(
      <QueryClientProvider client={queryClient}>
        <ChannelsGrid />
      </QueryClientProvider>,
      'tr',
    );
  }

  it('paints the section title in Turkish when that is the active locale', () => {
    renderLocalized();
    expect(screen.getByRole('region', { name: 'Kanallar' })).toBeInTheDocument();
  });

  it("paints a channel card's name and call to action in Turkish", async () => {
    renderLocalized();
    const card = await screen.findByTestId('channel-website');
    expect(within(card).getByText("Web sitesi widget'ı")).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Bağlan' })).toBeInTheDocument();
  });
});
