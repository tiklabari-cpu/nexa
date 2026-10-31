/**
 * The command palette: opening, route jumping, and content search.
 *
 * Route jumping needs no network and is asserted against a real router. Content
 * search is gated on the caller's scopes and asks `GET /search`, so `fetch`
 * is stubbed: the point is that a query becomes the right requests and that
 * picking a result navigates to that record's deep link — not the wire format,
 * which the API's own suites own.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { defaultScopesForRole, type SearchResult } from '@siyahtus/types';
import { CommandPalette } from './CommandPalette.js';
import { ShortcutsHost } from './ShortcutsModal.js';
import { useAuth } from '../lib/auth-store.js';
import { useLeaveGuard } from '../lib/dirty-guard.js';
import { resetLocale, setLocale } from '../test/i18n.js';

/** Surfaces the current location so navigation can be asserted. */
function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const CUSTOMER: SearchResult = {
  kind: 'customer',
  customer_id: 'cust-mira',
  title: 'Mira Haddad',
  subtitle: 'mira@acme-customer.localhost',
  at: null,
  matched_on: 'email',
};

const TICKET: SearchResult = {
  kind: 'ticket',
  ticket_id: 'TCK123',
  customer_id: 'cust-mira',
  title: 'Refund for order 42',
  subtitle: 'Mira Haddad',
  at: '2026-01-01T00:00:00.000Z',
  matched_on: 'subject',
};

/** `GET /search` answering with `items` — a customer then a ticket by default. */
function stubFetch(items: SearchResult[] = [CUSTOMER, TICKET]): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string) => {
    if (input.includes('/search')) return jsonResponse({ items });
    return jsonResponse({ items: [] });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderPalette(
  scopes: string[],
  routingStatus: 'accepting_chats' | 'not_accepting_chats' | 'offline' = 'accepting_chats',
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  useAuth.setState({
    status: 'signed-in',
    accessToken: 'test-token',
    agent: {
      account_id: 'a-1',
      email: 'owner@acme.localhost',
      name: 'Dana Okonkwo',
      role: 'owner',
      organization_id: 'o-1',
      license_id: '1000003',
      scopes,
      routing_status: routingStatus,
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/inbox']}>
        <ShortcutsHost />
        <CommandPalette />
        <LocationProbe />
        <Routes>
          <Route path="/app/inbox" element={<p>Inbox module</p>} />
          <Route path="/app/reports" element={<p>Reports module</p>} />
          <Route path="/app/customers" element={<p>Customers module</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openPalette(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Meta>}k{/Meta}');
  return screen.findByRole('dialog', { name: 'Command palette' });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('command palette', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [] })),
    );
  });

  it('opens on ⌘K and closes on Escape', async () => {
    const user = userEvent.setup();
    renderPalette([]);

    expect(screen.queryByRole('dialog')).toBeNull();
    await openPalette(user);
    const input = screen.getByRole('combobox', { name: 'Search or jump to' });
    expect(input).toBeInTheDocument();
    // Quoted verbatim by FR-MOD-01.1.3's acceptance criterion, so it is pinned
    // rather than left to drift with the next copy pass.
    expect(input).toHaveAttribute('placeholder', 'Search Text or go to…');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lists every module as a jump target when empty', async () => {
    const user = userEvent.setup();
    // Every `NavDestination` carries a scope now (FR-MOD-01.2); an admin
    // session is what reaches all of them, `[]` no longer does.
    renderPalette(defaultScopesForRole('admin'));
    await openPalette(user);

    for (const name of [
      'Inbox',
      'Customers',
      'Team',
      'Playbook',
      'Reports',
      'Billing',
      'Settings',
    ]) {
      expect(screen.getByRole('option', { name: new RegExp(name) })).toBeInTheDocument();
    }
  });

  it('filters modules and jumps to the chosen one on Enter', async () => {
    const user = userEvent.setup();
    renderPalette(defaultScopesForRole('admin'));
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'report');
    expect(screen.getByRole('option', { name: /Reports/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Inbox/ })).toBeNull();

    await user.keyboard('{Enter}');
    expect(screen.getByText('Reports module')).toBeInTheDocument();
    // The palette closes behind the jump rather than lingering over the target.
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * The palette is the third way out of a screen holding unsaved work, after
   * the nav rail and the browser itself (FR-MOD-06.2.1). It is also the fastest
   * — two keystrokes and the module is gone — so a guard that skipped it would
   * leave the quickest route to the loss unguarded.
   */
  it('asks before jumping away from unsaved work, and stays put when declined', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPalette(defaultScopesForRole('admin'));

    // A module on screen is holding half-typed work.
    const { unmount } = renderHook(() => useLeaveGuard(true, 'Discard your half-typed skill?'));

    await openPalette(user);
    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'report');
    await user.keyboard('{Enter}');

    expect(confirm).toHaveBeenCalledWith('Discard your half-typed skill?');
    expect(screen.queryByText('Reports module')).toBeNull();
    expect(screen.getByText('Inbox module')).toBeInTheDocument();

    confirm.mockRestore();
    unmount();
  });

  // The AI agent's General settings (tm 390.2): a door beside the Playbook rail entry,
  // found by the English and the Turkish words for it, gated on the Playbook scope.
  it.each(['ai agent', 'yapay zeka', 'yapay zekâ', 'asistan'])(
    'finds the AI Agent door by "%s" and opens its General settings',
    async (needle) => {
      const user = userEvent.setup();
      renderPalette(defaultScopesForRole('admin'));
      await openPalette(user);

      await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), needle);
      // The Reports page has an "AI Agent" tab too (IN-11); the door is listed first.
      const [door] = await screen.findAllByRole('option', { name: /AI Agent/ });
      await user.click(door!);

      expect(screen.getByTestId('location')).toHaveTextContent('/app/playbook?view=general');
    },
  );

  it('does not offer the AI Agent door to someone who cannot open the Playbook', async () => {
    const user = userEvent.setup();
    renderPalette(['chats--all:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'ai agent');
    expect(screen.queryByRole('option', { name: /AI Agent/ })).toBeNull();
  });

  it('matches a module by keyword, not only its label', async () => {
    const user = userEvent.setup();
    renderPalette(defaultScopesForRole('admin'));
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'subscription');
    expect(screen.getByRole('option', { name: /Billing/ })).toBeInTheDocument();
  });

  it('searches customers and tickets and opens the record deep link', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderPalette(['customers:ro', 'tickets--all:ro', 'chats--all:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'mira');

    // Both content groups resolve from the stubbed API. The customer is matched
    // by e-mail because the ticket also carries the customer's name.
    const customer = await screen.findByRole('option', { name: /mira@acme-customer/ });
    expect(await screen.findByRole('option', { name: /Refund for order 42/ })).toBeInTheDocument();

    await user.click(customer);
    expect(screen.getByTestId('location')).toHaveTextContent('/app/customers?customer=cust-mira');
    expect(screen.getByText('Customers module')).toBeInTheDocument();
  });

  it('does not search for a caller who can read none of the three record kinds', async () => {
    const fetchMock = stubFetch();
    const user = userEvent.setup();
    renderPalette(['agents--my:rw']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'mira');
    // Give the debounce and any queries time to fire before asserting silence.
    await new Promise((resolve) => setTimeout(resolve, 400));

    const requested = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(requested.some((url) => url.includes('/search'))).toBe(false);
  });

  it('asks the server once per pause, as query=, and never puts the text in the address (FR-MOD-01.1.3)', async () => {
    const fetchMock = stubFetch([]);
    const user = userEvent.setup();
    renderPalette(['chats--access:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'TJ1H8CFKRV');
    await waitFor(() =>
      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toContainEqual(
        expect.stringContaining('/search?query=TJ1H8CFKRV&limit='),
      ),
    );
    const searches = fetchMock.mock.calls.filter((call) => String(call[0]).includes('/search'));
    expect(searches).toHaveLength(1);
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app\/inbox$/);
  });

  it('opens a day at its start, a connection scrolled to it, a message highlighted — by number', async () => {
    stubFetch([
      {
        kind: 'event',
        chat_id: 'TJ1H8CFKRV',
        thread_id: 'K3M9Q2XW7B',
        event_id: 'K3M9Q2XW7B_7',
        title: 'Ada Oyuncu',
        subtitle: null,
        at: '2026-09-01T10:00:00.000Z',
        matched_on: 'event_id',
      },
      {
        kind: 'connection',
        chat_id: 'TJ1H8CFKRV',
        thread_id: 'K3M9Q2XW7B',
        title: null,
        subtitle: null,
        at: '2026-09-01T09:58:00.000Z',
        matched_on: 'thread_id',
      },
      {
        kind: 'chat',
        chat_id: 'TJ1H8CFKRV',
        title: 'Ada Oyuncu',
        subtitle: null,
        at: '2026-09-01T09:00:00.000Z',
        matched_on: 'chat_id',
      },
    ]);
    const user = userEvent.setup();
    renderPalette(['chats--all:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'K3M9Q2XW7B_7');
    const message = await screen.findByRole('option', { name: /K3M9Q2XW7B_7/ });
    // Each row names the number it matched with the glossary's own label.
    expect(message).toHaveTextContent('Message ID');
    const connection = screen.getByRole('option', { name: /Chat ID/ });
    expect(connection).toHaveTextContent('Visitor');
    expect(connection).toHaveTextContent('Thread ID TJ1H8CFKRV');
    // In the server's order: the message, the connection, the day.
    const rows = screen
      .getAllByRole('option')
      .filter((row) => /TJ1H8CFKRV|K3M9/.test(row.textContent ?? ''));
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent(/^▤Ada OyuncuThread IDTJ1H8CFKRV · /);

    await user.click(message);
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/app/inbox?chat=TJ1H8CFKRV&thread=K3M9Q2XW7B&event=K3M9Q2XW7B_7',
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

/**
 * The action result type and its scope gate — FR-MOD-01.1.3, NFR-S3, NFR-S5.
 *
 * The palette already refuses to *search* what the caller cannot read; these
 * assert the same courtesy for what it can *do*. An action whose endpoint would
 * answer 403 is never offered, and — the part a naive filter gets wrong — the
 * "Actions" heading disappears with it rather than standing over an empty list,
 * which would tell an unauthorized agent exactly what they are missing.
 *
 * The boundary itself is elsewhere and stays elsewhere: `PUT
 * /agents/me/routing-status` enforces the same scopes server-side, pinned by
 * `route-config.test.ts` against the literal list `actions.ts` copies. Hiding
 * the entry is a UX gate on top of that, never a replacement for it.
 */
describe('command palette — action results', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [] })),
    );
  });

  it('never lists the action — nor its heading — for a caller without the scope', async () => {
    const user = userEvent.setup();
    // A real scope, just not one that reaches the routing-status endpoint.
    renderPalette(['customers:ro']);
    await openPalette(user);

    // Empty query: the palette offers its whole menu, and the action is not in it.
    expect(screen.queryByRole('option', { name: /Accepting Chats/ })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'stop accepting');

    expect(await screen.findByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Accepting Chats/ })).toBeNull();
    expect(screen.queryByText('Actions')).toBeNull();
  });

  it('lists the action for a caller holding the self-service scope', async () => {
    const user = userEvent.setup();
    renderPalette(['agents--my:rw']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'stop accepting');

    expect(screen.getByRole('option', { name: /Stop Accepting Chats/ })).toBeInTheDocument();
    expect(screen.getByText('Actions')).toBeInTheDocument();
  });

  it('accepts the administrative scope too, as the endpoint does', async () => {
    const user = userEvent.setup();
    renderPalette(['agents--all:rw']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'stop accepting');

    expect(screen.getByRole('option', { name: /Stop Accepting Chats/ })).toBeInTheDocument();
  });

  it("labels the action from the caller's live routing status", async () => {
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'not_accepting_chats');
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'accepting');

    expect(screen.getByRole('option', { name: /Start Accepting Chats/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Stop Accepting Chats/ })).toBeNull();
  });

  it('keeps navigation and search working when the caller holds no scopes at all', async () => {
    const user = userEvent.setup();
    renderPalette([]);
    await openPalette(user);

    // An empty scope set filters every action AND every module away now
    // (FR-MOD-01.2) — the palette is unharmed, it just has nothing to offer.
    expect(screen.queryByText('Actions')).toBeNull();
    expect(screen.queryByRole('option', { name: /Inbox/ })).toBeNull();

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'report');
    expect(await screen.findByText('No matches.')).toBeInTheDocument();
  });

  it('never offers Developers as a destination for a caller without access_rules:rw', async () => {
    const user = userEvent.setup();
    renderPalette([]);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'developers');
    expect(screen.queryByRole('option', { name: /Developers/ })).toBeNull();
  });

  it('offers Developers as a destination for a caller with access_rules:rw', async () => {
    const user = userEvent.setup();
    renderPalette(['access_rules:rw']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'developers');
    expect(screen.getByRole('option', { name: /Developers/ })).toBeInTheDocument();
  });
});

/**
 * Triggering an action — FR-MOD-01.1.3, FR-EK-A.2.
 *
 * The palette stops being read-only here, so these cover the two things a
 * mutation launched from a modal gets wrong. It must not hold the modal open
 * over the request — the palette is how the keyboard user escapes, and a
 * spinner in it is a trap. And, having moved the screen before the server
 * answered, it must put the screen back when the server refuses *and say so*:
 * a silent rollback reads as a toggle that never registered the keystroke, and
 * the agent's next move is to press it again.
 *
 * The store is the assertion target rather than a mocked callback, because the
 * optimistic value and the request are two halves of one behaviour and a test
 * that stubs the store can only see one of them.
 */
describe('command palette — action triggering', () => {
  /** Records the routing-status writes and answers them however the test says. */
  function stubRoutingStatus(respond: (body: unknown) => Response) {
    const seen: Array<{
      url: string;
      method: string;
      body: unknown;
      statusWhenSent: string | null;
    }> = [];
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/agents/me/routing-status')) {
        const body = init?.body ? JSON.parse(String(init.body)) : null;
        seen.push({
          url: input,
          method: String(init?.method),
          body,
          // Read through the real store at send time: if the optimistic write
          // had not landed yet this would still be the old value.
          statusWhenSent: useAuth.getState().agent?.routing_status ?? null,
        });
        return respond(body);
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return seen;
  }

  function errorResponse(status: number, type: string, message: string): Response {
    return {
      ok: false,
      status,
      headers: { get: () => null },
      json: async () => ({ error: { type, message, request_id: 'req-test' } }),
    } as unknown as Response;
  }

  async function chooseToggle(user: ReturnType<typeof userEvent.setup>) {
    await openPalette(user);
    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'accepting');
    await user.click(await screen.findByRole('option', { name: /Accepting Chats/ }));
  }

  it('rolls the optimistic status back and says so when the request is refused', async () => {
    const seen = stubRoutingStatus(() =>
      errorResponse(403, 'authorization', 'Your token cannot change routing status.'),
    );
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'accepting_chats');

    await chooseToggle(user);

    // The failure is spoken, not swallowed — and it outlives the palette that
    // launched it, since the palette closed before the answer arrived.
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That action did not go through.');
    // The ADR-06 type is what gets spoken, translated (NFR-I18N2) — not the
    // server's own English sentence, which is written for a log reader and would
    // stay English in a Turkish console.
    expect(alert).toHaveTextContent('You do not have permission to do that.');
    expect(alert).not.toHaveTextContent('Your token cannot change routing status.');
    expect(screen.queryByRole('dialog')).toBeNull();

    // And the screen tells the truth again: nothing was changed.
    await waitFor(() => expect(useAuth.getState().agent?.routing_status).toBe('accepting_chats'));
    expect(seen).toHaveLength(1);
  });

  it('rolls back a server error too, not only an authorization failure', async () => {
    stubRoutingStatus(() => errorResponse(500, 'internal', 'Something went wrong.'));
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'not_accepting_chats');

    await chooseToggle(user);

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(() =>
      expect(useAuth.getState().agent?.routing_status).toBe('not_accepting_chats'),
    );
  });

  it('sends the toggle, closes immediately, and keeps the new status on success', async () => {
    const seen = stubRoutingStatus(() => jsonResponse({ routing_status: 'not_accepting_chats' }));
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'accepting_chats');

    await chooseToggle(user);

    // Closed on select rather than after the round trip.
    expect(screen.queryByRole('dialog')).toBeNull();

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.method).toBe('PUT');
    expect(seen[0]!.url).toContain('/agents/me/routing-status');
    expect(seen[0]!.body).toEqual({ routing_status: 'not_accepting_chats' });
    // Optimistic: the store already held the new value when the request left.
    expect(seen[0]!.statusWhenSent).toBe('not_accepting_chats');

    await waitFor(() =>
      expect(useAuth.getState().agent?.routing_status).toBe('not_accepting_chats'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('refreshes the Team roster after the toggle lands, so that screen cannot show the old status', async () => {
    stubRoutingStatus(() => jsonResponse({ routing_status: 'not_accepting_chats' }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'accepting_chats', queryClient);

    await chooseToggle(user);

    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: ['team', 'agents'] }));
  });

  it('does not refresh the Team roster when the toggle is refused', async () => {
    stubRoutingStatus(() => errorResponse(403, 'authorization', 'Your token cannot.'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'accepting_chats', queryClient);

    await chooseToggle(user);
    await screen.findByRole('alert');

    expect(invalidate).not.toHaveBeenCalled();
  });

  it('toggles back on from a paused agent', async () => {
    const seen = stubRoutingStatus(() => jsonResponse({ routing_status: 'accepting_chats' }));
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'not_accepting_chats');

    await chooseToggle(user);

    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.body).toEqual({ routing_status: 'accepting_chats' });
  });

  it('lets the failure notice be dismissed', async () => {
    stubRoutingStatus(() => errorResponse(500, 'internal', 'Something went wrong.'));
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'accepting_chats');

    await chooseToggle(user);
    await screen.findByRole('alert');

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

/**
 * The AI query result — FR-MOD-01.1.3, FR-EK-B.1.
 *
 * A query that matches no action, destination or record is not a dead end:
 * the palette offers to ask instead, and picking that result calls `POST
 * /palette/ai-query` and renders whichever of the endpoint's three `kind`s
 * comes back, right where the "No matches." row would otherwise sit. Unlike
 * a nav or action result, choosing it must not close the palette — the
 * answer has nowhere else to appear.
 */
describe('command palette — AI query result', () => {
  /** Answers `/palette/ai-query`; anything else gets the usual empty search results. */
  function stubAiQuery(respond: (body: { query: string }) => Response) {
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes('/palette/ai-query')) {
        const body = init?.body
          ? (JSON.parse(String(init.body)) as { query: string })
          : { query: '' };
        return respond(body);
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const QUERY = "Summarize my team's activity";

  async function askAi(user: ReturnType<typeof userEvent.setup>, query: string) {
    await openPalette(user);
    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), query);
    const option = await screen.findByRole('option', { name: new RegExp(`Ask AI: "${query}"`) });
    await user.click(option);
  }

  it('offers to ask AI once the query matches no action, destination or record', async () => {
    stubAiQuery(() => jsonResponse({ answer: 'irrelevant', kind: 'not_understood' }));
    const user = userEvent.setup();
    renderPalette(['reports_read']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), QUERY);

    expect(await screen.findByRole('option', { name: `Ask AI: "${QUERY}"` })).toBeInTheDocument();
    expect(screen.getByText('Ask AI')).toBeInTheDocument();
  });

  it('does not offer to ask AI for a caller without reports_read', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [] })),
    );
    const user = userEvent.setup();
    renderPalette([]);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), QUERY);

    expect(await screen.findByText('No matches.')).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Ask AI/ })).toBeNull();
  });

  it('shows a loading skeleton while the answer is in flight', async () => {
    let resolveResponse!: (value: Response) => void;
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes('/palette/ai-query')) {
        return new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        });
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderPalette(['reports_read']);
    await askAi(user, QUERY);

    // The skeleton is a visual courtesy, not content — it stays out of the
    // accessibility tree while the request is in flight.
    expect(screen.getByRole('listbox')).toContainHTML('aria-hidden="true"');
    expect(screen.queryByRole('option')).toBeNull();

    resolveResponse(
      jsonResponse({ answer: 'Your team handled 3 chats in this period.', kind: 'summary' }),
    );
    expect(
      await screen.findByText('Your team handled 3 chats in this period.'),
    ).toBeInTheDocument();
  });

  it('calls the endpoint and renders the summary answer with its source', async () => {
    const fetchMock = stubAiQuery(() =>
      jsonResponse({
        answer: 'Your team handled 12 chats in this period.',
        kind: 'summary',
        metric_source: 'totals.chats',
      }),
    );
    const user = userEvent.setup();
    renderPalette(['reports_read']);

    await askAi(user, QUERY);

    expect(
      await screen.findByText('Your team handled 12 chats in this period.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Source: totals.chats')).toBeInTheDocument();
    // Not a launcher result: the palette stays open around its own answer.
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/palette/ai-query'));
    expect(call).toBeDefined();
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ query: QUERY });
  });

  it('renders a meaningful empty state for no_data, not a blank rectangle', async () => {
    stubAiQuery(() =>
      jsonResponse({
        answer: 'No data yet for that in this period.',
        kind: 'no_data',
        metric_source: 'satisfaction.score',
      }),
    );
    const user = userEvent.setup();
    renderPalette(['reports_read']);

    await askAi(user, 'customer satisfaction score');

    expect(await screen.findByText('No data yet')).toBeInTheDocument();
    expect(screen.getByText('No data yet for that in this period.')).toBeInTheDocument();
  });

  it('suggests what can be asked when the query is not understood', async () => {
    const suggestion =
      "I couldn't match that to something I can report on yet. Try asking about team activity, " +
      'tickets, customer satisfaction, response time, or automated resolutions.';
    stubAiQuery(() => jsonResponse({ answer: suggestion, kind: 'not_understood' }));
    const user = userEvent.setup();
    renderPalette(['reports_read']);

    await askAi(user, 'what is the meaning of life');

    expect(await screen.findByText('Not sure what you mean')).toBeInTheDocument();
    expect(screen.getByText(suggestion)).toBeInTheDocument();
  });

  it('shows an error notice when the request itself fails', async () => {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes('/palette/ai-query')) {
        return {
          ok: false,
          status: 500,
          headers: { get: () => null },
          json: async () => ({ error: { type: 'internal', message: 'boom', request_id: 'req-1' } }),
        } as unknown as Response;
      }
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const user = userEvent.setup();
    renderPalette(['reports_read']);
    await askAi(user, QUERY);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not get an answer — try again.',
    );
  });

  it('abandons the answer and returns to search when the query is edited', async () => {
    stubAiQuery(() => jsonResponse({ answer: 'x', kind: 'not_understood' }));
    const user = userEvent.setup();
    renderPalette(['reports_read']);

    await askAi(user, QUERY);
    expect(await screen.findByText('Not sure what you mean')).toBeInTheDocument();

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), '!');
    expect(screen.queryByText('Not sure what you mean')).toBeNull();
  });
});

/**
 * Keyboard navigation across a mixed result list — FR-MOD-01.1.3, NFR-A11Y6.
 *
 * The palette reduces action, nav and content results (its fourth kind, `ai`,
 * only ever appears once the other three found nothing, and is covered above
 * in isolation) into one flat `commands` array, so ↑↓/Enter/`aria-activedescendant`
 * only need to work against an index into that array — never against a kind.
 * These assert that promise holds once every producer actually contributes a
 * row to the same list, and that the arrow keys treat the list as a ring
 * rather than a wall at either end.
 */
describe('command palette — mixed-kind keyboard navigation', () => {
  it('walks every result kind with the arrow keys, skipping headers, and wraps at both ends', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderPalette(
      // Every nav destination now needs its own scope (FR-MOD-01.2) to reach
      // all eight non-Developers ones: `reports_read` (Home, Reports, Billing),
      // `agents-bot--all:ro` (Playbook) and `tags--groups:ro` (Settings) join
      // the four this test already held for the action and content groups.
      [
        'agents--my:rw',
        'customers:ro',
        'tickets--all:ro',
        'chats--all:ro',
        'reports_read',
        'agents-bot--all:ro',
        'tags--groups:ro',
      ],
      'accepting_chats',
    );
    await openPalette(user);
    const combobox = screen.getByRole('combobox', { name: 'Search or jump to' });

    // "o" is a deliberately broad needle: it lands the routing-status action
    // (via its "routing status" keyword), all nine nav destinations (by
    // label or keyword), and both stubbed content records (customer via its
    // e-mail, ticket via "order") in one list — action, nav and content all
    // contributing rows at once, with nothing left to the "ai" result to add.
    // The extra row is the AI Agent door (tm 390.2: "bot" matches its keywords).
    // Settings sections (≤ 6) and report views (IN-11) now sit between the nav
    // destinations and the content records, so the list ends at the ticket row
    // wherever that lands; the walk below is counted from it.
    await user.type(combobox, 'o');
    await waitFor(() =>
      expect(screen.getAllByRole('option').at(-1)).toHaveTextContent('Refund for order 42'),
    );
    const options = screen.getAllByRole('option');
    const last = options.length - 1;
    expect(last).toBeGreaterThan(12);

    // Starts on the action (index 0, group "Actions") — its heading is drawn
    // above the row but is not itself a row, so nothing has to be skipped.
    expect(options[0]).toHaveTextContent(/Accepting Chats/);
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', 'command-option-0');

    // The walk crosses the action → nav → settings → reports → content group
    // boundaries without stalling on a heading and lands on the last row.
    await user.keyboard('{ArrowDown}'.repeat(last));
    expect(options[last]).toHaveTextContent('Refund for order 42');
    expect(options[last]).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', `command-option-${last}`);
    // Exactly one row is ever marked current.
    expect(
      options.filter((option) => option.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);

    // One more step wraps past the last row back to the first rather than
    // stopping dead — the list is a ring, not a wall.
    await user.keyboard('{ArrowDown}');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', 'command-option-0');

    // And the same in reverse: ArrowUp from the first row wraps to the last.
    await user.keyboard('{ArrowUp}');
    expect(options[last]).toHaveAttribute('aria-selected', 'true');
    expect(combobox).toHaveAttribute('aria-activedescendant', `command-option-${last}`);
  });

  it('lets Enter act on whichever kind the arrow keys landed on, not only the first result', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderPalette(['customers:ro', 'tickets--all:ro', 'chats--all:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'mira');
    await screen.findByRole('option', { name: /mira@acme-customer/ });

    // The customer content result is first (index 0); one ArrowDown lands on
    // the ticket content result.
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Refund for order 42/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox?ticket=TCK123');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('wraps a plain action + nav list too, without needing any content search', async () => {
    stubFetch();
    const user = userEvent.setup();
    renderPalette(['agents--my:rw'], 'accepting_chats');
    await openPalette(user);

    // Unfiltered: just the action + all nav destinations, no network involved
    // — the smallest list the wrap behaviour has to hold for.
    const options = await screen.findAllByRole('option');
    const combobox = screen.getByRole('combobox', { name: 'Search or jump to' });

    // Exactly `options.length` steps from the first row: a clamping
    // implementation would still be sitting on the last row; wrapping lands
    // back on the first.
    await user.keyboard('{ArrowDown}'.repeat(options.length));
    expect(combobox).toHaveAttribute('aria-activedescendant', 'command-option-0');
  });
});

/**
 * "Search the archive" (ID-07 · tm 333.4): the palette as a message text
 * search. Entered from a row, it shows the matches — the matched words marked —
 * and nothing else, and a match opens the conversation at that message.
 */
describe('command palette — archive search mode', () => {
  const MATCH: SearchResult = {
    kind: 'message',
    chat_id: 'CHATMATCH1',
    thread_id: 'THREADMATC',
    event_id: 'CHATMATCH1_7',
    title: 'Mira Haddad',
    subtitle: 'Papara ile 5000 TL yatırdım',
    highlights: [
      { start: 0, end: 6 },
      { start: 11, end: 15 },
    ],
    at: '2026-09-04T09:30:00.000Z',
    matched_on: 'text',
  };

  /** `GET /search` answers `types=message` with `matches` and anything else with a customer. */
  function stubSearch(matches: SearchResult[] = [MATCH]): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async (input: string) => {
      if (input.includes('types=message')) return jsonResponse({ items: matches });
      if (input.includes('/search')) return jsonResponse({ items: [CUSTOMER] });
      return jsonResponse({ items: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const searchCalls = (fetchMock: ReturnType<typeof vi.fn>): string[] =>
    fetchMock.mock.calls
      .map(([url]) => url as string)
      .filter((url) => url.includes('types=message'));

  it('offers "Search the archive" to a caller who can read chats, and to no one else', async () => {
    stubSearch();
    const user = userEvent.setup();
    const { unmount } = renderPalette(['chats--access:ro']);
    await openPalette(user);
    expect(screen.getByRole('option', { name: /Search the archive/ })).toBeInTheDocument();
    unmount();

    renderPalette(['customers:ro']);
    await openPalette(user);
    expect(screen.queryByRole('option', { name: /Search the archive/ })).toBeNull();
  });

  it('offers it to a holder of the write scope alone, as an owner is (the server reads it as read)', async () => {
    stubSearch();
    const user = userEvent.setup();
    renderPalette(['chats--all:rw']);
    await openPalette(user);
    expect(screen.getByRole('option', { name: /Search the archive/ })).toBeInTheDocument();
  });

  it('finds the row by the word "archive", and asks nothing until a query is typed', async () => {
    const fetchMock = stubSearch();
    const user = userEvent.setup();
    renderPalette(['chats--access:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'archi');
    expect(screen.getByRole('option', { name: /Search the archive/ })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(screen.getByRole('combobox')).toHaveAttribute(
      'placeholder',
      'Search message text in the archive…',
    );
    // The word that found the row is not the query: the box starts empty.
    expect(screen.getByRole('combobox')).toHaveValue('');
    expect(screen.getByText('Type at least 3 characters.')).toBeInTheDocument();
    expect(searchCalls(fetchMock)).toEqual([]);
  });

  it('shows the matches with the matched words marked, and opens the message from one', async () => {
    const fetchMock = stubSearch();
    const user = userEvent.setup();
    renderPalette(['chats--access:ro']);
    await openPalette(user);

    const input = screen.getByRole('combobox', { name: 'Search or jump to' });
    await user.type(input, 'archi');
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('combobox'), 'papara 5000');

    const row = await screen.findByRole('option', { name: /Mira Haddad/ });
    expect(Array.from(row.querySelectorAll('mark')).map((mark) => mark.textContent)).toEqual([
      'Papara',
      '5000',
    ]);
    // Only the message matches: no customer, action or destination rows.
    expect(screen.getAllByRole('option')).toHaveLength(1);

    const url = new URL(searchCalls(fetchMock)[0]!, 'http://x');
    expect(url.searchParams.get('query')).toBe('papara 5000');
    expect(url.searchParams.get('types')).toBe('message');

    await user.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent(
      '/app/inbox?chat=CHATMATCH1&thread=THREADMATC&event=CHATMATCH1_7',
    );
    // GV-05: ids only — what was searched for never reaches the address.
    expect(screen.getByTestId('location')).not.toHaveTextContent(/papara|5000/i);
  });

  it('enters the mode with the typed query from its own row', async () => {
    const fetchMock = stubSearch();
    const user = userEvent.setup();
    renderPalette(['chats--access:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'papara 5000');
    const enter = await screen.findByRole('option', { name: /Search the archive: "papara 5000"/ });
    await user.click(enter);

    expect(await screen.findByRole('option', { name: /Mira Haddad/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveValue('papara 5000');
    expect(searchCalls(fetchMock)).toHaveLength(1);
  });

  it('does not offer it for a pasted message number, which is looked up by number', async () => {
    stubSearch();
    const user = userEvent.setup();
    renderPalette(['chats--access:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'K3M9Q2XW7B_7');
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    expect(screen.queryByRole('option', { name: /Search the archive/ })).toBeNull();
  });

  it('explains a query the search would refuse instead of sending it', async () => {
    const fetchMock = stubSearch();
    const user = userEvent.setup();
    renderPalette(['chats--access:ro']);
    await openPalette(user);
    await user.keyboard('{Escape}');
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'archi');
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('combobox'), '12 34');

    expect(
      await screen.findByText('Include a word with at least 3 letters or digits in a row.'),
    ).toBeInTheDocument();
    expect(searchCalls(fetchMock)).toEqual([]);
  });

  it('says when nothing matches, and leaves the mode with Backspace on an empty box', async () => {
    stubSearch([]);
    const user = userEvent.setup();
    renderPalette(['chats--access:ro']);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: 'Search or jump to' }), 'archi');
    await user.keyboard('{Enter}');
    await user.type(screen.getByRole('combobox'), 'olmayan');
    expect(await screen.findByText('No messages match')).toBeInTheDocument();

    await user.clear(screen.getByRole('combobox'));
    await user.keyboard('{Backspace}');
    expect(screen.getByRole('combobox')).toHaveAttribute('placeholder', 'Search Text or go to…');
    expect(screen.queryByRole('button', { name: 'Leave archive search' })).toBeNull();
  });
});

describe('command palette — settings sections and report views (IN-11)', () => {
  const SEARCH = 'Search or jump to';
  const OWNER = defaultScopesForRole('owner');

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ items: [] })),
    );
    localStorage.removeItem('siyahtus.reports.saved-views');
  });
  afterEach(() => {
    resetLocale();
    localStorage.removeItem('siyahtus.reports.saved-views');
  });

  /** The option rows drawn under the heading `group`, in order. */
  function rowsOf(group: string): string[] {
    const rows: string[] = [];
    let current = '';
    for (const li of screen.getByRole('listbox').querySelectorAll('li')) {
      const heading = li.querySelector('p');
      if (heading) current = heading.textContent ?? '';
      const option = li.querySelector('[role="option"]');
      if (option && current === group)
        rows.push(option.querySelector('.truncate')?.textContent ?? '');
    }
    return rows;
  }

  it('"hazır" finds the Saved replies section and opens it', async () => {
    const user = userEvent.setup();
    renderPalette(OWNER);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'hazır');
    expect(rowsOf('Settings')).toEqual(['Saved replies']);
    await user.click(screen.getByRole('option', { name: /Saved replies/ }));

    expect(screen.getByTestId('location')).toHaveTextContent('/app/settings/canned-responses');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('finds sections by the Turkish fold: "iki" and "SIFRE" reach the right ones', async () => {
    const user = userEvent.setup();
    renderPalette(defaultScopesForRole('agent'));
    await openPalette(user);
    const input = screen.getByRole('combobox', { name: SEARCH });

    await user.type(input, 'iki');
    expect(rowsOf('Settings')).toEqual(['Two-factor authentication']);

    await user.clear(input);
    await user.type(input, 'SIFRE');
    expect(rowsOf('Settings')).toEqual(['My profile']);
  });

  it('searches the Turkish labels in Turkish, capital İ and all', async () => {
    setLocale('tr');
    const user = userEvent.setup();
    renderPalette(defaultScopesForRole('agent'));
    await user.keyboard('{Meta>}k{/Meta}');

    await user.type(await screen.findByRole('combobox'), 'İKİ');
    expect(rowsOf('Ayarlar')).toEqual(['İki adımlı doğrulama']);
  });

  it('never offers a security section the member cannot open', async () => {
    const user = userEvent.setup();
    renderPalette(defaultScopesForRole('agent'));
    await openPalette(user);
    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'saml');
    expect(rowsOf('Settings')).toEqual([]);
    expect(screen.queryByRole('option', { name: /Single sign-on/ })).toBeNull();
  });

  it('offers the owner the same section', async () => {
    const user = userEvent.setup();
    renderPalette(OWNER);
    await openPalette(user);
    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'saml');
    expect(rowsOf('Settings')).toEqual(['Single sign-on']);
  });

  it('shows at most six settings sections, and none for an empty query', async () => {
    const user = userEvent.setup();
    renderPalette(OWNER);
    await openPalette(user);
    expect(rowsOf('Settings')).toEqual([]);

    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'e');
    expect(rowsOf('Settings')).toHaveLength(6);
  });

  it('puts a label that starts with the query before one that only contains it', async () => {
    const user = userEvent.setup();
    renderPalette(OWNER);
    await openPalette(user);
    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'tag');
    expect(rowsOf('Settings')[0]).toBe('Tags');
  });

  it('asks before leaving a dirty form for a section, and stays when declined', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPalette(OWNER);
    const { unmount } = renderHook(() => useLeaveGuard(true, 'Discard your changes?'));
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'saml');
    await user.click(screen.getByRole('option', { name: /Single sign-on/ }));

    expect(confirm).toHaveBeenCalledWith('Discard your changes?');
    expect(screen.getByTestId('location')).toHaveTextContent('/app/inbox');
    confirm.mockRestore();
    unmount();
  });

  it('offers the report tabs to a caller with reports_read and opens one by ?tab=', async () => {
    const user = userEvent.setup();
    renderPalette(OWNER);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'team perf');
    expect(rowsOf('Reports')).toEqual(['Team performance']);
    await user.click(screen.getByRole('option', { name: /Team performance/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/app/reports?tab=team-performance');
  });

  it('offers no report view to a caller without reports_read', async () => {
    const user = userEvent.setup();
    renderPalette(defaultScopesForRole('agent'));
    await openPalette(user);
    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'overview');
    expect(rowsOf('Reports')).toEqual([]);
  });

  it("lists the agent's saved report views by name and opens one by ?view=", async () => {
    localStorage.setItem(
      'siyahtus.reports.saved-views',
      JSON.stringify([
        {
          id: 'view-7',
          name: 'Haftalık değerlendirme',
          tab: 'reviews',
          mode: 7,
          customFrom: '',
          customTo: '',
          baseline: null,
        },
      ]),
    );
    const user = userEvent.setup();
    renderPalette(OWNER);
    await openPalette(user);

    await user.type(screen.getByRole('combobox', { name: SEARCH }), 'degerlendirme');
    expect(rowsOf('Reports')).toContain('Haftalık değerlendirme');
    await user.click(screen.getByRole('option', { name: /Haftalık değerlendirme/ }));
    expect(screen.getByTestId('location')).toHaveTextContent('/app/reports?view=view-7');
  });
});
