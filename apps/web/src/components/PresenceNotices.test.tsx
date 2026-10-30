/**
 * The shell's availability notices (WG-03 · tm 340.3): what each one says, the
 * way back it offers, and that it goes when dismissed. The pushes that write
 * the store are driven through the real socket client in
 * `AppShell.realtime.test.tsx`; here the store is written directly.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { defaultScopesForRole } from '@siyahtus/types';
import { PresenceNotices } from './PresenceNotices.js';
import { useAuth } from '../lib/auth-store.js';
import {
  noteSelfStatusChange,
  noteUnansweredAlert,
  resetPresenceNotices,
  type UnansweredAlert,
} from '../lib/presence-notice.js';
import { renderWithLocale, resetLocale } from '../test/i18n.js';

let requests: Array<{ method: string; url: string; body: unknown }>;
let refuseStatus: boolean;

function renderNotices(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PresenceNotices />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const ALERT: UnansweredAlert = {
  id: 'thread-9:1',
  chatId: 'c-9',
  groupId: 4,
  agentId: 'a-2',
  reason: 'no_agent',
  transfers: 1,
  queuePosition: 1,
};

beforeEach(() => {
  requests = [];
  refuseStatus = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({
        method,
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (refuseStatus) {
        return {
          ok: false,
          status: 503,
          headers: { get: () => null },
          json: async () => ({
            error: { type: 'service_unavailable', message: '-', request_id: '-' },
          }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ routing_status: 'accepting_chats', assigned_from_queue: [] }),
      } as unknown as Response;
    }),
  );
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'agent',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: defaultScopesForRole('agent'),
      routing_status: 'not_accepting_chats',
    },
  } as Partial<ReturnType<typeof useAuth.getState>>);
});

afterEach(() => {
  act(() => resetPresenceNotices());
  vi.unstubAllGlobals();
});

describe('PresenceNotices', () => {
  it('shows nothing until something changed', () => {
    const { container } = renderNotices();
    expect(container).toBeEmptyDOMElement();
  });

  it('says why the sweep paused the agent, naming the window, and takes them back', async () => {
    act(() => noteSelfStatusChange({ kind: 'unresponsive', afterSeconds: 180 }));
    renderNotices();

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('Your availability changed');
    expect(notice).toHaveTextContent(
      'A chat assigned to you went without a reply for 3 minutes, so it was passed to a teammate and you were set to Not accepting chats.',
    );

    await userEvent.click(screen.getByRole('button', { name: 'Accept chats again' }));
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(requests).toContainEqual({
      method: 'PUT',
      url: expect.stringMatching(/\/agents\/me\/routing-status$/),
      body: { routing_status: 'accepting_chats' },
    });
    expect(useAuth.getState().agent?.routing_status).toBe('accepting_chats');
  });

  it('says a closed console went offline, in seconds when the window is not whole minutes', () => {
    act(() => noteSelfStatusChange({ kind: 'disconnected', afterSeconds: 90 }));
    renderNotices();
    expect(screen.getByRole('status')).toHaveTextContent(
      'No console window of yours was connected for 90 seconds, so you were set to Offline and new chats went to others.',
    );
  });

  it('names the status the server held when the console came back', () => {
    act(() => noteSelfStatusChange({ kind: 'changed_while_away', status: 'offline' }));
    renderNotices();
    expect(screen.getByRole('status')).toHaveTextContent(
      'While your connection was down, your status changed to Offline.',
    );
  });

  it('offers no way back to an agent already accepting chats, and keeps the notice when the change fails', async () => {
    act(() => noteSelfStatusChange({ kind: 'unresponsive', afterSeconds: null }));
    renderNotices();
    refuseStatus = true;
    await userEvent.click(screen.getByRole('button', { name: 'Accept chats again' }));
    expect(await screen.findByText('Your status could not be changed. Try again.')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('for too long');

    act(() => {
      useAuth.setState({
        agent: { ...useAuth.getState().agent!, routing_status: 'accepting_chats' },
      });
    });
    expect(screen.queryByRole('button', { name: 'Accept chats again' })).not.toBeInTheDocument();
  });

  it('tells a lead which agent left a chat unanswered and opens it', async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['agents'], { items: [{ id: 'a-2', name: 'Priya Nair' }] });
    act(() => noteUnansweredAlert(ALERT));
    renderNotices(queryClient);

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('A chat is waiting unanswered');
    expect(notice).toHaveTextContent(
      'Priya Nair did not reply to a new chat in time and nobody else in the team was free.',
    );
    const open = screen.getByRole('link', { name: 'Open chat' });
    expect(open).toHaveAttribute('href', '/app/inbox?chat=c-9');
    await userEvent.click(open);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('tells a lead nobody took a manual team’s chat, naming no agent (WG-07)', () => {
    act(() =>
      noteUnansweredAlert({
        ...ALERT,
        id: 'thread-u:0',
        reason: 'unclaimed',
        agentId: null,
        transfers: 0,
      }),
    );
    renderNotices();
    expect(screen.getByRole('status')).toHaveTextContent(
      'A chat has waited in a manual team’s queue and nobody has taken it.',
    );
  });

  it('counts the agents a chat went past, shows the same alert once, and keeps the newest few', async () => {
    act(() => {
      noteUnansweredAlert({ ...ALERT, id: 'thread-1:3', reason: 'transfer_limit', transfers: 3 });
      noteUnansweredAlert({ ...ALERT, id: 'thread-1:3', reason: 'transfer_limit', transfers: 3 });
    });
    renderNotices();
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      'A new chat has gone unanswered by 3 agents in a row.',
    );

    act(() => {
      for (const id of ['t-2', 't-3', 't-4'])
        noteUnansweredAlert({ ...ALERT, id, agentId: 'a-404' });
    });
    const alerts = screen.getAllByRole('status');
    expect(alerts).toHaveLength(3);
    // Nobody in the roster cache: the agent is not named rather than shown as an id.
    expect(alerts[0]).toHaveTextContent('An agent did not reply');

    await userEvent.click(screen.getAllByRole('button', { name: 'Dismiss this notice' })[0]!);
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });
});

/** The file's claim of being translated (NFR-I18N2). */
describe('PresenceNotices localisation', () => {
  afterEach(() => {
    resetLocale();
  });

  it('paints a notice in Turkish when that is the active locale', () => {
    act(() => noteSelfStatusChange({ kind: 'disconnected', afterSeconds: 120 }));
    renderWithLocale(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PresenceNotices />
        </MemoryRouter>
      </QueryClientProvider>,
      'tr',
    );
    expect(screen.getByRole('status')).toHaveTextContent('Durumunuz değişti');
    expect(screen.getByRole('status')).toHaveTextContent('2 dakika');
  });
});
