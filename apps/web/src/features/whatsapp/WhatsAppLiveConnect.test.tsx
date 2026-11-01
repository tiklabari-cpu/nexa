/**
 * The live WhatsApp card (tm 380 · KN-01): Meta's embedded signup in a pop-up,
 * both halves of its answer, and every way it ends. The pop-up is a stand-in
 * (`window.open` returns a plain object), and Meta's and the callback page's
 * messages are dispatched as the browser would deliver them — with their
 * origin — so the origin and `state` checks are what is tested, not bypassed.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_SCOPES, DEFAULT_AGENT_SCOPES, type DeploymentConfig } from '@siyahtus/types';
import { useAuth, useBrandStore } from '../../lib/auth-store.js';
import {
  CALLBACK_MESSAGE_TYPE,
  callbackMessageFrom,
  readCallback,
  readSessionInfo,
  signupDialogUrl,
} from './whatsapp-signup.js';

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
  live_apps: ['whatsapp'],
};

const CONFIG = {
  app_id: '1234567890',
  config_id: '998877',
  graph_version: 'v21.0',
  redirect_uri: 'http://localhost:3000/channels/whatsapp/callback',
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
let connected = false;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  deployment.current = LIVE;
  connected = false;
  connectAnswer = {
    status: 200,
    body: {
      type: 'whatsapp',
      connected: true,
      live: true,
      address: '106',
      display_address: '+90 555',
    },
  };
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
    if (path.includes('/channels/whatsapp/signup-config')) return json(200, CONFIG);
    if (path.includes('/channels/whatsapp/connect')) {
      if (connectAnswer.status === 200) connected = true;
      return json(connectAnswer.status, connectAnswer.body);
    }
    if (path.endsWith('/channels') || path.includes('/channels?')) {
      return json(200, {
        items: connected
          ? [
              {
                type: 'whatsapp',
                status: 'connected',
                connected: true,
                live: true,
                address: '106540352242922',
                display_address: '+90 555 000 11 22',
                needs_reconnect: false,
                created_at: '2026-11-01T00:00:00Z',
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

/** Meta's page posting its session info, as the embedded signup does. */
function metaSays(data: Record<string, unknown>, origin = 'https://www.facebook.com'): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { origin, data: JSON.stringify(data) }));
  });
}

/** The callback page relaying the code with the state the card put on the dialog. */
function callbackSays(code: string | null, state = stateOnDialog()): void {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        origin: window.location.origin,
        data: { type: CALLBACK_MESSAGE_TYPE, state, code, error: code ? null : 'access_denied' },
      }),
    );
  });
}

function stateOnDialog(): string {
  return new URL(popup!.location.href).searchParams.get('state') ?? '';
}

const connectCalls = () =>
  fetchMock.mock.calls.filter(([url]) => String(url).includes('/channels/whatsapp/connect'));

describe('the live WhatsApp card (tm 380 · FR-MOD-08.5.6)', () => {
  it("opens Meta's dialog for this deployment's app, then connects with the code and the chosen number", async () => {
    renderGrid();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect with Meta' }));
    await waitFor(() => expect(popup!.location.href).not.toBe(''));
    const dialog = new URL(popup!.location.href);
    expect(dialog.origin + dialog.pathname).toBe('https://www.facebook.com/v21.0/dialog/oauth');
    expect(dialog.searchParams.get('client_id')).toBe(CONFIG.app_id);
    expect(dialog.searchParams.get('config_id')).toBe(CONFIG.config_id);
    expect(dialog.searchParams.get('redirect_uri')).toBe(CONFIG.redirect_uri);
    expect(dialog.searchParams.get('state')).toMatch(/^[0-9a-f]{32}$/);
    expect(
      screen.getByRole('button', { name: 'Finish the steps in the Meta window…' }),
    ).toBeDisabled();

    metaSays({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { phone_number_id: '106540352242922', waba_id: '102290129340398' },
    });
    callbackSays('signup-code-ok');

    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    expect(JSON.parse(String((connectCalls()[0]![1] as RequestInit).body))).toEqual({
      code: 'signup-code-ok',
      waba_id: '102290129340398',
      phone_number_id: '106540352242922',
    });
    expect(popup!.closed).toBe(true);
    // The card turns Connected with the number people read, marked live.
    expect(await screen.findByText('+90 555 000 11 22')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('ignores a session message from anywhere but Meta, and a code with another state', async () => {
    renderGrid();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect with Meta' }));
    await waitFor(() => expect(popup!.location.href).not.toBe(''));
    metaSays(
      { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH', data: { phone_number_id: '6', waba_id: '6' } },
      'https://evil.example',
    );
    callbackSays('forged', 'f'.repeat(32));
    metaSays({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { phone_number_id: '106540352242922', waba_id: '102290129340398' },
    });
    // Only the legitimate session arrived; without its code nothing is sent.
    expect(connectCalls()).toHaveLength(0);
    callbackSays('signup-code-ok');
    await waitFor(() => expect(connectCalls()).toHaveLength(1));
    expect(JSON.parse(String((connectCalls()[0]![1] as RequestInit).body))).toMatchObject({
      code: 'signup-code-ok',
      phone_number_id: '106540352242922',
    });
  });

  it('says so when the pop-up is blocked, cancelled, or the number is not in the account', async () => {
    renderGrid();
    const user = userEvent.setup();

    popup = null;
    await user.click(await screen.findByRole('button', { name: 'Connect with Meta' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The browser blocked the Meta window. Allow pop-ups for this site and try again.',
    );

    popup = {
      closed: false,
      close() {
        this.closed = true;
      },
      location: { href: '' },
    };
    await user.click(screen.getByRole('button', { name: 'Connect with Meta' }));
    await waitFor(() => expect(popup!.location.href).not.toBe(''));
    metaSays({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'CANCEL',
      data: { current_step: 'PHONE_NUMBER' },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The WhatsApp sign-up was closed before it finished.',
    );

    connectAnswer = {
      status: 400,
      body: {
        error: {
          type: 'validation',
          message: 'That number is not in the account.',
          request_id: 'r',
          details: { reason: 'whatsapp_number_not_in_account' },
        },
      },
    };
    popup = {
      closed: false,
      close() {
        this.closed = true;
      },
      location: { href: '' },
    };
    await user.click(screen.getByRole('button', { name: 'Connect with Meta' }));
    await waitFor(() => expect(popup!.location.href).not.toBe(''));
    metaSays({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { phone_number_id: '999', waba_id: '102290129340398' },
    });
    callbackSays('signup-code-ok');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That number is not in the WhatsApp Business account you signed in with.',
    );
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });

  it('shows "Reconnect needed" with a reconnect control when Meta refused the token', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith('/channels')) {
        return json(200, {
          items: [
            {
              type: 'whatsapp',
              status: 'connected',
              connected: true,
              live: true,
              address: '106540352242922',
              display_address: '+90 555 000 11 22',
              needs_reconnect: true,
              created_at: '2026-11-01T00:00:00Z',
            },
          ],
        });
      }
      return json(200, { items: [] });
    });
    renderGrid();
    expect(await screen.findByText('Reconnect needed')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Meta no longer accepts this connection. Agent replies do not reach customers until you reconnect.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect with Meta' })).toBeInTheDocument();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
  });
});

describe('the signup messages', () => {
  it("builds the dialog address with the extras Meta's embedded signup reads", () => {
    const url = new URL(signupDialogUrl(CONFIG, 'abc'));
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('override_default_response_type')).toBe('true');
    expect(JSON.parse(url.searchParams.get('extras')!)).toMatchObject({ sessionInfoVersion: '3' });
  });

  it("reads Meta's session info only from a facebook.com origin", () => {
    const finish = JSON.stringify({
      type: 'WA_EMBEDDED_SIGNUP',
      event: 'FINISH',
      data: { phone_number_id: '1', waba_id: '2' },
    });
    expect(readSessionInfo('https://www.facebook.com', finish)).toEqual({
      kind: 'finish',
      wabaId: '2',
      phoneNumberId: '1',
    });
    expect(readSessionInfo('https://web.facebook.com', finish)).toMatchObject({ kind: 'finish' });
    expect(readSessionInfo('https://facebook.com.evil.example', finish)).toBeNull();
    expect(readSessionInfo('http://www.facebook.com', finish)).toBeNull();
    expect(readSessionInfo('https://www.facebook.com', '{not json')).toBeNull();
    expect(
      readSessionInfo('https://www.facebook.com', { type: 'WA_EMBEDDED_SIGNUP', event: 'FINISH' }),
    ).toEqual({ kind: 'error' });
  });

  it('reads the callback only from its own origin with its own state', () => {
    const message = { type: CALLBACK_MESSAGE_TYPE, state: 's1', code: 'c', error: null };
    expect(readCallback('http://app', 'http://app', message, 's1')).toMatchObject({ code: 'c' });
    expect(readCallback('http://other', 'http://app', message, 's1')).toBeNull();
    expect(readCallback('http://app', 'http://app', message, 's2')).toBeNull();
    expect(callbackMessageFrom('?code=abc&state=s1')).toEqual({
      type: CALLBACK_MESSAGE_TYPE,
      state: 's1',
      code: 'abc',
      error: null,
    });
    expect(callbackMessageFrom('?error=access_denied&state=s1')).toMatchObject({
      code: null,
      error: 'access_denied',
    });
  });
});
