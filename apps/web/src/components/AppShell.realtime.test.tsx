/**
 * The shell owns the realtime connection (FR-MOD-13.8 · FR-EK-C.1).
 *
 * Both `useRealtime` and `useNotifications` used to be mounted by `InboxPage`,
 * which made the socket's lifetime a route's lifetime: an agent who opened
 * Reports closed their connection and was told nothing until they navigated
 * back. What is pinned here is the three things that move can get wrong —
 * whether a push still reaches the notifier off the inbox, whether walking
 * around the app opens more than one connection, and whether a second mount
 * (the regression this change invites) is loud rather than silent.
 *
 * The browser half — a real socket, a real gateway, a real second message —
 * is `apps/e2e/tests/notifications.spec.ts`; jsdom has no window manager, so
 * the "the agent is not looking at this tab" precondition is stubbed here and
 * genuinely produced there.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { useAuth } from '../lib/auth-store.js';
import { useRealtimeStatus } from '../lib/realtime-status.js';
import { useRealtime } from '../features/inbox/useInbox.js';
import { FakeWebSocket, customerMessage, installFakeWebSocket } from '../test/fake-socket.js';

/** Reports the shell's connection state the way the inbox's dot does. */
function ConnectionProbe(): React.ReactElement {
  return <p>socket: {useRealtimeStatus()}</p>;
}

/** A screen that opens the socket a second time — the regression, on purpose. */
function SecondOwner(): null {
  useRealtime();
  return null;
}

function renderShell(initialPath = '/app/inbox', reports = <ConnectionProbe />) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="inbox" element={<ConnectionProbe />} />
            <Route path="reports" element={reports} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  installFakeWebSocket();
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        ({
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: async () => ({ error: { type: 'not_found', message: '-', request_id: '-' } }),
        }) as unknown as Response,
    ),
  );
  // jsdom draws nothing, and an unimplemented `getContext` reports itself
  // through the virtual console on every unread bump. The favicon badge already
  // treats a missing context as "cannot draw", which is the branch under jsdom
  // either way — this only keeps the run's output about the tests.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'dana@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes: [],
      routing_status: 'accepting_chats',
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Wait for the handshake the fake answers, so the client has reached `live`. */
async function connected(): Promise<void> {
  await waitFor(() => expect(screen.getByText(/^socket:/)).toHaveTextContent('socket: live'));
}

describe('the shell owns the connection', () => {
  it('opens it once and keeps it across a module change', async () => {
    const user = userEvent.setup();
    renderShell();
    await connected();
    expect(FakeWebSocket.instances).toHaveLength(1);

    await user.click(screen.getByRole('link', { name: 'Reports' }));
    await screen.findByText('socket: live');

    // The measurement the move is for: navigating opens no second connection
    // and does not drop the first. Before it, this click closed the socket and
    // going back opened a new one — one reconnect per visit to the inbox.
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last.closedByClient).toBe(false);
  });

  it('closes it when the shell goes away', async () => {
    const { unmount } = renderShell();
    await connected();

    unmount();

    expect(FakeWebSocket.last.closedByClient).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('reports a second owner rather than quietly notifying twice', async () => {
    const complain = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderShell('/app/reports', <SecondOwner />);

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(2));
    expect(complain).toHaveBeenCalledWith(expect.stringContaining('mounted 2 times'));
  });
});

describe('notifications off the inbox', () => {
  it('badges a customer message that arrives while the agent is on Reports', async () => {
    // The precondition the decision rests on: the agent is not looking at this
    // tab. jsdom always claims focus, so it is stated here and produced for
    // real (a second tab in front) in the e2e twin.
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);

    renderShell('/app/reports');
    await connected();
    expect(document.title).toBe('Nexa');

    act(() =>
      FakeWebSocket.last.push('incoming_event', customerMessage('c-1', 'Is anyone there?')),
    );

    // The tab title is the one notification channel jsdom can observe: no audio
    // device for the chime, no `Notification` for the desktop alert.
    await waitFor(() => expect(document.title).toBe('(1) Nexa'));
  });

  it('stays quiet while the agent is looking at the tab', async () => {
    // Unchanged by this move, and deliberately so: `decideNotification` reads
    // focus, not route. An agent with the tab in front is present — whether
    // they are reading a transcript or a report — and interrupting them is what
    // the rule exists to prevent.
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);

    renderShell('/app/reports');
    await connected();

    act(() => FakeWebSocket.last.push('incoming_event', customerMessage('c-2', 'Still there?')));

    await waitFor(() => expect(FakeWebSocket.last.sent).not.toHaveLength(0));
    expect(document.title).toBe('Nexa');
  });
});
