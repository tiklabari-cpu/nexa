/**
 * Shell navigation and the account menu.
 *
 * The account menu is tested harder than its size suggests because it shipped
 * broken once: it relied on the browser hiding a closed `<details>`'s children,
 * which does not hold once the panel is `position: absolute`. In Chrome the
 * panel kept its 224×130 box, stayed in the accessibility tree with a working
 * "Sign out", and merely painted behind the page — invisible on screen, fully
 * present to a screen reader and to tab order.
 *
 * Note what these tests can and cannot see. `toBeVisible()` special-cases
 * descendants of a closed `<details>` and reports them hidden regardless of
 * CSS, and jsdom loads no stylesheet, so neither can observe the actual defect —
 * verified by reintroducing it and watching them still pass. The visibility
 * assertions cover open/close *behaviour*; the explicit class assertion below is
 * what guards the regression, because that class is the mechanism the browser
 * actually obeys. A real rendered check belongs in the browser E2E suite.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AppShell } from './AppShell.js';
import { readBrandId, useAuth, useBrandStore } from '../lib/auth-store.js';
import { useNavStore } from '../lib/nav-store.js';

const BRAND_KEY = 'nexa.brand_id';

function renderShell(
  initialPath = '/app/inbox',
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  // The shell's trial banner reads `/billing/subscription` through TanStack
  // Query, so a client is required to render at all. There is no server here,
  // and with retries off the query simply stays without data — the banner
  // renders nothing, which is the same as an active workspace and keeps these
  // navigation/menu tests focused on the shell rather than on billing.
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/app" element={<AppShell />}>
            <Route path="inbox" element={<p>Inbox module</p>} />
            <Route path="reports" element={<p>Reports module</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  } as unknown as Response;
}

const BRAND_A = { id: 'brand-a', name: 'Acme Support', is_default: true };
const BRAND_B = { id: 'brand-b', name: 'Beta Line', is_default: false };

/**
 * Stubs `fetch` for `/brands`; every other path (e.g. the trial banner's
 * billing read) errors, same as the unstubbed real fetch these tests would
 * otherwise get — `!data` either way, so the banner still renders nothing.
 */
function stubBrands(items: Array<{ id: string; name: string; is_default: boolean }>) {
  const fetchMock = vi.fn(async (input: string) => {
    if (input.includes('/brands')) return jsonResponse({ items });
    return {
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ error: { type: 'not_found', message: 'Not found.', request_id: '-' } }),
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
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

describe('module navigation', () => {
  it('renders the active module beside the rail', () => {
    renderShell('/app/reports');
    expect(screen.getByText('Reports module')).toBeInTheDocument();
  });

  it('marks the current module as the current page', () => {
    renderShell('/app/reports');
    expect(screen.getByRole('link', { name: 'Reports' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Inbox' })).not.toHaveAttribute('aria-current');
  });

  it('gives every rail control an accessible name', () => {
    // The rail is icon-only, so without these it is a column of unlabelled
    // buttons to anyone not looking at it (NFR-A11Y5).
    renderShell();
    for (const name of ['Inbox', 'Customers', 'Team', 'Playbook', 'Reports', 'Billing']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('leaves no dead entries in the rail', () => {
    // Every module is built, so every rail entry navigates. A disabled entry
    // here would mean a module was linked before it existed.
    renderShell();
    for (const name of [
      'Inbox',
      'Customers',
      'Team',
      'Playbook',
      'Reports',
      'Billing',
      'Settings',
    ]) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /not available yet/ })).toBeNull();
  });

  it('hides Developers from the rail for a caller without access_rules:rw', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: 'Developers' })).toBeNull();
  });

  it('shows Developers in the rail for a caller with access_rules:rw', () => {
    useAuth.setState((state) => ({
      agent: state.agent && { ...state.agent, scopes: ['access_rules:rw'] },
    }));
    renderShell();
    expect(screen.getByRole('link', { name: 'Developers' })).toBeInTheDocument();
  });
});

describe('account menu', () => {
  it('keeps sign out out of reach while closed', () => {
    renderShell();
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  it('hides the panel with display, not merely with paint order', () => {
    // The regression guard. The panel must carry `hidden` so it is display:none
    // when closed, and `group-open:block` so it returns when open. Relying on
    // the browser to hide a closed `<details>`'s children is what failed: an
    // absolutely positioned panel kept its box, its hit area and its place in
    // the accessibility tree while appearing to be gone.
    renderShell();
    const panel = screen.getByRole('button', { name: 'Sign out' }).parentElement;
    expect(panel).toHaveClass('hidden');
    expect(panel).toHaveClass('group-open:block');
  });

  it('reveals the account details on open', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account' }));

    const signOut = screen.getByRole('button', { name: 'Sign out' });
    expect(signOut).toBeVisible();
    expect(screen.getByText('dana@acme.localhost')).toBeVisible();
  });

  it('closes on Escape and hands focus back to the trigger', async () => {
    const user = userEvent.setup();
    renderShell();

    const summary = screen.getByRole('button', { name: 'Account' });
    await user.click(summary);
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
    // Focus must not be stranded on a node that is now hidden.
    expect(document.activeElement?.tagName).toBe('SUMMARY');
  });

  it('closes when the agent clicks elsewhere', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await user.click(screen.getByText('Inbox module'));

    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  it('signs out and closes the menu behind itself', async () => {
    const user = userEvent.setup();
    const signOut = vi.fn(async () => undefined);
    useAuth.setState({ signOut });

    renderShell();
    await user.click(screen.getByRole('button', { name: 'Account' }));
    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(signOut).toHaveBeenCalledOnce();
    // Leaving it open would flash a stale menu over the sign-in screen.
    expect(screen.getByRole('button', { name: 'Sign out' })).not.toBeVisible();
  });

  it('builds initials from the name, falling back to the email', () => {
    renderShell();
    expect(
      within(screen.getByRole('button', { name: 'Account' })).getByText('DO'),
    ).toBeInTheDocument();

    useAuth.setState({
      agent: {
        account_id: 'a-2',
        email: 'sam.rivera@acme.localhost',
        name: null,
        role: 'agent',
        organization_id: 'o-1',
        license_id: '1000003',
        scopes: [],
        routing_status: 'offline',
      },
    });
    renderShell();
    expect(screen.getAllByText('SR').length).toBeGreaterThan(0);
  });
});

describe('sandbox badge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Stubs `fetch` for `/settings/sandbox`; every other path (brands, the trial
   * banner's billing read) 404s the same as an unstubbed fetch would, which
   * both already render as nothing.
   */
  function stubSandbox(view: { is_sandbox: boolean; entitled: boolean; sandbox: unknown }) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (String(input).includes('/settings/sandbox')) return jsonResponse(view);
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: async () => ({
            error: { type: 'not_found', message: 'Not found.', request_id: '-' },
          }),
        } as unknown as Response;
      }),
    );
  }

  it('shows the sandbox bar when the caller is inside a sandbox', async () => {
    stubSandbox({ is_sandbox: true, entitled: false, sandbox: null });
    renderShell();

    expect(await screen.findByTestId('sandbox-badge')).toBeInTheDocument();
  });

  it('shows nothing in a production workspace', async () => {
    stubSandbox({ is_sandbox: false, entitled: true, sandbox: null });
    renderShell();

    await screen.findByText('Inbox module');
    expect(screen.queryByTestId('sandbox-badge')).not.toBeInTheDocument();
  });

  it('shows nothing when the read 403s (below-admin caller)', async () => {
    renderShell();

    await screen.findByText('Inbox module');
    expect(screen.queryByTestId('sandbox-badge')).not.toBeInTheDocument();
  });
});

describe('presence group (FR-MOD-01.1.4)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Placement, not behaviour — `PresenceAvatars.test.tsx` owns what the group
   * shows. What only the shell can prove is that the group is mounted inside
   * the labelled rail and sits above the account trigger, which is the whole of
   * the wiring this file adds.
   */
  it('mounts the online teammates inside the rail, above the account avatar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (String(input).includes('/agents')) {
          return jsonResponse({
            items: [
              {
                id: 'a-2',
                name: 'Sam Rivera',
                email: 'sam@acme.localhost',
                avatar_url: null,
                role: 'admin',
                routing_status: 'accepting_chats',
                concurrent_chats_limit: 6,
              },
            ],
          });
        }
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: async () => ({
            error: { type: 'not_found', message: 'Not found.', request_id: '-' },
          }),
        } as unknown as Response;
      }),
    );

    renderShell();

    const rail = screen.getByRole('navigation', { name: 'Modules' });
    const group = await within(rail).findByRole('list', { name: 'Teammates online' });
    expect(within(group).getByRole('img', { name: 'Sam Rivera — accepting chats' })).toBeVisible();

    const account = within(rail).getByRole('button', { name: 'Account' });
    // DOCUMENT_POSITION_FOLLOWING: the account trigger comes after the group.
    expect(group.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('leaves the rail unchanged when nobody else is online', async () => {
    // The unstubbed 404 above stands in for both "no roster" and "refused
    // roster": either way the rail is one group shorter, never broken.
    renderShell();

    await screen.findByText('Inbox module');
    expect(screen.queryByRole('list', { name: 'Teammates online' })).toBeNull();
  });
});

describe('leads pill (FR-MOD-01.1.2)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubLeadsCount(total: number) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (String(input).includes('/customers?segment=leads')) {
          return jsonResponse({ items: [], total });
        }
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: async () => ({
            error: { type: 'not_found', message: 'Not found.', request_id: '-' },
          }),
        } as unknown as Response;
      }),
    );
  }

  it('hides the pill when there are no qualified leads', async () => {
    stubLeadsCount(0);
    renderShell();

    await screen.findByText('Inbox module');
    expect(screen.queryByRole('link', { name: /Leads? qualified/ })).toBeNull();
  });

  it('shows the qualified lead count and links to the leads segment', async () => {
    stubLeadsCount(3);
    renderShell();

    const pill = await screen.findByRole('link', { name: '3 Leads qualified' });
    expect(pill).toHaveAttribute('href', '/app/customers?segment=leads');
  });
});

describe('invite (FR-MOD-01.1.5)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Stubs `/billing/subscription` (seats) and `/agents` (roster) together.
   * The roster rows are shaped like `PresenceMember` too, and offline, so
   * `PresenceAvatars` — which reads this exact same `['agents']` cache — does
   * not also try to render them as a present teammate.
   */
  function stubSeatsAndRoster(seats: number, activeAgentIds: string[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string) => {
        if (String(input).includes('/billing/subscription')) {
          return jsonResponse({ access: 'active', trial: { days_remaining: null }, seats });
        }
        if (String(input).includes('/agents')) {
          return jsonResponse({
            items: activeAgentIds.map((id) => ({
              id,
              name: id,
              email: `${id}@acme.localhost`,
              avatar_url: null,
              routing_status: 'offline',
            })),
          });
        }
        return {
          ok: false,
          status: 404,
          headers: { get: () => null },
          json: async () => ({
            error: { type: 'not_found', message: 'Not found.', request_id: '-' },
          }),
        } as unknown as Response;
      }),
    );
  }

  it('shows the plain label from every module when the seat count is not yet known', async () => {
    renderShell('/app/reports');
    expect(await screen.findByRole('button', { name: 'Invite' })).toBeInTheDocument();
  });

  it('hides the button for a caller below admin — the server rule (accounts--all:rw)', () => {
    useAuth.setState((state) => ({
      agent: state.agent && { ...state.agent, role: 'agent' },
    }));
    renderShell();
    expect(screen.queryByRole('button', { name: /^Invite/ })).toBeNull();
  });

  it('shows free seats — subscription seats minus active teammates', async () => {
    stubSeatsAndRoster(5, ['a-1', 'a-2']);
    renderShell();

    expect(await screen.findByRole('button', { name: 'Invite +3' })).toBeInTheDocument();
  });

  it('opens the same invite modal InviteTeammates uses on the Team page', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Invite' }));
    expect(screen.getByRole('dialog', { name: 'Invite teammates' })).toBeVisible();
  });
});

describe('brand switcher', () => {
  beforeEach(() => {
    localStorage.removeItem(BRAND_KEY);
    useBrandStore.setState({ brandId: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays hidden on a single-brand license', async () => {
    const fetchMock = stubBrands([BRAND_A]);
    renderShell();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'Brand' })).toBeNull();
  });

  it('lets the agent switch brands, and persists the choice', async () => {
    const user = userEvent.setup();
    stubBrands([BRAND_A, BRAND_B]);
    renderShell();

    await user.click(await screen.findByRole('button', { name: 'Brand' }));
    expect(screen.getByRole('option', { name: /Acme Support/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await user.click(screen.getByRole('option', { name: /Beta Line/ }));

    expect(localStorage.getItem(BRAND_KEY)).toBe('brand-b');
  });

  it('keeps a remembered selection after the store is rebuilt from storage', async () => {
    localStorage.setItem(BRAND_KEY, 'brand-b');
    useBrandStore.setState({ brandId: readBrandId() });
    stubBrands([BRAND_A, BRAND_B]);
    const user = userEvent.setup();

    renderShell();
    await user.click(await screen.findByRole('button', { name: 'Brand' }));

    expect(screen.getByRole('option', { name: /Beta Line/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('falls back to the default brand when the remembered id no longer exists', async () => {
    localStorage.setItem(BRAND_KEY, 'brand-deleted');
    useBrandStore.setState({ brandId: readBrandId() });
    stubBrands([BRAND_A, BRAND_B]);

    renderShell();

    await waitFor(() => expect(localStorage.getItem(BRAND_KEY)).toBe('brand-a'));
  });

  it('invalidates the query cache so no stale data from the previous brand lingers', async () => {
    const user = userEvent.setup();
    stubBrands([BRAND_A, BRAND_B]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderShell('/app/inbox', queryClient);
    await user.click(await screen.findByRole('button', { name: 'Brand' }));
    await user.click(screen.getByRole('option', { name: /Beta Line/ }));

    expect(invalidateSpy).toHaveBeenCalled();
  });

  it('does not invalidate the cache when re-selecting the current brand', async () => {
    const user = userEvent.setup();
    stubBrands([BRAND_A, BRAND_B]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    renderShell('/app/inbox', queryClient);
    await user.click(await screen.findByRole('button', { name: 'Brand' }));
    await user.click(screen.getByRole('option', { name: /Acme Support/ }));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});

describe('nav pin (FR-MOD-01.1.1 · 01.5)', () => {
  const PIN_KEY_A1 = 'nexa.nav.pinned:a-1';
  const PIN_KEY_A2 = 'nexa.nav.pinned:a-2';

  beforeEach(() => {
    localStorage.removeItem(PIN_KEY_A1);
    localStorage.removeItem(PIN_KEY_A2);
    useNavStore.setState({ accountId: null, pinned: false });
  });

  it('starts unpinned — the icon rail exactly as it rendered before this preference existed', () => {
    renderShell();
    const toggle = screen.getByRole('button', { name: 'Expand navigation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('names the toggle after the rail it controls (aria-controls)', () => {
    renderShell();
    const toggle = screen.getByRole('button', { name: 'Expand navigation' });
    const rail = screen.getByRole('navigation', { name: 'Modules' });
    expect(toggle).toHaveAttribute('aria-controls', rail.id);
  });

  it('toggles pinned on click and reveals the module labels', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));

    const toggle = screen.getByRole('button', { name: 'Collapse navigation' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    // Pinned renders a visible label beside the icon; unpinned relies on the
    // link's aria-label/title alone, so this text is only in the DOM once wide.
    expect(screen.getByText('Reports')).toBeVisible();
  });

  it('is operable from the keyboard — Enter and Space both toggle it', async () => {
    const user = userEvent.setup();
    renderShell();

    screen.getByRole('button', { name: 'Expand navigation' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('persists the choice under the signed-in account', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));

    expect(localStorage.getItem(PIN_KEY_A1)).toBe('true');
  });

  it('restores a remembered choice on the next mount (reload) for the same account', () => {
    localStorage.setItem(PIN_KEY_A1, 'true');

    renderShell();

    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('keeps the preference independent per account', async () => {
    const user = userEvent.setup();
    const first = renderShell();
    await user.click(screen.getByRole('button', { name: 'Expand navigation' }));
    expect(localStorage.getItem(PIN_KEY_A1)).toBe('true');
    first.unmount();

    useAuth.setState({
      agent: {
        account_id: 'a-2',
        email: 'sam.rivera@acme.localhost',
        name: 'Sam Rivera',
        role: 'agent',
        organization_id: 'o-1',
        license_id: '1000003',
        scopes: [],
        routing_status: 'offline',
      },
    });

    renderShell();

    // a-2 has never pinned its own rail — a-1's choice must not leak across.
    expect(screen.getByRole('button', { name: 'Expand navigation' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(localStorage.getItem(PIN_KEY_A2)).toBeNull();
  });
});
