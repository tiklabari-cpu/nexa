/**
 * The live Messenger / Instagram cards (tm 381 · KN-02): Facebook Login in a
 * pop-up, the page list the API answers, the choice, and the ways it ends.
 * The pop-up is a stand-in (`window.open` returns a plain object), and the
 * callback page's message is dispatched as the browser would deliver it —
 * with its origin — so the origin and `state` checks are what is tested.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES, type DeploymentConfig } from '@siyahtus/types';
import { useAuth, useBrandStore } from '../../lib/auth-store.js';
import {
  META_CALLBACK_MESSAGE_TYPE,
  connectablePages,
  loginDialogUrl,
  metaCallbackMessageFrom,
  readMetaCallback,
} from './meta-login.js';

const deployment = vi.hoisted(() => ({ current: null as unknown as DeploymentConfig }));
vi.mock('../../lib/deployment.js', () => ({ useDeployment: () => deployment.current }));

const { ChannelsGrid } = await import('../settings/Channels.js');

const LIVE: DeploymentConfig = {
  pilot_mode: false,
  contact_email: null,
  signup_enabled: true,
  email_verification_required: false,
  privacy_policy_url: null,
  terms_url: null,
  terms_version: null,
  live_apps: ['messenger', 'instagram'],
};

const CONFIG = {
  app_id: '2233445566',
  graph_version: 'v21.0',
  redirect_uri: 'http://localhost:3000/channels/meta/callback',
  scopes: {
    messenger: ['pages_show_list', 'pages_messaging'],
    instagram: ['pages_show_list', 'instagram_manage_messages'],
  },
};

const PAGES = {
  selection_id: 'sel_0123456789abcdefghij',
  pages: [
    { id: '1001', name: 'Acme Bet', instagram: { id: '1784', username: 'acmebet' } },
    { id: '1002', name: 'Acme Destek', instagram: null },
  ],
};

function json(status: number, body: unknown): Response {
  return {
    ok: status < 400,
    status,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

interface FakePopup {
  closed: boolean;
  close: () => void;
  location: { href: string };
}

let popup: FakePopup | null;
let connectAnswer: { status: number; body: unknown };
let connectedType: string | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  deployment.current = LIVE;
  connectedType = null;
  connectAnswer = { status: 200, body: {} };
  popup = {
    closed: false,
    close() {
      this.closed = true;
    },
    location: { href: '' },
  };
  vi.spyOn(window, 'open').mockImplementation(() => popup as unknown as Window);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const path = String(url);
    if (path.includes('/channels/meta/login-config')) return json(200, CONFIG);
    if (path.includes('/channels/meta/pages')) return json(200, PAGES);
    const connect = /\/channels\/(messenger|instagram)\/connect/.exec(path);
    if (connect) {
      if (connectAnswer.status === 200) connectedType = connect[1]!;
      return json(connectAnswer.status, connectAnswer.body);
    }
    if (path.endsWith('/channels') || path.includes('/channels?')) {
      return json(200, {
        items: connectedType
          ? [
              {
                type: connectedType,
                status: 'connected',
                connected: true,
                live: true,
                address: connectedType === 'instagram' ? '1784' : '1001',
                display_address: connectedType === 'instagram' ? '@acmebet' : 'Acme Bet',
                needs_reconnect: false,
                created_at: '2026-11-02T00:00:00Z',
              },
            ]
          : [],
      });
    }
    void init;
    return json(200, { items: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
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
      scopes: [...DEFAULT_AGENT_SCOPES, ...ADMIN_SCOPES],
      routing_status: 'accepting_chats',
    },
  } as never);
  useBrandStore.setState({ brandId: null });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderGrid(): void {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ChannelsGrid />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stateOnDialog(): string {
  return new URL(popup!.location.href).searchParams.get('state') ?? '';
}

function callbackSays(
  code: string | null,
  state = stateOnDialog(),
  origin = window.location.origin,
) {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin,
        data: {
          type: META_CALLBACK_MESSAGE_TYPE,
          state,
          code,
          error: code ? null : 'access_denied',
        },
      }),
    );
  });
}

const calls = (fragment: string) =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes(fragment));

const card = (id: string) => screen.findByTestId(`channel-${id}`);

describe('the live Messenger / Instagram cards (tm 381 · FR-MOD-08.5.4 · FR-MOD-08.5.7)', () => {
  it('logs in with Facebook, lists the pages, and connects the one chosen', async () => {
    renderGrid();
    const user = userEvent.setup();
    const messenger = await card('messenger');
    // The mock form is not offered once the channel is real.
    expect(
      within(messenger).queryByRole('button', { name: 'Connect with Facebook (mock)' }),
    ).toBeNull();
    await user.click(within(messenger).getByRole('button', { name: 'Connect with Facebook' }));
    await waitFor(() => expect(popup!.location.href).not.toBe(''));
    const dialog = new URL(popup!.location.href);
    expect(dialog.origin + dialog.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(dialog.searchParams.get('client_id')).toBe(CONFIG.app_id);
    expect(dialog.searchParams.get('redirect_uri')).toBe(CONFIG.redirect_uri);
    expect(dialog.searchParams.get('scope')).toBe('pages_show_list,pages_messaging');

    callbackSays('login-code');
    await waitFor(() => expect(calls('/channels/meta/pages')).toHaveLength(1));
    expect(JSON.parse(String((calls('/channels/meta/pages')[0]![1] as RequestInit).body))).toEqual({
      code: 'login-code',
    });
    expect(popup!.closed).toBe(true);

    const group = await within(messenger).findByRole('group', { name: 'Choose the page' });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    const connect = within(messenger).getByRole('button', { name: 'Connect' });
    expect(connect).toBeDisabled();
    await user.click(within(group).getByRole('radio', { name: 'Acme Destek' }));
    await user.click(connect);

    await waitFor(() => expect(calls('/channels/messenger/connect')).toHaveLength(1));
    expect(
      JSON.parse(String((calls('/channels/messenger/connect')[0]![1] as RequestInit).body)),
    ).toEqual({ selection_id: PAGES.selection_id, page_id: '1002' });
    expect(await within(messenger).findByText('Acme Bet')).toBeInTheDocument();
    expect(within(messenger).getByText('Live')).toBeInTheDocument();
  });

  it('offers Instagram only the pages with a linked account, and picks the only one', async () => {
    renderGrid();
    const user = userEvent.setup();
    const instagram = await card('instagram');
    await user.click(within(instagram).getByRole('button', { name: 'Connect with Facebook' }));
    await waitFor(() => expect(popup!.location.href).not.toBe(''));
    expect(new URL(popup!.location.href).searchParams.get('scope')).toContain(
      'instagram_manage_messages',
    );
    callbackSays('login-code');
    const group = await within(instagram).findByRole('group', {
      name: 'Choose the Instagram account',
    });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(1);
    expect(radios[0]).toBeChecked();
    expect(within(group).getByText('@acmebet · Acme Bet')).toBeInTheDocument();
    await user.click(within(instagram).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(calls('/channels/instagram/connect')).toHaveLength(1));
    expect(await within(instagram).findByText('@acmebet')).toBeInTheDocument();
  });

  it('ignores a code from another origin or another login, and says a cancelled or blocked one', async () => {
    renderGrid();
    const user = userEvent.setup();
    const messenger = await card('messenger');

    popup = null;
    await user.click(within(messenger).getByRole('button', { name: 'Connect with Facebook' }));
    expect(await within(messenger).findByRole('alert')).toHaveTextContent(
      'The browser blocked the Facebook window.',
    );

    popup = {
      closed: false,
      close() {
        this.closed = true;
      },
      location: { href: '' },
    };
    await user.click(within(messenger).getByRole('button', { name: 'Connect with Facebook' }));
    await waitFor(() => expect(popup!.location.href).not.toBe(''));
    callbackSays('forged', stateOnDialog(), 'https://evil.example');
    callbackSays('forged', 'f'.repeat(32));
    expect(calls('/channels/meta/pages')).toHaveLength(0);
    callbackSays(null);
    expect(await within(messenger).findByRole('alert')).toHaveTextContent(
      'The Facebook login was closed before it finished.',
    );
    expect(calls('/channels/meta/pages')).toHaveLength(0);
  });

  it('says an expired selection in the card, not a generic error', async () => {
    connectAnswer = {
      status: 400,
      body: {
        error: {
          type: 'validation',
          message: 'That page is not in a current Facebook login.',
          details: { reason: 'meta_selection_invalid' },
        },
      },
    };
    renderGrid();
    const user = userEvent.setup();
    const messenger = await card('messenger');
    await user.click(within(messenger).getByRole('button', { name: 'Connect with Facebook' }));
    await waitFor(() => expect(popup!.location.href).not.toBe(''));
    callbackSays('login-code');
    const group = await within(messenger).findByRole('group', { name: 'Choose the page' });
    await user.click(within(group).getByRole('radio', { name: 'Acme Bet' }));
    await user.click(within(messenger).getByRole('button', { name: 'Connect' }));
    expect(await within(messenger).findByRole('alert')).toHaveTextContent(
      'That choice is no longer valid. Connect with Facebook again.',
    );
  });
});

describe('meta-login helpers (tm 381)', () => {
  it('reads the callback only from its own origin and state', () => {
    const own = 'http://localhost:3000';
    const message = metaCallbackMessageFrom('?code=abc&state=s1');
    expect(readMetaCallback(own, own, message, 's1')).toMatchObject({ code: 'abc' });
    expect(readMetaCallback('https://evil.example', own, message, 's1')).toBeNull();
    expect(readMetaCallback(own, own, message, 's2')).toBeNull();
    expect(metaCallbackMessageFrom('?error=access_denied&state=s1')).toMatchObject({
      code: null,
      error: 'access_denied',
    });
  });

  it('asks each channel its own permissions, and filters Instagram to linked pages', () => {
    expect(new URL(loginDialogUrl(CONFIG, 'instagram', 's')).searchParams.get('scope')).toBe(
      'pages_show_list,instagram_manage_messages',
    );
    expect(connectablePages(PAGES.pages, 'instagram').map((page) => page.id)).toEqual(['1001']);
    expect(connectablePages(PAGES.pages, 'messenger')).toHaveLength(2);
  });
});
